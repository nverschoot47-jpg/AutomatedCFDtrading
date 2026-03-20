// ═══════════════════════════════════════════════════════════════
// TradingView → MetaApi → MT5 TMS  |  Railway Webhook Server v7
// Account: 62670737  |  Demo €50.000  |  Risico: 0.05% = €25/trade
// Gecalibreerd op echte TMS trade data — maart 2026
// ═══════════════════════════════════════════════════════════════

const express = require("express");
const app = express();
app.use(express.json());

// ── CONFIG ────────────────────────────────────────────────────
const META_API_TOKEN  = process.env.META_API_TOKEN;
const META_ACCOUNT_ID = process.env.META_ACCOUNT_ID;
const WEBHOOK_SECRET  = process.env.WEBHOOK_SECRET || "Pronto2025AI";
const ACCOUNT_BALANCE = 50000;
const RISK_PERCENT    = 0.0005;  // 0.05% = €25/trade (verlaagd van 0.1%)
const RISK_EUR        = ACCOUNT_BALANCE * RISK_PERCENT;

// ── SYMBOL MAPPING (TradingView → MT5 exacte namen) ──────────
// Bevestigd via MT5 desktop platform maart 2026
const SYMBOL_MAP = {
  // ── INDICES ───────────────────────────────────────────────────
  "GER40":   { mt5: "DE30.pro",   type: "index" },
  "DE30":    { mt5: "DE30.pro",   type: "index" },
  "GER30":   { mt5: "DE30.pro",   type: "index" },
  "EU50":    { mt5: "EU50.pro",   type: "index" },
  "EUSTX50": { mt5: "EU50.pro",   type: "index" },
  "FRA40":   { mt5: "FR40.pro",   type: "index" },
  "CAC40":   { mt5: "FR40.pro",   type: "index" },
  "UK100":   { mt5: "GB100.pro",  type: "index" },
  "FTSE100": { mt5: "GB100.pro",  type: "index" },
  "US100":   { mt5: "US100.pro",  type: "index" },
  "NAS100":  { mt5: "US100.pro",  type: "index" },
  "US30":    { mt5: "US30.pro",   type: "index" },
  "DJ30":    { mt5: "US30.pro",   type: "index" },
  "US500":   { mt5: "US500.pro",  type: "index" },
  "SPX500":  { mt5: "US500.pro",  type: "index" },
  "SP500":   { mt5: "US500.pro",  type: "index" },
  "JP225":   { mt5: "JP225.pro",  type: "index" },
  "NKY225":  { mt5: "JP225.pro",  type: "index" },
  "AU200":   { mt5: "AU200.pro",  type: "index" },
  "ASX200":  { mt5: "AU200.pro",  type: "index" },

  // ── METALEN ──────────────────────────────────────────────────
  "XAUUSD":  { mt5: "GOLD.pro",   type: "gold"   },
  "GOLD":    { mt5: "GOLD.pro",   type: "gold"   },
  "XAGUSD":  { mt5: "SILVER.pro", type: "silver" },
  "SILVER":  { mt5: "SILVER.pro", type: "silver" },

  // ── GRONDSTOFFEN ─────────────────────────────────────────────
  "NATGAS":  { mt5: "NATGAS.pro",  type: "natgas" },
  "NGAS":    { mt5: "NATGAS.pro",  type: "natgas" },
  "UKOIL":   { mt5: "OILBRNT.pro", type: "brent"  },
  "USOIL":   { mt5: "OILBRNT.pro", type: "brent"  },
  "BRENT":   { mt5: "OILBRNT.pro", type: "brent"  },

  // ── CRYPTO ───────────────────────────────────────────────────
  "BTCUSD":  { mt5: "BTCUSD",  type: "btc" },
  "BITCOIN": { mt5: "BTCUSD",  type: "btc" },

  // ── US STOCKS (_CFD.US) ───────────────────────────────────────
  "AAPL":   { mt5: "AAPL_CFD.US",   type: "stock" },
  "MSFT":   { mt5: "MSFT_CFD.US",   type: "stock" },
  "NVDA":   { mt5: "NVDA_CFD.US",   type: "stock" },
  "AMZN":   { mt5: "AMZN_CFD.US",   type: "stock" },
  "GOOGL":  { mt5: "GOOGL_CFD.US",  type: "stock" },
  "GOOG":   { mt5: "GOOG_CFD.US",   type: "stock" },
  "META":   { mt5: "META_CFD.US",   type: "stock" },
  "TSLA":   { mt5: "TSLA_CFD.US",   type: "stock" },
  "NFLX":   { mt5: "NFLX_CFD.US",   type: "stock" },
  "AMD":    { mt5: "AMD_CFD.US",    type: "stock" },
  "INTC":   { mt5: "INTC_CFD.US",   type: "stock" },
  "QCOM":   { mt5: "QCOM_CFD.US",   type: "stock" },
  "AVGO":   { mt5: "AVGO_CFD.US",   type: "stock" },
  "ORCL":   { mt5: "ORCL_CFD.US",   type: "stock" },
  "CRM":    { mt5: "CRM_CFD.US",    type: "stock" },
  "ADBE":   { mt5: "ADBE_CFD.US",   type: "stock" },
  "NOW":    { mt5: "NOW_CFD.US",    type: "stock" },
  "PLTR":   { mt5: "PLTR_CFD.US",   type: "stock" },
  "BBAI":   { mt5: "BBAI_CFD.US",   type: "stock" },
  "MP":     { mt5: "MP_CFD.US",     type: "stock" },
  "JPM":    { mt5: "JPM_CFD.US",    type: "stock" },
  "BAC":    { mt5: "BAC_CFD.US",    type: "stock" },
  "GS":     { mt5: "GS_CFD.US",     type: "stock" },
  "MS":     { mt5: "MS_CFD.US",     type: "stock" },
  "V":      { mt5: "V_CFD.US",      type: "stock" },
  "MA":     { mt5: "MA_CFD.US",     type: "stock" },
  "WMT":    { mt5: "WMT_CFD.US",    type: "stock" },
  "JNJ":    { mt5: "JNJ_CFD.US",    type: "stock" },
  "PFE":    { mt5: "PFE_CFD.US",    type: "stock" },
  "UNH":    { mt5: "UNH_CFD.US",    type: "stock" },
  "XOM":    { mt5: "XOM_CFD.US",    type: "stock" },
  "CVX":    { mt5: "CVX_CFD.US",    type: "stock" },
  "DIS":    { mt5: "DIS_CFD.US",    type: "stock" },
  "UBER":   { mt5: "UBER_CFD.US",   type: "stock" },
  "COIN":   { mt5: "COIN_CFD.US",   type: "stock" },
  "RBLX":   { mt5: "RBLX_CFD.US",   type: "stock" },
  "RIVN":   { mt5: "RIVN_CFD.US",   type: "stock" },
  "NIO":    { mt5: "NIO_CFD.US",    type: "stock" },
  "BABA":   { mt5: "BABA_CFD.US",   type: "stock" },
  "SPCE":   { mt5: "SPCE_CFD.US",   type: "stock" },
  "GME":    { mt5: "GME_CFD.US",    type: "stock" },
  "AMC":    { mt5: "AMC_CFD.US",    type: "stock" },

  // ── BELGISCHE STOCKS (_CFD.BE) ────────────────────────────────
  "AGS":    { mt5: "AGS_CFD.BE",    type: "stock" },
  "ABI":    { mt5: "ABI_CFD.BE",    type: "stock" },
  "KBC":    { mt5: "KBC_CFD.BE",    type: "stock" },
  "UCB":    { mt5: "UCB_CFD.BE",    type: "stock" },
  "SOLB":   { mt5: "SOLB_CFD.BE",   type: "stock" },
  "GBLB":   { mt5: "GBLB_CFD.BE",   type: "stock" },
  "ACKB":   { mt5: "ACKB_CFD.BE",   type: "stock" },
  "PROXB":  { mt5: "PROXB_CFD.BE",  type: "stock" },
  "COLR":   { mt5: "COLR_CFD.BE",   type: "stock" },
  "BEFB":   { mt5: "BEFB_CFD.BE",   type: "stock" },
  "SOFB":   { mt5: "SOFB_CFD.BE",   type: "stock" },
  "ARGX":   { mt5: "ARGX_CFD.BE",   type: "stock" },
  "BPOST":  { mt5: "BPOST_CFD.BE",  type: "stock" },
  "TINC":   { mt5: "TINC_CFD.BE",   type: "stock" },
  "MELB":   { mt5: "MELB_CFD.BE",   type: "stock" },
  "UMICORE":{ mt5: "UMI_CFD.BE",    type: "stock" },
  "UMI":    { mt5: "UMI_CFD.BE",    type: "stock" },

  // ── UK STOCKS (_CFD.UK) ───────────────────────────────────────
  "BARC":   { mt5: "BARC_CFD.UK",   type: "stock" },
  "LLOY":   { mt5: "LLOY_CFD.UK",   type: "stock" },
  "HSBA":   { mt5: "HSBA_CFD.UK",   type: "stock" },
  "BP":     { mt5: "BP_CFD.UK",     type: "stock" },
  "SHEL":   { mt5: "SHEL_CFD.UK",   type: "stock" },
  "VOD":    { mt5: "VOD_CFD.UK",    type: "stock" },
  "GSK":    { mt5: "GSK_CFD.UK",    type: "stock" },
  "AZN":    { mt5: "AZN_CFD.UK",    type: "stock" },
  "RIO":    { mt5: "RIO_CFD.UK",    type: "stock" },
  "GLEN":   { mt5: "GLEN_CFD.UK",   type: "stock" },
  "LSEG":   { mt5: "LSEG_CFD.UK",   type: "stock" },
  "REL":    { mt5: "REL_CFD.UK",    type: "stock" },
  "ULVR":   { mt5: "ULVR_CFD.UK",   type: "stock" },
  "DGE":    { mt5: "DGE_CFD.UK",    type: "stock" },
  "RKT":    { mt5: "RKT_CFD.UK",    type: "stock" },
  "IAG":    { mt5: "IAG_CFD.UK",    type: "stock" },
  "EZJ":    { mt5: "EZJ_CFD.UK",    type: "stock" },
  "BT":     { mt5: "BT_CFD.UK",     type: "stock" },

  // ── DUITSE STOCKS (_CFD.DE) ───────────────────────────────────
  "SAP":    { mt5: "SAP_CFD.DE",    type: "stock" },
  "SIE":    { mt5: "SIE_CFD.DE",    type: "stock" },
  "ALV":    { mt5: "ALV_CFD.DE",    type: "stock" },
  "BMW":    { mt5: "BMW_CFD.DE",    type: "stock" },
  "MBG":    { mt5: "MBG_CFD.DE",    type: "stock" },
  "VOW3":   { mt5: "VOW3_CFD.DE",   type: "stock" },
  "BAS":    { mt5: "BAS_CFD.DE",    type: "stock" },
  "BAYN":   { mt5: "BAYN_CFD.DE",   type: "stock" },
  "MRK":    { mt5: "MRK_CFD.DE",    type: "stock" },
  "DBK":    { mt5: "DBK_CFD.DE",    type: "stock" },
  "DTE":    { mt5: "DTE_CFD.DE",    type: "stock" },
  "ADS":    { mt5: "ADS_CFD.DE",    type: "stock" },
  "IFX":    { mt5: "IFX_CFD.DE",    type: "stock" },
  "ENR":    { mt5: "ENR_CFD.DE",    type: "stock" },
  "RWE":    { mt5: "RWE_CFD.DE",    type: "stock" },
  "HNR1":   { mt5: "HNR1_CFD.DE",   type: "stock" },
  "HEI":    { mt5: "HEI_CFD.DE",    type: "stock" },
  "CON":    { mt5: "CON_CFD.DE",    type: "stock" },
  "LIN":    { mt5: "LIN_CFD.DE",    type: "stock" },
};

