// --- State ---
let currentSymbol = null;
let gameActive = false;
let ma1 = 25, ma2 = 75, ma3 = 200;
let lwChart = null, candleSeries = null, ma1Series = null, ma2Series = null, ma3Series = null;
let tradeMarkersPlugin = null;

// ===== 3ラウンドモード状態 =====
let roundMode        = false;
let currentRound     = 0;
let currentSessionId = null;
let roundSessionSymbol  = null;
let roundSessionStartIdx = null;
let roundSessionCandles  = null;
let roundSessionName    = null;
let roundComplete       = false; // 現ラウンド終了待ち

/** round/sessionId を自動付与してトレードを記録 */
function tradePush(obj) {
  guest.trades.push({ ...obj, round: currentRound || 0, sessionId: currentSessionId || null });
}
let volChart = null, volSeries = null;
let pnlChart = null, pnlChartLarge = null;
let comparisonChart = null, comparisonChartLarge = null;
let compFinalValues = [0, 0, 0];
const COMP_COLORS = [
  { border: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  { border: '#60a5fa', bg: 'rgba(96,165,250,0.08)' },
  { border: '#a78bfa', bg: 'rgba(167,139,250,0.08)' },
];
let currentCandles = [];
let currentTimeframe = 'daily'; // 'daily' | 'weekly' | 'monthly'
let syncingRange = false;
let blindMode = false;
let blindDayCount = 0;
let blindActualSymbol = '';
let blindActualDate = '';
let _blindModeBeforeRound = false; // 3Rモード開始前のブラインド状態を保存
let pnlFinalValue = 0;
let autoAdvanceTimer = null;
let autoAdvanceGen = 0;
let isChangingStock = false;
let userZoomSet = false;

const indicatorState = {
  rsi:  { avgGain: 0, avgLoss: 0 },
  macd: { emaFast: 0, emaSlow: 0, emaSignal: 0, initialized: false },
};

// --- Indicator series ---
let bbUpperSeries = null, bbMidSeries = null, bbLowerSeries = null;
let bbUpper3Series = null, bbLower3Series = null;
let rsiChartInst = null, rsiSeries = null;
let macdChartInst = null, macdLineSeries = null, macdSignalSeries = null, macdHistSeries = null;

const INITIAL_CASH = 10000000;

const compSims = {
  percent: { cash: INITIAL_CASH, longPos: {}, shortPos: {}, cumulativeRealizedPnl: 0, cumulativeHoldDays: 0, openDates: {}, pnlData: [] },
  shares:  { cash: INITIAL_CASH, longPos: {}, shortPos: {}, cumulativeRealizedPnl: 0, cumulativeHoldDays: 0, openDates: {}, pnlData: [] },
};

const DEFAULT_COLORS = {
  upCandle: '#ef4444', downCandle: '#3b82f6',
  ma1: '#fbbf24', ma2: '#34d399', ma3: '#a78bfa',
  volUp: '#7f1d1d', volDown: '#1e3a5f',
  bbBand: '#e879f9', bbMid: '#a855f7', bb3Band: '#f472b6',
  rsiLine: '#38bdf8',
  macdLine: '#818cf8', signalLine: '#fb923c',
};
let chartColors = { ...DEFAULT_COLORS };

const DEFAULT_INDICATORS = { showBB: false, showBB3: false, showRSI: false, showMACD: false };
let indicatorSettings = { ...DEFAULT_INDICATORS };

const colorInputIds = ['colorUpCandle', 'colorDownCandle', 'colorMa1', 'colorMa2', 'colorMa3', 'colorVolUp', 'colorVolDown', 'colorBBBand', 'colorBBMid', 'colorBBBand3', 'colorRSILine', 'colorMACDLine', 'colorSignalLine'];
const colorKeys     = ['upCandle',      'downCandle',      'ma1',      'ma2',      'ma3',      'volUp',      'volDown',      'bbBand',      'bbMid',      'bb3Band',     'rsiLine',      'macdLine',      'signalLine'];

function syncSettingsInputs() {
  colorInputIds.forEach((id, i) => {
    const el = document.getElementById(id);
    if (el) el.value = chartColors[colorKeys[i]];
  });
  document.getElementById('showBB').checked   = indicatorSettings.showBB;
  document.getElementById('showBB3').checked  = indicatorSettings.showBB3;
  document.getElementById('showRSI').checked  = indicatorSettings.showRSI;
  document.getElementById('showMACD').checked = indicatorSettings.showMACD;
  // 表示本数
  const elD = document.getElementById('defaultBarsInput');
  const elW = document.getElementById('defaultBarsWeeklyInput');
  const elM = document.getElementById('defaultBarsMonthlyInput');
  if (elD) elD.value = defaultBars;
  if (elW) elW.value = defaultBarsWeekly;
  if (elM) elM.value = defaultBarsMonthly;
}

function loadChartColors() {
  try {
    const saved = localStorage.getItem('chartColors');
    if (saved) chartColors = { ...DEFAULT_COLORS, ...JSON.parse(saved) };
  } catch (_) {}
}

function saveChartColors() {
  localStorage.setItem('chartColors', JSON.stringify(chartColors));
}

function loadIndicatorSettings() {
  try {
    const saved = localStorage.getItem('indicatorSettings');
    if (saved) indicatorSettings = { ...DEFAULT_INDICATORS, ...JSON.parse(saved) };
  } catch (_) {}
}

function saveIndicatorSettings() {
  localStorage.setItem('indicatorSettings', JSON.stringify(indicatorSettings));
}

const DEFAULT_SHORTCUTS = { buy: '', short: '', close: '', changeSymbol: '' };
let keyboardShortcuts = { ...DEFAULT_SHORTCUTS };

function loadKeyboardShortcuts() {
  try {
    const saved = localStorage.getItem('keyboardShortcuts');
    if (saved) keyboardShortcuts = { ...DEFAULT_SHORTCUTS, ...JSON.parse(saved) };
  } catch (_) {}
}

function saveKeyboardShortcuts() {
  localStorage.setItem('keyboardShortcuts', JSON.stringify(keyboardShortcuts));
}

let defaultBars        = 120;
let defaultBarsWeekly  = 60;
let defaultBarsMonthly = 24;

function loadDefaultBars() {
  const saved = localStorage.getItem('defaultBars');
  if (saved) defaultBars = Math.max(10, Math.min(1000, parseInt(saved)));
  const savedW = localStorage.getItem('defaultBarsWeekly');
  if (savedW) defaultBarsWeekly = Math.max(10, Math.min(500, parseInt(savedW)));
  const savedM = localStorage.getItem('defaultBarsMonthly');
  if (savedM) defaultBarsMonthly = Math.max(6, Math.min(200, parseInt(savedM)));

  const el  = document.getElementById('defaultBarsInput');
  const elW = document.getElementById('defaultBarsWeeklyInput');
  const elM = document.getElementById('defaultBarsMonthlyInput');
  if (el)  el.value  = defaultBars;
  if (elW) elW.value = defaultBarsWeekly;
  if (elM) elM.value = defaultBarsMonthly;
}

function saveDefaultBars(val) {
  defaultBars = Math.max(10, Math.min(1000, parseInt(val)));
  localStorage.setItem('defaultBars', defaultBars);
}

function saveDefaultBarsWeekly(val) {
  defaultBarsWeekly = Math.max(10, Math.min(500, parseInt(val)));
  localStorage.setItem('defaultBarsWeekly', defaultBarsWeekly);
}

function saveDefaultBarsMonthly(val) {
  defaultBarsMonthly = Math.max(6, Math.min(200, parseInt(val)));
  localStorage.setItem('defaultBarsMonthly', defaultBarsMonthly);
}

/** 現在の時間足に対応する defaultBars を返す */
function getDefaultBars() {
  if (currentTimeframe === 'weekly')  return defaultBarsWeekly;
  if (currentTimeframe === 'monthly') return defaultBarsMonthly;
  return defaultBars;
}

/** 現在のタイムフレームの defaultBars を即座にチャートへ適用する */
function applyDefaultBarsNow() {
  if (!currentCandles.length) return;
  const bars = getDefaultBars();
  const slider = document.getElementById('rangeSlider');
  slider.max = Math.max(bars, currentCandles.length);
  slider.value = bars;
  document.getElementById('rangeLabel').textContent = `${bars}本表示`;
  applySliderToChart(bars);
}

function eventToKeyString(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  parts.push(key);
  return parts.join('+');
}

function renderShortcutDisplays() {
  for (const action of ['buy', 'short', 'close', 'changeSymbol']) {
    const el = document.getElementById(`keyDisplay-${action}`);
    if (el) el.textContent = keyboardShortcuts[action] || '';
  }
}

function setupShortcutUI() {
  let recording = null;

  function startRecording(action) {
    recording = action;
    const el = document.getElementById(`keyDisplay-${action}`);
    el.textContent = 'キーを押してください…';
    el.classList.add('recording');
  }

  function stopRecording() {
    if (!recording) return;
    const el = document.getElementById(`keyDisplay-${recording}`);
    el.classList.remove('recording');
    el.textContent = keyboardShortcuts[recording] || '';
    recording = null;
  }

  document.querySelectorAll('.shortcut-record-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (recording === action) { stopRecording(); return; }
      if (recording) stopRecording();
      startRecording(action);
    });
  });

  document.querySelectorAll('.shortcut-clear-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (recording === action) stopRecording();
      keyboardShortcuts[action] = '';
      saveKeyboardShortcuts();
      renderShortcutDisplays();
    });
  });

  document.addEventListener('keydown', e => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { stopRecording(); return; }
    const keyStr = eventToKeyString(e);
    keyboardShortcuts[recording] = keyStr;
    saveKeyboardShortcuts();
    stopRecording();
    renderShortcutDisplays();
  }, true);
}

function applyChartColors() {
  if (candleSeries) {
    candleSeries.applyOptions({
      upColor: chartColors.upCandle, downColor: chartColors.downCandle,
      borderUpColor: chartColors.upCandle, borderDownColor: chartColors.downCandle,
      wickUpColor: chartColors.upCandle, wickDownColor: chartColors.downCandle,
    });
  }
  if (ma1Series) ma1Series.applyOptions({ color: chartColors.ma1 });
  if (ma2Series) ma2Series.applyOptions({ color: chartColors.ma2 });
  if (ma3Series) ma3Series.applyOptions({ color: chartColors.ma3 });
  document.getElementById('ma1Label').style.color = chartColors.ma1;
  document.getElementById('ma2Label').style.color = chartColors.ma2;
  document.getElementById('ma3Label').style.color = chartColors.ma3;
  if (volSeries && currentCandles.length) {
    volSeries.setData(currentCandles.map(c => ({
      time: c.time,
      value: c.volume || 0,
      color: c.close >= c.open ? chartColors.volUp : chartColors.volDown,
    })));
  }
  if (bbUpperSeries) bbUpperSeries.applyOptions({ color: chartColors.bbBand });
  if (bbMidSeries)   bbMidSeries.applyOptions({ color: chartColors.bbMid });
  if (bbLowerSeries) bbLowerSeries.applyOptions({ color: chartColors.bbBand });
  if (bbUpper3Series) bbUpper3Series.applyOptions({ color: chartColors.bb3Band });
  if (bbLower3Series) bbLower3Series.applyOptions({ color: chartColors.bb3Band });
  if (rsiSeries)     rsiSeries.applyOptions({ color: chartColors.rsiLine });
  if (macdLineSeries)   macdLineSeries.applyOptions({ color: chartColors.macdLine });
  if (macdSignalSeries) macdSignalSeries.applyOptions({ color: chartColors.signalLine });
}

// --- Formatting ---
const fmt = n => Math.round(n).toLocaleString('ja-JP');
const fmtPct = n => (n >= 0 ? '+' : '') + parseFloat(n).toFixed(1) + '%';

// --- Persistence ---
function saveState() {
  try {
    localStorage.setItem('traderPersist', JSON.stringify({ cash: guest.cash, trades: guest.trades }));
  } catch {}
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem('traderPersist'));
    if (saved && typeof saved.cash === 'number' && Array.isArray(saved.trades)) {
      guest.cash = saved.cash;
      guest.trades = saved.trades;
    }
  } catch {}
}

function resetTradeHistory() {
  if (!confirm('トレード結果をすべてリセットします。資金を1,000万円に戻し、損益グラフをクリアします。よろしいですか？')) return;
  localStorage.removeItem('traderPersist');
  guest.cash = INITIAL_CASH;
  guest.trades = [];
  guest.longPos = {};
  guest.shortPos = {};
  guest.pendingOrders = [];
  guest.pnl = [{ date: guest.current_date || new Date().toISOString().slice(0, 10), value: INITIAL_CASH }];
  for (const sim of Object.values(compSims)) {
    sim.cash = INITIAL_CASH;
    sim.longPos = {};
    sim.shortPos = {};
    sim.cumulativeRealizedPnl = 0;
    sim.cumulativeHoldDays = 0;
    sim.openDates = {};
    sim.pnlData = [];
  }
  refreshState();
  renderPnl();
  renderComparisonChart();
}

// --- Init ---
async function init() {
  loadChartColors();
  loadIndicatorSettings();
  loadKeyboardShortcuts();
  loadDefaultBars();
  loadState();
  setupEvents();

  try { setupChart(); } catch (e) { console.error('Chart init failed:', e); }
  applyChartColors();
  setupChartResizer();

  if (guest.trades.length > 0) renderPnl();

  // ソフトリロード後に3Rセッションが残っていれば UI を復元
  if (restoreRoundSession()) {
    updateRoundUI();
  }

  _startPrefetch();
  showStartModal();
}

// --- Modal ---
let _prefetchPromise = null;
let _prefetchedStock = null;

async function _prefetchRandomStock() {
  try {
    return await window.api.invoke('stocks:random-with-candles');
  } catch {
    return null;
  }
}

function _startPrefetch() {
  _prefetchedStock = null;
  _prefetchPromise = _prefetchRandomStock().then(result => { _prefetchedStock = result; });
}

function showStartModal() {
  document.getElementById('startModal').classList.remove('hidden');
  if (!_prefetchedStock && !_prefetchPromise) _startPrefetch();

  const btn = document.getElementById('startGameBtn');
  const noDataMsg = document.getElementById('startNoDataMsg');

  (_prefetchPromise || Promise.resolve()).then(() => {
    const hasData = !!_prefetchedStock;
    btn.style.display = hasData ? '' : 'none';
    noDataMsg.style.display = hasData ? 'none' : '';
  });

  document.getElementById('startGoSettings').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('startModal').classList.add('hidden');
    switchView('settings');
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelector('.settings-tab[data-tab="data"]').classList.add('active');
    document.getElementById('tabData').classList.remove('hidden');
  }, { once: true });
}

// --- Start game ---
async function startGame() {
  const msgEl = document.getElementById('startMsg');
  msgEl.textContent = '銘柄を選択中...';
  msgEl.className = 'msg';

  if (!_prefetchedStock && _prefetchPromise) await _prefetchPromise;

  let symbol, name, oldName, prefetchedCandles;
  if (_prefetchedStock) {
    ({ symbol, name, oldName, candles: prefetchedCandles } = _prefetchedStock);
    _prefetchedStock = null;
  } else {
    try {
      ({ symbol, name, oldName } = await window.api.invoke('stocks:random'));
    } catch { msgEl.textContent = 'データ取得失敗'; msgEl.className = 'msg error'; return; }
    prefetchedCandles = null;
  }

  const ok = await applyNewStock(symbol, msgEl, prefetchedCandles, name, oldName);
  if (!ok) return;

  document.getElementById('startModal').classList.add('hidden');
  _startPrefetch();
}

async function changeToSymbol(symbol, name = null, oldName = null) {
  if (isChangingStock) return;
  isChangingStock = true;
  const btn = document.getElementById('newGameBtn');
  btn.textContent = '読込中...';
  btn.disabled = true;
  try {
    const candles = await window.api.invoke('stocks:candles', { symbol, limit: 1000 });
    await applyNewStock(symbol, null, candles, name, oldName);
  } finally {
    isChangingStock = false;
    btn.textContent = '🎲 銘柄変更[N]';
    btn.disabled = false;
  }
}

async function changeStock() {
  if (isChangingStock) return;
  isChangingStock = true;
  const btn = document.getElementById('newGameBtn');
  btn.textContent = '読込中...';
  btn.disabled = true;

  try {
    if (!_prefetchedStock && _prefetchPromise) await _prefetchPromise;
    let symbol, name, oldName, candles;
    if (_prefetchedStock) {
      ({ symbol, name, oldName, candles } = _prefetchedStock);
      _prefetchedStock = null;
    } else {
      ({ symbol, name, oldName, candles } = await window.api.invoke('stocks:random-with-candles'));
    }
    await applyNewStock(symbol, null, candles, name, oldName);
    _startPrefetch();
  } finally {
    isChangingStock = false;
    btn.textContent = '🎲 銘柄変更[N]';
    btn.disabled = false;
  }
}

// ===== 3ラウンドセッションの永続化（ソフトリロード対策） =====
// ローソク足配列は大きいので保存せず、シンボル・名前・開始Idxのみ保存する
function saveRoundSession() {
  if (!roundMode) return;
  try {
    sessionStorage.setItem('roundSession', JSON.stringify({
      roundMode, currentRound, currentSessionId, roundComplete,
      roundSessionSymbol, roundSessionName, roundSessionStartIdx,
    }));
  } catch (_) {}
}

function restoreRoundSession() {
  try {
    const raw = sessionStorage.getItem('roundSession');
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (!s.roundMode || !s.roundSessionSymbol) return false;
    roundMode            = s.roundMode;
    currentRound         = s.currentRound;
    currentSessionId     = s.currentSessionId;
    roundComplete        = s.roundComplete;
    roundSessionSymbol   = s.roundSessionSymbol;
    roundSessionName     = s.roundSessionName;
    roundSessionStartIdx = s.roundSessionStartIdx;
    // roundSessionCandles はここでは復元しない（nextRound で IPC 再フェッチ）
    console.log('[restoreRoundSession] restored:', roundSessionSymbol, 'round:', currentRound);
    return true;
  } catch (_) { return false; }
}

function clearRoundSession() {
  try { sessionStorage.removeItem('roundSession'); } catch (_) {}
}

// ===== 3ラウンドモード関数 =====
async function startRoundMode() {
  if (isChangingStock) return;
  roundMode        = true;
  currentRound     = 1;
  currentSessionId = Date.now().toString();
  roundComplete    = false;
  // 銘柄名・日付を隠すためブラインドモードを強制ON（元の状態を保存）
  _blindModeBeforeRound = blindMode;
  if (!blindMode) setBlindMode(true);
  // 現銘柄を使う場合は下記をコメントアウトして changeStock() を呼ぶ
  // 新しいランダム銘柄でスタート
  isChangingStock = true;
  try {
    let symbol, name, oldName, candles;
    try {
      ({ symbol, name, oldName, candles } = await window.api.invoke('stocks:random-with-candles'));
    } catch (err) {
      console.error('[startRoundMode] IPC failed:', err);
      alert(`銘柄データの取得に失敗しました: ${err.message ?? err}\nデータ管理からCSVをインポートしてください。`);
      roundMode = false; clearRoundSession(); return;
    }
    roundSessionSymbol  = symbol;
    roundSessionName    = name;
    roundSessionCandles = candles;
    guest.cash = INITIAL_CASH;
    await applyNewStock(symbol, null, candles, name, oldName);
    roundSessionStartIdx = guest.start_idx;
    saveRoundSession();
    console.log('[startRoundMode] session set:', symbol, 'candles:', candles?.length, 'startIdx:', roundSessionStartIdx);
  } finally {
    isChangingStock = false;
  }
  switchView('candle');
  updateRoundUI();
}

/** 現ラウンドを手動終了してラウンド完了状態にする */
function finishCurrentRound() {
  if (!roundMode || roundComplete) return;
  stopAutoAdvance();
  roundComplete = true;
  saveRoundSession();
  updateRoundUI();
}

async function nextRound() {
  if (!roundMode || currentRound >= 3) return;
  // セッションデータが揃っているか確認（ソフトリロード後の復元を試みる）
  if (!roundSessionSymbol) {
    console.warn('[nextRound] symbol missing, trying sessionStorage restore...');
    if (!restoreRoundSession() || !roundSessionSymbol) {
      alert('ラウンドセッションデータが見つかりません。3Rモードを再起動してください。');
      endRoundMode();
      return;
    }
  }
  // ローソク足がない場合（ソフトリロード後など）は IPC で再フェッチ
  if (!roundSessionCandles) {
    console.warn('[nextRound] candles missing, re-fetching from IPC...');
    try {
      roundSessionCandles = await window.api.invoke('stocks:candles', { symbol: roundSessionSymbol, limit: 1000 });
    } catch (err) {
      alert(`ローソク足データの再取得に失敗しました: ${err.message ?? err}`);
      endRoundMode();
      return;
    }
  }
  currentRound++;
  roundComplete = false;
  // 同一銘柄・同一開始インデックスでリプレイ
  guest.cash = INITIAL_CASH;
  isChangingStock = true;
  try {
    await applyNewStock(roundSessionSymbol, null, roundSessionCandles, roundSessionName, null, roundSessionStartIdx);
  } catch (err) {
    console.error('[nextRound] applyNewStock failed:', err);
    alert(`ラウンド${currentRound}の開始に失敗しました: ${err.message ?? err}`);
    endRoundMode();
    return;
  } finally {
    isChangingStock = false;
  }
  switchView('candle');
  updateRoundUI();
}

function endRoundMode() {
  roundMode        = false;
  currentRound     = 0;
  currentSessionId = null;
  roundComplete    = false;
  roundSessionSymbol  = null;
  roundSessionStartIdx = null;
  roundSessionCandles  = null;
  roundSessionName    = null;
  clearRoundSession();
  // ラウンド比較チャートを破棄（通常モードのチャートで再作成させる）
  if (pnlChart?._roundMode)      { pnlChart.destroy();      pnlChart      = null; }
  if (pnlChartLarge?._roundMode) { pnlChartLarge.destroy(); pnlChartLarge = null; }
  // ブラインドモードを3Rモード開始前の状態に戻す
  if (blindMode !== _blindModeBeforeRound) setBlindMode(_blindModeBeforeRound);
  updateRoundUI();
}

