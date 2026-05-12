// --- State ---
let currentSymbol = null;
let gameActive = false;
let ma1 = 25, ma2 = 75, ma3 = 200;
let lwChart = null, candleSeries = null, ma1Series = null, ma2Series = null, ma3Series = null;
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
let syncingRange = false;
let blindMode = false;
let blindDayCount = 0;
let blindActualSymbol = '';
let blindActualDate = '';
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

let defaultBars = 120;

function loadDefaultBars() {
  const saved = localStorage.getItem('defaultBars');
  if (saved) defaultBars = Math.max(10, Math.min(1000, parseInt(saved)));
  const el = document.getElementById('defaultBarsInput');
  if (el) el.value = defaultBars;
}

function saveDefaultBars(val) {
  defaultBars = Math.max(10, Math.min(1000, parseInt(val)));
  localStorage.setItem('defaultBars', defaultBars);
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

// --- Init ---
async function init() {
  loadChartColors();
  loadIndicatorSettings();
  loadKeyboardShortcuts();
  loadDefaultBars();
  setupEvents();

  try { setupChart(); } catch (e) { console.error('Chart init failed:', e); }
  applyChartColors();
  setupChartResizer();

  _startPrefetch();
  showStartModal();
}

// --- Modal ---
let _prefetchPromise = null;
let _prefetchedStock = null;

async function _prefetchRandomStock() {
  try {
    const r = await fetch('/api/stocks/random-with-candles');
    if (!r.ok) return null;
    return await r.json();
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
    const r = await fetch('/api/stocks/random');
    if (!r.ok) { msgEl.textContent = 'データ取得失敗'; msgEl.className = 'msg error'; return; }
    ({ symbol, name, oldName } = await r.json());
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
    const r = await fetch(`/api/stocks/candles/${encodeURIComponent(symbol)}?limit=1000`);
    if (!r.ok) return;
    const candles = await r.json();
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
      const r = await fetch('/api/stocks/random-with-candles');
      if (!r.ok) return;
      ({ symbol, name, oldName, candles } = await r.json());
    }
    await applyNewStock(symbol, null, candles, name, oldName);
    _startPrefetch();
  } finally {
    isChangingStock = false;
    btn.textContent = '🎲 銘柄変更[N]';
    btn.disabled = false;
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

async function applyNewStock(symbol, errEl, prefetchedCandles = null, symbolName = null, symbolOldName = null) {
  const err = (msg) => { if (errEl) { errEl.textContent = msg; errEl.className = 'msg error'; } };

  let allData = prefetchedCandles;
  if (!allData) {
    if (errEl) { errEl.textContent = 'データ読み込み中...'; errEl.className = 'msg'; }
    const r = await fetch(`/api/stocks/candles/${symbol}?limit=1000`);
    if (!r.ok) { err('銘柄が見つかりません'); return false; }
    allData = await r.json();
  }
  if (allData.length < 10) { err('データが不足しています'); return false; }

  const minHistory = 200;
  const minRemaining = 100;
  const maxStart = Math.max(minHistory, allData.length - minRemaining - 1);
  const startIdx = minHistory + Math.floor(Math.random() * Math.max(1, maxStart - minHistory + 1));
  guest.all_dates = allData;
  guest.start_idx = startIdx;
  guest.start_date = allData[startIdx].date;
  guest.current_date = allData[startIdx].date;
  guest.current_idx = startIdx;
  guest.elapsed = 0;
  guest.symbol = symbol;
  guest.cash = INITIAL_CASH;
  guest.longPos = {};
  guest.shortPos = {};
  guest.trades = [];
  guest.pendingOrders = [];
  guest.pnl = [{ date: guest.start_date, value: INITIAL_CASH }];
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
        guest.trades.push({ date: closeDate, type: 'sell', shares: pos.shares, price: closePrice, realizedPnl });
        for (const sim of Object.values(compSims)) simExecuteOrder(sim, 'sell', sym, closePrice, 0, closeDate);
        forcedLines.push(`買→強制売却 ${pos.shares}株 @${fmt(closePrice)}円（${realizedPnl >= 0 ? '+' : ''}${fmt(realizedPnl)}円）`);
        pos.shares = 0;
      }
    }
    for (const [sym, spos] of Object.entries(guest.shortPos)) {
      if (spos.shares > 0) {
        const realizedPnl = (spos.avg_price - closePrice) * spos.shares;
        guest.cash -= closePrice * spos.shares;
        guest.trades.push({ date: closeDate, type: 'cover', shares: spos.shares, price: closePrice, realizedPnl });
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
        const newShares = pos.shares + order.shares;
        pos.avg_price = (pos.avg_price * pos.shares + execPrice * order.shares) / newShares;
        pos.shares = newShares;
        if (order.stopPct) pos.stopLossPrice = pos.avg_price * (1 - order.stopPct / 100);
        guest.longPos[order.symbol] = pos;
        guest.trades.push({ date: guest.current_date, type: 'buy', shares: order.shares, price: execPrice });
      }
    } else if (order.type === 'sell') {
      const pos = guest.longPos[order.symbol];
      if (pos && pos.shares >= order.shares) {
        const realizedPnl = (execPrice - pos.avg_price) * order.shares;
        guest.cash += execPrice * order.shares;
        pos.shares -= order.shares;
        if (pos.shares === 0) pos.stopLossPrice = null;
        guest.trades.push({ date: guest.current_date, type: 'sell', shares: order.shares, price: execPrice, realizedPnl });
      }
    } else if (order.type === 'short') {
      guest.cash += execPrice * order.shares;
      const spos = guest.shortPos[order.symbol] || { shares: 0, avg_price: 0 };
      const newShort = spos.shares + order.shares;
      spos.avg_price = (spos.avg_price * spos.shares + execPrice * order.shares) / newShort;
      spos.shares = newShort;
      if (order.stopPct) spos.stopLossPrice = spos.avg_price * (1 + order.stopPct / 100);
      guest.shortPos[order.symbol] = spos;
      guest.trades.push({ date: guest.current_date, type: 'short', shares: order.shares, price: execPrice });
    } else if (order.type === 'cover') {
      const spos = guest.shortPos[order.symbol];
      if (spos && spos.shares >= order.shares) {
        const cost = execPrice * order.shares;
        if (guest.cash >= cost) {
          const realizedPnl = (spos.avg_price - execPrice) * order.shares;
          guest.cash -= cost;
          spos.shares -= order.shares;
          if (spos.shares === 0) spos.stopLossPrice = null;
          guest.trades.push({ date: guest.current_date, type: 'cover', shares: order.shares, price: execPrice, realizedPnl });
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
        guest.trades.push({ date: guest.current_date, type: 'sell', shares: pos.shares, price: sellPrice, realizedPnl });
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
        guest.trades.push({ date: guest.current_date, type: 'cover', shares: spos.shares, price: coverPrice, realizedPnl });
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
    appendDayToChart(newCandle);
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
  const from = total - bars;
  lwChart.timeScale().setVisibleLogicalRange({ from: Math.max(0, from), to: total - 1 });
  // 価格スケールを表示中の足に合わせて自動調整
  lwChart.priceScale('right').applyOptions({ autoScale: true });
}

async function refreshChart() {
  if (!currentSymbol) return;

  const historyFrom = Math.max(0, guest.start_idx - 200);
  const validRaw = guest.all_dates.slice(historyFrom, guest.current_idx + 1).filter(c => c.close);

  currentCandles = validRaw.map(c => ({
    time: c.date,
    open: c.open ?? c.close,
    high: c.high ?? c.close,
    low:  c.low  ?? c.close,
    close: c.close,
    volume: c.volume,
  }));

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
  slider.max = Math.max(10, currentCandles.length);

  let viewBars;
  if (userZoomSet) {
    viewBars = Math.min(parseInt(slider.max), parseInt(slider.value));
  } else {
    viewBars = Math.min(parseInt(slider.max), defaultBars);
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
  const toMarker = t => {
    const m = TRADE_MARKER[t.type] || TRADE_MARKER.buy;
    return { time: t.date, position: m.position, color: m.color, shape: m.shape, text: `${m.label} ${t.shares}株` };
  };
  try { candleSeries.setMarkers(guest.trades.map(toMarker)); } catch {}
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
  renderPnlData(buildHoldDaysData(guest.trades));
}

function renderPnlData(data) {
  const labels = data.length ? data.map(d => `${d.holdDays}日`) : [''];
  const values = data.length ? data.map(d => d.value) : [0];
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

  // 3系列の holdDays を合わせて x 軸を構築
  const allHoldDays = new Set([
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

  const labels        = sortedHoldDays.length ? sortedHoldDays.map(d => `${d}日`) : [''];
  const riskValues    = sortedHoldDays.length ? fillValues(riskMap, sortedHoldDays) : [0];
  const percentValues = sortedHoldDays.length ? fillValues(pctMap,  sortedHoldDays) : [0];
  const sharesValues  = sortedHoldDays.length ? fillValues(shaMap,  sortedHoldDays) : [0];

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
  if (!gameActive) return;
  const price = currentCandles[currentCandles.length - 1]?.close;
  const shares = getEffectiveShares(price);
  if (!currentSymbol || !shares || shares <= 0) return;

  const msgEl = document.getElementById('orderMsg');
  if (!price) { msgEl.textContent = '価格データがありません'; msgEl.className = 'msg error'; return; }
  // 比較シミュレーション用の株数を注文時終値で計算（実際のモードと同じタイミング）
  const pctInput = parseFloat(document.getElementById('percentInput').value) || 50;
  const fixInput = parseInt(document.getElementById('sharesInput').value) || 100;
  const simPctShares = Math.floor(compSims.percent.cash * pctInput / 100 / price);
  const stopPct = getOrderMode() === 'risk' ? (parseFloat(document.getElementById('riskStopInput').value) || 0) : 0;
  guest.pendingOrders.push({ type: orderType, symbol: currentSymbol, shares, stopPct, simPctShares, simFixShares: fixInput });
  await nextDay();
}

// --- Events ---
function setupEvents() {
  document.getElementById('startGameBtn').addEventListener('click', startGame);
  document.getElementById('newGameBtn').addEventListener('click', changeStock);
  document.getElementById('nextDayBtn').addEventListener('click', nextDay);
  document.getElementById('autoAdvanceBtn').addEventListener('click', toggleAutoAdvance);

  document.getElementById('blindModeBtn').addEventListener('click', () => {
    blindMode = !blindMode;
    const btn = document.getElementById('blindModeBtn');
    btn.classList.toggle('blind-active', blindMode);
    btn.textContent = blindMode ? '👁 公開' : '🙈 ブラインド';
    document.getElementById('currentSymbol').textContent =
      blindMode ? '???' : blindActualSymbol;
    document.getElementById('currentDate').textContent =
      blindMode ? `${blindDayCount}日目` : blindActualDate;
    applyBlindChartOptions();
    updatePortfolio();
  });

  function applyBlindChartOptions() {
    const opts = { crosshair: { vertLine: { labelVisible: !blindMode } } };
    const tsOpts = { timeScale: { visible: !blindMode } };
    [lwChart, volChart, rsiChartInst, macdChartInst].forEach(c => {
      if (c) { c.applyOptions(opts); c.applyOptions(tsOpts); }
    });
  }

  colorInputIds.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', e => {
      chartColors[colorKeys[i]] = e.target.value;
      saveChartColors();
      applyChartColors();
    });
  });

  document.getElementById('defaultBarsInput').addEventListener('change', (e) => {
    saveDefaultBars(e.target.value);
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

  document.querySelector('.order-tab[data-type="buy"]').addEventListener('click', () => {
    if (gameActive) executeOrder('buy');
  });
  document.querySelector('.order-tab[data-type="short"]').addEventListener('click', () => {
    if (gameActive) executeOrder('short');
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
      const r = await fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`);
      searchResults = await r.json();
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
}

init();

// ===== ビュータブ切替 =====
function switchView(view) {
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  document.getElementById('candleView').style.display      = view === 'candle'     ? '' : 'none';
  document.getElementById('pnlView').style.display         = view === 'pnl'        ? '' : 'none';
  document.getElementById('comparisonView').style.display  = view === 'comparison' ? '' : 'none';
  document.getElementById('settingsView').style.display    = view === 'settings'   ? '' : 'none';
  if (view === 'pnl' && pnlChartLarge) pnlChartLarge.resize();
  if (view === 'comparison' && comparisonChartLarge) comparisonChartLarge.resize();
  if (view === 'settings' && typeof syncSettingsInputs === 'function') syncSettingsInputs();
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
      const r = await fetch('/api/admin/stats');
      const data = await r.json();
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
      const r = await fetch('/api/admin/formats');
      const formats = await r.json();
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
  let selectedXlsFile = null;

  symbolsXlsSelectBtn.addEventListener('click', () => symbolsXlsPicker.click());

  symbolsXlsPicker.addEventListener('change', () => {
    selectedXlsFile = symbolsXlsPicker.files[0] || null;
    symbolsXlsName.textContent = selectedXlsFile ? selectedXlsFile.name : '未選択';
    symbolsXlsImportBtn.disabled = !selectedXlsFile;
  });

  symbolsXlsImportBtn.addEventListener('click', async () => {
    if (!selectedXlsFile) return;
    symbolsXlsImportBtn.disabled = true;
    symbolsXlsImportBtn.textContent = '更新中...';
    symbolsXlsResult.className = 'import-result hidden';

    try {
      const form = new FormData();
      form.append('file', selectedXlsFile);
      const res = await fetch('/api/admin/update-symbols', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '不明なエラー');
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

  // フォルダ選択
  const folderPicker = document.getElementById('folderPicker');
  const folderSelectBtn = document.getElementById('folderSelectBtn');
  const selectedFolderName = document.getElementById('selectedFolderName');
  const importBtn = document.getElementById('importBtn');

  folderSelectBtn.addEventListener('click', () => folderPicker.click());

  folderPicker.addEventListener('change', () => {
    const files = Array.from(folderPicker.files).filter(f => f.name.toUpperCase().endsWith('.CSV'));
    if (files.length === 0) {
      selectedFolderName.textContent = '未選択';
      importBtn.disabled = true;
      return;
    }
    // webkitRelativePath = "フォルダ名/ファイル名" → フォルダ名を取得
    const folderName = files[0].webkitRelativePath.split('/')[0];
    selectedFolderName.textContent = `${folderName}（${files.length} ファイル）`;
    importBtn.disabled = false;
  });

  importBtn.addEventListener('click', async () => {
    const files = Array.from(folderPicker.files).filter(f => f.name.toUpperCase().endsWith('.CSV'));
    if (files.length === 0) return;

    importBtn.disabled = true;
    importBtn.textContent = '取込中...';

    const progressWrap = document.getElementById('progressWrap');
    const progressBar  = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const resultBox    = document.getElementById('importResult');

    progressWrap.classList.remove('hidden');
    resultBox.classList.add('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = `0 / ${files.length} ファイルをアップロード中...`;

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    formData.append('format', document.getElementById('formatSelect').value);

    try {
      const response = await fetch('/api/admin/import', { method: 'POST', body: formData });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const msg = JSON.parse(line.slice(6));
          if (msg.type === 'progress') {
            const pct = msg.total ? Math.round(msg.done / msg.total * 100) : 0;
            progressBar.style.width = pct + '%';
            progressText.textContent = `${msg.done} / ${msg.total} ファイル処理中${msg.symbol ? ` (${msg.symbol})` : ''}`;
          } else if (msg.type === 'done') {
            progressBar.style.width = '100%';
            progressText.textContent = '完了';
            resultBox.className = 'import-result success';
            resultBox.classList.remove('hidden');
            resultBox.textContent = `取込完了：${msg.imported} 銘柄 / ${msg.totalRows.toLocaleString()} 行` +
              (msg.errors.length ? ` (エラー ${msg.errors.length} 件)` : '');
            loadAdminStats();
          } else if (msg.type === 'error') {
            resultBox.className = 'import-result error';
            resultBox.classList.remove('hidden');
            resultBox.textContent = msg.message;
          }
        }
      }
    } catch (err) {
      resultBox.className = 'import-result error';
      resultBox.classList.remove('hidden');
      resultBox.textContent = 'エラー: ' + err.message;
    } finally {
      importBtn.disabled = false;
      importBtn.textContent = '取込開始';
    }
  });

  async function deleteSymbol(symbol) {
    if (!confirm(`${symbol} のデータを削除しますか？`)) return;
    await fetch(`/api/admin/symbol/${symbol}`, { method: 'DELETE' });
    loadAdminStats();
  }

  // --- J-Quants ---
  (async function loadJqStatus() {
    try {
      const r = await fetch('/api/admin/jquants/status');
      const s = await r.json();
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
      const r = await fetch('/api/admin/jquants/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      const data = await r.json();
      const bar = document.getElementById('jqStatusBar');
      bar.classList.remove('hidden');
      if (r.ok) {
        bar.className = 'import-result success';
        bar.textContent = `接続成功：APIキーを保存しました（${data.status?.maskedKey ?? ''}）`;
        document.getElementById('jqApiKeyInput').value = '';
      } else {
        bar.className = 'import-result error';
        bar.textContent = data.error || '保存に失敗しました';
      }
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

  function startJqAutoDownload(endpoint, body) {
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

    let abortController = new AbortController();
    stopBtn.onclick = () => abortController.abort();

    const autoStartTime = Date.now();
    fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: abortController.signal })
      .then(async response => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const msg = JSON.parse(line.slice(6));
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
          }
        }
      }).catch(() => {})
      .finally(() => {
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
    try {
      const response = await fetch('/api/admin/jquants/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, period1, period2 }),
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const msg = JSON.parse(line.slice(6));
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
            resultBox.textContent = `取得完了：${msg.total} 銘柄 / ${msg.totalInserted?.toLocaleString() ?? 0} 行追加` +
              (msg.errors?.length ? ` (エラー ${msg.errors.length} 件)` : '');
            loadAdminStats();
          } else if (msg.type === 'error') {
            resultBox.className = 'import-result error';
            resultBox.classList.remove('hidden');
            resultBox.textContent = msg.message;
          }
        }
      }
    } catch (err) {
      resultBox.className = 'import-result error';
      resultBox.classList.remove('hidden');
      resultBox.textContent = 'エラー: ' + err.message;
    } finally {
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

    document.getElementById('jqUpdateBtn').addEventListener('click', () => {
      const period2 = document.getElementById('jqAutoTo').value || null;
      startJqAutoDownload('/api/admin/jquants/update', { period2, plan: selectedPlan });
    });
    document.getElementById('jqFillBtn').addEventListener('click', () => {
      const period1 = document.getElementById('jqAutoFrom').value;
      const period2 = document.getElementById('jqAutoTo').value || null;
      if (!period1) { alert('取得開始日を指定してください'); return; }
      if (!confirm(`DBにない全銘柄を ${period1} 〜 ${period2 || '今日'} で取得します。時間がかかる場合があります。続行しますか？`)) return;
      startJqAutoDownload('/api/admin/jquants/fill', { period1, period2, plan: selectedPlan });
    });
  })();

})();
