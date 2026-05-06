const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');
const { getDb } = require('./db');

const STOCK_DATA_DIR = process.env.STOCK_DATA_DIR
  || path.join(__dirname, '..', 'stockdata');
const BATCH_SIZE = 1000;

// ===== フォーマット定義 =====
// parse(cols) → { date, open, high, low, close, volume } | null
const FORMATS = {
  milley: {
    label: 'milley形式',
    encoding: 'Shift_JIS',
    skipRows: 1,
    minCols: 7,
    parse(cols) {
      // 日付, 始値, 高値, 安値, 終値, (不使用), 出来高
      const date = cols[0].trim().replace(/\//g, '-');
      const open   = parseFloat(cols[1]) || null;
      const high   = parseFloat(cols[2]) || null;
      const low    = parseFloat(cols[3]) || null;
      const close  = parseFloat(cols[4]) || null;
      const volume = parseInt(cols[6])   || null;
      if (!date || !close) return null;
      return { date, open, high, low, close, volume };
    },
  },

  yahoo_japan: {
    label: 'Yahoo!ファイナンス形式',
    encoding: 'UTF-8',
    skipRows: 1,
    minCols: 6,
    parse(cols) {
      // 日付, 始値, 高値, 安値, 終値, 出来高[, 調整後終値]
      const date = cols[0].trim().replace(/\//g, '-');
      const open   = parseFloat(cols[1]) || null;
      const high   = parseFloat(cols[2]) || null;
      const low    = parseFloat(cols[3]) || null;
      const close  = parseFloat(cols[4]) || null;
      const volume = parseInt(cols[5])   || null;
      if (!date || !close) return null;
      return { date, open, high, low, close, volume };
    },
  },

  generic: {
    label: '汎用形式（日付,始値,高値,安値,終値,出来高）',
    encoding: 'auto',
    skipRows: 1,
    minCols: 6,
    parse(cols) {
      const date = cols[0].trim().replace(/\//g, '-');
      const open   = parseFloat(cols[1]) || null;
      const high   = parseFloat(cols[2]) || null;
      const low    = parseFloat(cols[3]) || null;
      const close  = parseFloat(cols[4]) || null;
      const volume = parseInt(cols[5])   || null;
      if (!date || !close) return null;
      return { date, open, high, low, close, volume };
    },
  },
};

function decodeContent(buffer, encoding) {
  if (encoding === 'auto') {
    // BOM or UTF-8 BOM があれば UTF-8、なければ Shift_JIS を試みる
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      return iconv.decode(buffer.slice(3), 'UTF-8');
    }
    try {
      const utf8 = iconv.decode(buffer, 'UTF-8');
      // 文字化けチェック（置換文字 U+FFFD がなければ UTF-8 と判断）
      if (!utf8.includes('�')) return utf8;
    } catch {}
    return iconv.decode(buffer, 'Shift_JIS');
  }
  return iconv.decode(buffer, encoding);
}

function parseLines(content, fmt) {
  const lines = content.split(/\r?\n/);
  const rows = [];
  for (let i = fmt.skipRows; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length < fmt.minCols) continue;
    const parsed = fmt.parse(cols);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

function insertRows(db, symbol, parsedRows) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO price_cache (symbol, date, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertMany = db.transaction((rows) => {
    for (const r of rows) insert.run(symbol, r.date, r.open, r.high, r.low, r.close, r.volume);
  });

  for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
    insertMany(parsedRows.slice(i, i + BATCH_SIZE));
  }
  return parsedRows.length;
}

// ===== 公開関数 =====

function getFormats() {
  return Object.entries(FORMATS).map(([id, f]) => ({ id, label: f.label }));
}

function importAll() {
  const db = getDb();
  if (!fs.existsSync(STOCK_DATA_DIR)) {
    console.log(`[importCsv] ${STOCK_DATA_DIR} not found. Skipping.`);
    return;
  }

  const existing = new Set(
    db.prepare('SELECT DISTINCT symbol FROM price_cache').all().map(r => r.symbol)
  );
  const files = fs.readdirSync(STOCK_DATA_DIR).filter(f => f.toUpperCase().endsWith('.CSV'));
  const newFiles = files.filter(f => !existing.has(path.basename(f, path.extname(f))));

  if (newFiles.length === 0) {
    console.log(`[importCsv] All ${files.length} symbols already imported. Skipping.`);
    return;
  }

  console.log(`[importCsv] Importing ${newFiles.length} new files (${existing.size} already exist)...`);
  const fmt = FORMATS.milley;
  let total = 0;

  for (const file of newFiles) {
    const symbol = path.basename(file, path.extname(file));
    try {
      const raw = fs.readFileSync(path.join(STOCK_DATA_DIR, file));
      const content = decodeContent(raw, fmt.encoding);
      const rows = parseLines(content, fmt);
      total += insertRows(db, symbol, rows);
    } catch (err) {
      console.warn(`[importCsv] Failed: ${file}: ${err.message}`);
    }
  }
  console.log(`[importCsv] Done. Imported ~${total} rows across ${files.length} symbols.`);
}

// Buffer配列からインポート（ファイルアップロード用）
// files: [{ originalname, buffer }], formatId: string
function importFromBuffers(files, formatId, onProgress) {
  const fmt = FORMATS[formatId] || FORMATS.milley;
  const db = getDb();
  let imported = 0, skipped = 0, totalRows = 0, errors = [];

  for (let i = 0; i < files.length; i++) {
    const { originalname, buffer } = files[i];
    const symbol = path.basename(originalname, path.extname(originalname)).toUpperCase();
    if (onProgress) onProgress({ done: i, total: files.length, symbol });
    try {
      const content = decodeContent(buffer, fmt.encoding);
      const rows = parseLines(content, fmt);
      totalRows += insertRows(db, symbol, rows);
      imported++;
    } catch (err) {
      errors.push({ file: originalname, message: err.message });
      skipped++;
    }
  }

  if (onProgress) onProgress({ done: files.length, total: files.length, symbol: null });
  return { imported, skipped, totalRows, errors, total: files.length };
}

// 指定フォルダからインポート
function importFromDir(dirPath, formatId, onProgress) {
  const fmt = FORMATS[formatId] || FORMATS.milley;
  const db = getDb();

  if (!fs.existsSync(dirPath)) return { error: `フォルダが見つかりません: ${dirPath}` };

  const files = fs.readdirSync(dirPath).filter(f => f.toUpperCase().endsWith('.CSV'));
  if (files.length === 0) return { error: 'CSVファイルが見つかりません' };

  let imported = 0, skipped = 0, totalRows = 0, errors = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const symbol = path.basename(file, path.extname(file)).toUpperCase();
    if (onProgress) onProgress({ done: i, total: files.length, symbol });
    try {
      const raw = fs.readFileSync(path.join(dirPath, file));
      const content = decodeContent(raw, fmt.encoding);
      const rows = parseLines(content, fmt);
      totalRows += insertRows(db, symbol, rows);
      imported++;
    } catch (err) {
      errors.push({ file, message: err.message });
      skipped++;
    }
  }

  if (onProgress) onProgress({ done: files.length, total: files.length, symbol: null });
  return { imported, skipped, totalRows, errors, total: files.length };
}

module.exports = { importAll, importFromDir, importFromBuffers, getFormats };
