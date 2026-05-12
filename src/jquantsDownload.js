const { getDb } = require('./db');
const { jquantsFetch, BASE_URL, checkApiKey } = require('./jquantsAuth');

const CONCURRENCY  = 3;    // 銘柄別取得の同時数

// プラン別待機時間（J-Quants公式レート制限: Free=5/分, Light=60/分, Standard=120/分, Premium=500/分）
const PLAN_WAIT_MS = {
  free:     10000, // 5/分制限: 13.5秒/req = 4.4/分
  light:     500,  // 60/分制限: 4秒/req = 15/分
  standard:  200,  // 120/分制限: 3.7秒/req = 16/分
  premium:   100,  // 500/分制限: ほぼ制限なし
};
const BATCH_WAIT_MS = 10000; // デフォルト（プラン不明時）
const sleep = ms => new Promise(r => setTimeout(r, ms));

const RETRY_WAITS = [15000, 45000, 120000]; // 429時の待機: 15s, 45s, 120s

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await jquantsFetch(url);
    if (res.status === 429) {
      const wait = RETRY_WAITS[attempt] ?? 120000;
      console.log(`[jquants] 429 rate limit - attempt${attempt + 1} wait ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    return res;
  }
  throw new Error('レート制限: リトライ上限に達しました');
}

// J-Quantsは5桁コード（末尾0）、社内は4桁
function toJQuantsCode(symbol) {
  const s = symbol.replace(/\.T$/, '');
  return s.length === 4 ? `${s}0` : s;
}

function toDateStr(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : d;
}

/**
 * 銘柄指定で日次株価を全ページ取得
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
    const res = await fetchWithRetry(`${BASE_URL}/equities/bars/daily?${params}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`株価取得失敗 (${res.status}): ${text}`);
    }
    const data = await res.json();
    bars.push(...(data.data || data.bars || []));
    paginationKey = data.pagination_key || null;
  } while (paginationKey);

  return bars;
}

/**
 * 1日分の全銘柄データを取得（ページネーション対応）
 */
