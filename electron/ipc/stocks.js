'use strict';

/**
 * stocks:* IPC ハンドラー
 *
 * 新しい株価データ操作を追加するときは、ここに handle() を1つ追加し、
 * preload.js の allowedInvoke にチャンネル名を追記するだけでよい。
 */

function register(ipcMain) {
  const { getDb } = require('../../src/db');
  const { getSymbolEntry, searchByName, getAllStockCodes } = require('../../src/symbolNames');
  const { getCandles, symbolExists } = require('../../src/stockData');

  // ランダム銘柄（ローソク足付き）
  ipcMain.handle('stocks:random-with-candles', () => {
    const db = getDb();
    const row = db.prepare(
      'SELECT symbol FROM symbol_stats WHERE row_count >= 300 ORDER BY RANDOM() LIMIT 1'
    ).get();
    if (!row) throw new Error('データがありません');

    const symbol = row.symbol;
    const entry = getSymbolEntry(symbol);
    const candles = db.prepare(
      'SELECT date, open, high, low, close, volume FROM price_cache WHERE symbol = ? ORDER BY date DESC LIMIT 1000'
    ).all(symbol).reverse();

    return { symbol, name: entry?.name ?? null, oldName: entry?.oldName ?? null, candles };
  });

  // ランダム銘柄（ローソク足なし）
  ipcMain.handle('stocks:random', () => {
    const db = getDb();
    const row = db.prepare(
      'SELECT symbol FROM symbol_stats WHERE row_count >= 300 ORDER BY RANDOM() LIMIT 1'
    ).get();
    if (!row) throw new Error('データがありません');
    const entry = getSymbolEntry(row.symbol);
    return { symbol: row.symbol, name: entry?.name ?? null, oldName: entry?.oldName ?? null };
  });

  // ローソク足取得
  // data: { symbol, limit?, from?, to? }
  ipcMain.handle('stocks:candles', (_, { symbol, limit, from, to } = {}) => {
    if (!symbol) throw new Error('symbol は必須です');
    const upper = symbol.toUpperCase();
    if (!symbolExists(upper)) throw new Error('銘柄が見つかりません');

    const db = getDb();
    if (limit) {
      const rows = db.prepare(
        'SELECT date, open, high, low, close, volume FROM price_cache WHERE symbol = ? ORDER BY date DESC LIMIT ?'
      ).all(upper, parseInt(limit));
      return rows.reverse();
    }
    return getCandles(upper, from ?? null, to ?? null);
  });

  // 銘柄検索
  // data: { q }
  ipcMain.handle('stocks:search', (_, { q } = {}) => {
    if (!q) return [];
    const query = String(q).trim();
    const db = getDb();

    const upperQ = query.toUpperCase();
    const byCode = getAllStockCodes().filter(c => c.startsWith(upperQ)).slice(0, 20);
    const byName = searchByName(query, 40).filter(c => !byCode.includes(c)).slice(0, 20);
    const allCodes = [...byCode, ...byName].slice(0, 20);

    if (!allCodes.length) return [];

    const hasDataSet = new Set(
      db.prepare(`SELECT symbol FROM symbol_stats WHERE symbol IN (${allCodes.map(() => '?').join(',')})`)
        .all(...allCodes).map(r => r.symbol)
    );

    return allCodes.map(sym => {
      const entry = getSymbolEntry(sym);
      return { symbol: sym, name: entry?.name ?? null, oldName: entry?.oldName ?? null, hasData: hasDataSet.has(sym) };
    });
  });
}

module.exports = { register };
