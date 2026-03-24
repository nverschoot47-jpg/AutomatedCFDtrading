// ═══════════════════════════════════════════════════════════════
// TradingView → MetaApi → MT5 TMS  |  Railway Webhook Server v10
// Account: 62670737  |  Demo €50.000  |  Risico: €25/trade (max €45)
// ─────────────────────────────────────────────────────────────
// NIEUW in v9:
//  ✅ Self-healing error learning (patches symbol/lot errors live)
//  ✅ Market hours guard (stocks only 15:30–21:00 CET, no weekend)
//  ✅ Crypto trades 24/7 including weekend
//  ✅ Auto-close stock positions Friday 20:50 CET
//  ✅ Max risk relaxed to €45 if lot too small to grab the trade
//  ✅ Same pair + same direction = half risk (anti-consolidation failsafe)
//  ✅ Gold futures chart on TradingView not connected → symbol remapped
// ─────────────────────────────────────────────────────────────
// NIEUW in v10:
//  ✅ Max Profit Tracker — peak price + max € reached per open trade
//  ✅ What-If RR Analysis — 2:1 / 3:1 / 4:1 scenarios on close
//  ✅ Real-Time Position Monitor — MetaApi sync every 30s
//  ✅ Account Equity Curve — snapshot balance/equity/float every 30s
//  ✅ Closed Trade Analysis  GET /analysis/closed
//  ✅ New endpoints: /live/positions  /analysis/equity-curve  /trades/:symbol  /history
// ═══════════════════════════════════════════════════════════════

const express = require("express");
const app = express();
app.use(express.json());

// ── CONFIG ────────────────────────────────────────────────────
const META_API_TOKEN  = process.env.META_API_TOKEN;
const META_ACCOUNT_ID = process.env.META_ACCOUNT_ID;
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET || "Pronto2025AI";
const ACCOUNT_BALANCE = 50000;
const RISK_PERCENT    = 0.0005;   // 0.05% = €25/trade base
const RISK_EUR_BASE   = ACCOUNT_BALANCE * RISK_PERCENT;  // €25
const RISK_EUR_MAX    = 45;       // max €45 if lot granularity forces it

// ── OPEN TRADE TRACKER (anti-consolidation) ───────────────────
// key: "SYMBOL_direction" → count of open trades in that direction
const openTradeTracker = {};

// ── v10: IN-MEMORY STORES ─────────────────────────────────────
// open_positions: positionId → trade record (max price updated by poller)
const openPositions = {};

// closed_trades: array of archived trades with what-if RR analysis
const closedTrades = [];

// account_snapshots: rolling 30-day equity curve (max ~87k entries @ 30s)
const accountSnapshots = [];
const MAX_SNAPSHOTS = 86400; // 30 days worth at 30s interval

// webhook_history: last 200 webhook calls (in/out log)
const webhookHistory = [];
const MAX_HISTORY = 200;

function addWebhookHistory(entry) {
  webhookHistory.unshift({ ts: new Date().toISOString(), ...entry });
  if (webhookHistory.length > MAX_HISTORY) webhookHistory.length = MAX_HISTORY;
}

// ── LEARNED PATCHES (self-healing) ───────────────────────────
// Persisted in memory; logs teach us what needs fixing.
// Structure: { "SYMBOL": { mt5Override: "X", lotStepOverride: 0.01, ... } }
const learnedPatches = {};

