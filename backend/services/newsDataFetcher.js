const axios = require('axios');

const TICKER_IMAGE_QUERY = {
  TSLA: 'tesla car electric', AAPL: 'apple iphone technology', MSFT: 'microsoft office',
  NVDA: 'nvidia chip GPU', META: 'facebook social media', AMZN: 'amazon warehouse',
  GOOGL: 'google headquarters', UBER: 'uber car city', LLY: 'pharmaceutical medicine',
  CAT: 'caterpillar construction equipment', TCS: 'tata consultancy india',
  RELIANCE: 'reliance industries india', INFY: 'infosys india tech',
  HDFCBANK: 'hdfc bank india', SBIN: 'state bank india', IRFC: 'indian railway',
  BAJFINANCE: 'bajaj finance india', HAL: 'aircraft aviation india',
};

function getFallbackImage(ticker) {
  const query = TICKER_IMAGE_QUERY[ticker] || ticker + ' stock market';
  const encoded = encodeURIComponent(query);
  // Use Unsplash source — free, no API key, returns relevant image
  return `https://source.unsplash.com/800x400/?${encoded}`;
}

function isGoodImage(url) {
  if (!url) return false;
  if (url.includes('logo') || url.includes('icon') || url.includes('placeholder')) return false;
  if (!url.match(/\.(jpg|jpeg|png|webp)/i) && !url.includes('image')) return false;
  return true;
}

async function fetchNewsWithImages(tickers) {
  const results = [];
  for (const ticker of tickers) {
    try {
      const res = await axios.get('https://newsdata.io/api/1/news', {
        params: {
          apikey: process.env.NEWSDATA_API_KEY,
          q: ticker,
          language: 'en',
          category: 'business',
        },
        timeout: 8000,
      });
      const articles = (res.data.results || []).slice(0, 5).map(a => ({
        id: `newsdata-${ticker}-${a.article_id}`,
        headline: a.title,
        image_url: isGoodImage(a.image_url) ? a.image_url : getFallbackImage(ticker),
        source: a.source_id || 'NewsData',
        source_url: a.link || null,
        published_at: a.pubDate || new Date().toISOString(),
        stock: ticker,
        description: a.description || a.content || null,
      }));
      results.push(...articles);
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[NewsData] Error for ${ticker}:`, err.message);
    }
  }
  return results;
}

module.exports = { fetchNewsWithImages };
