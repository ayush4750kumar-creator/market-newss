const express               = require('express');
const router                = express.Router();
const { fetchFinnhubStock } = require('../services/newsFetcher');
const { fetchNewsWithImages } = require('../services/newsDataFetcher');
const { authenticate }      = require('./auth');
const { runAgentDedup }     = require('../agents/agentDedup');
const { rewriteHeadline }   = require('../agents/agentHeadline');
const { runAgentSummary }   = require('../agents/agentSummary');

let state = { isRunning: false, lastUpdated: null, articles: [], totalArticles: 0, bullishCount: 0, bearishCount: 0, logs: [] };

function resetState() {
  state = { isRunning: false, lastUpdated: null, articles: [], totalArticles: 0, bullishCount: 0, bearishCount: 0, logs: [] };
}

function addLog(msg) {
  console.log('[Pipeline2]', msg);
  state.logs.unshift({ time: new Date().toISOString(), msg });
  if (state.logs.length > 100) state.logs.pop();
}

const DEFAULT_TICKERS = ['TSLA','AAPL','MSFT','NVDA','META','AMZN','UBER','LLY','CAT','TCS','RELIANCE','INFY','HDFCBANK','SBIN','IRFC','BAJFINANCE','HAL'];

async function runTestPipeline(tickers = DEFAULT_TICKERS) {
  if (state.isRunning) return;
  state.isRunning = true;
  addLog('Pipeline started...');
  try {
    const allRaw = [];
    addLog('Step 1: Fetching news...');
    for (const ticker of tickers) {
      const articles = await fetchFinnhubStock(ticker);
      allRaw.push(...articles);
      await new Promise(r => setTimeout(r, 150));
    }
    addLog(`Fetched ${allRaw.length} raw articles`);

    addLog('Step 2: AgentDedup removing duplicates...');
    const existingIds = new Set(state.articles.map(a => a.id));
    const freshById = allRaw.filter(a => !existingIds.has(a.id));
    const unique = runAgentDedup(freshById);
    addLog(`${unique.length} unique articles after dedup`);

    if (unique.length === 0) { addLog('No new articles'); state.lastUpdated = new Date().toISOString(); state.isRunning = false; return; }

    addLog('Step 3+4: Rewriting headlines and writing summaries...');
    const processed = [];
    const toProcess = unique.slice(0, 25);

    for (let i = 0; i < toProcess.length; i += 2) {
      const batch = toProcess.slice(i, i + 2);
      addLog(`Batch ${Math.floor(i/2)+1}/${Math.ceil(toProcess.length/2)}...`);
      const results = await Promise.all(batch.map(async (a) => {
        const rawHeadline = a.title || a.headline || '';
        const ticker = a.stock || 'GLOBAL';
        const newHeadline = await rewriteHeadline(rawHeadline, ticker);
        const { summary, sentiment, confidence, image_url } = await runAgentSummary(a, newHeadline);
        return { id: a.id, ticker, headline: newHeadline, summary, image_url, source: (a.source || 'Google News').replace('Google News: ', ''), source_url: a.url || null, sentiment, confidence, published_at: a.publishedAt || new Date().toISOString() };
      }));
      processed.push(...results);
      if (i + 2 < toProcess.length) await new Promise(r => setTimeout(r, 1500));
    }

    state.articles = [...processed, ...state.articles].slice(0, 150);
    state.totalArticles = state.articles.length;
    state.bullishCount = state.articles.filter(a => a.sentiment === 'BULLISH').length;
    state.bearishCount = state.articles.filter(a => a.sentiment === 'BEARISH').length;
    state.lastUpdated = new Date().toISOString();
    addLog(`Done - ${processed.length} articles processed`);
  } catch (err) {
    addLog(`Error: ${err.message}`);
  } finally {
    state.isRunning = false;
  }
}

router.get('/status', (req, res) => res.json({ isRunning: state.isRunning, lastUpdated: state.lastUpdated, totalArticles: state.totalArticles, bullishCount: state.bullishCount, bearishCount: state.bearishCount, articles: state.articles.slice(0, 60), logs: state.logs.slice(0, 20) }));
router.post('/run', (req, res) => { if (state.isRunning) return res.json({ message: 'Already running' }); const tickers = (req.body && req.body.tickers) || DEFAULT_TICKERS; res.json({ message: 'Pipeline triggered' }); addLog('Manual trigger'); runTestPipeline(tickers); });
router.post('/reset', authenticate, (req, res) => { resetState(); res.json({ message: 'Reset done' }); });
router.get('/logs', (req, res) => res.json({ logs: state.logs }));

module.exports = { router, addLog };
