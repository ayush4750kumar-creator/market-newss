const axios = require('axios');
const config = require('../config');
const { Article } = require('../models');
const { generateId } = require('./dedup');

// Indian NSE/BSE symbols — routed to Google News RSS
const INDIAN_SYMBOLS = [
  'TCS', 'RELIANCE', 'INFY', 'HDFCBANK', 'WIPRO', 'ICICIBANK',
  'HINDUNILVR', 'BAJFINANCE', 'SBIN', 'ADANIENT', 'TATAMOTORS',
  'MARUTI', 'ONGC', 'NTPC', 'AXISBANK', 'KOTAKBANK', 'LT',
  'SUNPHARMA', 'TECHM', 'HCLTECH'
];

const COMPANY_NAMES = {
  // Indian stocks
  TCS: 'Tata Consultancy Services',
  RELIANCE: 'Reliance Industries',
  INFY: 'Infosys',
  HDFCBANK: 'HDFC Bank',
  WIPRO: 'Wipro',
  ICICIBANK: 'ICICI Bank',
  HINDUNILVR: 'Hindustan Unilever',
  BAJFINANCE: 'Bajaj Finance',
  SBIN: 'State Bank of India',
  ADANIENT: 'Adani Enterprises',
  TATAMOTORS: 'Tata Motors',
  MARUTI: 'Maruti Suzuki',
  ONGC: 'ONGC India',
  NTPC: 'NTPC India',
  AXISBANK: 'Axis Bank',
  KOTAKBANK: 'Kotak Mahindra Bank',
  LT: 'Larsen Toubro',
  SUNPHARMA: 'Sun Pharmaceutical',
  TECHM: 'Tech Mahindra',
  HCLTECH: 'HCL Technologies',
  HAL: 'Hindustan Aeronautics Limited',
  BPCL: 'Bharat Petroleum',
  GAIL: 'GAIL India',
  // US stocks
  AAPL: 'Apple stock',
  TSLA: 'Tesla stock',
  GOOGL: 'Google Alphabet stock',
  MSFT: 'Microsoft stock',
  AMZN: 'Amazon stock',
  META: 'Meta Facebook stock',
  LLY: 'Eli Lilly stock',
  ADBE: 'Adobe stock',
  NVDA: 'Nvidia stock',
  AMGN: 'Amgen stock',
  JPM: 'JPMorgan stock',
  BAC: 'Bank of America stock',
  NFLX: 'Netflix stock',
  AMD: 'AMD stock',
  INTC: 'Intel stock',
  DIS: 'Disney stock',
  PYPL: 'PayPal stock',
  UBER: 'Uber stock',
  BABA: 'Alibaba stock',
};

function isIndianStock(symbol) {
  // Known Indian symbols list
  if (INDIAN_SYMBOLS.includes(symbol.toUpperCase())) return true;
  // Also treat any symbol ending in .NS or .BO as Indian
  if (symbol.endsWith('.NS') || symbol.endsWith('.BO')) return true;
  return false;
}

function formatDate(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
}

function mapFinnhubArticles(data, symbol) {
  const mapped = data.slice(0, 10).map(a => new Article({
    id: generateId(a.headline, 'finnhub-stock'),
    title: a.headline,
    description: a.summary,
    url: a.url,
    imageUrl: a.image || null,
    source: `Finnhub: ${a.source}`,
    publishedAt: new Date(a.datetime * 1000).toISOString(),
    stock: symbol
  }));
  
  // Check if most articles have empty descriptions (paywall issue)
  const emptyCount = mapped.filter(a => !a.description || a.description.length < 30).length;
  const mostlyEmpty = emptyCount > mapped.length / 2;
  
  return { articles: mapped, mostlyEmpty };
}

