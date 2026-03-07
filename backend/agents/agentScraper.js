// backend/agents/agentScraper.js
// Scrapes article URL and generates a real plain-English summary using Groq

const axios  = require('axios');
const config = require('../config');

// ── Strip HTML tags and clean text ────────────────────────────────────────
function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')   // remove scripts
    .replace(/<style[\s\S]*?<\/style>/gi, '')      // remove styles
    .replace(/<[^>]+>/g, ' ')                      // remove all tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')                       // collapse whitespace
    .trim()
    .slice(0, 1500);                               // take first 1500 chars
}

// ── Fetch article text from URL ───────────────────────────────────────────
async function fetchArticleText(url) {
  if (!url) return null;
  try {
    const res = await axios.get(url, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MarketPulseBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      maxRedirects: 3,
    });
    return extractText(res.data || '');
  } catch {
    return null;
  }
}

// ── Summarize using Groq ──────────────────────────────────────────────────
async function summarizeWithGroq(headline, articleText, ticker) {
  if (!config.GROQ_API_KEY) return null;

  const content = articleText
    ? `Headline: "${headline}"\n\nArticle excerpt:\n${articleText}`
    : `Headline: "${headline}"`;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        max_tokens: 150,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: `You are a financial analyst explaining stock news to beginner Indian retail investors.
Always respond with valid JSON only. No markdown, no extra text.`,
          },
          {
            role: 'user',
            content: `Stock: ${ticker}
${content}

Return JSON:
- sentiment: "BULLISH", "BEARISH", or "NEUTRAL"
- confidence: 0-100
- shortHeadline: max 8 words, punchy. No source names.
- summary: 2-3 sentences MAX. Plain English. Explain WHAT happened and WHY it matters for the stock. No jargon. No source names.

Example:
{
  "sentiment": "BULLISH",
  "confidence": 88,
  "shortHeadline": "Tesla Beats Earnings, Raises Guidance",
  "summary": "Tesla reported higher-than-expected profits this quarter, driven by strong EV sales. The company also raised its future earnings forecast. This is a positive sign — the stock may rise in the short term."
}

Return only JSON.`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${config.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const raw    = response.data.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.replace(/```json|```/g, ''));

    return {
      sentiment:     (parsed.sentiment || 'NEUTRAL').toUpperCase(),
      confidence:    parsed.confidence  || 70,
      shortHeadline: parsed.shortHeadline || headline.slice(0, 80),
      summary:       parsed.summary || null,
    };

  } catch (err) {
    // Rate limited — wait and retry
    if (err.response?.status === 429) {
      await new Promise(r => setTimeout(r, 8000));
      try {
        const retry = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: 'llama-3.3-70b-versatile',
            max_tokens: 150,
            temperature: 0.2,
            messages: [
              { role: 'system', content: 'Financial analyst. Valid JSON only.' },
              { role: 'user', content: `Stock: ${ticker}\nHeadline: "${headline}"\nReturn: {"sentiment":"NEUTRAL","confidence":70,"shortHeadline":"${headline.slice(0,60)}","summary":"Market update for ${ticker}. Check the latest news for full details on this story."}` },
            ],
          },
          { headers: { Authorization: `Bearer ${config.GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        const raw    = retry.data.choices[0].message.content.trim();
        const parsed = JSON.parse(raw.replace(/```json|```/g, ''));
        return {
          sentiment:     (parsed.sentiment || 'NEUTRAL').toUpperCase(),
          confidence:    parsed.confidence  || 70,
          shortHeadline: parsed.shortHeadline || headline.slice(0, 80),
          summary:       parsed.summary || null,
        };
      } catch { return null; }
    }
    return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────
async function runAgentScraper(article) {
  const rawHeadline = article.title || article.headline || '';
  const headline    = rawHeadline.replace(/\s[-–|]\s[^-–|]{2,40}$/, '').replace(/\s*By\s+[\w\s\.]+$/i, '').trim();
  const ticker      = article.stock || 'GLOBAL';
  const url         = article.url || article.source_url || null;

  // Try to fetch actual article text
  const articleText = await fetchArticleText(url);

  // Summarize with Groq (uses article text if available, falls back to headline only)
  const result = await summarizeWithGroq(headline, articleText, ticker);

  return {
    id:           article.id,
    ticker,
    headline:     result?.shortHeadline || headline,
    summary:      result?.summary       || headline,
    source:       (article.source || 'Google News').replace('Google News: ', ''),
    source_url:   url,
    sentiment:    result?.sentiment     || 'NEUTRAL',
    confidence:   result?.confidence    || 70,
    published_at: article.publishedAt   || new Date().toISOString(),
  };
}

module.exports = { runAgentScraper };