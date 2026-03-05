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

// Main fetcher — Google News for Indian stocks, Finnhub for US stocks
async function fetchFinnhubStock(symbol) {
  const upper = symbol.toUpperCase();

  if (isIndianStock(upper)) {
    console.log(`  [newsFetcher] Indian stock: ${upper} → Google News RSS`);
    return await fetchGoogleNews(upper);
  }

  try {
    const res = await axios.get('https://finnhub.io/api/v1/company-news', {
      params: { symbol: upper, from: formatDate(3), to: formatDate(0), token: config.FINNHUB_KEY }
    });

    if (res.data && res.data.length > 0) return mapFinnhubArticles(res.data, upper);

    console.log(`  [newsFetcher] No fresh news for ${upper}, trying last 30 days...`);
    const fallback = await axios.get('https://finnhub.io/api/v1/company-news', {
      params: { symbol: upper, from: formatDate(30), to: formatDate(0), token: config.FINNHUB_KEY }
    });

    if (fallback.data && fallback.data.length > 0) return mapFinnhubArticles(fallback.data, upper);

    console.log(`  [newsFetcher] No Finnhub data for ${upper}, trying Google News...`);
    return await fetchGoogleNews(upper);

  } catch (err) {
    console.error(`Finnhub stock error for ${upper}:`, err.message);
    return await fetchGoogleNews(upper);
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

module.exports = { fetchFinnhubStock, fetchFinnhubGlobal };
