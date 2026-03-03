const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const config = require('./config');
const { runAgentO } = require('./agents/agentO');
const { runAgentP } = require('./agents/agentP');
const { runAgentA } = require('./agents/agentA');
const { runAgentB } = require('./agents/agentB');
const { initDB, pool } = require('./services/database');
const { router: authRouter, authenticate } = require('./routes/auth');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

let newsStore = {
  all: [],
  byStock: {},
  global: [],
  lastUpdated: null,
  isRunning: false
};

// ✅ Start with only default stocks, user stocks get added from DB on startup
let trackedStocks = [...config.DEFAULT_STOCKS];

// ✅ Load all user watchlist stocks from DB so they get fetched by pipeline
async function loadAllUserStocks() {
  try {
    const result = await pool.query('SELECT DISTINCT UNNEST(watchlist) as symbol FROM users');
    const userSymbols = result.rows.map(r => r.symbol.toUpperCase());
    const merged = [...new Set([...trackedStocks, ...userSymbols])];
    trackedStocks = merged;
    console.log(`[Pipeline] Tracking ${trackedStocks.length} stocks: ${trackedStocks.join(', ')}`);
  } catch (err) {
    console.error('[Pipeline] Could not load user stocks:', err.message);
  }
}

async function runPipeline() {
  if (newsStore.isRunning) return;
  newsStore.isRunning = true;
  console.log('\n========== PIPELINE START ==========');

  try {
    // ✅ Reload user stocks before every pipeline run
    await loadAllUserStocks();

    const stockArticles = await runAgentO(trackedStocks);
    await new Promise(r => setTimeout(r, 2000));
    const globalArticles = await runAgentP();

    const allRawArticles = [...stockArticles, ...globalArticles];
    console.log(`[Pipeline] Total raw articles: ${allRawArticles.length}`);

    if (allRawArticles.length === 0) {
      newsStore.isRunning = false;
      return;
    }

    const categorized = await runAgentA(allRawArticles);
    const published = await runAgentB(categorized);

    newsStore.all = [...published, ...newsStore.all].slice(0, 200);

    published.forEach(item => {
      if (item.stock) {
        if (!newsStore.byStock[item.stock]) newsStore.byStock[item.stock] = [];
        newsStore.byStock[item.stock] = [item, ...newsStore.byStock[item.stock]].slice(0, 50);
      } else {
        newsStore.global = [item, ...newsStore.global].slice(0, 50);
      }
    });

    newsStore.lastUpdated = new Date().toISOString();
    console.log('========== PIPELINE DONE ==========\n');
  } catch (err) {
    console.error('[Pipeline] Error:', err.message);
  } finally {
    newsStore.isRunning = false;
  }
}

// Auth routes
app.use('/api/auth', authRouter);

// News routes
app.get('/api/news', (req, res) => {
  const { sentiment, stock, limit = 50, sort = 'newest' } = req.query;
  let news = stock ? (newsStore.byStock[stock] || []) : newsStore.all;
  if (sentiment && sentiment !== 'all') news = news.filter(n => n.sentiment === sentiment);
  if (sort === 'oldest') news = [...news].reverse();
  res.json({ news: news.slice(0, parseInt(limit)), lastUpdated: newsStore.lastUpdated, total: news.length });
});

app.get('/api/news/global', (req, res) => {
  const { sort = 'newest' } = req.query;
  let news = [...newsStore.global];
  if (sort === 'oldest') news = news.reverse();
  res.json({ news, lastUpdated: newsStore.lastUpdated });
});

app.get('/api/news/stock/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const { sort = 'newest' } = req.query;
  let news = [...(newsStore.byStock[symbol] || [])];
  if (sort === 'oldest') news = news.reverse();
  res.json({ stock: symbol, news, lastUpdated: newsStore.lastUpdated });
});

app.get('/api/stocks', (req, res) => {
  res.json({ stocks: config.DEFAULT_STOCKS }); // always return defaults only
});

app.post('/api/stocks', (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol required' });
  const upper = symbol.toUpperCase();
  if (!trackedStocks.includes(upper)) {
    trackedStocks.push(upper);
    newsStore.byStock[upper] = [];
  }
  res.json({ stocks: trackedStocks });
});

app.delete('/api/stocks/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  trackedStocks = trackedStocks.filter(s => s !== symbol);
  res.json({ stocks: trackedStocks });
});

app.get('/api/status', (req, res) => {
  res.json({
    isRunning: newsStore.isRunning,
    lastUpdated: newsStore.lastUpdated,
    totalNews: newsStore.all.length,
    trackedStocks,
    globalNews: newsStore.global.length
  });
});

initDB().then(() => {
  app.listen(config.PORT, () => {
    console.log(`✅ Server running on http://localhost:${config.PORT}`);
    runPipeline();
    cron.schedule(`*/${config.REFRESH_INTERVAL} * * * *`, () => {
      console.log('[Cron] Scheduled pipeline run...');
      runPipeline();
    });
  });
}).catch(err => {
  console.error('[DB] Failed to initialize:', err.message);
  process.exit(1);
});