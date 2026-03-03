const { fetchFinnhubStock } = require('../services/newsFetcher');
const { filterNew } = require('../services/dedup');

async function runAgentO(stocks = []) {
  console.log(`[Agent O] Running for stocks: ${stocks.join(', ')}`);
  const allArticles = [];

  // ✅ Sequential with delay instead of all at once
  for (let i = 0; i < stocks.length; i++) {
    const symbol = stocks[i];
    console.log(`  [Agent O${i + 1}] Fetching news for ${symbol}...`);
    try {
      const articles = await fetchFinnhubStock(symbol);
      console.log(`  [Agent O${i + 1}] Found ${articles.length} articles for ${symbol}`);
      allArticles.push(...articles);
    } catch (err) {
      console.log(`  [Agent O${i + 1}] Error fetching ${symbol}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1200)); // 1.2s gap between each
  }

  const newArticles = filterNew(allArticles);
  console.log(`[Agent O] Total new articles: ${newArticles.length}`);
  return newArticles;
}

module.exports = { runAgentO };