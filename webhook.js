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
// ─────────────────────────────────────────────────────────────
// NIEUW in v11:
//  ✅ MCL1! / MGC1! / SIL1! / MBT1! futures mappings toegevoegd
//  ✅ syminfo.ticker fix — {{ticker}} vangnet in webhook
//  ✅ Regex fallbacks voor futures in getMT5Symbol + getSymbolType
// ═══════════════════════════════════════════════════════════════

const express = require("express");
const app = express();
app.use(express.json());

// ── CONFIG ────────────────────────────────────────────────────
const META_API_TOKEN  = process.env.META_API_TOKEN;
const META_ACCOUNT_ID = process.env.META_ACCOUNT_ID;
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET || "Pronto2025AI";
const ACCOUNT_BALANCE = 50000;
const RISK_PERCENT    = 0.0005;
const RISK_EUR_BASE   = ACCOUNT_BALANCE * RISK_PERCENT;  // €25
const RISK_EUR_MAX    = 45;

// ── OPEN TRADE TRACKER ────────────────────────────────────────
const openTradeTracker = {};

// ── v10: IN-MEMORY STORES ─────────────────────────────────────
const openPositions    = {};
const closedTrades     = [];
const accountSnapshots = [];
const MAX_SNAPSHOTS    = 86400;
const webhookHistory   = [];
const MAX_HISTORY      = 200;

function addWebhookHistory(entry) {
  webhookHistory.unshift({ ts: new Date().toISOString(), ...entry });
  if (webhookHistory.length > MAX_HISTORY) webhookHistory.length = MAX_HISTORY;
}

// ── LEARNED PATCHES ───────────────────────────────────────────
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
  "XAUUSD":     { mt5: "GOLD.pro",         type: "gold"   },
  "GOLD":       { mt5: "GOLD.pro",         type: "gold"   },
  "GC1!":       { mt5: "GOLD.pro",         type: "gold"   },
  "GC2!":       { mt5: "GOLD.pro",         type: "gold"   },
  "GCUSD":      { mt5: "GOLD.pro",         type: "gold"   },
  "MGC1!":      { mt5: "GOLD.pro",         type: "gold"   },
  "XAGUSD":     { mt5: "SILVER Spot.pro",  type: "silver" },
  "SILVER":     { mt5: "SILVER Spot.pro",  type: "silver" },
  "SIL1!":      { mt5: "SILVER Spot.pro",  type: "silver" },

  // ── COMMODITIES ──────────────────────────────────────────────
  "NATGAS":     { mt5: "NATGAS.pro",   type: "natgas" },
  "NGAS":       { mt5: "NATGAS.pro",   type: "natgas" },
  "UKOIL":      { mt5: "OILBRNT.pro",  type: "brent"  },
  "USOIL":      { mt5: "OILBRNT.pro",  type: "brent"  },
  "BRENT":      { mt5: "OILBRNT.pro",  type: "brent"  },
  "MCL1!":      { mt5: "OILBRNT.pro",  type: "brent"  },

  // ── CRYPTO (24/7) ─────────────────────────────────────────────
  "BTCUSD":     { mt5: "BTCUSD",  type: "crypto" },
  "BITCOIN":    { mt5: "BTCUSD",  type: "crypto" },
  "ETHUSD":     { mt5: "ETHUSD",  type: "crypto" },
  "ETHEREUM":   { mt5: "ETHUSD",  type: "crypto" },
  "MBT1!":      { mt5: "BTCUSD",  type: "crypto" },

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
  "gold":    9.43,
  "silver": 25.00,
  "natgas":  8,
  "brent":  17.33,
  "crypto":  1.00,
  "stock":   1.00,
};

