const axios = require('axios');

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
        image_url: (a.image_url && 
          !a.image_url.includes('logo') && 
          !a.image_url.includes('icon') &&
          !a.image_url.includes('placeholder') &&
          a.image_url.match(/\.(jpg|jpeg|png|webp)/i)) ? a.image_url : null,
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