// ── LOT VALUE PER PUNT PER LOT (EUR) ─────────────────────────
// Gecalibreerd op echte TMS trade data:
const LOT_VALUE = {
  "index":  25.00,  // DE30: 1lot × 16.8pt = €420 → €25/pt/lot ✓
  "gold":    0.87,  // GOLD: 0.001lot × 0.69pt = €0.0006 → €0.87/pt/lot ✓
  "silver":  43.42, // Silver: 0.001lot × 0.076pt = €0.0033 → €43.42/pt/lot ✓
  "natgas":   8.60, // NATRGAS: 0.01lot × 0.05pt = €0.0043 → €8.60/pt/lot ✓
  "brent":   87.27, // OILBRENT: 0.01lot × 0.011pt = €0.0096 → €87.27/pt/lot ✓
  "btc":      0.92, // BTC: standaard CFD waarde (nog te calibreren)
  "stock":    1.00, // Stocks: 1 lot = 1 share, €1/punt/lot (CFD)
};

// ── MINIMUM STOP DISTANCE (voorkomt INVALID_STOPS errors) ────
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

// ── MAX LOTS PER INSTRUMENT ───────────────────────────────────
const MAX_LOTS = {
  "index":  2.0,
  "gold":   5.0,
  "silver": 5.0,
  "natgas": 5.0,
  "brent":  2.0,
  "btc":    0.1,
  "stock": 100.0, // stocks: max 100 shares
};

