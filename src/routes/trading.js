const express = require('express');
const { getDb } = require('../db');
const { getLatestPrice, symbolExists } = require('../stockData');
const { requireAuth } = require('../auth');

const router = express.Router();

function getGamePrice(userId, symbol) {
  const db = getDb();
  const session = db.prepare('SELECT symbol, current_date FROM game_sessions WHERE user_id = ?').get(userId);
  if (session && session.symbol === symbol) {
    const row = db.prepare(
      'SELECT close FROM price_cache WHERE symbol = ? AND date <= ? ORDER BY date DESC LIMIT 1'
    ).get(symbol, session.current_date);
    return row ? row.close : null;
  }
  return getLatestPrice(symbol);
}

function calcTotalValue(userId) {
  const db = getDb();
  const user = db.prepare('SELECT virtual_cash FROM users WHERE id = ?').get(userId);
  const session = db.prepare('SELECT symbol, current_date FROM game_sessions WHERE user_id = ?').get(userId);
  const positions = db.prepare('SELECT symbol, side, shares FROM positions WHERE user_id = ? AND shares != 0').all(userId);

  let positionValue = 0;
  for (const pos of positions) {
    let price;
    if (session && session.symbol === pos.symbol) {
      const row = db.prepare(
        'SELECT close FROM price_cache WHERE symbol = ? AND date <= ? ORDER BY date DESC LIMIT 1'
      ).get(pos.symbol, session.current_date);
      price = row ? row.close : null;
    } else {
      price = getLatestPrice(pos.symbol);
    }
    if (price) {
      // ロング: 時価を加算、ショート: 買戻し負債を差し引く
      positionValue += pos.side === 'short' ? -price * pos.shares : price * pos.shares;
    }
  }

  return user.virtual_cash + positionValue;
}

function recordPnl(userId, io) {
  const db = getDb();
  const total = calcTotalValue(userId);
  db.prepare('INSERT INTO pnl_snapshots (user_id, total_value) VALUES (?, ?)').run(userId, total);

  const ranking = db.prepare(`
    SELECT u.username, MAX(p.total_value) as total_value
    FROM pnl_snapshots p JOIN users u ON u.id = p.user_id
    GROUP BY p.user_id ORDER BY total_value DESC LIMIT 20
  `).all();

  if (io) io.emit('ranking', ranking);
}

router.post('/buy', requireAuth, (req, res) => {
  const { symbol, shares } = req.body;
  const userId = req.session.userId;

  if (!symbol || !shares || shares <= 0) return res.status(400).json({ error: '銘柄と株数を正しく入力してください' });
  if (!symbolExists(symbol.toUpperCase())) return res.status(404).json({ error: '銘柄が見つかりません' });

  const db = getDb();
  db.prepare('INSERT INTO pending_orders (user_id, symbol, type, shares) VALUES (?, ?, ?, ?)').run(userId, symbol.toUpperCase(), 'buy', shares);
  res.json({ queued: true });
});

router.post('/sell', requireAuth, (req, res) => {
  const { symbol, shares } = req.body;
  const userId = req.session.userId;

  if (!symbol || !shares || shares <= 0) return res.status(400).json({ error: '銘柄と株数を正しく入力してください' });

  const db = getDb();
  const position = db.prepare('SELECT shares FROM positions WHERE user_id = ? AND symbol = ? AND side = ?').get(userId, symbol.toUpperCase(), 'long');
  if (!position || position.shares < shares) return res.status(400).json({ error: '保有株数が不足しています' });

  db.prepare('INSERT INTO pending_orders (user_id, symbol, type, shares) VALUES (?, ?, ?, ?)').run(userId, symbol.toUpperCase(), 'sell', shares);
  res.json({ queued: true });
});