// ── MIN STOP DISTANCE ─────────────────────────────────────────
const MIN_STOP = {
  "DE30.pro":      5.0,
  "EU50.pro":      3.0,
  "FR40.pro":      3.0,
  "GB100.pro":     5.0,
  "US100.pro":     5.0,
  "US30.pro":      5.0,
  "US500.pro":     2.0,
  "JP225.pro":    10.0,
  "AU200.pro":     3.0,
  "GOLD.pro":      0.5,
  "SILVER Spot.pro": 0.05,
  "NATGAS.pro":    0.02,
  "OILBRNT.pro":   0.05,
  "BTCUSD":       50.0,
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
  if (learnedPatches[symbol]?.mt5Override) return learnedPatches[symbol].mt5Override;
  if (SYMBOL_MAP[symbol]) return SYMBOL_MAP[symbol].mt5;
  // Gold futures fallback: GCM2025, GCJ25 etc.
  if (/^GC[A-Z]\d+/.test(symbol)) return "GOLD.pro";
  // Micro futures fallbacks
  if (/^MGC/.test(symbol)) return "GOLD.pro";
  if (/^MCL/.test(symbol)) return "OILBRNT.pro";
  if (/^SIL/.test(symbol)) return "SILVER Spot.pro";
  if (/^MBT/.test(symbol)) return "BTCUSD";
  if (CRYPTO_PREFIXES.some(c => symbol.startsWith(c))) return symbol;
  return `${symbol}_CFD.US`;
}

function getSymbolType(symbol) {
  if (SYMBOL_MAP[symbol]) return SYMBOL_MAP[symbol].type;
  if (/^GC[A-Z]\d+/.test(symbol)) return "gold";
  if (/^MGC/.test(symbol)) return "gold";
  if (/^MCL/.test(symbol)) return "brent";
  if (/^SIL/.test(symbol)) return "silver";
  if (/^MBT/.test(symbol)) return "crypto";
  if (CRYPTO_PREFIXES.some(c => symbol.startsWith(c))) return "crypto";
  return "stock";
}

// ── MARKET HOURS (CET) ────────────────────────────────────────
function isCETMarketOpen(type) {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const dst = (month > 3 && month < 10) ||
    (month === 3 && now.getUTCDate() >= 25) ||
    (month === 10 && now.getUTCDate() < 25);
  const cetOffset = dst ? 2 : 1;
  const cetTime = new Date(now.getTime() + cetOffset * 3600 * 1000);

  const dayOfWeek = cetTime.getUTCDay();
  const hour      = cetTime.getUTCHours();
  const minute    = cetTime.getUTCMinutes();
  const timeHHMM  = hour * 100 + minute;

  if (type === "crypto") return true;

  if (dayOfWeek === 6) return false;
  if (dayOfWeek === 0 && timeHHMM < 100) return false;

  if (type === "stock") {
    if (dayOfWeek === 0 || dayOfWeek === 6) return false;
    return timeHHMM >= 1530 && timeHHMM < 2100;
  }

  if (dayOfWeek === 5 && timeHHMM >= 2300) return false;
  return true;
}

// ── FRIDAY AUTO-CLOSE ─────────────────────────────────────────
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

// ── CLOSE ALL BY TYPE ─────────────────────────────────────────
async function closeAllPositionsByType(type) {
  const url = `https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT_ID}/positions`;
  const res = await fetch(url, { headers: { "auth-token": META_API_TOKEN } });
  const positions = await res.json();
  if (!Array.isArray(positions)) return;

  for (const pos of positions) {
    const sym = pos.symbol || "";
    const isStock = sym.includes("_CFD.") ||
      Object.values(SYMBOL_MAP).some(s => s.mt5 === sym && s.type === "stock");
    if (!isStock) continue;
    await closePosition(pos.id);
    delete openTradeTracker[`${sym}_buy`];
    delete openTradeTracker[`${sym}_sell`];
  }
}

// ── CLOSE SINGLE POSITION ─────────────────────────────────────
async function closePosition(positionId) {
  const url = `https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT_ID}/positions/${positionId}/close`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "auth-token": META_API_TOKEN },
  });
  const data = await res.json();
  console.log(`🔒 Positie ${positionId} gesloten:`, JSON.stringify(data));
  return data;
}

