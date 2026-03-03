const axios = require('axios');
const config = require('../config');

async function analyzeArticle(article) {
  const title = (article.title || '').slice(0, 150);
  const description = (article.description || '').slice(0, 200);

  if (!title && !description) {
    return { ...article, sentiment: 'neutral', reason: 'No content' };
  }

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        max_tokens: 80,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: 'You are a financial analyst. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: `Analyze this news. Return JSON: {"sentiment":"neutral","reason":"brief reason"}
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
    return { ...article, sentiment: parsed.sentiment || 'neutral', reason: parsed.reason || '' };
  } catch (err) {
    if (err.response) {
      console.error('[Agent A] Error:', err.response.status);
    }
    return { ...article, sentiment: 'neutral', reason: 'Could not analyze' };
  }
}

async function runAgentA(articles) {
  console.log(`[Agent A] Analyzing ${articles.length} articles...`);
  console.log(`[Agent A] Groq key: ${config.GROQ_API_KEY ? 'FOUND' : 'NOT FOUND'}`);

  const results = [];

  for (let i = 0; i < articles.length; i++) {
    const result = await analyzeArticle(articles[i]);
    results.push(result);
    await new Promise(r => setTimeout(r, 1500)); // wait 2.5s between each
  }

  const categorized = {
    bullish: results.filter(a => a.sentiment === 'bullish'),
    bearish: results.filter(a => a.sentiment === 'bearish'),
    neutral: results.filter(a => a.sentiment === 'neutral')
  };

  console.log(`[Agent A] Bullish: ${categorized.bullish.length}, Bearish: ${categorized.bearish.length}, Neutral: ${categorized.neutral.length}`);
  return categorized;
}

module.exports = { runAgentA };