router.post('/short', requireAuth, (req, res) => {
  const { symbol, shares } = req.body;
  const userId = req.session.userId;

  if (!symbol || !shares || shares <= 0) return res.status(400).json({ error: '銘柄と株数を正しく入力してください' });
  if (!symbolExists(symbol.toUpperCase())) return res.status(404).json({ error: '銘柄が見つかりません' });

  const db = getDb();
  db.prepare('INSERT INTO pending_orders (user_id, symbol, type, shares) VALUES (?, ?, ?, ?)').run(userId, symbol.toUpperCase(), 'short', shares);
  res.json({ queued: true });
});

router.post('/cover', requireAuth, (req, res) => {
  const { symbol, shares } = req.body;
  const userId = req.session.userId;

  if (!symbol || !shares || shares <= 0) return res.status(400).json({ error: '銘柄と株数を正しく入力してください' });

  const db = getDb();
  const position = db.prepare('SELECT shares FROM positions WHERE user_id = ? AND symbol = ? AND side = ?').get(userId, symbol.toUpperCase(), 'short');
  if (!position || position.shares <= 0) return res.status(400).json({ error: '空売りポジションがありません' });
  if (position.shares < shares) return res.status(400).json({ error: `空売り株数が不足しています（空売り中: ${position.shares}株）` });

  db.prepare('INSERT INTO pending_orders (user_id, symbol, type, shares) VALUES (?, ?, ?, ?)').run(userId, symbol.toUpperCase(), 'cover', shares);
  res.json({ queued: true });
});

router.get('/pending', requireAuth, (req, res) => {
  const db = getDb();
  const orders = db.prepare('SELECT * FROM pending_orders WHERE user_id = ? ORDER BY ordered_at ASC').all(req.session.userId);
  res.json(orders);
});

router.get('/portfolio', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const db = getDb();
  const user = db.prepare('SELECT virtual_cash FROM users WHERE id = ?').get(userId);
  const positions = db.prepare('SELECT symbol, side, shares, avg_price FROM positions WHERE user_id = ? AND shares != 0').all(userId);

  const positionsWithValue = positions.map(pos => {
    const price = getLatestPrice(pos.symbol) || pos.avg_price;
    const isShort = pos.side === 'short';
    const pnl = isShort
      ? (pos.avg_price - price) * pos.shares
      : (price - pos.avg_price) * pos.shares;
    const pnl_pct = isShort
      ? ((pos.avg_price - price) / pos.avg_price * 100).toFixed(2)
      : ((price - pos.avg_price) / pos.avg_price * 100).toFixed(2);
    return {
      ...pos,
      current_price: price,
      market_value: price * pos.shares,
      pnl,
      pnl_pct,
      is_short: isShort,
    };
  });

  const total = calcTotalValue(userId);

  res.json({ cash: user.virtual_cash, positions: positionsWithValue, total_value: total });
});

router.get('/trades', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const db = getDb();
  const trades = db.prepare(
    'SELECT * FROM trades WHERE user_id = ? ORDER BY executed_at DESC LIMIT 100'
  ).all(userId);
  res.json(trades);
});

router.get('/pnl', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const db = getDb();
  const snapshots = db.prepare(
    'SELECT total_value, recorded_at FROM pnl_snapshots WHERE user_id = ? ORDER BY recorded_at ASC'
  ).all(userId);
  res.json(snapshots);
});

router.get('/realized-pnl', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const db = getDb();

  const rows = db.prepare(`
    SELECT date(executed_at) as date, SUM(realized_pnl) as daily_pnl
    FROM trades
    WHERE user_id = ? AND realized_pnl != 0
    GROUP BY date(executed_at)
    ORDER BY date ASC
  `).all(userId);

  let cumulative = 0;
  const result = rows.map(r => {
    cumulative += r.daily_pnl;
    return { date: r.date, value: cumulative };
  });

  res.json(result);
});

router.get('/ranking', (req, res) => {
  const db = getDb();
  const ranking = db.prepare(`
    SELECT u.username,
           COALESCE((SELECT total_value FROM pnl_snapshots WHERE user_id = u.id ORDER BY recorded_at DESC LIMIT 1), u.virtual_cash) as total_value
    FROM users u
    ORDER BY total_value DESC
    LIMIT 20
  `).all();
  res.json(ranking);
});

module.exports = router;
