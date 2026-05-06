const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// ゲームセッション開始
router.post('/start', requireAuth, (req, res) => {
  const { symbol, game_days = 360 } = req.body;
  const userId = req.session.userId;
  const db = getDb();

  // 銘柄の最初の日付と最後の日付を取得
  const range = db.prepare(
    'SELECT MIN(date) as first, MAX(date) as last FROM price_cache WHERE symbol = ?'
  ).get(symbol);

  if (!range || !range.first) return res.status(404).json({ error: 'データがありません' });

  // ゲーム開始日をランダムに選択（最低100日分の残データを確保）
  const minRemaining = 100;
  const totalCount = db.prepare('SELECT COUNT(*) as n FROM price_cache WHERE symbol = ?').get(symbol).n;

  if (totalCount < 10) {
    return res.status(400).json({ error: 'データが不足しています' });
  }

  const maxStartIdx = Math.max(0, totalCount - minRemaining - 1);
  const startIdx = Math.floor(Math.random() * (maxStartIdx + 1));
  const startDate = db.prepare(
    'SELECT date FROM price_cache WHERE symbol = ? ORDER BY date ASC LIMIT 1 OFFSET ?'
  ).get(symbol, startIdx).date;

  // 既存セッションをリセット
  db.prepare('DELETE FROM game_sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM positions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM trades WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM pnl_snapshots WHERE user_id = ?').run(userId);
  db.prepare('UPDATE users SET virtual_cash = 10000000 WHERE id = ?').run(userId);

  db.prepare(`
    INSERT INTO game_sessions (user_id, symbol, start_date, current_date, game_days)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, symbol, startDate, startDate, game_days);

  res.json({ symbol, start_date: startDate, current_date: startDate, game_days });
});

// 現在のゲーム状態を取得
router.get('/state', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const db = getDb();

  const session = db.prepare('SELECT * FROM game_sessions WHERE user_id = ?').get(userId);
  if (!session) return res.json({ active: false });

  const user = db.prepare('SELECT virtual_cash FROM users WHERE id = ?').get(userId);
  const positions = db.prepare('SELECT * FROM positions WHERE user_id = ? AND shares != 0').all(userId);

  // 現在日の株価
  const priceRow = db.prepare(
    'SELECT close FROM price_cache WHERE symbol = ? AND date <= ? ORDER BY date DESC LIMIT 1'
  ).get(session.symbol, session.current_date);

  const currentPrice = priceRow ? priceRow.close : null;

  // ポジション評価額（ロング: 加算、ショート: 買戻し負債を差し引き）
  let positionValue = 0;
  const positionDetails = positions.map(pos => {
    const p = currentPrice || pos.avg_price;
    const isShort = pos.side === 'short';
    if (isShort) {
      positionValue -= p * pos.shares;
    } else {
      positionValue += p * pos.shares;
    }
    return { ...pos, current_price: p, is_short: isShort };
  });

  // 経過日数（取引日ベース）
  const elapsed = db.prepare(
    'SELECT COUNT(*) as n FROM price_cache WHERE symbol = ? AND date >= ? AND date <= ?'
  ).get(session.symbol, session.start_date, session.current_date).n - 1;

  // 総資産（ロングのみ）
  const totalAssets = user.virtual_cash + positionValue;
  const profitRate = ((totalAssets - 10000000) / 10000000 * 100).toFixed(1);

  res.json({
    active: true,
    symbol: session.symbol,
    start_date: session.start_date,
    current_date: session.current_date,
    game_days: session.game_days,
    elapsed_days: elapsed,
    cash: user.virtual_cash,
    position_value: positionValue,
    total_assets: totalAssets,
    profit_rate: profitRate,
    current_price: currentPrice,
    positions: positionDetails,
  });
});

// 翌日へ進む
router.post('/next', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const db = getDb();
  const io = req.app.get('io');

  const session = db.prepare('SELECT * FROM game_sessions WHERE user_id = ?').get(userId);
  if (!session) return res.status(400).json({ error: 'ゲームセッションがありません' });

  // 次の取引日を取得
  const nextDayRow = db.prepare(
    'SELECT date, close FROM price_cache WHERE symbol = ? AND date > ? ORDER BY date ASC LIMIT 1'
  ).get(session.symbol, session.current_date);

  if (!nextDayRow) return res.json({ finished: true, message: 'データの最終日です' });

  const { date: nextDate, close: openPrice } = nextDayRow;

  // pending_orders を翌日の始値で約定
  const pendingOrders = db.prepare('SELECT * FROM pending_orders WHERE user_id = ?').all(userId);

  db.transaction(() => {
    for (const order of pendingOrders) {
      if (order.type === 'buy') {
        const user = db.prepare('SELECT virtual_cash FROM users WHERE id = ?').get(userId);
        const cost = openPrice * order.shares;
        if (user.virtual_cash >= cost) {
          db.prepare('UPDATE users SET virtual_cash = virtual_cash - ? WHERE id = ?').run(cost, userId);
          const existing = db.prepare('SELECT shares, avg_price FROM positions WHERE user_id = ? AND symbol = ? AND side = ?').get(userId, order.symbol, 'long');
          if (existing) {
            const newShares = existing.shares + order.shares;
            const newAvg = (existing.avg_price * existing.shares + openPrice * order.shares) / newShares;
            db.prepare('UPDATE positions SET shares = ?, avg_price = ? WHERE user_id = ? AND symbol = ? AND side = ?').run(newShares, newAvg, userId, order.symbol, 'long');
          } else {
            db.prepare('INSERT INTO positions (user_id, symbol, side, shares, avg_price) VALUES (?, ?, ?, ?, ?)').run(userId, order.symbol, 'long', order.shares, openPrice);
          }
          db.prepare('INSERT INTO trades (user_id, symbol, type, shares, price, executed_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, order.symbol, 'buy', order.shares, openPrice, nextDate);
        }
      } else if (order.type === 'sell') {
        const position = db.prepare('SELECT shares, avg_price FROM positions WHERE user_id = ? AND symbol = ? AND side = ?').get(userId, order.symbol, 'long');
        if (position && position.shares >= order.shares) {
          const proceeds = openPrice * order.shares;
          const realizedPnl = (openPrice - position.avg_price) * order.shares;
          db.prepare('UPDATE users SET virtual_cash = virtual_cash + ? WHERE id = ?').run(proceeds, userId);
          db.prepare('UPDATE positions SET shares = shares - ? WHERE user_id = ? AND symbol = ? AND side = ?').run(order.shares, userId, order.symbol, 'long');
          db.prepare('INSERT INTO trades (user_id, symbol, type, shares, price, realized_pnl, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, order.symbol, 'sell', order.shares, openPrice, realizedPnl, nextDate);
        }
      } else if (order.type === 'short') {
        const proceeds = openPrice * order.shares;
        db.prepare('UPDATE users SET virtual_cash = virtual_cash + ? WHERE id = ?').run(proceeds, userId);
        const existing = db.prepare('SELECT shares, avg_price FROM positions WHERE user_id = ? AND symbol = ? AND side = ?').get(userId, order.symbol, 'short');
        if (existing) {
          const newShares = existing.shares + order.shares;
          const newAvg = (existing.avg_price * existing.shares + openPrice * order.shares) / newShares;
          db.prepare('UPDATE positions SET shares = ?, avg_price = ? WHERE user_id = ? AND symbol = ? AND side = ?').run(newShares, newAvg, userId, order.symbol, 'short');
        } else {
          db.prepare('INSERT INTO positions (user_id, symbol, side, shares, avg_price) VALUES (?, ?, ?, ?, ?)').run(userId, order.symbol, 'short', order.shares, openPrice);
        }
        db.prepare('INSERT INTO trades (user_id, symbol, type, shares, price, executed_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, order.symbol, 'short', order.shares, openPrice, nextDate);
      } else if (order.type === 'cover') {
        const position = db.prepare('SELECT shares, avg_price FROM positions WHERE user_id = ? AND symbol = ? AND side = ?').get(userId, order.symbol, 'short');
        if (position && position.shares >= order.shares) {
          const user = db.prepare('SELECT virtual_cash FROM users WHERE id = ?').get(userId);
          const cost = openPrice * order.shares;
          if (user.virtual_cash >= cost) {
            const realizedPnl = (position.avg_price - openPrice) * order.shares;
            db.prepare('UPDATE users SET virtual_cash = virtual_cash - ? WHERE id = ?').run(cost, userId);
            db.prepare('UPDATE positions SET shares = shares - ? WHERE user_id = ? AND symbol = ? AND side = ?').run(order.shares, userId, order.symbol, 'short');
            db.prepare('INSERT INTO trades (user_id, symbol, type, shares, price, realized_pnl, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(userId, order.symbol, 'cover', order.shares, openPrice, realizedPnl, nextDate);
          }
        }
      }
      db.prepare('DELETE FROM pending_orders WHERE id = ?').run(order.id);
    }
  })();

  // 経過日数チェック
  const elapsed = db.prepare(
    'SELECT COUNT(*) as n FROM price_cache WHERE symbol = ? AND date >= ? AND date <= ?'
  ).get(session.symbol, session.start_date, nextDate).n - 1;

  db.prepare('UPDATE game_sessions SET current_date = ? WHERE user_id = ?').run(nextDate, userId);

  // PnLスナップショット記録
  const user = db.prepare('SELECT virtual_cash FROM users WHERE id = ?').get(userId);
  const positions = db.prepare('SELECT side, shares FROM positions WHERE user_id = ? AND shares != 0').all(userId);
  const priceRow = db.prepare(
    'SELECT close FROM price_cache WHERE symbol = ? AND date <= ? ORDER BY date DESC LIMIT 1'
  ).get(session.symbol, nextDate);
  const p = priceRow ? priceRow.close : 0;
  const posVal = positions.reduce((sum, pos) => {
    return pos.side === 'short' ? sum - p * pos.shares : sum + p * pos.shares;
  }, 0);
  db.prepare('INSERT INTO pnl_snapshots (user_id, total_value, recorded_at) VALUES (?, ?, ?)').run(userId, user.virtual_cash + posVal, nextDate);

  if (io) {
    const ranking = db.prepare(`
      SELECT u.username, MAX(p.total_value) as total_value
      FROM pnl_snapshots p JOIN users u ON u.id = p.user_id
      GROUP BY p.user_id ORDER BY total_value DESC LIMIT 20
    `).all();
    io.emit('ranking', ranking);
  }

  res.json({ finished: false, current_date: nextDate, elapsed_days: elapsed });
});

// チャートデータ取得（ゲームモード：現在日まで）
router.get('/candles', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const db = getDb();

  const session = db.prepare('SELECT * FROM game_sessions WHERE user_id = ?').get(userId);
  if (!session) return res.status(400).json({ error: 'ゲームセッションがありません' });

  const { days = 120 } = req.query;

  const candles = db.prepare(`
    SELECT date, open, high, low, close, volume
    FROM price_cache
    WHERE symbol = ? AND date >= ? AND date <= ?
    ORDER BY date ASC
  `).all(session.symbol, session.start_date, session.current_date);

  res.json({ symbol: session.symbol, candles });
});

module.exports = router;
