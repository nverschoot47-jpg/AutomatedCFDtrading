// ═══════════════════════════════════════════════════════════════
// TradingView → MetaApi → MT5 TMS  |  Railway Webhook Server v4
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

// ── SYMBOL MAPPING (TradingView → MT5 TMS) ───────────────────
const SYMBOL_MAP = {
  // ── INDICES €25/punt/lot (gecalibreerd op DE30 echte trade) ──
  "GER40":   { mt5: "DE30.pro",   type: "index" },
  "DE30":    { mt5: "DE30.pro",   type: "index" },
  "GER30":   { mt5: "DE30.pro",   type: "index" },
  "EU50":    { mt5: "EU50.pro",   type: "index" },
  "EUSTX50": { mt5: "EU50.pro",   type: "index" },
  "FRA40":   { mt5: "FRA40.pro",  type: "index" },
  "CAC40":   { mt5: "FRA40.pro",  type: "index" },
  "UK100":   { mt5: "GB100.pro",  type: "index" },
  "FTSE100": { mt5: "GB100.pro",  type: "index" },
  "US100":   { mt5: "US100.pro",  type: "index" },
  "NAS100":  { mt5: "US100.pro",  type: "index" },
  "US30":    { mt5: "US30.pro",   type: "index" },
  "DJ30":    { mt5: "US30.pro",   type: "index" },
  "US500":   { mt5: "US500.pro",  type: "index" },
  "SPX500":  { mt5: "US500.pro",  type: "index" },
  "JP225":   { mt5: "JP225.pro",  type: "index" },
  "NKY225":  { mt5: "JP225.pro",  type: "index" },
  "AU200":   { mt5: "AU200.pro",  type: "index" },
  "ASX200":  { mt5: "AU200.pro",  type: "index" },

  // ── METALEN ──────────────────────────────────────────────────
  "XAUUSD":  { mt5: "GOLD.pro",   type: "gold"   },
  "GOLD":    { mt5: "GOLD.pro",   type: "gold"   },
  "XAGUSD":  { mt5: "Silver.pro", type: "silver" },
  "SILVER":  { mt5: "Silver.pro", type: "silver" },

  // ── GRONDSTOFFEN ─────────────────────────────────────────────
  "NATGAS":  { mt5: "NATRGAS.pro",  type: "natgas" },
  "NGAS":    { mt5: "NATRGAS.pro",  type: "natgas" },
  "UKOIL":   { mt5: "OILBRENT.pro", type: "brent"  },
  "USOIL":   { mt5: "OILBRENT.pro", type: "brent"  },
  "BRENT":   { mt5: "OILBRENT.pro", type: "brent"  },

  // ── CRYPTO ───────────────────────────────────────────────────
  "BTCUSD":  { mt5: "BTCUSD",  type: "btc" },
  "BITCOIN": { mt5: "BTCUSD",  type: "btc" },
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
  "DE30.pro":     5.0,
  "EU50.pro":     3.0,
  "FRA40.pro":    3.0,
  "GB100.pro":    5.0,
  "US100.pro":    5.0,
  "US30.pro":     5.0,
  "US500.pro":    2.0,
  "JP225.pro":   10.0,
  "AU200.pro":    3.0,
  "GOLD.pro":     0.5,
  "Silver.pro":   0.05,
  "NATRGAS.pro":  0.02,
  "OILBRENT.pro": 0.05,
  "BTCUSD":      50.0,
  // Stocks: min 0.01 punt SL afstand
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

// ── AUTO .pro FALLBACK (TMS conventie voor alle stocks) ───────
// Alle onbekende tickers → automatisch .pro suffix
// AAPL → AAPL.pro | AGS → AGS.pro | TSLA → TSLA.pro
// Geen mapping nodig voor BE/UK/US stocks!
const CRYPTO_PREFIXES = ["BTC","ETH","XRP","LTC","BCH","ADA","DOT","SOL"];
function getMT5Symbol(symbol) {
  if (SYMBOL_MAP[symbol]) return SYMBOL_MAP[symbol].mt5;
  if (CRYPTO_PREFIXES.some(c => symbol.startsWith(c))) return symbol;
  return symbol.endsWith(".pro") ? symbol : `${symbol}.pro`;
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
    versie:    "v5",
    risicoEUR: RISK_EUR,
    symbols:   Object.keys(SYMBOL_MAP),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook server v4 draait op poort ${PORT} | Risico: €${RISK_EUR}/trade`));
