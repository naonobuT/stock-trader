const { getDb } = require('./db');

const BASE_URL = 'https://api.jquants.com/v2';

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  getDb().prepare(
    'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
  ).run(key, value);
}

function getApiKey() {
  return getSetting('jquants_api_key') || process.env.JQUANTS_API_KEY || null;
}

/**
 * x-api-key ヘッダー付きで fetch
 */
async function jquantsFetch(url) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('J-QuantsのAPIキーが設定されていません（管理画面 > API設定から設定してください）');
  return fetch(url, { headers: { 'x-api-key': apiKey } });
}

/**
 * APIキーを検証してDBに保存
 * 日付に依存しない /v2/listed/info で疎通確認
 */
async function saveApiKeyAndTest(apiKey) {
  const res = await fetch(`${BASE_URL}/listed/info?code=86970`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`APIキー検証失敗 (${res.status}): ${text}`);
  }
  setSetting('jquants_api_key', apiKey);
  return { success: true };
}

/**
 * 現在の認証状態を返す
 */
function getAuthStatus() {
  const key = getSetting('jquants_api_key') || process.env.JQUANTS_API_KEY || null;
  return {
    configured: !!key,
    maskedKey: key ? key.slice(0, 4) + '...' + key.slice(-4) : null,
  };
}

module.exports = { jquantsFetch, saveApiKeyAndTest, getAuthStatus, BASE_URL };