async function fetchAllByDate(dateStr) {
  const bars = [];
  let paginationKey = null;
  let page = 0;
  const t0 = Date.now();

  do {
    const params = new URLSearchParams({ date: dateStr });
    if (paginationKey) params.set('pagination_key', paginationKey);
    const pt = Date.now();
    const res = await fetchWithRetry(`${BASE_URL}/equities/bars/daily?${params}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`取得失敗 (${res.status}): ${text}`);
    }
    const data = await res.json();
    bars.push(...(data.data || []));
    paginationKey = data.pagination_key || null;
    page++;
    console.log(`[jquants] ${dateStr} page${page} ${data.data?.length ?? 0}件 ${Date.now()-pt}ms`);
  } while (paginationKey);

  console.log(`[jquants] ${dateStr} 合計${bars.length}件 ${page}ページ ${Date.now()-t0}ms`);
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
    .filter(b => (b.AdjC ?? b.AdjustedClose) != null)
    .map(b => [
      code,
      b.Date,
      b.AdjO ?? b.AdjustedOpen   ?? null,
      b.AdjH ?? b.AdjustedHigh   ?? null,
      b.AdjL ?? b.AdjustedLow    ?? null,
      b.AdjC ?? b.AdjustedClose,
      b.AdjVo ?? b.AdjustedVolume ?? null,
    ]);

  insertMany(items);
  return { inserted: items.length, skipped: bars.length - items.length };
}

/**
 * 日付ベースで全銘柄を一括取得（1日1リクエストで全銘柄）
 * downloadMissing / downloadUpdate で使用
 */
async function downloadByDateRange(period1, period2, onProgress, shouldAbort, plan) {
  checkApiKey();
  const db      = getDb();
  const end     = new Date(period2 || toDateStr(new Date()));
  const start   = new Date(period1);
  const waitMs  = PLAN_WAIT_MS[plan?.toLowerCase()] ?? BATCH_WAIT_MS;
  console.log(`[jquants] plan=${plan ?? 'unknown'} waitMs=${waitMs}`);

  // 平日のみリスト生成
  const dates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) dates.push(toDateStr(new Date(d)));
  }

  const insert = db.prepare(
    'INSERT OR IGNORE INTO price_cache (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertMany = db.transaction((items) => {
    for (const r of items) insert.run(r);
  });

  let totalInserted = 0;
  const errors = [];

  for (let i = 0; i < dates.length; i++) {
    if (shouldAbort && shouldAbort()) break;
    if (onProgress) onProgress({ done: i, total: dates.length, symbol: dates[i] });

    try {
      const bars = await fetchAllByDate(dates[i]);
      if (bars.length) {
        const items = bars
          .filter(b => (b.AdjC ?? b.AdjustedClose) != null)
          .map(b => [
            String(b.Code).slice(0, 4),
            b.Date,
            b.AdjO ?? null,
            b.AdjH ?? null,
            b.AdjL ?? null,
            b.AdjC,
            b.AdjVo ?? null,
          ]);
        insertMany(items);
        totalInserted += items.length;
      }
    } catch (err) {
      errors.push({ symbol: dates[i], message: err.message });
    }
    if (i < dates.length - 1) await sleep(waitMs);
  }

  if (onProgress) onProgress({ done: dates.length, total: dates.length, symbol: null });
  return { totalInserted, errors, total: dates.length };
}

async function runBatch(symbols, worker, onProgress, shouldAbort) {
  let done = 0;
  const total = symbols.length;
  const errors = [];
  let totalInserted = 0;

  for (let i = 0; i < total; i += CONCURRENCY) {
    if (shouldAbort && shouldAbort()) break;
    const batch = symbols.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(sym => worker(sym)));
    for (let j = 0; j < batch.length; j++) {
      done++;
      if (onProgress) onProgress({ done, total, symbol: batch[j] });
      if (results[j].status === 'fulfilled') {
        totalInserted += results[j].value.inserted || 0;
      } else {
        errors.push({ symbol: batch[j], message: results[j].reason?.message });
      }
    }
    if (i + CONCURRENCY < total) await sleep(BATCH_WAIT_MS);
  }
  if (onProgress) onProgress({ done: total, total, symbol: null });
  return { totalInserted, errors, total };
}

/**
 * 複数銘柄を並列ダウンロード（個別指定用）
 */
async function downloadSymbols(symbols, period1, period2, onProgress) {
  checkApiKey();
  return runBatch(
    symbols.map(s => s.toUpperCase()),
    sym => downloadSymbol(sym, period1, period2),
    onProgress
  );
}

/**
 * 既存銘柄の差分更新：日付ベースで全銘柄まとめて取得
 */
async function downloadUpdate(onProgress, shouldAbort, period2, plan) {
  const db    = getDb();
  const today = period2 || toDateStr(new Date());

  // 全銘柄の最古の「次の取得日」を開始日とする
  const row = db.prepare(
    "SELECT MIN(date) as min_date FROM (SELECT MAX(date) as date FROM price_cache GROUP BY symbol)"
  ).get();
  if (!row?.min_date) return { total: 0, totalInserted: 0, errors: [] };

  const next = new Date(row.min_date);
  next.setDate(next.getDate() + 1);
  const from = toDateStr(next);
  if (from > today) return { total: 0, totalInserted: 0, errors: [] };

  return downloadByDateRange(from, today, onProgress, shouldAbort, plan);
}

/**
 * 未取込銘柄の一括取得：日付ベースで全銘柄まとめて取得
 */
async function downloadMissing(period1, onProgress, shouldAbort, period2, plan) {
  return downloadByDateRange(period1, period2, onProgress, shouldAbort, plan);
}

module.exports = { downloadSymbol, downloadSymbols, downloadUpdate, downloadMissing };