// ── SYMBOL MAP ────────────────────────────────────────────────
const SYMBOL_MAP = {
  // ── INDICES ──────────────────────────────────────────────────
  "NAS100USD":  { mt5: "US100.pro",  type: "index" },
  "SPX500USD":  { mt5: "US500.pro",  type: "index" },
  "US30USD":    { mt5: "US30.pro",   type: "index" },
  "UK100GBP":   { mt5: "GB100.pro",  type: "index" },
  "DE30EUR":    { mt5: "DE30.pro",   type: "index" },
  "FR40EUR":    { mt5: "FR40.pro",   type: "index" },
  "EU50EUR":    { mt5: "EU50.pro",   type: "index" },
  "JP225USD":   { mt5: "JP225.pro",  type: "index" },
  "AU200AUD":   { mt5: "AU200.pro",  type: "index" },
  "GER40":      { mt5: "DE30.pro",   type: "index" },
  "DE30":       { mt5: "DE30.pro",   type: "index" },
  "GER30":      { mt5: "DE30.pro",   type: "index" },
  "EU50":       { mt5: "EU50.pro",   type: "index" },
  "EUSTX50":    { mt5: "EU50.pro",   type: "index" },
  "FRA40":      { mt5: "FR40.pro",   type: "index" },
  "CAC40":      { mt5: "FR40.pro",   type: "index" },
  "UK100":      { mt5: "GB100.pro",  type: "index" },
  "FTSE100":    { mt5: "GB100.pro",  type: "index" },
  "US100":      { mt5: "US100.pro",  type: "index" },
  "NAS100":     { mt5: "US100.pro",  type: "index" },
  "US30":       { mt5: "US30.pro",   type: "index" },
  "DJ30":       { mt5: "US30.pro",   type: "index" },
  "US500":      { mt5: "US500.pro",  type: "index" },
  "SPX500":     { mt5: "US500.pro",  type: "index" },
  "SP500":      { mt5: "US500.pro",  type: "index" },
  "JP225":      { mt5: "JP225.pro",  type: "index" },
  "NKY225":     { mt5: "JP225.pro",  type: "index" },
  "AU200":      { mt5: "AU200.pro",  type: "index" },
  "ASX200":     { mt5: "AU200.pro",  type: "index" },

  // ── METALS ───────────────────────────────────────────────────
  // Gold: TradingView futures tickers (GOLD, GC1!, XAUUSD, GCJ2025 etc.)
  // ALL map to GOLD.pro on MT5 — futures chart ≠ live feed, remapped here
  "XAUUSD":     { mt5: "GOLD.pro",   type: "gold" },
  "GOLD":       { mt5: "GOLD.pro",   type: "gold" },
  "GC1!":       { mt5: "GOLD.pro",   type: "gold" },
  "GC2!":       { mt5: "GOLD.pro",   type: "gold" },
  "GCUSD":      { mt5: "GOLD.pro",   type: "gold" },
  "XAGUSD":     { mt5: "SILVER.pro", type: "silver" },
  "SILVER":     { mt5: "SILVER.pro", type: "silver" },

  // ── COMMODITIES ──────────────────────────────────────────────
  "NATGAS":     { mt5: "NATGAS.pro",  type: "natgas" },
  "NGAS":       { mt5: "NATGAS.pro",  type: "natgas" },
  "UKOIL":      { mt5: "OILBRNT.pro", type: "brent" },
  "USOIL":      { mt5: "OILBRNT.pro", type: "brent" },
  "BRENT":      { mt5: "OILBRNT.pro", type: "brent" },

  // ── CRYPTO (24/7) ─────────────────────────────────────────────
  "BTCUSD":     { mt5: "BTCUSD",  type: "crypto" },
  "BITCOIN":    { mt5: "BTCUSD",  type: "crypto" },
  "ETHUSD":     { mt5: "ETHUSD",  type: "crypto" },
  "ETHEREUM":   { mt5: "ETHUSD",  type: "crypto" },

  // ── US STOCKS ─────────────────────────────────────────────────
  "AAPL":  { mt5: "AAPL_CFD.US",  type: "stock" },
  "MSFT":  { mt5: "MSFT_CFD.US",  type: "stock" },
  "NVDA":  { mt5: "NVDA_CFD.US",  type: "stock" },
  "AMZN":  { mt5: "AMZN_CFD.US",  type: "stock" },
  "GOOGL": { mt5: "GOOGL_CFD.US", type: "stock" },
  "GOOG":  { mt5: "GOOG_CFD.US",  type: "stock" },
  "META":  { mt5: "META_CFD.US",  type: "stock" },
  "TSLA":  { mt5: "TSLA_CFD.US",  type: "stock" },
  "NFLX":  { mt5: "NFLX_CFD.US",  type: "stock" },
  "AMD":   { mt5: "AMD_CFD.US",   type: "stock" },
  "INTC":  { mt5: "INTC_CFD.US",  type: "stock" },
  "QCOM":  { mt5: "QCOM_CFD.US",  type: "stock" },
  "AVGO":  { mt5: "AVGO_CFD.US",  type: "stock" },
  "ORCL":  { mt5: "ORCL_CFD.US",  type: "stock" },
  "CRM":   { mt5: "CRM_CFD.US",   type: "stock" },
  "ADBE":  { mt5: "ADBE_CFD.US",  type: "stock" },
  "PLTR":  { mt5: "PLTR_CFD.US",  type: "stock" },
  "BBAI":  { mt5: "BBAI_CFD.US",  type: "stock" },
  "MP":    { mt5: "MP_CFD.US",    type: "stock" },
  "JPM":   { mt5: "JPM_CFD.US",   type: "stock" },
  "BAC":   { mt5: "BAC_CFD.US",   type: "stock" },
  "GS":    { mt5: "GS_CFD.US",    type: "stock" },
  "V":     { mt5: "V_CFD.US",     type: "stock" },
  "MA":    { mt5: "MA_CFD.US",    type: "stock" },
  "WMT":   { mt5: "WMT_CFD.US",   type: "stock" },
  "JNJ":   { mt5: "JNJ_CFD.US",   type: "stock" },
  "PFE":   { mt5: "PFE_CFD.US",   type: "stock" },
  "XOM":   { mt5: "XOM_CFD.US",   type: "stock" },
  "DIS":   { mt5: "DIS_CFD.US",   type: "stock" },
  "UBER":  { mt5: "UBER_CFD.US",  type: "stock" },
  "COIN":  { mt5: "COIN_CFD.US",  type: "stock" },
  "RIVN":  { mt5: "RIVN_CFD.US",  type: "stock" },
  "NIO":   { mt5: "NIO_CFD.US",   type: "stock" },
  "BABA":  { mt5: "BABA_CFD.US",  type: "stock" },
  "GME":   { mt5: "GME_CFD.US",   type: "stock" },

  // ── BELGIAN STOCKS ────────────────────────────────────────────
  "AGS":   { mt5: "AGS_CFD.BE",   type: "stock" },
  "ABI":   { mt5: "ABI_CFD.BE",   type: "stock" },
  "KBC":   { mt5: "KBC_CFD.BE",   type: "stock" },
  "UCB":   { mt5: "UCB_CFD.BE",   type: "stock" },
  "SOLB":  { mt5: "SOLB_CFD.BE",  type: "stock" },
  "GBLB":  { mt5: "GBLB_CFD.BE",  type: "stock" },
  "ACKB":  { mt5: "ACKB_CFD.BE",  type: "stock" },
  "PROXB": { mt5: "PROXB_CFD.BE", type: "stock" },
  "ARGX":  { mt5: "ARGX_CFD.BE",  type: "stock" },
  "UMI":   { mt5: "UMI_CFD.BE",   type: "stock" },

  // ── UK STOCKS ─────────────────────────────────────────────────
  "BARC":  { mt5: "BARC_CFD.UK",  type: "stock" },
  "LLOY":  { mt5: "LLOY_CFD.UK",  type: "stock" },
  "HSBA":  { mt5: "HSBA_CFD.UK",  type: "stock" },
  "BP":    { mt5: "BP_CFD.UK",    type: "stock" },
  "SHEL":  { mt5: "SHEL_CFD.UK",  type: "stock" },
  "VOD":   { mt5: "VOD_CFD.UK",   type: "stock" },
  "GSK":   { mt5: "GSK_CFD.UK",   type: "stock" },
  "AZN":   { mt5: "AZN_CFD.UK",   type: "stock" },
  "RIO":   { mt5: "RIO_CFD.UK",   type: "stock" },

  // ── GERMAN STOCKS ─────────────────────────────────────────────
  "SAP":   { mt5: "SAP_CFD.DE",   type: "stock" },
  "SIE":   { mt5: "SIE_CFD.DE",   type: "stock" },
  "ALV":   { mt5: "ALV_CFD.DE",   type: "stock" },
  "BMW":   { mt5: "BMW_CFD.DE",   type: "stock" },
  "MBG":   { mt5: "MBG_CFD.DE",   type: "stock" },
  "BAYN":  { mt5: "BAYN_CFD.DE",  type: "stock" },
  "DBK":   { mt5: "DBK_CFD.DE",   type: "stock" },
  "DTE":   { mt5: "DTE_CFD.DE",   type: "stock" },
  "ADS":   { mt5: "ADS_CFD.DE",   type: "stock" },
  "IFX":   { mt5: "IFX_CFD.DE",   type: "stock" },
};

