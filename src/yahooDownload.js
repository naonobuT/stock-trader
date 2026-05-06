const { getDb } = require('./db');

const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['ripHistorical'] });

// リクエスト間隔：基本1000ms ± 最大400msのランダムジッター
// → 約40〜85リクエスト/分。Yahoo Financeへの過負荷を防ぐ。
const RATE_BASE_MS  = 1000;
const RATE_JITTER_MS = 400;
const wait = () => new Promise(r =>
  setTimeout(r, RATE_BASE_MS + Math.random() * RATE_JITTER_MS)
);

// 日本株シンボルに .T を付与（すでに付いていれば不要）
function toYahooSymbol(code) {
  if (/\.[A-Z]+$/.test(code)) return code;
  return `${code}.T`;
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * 1銘柄をYahoo Financeからダウンロードしてprice_cacheに保存
 * @returns { inserted, skipped, symbol, from, to }
 */
async function downloadSymbol(symbol, period1, period2) {
  const db = getDb();
  const yahooSym = toYahooSymbol(symbol);

  const rows = await yf.historical(yahooSym, { period1, period2 });
  if (!rows || rows.length === 0) return { inserted: 0, skipped: 0 };

  const insert = db.prepare(
    'INSERT OR IGNORE INTO price_cache (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertMany = db.transaction((items) => {
    for (const r of items) insert.run(r);
  });

  const items = rows
    .filter(r => r.close != null)
    .map(r => [
      symbol.toUpperCase(),
      toDateStr(new Date(r.date)),
      r.open   ?? null,
      r.high   ?? null,
      r.low    ?? null,
      r.close,
      r.volume ?? null,
    ]);

  insertMany(items);

  const fromDate = toDateStr(new Date(rows[0].date));
  const toDate   = toDateStr(new Date(rows[rows.length - 1].date));
  return { inserted: items.length, skipped: rows.length - items.length, from: fromDate, to: toDate };
}

/**
 * 複数銘柄を順にダウンロード（SSE進捗コールバック付き）
 * symbols: string[]
 * onProgress({ done, total, symbol, inserted, error })
 */
async function downloadSymbols(symbols, period1, period2, onProgress) {
  let totalInserted = 0, errors = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i].toUpperCase();
    if (onProgress) onProgress({ done: i, total: symbols.length, symbol });

    try {
      const result = await downloadSymbol(symbol, period1, period2);
      totalInserted += result.inserted;
    } catch (err) {
      errors.push({ symbol, message: err.message });
    }

    if (i < symbols.length - 1) await wait();
  }

  if (onProgress) onProgress({ done: symbols.length, total: symbols.length, symbol: null });
  return { totalInserted, errors, total: symbols.length };
}

/**
 * 既存銘柄の差分更新：各銘柄の最終日の翌日〜今日を取得
 * shouldAbort: () => boolean  中断フラグ
 */
async function downloadUpdate(onProgress, shouldAbort) {
  const db  = getDb();
  const today = toDateStr(new Date());

  const targets = db.prepare(
    "SELECT symbol, MAX(date) as last_date FROM price_cache GROUP BY symbol HAVING last_date < ?"
  ).all(today);

  let totalInserted = 0, skipped = 0, errors = [];

  for (let i = 0; i < targets.length; i++) {
    if (shouldAbort && shouldAbort()) break;

    const { symbol, last_date } = targets[i];
    if (onProgress) onProgress({ done: i, total: targets.length, symbol });

    const next = new Date(last_date);
    next.setDate(next.getDate() + 1);
    if (toDateStr(next) > today) { skipped++; continue; }

    try {
      const result = await downloadSymbol(symbol, toDateStr(next), today);
      totalInserted += result.inserted;
      if (result.inserted === 0) skipped++;
    } catch {
      skipped++;  // Yahoo にない銘柄（廃止等）は静かにスキップ
    }

    if (i < targets.length - 1) await wait();
  }

  if (onProgress) onProgress({ done: targets.length, total: targets.length, symbol: null });
  return { total: targets.length, totalInserted, skipped, errors };
}

/**
 * 未取込銘柄の一括取得：symbols.csvにあってDBにない銘柄を取得
 * period1: 取得開始日（デフォルト5年前）
 * shouldAbort: () => boolean
 */
async function downloadMissing(period1, onProgress, shouldAbort) {
  const { getAllStockCodes } = require('./symbolNames');
  const db = getDb();
  const today = toDateStr(new Date());

  const existing = new Set(
    db.prepare('SELECT DISTINCT symbol FROM price_cache').all().map(r => r.symbol)
  );
  const targets = getAllStockCodes().filter(code => !existing.has(code));

  let totalInserted = 0, errors = [];

  for (let i = 0; i < targets.length; i++) {
    if (shouldAbort && shouldAbort()) break;

    const symbol = targets[i];
    if (onProgress) onProgress({ done: i, total: targets.length, symbol });

    try {
      const result = await downloadSymbol(symbol, period1, today);
      totalInserted += result.inserted;
    } catch {
      // Yahoo にない銘柄はスキップ（廃止銘柄など）
    }

    if (i < targets.length - 1) await wait();
  }

  if (onProgress) onProgress({ done: targets.length, total: targets.length, symbol: null });
  return { total: targets.length, totalInserted, errors };
}

module.exports = { downloadSymbols, downloadSymbol, downloadUpdate, downloadMissing };
