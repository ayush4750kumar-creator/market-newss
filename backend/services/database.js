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
  console.log('[DB] Tables ready');
}

module.exports = { pool, initDB };