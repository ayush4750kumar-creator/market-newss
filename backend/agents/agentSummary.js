const axios  = require('axios');
const GROQ_API_KEY = process.env.GROQ_API_KEY;

async function fetchArticleText(url) {
  if (!url) return null;
  try {
    const res = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36', 'Accept': 'text/html' },
      maxRedirects: 3,
    });
    const text = (res.data || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 1500);
    return text.length > 200 ? text : null;
  } catch { return null; }
}

async function runAgentSummary(article, newHeadline) {
  const url = article.url || article.source_url || null;
  const ticker = article.stock || 'GLOBAL';
  const articleText = await fetchArticleText(url);
  if (!GROQ_API_KEY) return { summary: null, sentiment: 'NEUTRAL', confidence: 70 };
  const context = articleText ? `Headline: "${newHeadline}"\n\nArticle text:\n${articleText}` : `Headline: "${newHeadline}"`;
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        max_tokens: 180,
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'You are a financial writer for beginner Indian retail investors. Always respond with valid JSON only.' },
          { role: 'user', content: `Stock: ${ticker}\n${context}\n\nReturn JSON:\n{\n  "summary": "2-3 sentences. What happened. Why it matters for the stock. What to watch next. Simple English. No jargon. No source names.",\n  "sentiment": "BULLISH" or "BEARISH" or "NEUTRAL",\n  "confidence": 0-100\n}\nReturn only JSON.` },
        ],
      },
      { headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
    );
    const raw = res.data.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return { summary: parsed.summary || null, sentiment: (parsed.sentiment || 'NEUTRAL').toUpperCase(), confidence: parsed.confidence || 70 };
  } catch (err) {
    if (err.response?.status === 429) await new Promise(r => setTimeout(r, 8000));
    const lower = newHeadline.toLowerCase();
    const bearish = ['falls','drops','plunges','declines','cuts','misses','downgrade','loss','warning','crash','sink','risk','down'];
    const bullish = ['surges','jumps','soars','raises','upgrades','beats','profit','wins','rally','growth','rises','buy','bullish'];
    let sentiment = 'NEUTRAL';
    for (const w of bearish) if (new RegExp(`\\b${w}\\b`,'i').test(lower)) { sentiment = 'BEARISH'; break; }
    if (sentiment === 'NEUTRAL') for (const w of bullish) if (new RegExp(`\\b${w}\\b`,'i').test(lower)) { sentiment = 'BULLISH'; break; }
    return { summary: null, sentiment, confidence: 70 };
  }
}

module.exports = { runAgentSummary };
