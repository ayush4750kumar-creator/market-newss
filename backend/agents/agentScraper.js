// backend/agents/agentScraper.js
// Reads article URL and generates a real AI summary using Groq

const axios  = require('axios');
const config = require('../config');

// ── Strip HTML tags ───────────────────────────────────────────────────────
function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 2000);
}

// ── Fetch article page ────────────────────────────────────────────────────
async function fetchArticleText(url) {
  if (!url) return null;
  try {
    const res = await axios.get(url, {
      timeout: 6000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      maxRedirects: 3,
    });
    const text = extractText(res.data || '');
    // Only use if we got meaningful content (more than just boilerplate)
    return text.length > 200 ? text : null;
  } catch {
    return null;
  }
}

// ── Clean raw headline ────────────────────────────────────────────────────
function cleanHeadline(h) {
  if (!h) return '';
  return h
    .replace(/\s[-–|]\s[^-–|]{2,50}$/, '')   // remove " - Source Name"
    .replace(/\s*By\s+[\w\s\.com]+$/i, '')     // remove "By Investing.com"
    .replace(/\s*-\s*(Yahoo|Reuters|Bloomberg|CNBC|Forbes|Barron|Motley|Nasdaq|Investing\.com|TradingView|Mint|AOL|thestreet|Barchart|Trefis|Meyka|TechStock|24\/7).*/i, '')
    .trim();
}

// ── Groq: generate headline + summary ────────────────────────────────────
async function callGroq(prompt, retrying = false) {
  if (!config.GROQ_API_KEY) return null;
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        max_tokens: 200,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: 'You are a financial news writer for beginner Indian retail investors. Always respond with valid JSON only. No markdown, no extra text.',
          },
          { role: 'user', content: prompt },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${config.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const raw = res.data.choices[0].message.content.trim();
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (err) {
    if (err.response?.status === 429 && !retrying) {
      await new Promise(r => setTimeout(r, 8000));
      return callGroq(prompt, true);
    }
    return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────
async function runAgentScraper(article) {
  const rawHeadline = article.title || article.headline || '';
  const headline    = cleanHeadline(rawHeadline);
  const ticker      = article.stock || 'GLOBAL';
  const url         = article.url || article.source_url || null;

  // Try to fetch real article text
  const articleText = await fetchArticleText(url);

  // Build prompt — use article text if available, otherwise just headline
  const context = articleText
    ? `Headline: "${headline}"\n\nArticle content:\n${articleText.slice(0, 1200)}`
    : `Headline: "${headline}"`;

  const prompt = `Stock ticker: ${ticker}
${context}

Write a news card for this article. Return JSON with these exact fields:

- shortHeadline: A NEW punchy headline in max 8 words. Must be DIFFERENT from the original. Do NOT copy the original headline. Do NOT include source names.
- summary: Write 2-3 sentences in plain simple English. First sentence: what happened. Second sentence: why it matters for the stock. Third sentence (optional): what investors should watch. Use simple words. No jargon. No source names. Make it genuinely useful for a beginner investor.
- sentiment: "BULLISH", "BEARISH", or "NEUTRAL" based on impact on stock price
- confidence: number 0-100

Example output:
{
  "shortHeadline": "Tesla Sales Drop 13% in Europe",
  "summary": "Tesla's car sales in Europe fell sharply this quarter, hitting a 3-year low. This is bad news for the stock as Europe is one of Tesla's biggest markets. Investors should watch whether the company can recover sales with new models.",
  "sentiment": "BEARISH",
  "confidence": 85
}

Return only valid JSON.`;

  const result = await callGroq(prompt);

  // Keyword fallback for sentiment
  const kwSentiment = (() => {
    const lower = headline.toLowerCase();
    const bearish = ['falls','drops','plunges','declines','cuts','misses','downgrade','selloff','tumbles','slumps','loss','warning','layoffs','fraud','bankruptcy','lawsuit','crash','sink','risk'];
    const bullish = ['surges','jumps','soars','raises','upgrades','beats','record','profit','wins','partnership','expansion','dividend','buyback','acquisition','outperform','rally','growth','rises','climbs','buy','bullish'];
    for (const w of bearish) if (new RegExp(`\\b${w}\\b`, 'i').test(lower)) return 'BEARISH';
    for (const w of bullish) if (new RegExp(`\\b${w}\\b`, 'i').test(lower)) return 'BULLISH';
    return 'NEUTRAL';
  })();

  return {
    id:           article.id,
    ticker,
    headline:     result?.shortHeadline || headline,
    summary:      result?.summary       || `This article covers recent news about ${ticker}. Read the full article for complete details on this story.`,
    source:       (article.source || 'Google News').replace('Google News: ', ''),
    source_url:   url,
    sentiment:    result?.sentiment     || kwSentiment,
    confidence:   result?.confidence    || 70,
    published_at: article.publishedAt   || new Date().toISOString(),
  };
}

module.exports = { runAgentScraper };