// Google News RSS — free, no limit, no API key needed
async function fetchGoogleNews(symbol) {
  try {
    const query = COMPANY_NAMES[symbol.toUpperCase()] || symbol;
    const encodedQuery = encodeURIComponent(query + ' stock');
    const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-IN&gl=IN&ceid=IN:en`;

    console.log(`  [GoogleNews] Fetching RSS for ${symbol} (${query})...`);
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    const xml = res.data;
    const items = [];
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

    for (const match of itemMatches) {
      const item = match[1];

      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                         item.match(/<title>(.*?)<\/title>/);
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
      const sourceMatch = item.match(/<source[^>]*>(.*?)<\/source>/);

      const title = titleMatch ? titleMatch[1].trim() : null;
      const link = linkMatch ? linkMatch[1].trim() : '#';
      const pubDate = pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString();
      const source = sourceMatch ? sourceMatch[1].trim() : 'Google News';

      if (title) {
        items.push(new Article({
          id: generateId(title, 'gnews-' + symbol),
          title,
          description: title,
          url: link,
          imageUrl: null,
          source: 'Google News: ' + source,
          publishedAt: pubDate,
          stock: symbol.toUpperCase()
        }));
      }

      if (items.length >= 10) break;
    }

    console.log(`  [GoogleNews] Found ${items.length} articles for ${symbol}`);
    return items;

  } catch (err) {
    console.error(`[GoogleNews] Error for ${symbol}:`, err.message);
    return [];
  }
}

// Main fetcher — use Google News RSS for all stocks (Finnhub as optional fallback)
async function fetchFinnhubStock(symbol) {
  const upper = symbol.toUpperCase();

  // Try Google News first — works for all stocks, no rate limits
  const googleArticles = await fetchGoogleNews(upper);
  if (googleArticles && googleArticles.length > 0) return googleArticles;

  // Fallback to Finnhub only if Google RSS fails
  if (isIndianStock(upper)) return [];

  try {
    const res = await axios.get('https://finnhub.io/api/v1/company-news', {
      params: { symbol: upper, from: formatDate(3), to: formatDate(0), token: config.FINNHUB_KEY }
    });
    if (res.data && res.data.length > 0) {
      const { articles } = mapFinnhubArticles(res.data, upper);
      return articles;
    }
    const fallback = await axios.get('https://finnhub.io/api/v1/company-news', {
      params: { symbol: upper, from: formatDate(30), to: formatDate(0), token: config.FINNHUB_KEY }
    });
    if (fallback.data && fallback.data.length > 0) {
      const { articles } = mapFinnhubArticles(fallback.data, upper);
      return articles;
    }
    return [];
  } catch (err) {
    console.error(`Finnhub stock error for ${upper}:`, err.message);
    return [];
  }
}

async function fetchFinnhubGlobal() {
  try {
    const res = await axios.get('https://finnhub.io/api/v1/news', {
      params: { category: 'general', token: config.FINNHUB_KEY }
    });
    return res.data.slice(0, 15).map(a => new Article({
      id: generateId(a.headline, 'finnhub-global'),
      title: a.headline,
      description: a.summary,
      url: a.url,
      imageUrl: a.image || null,
      source: 'Finnhub: ' + a.source,
      publishedAt: new Date(a.datetime * 1000).toISOString(),
      stock: null
    }));
  } catch (err) {
    console.error('Finnhub global error:', err.message);
    return [];
  }
}

// ── Fetch full article content — scrapes first few paragraphs ────────────
async function fetchArticleContent(url) {
  if (!url || url === '#') return null;
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      },
      timeout: 6000,
      maxRedirects: 3
    });

    const html = res.data;

    // Extract text from <p> tags — skip nav/footer/ads
    const paragraphs = [];
    const pMatches = html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    for (const match of pMatches) {
      // Strip HTML tags from paragraph
      const text = match[1].replace(/<[^>]+>/g, '').trim();
      if (text.length > 80) paragraphs.push(text);
      if (paragraphs.length >= 3) break;
    }

    if (paragraphs.length === 0) return null;
    return paragraphs.join(' ').slice(0, 600);

  } catch (err) {
    // Silently fail — paywall or timeout
    return null;
  }
}

module.exports = { fetchFinnhubStock, fetchFinnhubGlobal, fetchArticleContent };