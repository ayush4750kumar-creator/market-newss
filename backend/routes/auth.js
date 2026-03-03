const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../services/database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'marketnews_secret_key';

// Register
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email, watchlist, bookmarks, preferences',
      [email, hashed]
    );
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, email: user.email, watchlist: user.watchlist, bookmarks: user.bookmarks, preferences: user.preferences } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, watchlist, bookmarks, preferences FROM users WHERE id = $1',
      [req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update watchlist
router.put('/watchlist', authenticate, async (req, res) => {
  const { watchlist } = req.body;
  try {
    const result = await pool.query(
      'UPDATE users SET watchlist = $1 WHERE id = $2 RETURNING watchlist',
      [watchlist, req.user.id]
    );
    res.json({ watchlist: result.rows[0].watchlist });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update preferences
router.put('/preferences', authenticate, async (req, res) => {
  const { preferences } = req.body;
  try {
    const result = await pool.query(
      'UPDATE users SET preferences = $1 WHERE id = $2 RETURNING preferences',
      [JSON.stringify(preferences), req.user.id]
    );
    res.json({ preferences: result.rows[0].preferences });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Toggle bookmark
router.post('/bookmarks', authenticate, async (req, res) => {
  const { article } = req.body;
  try {
    const result = await pool.query('SELECT bookmarks FROM users WHERE id = $1', [req.user.id]);
    let bookmarks = result.rows[0].bookmarks || [];
    const exists = bookmarks.find(b => b.id === article.id);
    if (exists) {
      bookmarks = bookmarks.filter(b => b.id !== article.id);
    } else {
      bookmarks.unshift(article);
    }
    await pool.query('UPDATE users SET bookmarks = $1 WHERE id = $2', [JSON.stringify(bookmarks), req.user.id]);
    res.json({ bookmarks });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { router, authenticate };