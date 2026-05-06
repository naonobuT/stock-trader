const fs = require('fs');
const path = require('path');

// code -> { name, oldName }
const symbolNames = new Map();

try {
  const csv = fs.readFileSync(path.join(__dirname, '../data/symbols.csv'), 'utf8')
    .replace(/^﻿/, ''); // BOM除去
  for (const line of csv.split('\n').slice(1)) {
    if (!line.trim()) continue;
    // "コード","会社名","旧会社名",...
    const m = line.match(/^"?([\w]+)"?,"([^"]*)","([^"]*)"/);
    if (m) {
      symbolNames.set(m[1], { name: m[2], oldName: m[3] || null });
    } else {
      // 旧会社名列がない行（フォールバック）
      const m2 = line.match(/^"?([\w]+)"?,"([^"]+)"/);
      if (m2) symbolNames.set(m2[1], { name: m2[2], oldName: null });
    }
  }
} catch (e) {
  console.warn('[symbolNames] CSV読み込み失敗:', e.message);
}

function getSymbolName(code) {
  return symbolNames.get(String(code))?.name || null;
}

function getSymbolEntry(code) {
  return symbolNames.get(String(code)) || null;
}

// "新名前（コード）旧：旧名前" 形式の表示文字列を返す
function getSymbolDisplay(code) {
  const entry = symbolNames.get(String(code));
  if (!entry) return null;
  const base = `${entry.name}（${code}）`;
  return entry.oldName ? `${base} 旧：${entry.oldName}` : base;
}

// クエリを社名（新・旧）で部分一致検索し、コード配列を返す
function searchByName(query, limit = 30) {
  const q = query.toLowerCase();
  const results = [];
  for (const [code, entry] of symbolNames) {
    if (
      entry.name.toLowerCase().includes(q) ||
      (entry.oldName && entry.oldName.toLowerCase().includes(q))
    ) {
      results.push(code);
      if (results.length >= limit) break;
    }
  }
  return results;
}

function getAllStockCodes() {
  return [...symbolNames.keys()];
}

function reloadSymbols() {
  symbolNames.clear();
  try {
    const csv = fs.readFileSync(path.join(__dirname, '../data/symbols.csv'), 'utf8')
      .replace(/^﻿/, '');
    for (const line of csv.split('\n').slice(1)) {
      if (!line.trim()) continue;
      const m = line.match(/^"?([\w]+)"?,"([^"]*)","([^"]*)"/);
      if (m) {
        symbolNames.set(m[1], { name: m[2], oldName: m[3] || null });
      } else {
        const m2 = line.match(/^"?([\w]+)"?,"([^"]+)"/);
        if (m2) symbolNames.set(m2[1], { name: m2[2], oldName: null });
      }
    }
  } catch (e) {
    console.warn('[symbolNames] reload失敗:', e.message);
  }
}

module.exports = { getSymbolName, getSymbolEntry, getSymbolDisplay, searchByName, getAllStockCodes, reloadSymbols };
