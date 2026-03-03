const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const config = require('./config');
const { runAgentO } = require('./agents/agentO');
const { runAgentP } = require('./agents/agentP');
const { runAgentA } = require('./agents/agentA');
const { runAgentB } = require('./agents/agentB');
const { initDB } = require('./services/database');
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

let trackedStocks = [...config.DEFAULT_STOCKS];

async function runPipeline() {
  if (newsStore.isRunning) return;
  newsStore.isRunning = true;
  console.log('\n========== PIPELINE START ==========');

  try {
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
  res.json({ stocks: trackedStocks });
});

// User watchlist as their personal stocks
app.get('/api/user/stocks', authenticate, async (req, res) => {
  const { pool } = require('./services/database');
  const result = await pool.query('SELECT watchlist FROM users WHERE id = $1', [req.user.id]);
  const watchlist = result.rows[0]?.watchlist || trackedStocks;
  res.json({ stocks: watchlist });
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

app.post('/api/refresh', async (req, res) => {
  res.json({ message: 'Pipeline started' });
  runPipeline();
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
    console.log(`📊 Tracking stocks: ${trackedStocks.join(', ')}`);
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