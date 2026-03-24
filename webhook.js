// ═══════════════════════════════════════════════════════════════
// TradingView → MetaApi → MT5 TMS  |  Railway Webhook Server v9
// Account: 62670737  |  Demo €50.000  |  Risico: €25/trade (max €45)
// ─────────────────────────────────────────────────────────────
// FEATURES in v9:
//  ✅ Self-healing error learning (patches symbol/lot errors live)
//  ✅ Market hours guard (stocks only 15:30–21:00 CET, no weekend)
//  ✅ Crypto trades 24/7 including weekend
//  ✅ Auto-close stock positions Friday 20:50 CET
//  ✅ Max risk relaxed to €45 if lot too small to grab the trade
//  ✅ Same pair + same direction = half risk (anti-consolidation failsafe)
//  ✅ Gold futures chart on TradingView not connected → symbol remapped
//  ✅ MAX PROFIT TRACKER + WHAT-IF ANALYSIS (NEW!)
//  ✅ Real-time position monitoring every 30 sec (NEW!)
//  ✅ Account equity curve & snapshots (NEW!)
//  ✅ Closed trade analysis with RR scenarios (NEW!)
// ═══════════════════════════════════════════════════════════════

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
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

// ── DATABASE SETUP ────────────────────────────────────────────
const db = new sqlite3.Database("trades.db");

// Initialize tables
db.serialize(() => {
  // Open positions tracker
  db.run(`
    CREATE TABLE IF NOT EXISTS open_positions (
      positionId TEXT PRIMARY KEY,
      symbol TEXT,
      direction TEXT,
      openPrice REAL,
      volume REAL,
      openTime TEXT,
      maxPrice REAL,
      maxProfit REAL,
      maxProfitAt TEXT,
      lastUpdated TEXT,
      lastPrice REAL,
      lastProfit REAL
    )
  `);

  // Closed trades with what-if analysis
  db.run(`
    CREATE TABLE IF NOT EXISTS closed_trades (
      positionId TEXT PRIMARY KEY,
      symbol TEXT,
      direction TEXT,
      openPrice REAL,
      closePrice REAL,
      stopLoss REAL,
      volume REAL,
      openTime TEXT,
      closeTime TEXT,
      maxPrice REAL,
      maxProfitEUR REAL,
      actualClosingEUR REAL,
      missedProfitEUR REAL,
      slDistance REAL,
      whatIfRR2 REAL,
      whatIfRR3 REAL,
      whatIfRR4 REAL,
      history TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Account equity curve
  db.run(`
    CREATE TABLE IF NOT EXISTS account_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT,
      balance REAL,
      equity REAL,
      floating_profit REAL,
      open_position_count INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Webhook history
  db.run(`
    CREATE TABLE IF NOT EXISTS webhook_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT,
      action TEXT,
      symbol TEXT,
      entry REAL,
      sl REAL,
      status TEXT,
      response TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// ── OPEN TRADE TRACKER (anti-consolidation) ───────────────────
const openTradeTracker = {};

// ── LEARNED PATCHES (self-healing) ───────────────────────────
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

  // ── METALS ─────────────────────────────────��─────────────────
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
