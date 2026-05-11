const { getDb } = require('./db');
const { jquantsFetch, BASE_URL } = require('./jquantsAuth');

// J-Quantsは5桁コード（末尾0）、社内は4桁
function toJQuantsCode(symbol) {
  const s = symbol.replace(/\.T$/, '');
  return s.length === 4 ? `${s}0` : s;
}

function toDateStr(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : d;
}

/**
 * 日次株価を全ページ取得してflat配列で返す
 */
async function fetchDailyQuotes(symbol, from, to) {
  const code = toJQuantsCode(symbol);
  const params = new URLSearchParams({ code });
  if (from) params.set('from', toDateStr(from));
  if (to)   params.set('to',   toDateStr(to));

  const bars = [];
  let paginationKey = null;

  do {
    if (paginationKey) params.set('pagination_key', paginationKey);
    const res = await jquantsFetch(`${BASE_URL}/equities/bars/daily?${params}`);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`株価取得失敗 (${res.status}): ${text}`);
    }

    const data = await res.json();
    bars.push(...(data.bars || []));
    paginationKey = data.pagination_key || null;
  } while (paginationKey);

  return bars;
}

/**
 * 1銘柄をJ-Quantsからダウンロードしてprice_cacheに保存
 */
async function downloadSymbol(symbol, period1, period2) {
  const db   = getDb();
  const bars = await fetchDailyQuotes(symbol, period1, period2);
  if (!bars.length) return { inserted: 0, skipped: 0 };

  const insert = db.prepare(
    'INSERT OR IGNORE INTO price_cache (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertMany = db.transaction((items) => {
    for (const r of items) insert.run(r);
  });

  const code = symbol.toUpperCase().replace(/\.T$/, '');
  const items = bars
    .filter(b => b.AdjustedClose != null)
    .map(b => [
      code,
      b.Date,
      b.AdjustedOpen   ?? null,
      b.AdjustedHigh   ?? null,
      b.AdjustedLow    ?? null,
      b.AdjustedClose,
      b.AdjustedVolume ?? null,
    ]);

  insertMany(items);

  const skipped  = bars.length - items.length;
  const fromDate = items[0]?.[1] ?? null;
  const toDate   = items[items.length - 1]?.[1] ?? null;
  return { inserted: items.length, skipped, from: fromDate, to: toDate };
}

/**
 * 複数銘柄を順にダウンロード（SSE進捗コールバック付き）
 */
async function downloadSymbols(symbols, period1, period2, onProgress) {
  let totalInserted = 0;
  const errors = [];

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i].toUpperCase();
    if (onProgress) onProgress({ done: i, total: symbols.length, symbol });

    try {
      const result = await downloadSymbol(symbol, period1, period2);
      totalInserted += result.inserted;
    } catch (err) {
      errors.push({ symbol, message: err.message });
    }
  }

  if (onProgress) onProgress({ done: symbols.length, total: symbols.length, symbol: null });
  return { totalInserted, errors, total: symbols.length };
}

/**
 * 既存銘柄の差分更新：各銘柄の最終日の翌日〜今日を取得
 */
async function downloadUpdate(onProgress, shouldAbort) {
  const db    = getDb();
  const today = toDateStr(new Date());

  const targets = db.prepare(
    "SELECT symbol, MAX(date) as last_date FROM price_cache GROUP BY symbol HAVING last_date < ?"
  ).all(today);

  let totalInserted = 0, skipped = 0;
  const errors = [];

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
      skipped++;
    }
  }

  if (onProgress) onProgress({ done: targets.length, total: targets.length, symbol: null });
  return { total: targets.length, totalInserted, skipped, errors };
}

/**
 * 未取込銘柄の一括取得
 */
async function downloadMissing(period1, onProgress, shouldAbort) {
  const { getAllStockCodes } = require('./symbolNames');
  const db    = getDb();
  const today = toDateStr(new Date());

  const existing = new Set(
    db.prepare('SELECT DISTINCT symbol FROM price_cache').all().map(r => r.symbol)
  );
  const targets = getAllStockCodes().filter(code => !existing.has(code));

  let totalInserted = 0;
  const errors = [];

  for (let i = 0; i < targets.length; i++) {
    if (shouldAbort && shouldAbort()) break;

    const symbol = targets[i];
    if (onProgress) onProgress({ done: i, total: targets.length, symbol });

    try {
      const result = await downloadSymbol(symbol, period1, today);
      totalInserted += result.inserted;
    } catch (err) {
      errors.push({ symbol, message: err.message });
    }
  }

  if (onProgress) onProgress({ done: targets.length, total: targets.length, symbol: null });
  return { total: targets.length, totalInserted, errors };
}

module.exports = { downloadSymbol, downloadSymbols, downloadUpdate, downloadMissing };
