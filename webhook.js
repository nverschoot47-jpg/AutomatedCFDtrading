// ═══════════════════════════════════════════════════════════════
// TradingView → MetaApi → MT5 TMS  |  Railway Webhook Server
// Account: 62670737  |  Demo €50.000  |  Risico: 0.1% = €50/trade
// ═══════════════════════════════════════════════════════════════

const express = require("express");
const app = express();
app.use(express.json());

// ── CONFIG ────────────────────────────────────────────────────
const META_API_TOKEN   = process.env.META_API_TOKEN;   // zet in Railway env vars
const META_ACCOUNT_ID  = process.env.META_ACCOUNT_ID;  // zet in Railway env vars
const WEBHOOK_SECRET   = process.env.WEBHOOK_SECRET || "geheim123"; // optioneel
const ACCOUNT_BALANCE  = 50000;   // EUR demo balans
const RISK_PERCENT     = 0.001;   // 0.1%
const RISK_EUR         = ACCOUNT_BALANCE * RISK_PERCENT; // = €50 per trade

// ── SYMBOL MAPPING  (TradingView → MT5 TMS) ──────────────────
const SYMBOL_MAP = {
  "XAUUSD":  { mt5: "GOLD.pro",     type: "metal",   currency: "USD" },
  "GER40":   { mt5: "DE30.pro",     type: "index",   currency: "EUR" },
  "GER30":   { mt5: "DE30.pro",     type: "index",   currency: "EUR" },
  "DE30":    { mt5: "DE30.pro",     type: "index",   currency: "EUR" },
  "UK100":   { mt5: "GB100.pro",    type: "index",   currency: "GBP" },
  "US100":   { mt5: "NDAQ_CFD.us",  type: "index",   currency: "USD" },
  "NAS100":  { mt5: "NDAQ_CFD.us",  type: "index",   currency: "USD" },
};

// ── LOT SIZE BEREKENING ───────────────────────────────────────
// Formule: lots = RISK_EUR / (sl_afstand_in_punten × waarde_per_punt)
// Waarde per punt per lot (CFD - TMS typisch):
//   GOLD.pro  → $0.01/punt/lot × 100oz = $1/punt... maar TMS CFD: check via MetaApi
//   DE30.pro  → €1/punt/lot (index CFD)
//   GB100.pro → £1/punt/lot → omrekenen naar EUR
//   NDAQ      → $1/punt/lot
// We gebruiken een veilige fallback en ronden af naar 2 decimalen
// MetaApi geeft ook contractSize terug, ideaal voor live berekening

function calcLots(symbol, entry, sl) {
  const info = SYMBOL_MAP[symbol];
  if (!info) return 0.01;

  const slDistance = Math.abs(entry - sl);
  if (slDistance <= 0) return 0.01;

  let lotValue; // EUR per lot per punt beweging

  switch (info.type) {
    case "metal":
      // GOLD.pro: 1 lot = 100 troy oz, $1 per 0.01 punt = $100/punt/lot
      // Maar TMS CFD vaak mini: aanname 0.1 lot min, ~$10/punt/lot
      // USD→EUR: ~0.92 (rough)
      lotValue = 100 * 0.92; // conservatief: $100/punt × 0.92
      break;
    case "index":
      if (info.currency === "EUR") lotValue = 1;     // DE30: €1/punt/lot
      else if (info.currency === "GBP") lotValue = 1.17; // GBP→EUR rough
      else lotValue = 0.92;                           // USD→EUR rough
      break;
    default:
      lotValue = 1;
  }

  let lots = RISK_EUR / (slDistance * lotValue);
  lots = Math.max(0.01, Math.round(lots * 100) / 100); // min 0.01, max 2 decimalen
  lots = Math.min(lots, 10); // veiligheidsklep: max 10 lots
  return lots;
}

// ── METATRADER ORDER VIA MetaApi ──────────────────────────────
async function placeOrder(direction, symbol, entry, sl, lots) {
  const mt5Symbol = SYMBOL_MAP[symbol]?.mt5 || symbol;
  const orderType = direction === "buy" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL";
  const slPrice   = parseFloat(sl);

  const body = {
    symbol:      mt5Symbol,
    volume:      lots,
    actionType:  orderType,
    stopLoss:    slPrice,
    comment:     `TV-NV-${direction.toUpperCase()}-${symbol}`,
  };

  const url = `https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/${META_ACCOUNT_ID}/trade`;

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "auth-token":    META_API_TOKEN,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return data;
}

// ── WEBHOOK ENDPOINT ──────────────────────────────────────────
// TradingView alert message (JSON format):
// {"action":"buy","symbol":"XAUUSD","entry":{{close}},"sl":{{low}}}
// {"action":"sell","symbol":"GER40","entry":{{close}},"sl":{{high}}}

app.post("/webhook", async (req, res) => {
  try {
    console.log("📨 Webhook ontvangen:", JSON.stringify(req.body));

    // Optionele secret check
    const secret = req.query.secret || req.headers["x-secret"];
    if (secret !== WEBHOOK_SECRET) {
      console.warn("⚠️ Ongeldige secret");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { action, symbol, entry, sl } = req.body;

    // Validatie
    if (!action || !symbol || !entry || !sl) {
      return res.status(400).json({ error: "Ontbrekende velden: action, symbol, entry, sl vereist" });
    }

    const direction = action.toLowerCase() === "buy" || action.toLowerCase() === "bull" ? "buy" : "sell";
    const entryNum  = parseFloat(entry);
    const slNum     = parseFloat(sl);

    // Check: SL moet aan juiste kant staan
    if (direction === "buy"  && slNum >= entryNum) return res.status(400).json({ error: "SL moet onder entry liggen voor BUY" });
    if (direction === "sell" && slNum <= entryNum) return res.status(400).json({ error: "SL moet boven entry liggen voor SELL" });

    // Positiegrootte berekenen
    const lots = calcLots(symbol, entryNum, slNum);
    const slAfstand = Math.abs(entryNum - slNum).toFixed(4);

    console.log(`📊 ${direction.toUpperCase()} ${symbol} | Entry: ${entryNum} | SL: ${slNum} | Afstand: ${slAfstand} | Lots: ${lots} | Risico: €${RISK_EUR}`);

    // Order plaatsen via MetaApi
    const result = await placeOrder(direction, symbol, entryNum, slNum, lots);
    console.log("✅ Order resultaat:", JSON.stringify(result));

    res.json({
      status:    "OK",
      direction,
      symbol:    SYMBOL_MAP[symbol]?.mt5 || symbol,
      entry:     entryNum,
      sl:        slNum,
      slAfstand,
      lots,
      risicoEUR: RISK_EUR,
      metaApi:   result,
    });

  } catch (err) {
    console.error("❌ Fout:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status:    "online",
    risicoEUR: RISK_EUR,
    symbols:   Object.keys(SYMBOL_MAP),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Webhook server draait op poort ${PORT}`));