// ── ANTI-CONSOLIDATION ────────────────────────────────────────
function getEffectiveRisk(symbol, direction) {
  const key   = `${symbol}_${direction}`;
  const count = openTradeTracker[key] || 0;
  return Math.max(1, RISK_EUR_BASE / Math.pow(2, count));
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
function calcLots(symbol, entry, sl, effectiveRisk) {
  const type     = getSymbolType(symbol);
  const lotValue = LOT_VALUE[type] || 1.0;
  const maxLots  = MAX_LOTS[type]  || 100.0;
  const lotStep  = learnedPatches[symbol]?.lotStepOverride || (type === "stock" ? 1 : 0.01);
  const slDist   = Math.abs(entry - sl);
  if (slDist <= 0) return lotStep;

  let lots = effectiveRisk / (slDist * lotValue);

  if (type === "stock") {
    lots = Math.floor(lots);
    if (lots < 1) {
      const riskWith1 = 1 * slDist * lotValue;
      if (riskWith1 <= RISK_EUR_MAX) {
        console.log(`⬆️ 1 share = €${riskWith1.toFixed(2)} ≤ €${RISK_EUR_MAX} — doorgaan`);
        lots = 1;
      } else {
        console.warn(`❌ 1 share = €${riskWith1.toFixed(2)} > €${RISK_EUR_MAX} — geannuleerd`);
        return null;
      }
    }
    lots = Math.min(maxLots, lots);
  } else {
    lots = Math.round(lots / lotStep) * lotStep;
    lots = parseFloat(lots.toFixed(2));
    if (lots < lotStep) {
      const riskWithMin = lotStep * slDist * lotValue;
      if (riskWithMin <= RISK_EUR_MAX) {
        console.log(`⬆️ Min step = €${riskWithMin.toFixed(2)} ≤ €${RISK_EUR_MAX} — doorgaan`);
        lots = lotStep;
      } else {
        console.warn(`❌ Min lot = €${riskWithMin.toFixed(2)} > €${RISK_EUR_MAX} — geannuleerd`);
        return null;
      }
    }
    lots = Math.min(maxLots, lots);
  }

  const actualRisk = lots * slDist * lotValue;
  console.log(`💶 Risico: ${lots} lots × ${slDist.toFixed(4)} pts × €${lotValue} = €${actualRisk.toFixed(2)}`);
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
    headers: { "Content-Type": "application/json", "auth-token": META_API_TOKEN },
    body:    JSON.stringify(body),
  });

  const result = await res.json();
  return { result, mt5Symbol, slPrice, body };
}

// ── SELF-HEALING ──────────────────────────────────────────────
function learnFromError(symbol, errorCode, errorMessage, requestBody) {
  const msg = (errorMessage || "").toLowerCase();
  if (!learnedPatches[symbol]) learnedPatches[symbol] = {};

  if (errorCode === "TRADE_RETCODE_INVALID" && msg.includes("symbol")) {
    const current   = getMT5Symbol(symbol);
    const fallbacks = [
      current.replace(".pro", ""),
      current.replace("_CFD.US", "_CFD.DE"),
      current.replace("_CFD.US", "_CFD.BE"),
      current.replace("_CFD.US", ""),
    ].filter(s => s !== current);
    const alreadyTried = learnedPatches[symbol]._triedMt5 || [];
    const next = fallbacks.find(f => !alreadyTried.includes(f));
    if (next) {
      learnedPatches[symbol].mt5Override = next;
      learnedPatches[symbol]._triedMt5 = [...alreadyTried, next];
      console.log(`🧠 LEARN: ${symbol} → probeer "${next}"`);
    }
  }

  if (msg.includes("volume") || msg.includes("lot")) {
    const cur = learnedPatches[symbol]?.lotStepOverride || 0.01;
    learnedPatches[symbol].lotStepOverride = cur * 10;
    console.log(`🧠 LEARN: ${symbol} lot step → ${learnedPatches[symbol].lotStepOverride}`);
  }

  if (msg.includes("stop") || errorCode === "TRADE_RETCODE_INVALID_STOPS") {
    const mt5Sym = getMT5Symbol(symbol);
    MIN_STOP[mt5Sym] = (MIN_STOP[mt5Sym] || 0.01) * 2;
    console.log(`🧠 LEARN: Min stop ${mt5Sym} → ${MIN_STOP[mt5Sym]}`);
  }

  if (msg.includes("no money") || msg.includes("insufficient")) {
    console.warn(`⚠️ Onvoldoende marge voor ${symbol}`);
  }

  console.log("🔧 Patches:", JSON.stringify(learnedPatches));
}

// ── WHAT-IF RR ────────────────────────────────────────────────
function calcWhatIfRR(trade) {
  const { direction, entry, sl, lots, maxPrice, symbol } = trade;
  const slDist   = Math.abs(entry - sl);
  const lotValue = LOT_VALUE[getSymbolType(symbol)] || 1.0;
  const results  = {};

  for (const rr of [2, 3, 4]) {
    const tpDist  = slDist * rr;
    const tp      = direction === "buy" ? entry + tpDist : entry - tpDist;
    const potential = lots * tpDist * lotValue;
    const wouldHit  = direction === "buy" ? maxPrice >= tp : maxPrice <= tp;
    results[`${rr}:1`] = {
      tp:        parseFloat(tp.toFixed(5)),
      potential: parseFloat(potential.toFixed(2)),
      wouldHit,
    };
  }
  return results;
}

