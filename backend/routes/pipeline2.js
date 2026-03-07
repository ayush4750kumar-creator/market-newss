// Mounted at /api/pipeline2 in server.js

const express             = require('express');
const router              = express.Router();
const { fetchFinnhubStock } = require('../services/newsFetcher');
const { authenticate }    = require('./auth');
const { runAgentScraper } = require('../agents/agentScraper');

// ── In-memory state ───────────────────────────────────────────────────────
let state = {
  isRunning:     false,
  lastUpdated:   null,
  articles:      [],
  totalArticles: 0,
  bullishCount:  0,
  bearishCount:  0,
  logs:          [],
};

function resetState() {
  state = { isRunning: false, lastUpdated: null, articles: [], totalArticles: 0, bullishCount: 0, bearishCount: 0, logs: [] };
  console.log('[Pipeline2] State reset ✓');
}

function addLog(msg) {
  console.log('[Pipeline2]', msg);
  state.logs.unshift({ time: new Date().toISOString(), msg });
  if (state.logs.length > 100) state.logs.pop();
}

// ── Dedup by normalized headline ─────────────────────────────────────────
function dedupByHeadline(articles) {
  const seen = new Set();
  return articles.filter(a => {
    const key = (a.title || a.headline || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 55);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Core pipeline ─────────────────────────────────────────────────────────
const DEFAULT_TICKERS = [
  'TSLA','AAPL','MSFT','NVDA','META','AMZN','UBER','LLY','CAT',
  'TCS','RELIANCE','INFY','HDFCBANK','SBIN','IRFC','BAJFINANCE','HAL',
];

async function runTestPipeline(tickers = DEFAULT_TICKERS) {
  if (state.isRunning) return;
  state.isRunning = true;
  addLog(`Pipeline started for: ${tickers.join(', ')}`);

  try {
    const allRaw = [];

    // Step 1 — fetch
    addLog('Fetching news...');
    for (const ticker of tickers) {
      const articles = await fetchFinnhubStock(ticker);
      allRaw.push(...articles);
      await new Promise(r => setTimeout(r, 200));
    }

    // Step 2 — dedup by ID then headline
    const existingIds = new Set(state.articles.map(a => a.id));
    const freshById   = allRaw.filter(a => !existingIds.has(a.id));
    const fresh       = dedupByHeadline(freshById);
    addLog(`${fresh.length} unique new articles after dedup`);

    if (fresh.length === 0) {
      addLog('No new articles ✓');
      state.lastUpdated = new Date().toISOString();
      state.isRunning   = false;
      return;
    }

    // Step 3 — scrape + AI process in batches of 3
    addLog('Scraping and summarizing with AI...');
    const processed = [];
    const toProcess = fresh.slice(0, 30);
    const batchSize = 3;

    for (let i = 0; i < toProcess.length; i += batchSize) {
      const batch = toProcess.slice(i, i + batchSize);
      addLog(`Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(toProcess.length / batchSize)}...`);
      const results = await Promise.all(batch.map(a => runAgentScraper(a)));
      processed.push(...results);
      if (i + batchSize < toProcess.length) await new Promise(r => setTimeout(r, 1000));
    }

    state.articles      = [...processed, ...state.articles].slice(0, 150);
    state.totalArticles = state.articles.length;
    state.bullishCount  = state.articles.filter(a => a.sentiment === 'BULLISH').length;
    state.bearishCount  = state.articles.filter(a => a.sentiment === 'BEARISH').length;
    state.lastUpdated   = new Date().toISOString();

    addLog(`Done ✓ — ${processed.length} articles processed`);

  } catch (err) {
    addLog(`Error: ${err.message}`);
  } finally {
    state.isRunning = false;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────

router.get('/status', authenticate, (req, res) => {
  res.json({
    isRunning:     state.isRunning,
    lastUpdated:   state.lastUpdated,
    totalArticles: state.totalArticles,
    bullishCount:  state.bullishCount,
    bearishCount:  state.bearishCount,
    articles:      state.articles.slice(0, 60),
    logs:          state.logs.slice(0, 20),
  });
});

router.post('/run', authenticate, (req, res) => {
  if (state.isRunning) return res.json({ message: 'Pipeline already running — please wait' });
  const tickers = (req.body && req.body.tickers) || DEFAULT_TICKERS;
  res.json({ message: 'Pipeline triggered ✓' });
  addLog('Manual trigger by user');
  runTestPipeline(tickers);
});

router.post('/reset', authenticate, (req, res) => {
  resetState();
  res.json({ message: 'Pipeline2 data cleared ✓' });
});

router.get('/logs', authenticate, (req, res) => {
  res.json({ logs: state.logs });
});

module.exports = { router, addLog };