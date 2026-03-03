const { fetchFinnhubGlobal } = require('../services/newsFetcher');
const { filterNew } = require('../services/dedup');

async function runAgentP() {
  console.log('[Agent P] Fetching global market news...');
  const articles = await fetchFinnhubGlobal();
  const newArticles = filterNew(articles);
  console.log(`[Agent P] Total new global articles: ${newArticles.length}`);
  return newArticles;
}

module.exports = { runAgentP };