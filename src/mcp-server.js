#!/usr/bin/env node
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH
  || (process.env.NODE_ENV === 'production'
    ? '/data/stock_trader.db'
    : path.join(__dirname, '..', 'stock_trader.db'));

const db = new Database(DB_PATH, { readonly: true });

// --- 指標計算 ---
function calcMA(candles, period) {
  return candles.map((c, i) => {
    if (i < period - 1) return null;
    const avg = candles.slice(i - period + 1, i + 1).reduce((s, x) => s + x.close, 0) / period;
    return { date: c.date, value: parseFloat(avg.toFixed(2)) };
  }).filter(Boolean);
}

function calcBB(candles, period = 20) {
  return candles.map((c, i) => {
    if (i < period - 1) return null;
    const slice = candles.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, x) => s + x.close, 0) / period;
    const sd = Math.sqrt(slice.reduce((s, x) => s + (x.close - mean) ** 2, 0) / period);
    return { date: c.date, upper: parseFloat((mean + 2 * sd).toFixed(2)), mid: parseFloat(mean.toFixed(2)), lower: parseFloat((mean - 2 * sd).toFixed(2)) };
  }).filter(Boolean);
}

function calcRSI(candles, period = 14) {
  if (candles.length < period + 1) return [];
  const results = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    d > 0 ? gains += d : losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  results.push({ date: candles[period].date, value: parseFloat((100 - 100 / (1 + avgGain / (avgLoss || 1e-10))).toFixed(2)) });
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    results.push({ date: candles[i].date, value: parseFloat((100 - 100 / (1 + avgGain / (avgLoss || 1e-10))).toFixed(2)) });
  }
  return results;
}

function calcMACD(candles, fast = 12, slow = 26, signal = 9) {
  if (candles.length < slow) return [];
  const ema = (data, period) => {
    const k = 2 / (period + 1);
    const result = [data[0]];
    for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i - 1] * (1 - k));
    return result;
  };
  const closes = candles.map(c => c.close);
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]).slice(slow - 1);
  const signalLine = ema(macdLine, signal);
  return macdLine.slice(signal - 1).map((v, i) => ({
    date: candles[slow + signal - 2 + i].date,
    macd: parseFloat(v.toFixed(4)),
    signal: parseFloat(signalLine[signal - 1 + i].toFixed(4)),
    hist: parseFloat((v - signalLine[signal - 1 + i]).toFixed(4)),
  }));
}

// --- MCPサーバー ---
const server = new Server(
  { name: 'stock-trader', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_trades',
      description: 'トレード履歴を取得する。ユーザーIDを指定しない場合は全ユーザー分を返す。',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'number', description: 'ユーザーID（省略時は全ユーザー）' },
          limit: { type: 'number', description: '最大取得件数（デフォルト100）' },
        },
      },
    },
    {
      name: 'get_candles',
      description: '指定銘柄の株価データ（OHLCV）を取得する。',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: '銘柄コード（例: 7203）' },
          from: { type: 'string', description: '開始日（YYYY-MM-DD）' },
          to: { type: 'string', description: '終了日（YYYY-MM-DD）' },
          limit: { type: 'number', description: '最大取得件数（デフォルト500）' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'get_indicators',
      description: '指定銘柄の株価から各種指標（MA・ボリンジャーバンド・RSI・MACD）を計算して返す。',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: '銘柄コード（例: 7203）' },
          from: { type: 'string', description: '開始日（YYYY-MM-DD）' },
          to: { type: 'string', description: '終了日（YYYY-MM-DD）' },
          ma_periods: { type: 'array', items: { type: 'number' }, description: 'MA期間リスト（例: [25, 75, 200]）' },
        },
        required: ['symbol'],
      },
    },
    {
      name: 'get_session',
      description: '現在のゲームセッション情報（銘柄・開始日・現在日・損益）を取得する。',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'number', description: 'ユーザーID（省略時は全ユーザー）' },
        },
      },
    },
    {
      name: 'get_positions',
      description: '現在保有しているポジション一覧を取得する。',
      inputSchema: {
        type: 'object',
        properties: {
          user_id: { type: 'number', description: 'ユーザーID（省略時は全ユーザー）' },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'get_trades') {
    const limit = args?.limit || 100;
    const rows = args?.user_id
      ? db.prepare('SELECT t.*, u.username FROM trades t JOIN users u ON u.id = t.user_id WHERE t.user_id = ? ORDER BY t.executed_at DESC LIMIT ?').all(args.user_id, limit)
      : db.prepare('SELECT t.*, u.username FROM trades t JOIN users u ON u.id = t.user_id ORDER BY t.executed_at DESC LIMIT ?').all(limit);
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  }

  if (name === 'get_candles') {
    const symbol = args.symbol.toUpperCase();
    let rows;
    if (args.from && args.to) {
      rows = db.prepare('SELECT date, open, high, low, close, volume FROM price_cache WHERE symbol = ? AND date >= ? AND date <= ? ORDER BY date ASC').all(symbol, args.from, args.to);
    } else {
      const limit = args.limit || 500;
      rows = db.prepare('SELECT date, open, high, low, close, volume FROM price_cache WHERE symbol = ? ORDER BY date DESC LIMIT ?').all(symbol, limit).reverse();
    }
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  }

  if (name === 'get_indicators') {
    const symbol = args.symbol.toUpperCase();
    let rows;
    if (args.from && args.to) {
      rows = db.prepare('SELECT date, open, high, low, close, volume FROM price_cache WHERE symbol = ? AND date >= ? AND date <= ? ORDER BY date ASC').all(symbol, args.from, args.to);
    } else {
      rows = db.prepare('SELECT date, open, high, low, close, volume FROM price_cache WHERE symbol = ? ORDER BY date DESC LIMIT 500').all(symbol).reverse();
    }
    const maPeriods = args.ma_periods || [25, 75, 200];
    const result = {
      symbol,
      ma: Object.fromEntries(maPeriods.map(p => [`ma${p}`, calcMA(rows, p)])),
      bb: calcBB(rows),
      rsi: calcRSI(rows),
      macd: calcMACD(rows),
    };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }

  if (name === 'get_session') {
    const sessions = args?.user_id
      ? db.prepare('SELECT gs.*, u.username, u.virtual_cash FROM game_sessions gs JOIN users u ON u.id = gs.user_id WHERE gs.user_id = ?').all(args.user_id)
      : db.prepare('SELECT gs.*, u.username, u.virtual_cash FROM game_sessions gs JOIN users u ON u.id = gs.user_id').all();
    return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] };
  }

  if (name === 'get_positions') {
    const rows = args?.user_id
      ? db.prepare('SELECT p.*, u.username FROM positions p JOIN users u ON u.id = p.user_id WHERE p.user_id = ? AND p.shares != 0').all(args.user_id)
      : db.prepare('SELECT p.*, u.username FROM positions p JOIN users u ON u.id = p.user_id WHERE p.shares != 0').all();
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
