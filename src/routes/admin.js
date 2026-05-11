const express = require('express');
const multer  = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb, refreshSymbolStats } = require('../db');
const { importFromDir, importFromBuffers, getFormats } = require('../importCsv');
const { getSymbolEntry, reloadSymbols } = require('../symbolNames');
const jquants = require('../jquantsDownload');
const { saveApiKeyAndTest, getAuthStatus } = require('../jquantsAuth');

const router = express.Router();

// メモリキャッシュ設定
let symbolStatsCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 10 * 60 * 1000; // 10分

function invalidateCache() {
  symbolStatsCache = null;
  cacheTimestamp = null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 50000 },
  fileFilter: (_, file, cb) => cb(null, file.originalname.toUpperCase().endsWith('.CSV')),
});

const uploadXls = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const ok = /\.(xls|xlsx)$/i.test(file.originalname);
    cb(null, ok);
  },
});

router.get('/stats', (req, res) => {
  const now = Date.now();

  // キャッシュが有効なら返す
  if (symbolStatsCache && cacheTimestamp && now - cacheTimestamp < CACHE_TTL) {
    return res.json(symbolStatsCache);
  }

  // キャッシュ再計算
  const db = getDb();
  const symbolCount = db.prepare('SELECT COUNT(DISTINCT symbol) as n FROM symbol_stats').get().n;
  const rowCount    = db.prepare('SELECT SUM(row_count) as n FROM symbol_stats').get().n || 0;
  const symbols = db.prepare(
    'SELECT symbol, row_count as rows, from_date, to_date FROM symbol_stats ORDER BY symbol'
  ).all().map(s => {
    const entry = getSymbolEntry(s.symbol);
    return { ...s, name: entry?.name || null, oldName: entry?.oldName || null };
  });

  symbolStatsCache = { symbolCount, rowCount, symbols };
  cacheTimestamp = now;
  res.json(symbolStatsCache);
});

router.get('/formats', (req, res) => {
  res.json(getFormats());
});

// ファイルアップロードによるインポート（SSEで進捗配信）
router.post('/import', upload.array('files'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'CSVファイルが選択されていません' });
  }
  const formatId = req.body.format || 'milley';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const result = importFromBuffers(req.files, formatId, ({ done, total, symbol }) => {
    send({ type: 'progress', done, total, symbol });
  });

  // インポート完了後、キャッシュを無効化・更新
  if (result.imported > 0) {
    refreshSymbolStats();
    invalidateCache();
  }

  send({ type: 'done', ...result });
  res.end();
});

