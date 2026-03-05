const { fetchFinnhubStock } = require('../services/newsFetcher');
const { filterNew } = require('../services/dedup');

async function runAgentO(stocks = []) {
  console.log(`[Agent O] Running for stocks: ${stocks.join(', ')}`);

  // Fetch all stocks in parallel — much faster than sequential
  const results = await Promise.all(
    stocks.map(async (symbol, i) => {
      try {
        console.log(`  [Agent O${i+1}] Fetching news for ${symbol}...`);
        const articles = await fetchFinnhubStock(symbol);
        console.log(`  [Agent O${i+1}] Found ${articles.length} articles for ${symbol}`);
        return articles;
      } catch (err) {
        console.log(`  [Agent O${i+1}] Error fetching ${symbol}: ${err.message}`);
        return [];
      }
    })
  );

  const allArticles = results.flat();
  const newArticles = filterNew(allArticles);
  console.log(`[Agent O] Total new articles: ${newArticles.length}`);
  return newArticles;
}

module.exports = { runAgentO };