'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// レンダラーから呼べるAPIを明示的に列挙して公開する。
// チャンネル名を allowedInvoke / allowedOn に明記することで
// 「何が呼べるか」が一目でわかり、将来の追加・削除も安全に行える。

const allowedInvoke = new Set([
  // 株価データ
  'stocks:random-with-candles',
  'stocks:random',
  'stocks:candles',
  'stocks:search',
  // 管理
  'admin:stats',
  'admin:formats',
  'admin:import',
  'admin:update-symbols',
  'admin:delete-symbol',
  'admin:jquants:status',
  'admin:jquants:credentials',
  'admin:jquants:download',
  'admin:jquants:update',
  'admin:jquants:fill',
  'admin:jquants:stop',
  'admin:jquants:gap-fill',
  // ダイアログ
  'dialog:openFile',
  'dialog:openDirectory',
]);

// メイン→レンダラー への push イベントチャンネル
const allowedOn = new Set([
  'admin:import:progress',
  'admin:jquants:progress',
]);

contextBridge.exposeInMainWorld('api', {
  /**
   * メインプロセスのハンドラーを呼び出す（双方向）
   * @param {string} channel
   * @param {any} data
   * @returns {Promise<any>}
   */
  invoke(channel, data) {
    if (!allowedInvoke.has(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, data);
  },

  /**
   * メインプロセスからの push イベントを受け取る
   * @param {string} channel
   * @param {(data: any) => void} callback
   * @returns {() => void} アンサブスクライブ関数
   */
  on(channel, callback) {
    if (!allowedOn.has(channel)) {
      console.warn(`IPC push channel not allowed: ${channel}`);
      return () => {};
    }
    const listener = (_, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