function updateRoundUI() {
  const indicator   = document.getElementById('roundIndicator');
  const nextBtn     = document.getElementById('nextRoundBtn');
  const finishBtn   = document.getElementById('finishRoundBtn');
  const modeBtn     = document.getElementById('roundModeBtn');
  if (roundMode) {
    indicator.style.display = '';
    document.getElementById('roundNumDisplay').textContent = currentRound;
    const isDone = roundComplete && currentRound >= 3;
    // ラウンド完了前は「ラウンド終了」ボタンを表示、完了後は「次へ / 分析」ボタンを表示
    finishBtn.style.display = roundComplete ? 'none' : '';
    nextBtn.style.display   = roundComplete ? '' : 'none';
    nextBtn.textContent     = isDone ? '📊 分析を見る' : `ラウンド${currentRound + 1}へ →`;
    modeBtn.style.display = 'none';
    document.getElementById('newGameBtn').style.display = 'none';
  } else {
    indicator.style.display = 'none';
    nextBtn.style.display   = 'none';  // 念のため明示的に隠す
    finishBtn.style.display = 'none';
    modeBtn.style.display   = '';
    document.getElementById('newGameBtn').style.display = '';
  }
}

// Guest local state (in-memory)
const guest = {
  cash: INITIAL_CASH,
  longPos: {},
  shortPos: {},
  trades: [],
  pendingOrders: [],
  pnl: [],
  symbol: null,
  start_date: null,
  current_date: null,
  elapsed: 0,
  all_dates: [],
  current_idx: 0,
};

async function applyNewStock(symbol, errEl, prefetchedCandles = null, symbolName = null, symbolOldName = null, forcedStartIdx = null) {
  const err = (msg) => { if (errEl) { errEl.textContent = msg; errEl.className = 'msg error'; } };

  let allData = prefetchedCandles;
  if (!allData) {
    if (errEl) { errEl.textContent = 'データ読み込み中...'; errEl.className = 'msg'; }
    try {
      allData = await window.api.invoke('stocks:candles', { symbol, limit: 1000 });
    } catch { err('銘柄が見つかりません'); return false; }
  }
  if (allData.length < 10) { err('データが不足しています'); return false; }

  const minHistory = 200;
  const minRemaining = 100;
  const maxStart = Math.max(minHistory, allData.length - minRemaining - 1);
  const startIdx = forcedStartIdx ?? (minHistory + Math.floor(Math.random() * Math.max(1, maxStart - minHistory + 1)));
  guest.all_dates = allData;
  guest.start_idx = startIdx;
  guest.start_date = allData[startIdx].date;
  guest.current_date = allData[startIdx].date;
  guest.current_idx = startIdx;
  guest.elapsed = 0;
  guest.symbol = symbol;
  guest.longPos = {};
  guest.shortPos = {};
  guest.pendingOrders = [];
  guest.pnl = [{ date: guest.start_date, value: guest.cash }];
  for (const sim of Object.values(compSims)) {
    sim.cash = INITIAL_CASH;
    sim.longPos = {};
    sim.shortPos = {};
    sim.cumulativeRealizedPnl = 0;
    sim.cumulativeHoldDays = 0;
    sim.openDates = {};
    sim.pnlData = [];
  }
  if (comparisonChart) { comparisonChart.destroy(); comparisonChart = null; }
  if (errEl) errEl.textContent = '';

  stopAutoAdvance();
  currentSymbol = symbol;
  gameActive = true;
  // 銘柄切替時は時間足を日足にリセット・ズームもリセット
  currentTimeframe = 'daily';
  userZoomSet = false;
  document.querySelectorAll('.tf-tab').forEach(b => b.classList.toggle('active', b.dataset.tf === 'daily'));
  document.getElementById('nextDayBtn').disabled = false;
  document.getElementById('autoAdvanceBtn').disabled = false;
  const displayName = symbolName
    ? (symbolOldName ? `${symbolName}（${symbol}）旧：${symbolOldName}` : `${symbolName}（${symbol}）`)
    : symbol;
  blindActualSymbol = displayName;
  blindDayCount = 0;
  document.getElementById('currentSymbol').textContent = blindMode ? '???' : displayName;
  updateOrderTabs(false, false);
  updatePendingDisplay([]);

  await refreshChart();
  refreshState();
  renderPnl();
  updateComparisonVisibility();
  return true;
}

// --- Auto advance ---
function stopAutoAdvance() {
  if (autoAdvanceTimer) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
  autoAdvanceGen++;
  const btn = document.getElementById('autoAdvanceBtn');
  if (btn) {
    btn.textContent = '自動更新';
    btn.classList.remove('active');
  }
}

function toggleAutoAdvance() {
  if (autoAdvanceTimer) {
    stopAutoAdvance();
    return;
  }
  const btn = document.getElementById('autoAdvanceBtn');
  btn.textContent = '停止';
  btn.classList.add('active');

  const myGen = autoAdvanceGen;
  const scheduleNext = () => {
    if (autoAdvanceGen !== myGen) return;
    const seconds = parseFloat(document.getElementById('autoIntervalInput').value) || 3;
    const ms = Math.max(500, seconds * 1000);
    autoAdvanceTimer = setTimeout(async () => {
      if (autoAdvanceGen !== myGen) return;
      if (!gameActive) { stopAutoAdvance(); return; }
      await nextDay();
      scheduleNext();
    }, ms);
  };
  scheduleNext();
}

// --- Next day ---
async function nextDay() {
  if (!gameActive) return;
  await _nextDayCore();
}

async function _nextDayCore() {
  guest.current_idx++;
  if (guest.current_idx >= guest.all_dates.length) {
    const lastDay = guest.all_dates[guest.all_dates.length - 1];
    const closePrice = lastDay.close;
    const closeDate = lastDay.date;

    // 未約定の保留注文はキャンセル
    guest.pendingOrders = [];
    updatePendingDisplay([]);

    // 保有ポジションを終値で強制決済
    const forcedLines = [];
    for (const [sym, pos] of Object.entries(guest.longPos)) {
      if (pos.shares > 0) {
        const realizedPnl = (closePrice - pos.avg_price) * pos.shares;
        guest.cash += closePrice * pos.shares;
        const cm = computeCloseMetrics(pos.entryDate || closeDate, closeDate, pos.avg_price, 'long');
        tradePush({ date: closeDate, type: 'sell', shares: pos.shares, price: closePrice, realizedPnl, symbol: sym, ...cm });
        for (const sim of Object.values(compSims)) simExecuteOrder(sim, 'sell', sym, closePrice, 0, closeDate);
        forcedLines.push(`買→強制売却 ${pos.shares}株 @${fmt(closePrice)}円（${realizedPnl >= 0 ? '+' : ''}${fmt(realizedPnl)}円）`);
        pos.shares = 0;
      }
    }
    for (const [sym, spos] of Object.entries(guest.shortPos)) {
      if (spos.shares > 0) {
        const realizedPnl = (spos.avg_price - closePrice) * spos.shares;
        guest.cash -= closePrice * spos.shares;
        const cm = computeCloseMetrics(spos.entryDate || closeDate, closeDate, spos.avg_price, 'short');
        tradePush({ date: closeDate, type: 'cover', shares: spos.shares, price: closePrice, realizedPnl, symbol: sym, ...cm });
        for (const sim of Object.values(compSims)) simExecuteOrder(sim, 'cover', sym, closePrice, 0, closeDate);
        forcedLines.push(`空売→強制買戻 ${spos.shares}株 @${fmt(closePrice)}円（${realizedPnl >= 0 ? '+' : ''}${fmt(realizedPnl)}円）`);
        spos.shares = 0;
      }
    }

    if (forcedLines.length > 0) {
      guest.pnl.push({ date: closeDate, value: guest.cash });
      refreshState();
      renderPnl();
      setTradeMarkers();

      const toast = document.getElementById('forceCloseToast');
      toast.innerHTML = `📊 データ終端のため、保有ポジションを終値 ${fmt(closePrice)}円で決済しました<br><span class="force-close-detail">${forcedLines.join('<br>')}</span>`;
      toast.classList.remove('hidden');
      await new Promise(r => setTimeout(r, 2500));
      toast.classList.add('hidden');
    }

    const wasAutoAdvancing = !!autoAdvanceTimer;
    if (roundMode) {
      stopAutoAdvance();
      roundComplete = true;
      saveRoundSession();
      updateRoundUI();
      return;
    }
    await changeStock();
    if (wasAutoAdvancing) toggleAutoAdvance();
    return;
  }
  guest.elapsed++;
  guest.current_date = guest.all_dates[guest.current_idx].date;

  const execPrice = guest.all_dates[guest.current_idx].open ?? guest.all_dates[guest.current_idx].close;
  for (const order of guest.pendingOrders) {
    if (order.type === 'buy') {
      const cost = execPrice * order.shares;
      if (guest.cash >= cost) {
        guest.cash -= cost;
        const pos = guest.longPos[order.symbol] || { shares: 0, avg_price: 0 };
        if (pos.shares === 0) pos.entryDate = guest.current_date;
        const newShares = pos.shares + order.shares;
        pos.avg_price = (pos.avg_price * pos.shares + execPrice * order.shares) / newShares;
        pos.shares = newShares;
        if (order.stopPct) pos.stopLossPrice = pos.avg_price * (1 - order.stopPct / 100);
        guest.longPos[order.symbol] = pos;
        tradePush({ date: guest.current_date, type: 'buy', shares: order.shares, price: execPrice, symbol: order.symbol });
      }
    } else if (order.type === 'sell') {
      const pos = guest.longPos[order.symbol];
      if (pos && pos.shares >= order.shares) {
        const realizedPnl = (execPrice - pos.avg_price) * order.shares;
        guest.cash += execPrice * order.shares;
        pos.shares -= order.shares;
        if (pos.shares === 0) pos.stopLossPrice = null;
        const cm = computeCloseMetrics(pos.entryDate || guest.current_date, guest.current_date, pos.avg_price, 'long');
        tradePush({ date: guest.current_date, type: 'sell', shares: order.shares, price: execPrice, realizedPnl, symbol: order.symbol, ...cm });
      }
    } else if (order.type === 'short') {
      guest.cash += execPrice * order.shares;
      const spos = guest.shortPos[order.symbol] || { shares: 0, avg_price: 0 };
      if (spos.shares === 0) spos.entryDate = guest.current_date;
      const newShort = spos.shares + order.shares;
      spos.avg_price = (spos.avg_price * spos.shares + execPrice * order.shares) / newShort;
      spos.shares = newShort;
      if (order.stopPct) spos.stopLossPrice = spos.avg_price * (1 + order.stopPct / 100);
      guest.shortPos[order.symbol] = spos;
      tradePush({ date: guest.current_date, type: 'short', shares: order.shares, price: execPrice, symbol: order.symbol });
    } else if (order.type === 'cover') {
      const spos = guest.shortPos[order.symbol];
      if (spos && spos.shares >= order.shares) {
        const cost = execPrice * order.shares;
        if (guest.cash >= cost) {
          const realizedPnl = (spos.avg_price - execPrice) * order.shares;
          guest.cash -= cost;
          spos.shares -= order.shares;
          if (spos.shares === 0) spos.stopLossPrice = null;
          const cm = computeCloseMetrics(spos.entryDate || guest.current_date, guest.current_date, spos.avg_price, 'short');
          tradePush({ date: guest.current_date, type: 'cover', shares: order.shares, price: execPrice, realizedPnl, symbol: order.symbol, ...cm });
        }
      }
    }

    // 比較シミュレーション（注文時終値で計算した株数を使用）
    const isBuyOrder = order.type === 'buy' || order.type === 'short';
    const pctBuyShares = isBuyOrder ? (order.simPctShares ?? 0) : 0;
    const fixBuyShares = isBuyOrder ? (order.simFixShares ?? 0) : 0;
    simExecuteOrder(compSims.percent, order.type, order.symbol, execPrice, pctBuyShares, guest.current_date);
    simExecuteOrder(compSims.shares,  order.type, order.symbol, execPrice, fixBuyShares, guest.current_date);
  }
  guest.pendingOrders = [];
  updatePendingDisplay([]);

  // --- 自動損切りチェック ---
  if (document.getElementById('autoStopEnabled').checked) {
    const slippage = parseFloat(document.getElementById('slippageInput').value) || 0;
    const rawDay  = guest.all_dates[guest.current_idx];
    const dayLow  = rawDay.low  ?? rawDay.close;
    const dayHigh = rawDay.high ?? rawDay.close;
    const stopMsgs = [];

    for (const [sym, pos] of Object.entries(guest.longPos)) {
      if (pos.shares > 0 && pos.stopLossPrice && dayLow <= pos.stopLossPrice) {
        const sellPrice = Math.round(pos.stopLossPrice * (1 - slippage / 100));
        const realizedPnl = (sellPrice - pos.avg_price) * pos.shares;
        guest.cash += sellPrice * pos.shares;
        const cm = computeCloseMetrics(pos.entryDate || guest.current_date, guest.current_date, pos.avg_price, 'long');
        tradePush({ date: guest.current_date, type: 'sell', shares: pos.shares, price: sellPrice, realizedPnl, symbol: sym, ...cm });
        stopMsgs.push(`🔴 損切り自動執行（買）: ${pos.shares}株 @${fmt(sellPrice)}円（${realizedPnl >= 0 ? '+' : ''}${fmt(realizedPnl)}円）`);
        pos.shares = 0;
        pos.stopLossPrice = null;
      }
    }

    for (const [sym, spos] of Object.entries(guest.shortPos)) {
      if (spos.shares > 0 && spos.stopLossPrice && dayHigh >= spos.stopLossPrice) {
        const coverPrice = Math.round(spos.stopLossPrice * (1 + slippage / 100));
        const realizedPnl = (spos.avg_price - coverPrice) * spos.shares;
        guest.cash -= coverPrice * spos.shares;
        const cm = computeCloseMetrics(spos.entryDate || guest.current_date, guest.current_date, spos.avg_price, 'short');
        tradePush({ date: guest.current_date, type: 'cover', shares: spos.shares, price: coverPrice, realizedPnl, symbol: sym, ...cm });
        stopMsgs.push(`🔴 損切り自動執行（空売）: ${spos.shares}株 @${fmt(coverPrice)}円（${realizedPnl >= 0 ? '+' : ''}${fmt(realizedPnl)}円）`);
        spos.shares = 0;
        spos.stopLossPrice = null;
      }
    }

    if (stopMsgs.length) {
      const msgEl = document.getElementById('orderMsg');
      msgEl.innerHTML = stopMsgs.join('<br>');
      msgEl.className = 'msg error';
      clearTimeout(msgEl._stopTimer);
      msgEl._stopTimer = setTimeout(() => { msgEl.innerHTML = ''; msgEl.className = ''; }, 5000);
    }
  }

  const price = guest.all_dates[guest.current_idx].close;
  let posVal = 0;
  for (const [, pos] of Object.entries(guest.longPos))  if (pos.shares > 0) posVal += price * pos.shares;
  for (const [, pos] of Object.entries(guest.shortPos)) if (pos.shares > 0) posVal -= price * pos.shares;
  guest.pnl.push({ date: guest.current_date, value: guest.cash + posVal });

  const raw = guest.all_dates[guest.current_idx];
  const newCandle = {
    time: raw.date,
    open: raw.open ?? raw.close,
    high: raw.high ?? raw.close,
    low:  raw.low  ?? raw.close,
    close: raw.close,
    volume: raw.volume,
  };
  if (newCandle.open && newCandle.close) {
    currentCandles.push(newCandle);
    try {
      appendDayToChart(newCandle);
    } catch (e) {
      console.warn('[chart] appendDayToChart failed, falling back to refreshChart:', e.message);
      await refreshChart();
    }
    applySliderToChart(parseInt(document.getElementById('rangeSlider').value));
    blindActualDate = jaFullDate(raw.date);
    blindDayCount++;
    document.getElementById('currentDate').textContent = blindMode ? `${blindDayCount}日目` : blindActualDate;
    document.getElementById('currentPrice').textContent = `${fmt(newCandle.close)}円`;
    updateOrderPreview();
    setTradeMarkers();
  } else {
    await refreshChart();
  }
  refreshState();
  renderPnl();
  if (getOrderMode() === 'risk') renderComparisonChart();
  saveState();
}

