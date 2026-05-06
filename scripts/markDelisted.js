/**
 * JPXデータと照合して上場廃止銘柄の会社名に「（上場廃止）」を付与する。
 * すでに付与済みの場合はスキップ。
 * 3桁以下のコード（指数・先物）は対象外。
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const XLS_PATH = path.join(__dirname, '..', 'jpx_data.xls');
const CSV_PATH = path.join(__dirname, '..', 'data', 'symbols.csv');

// JPX上場コードをSetで保持
const wb = XLSX.readFile(XLS_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const jpxRows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1);
const jpxCodes = new Set(jpxRows.map(r => String(r[1])));

// symbols.csv 読み込み
const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
const lines = raw.split('\n');

let marked = 0;
const outLines = [lines[0]]; // ヘッダーはそのまま

for (const line of lines.slice(1)) {
  if (!line.trim()) { outLines.push(line); continue; }

  // コードと会社名だけ取り出して確認
  const codeMatch = line.match(/^"?([\w]+)"?/);
  if (!codeMatch) { outLines.push(line); continue; }

  const code = codeMatch[1].trim();

  // 4桁以上の数字コードのみ対象（3桁以下は指数・先物のため除外）
  // また市場区分が「指数」のものも除外
  const isStock = /^\d{4,}$/.test(code);
  const market = line.split(',')[3]?.replace(/"/g, '').trim() || '';
  const isIndex = market === '指数';

  if (isStock && !isIndex && !jpxCodes.has(code)) {
    // 上場廃止対象 → 会社名フィールドに「（上場廃止）」を付与（未付与の場合のみ）
    if (!line.includes('（上場廃止）')) {
      // "コード","会社名",... の2フィールド目を置換
      const updated = line.replace(
        /^("?[\w]+"?,")([^"]*)(")/,
        (_, pre, name, post) => `${pre}${name}（上場廃止）${post}`
      );
      outLines.push(updated);
      marked++;
    } else {
      outLines.push(line);
    }
  } else {
    outLines.push(line);
  }
}

fs.writeFileSync(CSV_PATH, '﻿' + outLines.join('\n'), 'utf8');
console.log(`「（上場廃止）」を付与した銘柄: ${marked} 件`);