// ── LOT VALUE PER PUNT PER LOT (EUR) ─────────────────────────
const LOT_VALUE = {
  "index":  25.00,
  "gold":    0.87,
  "silver": 43.42,
  "natgas":  8.60,
  "brent":  87.27,
  "crypto":  0.92,
  "stock":   1.00,
};

// ── MIN STOP DISTANCE ─────────────────────────────────────────
const MIN_STOP = {
  "DE30.pro":    5.0,
  "EU50.pro":    3.0,
  "FR40.pro":    3.0,
  "GB100.pro":   5.0,
  "US100.pro":   5.0,
  "US30.pro":    5.0,
  "US500.pro":   2.0,
  "JP225.pro":  10.0,
  "AU200.pro":   3.0,
  "GOLD.pro":    0.5,
  "SILVER.pro":  0.05,
  "NATGAS.pro":  0.02,
  "OILBRNT.pro": 0.05,
  "BTCUSD":     50.0,
  "default_stock": 0.01,
};

// ── MAX LOTS ──────────────────────────────────────────────────
const MAX_LOTS = {
  "index":  2.0,
  "gold":   5.0,
  "silver": 5.0,
  "natgas": 5.0,
  "brent":  2.0,
  "crypto": 0.1,
  "stock": 100.0,
};

// ── CRYPTO PREFIXES ───────────────────────────────────────────
const CRYPTO_PREFIXES = ["BTC","ETH","XRP","LTC","BCH","ADA","DOT","SOL"];

function getMT5Symbol(symbol) {
  // Check learned patches first (self-healing)
  if (learnedPatches[symbol]?.mt5Override) return learnedPatches[symbol].mt5Override;
  if (SYMBOL_MAP[symbol]) return SYMBOL_MAP[symbol].mt5;
  // Gold futures fallback: GCM2025, GCJ25 etc. → GOLD.pro
  if (/^GC[A-Z]\d+/.test(symbol)) return "GOLD.pro";
  if (CRYPTO_PREFIXES.some(c => symbol.startsWith(c))) return symbol;
  return `${symbol}_CFD.US`;
}

function getSymbolType(symbol) {
  if (SYMBOL_MAP[symbol]) return SYMBOL_MAP[symbol].type;
  if (/^GC[A-Z]\d+/.test(symbol)) return "gold";
  if (CRYPTO_PREFIXES.some(c => symbol.startsWith(c))) return "crypto";
  return "stock";
}

// ── MARKET HOURS (CET) ────────────────────────────────────────
// Stocks: Mon–Fri 15:30–21:00 CET
// Indices/metals/commodities: Mon 01:00 – Fri 23:00 CET
// Crypto: always open
function isCETMarketOpen(type) {
  const now = new Date();
  // Convert to CET (UTC+1 / UTC+2 in DST)
  // Using UTC offset: CET = UTC+1, CEST = UTC+2
  // Simple DST: last Sun Mar → last Sun Oct
  const month = now.getUTCMonth() + 1; // 1-12
  const dst = (month > 3 && month < 10) ||
    (month === 3 && now.getUTCDate() >= 25) ||
    (month === 10 && now.getUTCDate() < 25);
  const cetOffset = dst ? 2 : 1;
  const cetTime = new Date(now.getTime() + cetOffset * 3600 * 1000);

  const dayOfWeek = cetTime.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat
  const hour      = cetTime.getUTCHours();
  const minute    = cetTime.getUTCMinutes();
  const timeHHMM  = hour * 100 + minute;

  if (type === "crypto") return true; // 24/7

  // Weekend: Sat(6) full day closed, Sun(0) before 01:00 CET closed
  if (dayOfWeek === 6) return false;
  if (dayOfWeek === 0 && timeHHMM < 100) return false;

  if (type === "stock") {
    // Mon-Fri only, 15:30–21:00 CET
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;
    return timeHHMM >= 1530 && timeHHMM < 2100;
  }

  // Indices, metals, commodities: Mon–Fri with broad hours
  // Close ~23:00 Fri, reopen ~01:00 Mon
  if (dayOfWeek === 5 && timeHHMM >= 2300) return false; // Fri night close
  return true;
}

