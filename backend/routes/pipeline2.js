// backend/routes/pipeline2.js
// Standalone test2 pipeline route — completely separate from main pipeline
// Mounted at /api/pipeline2 in server.js

const express = require('express');
const router = express.Router();
const { authenticate } = require('./auth');

// ── In-memory state ──────────────────────────────────────────────────────
let state = {
  isRunning: false,
  lastUpdated: null,
  articles: [],     // last 20 processed articles
  totalArticles: 0,
  bullishCount: 0,
  bearishCount: 0,
  logs: [],
};

function addLog(msg) {
  state.logs.unshift({ time: new Date().toISOString(), msg });
  if (state.logs.length > 100) state.logs.pop();
}

// ── Ticker map ────────────────────────────────────────────────────────────
const TICKER_MAP = {
  "tesla": "TSLA", "tesla inc": "TSLA",
  "caterpillar": "CAT", "caterpillar inc": "CAT",
  "uber": "UBER", "uber technologies": "UBER",
  "eli lilly": "LLY",
  "red cat": "RCAT", "red cat holdings": "RCAT",
  "apple": "AAPL", "microsoft": "MSFT",
  "nvidia": "NVDA", "amazon": "AMZN",
  "alphabet": "GOOGL", "google": "GOOGL",
  "meta": "META", "meta platforms": "META",
  "reliance": "RELIANCE", "reliance industries": "RELIANCE",
  "tcs": "TCS", "tata consultancy": "TCS",
  "infosys": "INFY", "wipro": "WIPRO",
  "hdfc bank": "HDFCBANK", "icici bank": "ICICIBANK",
  "state bank of india": "SBIN", "sbi": "SBIN",
  "irfc": "IRFC", "indian railway finance": "IRFC",
  "rvnl": "RVNL", "bajaj finance": "BAJFINANCE",
};

const TRACKED_TICKERS = [
  "TSLA","CAT","UBER","LLY","RCAT","AAPL","MSFT","NVDA","AMZN","META",
  "NSE:RELIANCE","NSE:TCS","NSE:INFY","NSE:HDFCBANK",
  "NSE:ICICIBANK","NSE:SBIN","NSE:WIPRO","NSE:IRFC","NSE:RVNL","NSE:BAJFINANCE",
];

const BEARISH_WORDS = ["falls","fall","drops","drop","plunges","plunge","declines","decline","lowers","lower","cuts","cut","misses","miss","downgrade","downgrades","selloff","sell-off","tumbles","slumps","loss","losses","warning","layoffs","fraud","investigation","penalty","fine","resigned","resignation","bankrupt","recall","lawsuit","suspended","halted","crash"];
const BULLISH_WORDS = ["surges","surge","jumps","jump","soars","soar","raises","raise","upgrades","upgrade","beats","beat","record","all-time high","profit","wins","win","partnership","contract","expansion","dividend","buyback","acquisition","outperform","exceeds","exceed","rally","rallies","breakout","growth","rises","rise","climbs","climb"];

// ── Sentiment tagger ──────────────────────────────────────────────────────
function tagSentimentByKeyword(headline) {
  const lower = headline.toLowerCase();
  for (const word of BEARISH_WORDS) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) return { sentiment: 'BEARISH', confidence: 95, method: 'keyword' };
  }
  for (const word of BULLISH_WORDS) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) return { sentiment: 'BULLISH', confidence: 95, method: 'keyword' };
  }
  return { sentiment: 'NEUTRAL', confidence: 70, method: 'keyword' };
}

// ── Ticker resolver ───────────────────────────────────────────────────────
function resolveTicker(text, fallback) {
  const lower = text.toLowerCase();
  for (const [name, ticker] of Object.entries(TICKER_MAP)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(lower)) return ticker;
  }
  return fallback.replace('NSE:', '');
}

