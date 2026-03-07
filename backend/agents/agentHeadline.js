const axios  = require('axios');
const GROQ_API_KEY = process.env.GROQ_API_KEY;

function stripSource(h) {
  if (!h) return '';
  return h
    .replace(/\s[-–|]\s*(Yahoo Finance|Reuters|Bloomberg|CNBC|Forbes|Barron's|The Motley Fool|Nasdaq|Investing\.com.*|TradingView|Mint|AOL\.com|thestreet\.com|Barchart\.com|Trefis|Meyka|TechStock.*|24\/7 Wall St\.|The Globe and Mail|Investor's Business Daily|Traders Union|Naître.*|Investopedia).*/i, '')
    .replace(/\s*By\s+[\w\s\.com]+$/i, '')
    .trim();
}

async function rewriteHeadline(rawHeadline, ticker) {
  const clean = stripSource(rawHeadline);
  if (!GROQ_API_KEY) return clean;
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        max_tokens: 40,
        temperature: 0.4,
        messages: [
          { role: 'system', content: 'You are a financial headline writer. Return ONLY the rewritten headline. No quotes, no explanation.' },
          { role: 'user', content: `Rewrite for stock ${ticker}. Max 8 words. Must be DIFFERENT from original. No source names. Be direct and punchy. Do not start with Is/Will/Can/Could/Why/How.\n\nOriginal: "${clean}"\n\nRewritten headline:` },
        ],
      },
      { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
    );
    const result = res.data.choices[0].message.content.trim().replace(/^["']|["']$/g, '').replace(/\.$/, '').trim();
    if (result && result.length > 5 && result.toLowerCase() !== clean.toLowerCase()) return result;
    return clean;
  } catch (err) {
    if (err.response?.status === 429) await new Promise(r => setTimeout(r, 6000));
    return clean;
  }
}

module.exports = { rewriteHeadline, stripSource };