// --- Chart ---
function setupChartResizer() {
  const resizer = document.getElementById('chartResizer');
  const volume  = document.getElementById('volumeChart');
  let startY, startVolH;

  resizer.addEventListener('mousedown', e => {
    startY    = e.clientY;
    startVolH = volume.getBoundingClientRect().height;
    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';

    const onMove = e => {
      const dy = e.clientY - startY;
      const newVolH = Math.max(30, startVolH - dy);
      volume.style.height = newVolH + 'px';
    };
    const onUp = () => {
      resizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });
}

function jaDateFormatter(time, tickMarkType) {
  const [y, m, d] = (typeof time === 'string' ? time : `${time.year}-${time.month}-${time.day}`)
    .split('-').map(Number);
  if (tickMarkType === 0) return `${y}年`;
  if (tickMarkType === 1) return `${m}月`;
  return `${d}日`;
}

function jaFullDate(time) {
  const [y, m, d] = (typeof time === 'string' ? time : `${time.year}-${time.month}-${time.day}`)
    .split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

function zoomWithWheel(e) {
  e.preventDefault();
  userZoomSet = true;
  const range = lwChart.timeScale().getVisibleLogicalRange();
  if (!range) return;
  const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
  const bars = Math.max(5, (range.to - range.from) * factor);
  lwChart.timeScale().setVisibleLogicalRange({ from: range.to - bars, to: range.to });
  lwChart.priceScale('right').applyOptions({ autoScale: true });
}

function syncRange(source, range) {
  if (syncingRange || !range) return;
  const isIndicatorSource = (source === rsiChartInst || source === macdChartInst);
  syncingRange = true;
  try {
    [lwChart, volChart, rsiChartInst, macdChartInst].forEach(c => {
      if (!c || c === source) return;
      // インジケーターからメイン/ボリュームへの逆伝播を禁止
      if (isIndicatorSource && (c === lwChart || c === volChart)) return;
      try { c.timeScale().setVisibleLogicalRange(range); } catch {}
    });
  } finally {
    syncingRange = false;
  }
  updateSliderFromRange(range);
}

function setupChart() {
  const container = document.getElementById('candleChart');
  lwChart = LightweightCharts.createChart(container, {
    autoSize: true,
    layout: { background: { color: '#0f0f1a' }, textColor: '#d1d5db', attributionLogo: false },
    grid: { vertLines: { color: '#1e1e30' }, horzLines: { color: '#1e1e30' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    timeScale: { borderColor: '#374151', timeVisible: false, tickMarkFormatter: jaDateFormatter },
    rightPriceScale: { borderColor: '#374151' },
    handleScale: { mouseWheel: false },
    watermark: { visible: false },
    localization: { dateFormatter: jaFullDate },
  });

  candleSeries = lwChart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: chartColors.upCandle, downColor: chartColors.downCandle,
    borderUpColor: chartColors.upCandle, borderDownColor: chartColors.downCandle,
    wickUpColor: chartColors.upCandle, wickDownColor: chartColors.downCandle,
    priceLineVisible: false, lastValueVisible: false,
  });
  tradeMarkersPlugin = LightweightCharts.createSeriesMarkers(candleSeries, []);

  ma1Series = lwChart.addSeries(LightweightCharts.LineSeries, { color: chartColors.ma1, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  ma2Series = lwChart.addSeries(LightweightCharts.LineSeries, { color: chartColors.ma2, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
  ma3Series = lwChart.addSeries(LightweightCharts.LineSeries, { color: chartColors.ma3, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

  setupBBSeries();

  const volContainer = document.getElementById('volumeChart');
  volChart = LightweightCharts.createChart(volContainer, {
    autoSize: true,
    layout: { background: { color: '#0f0f1a' }, textColor: '#6b7280', attributionLogo: false },
    grid: { vertLines: { color: '#1e1e30' }, horzLines: { color: '#1e1e30' } },
    timeScale: { borderColor: '#374151', timeVisible: false, tickMarkFormatter: jaDateFormatter },
    rightPriceScale: { borderColor: '#374151', scaleMargins: { top: 0.1, bottom: 0 } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    watermark: { visible: false },
    localization: { dateFormatter: jaFullDate },
  });

  volSeries = volChart.addSeries(LightweightCharts.HistogramSeries, {
    color: '#374151',
    priceFormat: { type: 'volume' },
    priceScaleId: '',
  });

  setupRsiChart();
  setupMacdChart();

  lwChart.timeScale().subscribeVisibleLogicalRangeChange(range => syncRange(lwChart, range));
  volChart.timeScale().subscribeVisibleLogicalRangeChange(range => syncRange(volChart, range));

  container.addEventListener('wheel', zoomWithWheel, { passive: false });
  document.getElementById('volumeChart').addEventListener('wheel', zoomWithWheel, { passive: false });

  applyIndicatorVisibility();
}

function setupBBSeries() {
  const lineOpts = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false };
  bbUpperSeries = lwChart.addSeries(LightweightCharts.LineSeries, {
    ...lineOpts, color: chartColors.bbBand,
    lineStyle: LightweightCharts.LineStyle.Dashed,
  });
  bbMidSeries = lwChart.addSeries(LightweightCharts.LineSeries, {
    ...lineOpts, color: chartColors.bbMid,
    lineStyle: LightweightCharts.LineStyle.Dotted,
  });
  bbLowerSeries = lwChart.addSeries(LightweightCharts.LineSeries, {
    ...lineOpts, color: chartColors.bbBand,
    lineStyle: LightweightCharts.LineStyle.Dashed,
  });
  bbUpper3Series = lwChart.addSeries(LightweightCharts.LineSeries, {
    ...lineOpts, color: chartColors.bb3Band,
    lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1,
  });
  bbLower3Series = lwChart.addSeries(LightweightCharts.LineSeries, {
    ...lineOpts, color: chartColors.bb3Band,
    lineStyle: LightweightCharts.LineStyle.Dashed, lineWidth: 1,
  });
}

const INDICATOR_CHART_OPTS = {
  autoSize: true,
  layout: { background: { color: '#0f0f1a' }, textColor: '#6b7280', attributionLogo: false },
  grid: { vertLines: { color: '#1e1e30' }, horzLines: { color: '#1e1e30' } },
  timeScale: { borderColor: '#374151', timeVisible: false, tickMarkFormatter: jaDateFormatter },
  rightPriceScale: { borderColor: '#374151' },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  handleScale: { mouseWheel: false },
  watermark: { visible: false },
  localization: { dateFormatter: jaFullDate },
};

function setupRsiChart() {
  const container = document.getElementById('rsiChart');
  rsiChartInst = LightweightCharts.createChart(container, {
    ...INDICATOR_CHART_OPTS,
    rightPriceScale: { borderColor: '#374151', scaleMargins: { top: 0.1, bottom: 0.1 } },
  });
  rsiSeries = rsiChartInst.addSeries(LightweightCharts.LineSeries, {
    color: chartColors.rsiLine, lineWidth: 1,
    priceLineVisible: false, lastValueVisible: true,
  });
  rsiSeries.createPriceLine({ price: 70, color: '#ef4444', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '70' });
  rsiSeries.createPriceLine({ price: 30, color: '#22c55e', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '30' });

  rsiChartInst.timeScale().subscribeVisibleLogicalRangeChange(range => syncRange(rsiChartInst, range));
  container.addEventListener('wheel', zoomWithWheel, { passive: false });
}

function setupMacdChart() {
  const container = document.getElementById('macdChart');
  macdChartInst = LightweightCharts.createChart(container, INDICATOR_CHART_OPTS);

  macdHistSeries = macdChartInst.addSeries(LightweightCharts.HistogramSeries, {
    priceLineVisible: false, lastValueVisible: false,
  });
  macdLineSeries = macdChartInst.addSeries(LightweightCharts.LineSeries, {
    color: chartColors.macdLine, lineWidth: 1,
    priceLineVisible: false, lastValueVisible: true,
  });
  macdSignalSeries = macdChartInst.addSeries(LightweightCharts.LineSeries, {
    color: chartColors.signalLine, lineWidth: 1,
    priceLineVisible: false, lastValueVisible: true,
  });

  macdChartInst.timeScale().subscribeVisibleLogicalRangeChange(range => syncRange(macdChartInst, range));
  container.addEventListener('wheel', zoomWithWheel, { passive: false });
}

// --- Indicator calculations ---
function calcMA(candles, period) {
  const result = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) continue;
    const slice = candles.slice(i - period + 1, i + 1);
    const avg = slice.reduce((s, c) => s + c.close, 0) / period;
    result.push({ time: candles[i].time, value: avg });
  }
  return result;
}

function calcBB(candles, period = 20, ...sigmas) {
  const bands = sigmas.map(() => ({ upper: [], lower: [] }));
  const mid = [];
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, c) => s + c.close, 0) / period;
    const sd = Math.sqrt(slice.reduce((s, c) => s + (c.close - mean) ** 2, 0) / period);
    const t = candles[i].time;
    mid.push({ time: t, value: mean });
    sigmas.forEach((mult, idx) => {
      bands[idx].upper.push({ time: t, value: mean + mult * sd });
      bands[idx].lower.push({ time: t, value: mean - mult * sd });
    });
  }
  return { mid, bands };
}

function calcEMA(values, period) {
  const k = 2 / (period + 1);
  const result = [];
  let ema = values[0];
  result.push(ema);
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

function calcRSI(candles, period = 14) {
  if (candles.length < period + 1) return [];
  const result = [];
  let avgGain = 0, avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff >= 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < candles.length; i++) {
    if (i > period) {
      const diff = candles[i].close - candles[i - 1].close;
      const gain = diff >= 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
  }
  indicatorState.rsi.avgGain = avgGain;
  indicatorState.rsi.avgLoss = avgLoss;
  return result;
}

function calcMACD(candles, fast = 12, slow = 26, signal = 9) {
  if (candles.length < slow) return { macd: [], signal: [], hist: [] };
  const closes = candles.map(c => c.close);
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);

  const macdValues = [];
  for (let i = slow - 1; i < candles.length; i++) {
    macdValues.push({ time: candles[i].time, raw: emaFast[i] - emaSlow[i] });
  }

  const rawArr = macdValues.map(v => v.raw);
  const signalArr = calcEMA(rawArr, signal);

  const macdLine = [], signalLine = [], hist = [];
  for (let i = signal - 1; i < macdValues.length; i++) {
    const t = macdValues[i].time;
    const m = macdValues[i].raw;
    const s = signalArr[i];
    const h = m - s;
    macdLine.push({ time: t, value: m });
    signalLine.push({ time: t, value: s });
    hist.push({ time: t, value: h, color: h >= 0 ? '#ef444488' : '#3b82f688' });
  }
  indicatorState.macd.emaFast   = emaFast[emaFast.length - 1];
  indicatorState.macd.emaSlow   = emaSlow[emaSlow.length - 1];
  indicatorState.macd.emaSignal = signalArr[signalArr.length - 1];
  indicatorState.macd.initialized = true;
  return { macd: macdLine, signal: signalLine, hist };
}

// --- Indicator visibility ---
function applyIndicatorVisibility() {
  if (!indicatorSettings.showBB) {
    if (bbUpperSeries)  bbUpperSeries.setData([]);
    if (bbMidSeries)    bbMidSeries.setData([]);
    if (bbLowerSeries)  bbLowerSeries.setData([]);
    if (bbUpper3Series) bbUpper3Series.setData([]);
    if (bbLower3Series) bbLower3Series.setData([]);
  } else if (currentCandles.length) {
    updateBB();
  }

  const rsiEl = document.getElementById('rsiChart');
  if (rsiEl) rsiEl.style.display = indicatorSettings.showRSI ? 'block' : 'none';
  if (indicatorSettings.showRSI && currentCandles.length) updateRSI();

  const macdEl = document.getElementById('macdChart');
  if (macdEl) macdEl.style.display = indicatorSettings.showMACD ? 'block' : 'none';
  if (indicatorSettings.showMACD && currentCandles.length) updateMACD();

  const range = lwChart?.timeScale().getVisibleLogicalRange();
  if (range) {
    [rsiChartInst, macdChartInst].forEach(c => {
      if (c) try { c.timeScale().setVisibleLogicalRange(range); } catch {}
    });
  }
}

function updateBB() {
  if (!bbUpperSeries || !currentCandles.length) return;
  const sigmas = indicatorSettings.showBB3 ? [2, 3] : [2];
  const { mid, bands } = calcBB(currentCandles, 20, ...sigmas);
  bbMidSeries.setData(mid);
  bbUpperSeries.setData(bands[0].upper);
  bbLowerSeries.setData(bands[0].lower);
  if (indicatorSettings.showBB3) {
    bbUpper3Series.setData(bands[1].upper);
    bbLower3Series.setData(bands[1].lower);
  } else {
    bbUpper3Series.setData([]);
    bbLower3Series.setData([]);
  }
}

function updateRSI() {
  if (!rsiSeries || !currentCandles.length) return;
  rsiSeries.setData(calcRSI(currentCandles, 14));
}

function updateMACD() {
  if (!macdLineSeries || !currentCandles.length) return;
  const { macd, signal, hist } = calcMACD(currentCandles, 12, 26, 9);
  macdLineSeries.setData(macd);
  macdSignalSeries.setData(signal);
  macdHistSeries.setData(hist);
}

function appendDayToChart(c) {
  candleSeries.update(c);
  volSeries.update({
    time: c.time, value: c.volume || 0,
    color: c.close >= c.open ? chartColors.volUp : chartColors.volDown,
  });

  const n = currentCandles.length;
  for (const [series, period] of [[ma1Series, ma1], [ma2Series, ma2], [ma3Series, ma3]]) {
    if (n >= period) {
      const slice = currentCandles.slice(n - period);
      series.update({ time: c.time, value: slice.reduce((s, x) => s + x.close, 0) / period });
    }
  }

  if (indicatorSettings.showBB && n >= 20) {
    const slice = currentCandles.slice(n - 20);
    const mean = slice.reduce((s, x) => s + x.close, 0) / 20;
    const sd = Math.sqrt(slice.reduce((s, x) => s + (x.close - mean) ** 2, 0) / 20);
    bbMidSeries.update({ time: c.time, value: mean });
    bbUpperSeries.update({ time: c.time, value: mean + 2 * sd });
    bbLowerSeries.update({ time: c.time, value: mean - 2 * sd });
    if (indicatorSettings.showBB3) {
      bbUpper3Series.update({ time: c.time, value: mean + 3 * sd });
      bbLower3Series.update({ time: c.time, value: mean - 3 * sd });
    }
  }

  if (indicatorSettings.showRSI && n >= 2) {
    let { avgGain, avgLoss } = indicatorState.rsi;
    if (avgGain !== 0 || avgLoss !== 0) {
      const diff = currentCandles[n - 1].close - currentCandles[n - 2].close;
      avgGain = (avgGain * 13 + (diff >= 0 ? diff : 0)) / 14;
      avgLoss = (avgLoss * 13 + (diff < 0 ? -diff : 0)) / 14;
      indicatorState.rsi.avgGain = avgGain;
      indicatorState.rsi.avgLoss = avgLoss;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsiSeries.update({ time: c.time, value: 100 - 100 / (1 + rs) });
    }
  }

  if (indicatorSettings.showMACD && indicatorState.macd.initialized) {
    const k12 = 2 / 13, k26 = 2 / 27, k9 = 2 / 10;
    let { emaFast, emaSlow, emaSignal } = indicatorState.macd;
    emaFast   = c.close * k12 + emaFast   * (1 - k12);
    emaSlow   = c.close * k26 + emaSlow   * (1 - k26);
    const macdVal = emaFast - emaSlow;
    emaSignal = macdVal  * k9  + emaSignal * (1 - k9);
    const h = macdVal - emaSignal;
    indicatorState.macd.emaFast = emaFast;
    indicatorState.macd.emaSlow = emaSlow;
    indicatorState.macd.emaSignal = emaSignal;
    macdLineSeries.update({ time: c.time, value: macdVal });
    macdSignalSeries.update({ time: c.time, value: emaSignal });
    macdHistSeries.update({ time: c.time, value: h, color: h >= 0 ? '#ef444488' : '#3b82f688' });
  }
}

function updateSliderFromRange(range) {
  const slider = document.getElementById('rangeSlider');
  const label = document.getElementById('rangeLabel');
  if (!slider || !range) return;
  const bars = Math.round(range.to - range.from + 1);
  if (bars > 0) {
    const max = parseInt(slider.max);
    slider.value = Math.min(bars, max);
    label.textContent = `${bars}本表示`;
  }
}

function applySliderToChart(bars) {
  if (!lwChart || !currentCandles.length || bars <= 0) return;
  const total = currentCandles.length;
  const from = total - bars; // 負値可：左側に空白を作ることで足の幅を一定に保つ
  lwChart.timeScale().setVisibleLogicalRange({ from, to: total - 1 });
  // 価格スケールを表示中の足に合わせて自動調整
  lwChart.priceScale('right').applyOptions({ autoScale: true });
}

/** 日足データを週足に集計 */
function aggregateWeekly(daily) {
  const groups = {};
  for (const c of daily) {
    // ISO週の月曜日をキーにする
    const d = new Date(c.time);
    const day = d.getDay(); // 0=Sun,1=Mon...
    const diff = (day === 0 ? -6 : 1 - day);
    const mon = new Date(d);
    mon.setDate(d.getDate() + diff);
    const key = mon.toISOString().slice(0, 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }
  return Object.keys(groups).sort().map(key => {
    const bars = groups[key];
    return {
      time:   key,
      open:   bars[0].open,
      high:   Math.max(...bars.map(b => b.high)),
      low:    Math.min(...bars.map(b => b.low)),
      close:  bars[bars.length - 1].close,
      volume: bars.reduce((s, b) => s + (b.volume || 0), 0),
    };
  });
}

/** 日足データを月足に集計 */
function aggregateMonthly(daily) {
  const groups = {};
  for (const c of daily) {
    const key = c.time.slice(0, 7) + '-01';
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }
  return Object.keys(groups).sort().map(key => {
    const bars = groups[key];
    return {
      time:   key,
      open:   bars[0].open,
      high:   Math.max(...bars.map(b => b.high)),
      low:    Math.min(...bars.map(b => b.low)),
      close:  bars[bars.length - 1].close,
      volume: bars.reduce((s, b) => s + (b.volume || 0), 0),
    };
  });
}

async function refreshChart() {
  if (!currentSymbol) return;

  const historyFrom = Math.max(0, guest.start_idx - 200);
  const validRaw = guest.all_dates.slice(historyFrom, guest.current_idx + 1).filter(c => c.close);

  const dailyCandles = validRaw.map(c => ({
    time: c.date,
    open: c.open ?? c.close,
    high: c.high ?? c.close,
    low:  c.low  ?? c.close,
    close: c.close,
    volume: c.volume,
  }));

  // タイムフレームに応じて集計
  if (currentTimeframe === 'weekly') {
    currentCandles = aggregateWeekly(dailyCandles);
  } else if (currentTimeframe === 'monthly') {
    currentCandles = aggregateMonthly(dailyCandles);
  } else {
    currentCandles = dailyCandles;
  }

  if (!currentCandles.length) return;

  candleSeries.setData(currentCandles);
  ma1Series.setData(calcMA(currentCandles, ma1));
  ma2Series.setData(calcMA(currentCandles, ma2));
  ma3Series.setData(calcMA(currentCandles, ma3));

  const volData = currentCandles.map(c => ({
    time: c.time,
    value: c.volume || 0,
    color: c.close >= c.open ? chartColors.volUp : chartColors.volDown,
  }));
  volSeries.setData(volData);

  if (indicatorSettings.showBB)   updateBB();
  if (indicatorSettings.showRSI)  updateRSI();
  if (indicatorSettings.showMACD) updateMACD();

  const last = currentCandles[currentCandles.length - 1];
  const lastDate = validRaw[validRaw.length - 1].date;
  blindActualDate = jaFullDate(lastDate);
  document.getElementById('currentDate').textContent = blindMode ? `${blindDayCount}日目` : blindActualDate;
  document.getElementById('currentPrice').textContent = `${fmt(last.close)}円`;
  updateOrderPreview();
  setTradeMarkers();

  const slider = document.getElementById('rangeSlider');
  // 設定本数より多くてもスライダーで調整できるよう、データ数と設定本数の大きい方をmaxにする
  slider.max = Math.max(getDefaultBars(), currentCandles.length);

  let viewBars;
  if (userZoomSet) {
    viewBars = parseInt(slider.value); // データ数を超えても許容（左空白で幅を保つ）
  } else {
    viewBars = getDefaultBars();
    userZoomSet = true;
  }
  slider.value = viewBars;
  applySliderToChart(viewBars);
  document.getElementById('rangeLabel').textContent = `${viewBars}本表示`;
  // ライブラリの遅延rangeイベントが処理された後に正しい範囲を再適用
  const _vb = viewBars;
  setTimeout(() => applySliderToChart(_vb), 0);
}

const TRADE_MARKER = {
  buy:   { position: 'belowBar', color: '#ef4444', shape: 'arrowUp',   label: '買' },
  sell:  { position: 'aboveBar', color: '#3b82f6', shape: 'arrowDown', label: '売' },
  short: { position: 'aboveBar', color: '#f59e0b', shape: 'arrowDown', label: '空売' },
  cover: { position: 'belowBar', color: '#10b981', shape: 'arrowUp',   label: '戻' },
};

function setTradeMarkers() {
  if (!tradeMarkersPlugin || !currentSymbol) return;

  // 週足/月足では trade の daily date → 対応する足の time にマッピング
  function mapDateToTf(dateStr) {
    if (currentTimeframe === 'weekly') {
      const d = new Date(dateStr);
      const day = d.getUTCDay(); // 0=Sun
      const diff = (day === 0) ? -6 : 1 - day; // 月曜日に寄せる
      d.setUTCDate(d.getUTCDate() + diff);
      return d.toISOString().slice(0, 10);
    } else if (currentTimeframe === 'monthly') {
      return dateStr.slice(0, 7) + '-01';
    }
    return dateStr;
  }

  // currentCandles に存在する time セットを作成（マーカーが存在しない足に設定するとエラーになる場合を防ぐ）
  const validTimes = new Set(currentCandles.map(c => c.time));

  const toMarker = t => {
    const m = TRADE_MARKER[t.type] || TRADE_MARKER.buy;
    const time = mapDateToTf(t.date);
    return { time, position: m.position, color: m.color, shape: m.shape, text: `${m.label} ${t.shares}株@${fmt(t.price)}円` };
  };
  const sym = currentSymbol.replace(/\.T$/, '');
  const filtered = guest.trades
    .filter(t =>
      (!t.symbol || t.symbol.replace(/\.T$/, '') === sym) &&
      (!roundMode || (t.round === currentRound && t.sessionId === currentSessionId)) &&
      validTimes.has(mapDateToTf(t.date))
    )
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  try { tradeMarkersPlugin.setMarkers(filtered.map(toMarker)); } catch (e) { console.warn('[markers]', e.message); }
}

function updateOrderTabs(hasLong, hasShort, longShares = 0, shortShares = 0) {
  const btn = document.getElementById('executeBtn');
  if (!btn) return;
  if (hasLong && longShares > 0) {
    btn.textContent = `全売却（${longShares}株）`;
    btn.className = 'btn-primary btn-sell';
    btn.style.display = '';
    btn.onclick = () => closePosition(currentSymbol, false, longShares);
  } else if (hasShort && shortShares > 0) {
    btn.textContent = `全買い戻し（${shortShares}株）`;
    btn.className = 'btn-primary btn-cover';
    btn.style.display = '';
    btn.onclick = () => closePosition(currentSymbol, true, shortShares);
  } else {
    btn.style.display = 'none';
    btn.onclick = null;
  }
}

// --- State display ---
function refreshState() {
  const price = guest.all_dates[guest.current_idx]?.close || 0;
  let posVal = 0;
  const posList = document.getElementById('positionList');

  const rows = [];
  for (const [sym, p] of Object.entries(guest.longPos)) {
    if (p.shares > 0) {
      posVal += price * p.shares;
      rows.push(positionRow(sym, false, p.shares, p.avg_price, price));
    }
  }
  for (const [sym, p] of Object.entries(guest.shortPos)) {
    if (p.shares > 0) {
      posVal -= price * p.shares;
      rows.push(positionRow(sym, true, p.shares, p.avg_price, price));
    }
  }

  posList.innerHTML = rows.length ? rows.join('') : '<p class="empty">保有なし</p>';

  const hasLong  = Object.values(guest.longPos).some(p => p.shares > 0);
  const hasShort = Object.values(guest.shortPos).some(p => p.shares > 0);
  const longShares  = Object.values(guest.longPos).reduce((s, p) => s + (p.shares > 0 ? p.shares : 0), 0);
  const shortShares = Object.values(guest.shortPos).reduce((s, p) => s + (p.shares > 0 ? p.shares : 0), 0);
  updateOrderTabs(hasLong, hasShort, longShares, shortShares);

  const total = guest.cash + posVal;
  const pr = (total - INITIAL_CASH) / INITIAL_CASH * 100;
  document.getElementById('statAssets').textContent = fmt(total) + '円';
  const profitEl = document.getElementById('statProfit');
  profitEl.textContent = fmtPct(pr);
  profitEl.className = 'stat-value ' + (pr >= 0 ? 'pos' : 'neg');
  document.getElementById('statElapsed').textContent = `${guest.elapsed}日経過`;
  document.getElementById('statCash').textContent = fmt(guest.cash) + '円';
}

function positionRow(symbol, isShort, shares, avgPrice, currentPrice) {
  const pnl = isShort
    ? (avgPrice - currentPrice) * shares
    : (currentPrice - avgPrice) * shares;
  const pct = isShort
    ? ((avgPrice - currentPrice) / avgPrice * 100).toFixed(1)
    : ((currentPrice - avgPrice) / avgPrice * 100).toFixed(1);
  const btnLabel = isShort ? '買戻' : '売却';
  const btnCls = isShort ? 'pos-close-btn cover' : 'pos-close-btn sell';
  return `<div class="position-row${isShort ? ' short-pos' : ''}">
    <div class="pos-info">
      <div class="pos-symbol">${blindMode ? '???' : symbol}${isShort ? ' <span class="short-badge">空売</span>' : ''}</div>
      <div class="pos-detail">${shares}株 @ ${fmt(avgPrice)}円</div>
      <div class="pos-pnl ${pnl >= 0 ? 'pos' : 'neg'}">${pnl >= 0 ? '+' : ''}${fmt(pnl)}円 (${pct}%)</div>
    </div>
    <button class="${btnCls}" onclick="closePosition('${symbol}', ${isShort}, ${shares})">${btnLabel}</button>
  </div>`;
}

async function closePosition(symbol, isShort, shares) {
  const orderType = isShort ? 'cover' : 'sell';
  const price = currentCandles[currentCandles.length - 1]?.close;
  if (!price) return;

  if (orderType === 'sell') {
    const pos = guest.longPos[symbol];
    if (!pos || pos.shares < shares) return;
  } else {
    const spos = guest.shortPos[symbol];
    if (!spos || spos.shares < shares) return;
  }
  guest.pendingOrders.push({ type: orderType, symbol, shares });
  await nextDay();
}

// --- 実現損益チャート ---
// ゲーム開始日からの経過カレンダー日数を返す
function dateDiffDays(from, to) {
  if (!from || !to) return 0;
  return Math.round((new Date(to) - new Date(from)) / 86400000);
}

// trades 配列から「累積保有日数 vs 累積実現損益」データを作る共通ロジック
function buildHoldDaysData(trades) {
  let cumulative = 0;
  let cumulativeHoldDays = 0;
  const openDateMap = {};  // key: symbol or 'short_symbol'
  const data = [];

  for (const t of trades) {
    if (t.type === 'buy') {
      if (!openDateMap[t.symbol]) openDateMap[t.symbol] = t.date;
    } else if (t.type === 'short') {
      if (!openDateMap[`short_${t.symbol}`]) openDateMap[`short_${t.symbol}`] = t.date;
    } else if (t.type === 'sell' && t.realizedPnl != null) {
      const openDate = openDateMap[t.symbol];
      cumulativeHoldDays += openDate ? dateDiffDays(openDate, t.date) : 0;
      delete openDateMap[t.symbol];
      cumulative += t.realizedPnl;
      if (data.length && data[data.length - 1].holdDays === cumulativeHoldDays)
        data[data.length - 1].value = cumulative;
      else
        data.push({ holdDays: cumulativeHoldDays, value: cumulative });
    } else if (t.type === 'cover' && t.realizedPnl != null) {
      const openDate = openDateMap[`short_${t.symbol}`];
      cumulativeHoldDays += openDate ? dateDiffDays(openDate, t.date) : 0;
      delete openDateMap[`short_${t.symbol}`];
      cumulative += t.realizedPnl;
      if (data.length && data[data.length - 1].holdDays === cumulativeHoldDays)
        data[data.length - 1].value = cumulative;
      else
        data.push({ holdDays: cumulativeHoldDays, value: cumulative });
    }
  }
  return data;
}

function renderPnl() {
  if (roundMode) { _renderPnlRound(); return; }
  // 通常モード：ラウンドチャートが残っていれば破棄して再作成
  if (pnlChart?._roundMode)      { pnlChart.destroy();      pnlChart      = null; }
  if (pnlChartLarge?._roundMode) { pnlChartLarge.destroy(); pnlChartLarge = null; }
  renderPnlData(buildHoldDaysData(guest.trades));
}

// 3Rモード専用：ラウンドごとの実現損益を3本線で比較表示
function _renderPnlRound() {
  // ラウンド別データ（各ラウンド独立して 0 スタート）
  // currentSessionId で現セッションのトレードのみ対象にする
  const roundsData = [1, 2, 3].map(r => {
    const data = buildHoldDaysData(
      guest.trades.filter(t => t.round === r && t.sessionId === currentSessionId)
    );
    return [{ holdDays: 0, value: 0 }, ...data];
  });

  // 全ラウンドの holdDays を統合してx軸を作成
  const allDays = [...new Set(roundsData.flat().map(d => d.holdDays))].sort((a, b) => a - b);
  if (!allDays.length || allDays[0] !== 0) allDays.unshift(0);
  const labels = allDays.map(d => `${d}日`);

  // 各ラウンドの値を allDays に揃える（前値を繰り越し）
  const getVals = (pts) => allDays.map(day => {
    const prev = pts.filter(p => p.holdDays <= day);
    return prev.length ? prev[prev.length - 1].value : 0;
  });

  const makeDatasets = () => [
    ...COMP_COLORS.map((c, i) => ({
      label: `R${i + 1}`, data: [],
      borderColor: c.border, backgroundColor: 'transparent',
      fill: false, tension: 0, pointRadius: 0, borderWidth: 1.5,
    })),
    { label: '', data: [], borderColor: '#4b5563', borderDash: [4, 4], borderWidth: 1, pointRadius: 0, fill: false },
  ];

  const makePlugin = () => ({
    id: 'roundPnlLabel',
    afterDraw(chart) {
      const { ctx, chartArea: { left, top } } = chart;
      const fv = chart._roundFinalVals || [];
      const dl = chart._roundDataLengths || [];
      ctx.save();
      ctx.font = 'bold 11px sans-serif';
      ctx.textBaseline = 'top';
      COMP_COLORS.forEach((c, i) => {
        if (!dl[i] || dl[i] <= 1) return; // 未取引ラウンドはスキップ
        const v = fv[i] ?? 0;
        const s = Math.abs(v) >= 10000
          ? `R${i + 1}: ${(v / 10000).toFixed(1)}万円`
          : `R${i + 1}: ${v >= 0 ? '+' : ''}${v.toFixed(0)}円`;
        ctx.fillStyle = c.border;
        ctx.textAlign = 'left';
        ctx.fillText(s, left + 4, top + 4 + i * 14);
      });
      ctx.restore();
    },
  });

  const opts = {
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { maxTicksLimit: 3, color: '#6b7280', font: { size: 10 } }, grid: { color: '#1e1e30' } },
      y: {
        ticks: { color: '#6b7280', font: { size: 10 },
          callback: v => Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(0)}万` : `${v}` },
        grid: { color: '#1e1e30' },
      },
    },
  };

  // データを既存チャートに適用
  const applyData = (chart) => {
    chart._roundFinalVals    = roundsData.map(pts => pts[pts.length - 1]?.value ?? 0);
    chart._roundDataLengths  = roundsData.map(pts => pts.length);
    chart.data.labels = labels;
    chart.data.datasets.forEach((ds, i) => {
      ds.data = i < 3 ? getVals(roundsData[i]) : allDays.map(() => 0);
    });
    chart.update('none');
  };

  // サイドバーの pnlChart
  if (pnlChart?._roundMode) {
    applyData(pnlChart);
  } else {
    if (pnlChart) pnlChart.destroy();
    pnlChart = new Chart(
      document.getElementById('pnlChart').getContext('2d'),
      { type: 'line', data: { labels, datasets: makeDatasets() }, plugins: [makePlugin()], options: opts }
    );
    pnlChart._roundMode = true;
    applyData(pnlChart);
  }

  // 拡大ビューの pnlChartLarge
  const canvasL = document.getElementById('pnlChartLarge');
  if (!canvasL) return;
  if (pnlChartLarge?._roundMode) {
    applyData(pnlChartLarge);
  } else {
    if (pnlChartLarge) pnlChartLarge.destroy();
    pnlChartLarge = new Chart(
      canvasL.getContext('2d'),
      { type: 'line', data: { labels, datasets: makeDatasets() }, plugins: [makePlugin()], options: opts }
    );
    pnlChartLarge._roundMode = true;
    applyData(pnlChartLarge);
  }
}

function renderPnlData(data) {
  const withOrigin = [{ holdDays: 0, value: 0 }, ...data];
  const labels = withOrigin.map(d => `${d.holdDays}日`);
  const values = withOrigin.map(d => d.value);
  pnlFinalValue = values[values.length - 1] ?? 0;
  const lineColor = pnlFinalValue >= 0 ? '#10b981' : '#ef4444';

  if (pnlChart) {
    pnlChart.data.labels = labels;
    pnlChart.data.datasets[0].data = values;
    pnlChart.data.datasets[0].borderColor = lineColor;
    pnlChart.data.datasets[0].backgroundColor = pnlFinalValue >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';
    pnlChart.data.datasets[1].data = labels.map(() => 0);
    pnlChart.update('none');
    updatePnlLarge(labels, values, lineColor);
    return;
  }

  const ctx = document.getElementById('pnlChart').getContext('2d');
  pnlChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values,
        borderColor: lineColor,
        backgroundColor: pnlFinalValue >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
        fill: true, tension: 0, pointRadius: 0, borderWidth: 1.5,
      }, {
        data: labels.map(() => 0),
        borderColor: '#4b5563', borderDash: [4, 4],
        borderWidth: 1, pointRadius: 0, fill: false,
      }],
    },
    plugins: [{
      id: 'pnlLabel',
      afterDraw(chart) {
        const { ctx, chartArea: { left, right, top } } = chart;
        const v = pnlFinalValue;
        const label = Math.abs(v) >= 10000
                    ? `${(v / 10000).toFixed(2)}万円`
                    : `${v.toFixed(0)}円`;
        ctx.save();
        ctx.font = 'bold 13px sans-serif';
        ctx.fillStyle = v >= 0 ? '#10b981' : '#ef4444';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, (left + right) / 2, top + 4);
        ctx.restore();
      },
    }],
    options: {
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 3, color: '#6b7280', font: { size: 10 } }, grid: { color: '#1e1e30' } },
        y: {
          ticks: { color: '#6b7280', font: { size: 10 }, callback: v => {
            if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(0)}万`;
            return `${v.toFixed(0)}`;
          }},
          grid: { color: '#1e1e30' },
        },
      },
    },
  });
  updatePnlLarge(labels, values, lineColor);
}

