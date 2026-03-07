// Mounted at /api/pipeline2 in server.js

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const config  = require('../config');
const { fetchFinnhubStock } = require('../services/newsFetcher');
const { authenticate }      = require('./auth');

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

// ── Sentiment keyword fallback ────────────────────────────────────────────
const BEARISH_WORDS = [
  'falls','fall','drops','drop','plunges','plunge','declines','decline',
  'lowers','lower','cuts','cut','misses','miss','downgrade','downgrades',
  'selloff','sell-off','tumbles','tumble','slumps','slump','loss','losses',
  'warning','layoffs','layoff','fraud','investigation','penalty','fine',
  'resigned','bankruptcy','recall','lawsuit','suspended','halted','crash',
];
const BULLISH_WORDS = [
  'surges','surge','jumps','jump','soars','soar','raises','raise',
  'upgrades','upgrade','beats','beat','record','all-time high','profit',
  'wins','win','partnership','contract','expansion','dividend','buyback',
  'acquisition','outperform','exceeds','exceed','rally','rallies',
  'breakout','growth','rises','rise','climbs','climb','strong earnings',
];

function keywordSentiment(headline) {
  const lower = headline.toLowerCase();
  for (const w of BEARISH_WORDS) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(lower)) return 'BEARISH';
  }
  for (const w of BULLISH_WORDS) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(lower)) return 'BULLISH';
  }
  return 'NEUTRAL';
}

// ── Groq AI: analyze + summarize ─────────────────────────────────────────
async function analyzeWithGroq(headline, ticker) {
  if (!config.GROQ_API_KEY) return null;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        max_tokens: 120,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: `You are a financial analyst explaining stock news to beginner Indian retail investors.
Always respond with valid JSON only. No markdown, no extra text.`
          },
          {
            role: 'user',
            content: `Stock: ${ticker}
Headline: "${headline}"

Return JSON with:
- sentiment: "BULLISH", "BEARISH", or "NEUTRAL"
- confidence: number 0-100
- summary: ONE simple sentence (max 20 words) explaining what this means for the stock. No jargon.
- shortHeadline: rewrite headline in under 8 words, clear and punchy

Example: {"sentiment":"BULLISH","confidence":88,"summary":"Strong earnings beat expectations — stock likely to rise.","shortHeadline":"Tesla Beats Earnings, Stock May Rise"}

Return only JSON.`
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${config.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const raw = response.data.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.replace(/```json|```/g, ''));
    return {
      sentiment:     (parsed.sentiment || 'NEUTRAL').toUpperCase(),
      confidence:    parsed.confidence || 70,
      summary:       parsed.summary || null,
      shortHeadline: parsed.shortHeadline || headline.slice(0, 80),
    };

  } catch (err) {
    // Rate limited — wait and retry once
    if (err.response?.status === 429) {
      addLog('Rate limited by Groq, waiting 5s...');
      await new Promise(r => setTimeout(r, 5000));
      try {
        const retry = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: 'llama-3.3-70b-versatile',
            max_tokens: 120,
            temperature: 0.2,
            messages: [
              { role: 'system', content: 'You are a financial analyst. Always respond with valid JSON only.' },
              { role: 'user', content: `Stock: ${ticker}\nHeadline: "${headline}"\nReturn JSON: {"sentiment":"NEUTRAL","confidence":70,"summary":"Market update for ${ticker}.","shortHeadline":"${headline.slice(0,50)}"}` }
            ]
          },
          { headers: { 'Authorization': `Bearer ${config.GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        const raw = retry.data.choices[0].message.content.trim();
        const parsed = JSON.parse(raw.replace(/```json|```/g, ''));
        return {
          sentiment:     (parsed.sentiment || 'NEUTRAL').toUpperCase(),
          confidence:    parsed.confidence || 70,
          summary:       parsed.summary || null,
          shortHeadline: parsed.shortHeadline || headline.slice(0, 80),
        };
      } catch {
        return null;
      }
    }
    addLog(`Groq error: ${err.message}`);
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

    // Step 1 — fetch news
    addLog('Fetching from Google News RSS...');
    for (const ticker of tickers) {
      const articles = await fetchFinnhubStock(ticker);
      allRaw.push(...articles);
      await new Promise(r => setTimeout(r, 200));
    }

    // Step 2 — dedup
    const existingIds = new Set(state.articles.map(a => a.id));
    const fresh = allRaw.filter(a => !existingIds.has(a.id));
    addLog(`${fresh.length} new articles after dedup`);

    if (fresh.length === 0) {
      addLog('No new articles — all already seen ✓');
      state.lastUpdated = new Date().toISOString();
      state.isRunning = false;
      return;
    }

    // Step 3 — Groq AI analysis in batches of 3 (same as agentB)
    addLog('Running Groq AI analysis...');
    const processed = [];
    const toProcess = fresh.slice(0, 40);
    const batchSize = 3;

    for (let i = 0; i < toProcess.length; i += batchSize) {
      const batch = toProcess.slice(i, i + batchSize);
      addLog(`Batch ${Math.floor(i/batchSize)+1}/${Math.ceil(toProcess.length/batchSize)}...`);

      const batchResults = await Promise.all(batch.map(async (a) => {
        const headline = a.title || a.headline || '';
        const ticker   = a.stock || 'GLOBAL';

        // Try Groq AI first, fall back to keyword matching
        const groq = await analyzeWithGroq(headline, ticker);

        return {
          id:           a.id,
          ticker,
          headline:     groq?.shortHeadline || headline.slice(0, 80),
          summary:      groq?.summary || a.summary || a.story || headline,
          source:       (a.source || 'Google News').replace('Google News: ', ''),
          source_url:   a.url || null,
          sentiment:    groq?.sentiment || keywordSentiment(headline),
          confidence:   groq?.confidence || 70,
          published_at: a.publishedAt || new Date().toISOString(),
        };
      }));

      processed.push(...batchResults);

      // 800ms between batches — same as agentB to avoid rate limits
      if (i + batchSize < toProcess.length) {
        await new Promise(r => setTimeout(r, 800));
      }
    }

    // Update state
    state.articles      = [...processed, ...state.articles].slice(0, 150);
    state.totalArticles = state.articles.length;
    state.bullishCount  = state.articles.filter(a => a.sentiment === 'BULLISH').length;
    state.bearishCount  = state.articles.filter(a => a.sentiment === 'BEARISH').length;
    state.lastUpdated   = new Date().toISOString();

    addLog(`Done ✓ — ${processed.length} articles processed with AI`);

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