// ── FRIDAY AUTO-CLOSE CHECKER ────────────────────────────────
// Called every minute — closes stock positions at 20:50 CET Friday
async function checkFridayClose() {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const dst = (month > 3 && month < 10) ||
    (month === 3 && now.getUTCDate() >= 25) ||
    (month === 10 && now.getUTCDate() < 25);
  const cetOffset = dst ? 2 : 1;
  const cetTime = new Date(now.getTime() + cetOffset * 3600 * 1000);
  const dayOfWeek = cetTime.getUTCDay();
  const hour = cetTime.getUTCHours();
  const minute = cetTime.getUTCMinutes();

  if (dayOfWeek === 5 && hour === 20 && minute === 50) {
    console.log("🔔 Vrijdag 20:50 CET — sluit alle stock posities...");
    try {
      await closeAllPositionsByType("stock");
    } catch (e) {
      console.error("❌ Fout bij automatisch sluiten:", e.message);
    }
  }
}
setInterval(checkFridayClose, 60 * 1000);

// ── CLOSE ALL POSITIONS BY TYPE ───────────────────────────────
async function closeAllPositionsByType(type) {
  const url = `https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT_ID}/positions`;
  const res = await fetch(url, {
    headers: { "auth-token": META_API_TOKEN }
  });
  const positions = await res.json();
  if (!Array.isArray(positions)) return;

  for (const pos of positions) {
    const sym = pos.symbol || "";
    // Determine if it's a stock by checking suffix or SYMBOL_MAP
    const isStock = sym.includes("_CFD.") ||
      Object.values(SYMBOL_MAP).some(s => s.mt5 === sym && s.type === "stock");
    if (!isStock) continue;

    await closePosition(pos.id);
    // Clean tracker
    const key = `${sym}_buy`;
    const key2 = `${sym}_sell`;
    delete openTradeTracker[key];
    delete openTradeTracker[key2];
  }
}

// ── CLOSE SINGLE POSITION ─────────────────────────────────────
async function closePosition(positionId) {
  const url = `https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT_ID}/positions/${positionId}/close`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "auth-token": META_API_TOKEN,
    },
  });
  const data = await res.json();
  console.log(`🔒 Positie ${positionId} gesloten:`, JSON.stringify(data));
  return data;
}

// ── ANTI-CONSOLIDATION RISK HALVING ──────────────────────────
// Same symbol + same direction → halve risk each extra entry
function getEffectiveRisk(symbol, direction) {
  const key = `${symbol}_${direction}`;
  const count = openTradeTracker[key] || 0;
  // risk halves for each existing trade: 1st=€25, 2nd=€12.50, 3rd=€6.25...
  const risk = RISK_EUR_BASE / Math.pow(2, count);
  return Math.max(1, risk); // minimum €1
}

function incrementTradeTracker(symbol, direction) {
  const key = `${symbol}_${direction}`;
  openTradeTracker[key] = (openTradeTracker[key] || 0) + 1;
}

function decrementTradeTracker(symbol, direction) {
  const key = `${symbol}_${direction}`;
  if (openTradeTracker[key] > 0) openTradeTracker[key]--;
}

// ── LOT SIZE CALCULATION ──────────────────────────────────────
// Tries base risk, bumps up to max risk (€45) if lot step too coarse
function calcLots(symbol, entry, sl, effectiveRisk) {
  const type      = getSymbolType(symbol);
  const lotValue  = LOT_VALUE[type] || 1.0;
  const maxLots   = MAX_LOTS[type]  || 100.0;

  // Check for learned lot step
  const lotStep = learnedPatches[symbol]?.lotStepOverride || (type === "stock" ? 1 : 0.01);

  const slDistance = Math.abs(entry - sl);
  if (slDistance <= 0) return lotStep;

  let lots = effectiveRisk / (slDistance * lotValue);

  if (type === "stock") {
    lots = Math.floor(lots);
    if (lots < 1) {
      // Can we fit within max risk (€45)?
      const riskWith1Lot = 1 * slDistance * lotValue;
      if (riskWith1Lot <= RISK_EUR_MAX) {
        console.log(`⬆️ Lot te klein (<1 share) maar 1 share = €${riskWith1Lot.toFixed(2)} ≤ €${RISK_EUR_MAX} — doorgaan`);
        lots = 1;
      } else {
        console.warn(`❌ 1 share = €${riskWith1Lot.toFixed(2)} > €${RISK_EUR_MAX} — trade geannuleerd`);
        return null;
      }
    }
    lots = Math.min(maxLots, lots);
  } else {
    // Round to lot step
    lots = Math.round(lots / lotStep) * lotStep;
    lots = parseFloat(lots.toFixed(2));

    if (lots < lotStep) {
      // Can we fit one step within max risk?
      const riskWithMinLot = lotStep * slDistance * lotValue;
      if (riskWithMinLot <= RISK_EUR_MAX) {
        console.log(`⬆️ Lots < min step ${lotStep} maar min step = €${riskWithMinLot.toFixed(2)} ≤ €${RISK_EUR_MAX} — doorgaan`);
        lots = lotStep;
      } else {
        console.warn(`❌ Min lot = €${riskWithMinLot.toFixed(2)} > €${RISK_EUR_MAX} — trade geannuleerd`);
        return null;
      }
    }
    lots = Math.min(maxLots, lots);
  }

  const actualRisk = lots * slDistance * lotValue;
  console.log(`💶 Risico check: ${lots} lots × ${slDistance.toFixed(4)} pts × €${lotValue} = €${actualRisk.toFixed(2)}`);

  return lots;
}

