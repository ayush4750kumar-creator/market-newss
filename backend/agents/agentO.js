const { fetchFinnhubStock } = require('../services/newsFetcher');
const { filterNew } = require('../services/dedup');

async function runAgentO(stocks = []) {
  console.log(`[Agent O] Running for stocks: ${stocks.join(', ')}`);
  const allArticles = [];

  const stockPromises = stocks.map(async (symbol, index) => {
    console.log(`  [Agent O${index + 1}] Fetching news for ${symbol}...`);
    const articles = await fetchFinnhubStock(symbol);
    console.log(`  [Agent O${index + 1}] Found ${articles.length} articles for ${symbol}`);
    return articles;
  });

  const results = await Promise.allSettled(stockPromises);
  results.forEach(r => {
    if (r.status === 'fulfilled') allArticles.push(...r.value);
  });

  const newArticles = filterNew(allArticles);
  console.log(`[Agent O] Total new articles: ${newArticles.length}`);
  return newArticles;
}

module.exports = { runAgentO };