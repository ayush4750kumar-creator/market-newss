const axios = require('axios');
const config = require('../config');

async function analyzeArticle(article) {
  const title = (article.title || '').slice(0, 150);
  const description = (article.description || '').slice(0, 200);
  if (!title && !description) return null;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        max_tokens: 100,
        temperature: 0.1,
        messages: [
          { role: 'system', content: 'You are a financial analyst. Always respond with valid JSON only.' },
          {
            role: 'user',
            content: `Analyze this news article. 
First decide if this article is market-relevant (affects stock price, earnings, revenue, lawsuits, regulations, executive changes, product launches, partnerships, mergers, economic data).
If it is NOT market relevant (lifestyle, travel, entertainment, recipes, unrelated topics), set relevant to false.
Return JSON: {"relevant":true,"sentiment":"neutral","reason":"brief reason"}
Sentiment must be: bullish, bearish, or neutral.
Title: ${title}
Description: ${description}`
          }
        ]
      },
      { headers: { 'Authorization': `Bearer ${config.GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
    );
    const raw = response.data.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.replace(/```json|```/g, ''));
    if (!parsed.relevant) {
      console.log(`[Agent A] Filtered: "${title.slice(0, 60)}"`);
      return null;
    }
    return { ...article, sentiment: parsed.sentiment || 'neutral', reason: parsed.reason || '' };
  } catch (err) {
    if (err.response?.status === 429) {
      // Rate limited — wait 5 seconds and retry once
      console.log(`[Agent A] Rate limited, waiting 5s...`);
      await new Promise(r => setTimeout(r, 5000));
      try {
        const retry = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          {
            model: 'llama-3.3-70b-versatile',
            max_tokens: 100,
            temperature: 0.1,
            messages: [
              { role: 'system', content: 'You are a financial analyst. Always respond with valid JSON only.' },
              { role: 'user', content: `Return JSON: {"relevant":true,"sentiment":"neutral","reason":"retry"}\nTitle: ${title}` }
            ]
          },
          { headers: { 'Authorization': `Bearer ${config.GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
        );
        const raw = retry.data.choices[0].message.content.trim();
        const parsed = JSON.parse(raw.replace(/```json|```/g, ''));
        return { ...article, sentiment: parsed.sentiment || 'neutral', reason: parsed.reason || '' };
      } catch (retryErr) {
        return { ...article, sentiment: 'neutral', reason: 'Rate limited' };
      }
    }
    return { ...article, sentiment: 'neutral', reason: 'Could not analyze' };
  }
}

// Run in batches of 3 — fast enough but won't trigger Groq rate limits
async function runBatch(articles, batchSize = 3) {
  const results = [];
  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    console.log(`[Agent A] Processing batch ${Math.floor(i/batchSize)+1}/${Math.ceil(articles.length/batchSize)}...`);
    const batchResults = await Promise.all(batch.map(a => analyzeArticle(a)));
    results.push(...batchResults.filter(Boolean));
    // 800ms between batches — stays under Groq's rate limit
    if (i + batchSize < articles.length) await new Promise(r => setTimeout(r, 800));
  }
  return results;
}

async function runAgentA(articles) {
  console.log(`[Agent A] Analyzing ${articles.length} articles...`);

  const toAnalyze = articles.slice(0, 30);
  const skipped = articles.slice(30).map(a => ({ ...a, sentiment: 'neutral', reason: 'Skipped' }));
  const results = await runBatch(toAnalyze, 10);
  const allResults = [...results, ...skipped];

  const categorized = {
    bullish: allResults.filter(a => a.sentiment === 'bullish'),
    bearish: allResults.filter(a => a.sentiment === 'bearish'),
    neutral: allResults.filter(a => a.sentiment === 'neutral')
  };

  console.log(`[Agent A] Bullish: ${categorized.bullish.length}, Bearish: ${categorized.bearish.length}, Neutral: ${categorized.neutral.length}`);
  return categorized;
}

module.exports = { runAgentA };
