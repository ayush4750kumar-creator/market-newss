const axios = require('axios');
const config = require('../config');
const { Article } = require('../models');
const { generateId } = require('./dedup');

// Indian NSE/BSE symbols that Finnhub won't cover
const INDIAN_SYMBOLS = [
  'TCS', 'RELIANCE', 'INFY', 'HDFCBANK', 'WIPRO', 'ICICIBANK',
  'HINDUNILVR', 'BAJFINANCE', 'SBIN', 'ADANIENT', 'TATAMOTORS',
  'MARUTI', 'ONGC', 'NTPC', 'AXISBANK', 'KOTAKBANK', 'LT',
  'SUNPHARMA', 'TECHM', 'HCLTECH'
];

function isIndianStock(symbol) {
  return INDIAN_SYMBOLS.includes(symbol.toUpperCase());
}

function formatDate(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
}

function mapFinnhubArticles(data, symbol) {
  return data.slice(0, 10).map(a => new Article({
    id: generateId(a.headline, 'finnhub-stock'),
    title: a.headline,
    description: a.summary,
    url: a.url,
    imageUrl: a.image || null,
    source: `Finnhub: ${a.source}`,
    publishedAt: new Date(a.datetime * 1000).toISOString(),
    stock: symbol
  }));
}

// ── Marketaux fetch for Indian stocks ─────────────────────────────────────
async function fetchMarketaux(symbol) {
  try {
    if (!config.MARKETAUX_KEY) {
      console.log(`  [Marketaux] No API key set, skipping ${symbol}`);
      return [];
    }

    // Search by company name for better results
    const companyNames = {
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
      ONGC: 'ONGC',
      NTPC: 'NTPC',
      AXISBANK: 'Axis Bank',
      KOTAKBANK: 'Kotak Bank',
      LT: 'Larsen Toubro',
      SUNPHARMA: 'Sun Pharma',
      TECHM: 'Tech Mahindra',
      HCLTECH: 'HCL Technologies',
    };

    const searchTerm = companyNames[symbol.toUpperCase()] || symbol;

    const res = await axios.get('https://api.marketaux.com/v1/news/all', {
      params: {
        search: searchTerm,
        language: 'en',
        published_after: `${formatDate(7)}T00:00:00`,
        api_token: config.MARKETAUX_KEY,
        limit: 10
      }
    });

    if (!res.data?.data?.length) return [];

    return res.data.data.map(a => new Article({
      id: generateId(a.title, 'marketaux-' + symbol),
      title: a.title,
      description: a.description || a.snippet || '',
      url: a.url,
      imageUrl: a.image_url || null,
      source: `Marketaux: ${a.source}`,
      publishedAt: a.published_at,
      stock: symbol.toUpperCase()
    }));

  } catch (err) {
    console.error(`[Marketaux] Error for ${symbol}:`, err.message);
    return [];
  }
}

// ── Main stock fetcher — uses Finnhub for US, Marketaux for Indian ────────
async function fetchFinnhubStock(symbol) {
  const upper = symbol.toUpperCase();

  // Route Indian stocks to Marketaux
  if (isIndianStock(upper)) {
    console.log(`  [newsFetcher] Indian stock detected: ${upper} → using Marketaux`);
    return await fetchMarketaux(upper);
  }

  // US stocks — use Finnhub as before
  try {
    const res = await axios.get('https://finnhub.io/api/v1/company-news', {
      params: {
        symbol: upper,
        from: formatDate(1),
        to: formatDate(0),
        token: config.FINNHUB_KEY
      }
    });

    if (res.data && res.data.length > 0) {
      return mapFinnhubArticles(res.data, upper);
    }

    // Fallback to last 7 days
    console.log(`  [newsFetcher] No fresh news for ${upper}, trying last 7 days...`);
    const fallback = await axios.get('https://finnhub.io/api/v1/company-news', {
      params: {
        symbol: upper,
        from: formatDate(7),
        to: formatDate(0),
        token: config.FINNHUB_KEY
      }
    });

    if (fallback.data && fallback.data.length > 0) {
      console.log(`  [newsFetcher] Found ${fallback.data.length} older articles for ${upper}`);
      return mapFinnhubArticles(fallback.data, upper);
    }

    // Last resort — try Marketaux even for unknown symbols
    console.log(`  [newsFetcher] No Finnhub data for ${upper}, trying Marketaux...`);
    return await fetchMarketaux(upper);

  } catch (err) {
    console.error(`Finnhub stock error for ${upper}:`, err.message);
    // Fallback to Marketaux on error
    return await fetchMarketaux(upper);
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
      source: `Finnhub: ${a.source}`,
      publishedAt: new Date(a.datetime * 1000).toISOString(),
      stock: null
    }));
  } catch (err) {
    console.error('Finnhub global error:', err.message);
    return [];
  }
}

module.exports = { fetchFinnhubStock, fetchFinnhubGlobal };