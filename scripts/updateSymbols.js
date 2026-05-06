/**
 * JPXの最新上場銘柄データでsymbols.csvを更新するスクリプト。
 * - JPXにある銘柄: 名前を最新に更新（変更があれば旧名を"旧会社名"列に保持）
 * - JPXにない銘柄: 上場廃止として現状維持
 * - JPXに新たにある銘柄（英数字コード等）: 新規追加
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const XLS_PATH = path.join(__dirname, '..', 'jpx_data.xls');
const CSV_PATH = path.join(__dirname, '..', 'data', 'symbols.csv');

// --- JPXデータ読み込み ---
const wb = XLSX.readFile(XLS_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const jpxRows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1);

// code(string) -> { name, market }
const jpxMap = new Map();
for (const row of jpxRows) {
  const code = String(row[1]);
  const name  = String(row[2] || '').trim();
  const market = String(row[3] || '').trim();
  jpxMap.set(code, { name, market });
}

// --- 比較用正規化（全角→半角、HD略称、中点・空白除去）---
function toHalf(str) {
  return str
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ')
    .trim();
}

function normalizeForCompare(str) {
  return toHalf(str)
    .replace(/ホールディングス/g, 'HD')
    .replace(/ホールデイングス/g, 'HD')
    .replace(/・/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

// --- CSVの1行をフィールド配列に分解 ---
function parseCSVLine(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '"') {
          if (line[j + 1] === '"') { j += 2; continue; } // escaped quote
          break;
        }
        j++;
      }
      fields.push(line.slice(i + 1, j).replace(/""/g, '"'));
      i = j + 2; // skip closing quote and comma
    } else {
      let j = line.indexOf(',', i);
      if (j === -1) j = line.length;
      fields.push(line.slice(i, j));
      i = j + 1;
    }
  }
  return fields;
}

// --- フィールドをCSV形式にシリアライズ ---
function q(val) {
  if (val === undefined || val === null) return '""';
  const s = String(val);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  // 純数字はそのまま（元のフォーマットに合わせる）
  if (/^\d+$/.test(s)) return s;
  return '"' + s + '"';
}

// --- 現在のsymbols.csv読み込み ---
const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, ''); // BOM除去
const lines = raw.split('\n');

const stats = { updated: 0, unchanged: 0, delisted: 0, newAdded: 0 };
const codesInCurrent = new Set();

// 新ヘッダー（旧会社名列を追加）
const newHeader = '"コード","会社名","旧会社名","市場","選択","取引市場","業種","資本金","単位株数","備考"';
const outLines = [newHeader];

// ヘッダーで新フォーマット（旧会社名列あり）か判定
const headerFields = parseCSVLine(lines[0] || '');
const hasOldNameCol = headerFields[2]?.replace(/"/g, '').trim() === '旧会社名';

// 既存行を処理
for (const line of lines.slice(1)) {
  if (!line.trim()) continue;

  const fields = parseCSVLine(line);
  if (fields.length < 2) continue;

  const code           = fields[0].trim();
  const currentName    = fields[1].trim();
  const currentOldName = hasOldNameCol ? (fields[2]?.trim() || '') : '';
  const restFields     = hasOldNameCol ? fields.slice(3) : fields.slice(2);

  codesInCurrent.add(code);

  const jpxEntry = jpxMap.get(code);

  if (jpxEntry) {
    const newName = jpxEntry.name;
    const nameChanged = normalizeForCompare(newName) !== normalizeForCompare(currentName);

    if (nameChanged) {
      // 名称変更あり → 新名前を会社名に、旧名前を旧会社名に
      const row = [code, newName, currentName, ...restFields];
      outLines.push(row.map(q).join(','));
      stats.updated++;
    } else {
      // 変更なし → 旧会社名が現会社名と同義なら冗長なので空欄に、それ以外は保持
      const keepOld = currentOldName && normalizeForCompare(currentOldName) !== normalizeForCompare(currentName) ? currentOldName : '';
      const row = [code, currentName, keepOld, ...restFields];
      outLines.push(row.map(q).join(','));
      stats.unchanged++;
    }
  } else {
    // JPXにない → 上場廃止
    const isStock = /^\d{4,}$|^[0-9]{3}[A-Z]/.test(code);
    const delistedName = isStock && !currentName.includes('上場廃止') ? `${currentName}（上場廃止）` : currentName;
    const row = [code, delistedName, currentOldName, ...restFields];
    outLines.push(row.map(q).join(','));
    stats.delisted++;
  }
}

// JPXにあって現在のCSVにない銘柄（新規上場）を末尾に追加
for (const [code, entry] of jpxMap) {
  if (!codesInCurrent.has(code)) {
    const row = [code, entry.name, '', entry.market, '', '', '', '', '', ''];
    outLines.push(row.map(q).join(','));
    stats.newAdded++;
  }
}

// 書き込み（BOM付きUTF-8）
fs.writeFileSync(CSV_PATH, '﻿' + outLines.join('\n'), 'utf8');

console.log('=== symbols.csv 更新完了 ===');
console.log('名称変更あり:', stats.updated);
console.log('変更なし    :', stats.unchanged);
console.log('上場廃止    :', stats.delisted, '（現状維持）');
console.log('新規追加    :', stats.newAdded);
console.log('合計行数    :', outLines.length - 1);