function updatePnlLarge(labels, values, lineColor) {
  const bgColor = pnlFinalValue >= 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';
  if (pnlChartLarge) {
    pnlChartLarge.data.labels = labels;
    pnlChartLarge.data.datasets[0].data = values;
    pnlChartLarge.data.datasets[0].borderColor = lineColor;
    pnlChartLarge.data.datasets[0].backgroundColor = bgColor;
    pnlChartLarge.data.datasets[1].data = labels.map(() => 0);
    pnlChartLarge.update('none');
    return;
  }
  const canvas = document.getElementById('pnlChartLarge');
  if (!canvas) return;
  pnlChartLarge = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values, borderColor: lineColor, backgroundColor: bgColor,
        fill: true, tension: 0, pointRadius: 2, borderWidth: 2,
      }, {
        data: labels.map(() => 0),
        borderColor: '#4b5563', borderDash: [4, 4],
        borderWidth: 1, pointRadius: 0, fill: false,
      }],
    },
    plugins: [{
      id: 'pnlLabelLarge',
      afterDraw(chart) {
        const { ctx, chartArea: { left, right, top } } = chart;
        const v = pnlFinalValue;
        const label = Math.abs(v) >= 10000 ? `${(v/10000).toFixed(2)}万円` : `${v.toFixed(0)}円`;
        ctx.save();
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = v >= 0 ? '#10b981' : '#ef4444';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(label, (left + right) / 2, top + 6);
        ctx.restore();
      },
    }],
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6b7280', font: { size: 12 } }, grid: { color: '#1e1e30' } },
        y: {
          ticks: { color: '#6b7280', font: { size: 12 }, callback: v =>
            Math.abs(v) >= 10000 ? `${(v/10000).toFixed(0)}万` : `${v.toFixed(0)}` },
          grid: { color: '#1e1e30' },
        },
      },
    },
  });
}

// --- 比較シミュレーション ---
function simExecuteOrder(sim, type, symbol, price, buyShares, date) {
  if (type === 'buy') {
    if (!buyShares || buyShares <= 0) return;
    const cost = price * buyShares;
    if (sim.cash < cost) return;
    sim.cash -= cost;
    const pos = sim.longPos[symbol] || { shares: 0, avg_price: 0 };
    const newShares = pos.shares + buyShares;
    pos.avg_price = (pos.avg_price * pos.shares + price * buyShares) / newShares;
    pos.shares = newShares;
    sim.longPos[symbol] = pos;
    if (!sim.openDates[symbol]) sim.openDates[symbol] = date;
  } else if (type === 'sell') {
    const pos = sim.longPos[symbol];
    if (!pos || pos.shares <= 0) return;
    const holdDays = sim.openDates[symbol] ? dateDiffDays(sim.openDates[symbol], date) : 0;
    sim.cumulativeHoldDays += holdDays;
    delete sim.openDates[symbol];
    const realizedPnl = (price - pos.avg_price) * pos.shares;
    sim.cash += price * pos.shares;
    sim.cumulativeRealizedPnl += realizedPnl;
    pos.shares = 0;
    const last = sim.pnlData[sim.pnlData.length - 1];
    if (last && last.holdDays === sim.cumulativeHoldDays) last.value = sim.cumulativeRealizedPnl;
    else sim.pnlData.push({ holdDays: sim.cumulativeHoldDays, value: sim.cumulativeRealizedPnl });
  } else if (type === 'short') {
    if (!buyShares || buyShares <= 0) return;
    sim.cash += price * buyShares;
    const spos = sim.shortPos[symbol] || { shares: 0, avg_price: 0 };
    const newShort = spos.shares + buyShares;
    spos.avg_price = (spos.avg_price * spos.shares + price * buyShares) / newShort;
    spos.shares = newShort;
    sim.shortPos[symbol] = spos;
    if (!sim.openDates[`short_${symbol}`]) sim.openDates[`short_${symbol}`] = date;
  } else if (type === 'cover') {
    const spos = sim.shortPos[symbol];
    if (!spos || spos.shares <= 0) return;
    const cost = price * spos.shares;
    if (sim.cash < cost) return;
    const holdDays = sim.openDates[`short_${symbol}`] ? dateDiffDays(sim.openDates[`short_${symbol}`], date) : 0;
    sim.cumulativeHoldDays += holdDays;
    delete sim.openDates[`short_${symbol}`];
    const realizedPnl = (spos.avg_price - price) * spos.shares;
    sim.cash -= cost;
    sim.cumulativeRealizedPnl += realizedPnl;
    spos.shares = 0;
    const last = sim.pnlData[sim.pnlData.length - 1];
    if (last && last.holdDays === sim.cumulativeHoldDays) last.value = sim.cumulativeRealizedPnl;
    else sim.pnlData.push({ holdDays: sim.cumulativeHoldDays, value: sim.cumulativeRealizedPnl });
  }
}