// ── AUTO FALLBACK VOOR ONBEKENDE STOCKS ──────────────────────
// Als ticker niet in SYMBOL_MAP staat:
// - Crypto → geen suffix
// - Alles anders → probeer _CFD.US als fallback
const CRYPTO_PREFIXES = ["BTC","ETH","XRP","LTC","BCH","ADA","DOT","SOL"];
function getMT5Symbol(symbol) {
  if (SYMBOL_MAP[symbol]) return SYMBOL_MAP[symbol].mt5;
  if (CRYPTO_PREFIXES.some(c => symbol.startsWith(c))) return symbol;
  // Fallback: probeer _CFD.US voor onbekende US stocks
  return `${symbol}_CFD.US`;
}

function getSymbolType(symbol) {
  if (SYMBOL_MAP[symbol]) return SYMBOL_MAP[symbol].type;
  if (CRYPTO_PREFIXES.some(c => symbol.startsWith(c))) return "btc";
  return "stock"; // alle onbekende tickers = stock
}

// ── LOT SIZE BEREKENING ───────────────────────────────────────
function calcLots(symbol, entry, sl) {
  const type     = getSymbolType(symbol);
  const lotValue = LOT_VALUE[type] || 1.0;
  const maxLots  = MAX_LOTS[type]  || 100.0;

  const slDistance = Math.abs(entry - sl);
  if (slDistance <= 0) return 0.01;

  let lots = RISK_EUR / (slDistance * lotValue);
  lots = Math.round(lots * 100) / 100;
  lots = Math.max(0.01, lots);
  lots = Math.min(maxLots, lots);
  return lots;
}