// サーバー側フォルダパスによるインポート
router.post('/import-dir', (req, res) => {
  const { dir, format } = req.body;
  if (!dir) return res.status(400).json({ error: 'dir は必須です' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const result = importFromDir(path.resolve(dir), format || 'milley', ({ done, total, symbol }) => {
    send({ type: 'progress', done, total, symbol });
  });

  if (result.error) send({ type: 'error', message: result.error });
  else {
    // インポート完了後、キャッシュを無効化・更新
    if (result.imported > 0) {
      refreshSymbolStats();
      invalidateCache();
    }
    send({ type: 'done', ...result });
  }
  res.end();
});

// 銘柄リスト（symbols.csv）をJPX XLSで更新
router.post('/update-symbols', uploadXls.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'XLS/XLSXファイルを選択してください' });

  let XLSX;
  try { XLSX = require('xlsx'); } catch {
    return res.status(500).json({ error: 'xlsxパッケージが見つかりません（npm install xlsx）' });
  }

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const jpxRows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1);

    const jpxMap = new Map();
    for (const row of jpxRows) {
      const code = String(row[1] ?? '').trim();
      const name = String(row[2] ?? '').trim();
      const market = String(row[3] ?? '').trim();
      if (code) jpxMap.set(code, { name, market });
    }

    function toHalf(str) {
      return str.replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ').trim();
    }
    function normalize(str) {
      return toHalf(str).replace(/ホールディングス/g, 'HD').replace(/ホールデイングス/g, 'HD').replace(/・/g, '').replace(/\s+/g, '').toUpperCase();
    }
    function parseCSVLine(line) {
      const fields = []; let i = 0;
      while (i <= line.length) {
        if (line[i] === '"') {
          let j = i + 1;
          while (j < line.length) { if (line[j] === '"') { if (line[j+1] === '"') { j+=2; continue; } break; } j++; }
          fields.push(line.slice(i+1, j).replace(/""/g, '"')); i = j + 2;
        } else {
          let j = line.indexOf(',', i); if (j === -1) j = line.length;
          fields.push(line.slice(i, j)); i = j + 1;
        }
      }
      return fields;
    }
    function q(val) {
      const s = String(val ?? '');
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      if (/^\d+$/.test(s)) return s;
      return '"' + s + '"';
    }

    const CSV_PATH = path.join(__dirname, '../../data/symbols.csv');
    const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
    const lines = raw.split('\n');
    const stats = { updated: 0, unchanged: 0, delisted: 0, newAdded: 0 };
    const codesInCurrent = new Set();
    const newHeader = '"コード","会社名","旧会社名","市場","選択","取引市場","業種","資本金","単位株数","備考"';
    const outLines = [newHeader];

    // ヘッダーで新フォーマット（旧会社名列あり）か判定
    const headerFields = parseCSVLine(lines[0] || '');
    const hasOldNameCol = headerFields[2]?.replace(/"/g, '').trim() === '旧会社名';

    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const fields = parseCSVLine(line);
      if (fields.length < 2) continue;
      const code = fields[0].trim();
      const currentName = fields[1].trim();
      const currentOldName = hasOldNameCol ? (fields[2]?.trim() || '') : '';
      const restFields = hasOldNameCol ? fields.slice(3) : fields.slice(2);
      codesInCurrent.add(code);

      const jpxEntry = jpxMap.get(code);
      if (jpxEntry) {
        const nameChanged = normalize(jpxEntry.name) !== normalize(currentName);
        if (nameChanged) {
          // 名称変更：新名を会社名に、旧名を旧会社名に（既存の旧会社名は上書き）
          outLines.push([code, jpxEntry.name, currentName, ...restFields].map(q).join(','));
          stats.updated++;
        } else {
          // 変更なし：旧会社名が現会社名と同義なら冗長なので空欄に、それ以外は保持
          const keepOld = currentOldName && normalize(currentOldName) !== normalize(currentName) ? currentOldName : '';
          outLines.push([code, currentName, keepOld, ...restFields].map(q).join(','));
          stats.unchanged++;
        }
      } else {
        const isStock = /^\d{4,}$|^[0-9]{3}[A-Z]/.test(code);
        const delistedName = isStock && !currentName.includes('上場廃止') ? `${currentName}（上場廃止）` : currentName;
        outLines.push([code, delistedName, currentOldName, ...restFields].map(q).join(','));
        stats.delisted++;
      }
    }

    for (const [code, entry] of jpxMap) {
      if (!codesInCurrent.has(code)) {
        outLines.push([code, entry.name, '', entry.market, '', '', '', '', '', ''].map(q).join(','));
        stats.newAdded++;
      }
    }

    fs.writeFileSync(CSV_PATH, '﻿' + outLines.join('\n'), 'utf8');
    reloadSymbols();

    res.json({ ...stats, total: outLines.length - 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/symbol/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const db = getDb();
  const info = db.prepare('DELETE FROM price_cache WHERE symbol = ?').run(symbol);
  if (info.changes > 0) {
    db.prepare('DELETE FROM symbol_stats WHERE symbol = ?').run(symbol);
    invalidateCache();
  }
  res.json({ deleted: info.changes });
});

// J-Quants: 認証状態
router.get('/jquants/status', (req, res) => {
  res.json(getAuthStatus());
});

// J-Quants: APIキー保存・接続テスト
router.post('/jquants/credentials', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'APIキーを入力してください' });
  try {
    await saveApiKeyAndTest(apiKey);
    res.json({ success: true, status: getAuthStatus() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// J-Quants: 銘柄指定ダウンロード（SSE）
router.post('/jquants/download', async (req, res) => {
  const { symbols, period1, period2 } = req.body;
  if (!symbols || !symbols.length) return res.status(400).json({ error: '銘柄コードが指定されていません' });
  if (!period1 || !period2)        return res.status(400).json({ error: '取得期間を指定してください' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const result = await jquants.downloadSymbols(symbols, period1, period2, ({ done, total, symbol }) => {
      send({ type: 'progress', done, total, symbol });
    });
    if (result.totalInserted > 0) { refreshSymbolStats(); invalidateCache(); }
    send({ type: 'done', ...result });
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
});

// J-Quants: 既存銘柄の差分更新（SSE）
router.post('/jquants/update', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  let aborted = false;
  res.on('close', () => { aborted = true; });

  try {
    const result = await jquants.downloadUpdate(
      ({ done, total, symbol }) => send({ type: 'progress', done, total, symbol }),
      () => aborted
    );
    if (!aborted) {
      if (result.totalInserted > 0) { refreshSymbolStats(); invalidateCache(); }
      send({ type: 'done', ...result });
    }
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
});

// J-Quants: 未取込銘柄の一括取得（SSE）
router.post('/jquants/fill', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  let aborted = false;
  res.on('close', () => { aborted = true; });

  try {
    const result = await jquants.downloadMissing(
      '2000-01-01',
      ({ done, total, symbol }) => send({ type: 'progress', done, total, symbol }),
      () => aborted
    );
    if (!aborted) {
      if (result.totalInserted > 0) { refreshSymbolStats(); invalidateCache(); }
      send({ type: 'done', ...result });
    }
  } catch (err) {
    send({ type: 'error', message: err.message });
  }
  res.end();
});

module.exports = router;
