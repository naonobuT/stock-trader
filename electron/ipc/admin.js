'use strict';

const path = require('path');
const fs = require('fs');

/**
 * admin:* IPC ハンドラー
 *
 * 進捗を伴う長時間処理（import / jquants）は invoke の戻り値で結果を返しつつ、
 * 途中経過を push チャンネルで renderer へ送信する。
 *
 *   renderer が受け取るイベント:
 *     'admin:import:progress'   — { type: 'progress'|'done'|'error', ... }
 *     'admin:jquants:progress'  — { type: 'progress'|'done'|'error', ... }
 *
 * 新機能追加時は handle() を1つ追加し、preload.js の allowedInvoke に追記する。
 */

// J-Quants の停止フラグ（invoke がまたがる操作のため外部変数で管理）
let jquantsAborted = false;

function register(ipcMain, getWindow) {
  const { getDb, refreshSymbolStats } = require('../../src/db');
  const { importFromDir, importFromBuffers, getFormats } = require('../../src/importCsv');
  const { getSymbolEntry, reloadSymbols } = require('../../src/symbolNames');
  const { saveApiKeyAndTest, getAuthStatus } = require('../../src/jquantsAuth');
  const jquants = require('../../src/jquantsDownload');

  // メモリキャッシュ
  let statsCache = null;
  let statsCacheAt = 0;
  const CACHE_TTL = 10 * 60 * 1000;

  function invalidateCache() { statsCache = null; statsCacheAt = 0; }

  function push(channel, data) {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  }

  // --- 統計 ---
  ipcMain.handle('admin:stats', () => {
    const now = Date.now();
    if (statsCache && now - statsCacheAt < CACHE_TTL) return statsCache;

    const db = getDb();
    const symbolCount = db.prepare('SELECT COUNT(DISTINCT symbol) as n FROM symbol_stats').get().n;
    const rowCount    = db.prepare('SELECT SUM(row_count) as n FROM symbol_stats').get().n || 0;
    const symbols = db.prepare(
      'SELECT symbol, row_count as rows, from_date, to_date FROM symbol_stats ORDER BY symbol'
    ).all().map(s => {
      const entry = getSymbolEntry(s.symbol);
      return { ...s, name: entry?.name ?? null, oldName: entry?.oldName ?? null };
    });

    statsCache = { symbolCount, rowCount, symbols };
    statsCacheAt = now;
    return statsCache;
  });

  // --- CSVフォーマット一覧 ---
  ipcMain.handle('admin:formats', () => getFormats());

  // --- CSVインポート（フォルダパス指定）---
  // data: { folderPath, formatId }
  ipcMain.handle('admin:import', (_, { folderPath, formatId } = {}) => {
    if (!folderPath) throw new Error('フォルダパスが指定されていません');

    const result = importFromDir(
      path.resolve(folderPath),
      formatId || 'milley',
      ({ done, total, symbol }) => {
        push('admin:import:progress', { type: 'progress', done, total, symbol });
      }
    );

    if (result.error) {
      push('admin:import:progress', { type: 'error', message: result.error });
      throw new Error(result.error);
    }

    if (result.imported > 0) {
      refreshSymbolStats();
      invalidateCache();
    }

    push('admin:import:progress', { type: 'done', ...result });
    return result;
  });

  // --- symbols.csv 更新（JPX XLSXファイルパス指定）---
  // data: { filePath }
  ipcMain.handle('admin:update-symbols', (_, { filePath } = {}) => {
    if (!filePath) throw new Error('ファイルパスが指定されていません');

    let XLSX;
    try { XLSX = require('xlsx'); } catch {
      throw new Error('xlsxパッケージが見つかりません（npm install xlsx）');
    }

    const buffer = fs.readFileSync(filePath);
    const wb = XLSX.read(buffer, { type: 'buffer' });
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

    const appRoot = process.env.APP_ROOT || path.join(__dirname, '../..');
    const CSV_PATH = path.join(appRoot, 'data/symbols.csv');
    const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
    const lines = raw.split('\n');
    const stats = { updated: 0, unchanged: 0, delisted: 0, newAdded: 0 };
    const codesInCurrent = new Set();
    const newHeader = '"コード","会社名","旧会社名","市場","選択","取引市場","業種","資本金","単位株数","備考"';
    const outLines = [newHeader];

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
          outLines.push([code, jpxEntry.name, currentName, ...restFields].map(q).join(','));
          stats.updated++;
        } else {
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
    return { ...stats, total: outLines.length - 1 };
  });

  // --- 銘柄削除 ---
  // data: { symbol }
  ipcMain.handle('admin:delete-symbol', (_, { symbol } = {}) => {
    if (!symbol) throw new Error('symbol は必須です');
    const db = getDb();
    const info = db.prepare('DELETE FROM price_cache WHERE symbol = ?').run(symbol.toUpperCase());
    if (info.changes > 0) {
      db.prepare('DELETE FROM symbol_stats WHERE symbol = ?').run(symbol.toUpperCase());
      invalidateCache();
    }
    return { deleted: info.changes };
  });

  // --- J-Quants: 認証状態 ---
  ipcMain.handle('admin:jquants:status', () => getAuthStatus());

  // --- J-Quants: APIキー保存・接続テスト ---
  // data: { apiKey }
  ipcMain.handle('admin:jquants:credentials', async (_, { apiKey } = {}) => {
    if (!apiKey) throw new Error('APIキーを入力してください');
    await saveApiKeyAndTest(apiKey);
    return { success: true, status: getAuthStatus() };
  });

  // --- J-Quants: 銘柄指定ダウンロード ---
  // data: { symbols, period1, period2 }
  ipcMain.handle('admin:jquants:download', async (_, { symbols, period1, period2 } = {}) => {
    if (!symbols?.length) throw new Error('銘柄コードが指定されていません');
    if (!period1 || !period2) throw new Error('取得期間を指定してください');

    jquantsAborted = false;
    const result = await jquants.downloadSymbols(symbols, period1, period2, ({ done, total, symbol }) => {
      push('admin:jquants:progress', { type: 'progress', done, total, symbol });
    });

    if (result.totalInserted > 0) { refreshSymbolStats(); invalidateCache(); }
    push('admin:jquants:progress', { type: 'done', ...result });
    return result;
  });

  // --- J-Quants: 差分更新 ---
  // data: { period2?, plan? }
  ipcMain.handle('admin:jquants:update', async (_, { period2, plan } = {}) => {
    jquantsAborted = false;
    const result = await jquants.downloadUpdate(
      ({ done, total, symbol }) => push('admin:jquants:progress', { type: 'progress', done, total, symbol }),
      () => jquantsAborted,
      period2 || null,
      plan || null
    );
    if (!jquantsAborted) {
      if (result.totalInserted > 0) { refreshSymbolStats(); invalidateCache(); }
      push('admin:jquants:progress', { type: 'done', ...result });
    }
    return result;
  });

  // --- J-Quants: 未取込銘柄の一括取得 ---
  // data: { period1?, period2?, plan? }
  ipcMain.handle('admin:jquants:fill', async (_, { period1, period2, plan } = {}) => {
    jquantsAborted = false;
    const result = await jquants.downloadMissing(
      period1 || '2000-01-01',
      ({ done, total, symbol }) => push('admin:jquants:progress', { type: 'progress', done, total, symbol }),
      () => jquantsAborted,
      period2 || null,
      plan || null
    );
    if (!jquantsAborted) {
      if (result.totalInserted > 0) { refreshSymbolStats(); invalidateCache(); }
      push('admin:jquants:progress', { type: 'done', ...result });
    }
    return result;
  });

  // --- J-Quants: 既存銘柄のギャップ補完 ---
  // DBにある全銘柄について「最新日の翌日〜today」をJ-Quantsで補完する
  // data: { period2? }  ※ period2 省略時は今日
  ipcMain.handle('admin:jquants:gap-fill', async (_, { period2 } = {}) => {
    jquantsAborted = false;
    const db = getDb();
    const today = (period2 || new Date().toISOString().slice(0, 10));

    // 各銘柄の最新日を取得
    const rows = db.prepare(
      'SELECT symbol, to_date FROM symbol_stats ORDER BY symbol'
    ).all();

    if (!rows.length) throw new Error('DBに銘柄データがありません');

    // 補完が必要な銘柄だけ対象にする（最新日 < today）
    const targets = rows.filter(r => r.to_date && r.to_date < today);
    if (!targets.length) {
      push('admin:jquants:progress', { type: 'done', totalInserted: 0, errors: [] });
      return { totalInserted: 0, errors: [] };
    }

    let totalInserted = 0;
    const errors = [];
    const total = targets.length;
    let done = 0;

    for (const { symbol, to_date } of targets) {
      if (jquantsAborted) break;

      // 最新日の翌日から取得
      const from = new Date(to_date);
      from.setDate(from.getDate() + 1);
      const period1 = from.toISOString().slice(0, 10);

      if (period1 > today) { done++; continue; }

      push('admin:jquants:progress', { type: 'progress', done, total, symbol });
      try {
        const r = await jquants.downloadSymbols([symbol], period1, today, () => {});
        totalInserted += r.totalInserted || 0;
        if (r.errors?.length) errors.push(...r.errors);
      } catch (e) {
        errors.push({ symbol, error: e.message });
      }
      done++;
    }

    if (totalInserted > 0) { refreshSymbolStats(); invalidateCache(); }
    push('admin:jquants:progress', { type: 'done', totalInserted, errors });
    return { totalInserted, errors };
  });

  // --- J-Quants: 停止 ---
  ipcMain.handle('admin:jquants:stop', () => {
    jquantsAborted = true;
    return { ok: true };
  });
}

module.exports = { register };