// ── METAAPI HELPERS ───────────────────────────────────────────
const META_BASE = `https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT_ID}`;

async function fetchOpenPositions() {
  const res = await fetch(`${META_BASE}/positions`, { headers: { "auth-token": META_API_TOKEN } });
  if (!res.ok) throw new Error(`MetaApi positions ${res.status}`);
  return res.json();
}

async function fetchAccountInfo() {
  const res = await fetch(`${META_BASE}/accountInformation`, { headers: { "auth-token": META_API_TOKEN } });
  if (!res.ok) throw new Error(`MetaApi accountInfo ${res.status}`);
  return res.json();
}

// ── POSITION SYNC LOOP (30s) ──────────────────────────────────
async function syncPositions() {
  try {
    const livePositions = await fetchOpenPositions();
    const liveIds = new Set((livePositions || []).map(p => String(p.id)));

    for (const pos of (livePositions || [])) {
      const id = String(pos.id);
      if (!openPositions[id]) continue;
      const cur   = pos.currentPrice ?? pos.openPrice ?? 0;
      const trade = openPositions[id];
      const lotV  = LOT_VALUE[getSymbolType(trade.symbol)] || 1.0;
      const pnl   = trade.direction === "buy"
        ? (cur - trade.entry) * trade.lots * lotV
        : (trade.entry - cur) * trade.lots * lotV;
      const isBetter = trade.direction === "buy"
        ? cur > (trade.maxPrice ?? trade.entry)
        : cur < (trade.maxPrice ?? trade.entry);
      if (isBetter) { trade.maxPrice = cur; trade.maxProfit = parseFloat(pnl.toFixed(2)); }
      trade.currentPrice = cur;
      trade.currentPnL   = parseFloat(pnl.toFixed(2));
      trade.lastSync     = new Date().toISOString();
    }

    for (const [id, trade] of Object.entries(openPositions)) {
      if (!liveIds.has(id)) {
        closedTrades.push({ ...trade, closedAt: new Date().toISOString(), whatIfRR: calcWhatIfRR(trade) });
        if (trade.symbol && trade.direction) decrementTradeTracker(trade.symbol, trade.direction);
        delete openPositions[id];
        console.log(`📦 Positie ${id} (${trade.symbol}) gearchiveerd | maxProfit: €${trade.maxProfit ?? 0}`);
      }
    }

    try {
      const info = await fetchAccountInfo();
      accountSnapshots.push({
        ts:         new Date().toISOString(),
        balance:    info.balance    ?? null,
        equity:     info.equity     ?? null,
        floatingPL: parseFloat(((info.equity ?? 0) - (info.balance ?? 0)).toFixed(2)),
        margin:     info.margin     ?? null,
        freeMargin: info.freeMargin ?? null,
      });
      if (accountSnapshots.length > MAX_SNAPSHOTS) accountSnapshots.shift();
    } catch (e) { console.warn("⚠️ Equity snapshot mislukt:", e.message); }

  } catch (e) { console.warn("⚠️ syncPositions fout:", e.message); }
}
setInterval(syncPositions, 30 * 1000);

