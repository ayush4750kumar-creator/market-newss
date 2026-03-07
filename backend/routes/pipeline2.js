// backend/routes/pipeline2.js
// Test pipeline — reuses existing newsFetcher (Google News RSS)
// Mounted at /api/pipeline2 in server.js

const express  = require('express');
const router   = express.Router();
const OpenAI   = require('openai');
const { fetchFinnhubStock } = require('../services/newsFetcher');
const { authenticate }      = require('./auth');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

function addLog(msg) {
  console.log('[Pipeline2]', msg);
  state.logs.unshift({ time: new Date().toISOString(), msg });
  if (state.logs.length > 100) state.logs.pop();
}

// ── Sentiment keyword rules ───────────────────────────────────────────────
const BEARISH = [
  'falls','fall','drops','drop','plunges','plunge','declines','decline',
  'lowers','lower','cuts','cut','misses','miss','downgrade','downgrades',
  'selloff','sell-off','tumbles','tumble','slumps','slump','loss','losses',
  'warning','layoffs','layoff','fraud','investigation','penalty','fine',
  'resigned','bankruptcy','recall','lawsuit','suspended','halted','crash',
];
const BULLISH = [
  'surges','surge','jumps','jump','soars','soar','raises','raise',
  'upgrades','upgrade','beats','beat','record','all-time high','profit',
  'wins','win','partnership','contract','expansion','dividend','buyback',
  'acquisition','outperform','exceeds','exceed','rally','rallies',
  'breakout','growth','rises','rise','climbs','climb','strong earnings',
];

function tagSentiment(headline) {
  const lower = headline.toLowerCase();
  for (const w of BEARISH) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(lower))
      return { sentiment: 'BEARISH', confidence: 95 };
  }
  for (const w of BULLISH) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(lower))
      return { sentiment: 'BULLISH', confidence: 95 };
  }
  return { sentiment: 'NEUTRAL', confidence: 70 };
}

// ── OpenAI plain English summary ──────────────────────────────────────────
async function generateSummary(headline, ticker) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 60,
      messages: [
        {
          role: 'system',
          content: `You explain stock news to beginner Indian retail investors in simple plain English.
Write ONE sentence (max 20 words) explaining what this news means for the stock.
Be direct. No jargon. No filler words like "This means" or "In summary".
Examples:
- "Analyst upgraded the stock — price may rise short term."
- "Company missed earnings targets — stock could fall this week."
- "New government contract won — positive signal for investors."`,
        },
        {
          role: 'user',
          content: `Stock: ${ticker}\nHeadline: "${headline}"`,
        },
      ],
    });
    return res.choices[0].message.content.trim().replace(/^"|"$/g, '');
  } catch (err) {
    addLog(`Summary error: ${err.message}`);
    return null;
  }
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

    // Step 1 — fetch via existing Google News fetcher
    addLog('Fetching from Google News RSS...');
    for (const ticker of tickers) {
      const articles = await fetchFinnhubStock(ticker);
      allRaw.push(...articles);
      await new Promise(r => setTimeout(r, 200));
    }

    // Step 2 — dedup against existing articles
    const existingIds = new Set(state.articles.map(a => a.id));
    const fresh = allRaw.filter(a => !existingIds.has(a.id));
    addLog(`${fresh.length} new articles after dedup`);

    if (fresh.length === 0) {
      addLog('No new articles — all already seen ✓');
      state.lastUpdated = new Date().toISOString();
      state.isRunning = false;
      return;
    }

    // Step 3 — tag + summarize (limit 40 to control OpenAI cost)
    addLog('Tagging sentiment and generating AI summaries...');
    const processed = [];

    for (const a of fresh.slice(0, 40)) {
      const headline = a.title || a.headline || '';
      const ticker   = a.stock || 'GLOBAL';
      const { sentiment, confidence } = tagSentiment(headline);
      const summary = await generateSummary(headline, ticker);

      processed.push({
        id:           a.id,
        ticker,
        headline,
        summary,
        source:       (a.source || 'Google News').replace('Google News: ', ''),
        source_url:   a.url || null,
        sentiment,
        confidence,
        published_at: a.publishedAt || new Date().toISOString(),
      });

      await new Promise(r => setTimeout(r, 150));
    }

    // Update state
    state.articles      = [...processed, ...state.articles].slice(0, 150);
    state.totalArticles = state.articles.length;
    state.bullishCount  = state.articles.filter(a => a.sentiment === 'BULLISH').length;
    state.bearishCount  = state.articles.filter(a => a.sentiment === 'BEARISH').length;
    state.lastUpdated   = new Date().toISOString();

    addLog(`Done ✓ — ${processed.length} articles processed`);

  } catch (err) {
    addLog(`Error: ${err.message}`);
    console.error('[Pipeline2]', err);
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

router.get('/logs', authenticate, (req, res) => {
  res.json({ logs: state.logs });
});

module.exports = { router, addLog };
