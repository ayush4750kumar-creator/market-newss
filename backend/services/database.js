const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      watchlist TEXT[] DEFAULT '{}',
      bookmarks JSONB DEFAULT '[]',
      preferences JSONB DEFAULT '{"sentiment":"all","sort":"newest"}',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS news (
      id VARCHAR(255) PRIMARY KEY,
      headline TEXT,
      story TEXT,
      sentiment VARCHAR(20),
      sentiment_label TEXT,
      stock VARCHAR(50),
      image_url TEXT,
      source TEXT,
      published_at TIMESTAMP,
      url TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ✅ Auto delete news older than 48 hours
  await pool.query(`
    DELETE FROM news WHERE created_at < NOW() - INTERVAL '48 hours'
  `);

  console.log('[DB] Tables ready');
}

// Save a batch of news articles
async function saveNews(articles) {
  for (const a of articles) {
    try {
      await pool.query(`
        INSERT INTO news (id, headline, story, sentiment, sentiment_label, stock, image_url, source, published_at, url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO NOTHING
      `, [
        a.id, a.headline, a.story, a.sentiment, a.sentimentLabel,
        a.stock || null, a.imageUrl || null, a.source,
        a.publishedAt ? new Date(a.publishedAt) : new Date(),
        a.url || null
      ]);
    } catch (err) {
      console.error('[DB] Error saving article:', err.message);
    }
  }
}

// Load all news from DB into memory on startup
async function loadNews() {
  try {
    const result = await pool.query(`
      SELECT * FROM news ORDER BY published_at DESC LIMIT 200
    `);
    return result.rows.map(r => ({
      id: r.id,
      headline: r.headline,
      story: r.story,
      sentiment: r.sentiment,
      sentimentLabel: r.sentiment_label,
      stock: r.stock,
      imageUrl: r.image_url,
      source: r.source,
      publishedAt: r.published_at,
      url: r.url
    }));
  } catch (err) {
    console.error('[DB] Error loading news:', err.message);
    return [];
  }
}

module.exports = { pool, initDB, saveNews, loadNews };