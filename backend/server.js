const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const config = require('./config');
const { runAgentO } = require('./agents/agentO');
const { runAgentP } = require('./agents/agentP');
const { runAgentA } = require('./agents/agentA');
const { runAgentB } = require('./agents/agentB');
const { initDB, pool, saveNews, loadNews } = require('./services/database');
const { router: authRouter, authenticate } = require('./routes/auth');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('frontend')); // ✅ fixed from 'public'

let newsStore = {
  all: [],
  byStock: {},
  global: [],
  lastUpdated: null,
  isRunning: false
};

let trackedStocks = [...config.DEFAULT_STOCKS];

async function loadAllUserStocks() {
  try {
    const result = await pool.query('SELECT DISTINCT UNNEST(watchlist) as symbol FROM users');
    const userSymbols = result.rows.map(r => r.symbol.toUpperCase());
    trackedStocks = [...new Set([...config.DEFAULT_STOCKS, ...userSymbols])];
    console.log(`[Pipeline] Tracking ${trackedStocks.length} stocks`);
  } catch (err) {
    console.error('[Pipeline] Could not load user stocks:', err.message);
  }
}

async function loadNewsFromDB() {
  try {
    const articles = await loadNews();
    if (articles.length === 0) return;

    newsStore.all = articles;
    newsStore.lastUpdated = articles[0]?.publishedAt || new Date().toISOString();

    articles.forEach(item => {
      if (item.stock) {
        if (!newsStore.byStock[item.stock]) newsStore.byStock[item.stock] = [];
        newsStore.byStock[item.stock].push(item);
      } else {
        newsStore.global.push(item);
      }
    });

    console.log(`[DB] Loaded ${articles.length} articles from database`);
  } catch (err) {
    console.error('[DB] Error loading news:', err.message);
  }
}

async function runPipeline() {
  if (newsStore.isRunning) return;
  newsStore.isRunning = true;
  console.log('\n========== PIPELINE START ==========');

  try {
    await loadAllUserStocks();

    // ✅ Run Agent O and Agent P in parallel — no need to wait
    const [stockArticles, globalArticles] = await Promise.all([
      runAgentO(trackedStocks),
      runAgentP()
    ]);

    const allRawArticles = [...stockArticles, ...globalArticles];
    console.log(`[Pipeline] Total raw articles: ${allRawArticles.length}`);

    if (allRawArticles.length === 0) {
      newsStore.isRunning = false;
      return;
    }

    const categorized = await runAgentA(allRawArticles);
    const published = await runAgentB(categorized);

    await saveNews(published);

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

// ✅ Faster mini pipeline — fetch, analyze and publish in one go
async function runMiniPipeline(symbol) {
  console.log(`[Mini Pipeline] Starting for ${symbol}...`);
  try {
    const { fetchFinnhubStock } = require('./services/newsFetcher');
    const { filterNew } = require('./services/dedup');

    // Fetch news
    const articles = await fetchFinnhubStock(symbol);
    const newArticles = filterNew(articles);

    if (newArticles.length === 0) {
      console.log(`[Mini Pipeline] No new articles for ${symbol}`);
      // Still initialize empty store so tab shows
      if (!newsStore.byStock[symbol]) newsStore.byStock[symbol] = [];
      return;
    }

    console.log(`[Mini Pipeline] Got ${newArticles.length} new articles for ${symbol}, analyzing...`);

    // Limit to 5 articles for mini pipeline — fast turnaround
    const limited = newArticles.slice(0, 5);

    const categorized = await runAgentA(limited);
    const published = await runAgentB(categorized);

    await saveNews(published);

    newsStore.all = [...published, ...newsStore.all].slice(0, 200);
    if (!newsStore.byStock[symbol]) newsStore.byStock[symbol] = [];
    newsStore.byStock[symbol] = [...published, ...newsStore.byStock[symbol]].slice(0, 50);
    newsStore.lastUpdated = new Date().toISOString();

    console.log(`[Mini Pipeline] Done for ${symbol} — published ${published.length} articles`);
  } catch (err) {
    console.error(`[Mini Pipeline] Error for ${symbol}:`, err.message);
  }
}

// Auth routes
app.use('/api/auth', authRouter);

// News routes
app.get('/api/news', (req, res) => {
  const { sentiment, stock, limit = 50, sort = 'newest' } = req.query;
  let news = stock ? (newsStore.byStock[stock] || []) : newsStore.all;
  if (sentiment && sentiment !== 'all') news = news.filter(n => n.sentiment === sentiment);
  news = [...news].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  if (sort === 'oldest') news = news.reverse();
  res.json({ news: news.slice(0, parseInt(limit)), lastUpdated: newsStore.lastUpdated, total: news.length });
});

app.get('/api/news/global', (req, res) => {
  const { sort = 'newest' } = req.query;
  let news = [...newsStore.global].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  if (sort === 'oldest') news = news.reverse();
  res.json({ news, lastUpdated: newsStore.lastUpdated });
});

app.get('/api/news/stock/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const { sort = 'newest' } = req.query;
  let news = [...(newsStore.byStock[symbol] || [])].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  if (sort === 'oldest') news = news.reverse();
  res.json({ stock: symbol, news, lastUpdated: newsStore.lastUpdated });
});

app.get('/api/stocks', (req, res) => {
  res.json({ stocks: config.DEFAULT_STOCKS });
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

// ✅ Mini pipeline route
app.post('/api/stocks/fetch', async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol required' });
  res.json({ message: `Fetching news for ${symbol}...` });
  runMiniPipeline(symbol.toUpperCase());
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

initDB().then(async () => {
  await loadNewsFromDB();

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
