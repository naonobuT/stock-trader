const { getDb } = require('./db');

function applysplits(symbol, rows) {
  const db = getDb();
  const splits = db.prepare(
    'SELECT split_date, ratio FROM splits WHERE symbol = ? ORDER BY split_date ASC'
  ).all(symbol);

  if (splits.length === 0) return rows;

  return rows.map(row => {
    let factor = 1;
    for (const s of splits) {
      if (row.date < s.split_date) factor *= s.ratio;
    }
    if (factor === 1) return row;
    return {
      ...row,
      open: row.open != null ? row.open / factor : null,
      high: row.high != null ? row.high / factor : null,
      low: row.low != null ? row.low / factor : null,
      close: row.close != null ? row.close / factor : null,
    };
  });
}

function getCandles(symbol, from, to) {
  const db = getDb();
  let rows;
  if (from && to) {
    rows = db.prepare(
      'SELECT date, open, high, low, close, volume FROM price_cache WHERE symbol = ? AND date >= ? AND date <= ? ORDER BY date ASC'
    ).all(symbol, from, to);
  } else {
    rows = db.prepare(
      'SELECT date, open, high, low, close, volume FROM price_cache WHERE symbol = ? ORDER BY date ASC'
    ).all(symbol);
  }
  return applysplits(symbol, rows);
}

function getLatestPrice(symbol) {
  const db = getDb();
  const row = db.prepare(
    'SELECT date, close FROM price_cache WHERE symbol = ? ORDER BY date DESC LIMIT 1'
  ).get(symbol);
  if (!row) return null;

  const adjusted = applysplits(symbol, [row]);
  return adjusted[0].close;
}

function symbolExists(symbol) {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM price_cache WHERE symbol = ? LIMIT 1').get(symbol);
  return !!row;
}

function searchSymbols(query) {
  const db = getDb();
  const rows = db.prepare(
    "SELECT DISTINCT symbol FROM price_cache WHERE symbol LIKE ? LIMIT 50"
  ).all(`${query}%`);
  return rows.map(r => r.symbol);
}

module.exports = { getCandles, getLatestPrice, symbolExists, searchSymbols };