// ── Core pipeline ─────────────────────────────────────────────────────────
async function runTestPipeline() {
  if (state.isRunning) return;
  state.isRunning = true;
  addLog('Test pipeline started');

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY;
  if (!FINNHUB_KEY) {
    addLog('Error: FINNHUB_API_KEY not set in environment');
    state.isRunning = false;
    return;
  }

  try {
    const today     = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const maxAgeMs  = 6 * 60 * 60 * 1000;
    const allRaw    = [];

    // Step 1 — Ingest
    addLog('Step 1: Fetching from Finnhub...');
    for (const ticker of TRACKED_TICKERS) {
      try {
        const url = `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${yesterday}&to=${today}&token=${FINNHUB_KEY}`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const articles = await res.json();
        if (Array.isArray(articles)) {
          articles.forEach(a => allRaw.push({ ...a, trackedTicker: ticker }));
        }
        await new Promise(r => setTimeout(r, 1100));
      } catch (err) {
        addLog(`Ingest error for ${ticker}: ${err.message}`);
      }
    }
    addLog(`Step 1 complete: ${allRaw.length} raw articles`);

    // Step 2 — Filter
    addLog('Step 2: Filtering...');
    const seenIds       = new Set(state.articles.map(a => String(a.source_id)));
    const seenHeadlines = new Set();
    const filtered      = [];

    for (const a of allRaw) {
      const sid  = String(a.id);
      const ageMs = Date.now() - a.datetime * 1000;
      const norm  = (a.headline || '').toLowerCase().trim();

      if (seenIds.has(sid))             continue;
      if (ageMs > maxAgeMs)             continue;
      if (!a.headline || a.headline.length < 10) continue;
      if (seenHeadlines.has(norm))      continue;

      seenIds.add(sid);
      seenHeadlines.add(norm);
      filtered.push(a);
    }
    addLog(`Step 2 complete: ${filtered.length} articles passed filter`);

    if (filtered.length === 0) {
      addLog('No new articles — pipeline complete ✓');
      state.isRunning = false;
      state.lastUpdated = new Date().toISOString();
      return;
    }

    // Steps 3–4 — Tag + Map
    addLog('Step 3: Tagging sentiment...');
    const processed = [];

    for (const a of filtered.slice(0, 30)) {
      const { sentiment, confidence, method } = tagSentimentByKeyword(a.headline);
      const ticker  = resolveTicker(`${a.headline} ${a.summary || ''}`, a.trackedTicker);

      processed.push({
        source_id:    String(a.id),
        ticker,
        headline:     a.headline,
        summary:      null,
        source:       a.source || null,
        source_url:   a.url || null,
        sentiment,
        confidence,
        tag_method:   method,
        published_at: new Date(a.datetime * 1000).toISOString(),
      });
    }
    addLog(`Step 3+4 complete: ${processed.length} articles tagged`);

    // Step 5 — Update state (no DB needed for test pipeline)
    addLog('Step 5: Saving to memory...');
    state.articles     = [...processed, ...state.articles].slice(0, 50);
    state.totalArticles = state.articles.length;
    state.bullishCount  = state.articles.filter(a => a.sentiment === 'BULLISH').length;
    state.bearishCount  = state.articles.filter(a => a.sentiment === 'BEARISH').length;
    state.lastUpdated   = new Date().toISOString();

    addLog(`Test pipeline complete ✓ — ${processed.length} articles saved`);
  } catch (err) {
    addLog(`Pipeline error: ${err.message}`);
    console.error('[Pipeline2] Error:', err.message);
  } finally {
    state.isRunning = false;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────

// GET /api/pipeline2/status
router.get('/status', authenticate, (req, res) => {
  res.json({
    isRunning:     state.isRunning,
    lastUpdated:   state.lastUpdated,
    totalArticles: state.totalArticles,
    bullishCount:  state.bullishCount,
    bearishCount:  state.bearishCount,
    articles:      state.articles.slice(0, 20),
    logs:          state.logs.slice(0, 30),
  });
});

// POST /api/pipeline2/run
router.post('/run', authenticate, (req, res) => {
  if (state.isRunning) return res.json({ message: 'Pipeline already running' });
  res.json({ message: 'Test pipeline triggered ✓' });
  addLog('Manual trigger by user');
  runTestPipeline();
});

// GET /api/pipeline2/logs
router.get('/logs', authenticate, (req, res) => {
  res.json({ logs: state.logs });
});

module.exports = { router, addLog };