// ── WEBHOOK ENDPOINT ──────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    console.log("📨 Webhook ontvangen:", JSON.stringify(req.body));
    addWebhookHistory({ type: "RECEIVED", body: req.body });

    const secret = req.query.secret || req.headers["x-secret"];
    if (secret !== WEBHOOK_SECRET) {
      console.warn("⚠️ Ongeldige secret");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { action, entry, sl } = req.body;

    // ── v11: {{ticker}} vangnet ───────────────────────────────
    const symbol = (req.body.symbol === "{{ticker}}" || !req.body.symbol)
      ? null : req.body.symbol;

    if (!symbol) {
      console.warn("⚠️ Symbool is {{ticker}} of leeg — hermaak de TradingView alert.");
      return res.status(400).json({
        error: "Symbool ontbreekt of is letterlijk {{ticker}} — verwijder de alert in TradingView en maak hem opnieuw aan met 'Any alert() function call'."
      });
    }

    if (!action || !entry || !sl) {
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

    if (!isCETMarketOpen(symType)) {
      const msg = `🕐 Markt gesloten voor ${symbol} (${symType}) — order genegeerd`;
      console.warn(msg);
      return res.status(200).json({ status: "SKIP", reason: msg });
    }

    if (!SYMBOL_MAP[symbol]) {
      console.warn(`⚠️ Onbekend symbool: ${symbol} → probeer ${mt5Sym}`);
    }

    const effectiveRisk = getEffectiveRisk(symbol, direction);
    const tradeCount    = openTradeTracker[`${symbol}_${direction}`] || 0;
    if (tradeCount > 0) {
      console.log(`⚖️ Consolidatie guard: ${tradeCount} open ${direction} op ${symbol} → €${effectiveRisk.toFixed(2)}`);
    }

    const lots = calcLots(symbol, entryNum, slNum, effectiveRisk);
    if (lots === null) {
      return res.status(200).json({ status: "SKIP", reason: "Minimale lot groter dan max risico €45" });
    }

    const slAfstand = Math.abs(entryNum - slNum).toFixed(4);
    console.log(`📊 ${direction.toUpperCase()} ${symbol} (${mt5Sym}) [${symType}] | Entry: ${entryNum} | SL: ${slNum} | Afstand: ${slAfstand} | Lots: ${lots} | Risico: €${effectiveRisk.toFixed(2)}`);

    let { result, mt5Symbol, slPrice, body } = await placeOrder(direction, symbol, entryNum, slNum, lots);
    console.log("📬 Order resultaat:", JSON.stringify(result));

    const errCode = result?.error?.code || result?.retcode;
    const errMsg  = result?.error?.message || result?.comment || "";
    const isError = result?.error || (errCode && errCode !== 10009 && errCode !== "TRADE_RETCODE_DONE");

    if (isError) {
      console.warn(`⚠️ Order fout (${errCode}): ${errMsg}`);
      learnFromError(symbol, errCode, errMsg, body);
      console.log("🔄 Retry...");
      const retryLots = calcLots(symbol, entryNum, slNum, effectiveRisk);
      if (retryLots !== null) {
        const retry = await placeOrder(direction, symbol, entryNum, slNum, retryLots);
        result = retry.result;
        console.log("🔄 Retry resultaat:", JSON.stringify(result));
        const retryErr = result?.error || (result?.retcode && result?.retcode !== 10009 && result?.retcode !== "TRADE_RETCODE_DONE");
        if (retryErr) {
          learnFromError(symbol, result?.error?.code || result?.retcode, result?.error?.message || result?.comment, retry.body);
          return res.status(200).json({ status: "ERROR_LEARNED", errCode, errMsg, learnedPatches });
        }
      }
    }

    incrementTradeTracker(symbol, direction);

    const posId = String(result?.positionId || result?.orderId || Date.now());
    openPositions[posId] = {
      id: posId, symbol, mt5Symbol, direction,
      entry: entryNum, sl: slPrice, lots,
      riskEUR:   effectiveRisk,
      openedAt:  new Date().toISOString(),
      maxPrice:  entryNum,
      maxProfit: 0,
      currentPnL: 0,
      lastSync:  null,
    };

    const responseBody = {
      status: "OK", direction, mt5Symbol,
      entry: entryNum, sl: slPrice, slAfstand, lots,
      risicoEUR:    effectiveRisk.toFixed(2),
      maxRisicoEUR: RISK_EUR_MAX,
      tradeNummer:  openTradeTracker[`${symbol}_${direction}`] || 1,
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

// ── MANUAL CLOSE ──────────────────────────────────────────────
app.post("/close", async (req, res) => {
  const secret = req.query.secret || req.headers["x-secret"];
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ error: "Unauthorized" });
  const { positionId, symbol, direction } = req.body;
  if (!positionId) return res.status(400).json({ error: "Vereist: positionId" });
  try {
    const result = await closePosition(positionId);
    if (symbol && direction) decrementTradeTracker(symbol, direction);
    res.json({ status: "OK", result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STATUS ────────────────────────────────────────────────────
app.get("/status", (req, res) => {
  res.json({ openTrades: openTradeTracker, learnedPatches, risicoBase: RISK_EUR_BASE, risicoMax: RISK_EUR_MAX });
});

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "online", versie: "v11",
    risicoEUR: RISK_EUR_BASE, maxRisico: RISK_EUR_MAX,
    symbols: Object.keys(SYMBOL_MAP),
    features: [
      "self-healing errors", "market hours guard",
      "friday auto-close stocks", "crypto 24/7",
      "anti-consolidation risk halving", "gold futures remap",
      "max risk €45 fallback", "max profit tracker (30s sync)",
      "what-if 2:1/3:1/4:1 RR analysis",
      "account equity curve (30s snapshots)",
      "closed trade archiving",
      "MCL1!/MGC1!/SIL1!/MBT1! futures mappings",
      "{{ticker}} vangnet met duidelijke foutmelding",
    ],
    endpoints: {
      "POST /webhook":              "TradingView alert → MT5 order",
      "POST /close":                "Manual position close",
      "GET  /status":               "Open trades + learned patches",
      "GET  /live/positions":       "Open posities met max price/profit",
      "GET  /analysis/closed":      "Gesloten trades + what-if RR",
      "GET  /analysis/equity-curve":"Equity history (opt: ?hours=24)",
      "GET  /trades/:symbol":       "Gesloten trades per symbool",
      "GET  /history":              "Webhook log (opt: ?limit=50)",
    },
    tracking: {
      openPositions:   Object.keys(openPositions).length,
      closedTrades:    closedTrades.length,
      equitySnapshots: accountSnapshots.length,
      webhookHistory:  webhookHistory.length,
    },
  });
});

// ── LIVE POSITIONS ────────────────────────────────────────────
app.get("/live/positions", (req, res) => {
  const positions = Object.values(openPositions).map(p => ({
    id: p.id, symbol: p.symbol, direction: p.direction,
    entry: p.entry, sl: p.sl, lots: p.lots, riskEUR: p.riskEUR,
    openedAt: p.openedAt, currentPrice: p.currentPrice ?? null,
    currentPnL: p.currentPnL ?? 0, maxPrice: p.maxPrice,
    maxProfit: p.maxProfit, lastSync: p.lastSync,
  }));
  res.json({ count: positions.length, positions });
});

// ── CLOSED ANALYSIS ───────────────────────────────────────────
app.get("/analysis/closed", (req, res) => {
  const { symbol } = req.query;
  const trades = symbol
    ? closedTrades.filter(t => t.symbol?.toUpperCase() === symbol.toUpperCase())
    : closedTrades;

  const bySymbol = {};
  for (const t of trades) {
    const s = t.symbol || "UNKNOWN";
    if (!bySymbol[s]) bySymbol[s] = { trades: [], totalActual: 0 };
    bySymbol[s].trades.push(t);
    bySymbol[s].totalActual += t.maxProfit ?? 0;
  }

  const summary = Object.entries(bySymbol).map(([sym, g]) => {
    const rrSummary = {};
    for (const rr of ["2:1","3:1","4:1"]) {
      const possible = g.trades.filter(t => t.whatIfRR?.[rr]?.wouldHit).length;
      const totalPot = g.trades.reduce((sum, t) => sum + (t.whatIfRR?.[rr]?.potential ?? 0), 0);
      rrSummary[rr] = { wouldHave: possible, totalPotential: parseFloat(totalPot.toFixed(2)) };
    }
    return { symbol: sym, tradeCount: g.trades.length, whatIfRR: rrSummary, trades: g.trades };
  });

  res.json({ total: trades.length, bySymbol: summary });
});

// ── EQUITY CURVE ──────────────────────────────────────────────
app.get("/analysis/equity-curve", (req, res) => {
  const hours  = parseInt(req.query.hours) || 24;
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  res.json({ hours, count: accountSnapshots.filter(s => s.ts >= cutoff).length, snapshots: accountSnapshots.filter(s => s.ts >= cutoff) });
});

// ── TRADES BY SYMBOL ──────────────────────────────────────────
app.get("/trades/:symbol", (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  const trades = closedTrades.filter(t => t.symbol?.toUpperCase() === sym);
  res.json({ symbol: sym, count: trades.length, trades });
});

// ── WEBHOOK HISTORY ───────────────────────────────────────────
app.get("/history", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, MAX_HISTORY);
  res.json({ count: webhookHistory.length, history: webhookHistory.slice(0, limit) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Webhook server v11 | Risico: €${RISK_EUR_BASE} | Max: €${RISK_EUR_MAX} | Sync: 30s`)
);