// ── SL VALIDATIE ─────────────────────────────────────────────
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

// ── ORDER PLAATSEN VIA MetaApi ────────────────────────────────
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

  return await res.json();
}

// ── WEBHOOK ENDPOINT ──────────────────────────────────────────
// Message format: {"action":"buy","symbol":"XAUUSD","entry":{{close}},"sl":{{low}}}
app.post("/webhook", async (req, res) => {
  try {
    console.log("📨 Webhook ontvangen:", JSON.stringify(req.body));

    const secret = req.query.secret || req.headers["x-secret"];
    if (secret !== WEBHOOK_SECRET) {
      console.warn("⚠️ Ongeldige secret");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { action, symbol, entry, sl } = req.body;

    if (!action || !symbol || !entry || !sl) {
      return res.status(400).json({ error: "Vereist: action, symbol, entry, sl" });
    }

    if (!SYMBOL_MAP[symbol]) {
      console.warn(`⚠️ Onbekend symbool: ${symbol} — probeer direct door te sturen`);
    }

    const direction = ["buy","bull"].includes(action.toLowerCase()) ? "buy" : "sell";
    const entryNum  = parseFloat(entry);
    const slNum     = parseFloat(sl);

    if (direction === "buy"  && slNum >= entryNum) return res.status(400).json({ error: "SL moet onder entry voor BUY" });
    if (direction === "sell" && slNum <= entryNum) return res.status(400).json({ error: "SL moet boven entry voor SELL" });

    const lots      = calcLots(symbol, entryNum, slNum);
    const slAfstand = Math.abs(entryNum - slNum).toFixed(4);
    const mt5Sym    = getMT5Symbol(symbol);
    const symType   = getSymbolType(symbol);

    console.log(`📊 ${direction.toUpperCase()} ${symbol} (${mt5Sym}) [${symType}] | Entry: ${entryNum} | SL: ${slNum} | Afstand: ${slAfstand} | Lots: ${lots} | Risico: €${RISK_EUR}`);

    const result = await placeOrder(direction, symbol, entryNum, slNum, lots);
    console.log("✅ Order resultaat:", JSON.stringify(result));

    res.json({ status: "OK", direction, mt5Symbol: mt5Sym, entry: entryNum, sl: slNum, slAfstand, lots, risicoEUR: RISK_EUR, metaApi: result });

  } catch (err) {
    console.error("❌ Fout:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status:    "online",
    versie:    "v7",
    risicoEUR: RISK_EUR,
    symbols:   Object.keys(SYMBOL_MAP),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook server v4 draait op poort ${PORT} | Risico: €${RISK_EUR}/trade`));
