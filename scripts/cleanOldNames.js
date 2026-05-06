/**
 * 旧会社名が新会社名の略称表記に過ぎない場合（HD↔ホールディングス、中点の有無など）
 * 旧会社名列を空欄にクリーンアップする。
 */

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, '..', 'data', 'symbols.csv');

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

function parseCSVLine(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '"') {
          if (line[j + 1] === '"') { j += 2; continue; }
          break;
        }
        j++;
      }
      fields.push(line.slice(i + 1, j).replace(/""/g, '"'));
      i = j + 2;
    } else {
      let j = line.indexOf(',', i);
      if (j === -1) j = line.length;
      fields.push(line.slice(i, j));
      i = j + 1;
    }
  }
  return fields;
}

function q(val) {
  if (val === undefined || val === null) return '""';
  const s = String(val);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  if (/^\d+$/.test(s)) return s;
  return '"' + s + '"';
}

const raw = fs.readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
const lines = raw.split('\n');
const outLines = [lines[0]];
let cleared = 0;

for (const line of lines.slice(1)) {
  if (!line.trim()) { outLines.push(line); continue; }
  const fields = parseCSVLine(line);
  if (fields.length < 3) { outLines.push(line); continue; }

  const name = fields[1].trim();
  const oldName = fields[2].trim();

  if (oldName && normalizeForCompare(name) === normalizeForCompare(oldName)) {
    fields[2] = '';
    outLines.push(fields.map(q).join(','));
    cleared++;
  } else {
    outLines.push(line);
  }
}

fs.writeFileSync(CSV_PATH, '﻿' + outLines.join('\n'), 'utf8');
console.log(`旧会社名をクリアした件数: ${cleared}`);
