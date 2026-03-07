const axios  = require('axios');
const GROQ_API_KEY = process.env.GROQ_API_KEY;

async function resolveGoogleNewsUrl(url) {
  if (!url || !url.includes('news.google.com')) return url;
  try {
    // Use Google News RSS redirect resolver
    const res = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 0,
      validateStatus: s => s < 400,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const location = res.headers['location'];
    if (location) return location;
    // Try extracting from HTML
    const match = (res.data || '').match(/url=(https?:\/\/[^"&]+)/);
    if (match) return decodeURIComponent(match[1]);
    return url;
  } catch (err) {
    const location = err.response?.headers?.['location'];
    return location || url;
  }
}

async function fetchArticleData(url) {
  if (!url) return { text: null, image: null };
  try {
    const resolvedUrl = await resolveGoogleNewsUrl(url);
    const res = await axios.get(resolvedUrl, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 5,
    });
    const html = res.data || '';
    // Extract og:image or twitter:image
    const imgMatch = html.match(/property=["']og:image["'][^>]+content=["']([^"']{10,})["']/i) ||
                     html.match(/content=["']([^"']{10,})["'][^>]*property=["']og:image["']/i) ||
                     html.match(/name=["']twitter:image["'][^>]+content=["']([^"']{10,})["']/i) ||
                     html.match(/content=["']([^"']{10,})["'][^>]*name=["']twitter:image["']/i);
    const rawImg = imgMatch ? imgMatch[1] : null;
    const image = rawImg && rawImg.startsWith('http') ? rawImg : null;
    // Extract text
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 1500);
    return { text: text.length > 200 ? text : null, image };
  } catch { return { text: null, image: null }; }
}

async function runAgentSummary(article, newHeadline) {
  const url = article.url || article.source_url || null;
  const ticker = article.stock || 'GLOBAL';
  const { text: articleText, image: image_url } = await fetchArticleData(url);
  if (!GROQ_API_KEY) return { summary: null, sentiment: 'NEUTRAL', confidence: 70, image_url };
  const context = articleText ? `Headline: "${newHeadline}"\n\nArticle text:\n${articleText}` : `Headline: "${newHeadline}"`;
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        max_tokens: 100,
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
    return { summary: parsed.summary || null, sentiment: (parsed.sentiment || 'NEUTRAL').toUpperCase(), confidence: parsed.confidence || 70, image_url };
  } catch (err) {
    console.error('[AgentSummary] Groq error:', err.response?.status, err.response?.data?.error?.message || err.message);
    if (err.response?.status === 429) await new Promise(r => setTimeout(r, 8000));
    const lower = newHeadline.toLowerCase();
    const bearish = ['falls','drops','plunges','declines','cuts','misses','downgrade','loss','warning','crash','sink','risk','down'];
    const bullish = ['surges','jumps','soars','raises','upgrades','beats','profit','wins','rally','growth','rises','buy','bullish'];
    let sentiment = 'NEUTRAL';
    for (const w of bearish) if (new RegExp(`\\b${w}\\b`,'i').test(lower)) { sentiment = 'BEARISH'; break; }
    if (sentiment === 'NEUTRAL') for (const w of bullish) if (new RegExp(`\\b${w}\\b`,'i').test(lower)) { sentiment = 'BULLISH'; break; }
    return { summary: null, sentiment, confidence: 70, image_url };
  }
}

module.exports = { runAgentSummary };
