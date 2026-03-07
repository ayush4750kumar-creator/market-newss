function normalizeKey(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[-–|]\s*(yahoo|reuters|bloomberg|cnbc|forbes|barron|motley fool|nasdaq|investing\.com|tradingview|mint|aol|thestreet|barchart|trefis|meyka|techstock|24\/7|globe and mail|investopedia|business daily|traders union|naître).*/i, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 45)
    .trim();
}

function runAgentDedup(articles) {
  const seen = new Set();
  const unique = [];
  for (const a of articles) {
    const raw = a.title || a.headline || '';
    const key = normalizeKey(raw);
    if (!key || seen.has(key)) {
      console.log(`[AgentDedup] Duplicate removed: "${raw.slice(0, 60)}"`);
      continue;
    }
    seen.add(key);
    unique.push(a);
  }
  console.log(`[AgentDedup] ${articles.length} → ${unique.length} unique articles`);
  return unique;
}

module.exports = { runAgentDedup };
