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

  // ── METALS ───────────────────────────────────────────────────
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
  "ETHUSD":     { mt5: "ETHUSD",  type`*

