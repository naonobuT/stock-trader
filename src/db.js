const Database = require('better-sqlite3');
const path = require('path');

// 優先順位: 環境変数 DB_PATH > Docker(/data) > ローカル(プロジェクトルート)
const DB_PATH = process.env.DB_PATH
  || (process.env.NODE_ENV === 'production'
    ? '/data/stock_trader.db'
    : path.join(__dirname, '..', 'stock_trader.db'));

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    migrateSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      virtual_cash REAL DEFAULT 10000000,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL DEFAULT 'long',
      shares INTEGER NOT NULL DEFAULT 0,
      avg_price REAL NOT NULL DEFAULT 0,
      UNIQUE(user_id, symbol, side),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      type TEXT NOT NULL,
      shares INTEGER NOT NULL,
      price REAL NOT NULL,
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pnl_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      total_value REAL NOT NULL,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS price_cache (
      symbol TEXT NOT NULL,
      date TEXT NOT NULL,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      volume INTEGER,
      PRIMARY KEY (symbol, date)
    );

    CREATE TABLE IF NOT EXISTS splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      split_date TEXT NOT NULL,
      ratio REAL NOT NULL,
      UNIQUE(symbol, split_date)
    );

    CREATE TABLE IF NOT EXISTS game_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      symbol TEXT NOT NULL,
      start_date TEXT NOT NULL,
      current_date TEXT NOT NULL,
      game_days INTEGER DEFAULT 360,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS pending_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      type TEXT NOT NULL,
      shares INTEGER NOT NULL,
      ordered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS symbol_stats (
      symbol TEXT PRIMARY KEY,
      row_count INTEGER DEFAULT 0,
      from_date TEXT,
      to_date TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_price_cache_symbol ON price_cache(symbol);
    CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);
    CREATE INDEX IF NOT EXISTS idx_trades_user_date ON trades(user_id, executed_at);
    CREATE INDEX IF NOT EXISTS idx_pnl_user ON pnl_snapshots(user_id);
    CREATE INDEX IF NOT EXISTS idx_pnl_user_value ON pnl_snapshots(user_id, total_value);
    CREATE INDEX IF NOT EXISTS idx_pending_orders_user ON pending_orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_symbol_stats_updated_at ON symbol_stats(updated_at);
  `);
}

function initSymbolStats() {
  const db = getDb();
  db.prepare('DELETE FROM symbol_stats').run();
  db.prepare(`
    INSERT INTO symbol_stats (symbol, row_count, from_date, to_date, updated_at)
    SELECT symbol, COUNT(*) as row_count, MIN(date) as from_date, MAX(date) as to_date, CURRENT_TIMESTAMP
    FROM price_cache
    GROUP BY symbol
  `).run();
}

function refreshSymbolStats(newSymbols = null) {
  const db = getDb();
  if (newSymbols && newSymbols.length > 0) {
    // 特定銘柄のみ更新（差分更新）
    const placeholders = newSymbols.map(() => '?').join(',');
    db.prepare(`DELETE FROM symbol_stats WHERE symbol IN (${placeholders})`).run(...newSymbols);
    db.prepare(`
      INSERT INTO symbol_stats (symbol, row_count, from_date, to_date, updated_at)
      SELECT symbol, COUNT(*), MIN(date), MAX(date), CURRENT_TIMESTAMP
      FROM price_cache
      WHERE symbol IN (${placeholders})
      GROUP BY symbol
    `).run(...newSymbols);
  } else {
    // 全体更新（初回またはリセット時）
    db.prepare('DELETE FROM symbol_stats').run();
    db.prepare(`
      INSERT INTO symbol_stats (symbol, row_count, from_date, to_date, updated_at)
      SELECT symbol, COUNT(*), MIN(date), MAX(date), CURRENT_TIMESTAMP
      FROM price_cache
      GROUP BY symbol
    `).run();
  }
}

// スキーママイグレーション群
function migrateSchema() {
  // trades テーブルに realized_pnl カラムを追加
  const tradeCols = db.pragma('table_info(trades)');
  if (!tradeCols.find(c => c.name === 'realized_pnl')) {
    db.exec('ALTER TABLE trades ADD COLUMN realized_pnl REAL DEFAULT 0');
  }

  const cols = db.pragma('table_info(positions)');
  if (cols.find(c => c.name === 'side')) return;

  db.exec(`
    CREATE TABLE positions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL DEFAULT 'long',
      shares INTEGER NOT NULL DEFAULT 0,
      avg_price REAL NOT NULL DEFAULT 0,
      UNIQUE(user_id, symbol, side),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    INSERT INTO positions_new (id, user_id, symbol, side, shares, avg_price)
      SELECT id, user_id, symbol,
        CASE WHEN shares < 0 THEN 'short' ELSE 'long' END,
        ABS(shares), avg_price
      FROM positions;

    DROP TABLE positions;
    ALTER TABLE positions_new RENAME TO positions;
  `);
}

module.exports = { getDb, initSymbolStats, refreshSymbolStats };
