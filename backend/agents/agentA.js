const axios = require('axios');
const config = require('../config');

async function analyzeArticle(article) {
  const title = (article.title || '').slice(0, 150);
  const description = (article.description || '').slice(0, 200);

  if (!title && !description) return null; // ✅ skip empty

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        max_tokens: 100,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: 'You are a financial analyst. Always respond with valid JSON only.'
          },
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
      {
        headers: {
          'Authorization': `Bearer ${config.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const raw = response.data.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.replace(/```json|```/g, ''));

    // ✅ Filter out non-market articles
    if (!parsed.relevant) {
      console.log(`[Agent A] Filtered out irrelevant: "${title.slice(0, 60)}"`);
      return null;
    }

    return { ...article, sentiment: parsed.sentiment || 'neutral', reason: parsed.reason || '' };
  } catch (err) {
    if (err.response) console.error('[Agent A] Error:', err.response.status);
    return { ...article, sentiment: 'neutral', reason: 'Could not analyze' };
  }
}

async function runAgentA(articles) {
  console.log(`[Agent A] Analyzing ${articles.length} articles...`);
  console.log(`[Agent A] Groq key: ${config.GROQ_API_KEY ? 'FOUND' : 'NOT FOUND'}`);

  const toAnalyze = articles.slice(0, 20);
  const skipped = articles.slice(20).map(a => ({ ...a, sentiment: 'neutral', reason: 'Skipped' }));

  const results = [];

  for (let i = 0; i < toAnalyze.length; i++) {
    const result = await analyzeArticle(toAnalyze[i]);
    if (result) results.push(result); // ✅ only keep market-relevant
    await new Promise(r => setTimeout(r, 4000));
  }

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