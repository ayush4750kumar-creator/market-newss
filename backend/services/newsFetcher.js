const axios = require('axios');
const config = require('../config');
const { Article } = require('../models');
const { generateId } = require('./dedup');

function formatDate(daysAgo) {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().split('T')[0];
}

function mapArticles(data, symbol) {
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

async function fetchFinnhubStock(symbol) {
  try {
    // ✅ First try today's news (last 1 day)
    const res = await axios.get('https://finnhub.io/api/v1/company-news', {
      params: {
        symbol,
        from: formatDate(1),
        to: formatDate(0),
        token: config.FINNHUB_KEY
      }
    });

    if (res.data && res.data.length > 0) {
      return mapArticles(res.data, symbol);
    }

    // ✅ No fresh news — fall back to last 7 days
    console.log(`  [newsFetcher] No fresh news for ${symbol}, trying last 7 days...`);
    const fallback = await axios.get('https://finnhub.io/api/v1/company-news', {
      params: {
        symbol,
        from: formatDate(7),
        to: formatDate(0),
        token: config.FINNHUB_KEY
      }
    });

    if (fallback.data && fallback.data.length > 0) {
      console.log(`  [newsFetcher] Found ${fallback.data.length} older articles for ${symbol}`);
      return mapArticles(fallback.data, symbol);
    }

    return [];
  } catch (err) {
    console.error(`Finnhub stock error for ${symbol}:`, err.message);
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