// ── SL VALIDATION ─────────────────────────────────────────────
function validateSL(direction, entry, sl, mt5Symbol) {
  const minDist = MIN_STOP[mt5Symbol] || MIN_STOP["default_stock"] || 0.01;
  const slDist  = Math.abs(entry - sl);
  if (slDist < minDist) {
    const adjusted = direction === "buy" ? entry - minDist : entry + minDist;
    console.warn(`⚠️ SL te dicht (${slDist} < ${minDist}) → aangepast: ${adjusted}`);
    return adjusted;
  }
  return sl;
}

// ── PLACE ORDER ───────────────────────────────────────────────
async function placeOrder(direction, symbol, entry, sl, lots) {
  const mt5Symbol = getMT5Symbol(symbol);
  const orderType = direction === "buy" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL";
  const slPrice   = validateSL(direction, parseFloat(entry), parseFloat(sl), mt5Symbol);

  const body = {
    symbol:     mt5Symbol,
    volume:     lots,
    actionType: orderType,
    stopLoss:   slPrice,
    comment:    `TV-NV-${direction.toUpperCase()}-${symbol}`,
  };

  const url = `https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT_ID}/trade`;

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "auth-token":   META_API_TOKEN,
    },
    body: JSON.stringify(body),
  });

  const result = await res.json();
  return { result, mt5Symbol, slPrice, body };
}

// ── SELF-HEALING ERROR HANDLER ────────────────────────────────
// Reads MetaApi error codes and patches learnedPatches for next attempt
function learnFromError(symbol, errorCode, errorMessage, requestBody) {
  const msg = (errorMessage || "").toLowerCase();

  if (!learnedPatches[symbol]) learnedPatches[symbol] = {};

  // INVALID_SYMBOL → try alternate suffix
  if (errorCode === "TRADE_RETCODE_INVALID" && msg.includes("symbol")) {
    const current = getMT5Symbol(symbol);
    // Cycle through fallback suffixes
    const fallbacks = [
      current.replace(".pro", ""),              // remove .pro
      current.replace("_CFD.US", "_CFD.DE"),    // try DE exchange
      current.replace("_CFD.US", "_CFD.BE"),    // try BE exchange
      current.replace("_CFD.US", ""),           // bare symbol
    ].filter(s => s !== current);

    const alreadyTried = learnedPatches[symbol]._triedMt5 || [];
    const next = fallbacks.find(f => !alreadyTried.includes(f));
    if (next) {
      learnedPatches[symbol].mt5Override = next;
      learnedPatches[symbol]._triedMt5 = [...alreadyTried, next];
      console.log(`🧠 LEARN: ${symbol} → probeer MT5 symbol "${next}" volgende keer`);
    }
  }

  // INVALID_VOLUME → adjust lot step
  if (msg.includes("volume") || msg.includes("lot")) {
    const currentStep = learnedPatches[symbol]?.lotStepOverride || 0.01;
    const newStep = currentStep * 10; // bump up: 0.01 → 0.1 → 1
    learnedPatches[symbol].lotStepOverride = newStep;
    console.log(`🧠 LEARN: ${symbol} lot step aangepast naar ${newStep}`);
  }

  // INVALID_STOPS → increase min stop
  if (msg.includes("stop") || errorCode === "TRADE_RETCODE_INVALID_STOPS") {
    const mt5Sym = getMT5Symbol(symbol);
    const current = MIN_STOP[mt5Sym] || 0.01;
    MIN_STOP[mt5Sym] = current * 2;
    console.log(`🧠 LEARN: Min stop voor ${mt5Sym} verhoogd naar ${MIN_STOP[mt5Sym]}`);
  }

  // NO_MONEY → risk te hoog, log only (we already cap at €45)
  if (msg.includes("no money") || msg.includes("insufficient")) {
    console.warn(`⚠️ LEARN: Onvoldoende marge voor ${symbol} — overgeslagen`);
  }

  // Log all patches for debugging
  console.log("🔧 Huidige patches:", JSON.stringify(learnedPatches));
}

// ── v10: WHAT-IF RR CALCULATOR ────────────────────────────────
// Returns { "2:1": €xx, "3:1": €xx, "4:1": €xx } and whether maxPrice hit each TP
function calcWhatIfRR(trade) {
  const { direction, entry, sl, lots, maxPrice, symbol } = trade;
  const slDist    = Math.abs(entry - sl);
  const type      = getSymbolType(symbol);
  const lotValue  = LOT_VALUE[type] || 1.0;
  const riskPerLot = slDist * lotValue;

  const results = {};
  for (const rr of [2, 3, 4]) {
    const tpDist  = slDist * rr;
    const tp      = direction === "buy" ? entry + tpDist : entry - tpDist;
    const potential = lots * tpDist * lotValue;
    const wouldHit  = direction === "buy"
      ? maxPrice >= tp
      : maxPrice <= tp;
    results[`${rr}:1`] = {
      tp:        parseFloat(tp.toFixed(5)),
      potential: parseFloat(potential.toFixed(2)),
      wouldHit,
    };
  }
  return results;
}

