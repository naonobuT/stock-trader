const express = require('express');
const { getCandles, searchSymbols, symbolExists } = require('../stockData');
const { getDb } = require('../db');
const { requireAuth } = require('../auth');
const { getSymbolEntry, searchByName } = require('../symbolNames');

const router = express.Router();

router.get('/random', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT symbol FROM symbol_stats WHERE row_count >= 300 ORDER BY RANDOM() LIMIT 1').get();
  if (!row) return res.status(404).json({ error: 'データがありません' });
  const entry = getSymbolEntry(row.symbol);
  res.json({ symbol: row.symbol, name: entry?.name || null, oldName: entry?.oldName || null });
});

router.get('/random-with-candles', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT symbol FROM symbol_stats WHERE row_count >= 300 ORDER BY RANDOM() LIMIT 1').get();
  if (!row) return res.status(404).json({ error: 'データがありません' });
  const symbol = row.symbol;
  const entry = getSymbolEntry(symbol);
  const rows = db.prepare(
    'SELECT date, open, high, low, close, volume FROM price_cache WHERE symbol = ? ORDER BY date DESC LIMIT 1000'
  ).all(symbol).reverse();
  res.json({ symbol, name: entry?.name || null, oldName: entry?.oldName || null, candles: rows });
});

router.get('/search', (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);

  const query = q.trim();
  const db = getDb();

  // コード前方一致（symbols.csv全体から）
  const { getAllStockCodes } = require('../symbolNames');
  const upperQ = query.toUpperCase();
  const byCode = getAllStockCodes()
    .filter(code => code.startsWith(upperQ))
    .slice(0, 20);

  // 社名部分一致（symbols.csv全体から）
  const byName = searchByName(query, 40)
    .filter(code => !byCode.includes(code))
    .slice(0, 20);

  const allCodes = [...byCode, ...byName].slice(0, 20);

  // データ有無を一括確認
  const hasDataSet = allCodes.length > 0
    ? new Set(
        db.prepare(`SELECT symbol FROM symbol_stats WHERE symbol IN (${allCodes.map(() => '?').join(',')})`)
          .all(...allCodes).map(r => r.symbol)
      )
    : new Set();

  const results = allCodes.map(symbol => {
    const entry = getSymbolEntry(symbol);
    return { symbol, name: entry?.name || null, oldName: entry?.oldName || null, hasData: hasDataSet.has(symbol) };
  });

  res.json(results);
});

router.get('/candles/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const { from, to, limit } = req.query;

  if (!symbolExists(symbol)) return res.status(404).json({ error: '銘柄が見つかりません' });

  const db = require('../db').getDb();
  let rows;
  if (limit) {
    // 最新N件を取得
    rows = db.prepare(
      'SELECT date, open, high, low, close, volume FROM price_cache WHERE symbol = ? ORDER BY date DESC LIMIT ?'
    ).all(symbol, parseInt(limit));
    rows = rows.reverse();
  } else {
    rows = require('../stockData').getCandles(symbol, from || null, to || null);
  }
  res.json(rows);
});

router.get('/splits/:symbol', requireAuth, (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const db = getDb();
  const splits = db.prepare('SELECT * FROM splits WHERE symbol = ? ORDER BY split_date ASC').all(symbol);
  res.json(splits);
});

router.post('/splits', requireAuth, (req, res) => {
  const { symbol, split_date, ratio } = req.body;
  if (!symbol || !split_date || !ratio) return res.status(400).json({ error: 'symbol, split_date, ratio は必須です' });
  if (ratio <= 0) return res.status(400).json({ error: 'ratioは正の数で入力してください' });

  const db = getDb();
  try {
    db.prepare('INSERT OR REPLACE INTO splits (symbol, split_date, ratio) VALUES (?, ?, ?)').run(
      symbol.toUpperCase(), split_date, parseFloat(ratio)
    );
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

router.delete('/splits/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM splits WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
