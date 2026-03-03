const axios = require('axios');
const config = require('../config');
const { Article } = require('../models');
const { generateId } = require('./dedup');

async function fetchFinnhubStock(symbol) {
  try {
    const res = await axios.get('https://finnhub.io/api/v1/company-news', {
      params: {
        symbol,
        from: new Date(Date.now() - 86400000).toISOString().split('T')[0],
        to: new Date().toISOString().split('T')[0],
        token: config.FINNHUB_KEY
      }
    });
    return res.data.slice(0, 10).map(a => new Article({
      id: generateId(a.headline, 'finnhub-stock'),
      title: a.headline,
      description: a.summary,
      url: a.url,
      imageUrl: a.image || null,
      source: `Finnhub: ${a.source}`,
      publishedAt: new Date(a.datetime * 1000).toISOString(),
      stock: symbol
    }));
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