// ── v10: METAAPI HELPERS ──────────────────────────────────────
const META_BASE = `https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT_ID}`;

async function fetchOpenPositions() {
  const res = await fetch(`${META_BASE}/positions`, {
    headers: { "auth-token": META_API_TOKEN }
  });
  if (!res.ok) throw new Error(`MetaApi positions ${res.status}`);
  return res.json();
}

async function fetchAccountInfo() {
  const res = await fetch(`${META_BASE}/accountInformation`, {
    headers: { "auth-token": META_API_TOKEN }
  });
  if (!res.ok) throw new Error(`MetaApi accountInfo ${res.status}`);
  return res.json();
}

// ── v10: POSITION SYNC LOOP ───────────────────────────────────
// Runs every 30 s — updates max price, detects closures, snapshots equity
async function syncPositions() {
  try {
    // 1) Fetch live positions from MetaApi
    const livePositions = await fetchOpenPositions();
    const liveIds = new Set((livePositions || []).map(p => String(p.id)));

    // 2) Update max price / max profit for each open position we track
    for (const pos of (livePositions || [])) {
      const id = String(pos.id);
      if (!openPositions[id]) continue; // not opened via this server

      const cur   = pos.currentPrice ?? pos.openPrice ?? 0;
      const trade = openPositions[id];
      const type  = getSymbolType(trade.symbol);
      const lotV  = LOT_VALUE[type] || 1.0;

      const unrealisedPnL = trade.direction === "buy"
        ? (cur - trade.entry) * trade.lots * lotV
        : (trade.entry - cur) * trade.lots * lotV;

      // Track peak in favourable direction
      const isBetter = trade.direction === "buy"
        ? cur > (trade.maxPrice ?? trade.entry)
        : cur < (trade.maxPrice ?? trade.entry);

      if (isBetter) {
        trade.maxPrice  = cur;
        trade.maxProfit = parseFloat(unrealisedPnL.toFixed(2));
      }
      trade.currentPrice    = cur;
      trade.currentPnL      = parseFloat(unrealisedPnL.toFixed(2));
      trade.lastSync        = new Date().toISOString();
    }

    // 3) Detect positions that closed since last sync
    for (const [id, trade] of Object.entries(openPositions)) {
      if (!liveIds.has(id)) {
        // Position gone — archive it
        const rr = calcWhatIfRR(trade);
        const closed = {
          ...trade,
          closedAt:   new Date().toISOString(),
          whatIfRR:   rr,
        };
        closedTrades.push(closed);
        // Clean up tracker
        if (trade.symbol && trade.direction) {
          decrementTradeTracker(trade.symbol, trade.direction);
        }
        delete openPositions[id];
        console.log(`📦 Positie ${id} (${trade.symbol}) gearchiveerd | maxProfit: €${trade.maxProfit ?? 0}`);
      }
    }

    // 4) Snapshot equity curve
    try {
      const info = await fetchAccountInfo();
      const snap = {
        ts:         new Date().toISOString(),
        balance:    info.balance    ?? null,
        equity:     info.equity     ?? null,
        floatingPL: info.margin     !== undefined
          ? parseFloat(((info.equity ?? 0) - (info.balance ?? 0)).toFixed(2))
          : null,
        margin:     info.margin     ?? null,
        freeMargin: info.freeMargin ?? null,
      };
      accountSnapshots.push(snap);
      if (accountSnapshots.length > MAX_SNAPSHOTS) accountSnapshots.shift();
    } catch (e) {
      console.warn("⚠️ Equity snapshot mislukt:", e.message);
    }

  } catch (e) {
    console.warn("⚠️ syncPositions fout:", e.message);
  }
}
setInterval(syncPositions, 30 * 1000);

