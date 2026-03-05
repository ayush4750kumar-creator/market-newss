const axios = require('axios');
const config = require('../config');
const { ProcessedNews } = require('../models');

async function publishArticle(article) {
  const sentimentLabel = {
    bullish: '📈 Sentiment may be in favour of the stock',
    bearish: '📉 Sentiment may raise concerns for the stock',
    neutral: '➡️ No direct market sentiment detected'
  }[article.sentiment] || '➡️ No direct market sentiment detected';

  const title = (article.title || 'Market Update').slice(0, 150);
  const description = (article.description || '').slice(0, 200);

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        max_tokens: 150,
        temperature: 0.3,
        messages: [
          { role: 'system', content: 'You are a financial news editor. Always respond with valid JSON only.' },
          {
            role: 'user',
            content: `Create a news card. Return JSON: {"headline":"short headline under 12 words","story":"50 words facts only no predictions"}
Title: ${title}
Description: ${description}`
          }
        ]
      },
      { headers: { 'Authorization': `Bearer ${config.GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
    );
    const raw = response.data.choices[0].message.content.trim();
    const parsed = JSON.parse(raw.replace(/```json|```/g, ''));
    return new ProcessedNews({
      id: article.id,
      headline: parsed.headline || title.slice(0, 80),
      story: parsed.story || description.slice(0, 200),
      sentiment: article.sentiment,
      sentimentLabel,
      stock: article.stock || null,
      imageUrl: article.imageUrl || null,
      source: article.source,
      publishedAt: article.publishedAt
    });
  } catch (err) {
    if (err.response?.status === 429) {
      console.log(`[Agent B] Rate limited, waiting 5s...`);
      await new Promise(r => setTimeout(r, 5000));
    }
    // Fallback — use raw title/description without AI formatting
    return new ProcessedNews({
      id: article.id,
      headline: title.slice(0, 80),
      story: description.slice(0, 200) || 'News update available.',
      sentiment: article.sentiment,
      sentimentLabel,
      stock: article.stock || null,
      imageUrl: article.imageUrl || null,
      source: article.source,
      publishedAt: article.publishedAt
    });
  }
}

async function runAgentB(categorizedArticles) {
  console.log('[Agent B] Publishing news cards...');
  const allArticles = [
    ...categorizedArticles.bullish,
    ...categorizedArticles.bearish,
    ...categorizedArticles.neutral
  ].slice(0, 30); // max 30 articles — no need to process hundreds

  const results = [];
  const batchSize = 3; // 3 parallel keeps us under Groq rate limits

  for (let i = 0; i < allArticles.length; i += batchSize) {
    const batch = allArticles.slice(i, i + batchSize);
    console.log(`[Agent B] Batch ${Math.floor(i/batchSize)+1}/${Math.ceil(allArticles.length/batchSize)}...`);
    const batchResults = await Promise.all(batch.map(a => publishArticle(a)));
    results.push(...batchResults);
    // 800ms between batches — safe for Groq limits
    if (i + batchSize < allArticles.length) await new Promise(r => setTimeout(r, 800));
  }

  console.log(`[Agent B] Published ${results.length} news cards`);
  return results;
}

module.exports = { runAgentB };
