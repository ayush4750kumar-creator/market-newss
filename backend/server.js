const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const config = require('./config');
const { runAgentO } = require('./agents/agentO');
const { runAgentP } = require('./agents/agentP');
const { runAgentA } = require('./agents/agentA');
const { runAgentB } = require('./agents/agentB');
const { initDB, pool, saveNews, loadNews } = require('./services/database');
const { router: authRouter } = require('./routes/auth');
const { router: pipeline2Router } = require('./routes/pipeline2'); // ← NEW

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

let newsStore = {
  all: [],
  byStock: {},
  global: [],
  lastUpdated: null,
  isRunning: false
};

let trackedStocks = [...config.DEFAULT_STOCKS];

function rebuildAll() {
  const stockNews = Object.values(newsStore.byStock).flat();
  const allNews = [...newsStore.global, ...stockNews];
  const seen = new Set();
  newsStore.all = allNews
    .filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; })
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 200);
}

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

    const { filterNew } = require('./services/dedup');
    filterNew(articles);

    articles.forEach(item => {
      if (item.stock) {
        if (!newsStore.byStock[item.stock]) newsStore.byStock[item.stock] = [];
        newsStore.byStock[item.stock].push(item);
      } else {
        newsStore.global.push(item);
      }
    });

    rebuildAll();
    newsStore.lastUpdated = articles[0]?.publishedAt || new Date().toISOString();
    console.log(`[DB] Loaded ${articles.length} articles, dedup cache primed`);
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

    const stockArticles = await runAgentO(trackedStocks);
    console.log(`[Pipeline] Total raw articles: ${stockArticles.length}`);

    if (stockArticles.length === 0) {
      newsStore.isRunning = false;
      return;
    }

    const categorized = await runAgentA(stockArticles);
    const published = await runAgentB(categorized);

    await saveNews(published);

    published.forEach(item => {
      if (item.stock) {
        if (!newsStore.byStock[item.stock]) newsStore.byStock[item.stock] = [];
        newsStore.byStock[item.stock] = [item, ...newsStore.byStock[item.stock]].slice(0, 50);
      }
    });

    rebuildAll();
    newsStore.lastUpdated = new Date().toISOString();
    console.log('========== PIPELINE DONE ==========\n');
  } catch (err) {
    console.error('[Pipeline] Error:', err.message);
  } finally {
    newsStore.isRunning = false;
  }
}

let globalIsRunning = false;
async function runGlobalPipeline() {
  if (globalIsRunning) return;
  globalIsRunning = true;
  console.log('[Global Pipeline] Fetching global news...');
  try {
    const { fetchFinnhubGlobal } = require('./services/newsFetcher');
    const { filterNew } = require('./services/dedup');

    const articles = await fetchFinnhubGlobal();
    if (!articles || articles.length === 0) {
      console.log('[Global Pipeline] No articles fetched');
      return;
    }

    const isGlobalEmpty = newsStore.global.length === 0;
    const newArticles = isGlobalEmpty ? articles : filterNew(articles);

    if (newArticles.length === 0) return;

    const categorized = await runAgentA(newArticles);
    const published = await runAgentB(categorized);

    await saveNews(published);
    newsStore.global = [...published, ...newsStore.global].slice(0, 50);
    rebuildAll();
    newsStore.lastUpdated = new Date().toISOString();
    console.log(`[Global Pipeline] Published ${published.length} global articles`);
  } catch (err) {
    console.error('[Global Pipeline] Error:', err.message);
  } finally {
    globalIsRunning = false;
  }
}

async function runMiniPipeline(symbol) {
  console.log(`[Mini Pipeline] Starting for ${symbol}...`);
  try {
    const { fetchFinnhubStock, fetchArticleContent } = require('./services/newsFetcher');
    const { filterNew } = require('./services/dedup');

    if (!newsStore.byStock[symbol]) newsStore.byStock[symbol] = [];
    const isNewStock = newsStore.byStock[symbol].length === 0;

    const articles = await fetchFinnhubStock(symbol);
    if (!articles || articles.length === 0) return;

    const newArticles = isNewStock ? articles : filterNew(articles);
    if (newArticles.length === 0) return;

    const limited = newArticles.slice(0, 5);
    const enriched = await Promise.all(limited.map(async a => {
      const content = await fetchArticleContent(a.url);
      if (content) a.description = content;
      return a;
    }));

    const categorized = await runAgentA(enriched);
    const published = await runAgentB(categorized);

    await saveNews(published);
    newsStore.byStock[symbol] = [...published, ...newsStore.byStock[symbol]].slice(0, 50);
    rebuildAll();
    newsStore.lastUpdated = new Date().toISOString();
    console.log(`[Mini Pipeline] Done for ${symbol} — ${published.length} articles`);
  } catch (err) {
    console.error(`[Mini Pipeline] Error for ${symbol}:`, err.message);
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

app.use('/api/auth', authRouter);
app.use('/api/pipeline2', pipeline2Router); // ← NEW — test pipeline route

app.get('/api/news', (req, res) => {
  const { sentiment, stock, limit = 50 } = req.query;
  let news = stock ? (newsStore.byStock[stock] || []) : newsStore.all;
  if (sentiment && sentiment !== 'all') news = news.filter(n => n.sentiment === sentiment);
  res.json({ news: news.slice(0, parseInt(limit)), lastUpdated: newsStore.lastUpdated, total: news.length });
});

app.get('/api/news/global', (req, res) => {
  res.json({ news: newsStore.global, lastUpdated: newsStore.lastUpdated });
});

app.get('/api/news/stock/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  res.json({ stock: symbol, news: newsStore.byStock[symbol] || [], lastUpdated: newsStore.lastUpdated });
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

// ── Start ────────────────────────────────────────────────────────────────────

initDB().then(async () => {
  await loadNewsFromDB();

  app.listen(config.PORT, () => {
    console.log(`✅ Server running on http://localhost:${config.PORT}`);
    runPipeline();
    runGlobalPipeline();

    cron.schedule(`*/${config.REFRESH_INTERVAL} * * * *`, () => {
      console.log('[Cron] Stock pipeline run...');
      runPipeline();
    });

    cron.schedule('*/3 * * * *', () => {
      console.log('[Cron] Global news refresh...');
      runGlobalPipeline();
    });
  });
}).catch(err => {
  console.error('[DB] Failed to initialize:', err.message);
  process.exit(1);
});