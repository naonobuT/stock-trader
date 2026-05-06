/**
 * 日本株の日足データ（＋オプションで株式分割情報）を取得してDBに投入する
 *
 * 使い方:
 *   node scripts/fetchStocks.js [オプション] [4桁コード ...]
 *
 * オプション:
 *   --splits      価格データに加えて株式分割情報も取得する
 *   --force       既にDBにある銘柄も再取得して上書きする
 *
 * 例)
 *   node scripts/fetchStocks.js                        # デフォルトリストを取得
 *   node scripts/fetchStocks.js 7203 6758              # 指定銘柄のみ
 *   node scripts/fetchStocks.js --splits 7203 6758     # 分割情報も取得
 *
 * 注意:
 *   stooq.com のデータは分割調整済み価格のため、既存の未調整CSVデータとは
 *   性質が異なります。stooq 由来の銘柄に対して分割を適用すると二重調整に
 *   なるのでご注意ください。
 */

const https = require('https');
const { getDb } = require('../src/db');

// デフォルト取得銘柄リスト（業種別主要銘柄）
const DEFAULT_SYMBOLS = [
  // 自動車
  '7203', '7267', '7269', '7270', '7201', '7261',
  // 電機・精密
  '6758', '6752', '6501', '6702', '6971', '6723', '6503',
  // 半導体・IT部品
  '8035', '6857', '6594', '6981',
  // 通信
  '9432', '9433', '9984', '9434',
  // 小売・消費
  '9983', '3382', '8267', '2802', '2914',
  // 金融・保険
  '8306', '8316', '8411', '8591', '8766',
  // 製薬・医療
  '4502', '4519', '4568', '4523', '4543',
  // ゲーム・エンタメ
  '7974', '9684', '7832', '3659',
  // 不動産・建設
  '1925', '1928', '8801', '8802',
  // 素材・化学
  '4188', '3407', '5401', '5711',
  // 航空・輸送
  '9201', '9202', '9020', '9022',
];

// --- HTTP ヘルパー ---
function fetchText(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'Mozilla/5.0' } };
    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- 価格データ (stooq.com) ---
async function fetchPrices(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${symbol}.jp&i=d`;
  const csv = await fetchText(url);
  if (!csv || csv.includes('No data') || csv.trim().split('\n').length < 2) return [];

  const rows = [];
  const lines = csv.trim().split('\n');
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].trim().split(',');
    if (cols.length < 5) continue;
    const date   = cols[0].trim();
    const open   = parseFloat(cols[1]) || null;
    const high   = parseFloat(cols[2]) || null;
    const low    = parseFloat(cols[3]) || null;
    const close  = parseFloat(cols[4]) || null;
    const volume = parseInt(cols[5])   || null;
    if (!date || !close) continue;
    rows.push([symbol, date, open, high, low, close, volume]);
  }
  return rows;
}

// --- 株式分割データ (Yahoo Finance) ---
async function fetchSplits(symbol) {
  // Yahoo Finance の東証ティッカーは "1234.T" 形式
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}.T?events=splits&range=max&interval=1d`;
  const json = await fetchText(url);
  const data = JSON.parse(json);

  const splitsObj = data?.chart?.result?.[0]?.events?.splits;
  if (!splitsObj) return [];

  const raw = Object.values(splitsObj).map(s => ({
    symbol,
    split_date: new Date(s.date * 1000).toISOString().split('T')[0],
    ratio: s.numerator / s.denominator,
  })).sort((a, b) => a.split_date.localeCompare(b.split_date));

  // Yahoo Finance が同一イベントを記録日・効力発生日の両方で返すことがある。
  // 7日以内かつ同一比率の連続エントリは後の日付（効力発生日）だけ残す。
  const deduped = [];
  for (const s of raw) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.ratio === s.ratio) {
      const daysDiff = (new Date(s.split_date) - new Date(prev.split_date)) / 86400000;
      if (daysDiff <= 7) {
        deduped[deduped.length - 1] = s; // 後の日付で上書き
        continue;
      }
    }
    deduped.push(s);
  }
  return deduped;
}

// --- DB 書き込み ---
function importPrices(db, rows) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO price_cache (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  db.transaction(() => { for (const r of rows) insert.run(r); })();
}

function importSplits(db, splits) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO splits (symbol, split_date, ratio) VALUES (?, ?, ?)'
  );
  db.transaction(() => {
    for (const s of splits) insert.run(s.symbol, s.split_date, s.ratio);
  })();
  return splits.length;
}

// --- メイン ---
async function run(symbols, { withSplits, force }) {
  const db = getDb();

  const existingPrices = new Set(
    db.prepare('SELECT DISTINCT symbol FROM price_cache').all().map(r => r.symbol)
  );
  const existingSplits = new Set(
    db.prepare('SELECT DISTINCT symbol FROM splits').all().map(r => r.symbol)
  );

  let priceImported = 0, priceSkipped = 0, priceFailed = 0;
  let splitImported = 0, splitSkipped = 0, splitFailed = 0;

  for (const symbol of symbols) {
    // --- 価格データ ---
    if (!force && existingPrices.has(symbol)) {
      process.stdout.write(`[price] ${symbol} skip\n`);
      priceSkipped++;
    } else {
      process.stdout.write(`[price] ${symbol} ... `);
      try {
        const rows = await fetchPrices(symbol);
        if (rows.length === 0) {
          console.log('no data');
          priceFailed++;
        } else {
          importPrices(db, rows);
          console.log(`${rows.length} rows`);
          priceImported++;
        }
      } catch (e) {
        console.log(`error: ${e.message}`);
        priceFailed++;
      }
      await sleep(600);
    }

    // --- 分割データ ---
    if (withSplits) {
      if (!force && existingSplits.has(symbol)) {
        splitSkipped++;
      } else {
        process.stdout.write(`[split] ${symbol} ... `);
        try {
          const splits = await fetchSplits(symbol);
          if (splits.length === 0) {
            console.log('none');
          } else {
            const n = importSplits(db, splits);
            console.log(`${n} splits`);
            splitImported += n;
          }
        } catch (e) {
          console.log(`error: ${e.message}`);
          splitFailed++;
        }
        await sleep(400);
      }
    }
  }

  console.log('\n=== 完了 ===');
  console.log(`価格: 取込=${priceImported} スキップ=${priceSkipped} 失敗=${priceFailed}`);
  if (withSplits) {
    console.log(`分割: 取込=${splitImported}件 スキップ=${splitSkipped} 失敗=${splitFailed}`);
  }

  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(DISTINCT symbol) FROM price_cache) AS price_symbols,
      (SELECT COUNT(*)               FROM price_cache) AS price_rows,
      (SELECT COUNT(*)               FROM splits)      AS split_rows
  `).get();
  console.log(`DB: 銘柄数=${totals.price_symbols} 価格行数=${totals.price_rows} 分割件数=${totals.split_rows}`);
}

// --- CLI パース ---
const rawArgs = process.argv.slice(2);
const withSplits = rawArgs.includes('--splits');
const force      = rawArgs.includes('--force');
const symbols    = rawArgs.filter(a => !a.startsWith('--'));
const targets    = symbols.length > 0 ? symbols : DEFAULT_SYMBOLS;

console.log(`対象: ${targets.length}銘柄  分割取得: ${withSplits}  強制再取得: ${force}`);
run(targets, { withSplits, force }).catch(e => { console.error(e); process.exit(1); });
