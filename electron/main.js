'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');

let mainWindow = null;

function setEnvPaths() {
  // DB_PATH: ユーザーデータ領域に配置（アップデートしてもデータが消えない）
  if (!process.env.DB_PATH) {
    process.env.DB_PATH = path.join(app.getPath('userData'), 'stock_trader.db');
  }

  // data/symbols.csv のルートパス
  if (app.isPackaged) {
    process.env.APP_ROOT = path.join(process.resourcesPath, 'app');
  } else {
    process.env.APP_ROOT = path.join(__dirname, '..');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: '株式投資ゲーム',
    backgroundColor: '#111827',
  });

  mainWindow.loadFile(path.join(__dirname, '../public/trade.html'));

  // 外部リンクはシステムのブラウザで開く（Electronウィンドウで開かない）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  setEnvPaths();

  // 開発中のみ：ファイル変更を検知して自動再起動
  if (!app.isPackaged) {
    require('electron-reload')(__dirname, {
      electron: process.execPath,
      awaitWriteFinish: true,
    });
  }

  // DB初期化（起動時に一度だけ）
  const { getDb, initSymbolStats } = require('../src/db');
  getDb();

  initSymbolStats();

  createWindow();

  // IPC ハンドラー登録
  require('./ipc/stocks').register(ipcMain);
  require('./ipc/admin').register(ipcMain, () => mainWindow);

  // ネイティブダイアログ
  ipcMain.handle('dialog:openFile', (_, options) =>
    dialog.showOpenDialog(mainWindow, options)
  );
  ipcMain.handle('dialog:openDirectory', (_, options) =>
    dialog.showOpenDialog(mainWindow, { ...options, properties: ['openDirectory'] })
  );
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