// ── WEBHOOK ENDPOINT ──────────────────────────────────────────
// TradingView alert format:
// {"action":"buy","symbol":"XAUUSD","entry":{{close}},"sl":{{low}}}
app.post("/webhook", async (req, res) => {
  try {
    console.log("📨 Webhook ontvangen:", JSON.stringify(req.body));
    addWebhookHistory({ type: "RECEIVED", body: req.body });

    const secret = req.query.secret || req.headers["x-secret"];
    if (secret !== WEBHOOK_SECRET) {
      console.warn("⚠️ Ongeldige secret");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { action, symbol, entry, sl } = req.body;

    if (!action || !symbol || !entry || !sl) {
      return res.status(400).json({ error: "Vereist: action, symbol, entry, sl" });
    }

    const direction = ["buy","bull","long"].includes(action.toLowerCase()) ? "buy" : "sell";
    const entryNum  = parseFloat(entry);
    const slNum     = parseFloat(sl);

    if (isNaN(entryNum) || isNaN(slNum)) {
      return res.status(400).json({ error: "entry en sl moeten geldig getal zijn" });
    }

    if (direction === "buy"  && slNum >= entryNum) return res.status(400).json({ error: "SL moet onder entry voor BUY" });
    if (direction === "sell" && slNum <= entryNum) return res.status(400).json({ error: "SL moet boven entry voor SELL" });

    const symType = getSymbolType(symbol);
    const mt5Sym  = getMT5Symbol(symbol);

    // ── MARKET HOURS CHECK ──────────────────────────────────────
    if (!isCETMarketOpen(symType)) {
      const msg = `🕐 Markt gesloten voor ${symbol} (${symType}) op dit moment — order genegeerd`;
      console.warn(msg);
      return res.status(200).json({ status: "SKIP", reason: msg });
    }

    // ── UNKNOWN SYMBOL WARNING ───────────────────────────────────
    if (!SYMBOL_MAP[symbol]) {
      console.warn(`⚠️ Onbekend symbool: ${symbol} → probeer ${mt5Sym}`);
    }

    // ── ANTI-CONSOLIDATION RISK ──────────────────────────────────
    const effectiveRisk = getEffectiveRisk(symbol, direction);
    const tradeCount    = openTradeTracker[`${symbol}_${direction}`] || 0;
    if (tradeCount > 0) {
      console.log(`⚖️ Consolidatie guard: ${tradeCount} open ${direction} trades op ${symbol} → risico €${effectiveRisk.toFixed(2)}`);
    }

    // ── LOT CALCULATION ──────────────────────────────────────────
    const lots = calcLots(symbol, entryNum, slNum, effectiveRisk);
    if (lots === null) {
      return res.status(200).json({ status: "SKIP", reason: "Minimale lot groter dan max risico €45" });
    }

    const slAfstand = Math.abs(entryNum - slNum).toFixed(4);
    console.log(`📊 ${direction.toUpperCase()} ${symbol} (${mt5Sym}) [${symType}] | Entry: ${entryNum} | SL: ${slNum} | Afstand: ${slAfstand} | Lots: ${lots} | Risico: €${effectiveRisk.toFixed(2)}`);

    // ── PLACE ORDER (with retry on self-healed error) ─────────────
    let { result, mt5Symbol, slPrice, body } = await placeOrder(direction, symbol, entryNum, slNum, lots);
    console.log("📬 Order resultaat:", JSON.stringify(result));

    // Detect error in result
    const errCode = result?.error?.code || result?.retcode;
    const errMsg  = result?.error?.message || result?.comment || "";
    const isError = result?.error || (errCode && errCode !== 10009 && errCode !== "TRADE_RETCODE_DONE");

    if (isError) {
      console.warn(`⚠️ Order fout (${errCode}): ${errMsg}`);
      learnFromError(symbol, errCode, errMsg, body);

      // One retry with patched values
      console.log("🔄 Retry met gecorrigeerde waarden...");
      const retryLots = calcLots(symbol, entryNum, slNum, effectiveRisk);
      if (retryLots !== null) {
        const retry = await placeOrder(direction, symbol, entryNum, slNum, retryLots);
        result = retry.result;
        console.log("🔄 Retry resultaat:", JSON.stringify(result));

        const retryErr = result?.error || (result?.retcode && result?.retcode !== 10009 && result?.retcode !== "TRADE_RETCODE_DONE");
        if (retryErr) {
          learnFromError(symbol, result?.error?.code || result?.retcode, result?.error?.message || result?.comment, retry.body);
          return res.status(200).json({ status: "ERROR_LEARNED", note: "Fout gelogd, patch opgeslagen voor volgende keer", errCode, errMsg, learnedPatches });
        }
      }
    }

    // ── SUCCESS ──────────────────────────────────────────────────
    incrementTradeTracker(symbol, direction);

    // v10: Register position for max-profit tracking
    const posId = String(result?.positionId || result?.orderId || Date.now());
    openPositions[posId] = {
      id:          posId,
      symbol,
      mt5Symbol,
      direction,
      entry:       entryNum,
      sl:          slPrice,
      lots,
      riskEUR:     effectiveRisk,
      openedAt:    new Date().toISOString(),
      maxPrice:    entryNum,   // starts at entry, updated by sync loop
      maxProfit:   0,
      currentPnL:  0,
      lastSync:    null,
    };

    const responseBody = {
      status:       "OK",
      direction,
      mt5Symbol,
      entry:        entryNum,
      sl:           slPrice,
      slAfstand,
      lots,
      risicoEUR:    effectiveRisk.toFixed(2),
      maxRisicoEUR: RISK_EUR_MAX,
      tradeNummer:  (openTradeTracker[`${symbol}_${direction}`] || 1),
      positionId:   posId,
      metaApi:      result,
      learnedPatches: Object.keys(learnedPatches).length ? learnedPatches : undefined,
    };
    addWebhookHistory({ type: "SUCCESS", symbol, direction, lots, posId });
    res.json(responseBody);

  } catch (err) {
    console.error("❌ Fout:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── MANUAL CLOSE ENDPOINT ─────────────────────────────────────
// POST /close?secret=xxx  body: {"positionId":"123"}
app.post("/close", async (req, res) => {
  const secret = req.query.secret || req.headers["x-secret"];
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ error: "Unauthorized" });

  const { positionId, symbol, direction } = req.body;
  if (!positionId) return res.status(400).json({ error: "Vereist: positionId" });

  try {
    const result = await closePosition(positionId);
    if (symbol && direction) decrementTradeTracker(symbol, direction);
    res.json({ status: "OK", result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── TRADE TRACKER STATUS ──────────────────────────────────────
app.get("/status", (req, res) => {
  res.json({
    openTrades:     openTradeTracker,
    learnedPatches,
    risicoBase:     RISK_EUR_BASE,
    risicoMax:      RISK_EUR_MAX,
  });
});

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status:    "online",
    versie:    "v10",
    risicoEUR: RISK_EUR_BASE,
    maxRisico: RISK_EUR_MAX,
    symbols:   Object.keys(SYMBOL_MAP),
    features: [
      "self-healing errors",
      "market hours guard",
      "friday auto-close stocks",
      "crypto 24/7",
      "anti-consolidation risk halving",
      "gold futures remap",
      "max risk €45 fallback",
      "max profit tracker (30s sync)",
      "what-if 2:1/3:1/4:1 RR analysis",
      "account equity curve (30s snapshots)",
      "closed trade archiving",
    ],
    endpoints: {
      "POST /webhook":                   "TradingView alert → MT5 order",
      "POST /close":                     "Manual position close",
      "GET  /status":                    "Open trade tracker + learned patches",
      "GET  /live/positions":            "Open positions with max price/profit",
      "GET  /analysis/closed":           "Closed trades + what-if RR (opt: ?symbol=GOLD)",
      "GET  /analysis/equity-curve":     "Equity history (opt: ?hours=24)",
      "GET  /trades/:symbol":            "All closed trades for one symbol",
      "GET  /history":                   "Webhook call log (opt: ?limit=50)",
    },
    tracking: {
      openPositions:    Object.keys(openPositions).length,
      closedTrades:     closedTrades.length,
      equitySnapshots:  accountSnapshots.length,
      webhookHistory:   webhookHistory.length,
    },
  });
});

// ── v10: LIVE POSITIONS ───────────────────────────────────────
// GET /live/positions  — all open positions with max price/profit
app.get("/live/positions", (req, res) => {
  const positions = Object.values(openPositions).map(p => ({
    id:           p.id,
    symbol:       p.symbol,
    direction:    p.direction,
    entry:        p.entry,
    sl:           p.sl,
    lots:         p.lots,
    riskEUR:      p.riskEUR,
    openedAt:     p.openedAt,
    currentPrice: p.currentPrice ?? null,
    currentPnL:   p.currentPnL  ?? 0,
    maxPrice:     p.maxPrice,
    maxProfit:    p.maxProfit,
    lastSync:     p.lastSync,
  }));
  res.json({ count: positions.length, positions });
});

// ── v10: CLOSED TRADE ANALYSIS ────────────────────────────────
// GET /analysis/closed?symbol=GOLD  — what-if RR per symbol
app.get("/analysis/closed", (req, res) => {
  const { symbol } = req.query;
  const trades = symbol
    ? closedTrades.filter(t => t.symbol?.toUpperCase() === symbol.toUpperCase())
    : closedTrades;

  // Group by symbol
  const bySymbol = {};
  for (const t of trades) {
    const s = t.symbol || "UNKNOWN";
    if (!bySymbol[s]) bySymbol[s] = { trades: [], totalActual: 0, totalMaxReached: 0 };
    const g = bySymbol[s];
    g.trades.push({
      id:         t.id,
      direction:  t.direction,
      openedAt:   t.openedAt,
      closedAt:   t.closedAt,
      entry:      t.entry,
      maxPrice:   t.maxPrice,
      maxProfit:  t.maxProfit,
      whatIfRR:   t.whatIfRR,
    });
    g.totalActual    += t.maxProfit ?? 0;  // best P/L actually achieved while open
    g.totalMaxReached += t.maxProfit ?? 0;
  }

  // Summary per symbol
  const summary = Object.entries(bySymbol).map(([sym, g]) => {
    const rrSummary = {};
    for (const rr of ["2:1", "3:1", "4:1"]) {
      const possible  = g.trades.filter(t => t.whatIfRR?.[rr]?.wouldHit).length;
      const totalPot  = g.trades.reduce((sum, t) => sum + (t.whatIfRR?.[rr]?.potential ?? 0), 0);
      rrSummary[rr] = {
        wouldHave: possible,
        totalPotential: parseFloat(totalPot.toFixed(2)),
        missed:    parseFloat((totalPot - g.totalActual).toFixed(2)),
      };
    }
    return {
      symbol:       sym,
      tradeCount:   g.trades.length,
      avgMaxProfit: parseFloat((g.totalActual / (g.trades.length || 1)).toFixed(2)),
      whatIfRR:     rrSummary,
      trades:       g.trades,
    };
  });

  res.json({ total: trades.length, bySymbol: summary });
});

// ── v10: EQUITY CURVE ─────────────────────────────────────────
// GET /analysis/equity-curve?hours=24
app.get("/analysis/equity-curve", (req, res) => {
  const hours  = parseInt(req.query.hours) || 24;
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const snaps  = accountSnapshots.filter(s => s.ts >= cutoff);
  res.json({ hours, count: snaps.length, snapshots: snaps });
});

// ── v10: TRADES BY SYMBOL ─────────────────────────────────────
// GET /trades/:symbol  — all closed trades for one symbol
app.get("/trades/:symbol", (req, res) => {
  const sym    = req.params.symbol.toUpperCase();
  const trades = closedTrades.filter(t => t.symbol?.toUpperCase() === sym);
  res.json({ symbol: sym, count: trades.length, trades });
});

// ── v10: WEBHOOK HISTORY ──────────────────────────────────────
// GET /history?limit=50
app.get("/history", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, MAX_HISTORY);
  res.json({ count: webhookHistory.length, history: webhookHistory.slice(0, limit) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Webhook server v10 op poort ${PORT} | Basis risico: €${RISK_EUR_BASE} | Max risico: €${RISK_EUR_MAX}/trade | Sync: 30s`)
);