function renderComparisonChart() {
  // リスク管理（実際）の累積保有日数 vs 累積実現損益
  const riskData = buildHoldDaysData(guest.trades);

  // 3系列の holdDays を合わせて x 軸を構築（常に0を起点とする）
  const allHoldDays = new Set([
    0,
    ...riskData.map(d => d.holdDays),
    ...compSims.percent.pnlData.map(d => d.holdDays),
    ...compSims.shares.pnlData.map(d => d.holdDays),
  ]);
  const sortedHoldDays = [...allHoldDays].sort((a, b) => a - b);

  const riskMap = Object.fromEntries(riskData.map(d => [d.holdDays, d.value]));
  const pctMap  = Object.fromEntries(compSims.percent.pnlData.map(d => [d.holdDays, d.value]));
  const shaMap  = Object.fromEntries(compSims.shares.pnlData.map(d => [d.holdDays, d.value]));

  const fillValues = (map, keys) => {
    let last = 0;
    return keys.map(k => { if (k in map) last = map[k]; return last; });
  };

  const labels        = sortedHoldDays.map(d => `${d}日`);
  const riskValues    = fillValues(riskMap, sortedHoldDays);
  const percentValues = fillValues(pctMap,  sortedHoldDays);
  const sharesValues  = fillValues(shaMap,  sortedHoldDays);

  const pctLabel = `所持金${parseFloat(document.getElementById('percentInput').value)||50}%（仮想）`;
  const shaLabel = `${parseInt(document.getElementById('sharesInput').value)||100}株固定（仮想）`;

  compFinalValues = [
    riskValues[riskValues.length - 1] ?? 0,
    percentValues[percentValues.length - 1] ?? 0,
    sharesValues[sharesValues.length - 1] ?? 0,
  ];
  const allLabels = ['リスク管理（実際）', pctLabel, shaLabel];

  if (comparisonChart) {
    comparisonChart.data.labels = labels;
    [riskValues, percentValues, sharesValues].forEach((vals, i) => {
      comparisonChart.data.datasets[i].data = vals;
      comparisonChart.data.datasets[i].label = allLabels[i];
      comparisonChart.data.datasets[i].borderColor = COMP_COLORS[i].border;
      comparisonChart.data.datasets[i].backgroundColor = COMP_COLORS[i].bg;
    });
    comparisonChart.data.datasets[3].data = labels.map(() => 0);
    comparisonChart.update('none');
    updateComparisonLarge(labels, riskValues, percentValues, sharesValues, allLabels);
    return;
  }

  const ctx = document.getElementById('comparisonChart').getContext('2d');
  comparisonChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        ...([riskValues, percentValues, sharesValues].map((vals, i) => ({
          label: allLabels[i],
          data: vals,
          borderColor: COMP_COLORS[i].border,
          backgroundColor: COMP_COLORS[i].bg,
          fill: true, tension: 0, pointRadius: 0, borderWidth: 1.5,
        }))),
        {
          data: labels.map(() => 0),
          borderColor: '#4b5563', borderDash: [4, 4],
          borderWidth: 1, pointRadius: 0, fill: false, label: '',
        },
      ],
    },
    plugins: [{
      id: 'compLabel',
      afterDraw(chart) {
        const { ctx, chartArea: { left, right, top } } = chart;
        const finals = compFinalValues;
        const spacing = (right - left) / 3;
        finals.forEach((v, i) => {
          const label = Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(2)}万円` : `${v.toFixed(0)}円`;
          ctx.save();
          ctx.font = 'bold 11px sans-serif';
          ctx.fillStyle = COMP_COLORS[i].border;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label, left + spacing * i + spacing / 2, top + 4);
          ctx.restore();
        });
      },
    }],
    options: {
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 10, padding: 8,
            filter: item => item.text !== '',
          },
        },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 3, color: '#6b7280', font: { size: 10 } }, grid: { color: '#1e1e30' } },
        y: {
          ticks: {
            color: '#6b7280', font: { size: 10 },
            callback: v => Math.abs(v) >= 10000 ? `${(v/10000).toFixed(0)}万` : `${v.toFixed(0)}`,
          },
          grid: { color: '#1e1e30' },
        },
      },
    },
  });
  updateComparisonLarge(labels, riskValues, percentValues, sharesValues, allLabels);
}

function updateComparisonLarge(labels, riskValues, percentValues, sharesValues, allLabels) {
  const datasets3 = [riskValues, percentValues, sharesValues].map((vals, i) => ({
    label: allLabels[i], data: vals,
    borderColor: COMP_COLORS[i].border, backgroundColor: COMP_COLORS[i].bg,
    fill: true, tension: 0, pointRadius: 2, borderWidth: 2,
  }));
  if (comparisonChartLarge) {
    comparisonChartLarge.data.labels = labels;
    datasets3.forEach((ds, i) => {
      comparisonChartLarge.data.datasets[i].data = ds.data;
      comparisonChartLarge.data.datasets[i].label = ds.label;
    });
    comparisonChartLarge.data.datasets[3].data = labels.map(() => 0);
    comparisonChartLarge.update('none');
    return;
  }
  const canvas = document.getElementById('comparisonChartLarge');
  if (!canvas) return;
  comparisonChartLarge = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        ...datasets3,
        { data: labels.map(() => 0), borderColor: '#4b5563', borderDash: [4, 4], borderWidth: 1, pointRadius: 0, fill: false, label: '' },
      ],
    },
    plugins: [{
      id: 'compLabelLarge',
      afterDraw(chart) {
        const { ctx, chartArea: { left, right, top } } = chart;
        const spacing = (right - left) / 3;
        compFinalValues.forEach((v, i) => {
          const label = Math.abs(v) >= 10000 ? `${(v/10000).toFixed(2)}万円` : `${v.toFixed(0)}円`;
          ctx.save();
          ctx.font = 'bold 14px sans-serif';
          ctx.fillStyle = COMP_COLORS[i].border;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label, left + spacing * i + spacing / 2, top + 6);
          ctx.restore();
        });
      },
    }],
    options: {
      animation: false,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true, position: 'top',
          labels: { color: '#9ca3af', font: { size: 12 }, boxWidth: 12, padding: 12,
            filter: item => item.text !== '' },
        },
      },
      scales: {
        x: { ticks: { color: '#6b7280', font: { size: 12 } }, grid: { color: '#1e1e30' } },
        y: {
          ticks: { color: '#6b7280', font: { size: 12 },
            callback: v => Math.abs(v) >= 10000 ? `${(v/10000).toFixed(0)}万` : `${v.toFixed(0)}` },
          grid: { color: '#1e1e30' },
        },
      },
    },
  });
}

function updateComparisonVisibility() {
  const card = document.getElementById('comparisonCard');
  const isRisk = getOrderMode() === 'risk';
  card.style.display = isRisk ? '' : 'none';
  const compTab = document.getElementById('compViewTab');
  if (compTab) compTab.style.display = isRisk ? '' : 'none';
  if (!isRisk) switchView('candle');
  if (isRisk) renderComparisonChart();
}

// --- Order mode ---
function getOrderMode() {
  return document.querySelector('.mode-btn.active')?.dataset.mode || 'shares';
}

function getCurrentCash() {
  return guest.cash;
}

function getTotalAssets(price) {
  let posVal = 0;
  for (const [, pos] of Object.entries(guest.longPos))  if (pos.shares > 0) posVal += price * pos.shares;
  for (const [, pos] of Object.entries(guest.shortPos)) if (pos.shares > 0) posVal -= price * pos.shares;
  return guest.cash + posVal;
}

function getEffectiveShares(price) {
  if (!price) return 0;
  const mode = getOrderMode();
  if (mode === 'percent') {
    const pct = parseFloat(document.getElementById('percentInput').value) || 0;
    return Math.floor((getCurrentCash() * pct / 100) / price);
  }
  if (mode === 'risk') {
    const R = parseFloat(document.getElementById('riskRateInput').value) || 0;
    const S = parseFloat(document.getElementById('riskStopInput').value) || 0;
    if (!R || !S) return 0;
    return Math.floor(getTotalAssets(price) * R / (price * S));
  }
  return parseInt(document.getElementById('sharesInput').value) || 0;
}

// --- Order ---
function updateOrderPreview() {
  if (!currentCandles.length) return;
  const price = currentCandles[currentCandles.length - 1]?.close || 0;
  const mode = getOrderMode();
  const el = document.getElementById('orderPreview');
  if (mode === 'risk') {
    const R = parseFloat(document.getElementById('riskRateInput').value) || 0;
    const S = parseFloat(document.getElementById('riskStopInput').value) || 0;
    const shares = getEffectiveShares(price);
    if (!R || !S) { el.textContent = 'R・Sを入力してください'; return; }
    if (!shares) { el.textContent = '株数: 0株（パラメータを確認）'; return; }
    const riskAmt = Math.round(getTotalAssets(price) * R / 100);
    el.textContent = `翌日始値で約定（${shares}株、許容損失: ${fmt(riskAmt)}円、参考: ${fmt(price * shares)}円）`;
    return;
  }
  const shares = getEffectiveShares(price);
  if (!price || !shares) { el.textContent = ''; return; }
  const pct = mode === 'percent' ? ` (${document.getElementById('percentInput').value}%)` : '';
  el.textContent = `翌日始値で約定（参考: ${fmt(price * shares)}円、${fmt(price)}円 × ${shares}株${pct}）`;
}

function updatePendingDisplay(orders) {
  const el = document.getElementById('pendingOrders');
  if (!orders || !orders.length) { el.innerHTML = ''; return; }
  const labels = { buy: '買', sell: '売', short: '空売', cover: '買戻' };
  el.innerHTML = '<div class="pending-label">注文中（翌日始値で約定）:</div>' +
    orders.map(o => `<div class="pending-item">${labels[o.type] || o.type} ${o.shares}株</div>`).join('');
}

async function executeOrder(orderType) {
  const msgEl = document.getElementById('orderMsg');
  if (!gameActive) return;
  const price = currentCandles[currentCandles.length - 1]?.close;
  const shares = getEffectiveShares(price);
  if (!currentSymbol || !shares || shares <= 0) return;
  if (!price) { msgEl.textContent = '価格データがありません'; msgEl.className = 'msg error'; return; }
  // 比較シミュレーション用の株数を注文時終値で計算（実際のモードと同じタイミング）
  const pctInput = parseFloat(document.getElementById('percentInput').value) || 50;
  const fixInput = parseInt(document.getElementById('sharesInput').value) || 100;
  const simPctShares = Math.floor(compSims.percent.cash * pctInput / 100 / price);
  const stopPct = getOrderMode() === 'risk' ? (parseFloat(document.getElementById('riskStopInput').value) || 0) : 0;
  guest.pendingOrders.push({ type: orderType, symbol: currentSymbol, shares, stopPct, simPctShares, simFixShares: fixInput });
  await nextDay();
}

// --- ブラインドモード ---
function applyBlindChartOptions() {
  const opts = { crosshair: { vertLine: { labelVisible: !blindMode } } };
  const tsOpts = { timeScale: { visible: !blindMode } };
  [lwChart, volChart, rsiChartInst, macdChartInst].forEach(c => {
    if (c) { c.applyOptions(opts); c.applyOptions(tsOpts); }
  });
}

function setBlindMode(on) {
  blindMode = on;
  const btn = document.getElementById('blindModeBtn');
  btn.classList.toggle('blind-active', blindMode);
  btn.textContent = blindMode ? '👁 公開' : '🙈 ブラインド';
  document.getElementById('currentSymbol').textContent =
    blindMode ? '???' : blindActualSymbol;
  document.getElementById('currentDate').textContent =
    blindMode ? `${blindDayCount}日目` : blindActualDate;
  applyBlindChartOptions();
  refreshState();
}

// --- Events ---
function setupEvents() {
  document.getElementById('startGameBtn').addEventListener('click', startGame);
  document.getElementById('newGameBtn').addEventListener('click', changeStock);
  document.getElementById('nextDayBtn').addEventListener('click', nextDay);
  document.getElementById('resetTradeBtn').addEventListener('click', resetTradeHistory);
  document.getElementById('autoAdvanceBtn').addEventListener('click', toggleAutoAdvance);
  document.getElementById('roundModeBtn').addEventListener('click', async (e) => {
    e.currentTarget.blur();
    try {
      await startRoundMode();
    } catch (err) {
      console.error('[roundModeBtn] startRoundMode threw:', err);
      alert(`3Rモード開始エラー: ${err.message ?? err}`);
    }
  });
  document.getElementById('endRoundModeBtn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    endRoundMode();
  });
  document.getElementById('finishRoundBtn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (!roundMode && !restoreRoundSession()) {
      updateRoundUI(); // stale なら非表示に
      return;
    }
    finishCurrentRound();
  });
  document.getElementById('nextRoundBtn').addEventListener('click', async (e) => {
    e.currentTarget.blur();
    // roundMode が false のとき（UI が stale な場合）はセッション復元を試みる
    if (!roundMode) {
      if (!restoreRoundSession()) {
        // 復元不可ならボタンを隠してクリーンアップ
        document.getElementById('nextRoundBtn').style.display = 'none';
        document.getElementById('roundIndicator').style.display = 'none';
        document.getElementById('roundModeBtn').style.display = '';
        document.getElementById('newGameBtn').style.display = '';
        return;
      }
    }
    if (currentRound >= 3) { switchView('analysis'); }
    else { await nextRound(); }
  });

  document.getElementById('blindModeBtn').addEventListener('click', () => {
    setBlindMode(!blindMode);
  });

  colorInputIds.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', e => {
      chartColors[colorKeys[i]] = e.target.value;
      saveChartColors();
      applyChartColors();
    });
  });

  document.getElementById('applyDefaultBarsBtn').addEventListener('click', () => {
    saveDefaultBars(document.getElementById('defaultBarsInput').value);
    saveDefaultBarsWeekly(document.getElementById('defaultBarsWeeklyInput').value);
    saveDefaultBarsMonthly(document.getElementById('defaultBarsMonthlyInput').value);
    // 現在のタイムフレームに即反映
    applyDefaultBarsNow();
    // 確定メッセージを一瞬表示
    const msg = document.getElementById('defaultBarsAppliedMsg');
    msg.textContent = '✔ 保存しました';
    msg.style.opacity = '1';
    setTimeout(() => { msg.style.opacity = '0'; }, 1500);
  });

  document.getElementById('resetColorsBtn').addEventListener('click', () => {
    chartColors = { ...DEFAULT_COLORS };
    saveChartColors();
    colorInputIds.forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.value = chartColors[colorKeys[i]];
    });
    applyChartColors();
  });

  const indicatorCheckboxes = [
    { id: 'showBB',   key: 'showBB' },
    { id: 'showBB3',  key: 'showBB3' },
    { id: 'showRSI',  key: 'showRSI' },
    { id: 'showMACD', key: 'showMACD' },
  ];
  indicatorCheckboxes.forEach(({ id, key }) => {
    document.getElementById(id).addEventListener('change', e => {
      indicatorSettings[key] = e.target.checked;
      saveIndicatorSettings();
      applyIndicatorVisibility();
    });
  });

  document.getElementById('sharesInput').addEventListener('input', updateOrderPreview);
  document.getElementById('percentInput').addEventListener('input', updateOrderPreview);
  document.getElementById('riskRateInput').addEventListener('input', updateOrderPreview);
  document.getElementById('riskStopInput').addEventListener('input', updateOrderPreview);
  document.getElementById('autoStopEnabled').addEventListener('change', function () {
    document.getElementById('slippageRow').style.display = this.checked ? '' : 'none';
  });

  document.querySelector('.order-tab[data-type="buy"]').addEventListener('click', async (e) => {
    e.currentTarget.blur();
    if (gameActive) await executeOrder('buy');
  });
  document.querySelector('.order-tab[data-type="short"]').addEventListener('click', async (e) => {
    e.currentTarget.blur();
    if (gameActive) await executeOrder('short');
  });

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      document.getElementById('sharesModeInput').classList.toggle('hidden', mode !== 'shares');
      document.getElementById('percentModeInput').classList.toggle('hidden', mode !== 'percent');
      document.getElementById('riskModeInput').classList.toggle('hidden', mode !== 'risk');
      updateOrderPreview();
      updateComparisonVisibility();
    });
  });

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.pct)    { document.getElementById('percentInput').value  = btn.dataset.pct; }
      if (btn.dataset.riskR)  { document.getElementById('riskRateInput').value = btn.dataset.riskR; }
      if (btn.dataset.riskS)  { document.getElementById('riskStopInput').value = btn.dataset.riskS; }
      updateOrderPreview();
    });
  });

  document.getElementById('ma1Days').addEventListener('input', () => {
    ma1 = parseInt(document.getElementById('ma1Days').value) || 25;
    if (currentCandles.length) ma1Series.setData(calcMA(currentCandles, ma1));
  });
  document.getElementById('ma2Days').addEventListener('input', () => {
    ma2 = parseInt(document.getElementById('ma2Days').value) || 75;
    if (currentCandles.length) ma2Series.setData(calcMA(currentCandles, ma2));
  });
  document.getElementById('ma3Days').addEventListener('input', () => {
    ma3 = parseInt(document.getElementById('ma3Days').value) || 200;
    if (currentCandles.length) ma3Series.setData(calcMA(currentCandles, ma3));
  });

  const slider = document.getElementById('rangeSlider');
  slider.addEventListener('input', () => {
    userZoomSet = true;
    applySliderToChart(parseInt(slider.value));
    document.getElementById('rangeLabel').textContent = `${slider.value}本表示`;
  });

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); if (gameActive) nextDay(); return; }
    const key = eventToKeyString(e);
    if (keyboardShortcuts.buy && key === keyboardShortcuts.buy) {
      e.preventDefault();
      document.querySelector('.order-tab[data-type="buy"]')?.click();
    } else if (keyboardShortcuts.short && key === keyboardShortcuts.short) {
      e.preventDefault();
      document.querySelector('.order-tab[data-type="short"]')?.click();
    } else if (keyboardShortcuts.close && key === keyboardShortcuts.close) {
      e.preventDefault();
      const execBtn = document.getElementById('executeBtn');
      if (execBtn && execBtn.style.display !== 'none') execBtn.click();
    } else if (keyboardShortcuts.changeSymbol && key === keyboardShortcuts.changeSymbol) {
      e.preventDefault();
      changeStock();
    } else if (e.code === 'KeyN' && !keyboardShortcuts.changeSymbol) {
      changeStock();
    }
  });

  // --- 銘柄検索 ---
  const searchInput = document.getElementById('symbolSearch');
  const searchDropdown = document.getElementById('searchDropdown');
  let searchTimer = null;
  let searchResults = [];
  let searchActiveIdx = -1;

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { searchDropdown.classList.add('hidden'); searchResults = []; return; }
    searchTimer = setTimeout(() => fetchSearchResults(q), 180);
  });

  searchInput.addEventListener('keydown', e => {
    if (searchDropdown.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      searchActiveIdx = Math.min(searchActiveIdx + 1, searchResults.length - 1);
      renderSearchDropdown();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      searchActiveIdx = Math.max(searchActiveIdx - 1, -1);
      renderSearchDropdown();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (searchActiveIdx >= 0 && searchResults[searchActiveIdx]) {
        pickSearchResult(searchResults[searchActiveIdx]);
      }
    } else if (e.key === 'Escape') {
      searchDropdown.classList.add('hidden');
      searchInput.blur();
    }
  });

  searchInput.addEventListener('focus', () => {
    if (searchResults.length) searchDropdown.classList.remove('hidden');
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) searchDropdown.classList.add('hidden');
  });

  async function fetchSearchResults(q) {
    try {
      searchResults = await window.api.invoke('stocks:search', { q });
    } catch { searchResults = []; }
    searchActiveIdx = -1;
    renderSearchDropdown();
  }

  function renderSearchDropdown() {
    if (!searchResults.length) {
      searchDropdown.innerHTML = '<div class="search-empty">該当なし</div>';
    } else {
      searchDropdown.innerHTML = searchResults.map((r, i) => `
        <div class="search-result${i === searchActiveIdx ? ' active' : ''}${r.hasData === false ? ' no-data' : ''}" data-idx="${i}">
          <span class="search-code">${r.symbol}</span>
          <span class="search-name">${r.name || r.symbol}${r.hasData === false ? ' <span class="no-data-badge">未取得</span>' : ''}</span>
        </div>
      `).join('');
      searchDropdown.querySelectorAll('.search-result').forEach(el => {
        el.addEventListener('mousedown', e => {
          e.preventDefault();
          pickSearchResult(searchResults[+el.dataset.idx]);
        });
      });
    }
    searchDropdown.classList.remove('hidden');
  }

  function pickSearchResult(result) {
    searchDropdown.classList.add('hidden');
    searchInput.value = '';
    searchResults = [];
    changeToSymbol(result.symbol, result.name, result.oldName);
  }

  // --- 時間足タブ (日足 / 週足 / 月足) ---
  document.querySelectorAll('.tf-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.tf === currentTimeframe) return; // 変化なし
      document.querySelectorAll('.tf-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTimeframe = btn.dataset.tf;
      userZoomSet = false; // タイムフレーム切替時は defaultBars で再描画
      if (gameActive) await refreshChart();
    });
  });
}

init();

// ===== ビュータブ切替 =====
function switchView(view) {
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  document.getElementById('candleView').style.display      = view === 'candle'     ? '' : 'none';
  document.getElementById('pnlView').style.display         = view === 'pnl'        ? '' : 'none';
  document.getElementById('comparisonView').style.display  = view === 'comparison' ? '' : 'none';
  document.getElementById('analysisView').style.display    = view === 'analysis'   ? '' : 'none';
  document.getElementById('settingsView').style.display    = view === 'settings'   ? '' : 'none';
  if (view === 'pnl' && pnlChartLarge) pnlChartLarge.resize();
  if (view === 'comparison' && comparisonChartLarge) comparisonChartLarge.resize();
  if (view === 'settings' && typeof syncSettingsInputs === 'function') syncSettingsInputs();
  if (view === 'analysis') renderAnalysis();
}

document.querySelectorAll('.view-tab').forEach(tab => {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
});

// ===== 設定モーダル タブ切替 & データ管理 =====
(function () {
  setupShortcutUI();
  renderShortcutDisplays();

  // タブ切替
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById('tab' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)).classList.remove('hidden');
      if (tab.dataset.tab === 'data') loadAdminStats();
    });
  });

  let allSymbols = [];

  async function loadAdminStats() {
    try {
      const data = await window.api.invoke('admin:stats');
      document.getElementById('statSymbols').textContent = data.symbolCount.toLocaleString();
      document.getElementById('statRows').textContent = data.rowCount.toLocaleString();
      allSymbols = data.symbols;
      renderSymbolTable(allSymbols);
    } catch (e) {
      console.error('admin stats error', e);
    }
  }

  async function loadFormats() {
    try {
      const formats = await window.api.invoke('admin:formats');
      const sel = document.getElementById('formatSelect');
      sel.innerHTML = formats.map(f => `<option value="${f.id}">${f.label}</option>`).join('');
    } catch (e) {
      console.error('formats load error', e);
    }
  }
  loadFormats();

  function renderSymbolTable(rows) {
    const tbody = document.getElementById('symbolTableBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text2);text-align:center;padding:12px">データなし</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(s => `
      <tr>
        <td style="font-weight:700;color:var(--accent)">${s.symbol}</td>
        <td style="color:var(--text2)">${s.name || ''}</td>
        <td>${s.rows.toLocaleString()}</td>
        <td style="color:var(--text2);font-size:10px">${s.from_date}<br>${s.to_date}</td>
        <td><button class="sym-del-btn" data-sym="${s.symbol}">削除</button></td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.sym-del-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteSymbol(btn.dataset.sym));
    });
  }

  document.getElementById('symbolFilter').addEventListener('input', function () {
    const q = this.value.trim().toLowerCase();
    renderSymbolTable(q ? allSymbols.filter(s =>
      s.symbol.toLowerCase().includes(q) || (s.name && s.name.toLowerCase().includes(q))
    ) : allSymbols);
  });

  // 銘柄リスト更新（JPX XLS）
  const symbolsXlsPicker    = document.getElementById('symbolsXlsPicker');
  const symbolsXlsSelectBtn = document.getElementById('symbolsXlsSelectBtn');
  const symbolsXlsName      = document.getElementById('symbolsXlsName');
  const symbolsXlsImportBtn = document.getElementById('symbolsXlsImportBtn');
  const symbolsXlsResult    = document.getElementById('symbolsXlsResult');
  let selectedXlsFilePath = null;

  // ネイティブファイルダイアログでXLSXを選択
  symbolsXlsSelectBtn.addEventListener('click', async () => {
    const result = await window.api.invoke('dialog:openFile', {
      filters: [{ name: 'Excel', extensions: ['xls', 'xlsx'] }],
    });
    if (result.canceled || !result.filePaths.length) return;
    selectedXlsFilePath = result.filePaths[0];
    symbolsXlsName.textContent = selectedXlsFilePath.split(/[\\/]/).pop();
    symbolsXlsImportBtn.disabled = false;
  });

  symbolsXlsImportBtn.addEventListener('click', async () => {
    if (!selectedXlsFilePath) return;
    symbolsXlsImportBtn.disabled = true;
    symbolsXlsImportBtn.textContent = '更新中...';
    symbolsXlsResult.className = 'import-result hidden';

    try {
      const data = await window.api.invoke('admin:update-symbols', { filePath: selectedXlsFilePath });
      symbolsXlsResult.className = 'import-result success';
      symbolsXlsResult.textContent =
        `更新完了（計${data.total.toLocaleString()}銘柄）: 名称変更 ${data.updated} / 新規追加 ${data.newAdded} / 上場廃止 ${data.delisted} / 変更なし ${data.unchanged}`;
      loadAdminStats();
    } catch (err) {
      symbolsXlsResult.className = 'import-result error';
      symbolsXlsResult.textContent = 'エラー: ' + err.message;
    } finally {
      symbolsXlsResult.classList.remove('hidden');
      symbolsXlsImportBtn.disabled = false;
      symbolsXlsImportBtn.textContent = '更新開始';
    }
  });

  // フォルダ選択（ネイティブディレクトリダイアログ）
  const folderSelectBtn = document.getElementById('folderSelectBtn');
  const selectedFolderName = document.getElementById('selectedFolderName');
  const importBtn = document.getElementById('importBtn');
  let selectedFolderPath = null;

  folderSelectBtn.addEventListener('click', async () => {
    const result = await window.api.invoke('dialog:openDirectory', {});
    if (result.canceled || !result.filePaths.length) return;
    selectedFolderPath = result.filePaths[0];
    selectedFolderName.textContent = selectedFolderPath.split(/[\\/]/).pop();
    importBtn.disabled = false;
  });

  importBtn.addEventListener('click', async () => {
    if (!selectedFolderPath) return;

    importBtn.disabled = true;
    importBtn.textContent = '取込中...';

    const progressWrap = document.getElementById('progressWrap');
    const progressBar  = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const resultBox    = document.getElementById('importResult');

    progressWrap.classList.remove('hidden');
    resultBox.classList.add('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = '準備中...';

    // IPC push イベントで進捗を受け取る
    const unsubscribe = window.api.on('admin:import:progress', (msg) => {
      if (msg.type === 'progress') {
        const pct = msg.total ? Math.round(msg.done / msg.total * 100) : 0;
        progressBar.style.width = pct + '%';
        progressText.textContent = `${msg.done} / ${msg.total} ファイル処理中${msg.symbol ? ` (${msg.symbol})` : ''}`;
      } else if (msg.type === 'done') {
        progressBar.style.width = '100%';
        progressText.textContent = '完了';
        resultBox.className = 'import-result success';
        resultBox.classList.remove('hidden');
        resultBox.textContent = `取込完了：${msg.imported} 銘柄 / ${msg.totalRows?.toLocaleString() ?? 0} 行` +
          (msg.errors?.length ? ` (エラー ${msg.errors.length} 件)` : '');
        loadAdminStats();
      } else if (msg.type === 'error') {
        resultBox.className = 'import-result error';
        resultBox.classList.remove('hidden');
        resultBox.textContent = msg.message;
      }
    });

    try {
      const formatId = document.getElementById('formatSelect').value;
      await window.api.invoke('admin:import', { folderPath: selectedFolderPath, formatId });
    } catch (err) {
      resultBox.className = 'import-result error';
      resultBox.classList.remove('hidden');
      resultBox.textContent = 'エラー: ' + err.message;
    } finally {
      unsubscribe();
      importBtn.disabled = false;
      importBtn.textContent = '取込開始';
    }
  });

  async function deleteSymbol(symbol) {
    if (!confirm(`${symbol} のデータを削除しますか？`)) return;
    await window.api.invoke('admin:delete-symbol', { symbol });
    loadAdminStats();
  }

  // --- J-Quants ---
  (async function loadJqStatus() {
    try {
      const s = await window.api.invoke('admin:jquants:status');
      const bar = document.getElementById('jqStatusBar');
      bar.classList.remove('hidden');
      if (s.configured) {
        bar.className = 'import-result success';
        bar.textContent = `J-Quants APIキー設定済み: ${s.maskedKey}`;
      } else {
        bar.className = 'import-result';
        bar.style.background = 'rgba(239,68,68,0.08)';
        bar.style.color = 'var(--up)';
        bar.textContent = 'J-Quants APIキー未設定';
      }
    } catch {}
  })();

  document.getElementById('jqSaveKeyBtn').addEventListener('click', async () => {
    const apiKey = document.getElementById('jqApiKeyInput').value.trim();
    if (!apiKey) { alert('APIキーを入力してください'); return; }
    const btn = document.getElementById('jqSaveKeyBtn');
    btn.disabled = true; btn.textContent = 'テスト中...';
    try {
      const data = await window.api.invoke('admin:jquants:credentials', { apiKey });
      const bar = document.getElementById('jqStatusBar');
      bar.classList.remove('hidden');
      bar.className = 'import-result success';
      bar.textContent = `接続成功：APIキーを保存しました（${data.status?.maskedKey ?? ''}）`;
      document.getElementById('jqApiKeyInput').value = '';
    } catch (err) {
      const bar = document.getElementById('jqStatusBar');
      bar.classList.remove('hidden');
      bar.className = 'import-result error';
      bar.textContent = 'エラー: ' + err.message;
    } finally {
      btn.disabled = false; btn.textContent = '保存・テスト';
    }
  });

  function formatEta(remainingMs) {
    if (remainingMs <= 0) return '';
    const s = Math.ceil(remainingMs / 1000);
    if (s < 60) return `残り約${s}秒`;
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (m < 60) return `残り約${m}分${sec > 0 ? sec + '秒' : ''}`;
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `残り約${h}時間${min > 0 ? min + '分' : ''}`;
  }

  // channel: 'admin:jquants:update' | 'admin:jquants:fill'
  function startJqAutoDownload(channel, body) {
    const updateBtn   = document.getElementById('jqUpdateBtn');
    const fillBtn     = document.getElementById('jqFillBtn');
    const stopBtn     = document.getElementById('jqStopBtn');
    const progressWrap = document.getElementById('jqAutoProgressWrap');
    const progressBar  = document.getElementById('jqAutoProgressBar');
    const progressText = document.getElementById('jqAutoProgressText');
    const resultBox    = document.getElementById('jqAutoResult');

    updateBtn.disabled = true; fillBtn.disabled = true;
    stopBtn.classList.remove('hidden');
    progressWrap.classList.remove('hidden');
    resultBox.classList.add('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = '準備中...';

    stopBtn.onclick = () => window.api.invoke('admin:jquants:stop');

    const autoStartTime = Date.now();
    const unsubscribe = window.api.on('admin:jquants:progress', (msg) => {
      if (msg.type === 'progress') {
        const pct = msg.total ? Math.round(msg.done / msg.total * 100) : 0;
        progressBar.style.width = pct + '%';
        let etaStr = '';
        if (msg.done > 0 && msg.total > 0) {
          const elapsed = Date.now() - autoStartTime;
          const remaining = (msg.total - msg.done) * (elapsed / msg.done);
          etaStr = ' — ' + formatEta(remaining);
        }
        progressText.textContent = `${msg.done} / ${msg.total} 日付取得中${msg.symbol ? ` (${msg.symbol})` : ''}${etaStr}`;
      } else if (msg.type === 'done') {
        progressBar.style.width = '100%';
        progressText.textContent = '完了';
        resultBox.className = 'import-result success';
        resultBox.classList.remove('hidden');
        resultBox.textContent = `完了：${msg.totalInserted?.toLocaleString() ?? 0} 行追加` +
          (msg.errors?.length ? ` (エラー ${msg.errors.length} 件)` : '');
        loadAdminStats();
      } else if (msg.type === 'error') {
        resultBox.className = 'import-result error';
        resultBox.classList.remove('hidden');
        resultBox.textContent = msg.message;
      }
    });

    window.api.invoke(channel, body || {})
      .catch(() => {})
      .finally(() => {
        unsubscribe();
        updateBtn.disabled = false; fillBtn.disabled = false;
        stopBtn.classList.add('hidden');
      });
  }

  document.getElementById('jqDownloadBtn').addEventListener('click', async () => {
    const raw = document.getElementById('jqSymbols').value;
    const symbols = raw.split(/[\s,、，]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) { alert('銘柄コードを入力してください'); return; }
    const period1 = document.getElementById('jqPeriod1').value;
    const period2 = document.getElementById('jqPeriod2').value;
    if (!period1 || !period2) { alert('取得期間を指定してください'); return; }

    const btn = document.getElementById('jqDownloadBtn');
    btn.disabled = true; btn.textContent = '取得中...';
    const progressWrap = document.getElementById('jqProgressWrap');
    const progressBar  = document.getElementById('jqProgressBar');
    const progressText = document.getElementById('jqProgressText');
    const resultBox    = document.getElementById('jqResult');
    progressWrap.classList.remove('hidden');
    resultBox.classList.add('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = '準備中...';

    const dlStartTime = Date.now();
    const unsubscribe = window.api.on('admin:jquants:progress', (msg) => {
      if (msg.type === 'progress') {
        const pct = msg.total ? Math.round(msg.done / msg.total * 100) : 0;
        progressBar.style.width = pct + '%';
        let etaStr = '';
        if (msg.done > 0 && msg.total > 0) {
          const elapsed = Date.now() - dlStartTime;
          const remaining = (msg.total - msg.done) * (elapsed / msg.done);
          etaStr = ' — ' + formatEta(remaining);
        }
        progressText.textContent = `${msg.done} / ${msg.total} 銘柄取得中${msg.symbol ? ` (${msg.symbol})` : ''}${etaStr}`;
      } else if (msg.type === 'done') {
        progressBar.style.width = '100%';
        progressText.textContent = '完了';
        resultBox.className = 'import-result success';
        resultBox.classList.remove('hidden');
        resultBox.textContent = `取得完了：${msg.total ?? symbols.length} 銘柄 / ${msg.totalInserted?.toLocaleString() ?? 0} 行追加` +
          (msg.errors?.length ? ` (エラー ${msg.errors.length} 件)` : '');
        loadAdminStats();
      } else if (msg.type === 'error') {
        resultBox.className = 'import-result error';
        resultBox.classList.remove('hidden');
        resultBox.textContent = msg.message;
      }
    });

    try {
      await window.api.invoke('admin:jquants:download', { symbols, period1, period2 });
    } catch (err) {
      resultBox.className = 'import-result error';
      resultBox.classList.remove('hidden');
      resultBox.textContent = 'エラー: ' + err.message;
    } finally {
      unsubscribe();
      btn.disabled = false; btn.textContent = '取得開始';
    }
  });

  // J-Quants 日付初期化
  (function() {
    const fmt = d => d.toISOString().slice(0, 10);
    const today = new Date();

    // 個別銘柄ダウンロードのデフォルト（過去1年）
    const from1y = new Date(today); from1y.setFullYear(today.getFullYear() - 1);
    document.getElementById('jqPeriod1').value = fmt(from1y);
    document.getElementById('jqPeriod2').value = fmt(today);

    // 一括取得のデフォルト終了日=今日
    document.getElementById('jqAutoTo').value = fmt(today);

    // プランテーブルの開始日目安を計算して表示
    const plans = [
      { elId: 'jqPlanDate0', years: 2 },
      { elId: 'jqPlanDate1', years: 5 },
      { elId: 'jqPlanDate2', years: 10 },
      { elId: 'jqPlanDate3', years: 20 },
    ];
    plans.forEach(p => {
      const d = new Date(today);
      d.setFullYear(d.getFullYear() - p.years);
      const el = document.getElementById(p.elId);
      if (el) el.textContent = fmt(d);
    });

    // クイック設定ボタン
    let selectedPlan = null;
    document.querySelectorAll('.btn-jq-plan').forEach(btn => {
      btn.addEventListener('click', () => {
        const fromDate = new Date(today);
        fromDate.setFullYear(fromDate.getFullYear() - parseInt(btn.dataset.years));
        document.getElementById('jqAutoFrom').value = fmt(fromDate);
        // Freeプランは終了日も12週前に設定
        if (btn.dataset.toWeeks) {
          const toDate = new Date(today);
          toDate.setDate(toDate.getDate() - parseInt(btn.dataset.toWeeks) * 7);
          document.getElementById('jqAutoTo').value = fmt(toDate);
        } else {
          document.getElementById('jqAutoTo').value = fmt(today);
        }
        selectedPlan = btn.dataset.plan || null;
        document.querySelectorAll('.btn-jq-plan').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.getElementById('jqGapFillBtn').addEventListener('click', () => {
      if (!confirm('DBにある全銘柄の欠損期間（最終日〜今日）をJ-Quantsで補完します。銘柄数が多い場合は時間がかかります。続行しますか？')) return;
      startJqAutoDownload('admin:jquants:gap-fill', {});
    });

    document.getElementById('jqUpdateBtn').addEventListener('click', () => {
      const period2 = document.getElementById('jqAutoTo').value || null;
      startJqAutoDownload('admin:jquants:update', { period2, plan: selectedPlan });
    });
    document.getElementById('jqFillBtn').addEventListener('click', () => {
      const period1 = document.getElementById('jqAutoFrom').value;
      const period2 = document.getElementById('jqAutoTo').value || null;
      if (!period1) { alert('取得開始日を指定してください'); return; }
      if (!confirm(`DBにない全銘柄を ${period1} 〜 ${period2 || '今日'} で取得します。時間がかかる場合があります。続行しますか？`)) return;
      startJqAutoDownload('admin:jquants:fill', { period1, period2, plan: selectedPlan });
    });
  })();

})();

// ===== 分析タブ =====
let holdPnlChartInst = null;
let maeMfeChartInst  = null;

/** 決済時点の guest.all_dates を使って MAE/MFE/保有日数/終値バーを計算 */
function computeCloseMetrics(entryDate, exitDate, entryPrice, kind) {
  const { mae, mfe } = calcMAEMFE({ entryDate, exitDate, entryPrice, kind, mae: undefined, mfe: undefined });
  const holdDays = calcHoldDays(entryDate, exitDate);
  const bar = guest.all_dates?.find(d => d.date === exitDate);
  return { mae, mfe, holdDays, exitBarHigh: bar?.high ?? bar?.close ?? 0, exitBarLow: bar?.low ?? bar?.close ?? 0 };
}

/** buy→sell / short→cover をペアリング（全銘柄対象） */
function buildTradePairs() {
  const pairs = [];
  const longStack  = [];
  const shortStack = [];
  for (const t of guest.trades) {
    if (t.type === 'buy') {
      longStack.push({ ...t });
    } else if (t.type === 'sell' && t.realizedPnl !== undefined) {
      const entry = longStack.pop();
      if (entry) pairs.push({
        kind: 'long', entryDate: entry.date, exitDate: t.date,
        entryPrice: entry.price, exitPrice: t.price, shares: t.shares,
        realizedPnl: t.realizedPnl, symbol: t.symbol,
        mae: t.mae, mfe: t.mfe, holdDays: t.holdDays,
        exitBarHigh: t.exitBarHigh, exitBarLow: t.exitBarLow,
        round: t.round, sessionId: t.sessionId,
      });
    } else if (t.type === 'short') {
      shortStack.push({ ...t });
    } else if (t.type === 'cover' && t.realizedPnl !== undefined) {
      const entry = shortStack.pop();
      if (entry) pairs.push({
        kind: 'short', entryDate: entry.date, exitDate: t.date,
        entryPrice: entry.price, exitPrice: t.price, shares: t.shares,
        realizedPnl: t.realizedPnl, symbol: t.symbol,
        mae: t.mae, mfe: t.mfe, holdDays: t.holdDays,
        exitBarHigh: t.exitBarHigh, exitBarLow: t.exitBarLow,
        round: t.round, sessionId: t.sessionId,
      });
    }
  }
  return pairs.sort((a, b) => a.exitDate < b.exitDate ? -1 : a.exitDate > b.exitDate ? 1 : 0);
}

/** エントリー〜決済間の保有日数（取引日ベース） */
function calcHoldDays(entryDate, exitDate) {
  if (!guest.all_dates) return 0;
  const entry = guest.all_dates.findIndex(d => d.date >= entryDate);
  const exit  = guest.all_dates.findIndex(d => d.date >= exitDate);
  if (entry < 0 || exit < 0) return 0;
  return Math.max(0, exit - entry);
}

/** MAE（最大逆行幅%）/ MFE（最大順行幅%）を計算 */
function calcMAEMFE(pair) {
  if (pair.mae !== undefined && pair.mfe !== undefined) return { mae: pair.mae, mfe: pair.mfe };
  if (!guest.all_dates || !guest.all_dates.length) return { mae: 0, mfe: 0 };
  const bars = guest.all_dates.filter(d => d.date >= pair.entryDate && d.date <= pair.exitDate);
  if (!bars.length) return { mae: 0, mfe: 0 };
  const ep = pair.entryPrice;
  if (!ep) return { mae: 0, mfe: 0 };
  const highs = bars.map(b => b.high ?? b.close).filter(v => v != null && isFinite(v));
  const lows  = bars.map(b => b.low  ?? b.close).filter(v => v != null && isFinite(v));
  if (!highs.length || !lows.length) return { mae: 0, mfe: 0 };
  const maxH = Math.max(...highs);
  const minL = Math.min(...lows);
  if (pair.kind === 'long') {
    return { mfe: +((maxH - ep) / ep * 100).toFixed(2), mae: +((minL - ep) / ep * 100).toFixed(2) };
  } else {
    return { mfe: +((ep - minL) / ep * 100).toFixed(2), mae: +((ep - maxH) / ep * 100).toFixed(2) };
  }
}

/** pnl配列から最大ドローダウン% */
function calcMaxDrawdown() {
  if (!guest.pnl || guest.pnl.length < 2) return 0;
  let peak = guest.pnl[0].value, maxDD = 0;
  for (const p of guest.pnl) {
    if (p.value > peak) peak = p.value;
    const dd = (peak - p.value) / peak * 100;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/** 統計サマリー表示 */
function renderAnalysisStats(pairs) {
  const closed = pairs.filter(p => p.realizedPnl !== undefined);
  const wins   = closed.filter(p => p.realizedPnl > 0);
  const losses = closed.filter(p => p.realizedPnl <= 0);
  const winRate  = closed.length ? wins.length / closed.length * 100 : null;
  const totalPnl = closed.reduce((s, p) => s + p.realizedPnl, 0);
  const avgWin   = wins.length   ? wins.reduce((s, p) => s + p.realizedPnl, 0) / wins.length   : null;
  const avgLoss  = losses.length ? losses.reduce((s, p) => s + p.realizedPnl, 0) / losses.length : null;
  const avgHold  = closed.length ? closed.reduce((s, p) => s + (p.holdDays ?? calcHoldDays(p.entryDate, p.exitDate)), 0) / closed.length : null;
  const maxDD    = calcMaxDrawdown();

  const set = (id, text, color) => { const el = document.getElementById(id); el.textContent = text; if (color) el.style.color = color; };
  set('anaWinRate',  winRate  != null ? `${winRate.toFixed(0)}%`                             : '-', winRate != null ? (winRate >= 50 ? 'var(--up)' : 'var(--down)') : '');
  set('anaTotalPnl', closed.length   ? `${totalPnl >= 0 ? '+' : ''}${fmt(totalPnl)}円`      : '-', totalPnl >= 0 ? 'var(--up)' : 'var(--down)');
  set('anaAvgWin',   avgWin  != null ? `+${fmt(avgWin)}円`                                  : '-', 'var(--up)');
  set('anaAvgLoss',  avgLoss != null ? `${fmt(avgLoss)}円`                                  : '-', 'var(--down)');
  set('anaAvgHold',  avgHold != null ? `${avgHold.toFixed(1)}日`                            : '-', '');
  set('anaMaxDD',    maxDD           ? `-${maxDD.toFixed(1)}%`                              : '-', maxDD > 0 ? 'var(--down)' : '');

  const msgs = [];
  if (closed.length < 2) { msgs.push('2件以上の決済トレードが揃うと詳細な分析が表示されます。'); }
  else {
    if (avgWin && avgLoss && Math.abs(avgLoss) > avgWin * 1.5)
      msgs.push(`平均損失（${fmt(Math.abs(avgLoss))}円）が平均利益（${fmt(avgWin)}円）の${(Math.abs(avgLoss)/avgWin).toFixed(1)}倍です。損切りが遅い可能性があります。`);
    if (maxDD > 20)
      msgs.push(`最大ドローダウン${maxDD.toFixed(1)}%は大きく、資金管理の見直しが必要かもしれません。`);
    if (winRate != null && winRate < 40)
      msgs.push(`勝率${winRate.toFixed(0)}%は低めです。エントリータイミングの精度向上が課題です。`);
    if (!msgs.length)
      msgs.push(`勝率${winRate.toFixed(0)}%・${closed.length}件のトレードを分析中です。`);
  }
  document.getElementById('anaInsight').textContent = msgs.join(' ');
}

/** 保有日数 vs 実現損益 散布図 */
function renderHoldPnlScatter(pairs) {
  const closed = pairs.filter(p => p.realizedPnl !== undefined);
  const toPoint = p => ({ x: p.holdDays ?? calcHoldDays(p.entryDate, p.exitDate), y: +(p.realizedPnl / 10000).toFixed(2), raw: p.realizedPnl });
  const wins   = closed.filter(p => p.realizedPnl >= 0).map(toPoint);
  const losses = closed.filter(p => p.realizedPnl <  0).map(toPoint);

  if (holdPnlChartInst) { holdPnlChartInst.destroy(); holdPnlChartInst = null; }
  holdPnlChartInst = new Chart(document.getElementById('holdPnlChart').getContext('2d'), {
    type: 'scatter',
    data: { datasets: [
      { label: '利益', data: wins,   backgroundColor: 'rgba(34,197,94,0.75)', pointRadius: 7 },
      { label: '損失', data: losses, backgroundColor: 'rgba(239,68,68,0.75)', pointRadius: 7 },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#9ca3af', font: { size: 10 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.parsed.x}日 / ${ctx.raw.raw >= 0 ? '+' : ''}${fmt(ctx.raw.raw)}円` } },
      },
      scales: {
        x: { min: 0, title: { display: true, text: '保有日数', color: '#9ca3af', font: { size: 10 } }, ticks: { color: '#9ca3af', font: { size: 9 } }, grid: { color: '#1e1e30' } },
        y: { title: { display: true, text: '損益（万円）', color: '#9ca3af', font: { size: 10 } }, ticks: { color: '#9ca3af', font: { size: 9 } }, grid: { color: '#1e1e30', drawBorder: false }, border: { dash: [4, 4] } },
      },
    },
  });
  let insight = '';
  if (losses.length && losses.filter(d => d.x > 5).length / losses.length > 0.5)
    insight = '損失トレードの多くが長期保有です。「いつか戻るはず」という心理が損失を拡大させている可能性があります。';
  else if (wins.length && wins.filter(d => d.x <= 3).length / wins.length > 0.6)
    insight = '利益確定が早い傾向があります。もっと利益を伸ばせる余地があるかもしれません。';
  document.getElementById('holdPnlInsight').textContent = insight;
}

/** MAE vs MFE 散布図 */
function renderMAEMFEChart(pairs) {
  const closed = pairs.filter(p => p.realizedPnl !== undefined);
  const points = closed.map(p => { const { mae, mfe } = calcMAEMFE(p); return { x: +mae.toFixed(2), y: +mfe.toFixed(2), pnl: p.realizedPnl }; });
  const wins   = points.filter(d => d.pnl >= 0);
  const losses = points.filter(d => d.pnl <  0);

  if (maeMfeChartInst) { maeMfeChartInst.destroy(); maeMfeChartInst = null; }
  maeMfeChartInst = new Chart(document.getElementById('maeMfeChart').getContext('2d'), {
    type: 'scatter',
    data: { datasets: [
      { label: '利益', data: wins,   backgroundColor: 'rgba(34,197,94,0.75)', pointRadius: 7 },
      { label: '損失', data: losses, backgroundColor: 'rgba(239,68,68,0.75)', pointRadius: 7 },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#9ca3af', font: { size: 10 } } },
        tooltip: { callbacks: { label: ctx => `MAE:${ctx.parsed.x.toFixed(1)}% / MFE:${ctx.parsed.y.toFixed(1)}%` } },
      },
      scales: {
        x: { max: 0, title: { display: true, text: 'MAE 最大逆行%（左=大きな逆行）', color: '#9ca3af', font: { size: 10 } }, ticks: { color: '#9ca3af', font: { size: 9 } }, grid: { color: '#1e1e30' } },
        y: { min: 0, title: { display: true, text: 'MFE 最大順行%（上=大きな利益機会）', color: '#9ca3af', font: { size: 10 } }, ticks: { color: '#9ca3af', font: { size: 9 } }, grid: { color: '#1e1e30' } },
      },
    },
  });
  let insight = '';
  if (points.length >= 2) {
    const avgMAE = points.reduce((s, d) => s + Math.abs(d.x), 0) / points.length;
    const avgMFE = points.reduce((s, d) => s + d.y,          0) / points.length;
    if (avgMAE > avgMFE * 1.5)
      insight = `平均MAE ${avgMAE.toFixed(1)}% に対し平均MFE ${avgMFE.toFixed(1)}% です。大きなリスクを取って小さな利益しか得られていない傾向があります。`;
  }
  document.getElementById('maeMfeInsight').textContent = insight;
}

/** シーケンス分析（リベンジトレード検知） */
function renderSequenceAnalysis(pairs) {
  const el     = document.getElementById('sequenceAnalysis');
  const closed = pairs.filter(p => p.realizedPnl !== undefined);
  if (closed.length < 2) { el.textContent = '2件以上の決済トレードが必要です。'; return; }
  let revengeCount = 0, rows = '';
  for (let i = 0; i < closed.length - 1; i++) {
    const curr = closed[i], next = closed[i + 1];
    const lotChg  = (next.shares - curr.shares) / curr.shares * 100;
    const gap     = calcHoldDays(curr.exitDate, next.entryDate);
    const revenge = curr.realizedPnl < 0 && (lotChg > 30 || gap <= 1);
    if (!revenge) continue;
    revengeCount++;
    const pnlCls = curr.realizedPnl >= 0 ? 'pnl-pos' : 'pnl-neg';
    const lotCls = lotChg > 30 ? 'pnl-neg' : '';
    rows += `<tr>
      <td>${curr.exitDate}</td>
      <td class="${pnlCls}">${curr.realizedPnl >= 0 ? '+' : ''}${fmt(curr.realizedPnl)}円</td>
      <td class="${lotCls}">${lotChg >= 0 ? '+' : ''}${lotChg.toFixed(0)}%</td>
      <td>${gap}日</td>
      <td><span style="color:var(--down)">⚠️ リベンジ疑い</span></td>
    </tr>`;
  }
  if (revengeCount === 0) {
    el.innerHTML = '<div style="color:var(--text2);font-size:12px;padding:4px 0">リベンジトレードの疑いはありません。</div>';
    return;
  }
  let html = `<table class="trade-table"><thead><tr><th>決済日</th><th>結果</th><th>次のロット変化</th><th>次エントリーまで</th><th>判定</th></tr></thead><tbody>${rows}</tbody></table>`;
  html += `<div class="ana-insight" style="margin-top:8px">⚠️ ${revengeCount}件のリベンジトレードの疑いがあります。負け後のロット増加は感情的な判断かもしれません。</div>`;
  el.innerHTML = html;
}

/** トレード履歴テーブル */
function renderTradeHistoryTable(pairs) {
  const tbody  = document.getElementById('tradeHistoryBody');
  const closed = pairs.filter(p => p.realizedPnl !== undefined);
  if (!closed.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text2)">決済済みトレードなし</td></tr>';
    return;
  }
  tbody.innerHTML = closed.map(p => {
    const hold   = p.holdDays ?? calcHoldDays(p.entryDate, p.exitDate);
    const pnlCls = p.realizedPnl >= 0 ? 'pnl-pos' : 'pnl-neg';
    const kind   = p.kind === 'long' ? '買' : '空売';
    return `<tr>
      <td>${p.exitDate}</td>
      <td style="text-align:center">${kind}</td>
      <td>${p.shares.toLocaleString()}株</td>
      <td>${fmt(p.entryPrice)}円</td>
      <td>${fmt(p.exitPrice)}円</td>
      <td>${hold}日</td>
      <td class="${pnlCls}">${p.realizedPnl >= 0 ? '+' : ''}${fmt(p.realizedPnl)}円</td>
    </tr>`;
  }).join('');
}

// ===== 損切りクセ診断スコア =====

/** 損切り粘り度（0-100, 高い=悪い）: 損失トレードの平均MAE% */
function calcPrayerScore(lossPairs) {
  if (!lossPairs.length) return null;
  const maes = lossPairs.map(p => Math.abs(calcMAEMFE(p).mae));
  const avg  = maes.reduce((a, b) => a + b, 0) / maes.length;
  return Math.min(100, Math.round(avg * 8)); // 12.5% MAE = 100点
}

/** パニック投げ度（0-100, 高い=悪い）: 決済日バーの下位何%で売ったか */
function calcPanicScore(lossPairs) {
  if (!lossPairs.length) return null;
  const scores = lossPairs.map(p => {
    const hi = p.exitBarHigh || (() => { const bar = guest.all_dates?.find(d => d.date === p.exitDate); return bar?.high ?? bar?.close; })();
    const lo = p.exitBarLow  || (() => { const bar = guest.all_dates?.find(d => d.date === p.exitDate); return bar?.low  ?? bar?.close; })();
    if (!hi || !lo) return 50;
    if (hi === lo) return 50;
    if (p.kind === 'long') {
      const pos = (p.exitPrice - lo) / (hi - lo); // 0=底値, 1=高値
      return Math.round(Math.max(0, 1 - pos) * 100);
    } else {
      const pos = (hi - p.exitPrice) / (hi - lo);
      return Math.round(Math.max(0, 1 - pos) * 100);
    }
  });
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/** 一貫性スコア（0-100, 高い=良い）: 損失幅%のCV逆数 */
function calcConsistScore(lossPairs) {
  if (lossPairs.length < 2) return null;
  const ratios = lossPairs.map(p => Math.abs(p.realizedPnl) / (p.entryPrice * p.shares) * 100);
  const mean   = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  if (!mean) return null;
  const std  = Math.sqrt(ratios.reduce((a, b) => a + (b - mean) ** 2, 0) / ratios.length);
  const cv   = std / mean;
  return Math.max(0, Math.round(100 - cv * 120));
}

/** スコアカードのレンダリング */
function renderScoreCards(pairs) {
  const lossPairs = pairs.filter(p => p.realizedPnl < 0);
  const winPairs  = pairs.filter(p => p.realizedPnl > 0);

  const prayerScore  = calcPrayerScore(lossPairs);
  const panicScore   = calcPanicScore(lossPairs);
  const consistScore = calcConsistScore(lossPairs);

  const setScore = (barId, numId, descId, score, desc) => {
    document.getElementById(barId).style.width = score != null ? `${score}%` : '0%';
    document.getElementById(numId).textContent = score != null ? `${score}/100` : '-';
    document.getElementById(descId).textContent = desc;
  };

  const prayerDesc = lossPairs.length === 0 ? '損失トレードなし'
    : prayerScore >= 70 ? '「まだ戻る」という根拠なき希望に支配されやすい傾向があります。'
    : prayerScore >= 40 ? '含み損をある程度引っ張るクセがあります。損切りルール設定を推奨します。'
    : '損切りのタイミングは比較的良好です。';

  const panicDesc = lossPairs.length === 0 ? '損失トレードなし'
    : panicScore >= 70 ? '急落を見ると計画なしに決済するクセがあります。これはギブアップです。'
    : panicScore >= 40 ? '感情的な決済が散見されます。決済前に一呼吸おく習慣を。'
    : '決済タイミングは比較的落ち着いています。';

  const consistDesc = lossPairs.length < 2 ? '損失2件以上で計算します'
    : consistScore >= 70 ? '損切り基準が一貫しています。ルールに従えています。'
    : consistScore >= 40 ? 'ルールの一貫性にやや課題があります。'
    : '損切りの基準が毎回バラバラです。相場より気分でルールを変えている可能性があります。';

  setScore('barPrayer',  'scorePrayer',  'descPrayer',  prayerScore,  prayerDesc);
  setScore('barPanic',   'scorePanic',   'descPanic',   panicScore,   panicDesc);
  setScore('barConsist', 'scoreConsist', 'descConsist', consistScore, consistDesc);

  // AI診断
  renderAIAdvice(pairs, lossPairs, winPairs, prayerScore, panicScore, consistScore);
}

/** AI診断メッセージ */
function renderAIAdvice(pairs, lossPairs, winPairs, prayerScore, panicScore, consistScore) {
  const el    = document.getElementById('aiAdvice');
  const rowEl = document.getElementById('aiAdviceRow');
  if (!pairs.length || lossPairs.length === 0) { rowEl.style.display = 'none'; return; }

  // 「もし5%で切っていれば節約できた額」
  const saved = lossPairs.reduce((total, p) => {
    const optLoss = p.entryPrice * p.shares * 0.05;
    return total + Math.max(0, Math.abs(p.realizedPnl) - optLoss);
  }, 0);

  const avgWinPnl  = winPairs.length  ? winPairs.reduce((s,p) => s + p.realizedPnl, 0) / winPairs.length   : 0;
  const avgLossPnl = lossPairs.length ? lossPairs.reduce((s,p) => s + Math.abs(p.realizedPnl), 0) / lossPairs.length : 0;
  const ratio      = avgWinPnl && avgLossPnl ? (avgLossPnl / avgWinPnl).toFixed(1) : null;

  // ① MFEの使い残し（利確が早すぎる）
  const avgWinMFE = winPairs.length
    ? winPairs.reduce((s, p) => s + calcMAEMFE(p).mfe, 0) / winPairs.length : 0;
  const avgWinPct = winPairs.length
    ? winPairs.reduce((s, p) => s + p.realizedPnl / (p.entryPrice * p.shares) * 100, 0) / winPairs.length : 0;
  const mfeUsage  = avgWinMFE > 0 ? avgWinPct / avgWinMFE : null;

  // ② 保有期間：損失 vs 利益
  const avgWinHold  = winPairs.length
    ? winPairs.reduce((s, p) => s + (p.holdDays ?? calcHoldDays(p.entryDate, p.exitDate)), 0) / winPairs.length  : 0;
  const avgLossHold = lossPairs.length
    ? lossPairs.reduce((s, p) => s + (p.holdDays ?? calcHoldDays(p.entryDate, p.exitDate)), 0) / lossPairs.length : 0;

  // ④ リベンジトレード件数
  let revengeCount = 0;
  for (let i = 0; i < pairs.length - 1; i++) {
    const curr = pairs[i], next = pairs[i + 1];
    const lotChg = (next.shares - curr.shares) / curr.shares * 100;
    const gap    = calcHoldDays(curr.exitDate, next.entryDate);
    if (curr.realizedPnl < 0 && (lotChg > 30 || gap <= 1)) revengeCount++;
  }

  // ⑦ オーバートレード（期間あたりのトレード密度）
  const tradingDays = (() => {
    if (!guest.all_dates || !pairs.length) return null;
    const allDates  = pairs.flatMap(p => [p.entryDate, p.exitDate]);
    const minDate   = allDates.reduce((a, b) => a < b ? a : b);
    const maxDate   = allDates.reduce((a, b) => a > b ? a : b);
    const minIdx    = guest.all_dates.findIndex(d => d.date >= minDate);
    const maxIdx    = guest.all_dates.findIndex(d => d.date >= maxDate);
    return minIdx >= 0 && maxIdx >= 0 ? maxIdx - minIdx + 1 : null;
  })();

  const lines = ['【AI診断】'];

  // === 悪いクセを指摘 ===
  if (ratio && parseFloat(ratio) > 1.5)
    lines.push(`あなたの「負けの波」は「勝ちの波」の<strong>${ratio}倍</strong>の大きさです。1回の負けを取り返すのに${Math.ceil(parseFloat(ratio))}回の勝ちが必要な「利小損大」パターンです。`);
  if (saved > 0)
    lines.push(`損失トレードで含み損5%のルールを厳守していれば、合計<strong>${fmt(Math.round(saved))}円</strong>の損失を回避できていた計算です。`);
  if (prayerScore != null && prayerScore >= 70)
    lines.push(`含み損が膨らんでも保有し続けるクセが顕著です。次回の練習では含み損<strong>-5%</strong>に達した瞬間に「無心で」切る訓練をしましょう。`);
  if (panicScore != null && panicScore >= 60)
    lines.push(`急落した日の底値付近で売るクセがあります。「パニック決済」は計画的な損切りではありません。決済前に3秒間立ち止まる習慣を。`);

  // ① 利確が早すぎる（最大含み益の50%未満しか取れていない）
  if (winPairs.length >= 2 && mfeUsage !== null && mfeUsage < 0.5 && avgWinMFE > 2)
    lines.push(`勝ちトレードの最大含み益は平均<strong>${avgWinMFE.toFixed(1)}%</strong>あったのに、実際に確定したのは<strong>${avgWinPct.toFixed(1)}%</strong>（${Math.round(mfeUsage * 100)}%）だけです。利益を途中で切り上げるクセがあります。`);

  // ② 損は長く・利は短く（保有期間の逆転）
  if (winPairs.length >= 2 && lossPairs.length >= 2 && avgLossHold > avgWinHold * 1.5 && avgWinHold > 0)
    lines.push(`損失トレードの平均保有<strong>${avgLossHold.toFixed(0)}日</strong>に対し、利益トレードは<strong>${avgWinHold.toFixed(0)}日</strong>で決済しています。利益を急いで確定し、損失を引っ張るクセがあります。`);

  // ③ 一貫性がない損切り
  if (consistScore != null && consistScore < 30 && lossPairs.length >= 3)
    lines.push(`損切り幅がトレードごとにバラバラです（一貫性スコア: <strong>${consistScore}/100</strong>）。毎回違う基準で損切りしており、ルールが機能していません。`);

  // ④ リベンジトレード
  if (revengeCount >= 2)
    lines.push(`損失直後にロットを増やすリベンジトレードのパターンが<strong>${revengeCount}回</strong>あります。感情的なリカバリー狙いは損失を拡大させるリスクがあります。`);

  // ⑦ オーバートレード
  if (tradingDays !== null && pairs.length >= 8 && tradingDays / pairs.length < 3)
    lines.push(`${tradingDays}日間に<strong>${pairs.length}回</strong>のトレードは多すぎる可能性があります。厳選したエントリーに絞ると判断の質が上がります。`);

  // === 良い面を認める ===
  if (prayerScore != null && prayerScore < 30 && lossPairs.length >= 2)
    lines.push(`損切り粘り度は<strong>${prayerScore}/100</strong>。素早い損切りができています。このスピードを全トレードで維持できれば資金は守れます。`);
  if (panicScore != null && panicScore < 30 && lossPairs.length >= 2)
    lines.push(`急落時も底値でのパニック売りをしていません（パニック度: <strong>${panicScore}/100</strong>）。感情的な決済を抑えられています。`);

  if (roundMode && currentSessionId)
    lines.push(`3ラウンドの記録が蓄積されると、ラウンド間のクセの変化を比較できます。`);

  // 次回の目標（優先度順に最大2件）
  const goalCandidates = [];
  if (prayerScore != null && prayerScore >= 70)
    goalCandidates.push('含み損-5%で即損切り');
  if (revengeCount >= 2)
    goalCandidates.push('負け後はロット据え置き');
  if (ratio && parseFloat(ratio) > 1.5)
    goalCandidates.push('利益を焦って確定しない');
  if (panicScore != null && panicScore >= 60)
    goalCandidates.push('急落時は3秒待ってから決済');
  if (winPairs.length >= 2 && mfeUsage !== null && mfeUsage < 0.5 && avgWinMFE > 2)
    goalCandidates.push('利益は含み益の70%以上取る');
  if (winPairs.length >= 2 && lossPairs.length >= 2 && avgLossHold > avgWinHold * 1.5 && avgWinHold > 0)
    goalCandidates.push('利益が出ていればホールド、損切りは早く。');
  if (consistScore != null && consistScore < 30 && lossPairs.length >= 3)
    goalCandidates.push('損切りは必ず-5%で統一');
  if (tradingDays !== null && pairs.length >= 8 && tradingDays / pairs.length < 3)
    goalCandidates.push('エントリーを半分に絞る');

  const goals = goalCandidates.length ? goalCandidates.slice(0, 2) : ['今のペースを維持する'];

  el.innerHTML = lines.join('<br>');
  el.style.flex = '1';
  el.style.minWidth = '0';

  const goalEl = document.getElementById('nextGoal');
  goalEl.style.cssText = [
    'flex:0 0 180px',
    'background:linear-gradient(135deg,rgba(34,197,94,0.08),rgba(16,185,129,0.08))',
    'border:1px solid rgba(34,197,94,0.4)',
    'border-radius:8px',
    'padding:12px 14px',
    'font-size:12px',
    'line-height:1.7',
  ].join(';');
  goalEl.innerHTML = `<div style="font-weight:bold;color:#22c55e;margin-bottom:6px;">次回の目標</div>`
    + goals.map(g => `<div style="margin-bottom:4px;"><span style="color:#22c55e;">✓</span> ${g}</div>`).join('');

  rowEl.style.cssText = 'display:flex;gap:12px;align-items:flex-start;';
}

/** ラウンド別比較セクション */
function renderRoundComparison(pairs) {
  const sec = document.getElementById('roundCompareSection');
  if (!currentSessionId) { sec.style.display = 'none'; return; }

  const rounds = [1, 2, 3];
  const roundData = rounds.map(r => {
    const rPairs = pairs.filter(p => p.round === r && p.sessionId === currentSessionId && p.realizedPnl !== undefined);
    if (!rPairs.length) return null;
    const wins    = rPairs.filter(p => p.realizedPnl > 0);
    const losses  = rPairs.filter(p => p.realizedPnl < 0);
    const totalPnl = rPairs.reduce((s, p) => s + p.realizedPnl, 0);
    const avgMAE   = losses.length ? losses.reduce((s, p) => s + Math.abs(calcMAEMFE(p).mae), 0) / losses.length : 0;
    const prayerSc = calcPrayerScore(losses);
    return { r, count: rPairs.length, wins: wins.length, totalPnl, avgMAE, prayerSc };
  }).filter(Boolean);

  if (!roundData.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';

  let html = `<table class="trade-table"><thead><tr>
    <th>ラウンド</th><th>トレード数</th><th>勝ち</th><th>総損益</th><th>平均MAE</th><th>粘り度</th>
  </tr></thead><tbody>`;
  for (const d of roundData) {
    const pnlCls = d.totalPnl >= 0 ? 'pnl-pos' : 'pnl-neg';
    html += `<tr>
      <td>Round ${d.r}</td>
      <td style="text-align:center">${d.count}</td>
      <td style="text-align:center">${d.wins}</td>
      <td class="${pnlCls}">${d.totalPnl >= 0 ? '+' : ''}${fmt(d.totalPnl)}円</td>
      <td>${d.avgMAE.toFixed(1)}%</td>
      <td>${d.prayerSc != null ? `${d.prayerSc}/100` : '-'}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  if (roundData.length >= 2) {
    const r1 = roundData[0], rLast = roundData[roundData.length - 1];
    if (r1.prayerSc != null && rLast.prayerSc != null) {
      const diff = rLast.prayerSc - r1.prayerSc;
      if (diff > 10)
        html += `<div class="ana-insight" style="margin-top:8px">⚠️ ラウンドが進むほど粘り度が上昇しています（+${diff}pt）。同じ銘柄でも損切りがどんどん遅くなる傾向があります。</div>`;
      else if (diff < -10)
        html += `<div class="ana-insight" style="margin-top:8px">✅ ラウンドが進むほど損切りが改善しています（${diff}pt）。練習の効果が出ています。</div>`;
    }
  }
  document.getElementById('roundCompareContent').innerHTML = html;
}

// ===== 刺激→反応分析（3Rモード専用） =====

const EVENT_META = {
  single_drop:    { label: '単日急落',         icon: '🔻', group: '下落系', respType: 'drop',    desc: '1日で前日終値から大きく下落（-3%以上）したローソク足。急な売り圧力が発生した場面。' },
  gap_down:       { label: 'ギャップダウン',    icon: '↙️', group: '下落系', respType: 'drop',    desc: '前日終値より大きく窓を開けて安く寄り付いた日。夜間の悪材料や売り注文の集中が原因。' },
  consec_drop:    { label: '連続下落(3日+)',    icon: '📉', group: '下落系', respType: 'drop',    desc: '3日以上続けて下落した局面。売りトレンドが続いており、保有者は含み損が膨らみやすい。' },
  new_low:        { label: '直近安値更新',      icon: '🔽', group: '下落系', respType: 'drop',    desc: '過去20日間の最安値を更新した日。下値支持が崩れたサインで、さらなる下落を示唆することが多い。' },
  lower_wick:     { label: '長い下ヒゲ',        icon: '⚡', group: '下落系', respType: 'bottom',  desc: '安値まで売られた後、買い戻されて終値が高い位置で引けたローソク足。下値での買い需要が強いことを示す。' },
  single_rise:    { label: '単日急騰',          icon: '🔺', group: '上昇系', respType: 'rise',    desc: '1日で前日終値から大きく上昇（+3%以上）したローソク足。強い買い圧力が発生した場面。' },
  gap_up:         { label: 'ギャップアップ',    icon: '↗️', group: '上昇系', respType: 'rise',    desc: '前日終値より大きく窓を開けて高く寄り付いた日。好材料や買い注文の集中が原因。' },
  consec_rise:    { label: '連続上昇(3日+)',    icon: '📈', group: '上昇系', respType: 'rise',    desc: '3日以上続けて上昇した局面。買いトレンドが続いており、空売り保有者は含み損が膨らみやすい。' },
  new_high:       { label: '直近高値更新',      icon: '🔼', group: '上昇系', respType: 'rise',    desc: '過去20日間の最高値を更新した日。上値抵抗が突破されたサインで、さらなる上昇を示唆することが多い。' },
  upper_wick:     { label: '長い上ヒゲ',        icon: '⚡', group: '上昇系', respType: 'top',     desc: '高値まで買われた後、売り戻されて終値が低い位置で引けたローソク足。上値での売り圧力が強いことを示す。' },
  trend_rev_down: { label: 'トレンド転換(↓)',  icon: '🔄', group: '転換系', respType: 'drop',    desc: '直前まで上昇していたが、その後下落に転じた転換点。高値掴みのリスクが高まっていた局面。' },
  trend_rev_up:   { label: 'トレンド転換(↑)',  icon: '🔄', group: '転換系', respType: 'rise',    desc: '直前まで下落していたが、その後上昇に転じた転換点。底値圏での買い場になりやすい局面。' },
  fake_breakout:  { label: '偽ブレイクアウト',  icon: '🪤', group: '転換系', respType: 'neutral', desc: '高値や安値を一時的に超えたように見えたが、すぐに元の水準に戻った動き。トラップにかかりやすい場面。' },
  whipsaw:        { label: '往復ビンタ',        icon: '🌊', group: '転換系', respType: 'neutral', desc: '大きく上下に振れた後に元の価格帯に戻ったローソク足。両方向のストップを狩る動きで、判断が難しい場面。' },
  range:          { label: 'もみ合い継続',      icon: '↔️', group: '転換系', respType: 'neutral', desc: '一定の価格帯内で上下を繰り返し、方向感のない状態。エントリーすると損切りにかかりやすい局面。' },
};

/** チャートイベントを全足から検出 */
function detectChartEvents(allDates, startIdx) {
  const bars = allDates.slice(startIdx);
  const N = bars.length;
  if (N < 5) return [];

  const events = [];
  const lastByType = {};

  const add = (type, barIdx, value = null) => {
    if ((lastByType[type] ?? -99) >= barIdx - 3) return; // 3本以内の重複を抑制
    if (events.filter(e => e.type === type).length >= 4) return; // 同種は最大4件
    const meta = EVENT_META[type];
    if (!meta) return;
    const valStr = value != null ? `(${value >= 0 ? '+' : ''}${value.toFixed(1)}%)` : '';
    events.push({ type, barIdx, value, icon: meta.icon, group: meta.group,
                  respType: meta.respType, label: meta.label + valStr });
    lastByType[type] = barIdx;
  };

  let downStreak = 0, upStreak = 0;

  for (let i = 1; i < N; i++) {
    const cur  = bars[i];
    const prev = bars[i - 1];
    if (!cur?.close || !prev?.close) continue;

    const dayChg = (cur.close - prev.close) / prev.close * 100;
    const gapChg = cur.open ? (cur.open - prev.close) / prev.close * 100 : 0;

    // 単日急落 / 急騰
    if (dayChg <= -5) add('single_drop', i, dayChg);
    if (dayChg >=  5) add('single_rise', i, dayChg);

    // ギャップ
    if (cur.open && gapChg <= -3) add('gap_down', i, gapChg);
    if (cur.open && gapChg >=  3) add('gap_up',   i, gapChg);

    // 連続下落 / 上昇（3日目に記録）
    if (dayChg < 0) { downStreak++; upStreak = 0; }
    else if (dayChg > 0) { upStreak++; downStreak = 0; }
    else { downStreak = 0; upStreak = 0; }
    if (downStreak === 3) add('consec_drop', i - 2);
    if (upStreak   === 3) add('consec_rise', i - 2);

    // 直近20日 高値 / 安値更新
    if (i >= 10) {
      const w  = bars.slice(Math.max(0, i - 20), i);
      const mH = Math.max(...w.map(b => b.high || b.close));
      const mL = Math.min(...w.map(b => b.low  || b.close));
      if ((cur.high || cur.close) > mH) add('new_high', i);
      if ((cur.low  || cur.close) < mL) add('new_low',  i);
    }

    // ヒゲ
    if (cur.open && cur.high && cur.low) {
      const bH    = Math.max(cur.close, cur.open);
      const bL    = Math.min(cur.close, cur.open);
      const body  = (bH - bL) || cur.open * 0.002;
      const upper = cur.high - bH;
      const lower = bL - cur.low;
      if (upper > body * 2 && upper / cur.open > 0.015) add('upper_wick', i, upper / cur.open * 100);
      if (lower > body * 2 && lower / cur.open > 0.015) add('lower_wick', i, lower / cur.open * 100);
    }

    // トレンド転換（5日MA）
    if (i >= 7) {
      const ma = j => {
        const sl = bars.slice(Math.max(0, j - 4), j + 1);
        return sl.reduce((s, b) => s + (b.close || 0), 0) / sl.length;
      };
      const m0 = ma(i), m1 = ma(i - 1), m3 = ma(i - 3), m4 = ma(i - 4);
      if (m0 < m1 && m3 > m4) add('trend_rev_down', i);
      if (m0 > m1 && m3 < m4) add('trend_rev_up',   i);
    }

    // 往復ビンタ（3日以内に±5%超）
    if (i >= 3) {
      const w3 = bars.slice(i - 3, i + 1);
      const mH = Math.max(...w3.map(b => b.high || b.close));
      const mL = Math.min(...w3.map(b => b.low  || b.close));
      if (mL > 0 && (mH - mL) / mL * 100 >= 10) add('whipsaw', i - 1);
    }

    // 偽ブレイクアウト（直近10日高安値更新→3日以内に反転）
    if (i >= 11 && i + 3 < N) {
      const w10 = bars.slice(i - 10, i);
      const rH  = Math.max(...w10.map(b => b.high || b.close));
      const rL  = Math.min(...w10.map(b => b.low  || b.close));
      const fut = bars.slice(i + 1, Math.min(N, i + 4));
      if ((cur.high || cur.close) > rH && fut.some(b => b.close < rH)) add('fake_breakout', i);
      if ((cur.low  || cur.close) < rL && fut.some(b => b.close > rL)) add('fake_breakout', i);
    }

    // もみ合い（10日間±3%以内、5本おきにチェック）
    if (i >= 10 && i % 5 === 0) {
      const w10 = bars.slice(i - 10, i + 1);
      const mH  = Math.max(...w10.map(b => b.high || b.close));
      const mL  = Math.min(...w10.map(b => b.low  || b.close));
      if (mL > 0 && (mH - mL) / mL * 100 <= 6) add('range', i - 5);
    }
  }

  return events.sort((a, b) => a.barIdx - b.barIdx);
}

/** 1イベント × 1ラウンドの投資家反応を分類 */
function classifyEventResponse(event, roundActs, allDates, startIdx) {
  const globalIdx = startIdx + event.barIdx;
  const eventDate = allDates[globalIdx]?.date;
  if (!eventDate) return '—';

  // イベント時点でのポジション確定（イベント日以前の操作）
  let lPos = 0, sPos = 0;
  for (const t of roundActs) {
    if (t.date > eventDate) break;
    if (t.type === 'buy')   lPos = Math.min(lPos + 1, 1);
    if (t.type === 'sell')  lPos = Math.max(lPos - 1, 0);
    if (t.type === 'short') sPos = Math.min(sPos + 1, 1);
    if (t.type === 'cover') sPos = Math.max(sPos - 1, 0);
  }
  const holding = lPos > 0 || sPos > 0;
  const holdingLong  = lPos > 0;
  const holdingShort = sPos > 0;

  // イベント日〜+2本以内の反応
  const endDate = allDates[Math.min(allDates.length - 1, globalIdx + 2)]?.date || eventDate;
  const near    = roundActs.filter(t => t.date >= eventDate && t.date <= endDate);
  const exited  = near.some(t => t.type === 'sell'  || t.type === 'cover');
  const entered = near.some(t => t.type === 'buy'   || t.type === 'short');

  switch (event.respType) {
    case 'drop':
      if (!holding) return entered ? '逆張り買い' : '未保有';
      if (holdingShort) return exited ? '利確(空売)' : '保有継続';  // 空売りに有利
      return exited ? 'パニック売り' : '耐えた';
    case 'rise':
      if (!holding) return entered ? '飛び乗り' : '様子見';
      if (holdingShort) return exited ? 'ロスカット(空)' : '損失方向で保有';  // 空売りに不利
      return exited ? '利確' : '保有継続';
    case 'bottom':
      if (!holding) return entered ? '拾い買い' : '様子見';
      if (holdingShort) return exited ? 'ロスカット(空)' : '保有継続';
      return exited ? '売り' : '保有継続';
    case 'top':
      if (!holding) return '未保有';
      if (holdingShort) return exited ? '利確(空売)' : '保有継続';
      return exited ? '天井利確' : '保有継続';
    default:
      if (!holding) return entered ? '新規参入' : '未保有';
      return exited ? '途中撤退' : '保有継続';
  }
}

/** 反応ラベルのCSSクラス */
function respCls(r) {
  if (['パニック売り', '飛び乗り', '途中撤退'].includes(r)) return 'pnl-neg';
  if (['耐えた', '様子見', '保有継続', '拾い買い', '利確', '天井利確'].includes(r)) return 'pnl-pos';
  return '';
}

/**
 * ポジション保有中に発生した試練イベントを検出（ラウンド別）
 * @returns {Array} roundIdx => { hasData, events: [{type, value, label}] }
 */
function analyzePositionEvents(roundActs, allDates) {
  return roundActs.map(acts => {
    if (!acts.length) return { hasData: false, events: [] };

    const pairs = [];
    const longStack = [], shortStack = [];
    const sorted = [...acts].sort((a, b) => a.date < b.date ? -1 : 1);
    for (const t of sorted) {
      if      (t.type === 'buy')                       longStack.push(t);
      else if (t.type === 'sell'  && longStack.length)  pairs.push({ entry: longStack.pop(),  exit: t, kind: 'long'  });
      else if (t.type === 'short')                      shortStack.push(t);
      else if (t.type === 'cover' && shortStack.length) pairs.push({ entry: shortStack.pop(), exit: t, kind: 'short' });
    }
    for (const e of longStack)  pairs.push({ entry: e, exit: null, kind: 'long'  });
    for (const e of shortStack) pairs.push({ entry: e, exit: null, kind: 'short' });

    const posEvents = [];

    for (const { entry, exit, kind } of pairs) {
      const entryGIdx = allDates.findIndex(d => d.date === entry.date);
      if (entryGIdx < 0) continue;
      const exitGIdx = exit ? allDates.findIndex(d => d.date === exit.date) : allDates.length - 1;
      const bars = allDates.slice(entryGIdx, exitGIdx + 1);
      if (bars.length < 2) continue;
      const ep = entry.price;
      if (!ep) continue;
      const isLong = kind === 'long';

      // エントリー直後逆行（2日以内に-3%以上の逆行）
      const earlyBars = bars.slice(1, Math.min(3, bars.length));
      if (earlyBars.length) {
        const worst = isLong
          ? Math.min(...earlyBars.map(b => (b.low  || b.close) / ep - 1)) * 100
          : Math.min(...earlyBars.map(b => 1 - (b.high || b.close) / ep)) * 100;
        if (worst <= -3)
          posEvents.push({ type: 'entry_reversal', value: +worst.toFixed(1),
                           label: `エントリー直後逆行(${worst.toFixed(1)}%)` });
      }

      // MFE計算
      const mfe = isLong
        ? Math.max(...bars.map(b => (b.high || b.close) / ep - 1)) * 100
        : Math.max(...bars.map(b => 1 - (b.low  || b.close) / ep)) * 100;

      // 含み益縮小（MFE≥5% かつ実現益がMFEの50%未満）
      if (exit && mfe >= 5) {
        const realized = isLong
          ? (exit.price / ep - 1) * 100
          : (1 - exit.price / ep) * 100;
        if (realized < mfe * 0.5)
          posEvents.push({ type: 'profit_giveback',
                           value: +(realized / mfe * 100).toFixed(0),
                           label: `含み益縮小(最大${mfe.toFixed(1)}%→${realized.toFixed(1)}%確定)` });
      }

      // 長期塩漬け（含み損のまま10日以上）
      const lossDays = bars.slice(1).filter(b => {
        const pnl = isLong ? b.close / ep - 1 : 1 - b.close / ep;
        return pnl < 0;
      }).length;
      if (lossDays >= 10)
        posEvents.push({ type: 'holding_loss', value: lossDays,
                         label: `長期塩漬け(含み損${lossDays}日)` });
    }

    return { hasData: true, events: posEvents };
  });
}

/**
 * エントリー時のチャート文脈を分析（直前5本以内のイベント）
 * @returns {Array} roundIdx => { hasData, barIdx, kind, precedingEvents }
 */
function analyzeEntryContext(roundActs, allDates, startIdx, events) {
  return roundActs.map(acts => {
    if (!acts.length) return { hasData: false, barIdx: null };
    const sorted = [...acts].sort((a, b) => a.date < b.date ? -1 : 1);
    const firstEntry = sorted.find(t => t.type === 'buy' || t.type === 'short');
    if (!firstEntry) return { hasData: true, barIdx: null, kind: null, precedingEvents: [] };
    const gIdx = allDates.findIndex(d => d.date === firstEntry.date);
    if (gIdx < 0) return { hasData: true, barIdx: null, kind: null, precedingEvents: [] };
    const entryBarIdx = gIdx - startIdx;
    const preceding = events.filter(e => e.barIdx >= entryBarIdx - 5 && e.barIdx < entryBarIdx);
    return { hasData: true, barIdx: entryBarIdx, kind: firstEntry.type, precedingEvents: preceding };
  });
}

/** 3R刺激→反応分析を描画 */
function renderChartBehaviorAnalysis() {
  const sec = document.getElementById('chartBehaviorSection');
  if (!roundMode || !currentSessionId || roundSessionStartIdx == null || !guest.all_dates?.length) {
    sec.style.display = 'none';
    return;
  }

  const allDates = guest.all_dates;
  const startIdx = roundSessionStartIdx;
  const events   = detectChartEvents(allDates, startIdx);
  if (!events.length) { sec.style.display = 'none'; return; }
  sec.style.display = '';

  // ラウンド別の全操作（日付順ソート済み）
  const roundActs = [1, 2, 3].map(r =>
    guest.trades
      .filter(t => t.round === r && t.sessionId === currentSessionId)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
  );
  const playedRounds = roundActs.filter(a => a.length > 0).length;
  const noTradeRounds = roundActs.map(a => a.length === 0); // トレードなしフラグ

  // チャートプロファイルタグ
  const gcnt = {};
  for (const e of events) gcnt[e.group] = (gcnt[e.group] || 0) + 1;
  const tags = [];
  if ((gcnt['下落系'] || 0) >= 3)                       tags.push('急落多め');
  if ((gcnt['上昇系'] || 0) >= 3)                       tags.push('急騰多め');
  if ((gcnt['転換系'] || 0) >= 2)                       tags.push('荒れた展開');
  if (events.some(e => e.type === 'fake_breakout'))     tags.push('偽ブレイクあり');
  if (events.some(e => e.type === 'whipsaw'))           tags.push('往復ビンタあり');
  if (events.some(e => e.type === 'range'))             tags.push('もみ合いあり');
  if (!tags.length)                                     tags.push('標準的な値動き');

  document.getElementById('chartProfileContent').innerHTML =
    `<div class="chart-profile-row">このチャートの特徴：`
    + tags.map(t => `<span class="chart-profile-tag">${t}</span>`).join('')
    + `</div>`;

  // ── ① エントリータイミング比較 ──
  const entryCtx = analyzeEntryContext(roundActs, allDates, startIdx, events);
  let entryHtml = `<div class="analysis-section-title" style="margin-top:10px">📍 エントリータイミング比較</div>`;

  const rHeaders = [1,2,3].map(r => {
    if (noTradeRounds[r-1]) return `<th style="color:var(--text2)">R${r}<br><small>トレードなし</small></th>`;
    return `<th>R${r}</th>`;
  }).join('');

  // バー番号行
  const barRow = entryCtx.map((ctx, i) => {
    if (noTradeRounds[i]) return `<td style="text-align:center;color:var(--text2)">—</td>`;
    if (!ctx.hasData || ctx.barIdx == null) return `<td style="text-align:center;color:var(--text2)">—</td>`;
    const kindLabel = ctx.kind === 'buy' ? '買' : '空売';
    return `<td style="text-align:center;font-size:11px">${ctx.barIdx}本目<br><small style="color:var(--text2)">${kindLabel}</small></td>`;
  }).join('');

  // バー番号の一致判定
  const validBars = entryCtx.filter((c, i) => !noTradeRounds[i] && c.hasData && c.barIdx != null).map(c => c.barIdx);
  const barAgree = validBars.length >= 2 && validBars.every(b => Math.abs(b - validBars[0]) <= 2);
  const barBadge = validBars.length >= 2
    ? (barAgree ? `<span class="badge-full">近似一致</span>` : `<span class="badge-partial">バラバラ</span>`)
    : '';

  // エントリー前の状況行
  const ctxRow = entryCtx.map((ctx, i) => {
    if (noTradeRounds[i]) return `<td style="text-align:center;color:var(--text2)">—</td>`;
    if (!ctx.hasData || !ctx.precedingEvents?.length)
      return `<td style="text-align:center;color:var(--text2);font-size:11px">特定イベントなし</td>`;
    return `<td style="text-align:center;font-size:10px">${ctx.precedingEvents.map(e => e.icon + e.label).join('<br>')}</td>`;
  }).join('');

  // エントリー前イベントの一致判定
  const ctxTypes = entryCtx.filter((c, i) => !noTradeRounds[i] && c.hasData).map(c =>
    (c.precedingEvents || []).map(e => e.type).sort().join(',')
  );
  const ctxAgree = ctxTypes.length >= 2 && ctxTypes.every(t => t === ctxTypes[0]);
  const ctxBadge = ctxTypes.length >= 2
    ? (ctxAgree ? `<span class="badge-full">一致</span>` : `<span class="badge-partial">不一致</span>`)
    : '';

  entryHtml += `<div class="event-matrix-wrap"><table class="trade-table">
    <thead><tr><th style="text-align:left">項目</th>${rHeaders}<th>一致</th></tr></thead>
    <tbody>
      <tr><td>エントリーバー番号</td>${barRow}<td style="text-align:center">${barBadge}</td></tr>
      <tr><td>直前の状況(5本以内)</td>${ctxRow}<td style="text-align:center">${ctxBadge}</td></tr>
    </tbody>
  </table></div>`;
  document.getElementById('eventResponseContent').innerHTML = entryHtml;

  // ── ② 試練ポイントへの反応マトリクス ──
  const rows = events.map(ev => ({
    ev,
    responses: roundActs.map((acts, i) =>
      noTradeRounds[i] ? 'トレードなし' : classifyEventResponse(ev, acts, allDates, startIdx)
    ),
  })).filter(row => !row.responses.every(r => r === '未保有' || r === '—' || r === 'トレードなし'));

  let matrixHtml = `<div class="analysis-section-title" style="margin-top:14px">⚡ 試練ポイントへの反応</div>`;
  if (rows.length) {
    const groups = [...new Set(rows.map(r => r.ev.group))];
    let tbl = `<div class="event-matrix-wrap"><table class="trade-table">
      <thead><tr>
        <th style="text-align:left;min-width:150px">試練ポイント</th>
        <th style="min-width:80px">R1</th><th style="min-width:80px">R2</th><th style="min-width:80px">R3</th>
        <th>一致</th>
      </tr></thead><tbody>`;

    for (const grp of groups) {
      tbl += `<tr><td colspan="5" class="event-group-header">${grp}</td></tr>`;
      for (const { ev, responses } of rows.filter(r => r.ev.group === grp)) {
        const active = responses.filter(r => r !== '未保有' && r !== '—' && r !== 'トレードなし');
        let badge = '';
        if (active.length >= 2) {
          const mode  = active.reduce((a, b, _, arr) =>
            arr.filter(v => v === a).length >= arr.filter(v => v === b).length ? a : b);
          const agree = active.filter(r => r === mode).length;
          badge = agree === active.length
            ? `<span class="badge-full">${agree}/${active.length}</span>`
            : `<span class="badge-partial">${agree}/${active.length}</span>`;
        }
        tbl += `<tr>
          <td data-tooltip="${ev.desc ?? ''}">${ev.icon} ${ev.label}</td>
          ${responses.map(r => {
            const cls = r === 'トレードなし' ? '' : respCls(r);
            const col = r === 'トレードなし' ? 'color:var(--text2)' : '';
            return `<td class="${cls}" style="text-align:center;font-size:11px;white-space:nowrap;${col}">${r}</td>`;
          }).join('')}
          <td style="text-align:center">${badge}</td>
        </tr>`;
      }
    }
    tbl += '</tbody></table></div>';
    matrixHtml += tbl;
  } else {
    matrixHtml += `<div style="color:var(--text2);font-size:12px;padding:8px 0">トレード後に表示されます。</div>`;
  }

  // ── ③ 保有状況系イベント ──
  const posEventsPerRound = analyzePositionEvents(roundActs, allDates);
  const POS_TYPES = [
    { type: 'entry_reversal', label: 'エントリー直後逆行', icon: '😬', desc: 'エントリーから2日以内に-3%以上の逆行が発生した。入り口を間違えたか、タイミングが早すぎた可能性がある。' },
    { type: 'profit_giveback', label: '含み益縮小',         icon: '😥', desc: '最大含み益の50%以上を失って決済した。利益を引っ張りすぎて吐き出してしまったパターン。' },
    { type: 'holding_loss',    label: '長期塩漬け',          icon: '😰', desc: '10日以上にわたって損失状態のポジションを保有し続けた。損切りルールが機能していない可能性がある。' },
  ];

  let posHtml = `<div class="analysis-section-title" style="margin-top:14px">🩺 ポジション中の試練</div>`;
  let hasPosData = posEventsPerRound.some(r => r.hasData);
  if (hasPosData) {
    let tbl = `<div class="event-matrix-wrap"><table class="trade-table">
      <thead><tr><th style="text-align:left">試練</th>${rHeaders}<th>発生率</th></tr></thead><tbody>`;
    for (const pt of POS_TYPES) {
      const cells = posEventsPerRound.map((re, i) => {
        if (noTradeRounds[i]) return `<td style="text-align:center;color:var(--text2)">—</td>`;
        if (!re.hasData) return `<td style="text-align:center;color:var(--text2)">未プレイ</td>`;
        const found = re.events.filter(e => e.type === pt.type);
        if (!found.length) return `<td style="text-align:center;color:var(--text2);font-size:11px">なし</td>`;
        return `<td style="text-align:center;font-size:10px;color:var(--down)">${found.map(e => e.label).join('<br>')}</td>`;
      }).join('');
      const occuredCount = posEventsPerRound.filter((re, i) => !noTradeRounds[i] && re.hasData && re.events.some(e => e.type === pt.type)).length;
      const totalPlayed  = posEventsPerRound.filter((re, i) => !noTradeRounds[i] && re.hasData).length;
      const rateBadge = totalPlayed >= 2
        ? (occuredCount === totalPlayed
            ? `<span class="badge-full">${occuredCount}/${totalPlayed}</span>`
            : occuredCount >= 2
              ? `<span class="badge-partial">${occuredCount}/${totalPlayed}</span>`
              : `<span style="color:var(--text2);font-size:10px">${occuredCount}/${totalPlayed}</span>`)
        : '';
      tbl += `<tr><td data-tooltip="${pt.desc ?? ''}">${pt.icon} ${pt.label}</td>${cells}<td style="text-align:center">${rateBadge}</td></tr>`;
    }
    tbl += '</tbody></table></div>';
    posHtml += tbl;
  } else {
    posHtml += `<div style="color:var(--text2);font-size:12px;padding:8px 0">トレード後に表示されます。</div>`;
  }

  document.getElementById('eventResponseContent').innerHTML += '';

  // ── ④ クセ結論（価格イベント + ポジションイベント 統合） ──
  const habits = [];

  // 価格イベント由来のクセ
  for (const { ev, responses } of rows) {
    const active = responses.filter(r => r !== '未保有' && r !== '—' && r !== 'トレードなし');
    if (active.length < 2) continue;
    const rcnt = {};
    for (const r of active) rcnt[r] = (rcnt[r] || 0) + 1;
    const [[topR, topN]] = Object.entries(rcnt).sort((a, b) => b[1] - a[1]);
    if (topN >= 2) habits.push({ icon: ev.icon, evLabel: ev.label, resp: topR, count: topN, total: active.length });
  }

  // ポジションイベント由来のクセ
  for (const pt of POS_TYPES) {
    const occured = posEventsPerRound.filter((re, i) => !noTradeRounds[i] && re.hasData && re.events.some(e => e.type === pt.type));
    const played  = posEventsPerRound.filter((re, i) => !noTradeRounds[i] && re.hasData);
    if (played.length >= 2 && occured.length >= 2) {
      habits.push({ icon: pt.icon, evLabel: pt.label, resp: '発生', count: occured.length, total: played.length });
    }
  }

  // エントリーバー番号のクセ
  if (barAgree && validBars.length >= 2) {
    const avg = Math.round(validBars.reduce((s, b) => s + b, 0) / validBars.length);
    habits.push({ icon: '📍', evLabel: 'エントリータイミング', resp: `毎回${avg}本目付近`, count: validBars.length, total: playedRounds });
  }
  // エントリー前状況のクセ
  if (ctxAgree && ctxTypes.length >= 2 && ctxTypes[0]) {
    const label = entryCtx.find((c, i) => !noTradeRounds[i] && c.hasData && c.precedingEvents?.length)?.precedingEvents[0]?.label || '';
    if (label) habits.push({ icon: '🎯', evLabel: 'エントリーの引き金', resp: label, count: ctxTypes.length, total: playedRounds });
  }

  let conclusionHtml = '';
  if (habits.length) {
    const lines = habits.map(h => {
      const isAll = h.count === h.total;
      const color = isAll ? '#f59e0b' : '#9ca3af';
      const label = isAll ? '強いクセ' : '傾向あり';
      return `<div class="habit-row">
        <span class="habit-evlabel">${h.icon} ${h.evLabel}</span>
        <span class="habit-arrow">→</span>
        <span class="habit-resp ${respCls(h.resp)}">${h.resp}</span>
        <span class="habit-badge" style="color:${color}">${h.count}/${h.total}回・${label}</span>
      </div>`;
    }).join('');
    conclusionHtml = `<div class="analysis-section-title" style="margin-top:14px;border-top:1px solid var(--border);padding-top:10px">🧬 抽出されたクセ</div>` + lines;
  } else if (playedRounds >= 3) {
    conclusionHtml = `<div class="ana-insight" style="margin-top:10px">一貫したクセは検出されませんでした。3ラウンドで判断が毎回異なります（それ自体も発見です）。</div>`;
  } else {
    conclusionHtml = `<div style="color:var(--text2);font-size:12px;padding:8px 0">3ラウンド完了後にクセが抽出されます（現在${playedRounds}ラウンド）。</div>`;
  }
  document.getElementById('habitConclusionContent').innerHTML = conclusionHtml;
}

/** 分析タブ全体レンダリング */
function renderAnalysis() {
  const pairs = buildTradePairs();
  renderAnalysisStats(pairs);
  renderScoreCards(pairs);
  renderRoundComparison(pairs);
  renderChartBehaviorAnalysis();
  renderHoldPnlScatter(pairs);
  renderMAEMFEChart(pairs);
  renderSequenceAnalysis(pairs);
  renderTradeHistoryTable(pairs);
}
