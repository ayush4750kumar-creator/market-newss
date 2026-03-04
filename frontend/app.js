const API_BASE = 'https://market-newss-production.up.railway.app';

let currentStock = 'global';
let currentSentiment = 'all';
let currentSort = 'newest';
let allNews = [];
let trackedStocks = [];
let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let longPressTimer = null;

// ── Popular stock suggestions ──────────────────────────────────────────────
const STOCK_SUGGESTIONS = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'GOOGL', name: 'Google' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'NVDA', name: 'Nvidia' },
  { symbol: 'NFLX', name: 'Netflix' },
  { symbol: 'AMD', name: 'AMD' },
  { symbol: 'INTC', name: 'Intel' },
  { symbol: 'TCS', name: 'TCS' },
  { symbol: 'RELIANCE', name: 'Reliance' },
  { symbol: 'INFY', name: 'Infosys' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank' },
  { symbol: 'LLY', name: 'Eli Lilly' },
  { symbol: 'JPM', name: 'JPMorgan' },
  { symbol: 'BAC', name: 'Bank of America' },
  { symbol: 'UBER', name: 'Uber' },
  { symbol: 'SPOT', name: 'Spotify' },
  { symbol: 'PYPL', name: 'PayPal' },
  { symbol: 'CRM', name: 'Salesforce' },
  { symbol: 'SHOP', name: 'Shopify' },
  { symbol: 'SNAP', name: 'Snapchat' },
  { symbol: 'TWTR', name: 'Twitter/X' },
  { symbol: 'DIS', name: 'Disney' },
  { symbol: 'WMT', name: 'Walmart' },
  { symbol: 'V', name: 'Visa' },
  { symbol: 'MA', name: 'Mastercard' },
];

// ── Toast ─────────────────────────────────────────────────────────────────

function showToast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ── Auth ──────────────────────────────────────────────────────────────────

function isLoggedIn() { return !!token; }

function saveAuth(t, u) {
  token = t; currentUser = u;
  localStorage.setItem('token', t);
  localStorage.setItem('user', JSON.stringify(u));
}

function logout() {
  token = null; currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  showAuthPage();
}

function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// ── Profile ───────────────────────────────────────────────────────────────

function toggleProfile() {
  document.getElementById('profile-dropdown').classList.toggle('open');
}
function closeProfile() {
  document.getElementById('profile-dropdown').classList.remove('open');
}
function showNewest() {
  currentSort = 'newest';
  document.getElementById('sort-select').value = 'newest';
  fetchNews(); closeProfile();
}
document.addEventListener('click', e => {
  if (!e.target.closest('.profile-wrap')) closeProfile();
  if (!e.target.closest('.tab-wrap')) closeAllContextMenus();
  if (!e.target.closest('.search-wrap') && !e.target.closest('#search-toggle')) {
    // don't close on outside click if typing
  }
});

// ── Search toggle ─────────────────────────────────────────────────────────

function toggleSearch() {
  const wrap = document.getElementById('search-wrap');
  const isOpen = wrap.style.display !== 'none';
  wrap.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    setTimeout(() => document.getElementById('stock-search').focus(), 100);
  } else {
    document.getElementById('suggestions').innerHTML = '';
    document.getElementById('stock-search').value = '';
  }
}

function showSuggestions() {
  const val = document.getElementById('stock-search').value.trim().toUpperCase();
  const container = document.getElementById('suggestions');

  if (!val) { container.innerHTML = ''; return; }

  const matches = STOCK_SUGGESTIONS.filter(s =>
    s.symbol.startsWith(val) || s.name.toUpperCase().includes(val)
  ).slice(0, 5);

  if (matches.length === 0) {
    container.innerHTML = `<div class="suggestion-item" onclick="addStock('${val}')">Add "${val}" <span>New stock</span></div>`;
    return;
  }

  container.innerHTML = matches.map(s => `
    <div class="suggestion-item" onclick="selectSuggestion('${s.symbol}')">
      ${s.symbol} <span>${s.name}</span>
    </div>
  `).join('');
}

function selectSuggestion(symbol) {
  document.getElementById('stock-search').value = '';
  document.getElementById('suggestions').innerHTML = '';
  document.getElementById('search-wrap').style.display = 'none';
  if (trackedStocks.includes(symbol)) {
    filterByStock(symbol);
    showToast('Switched to ' + symbol);
  } else {
    addStock(symbol);
  }
}

function handleSearch(e) {
  if (e.key === 'Enter') {
    const val = document.getElementById('stock-search').value.trim().toUpperCase();
    if (!val) return;
    selectSuggestion(val);
  }
}

// ── Pages ─────────────────────────────────────────────────────────────────

function showAuthPage() {
  document.getElementById('auth-page').style.display = 'flex';
  document.getElementById('main-page').style.display = 'none';
}

function showMainPage() {
  document.getElementById('auth-page').style.display = 'none';
  document.getElementById('main-page').style.display = 'block';
  const email = currentUser?.email || '';
  document.getElementById('profile-initial').textContent = email.charAt(0).toUpperCase() || 'U';
  document.getElementById('profile-email-display').textContent = email;
  loadUserPreferences();
  fetchStocks();
  fetchNews();
}

function switchTab(tab) {
  document.getElementById('login-form').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('register-form').style.display = tab === 'register' ? 'block' : 'none';
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.auth-tab[onclick="switchTab('${tab}')"]`).classList.add('active');
}

// ── Auth Actions ──────────────────────────────────────────────────────────

async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');
  err.textContent = '';
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; return; }
    saveAuth(data.token, data.user);
    showMainPage();
  } catch (e) { err.textContent = 'Could not connect to server.'; }
}

async function register() {
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const err = document.getElementById('reg-error');
  err.textContent = '';
  if (password.length < 6) { err.textContent = 'Password must be at least 6 characters.'; return; }
  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; return; }
    saveAuth(data.token, data.user);
    showMainPage();
  } catch (e) { err.textContent = 'Could not connect to server.'; }
}

// ── Preferences ───────────────────────────────────────────────────────────

function loadUserPreferences() {
  if (!currentUser?.preferences) return;
  currentSentiment = currentUser.preferences.sentiment || 'all';
  currentSort = currentUser.preferences.sort || 'newest';
  const sel = document.getElementById('sort-select');
  if (sel) sel.value = currentSort;
}

async function savePreferences() {
  if (!isLoggedIn()) return;
  await fetch(`${API_BASE}/api/auth/preferences`, {
    method: 'PUT', headers: authHeaders(),
    body: JSON.stringify({ preferences: { sentiment: currentSentiment, sort: currentSort } })
  });
}

// ── News ──────────────────────────────────────────────────────────────────

async function fetchNews() {
  try {
    let url = `${API_BASE}/api/news/global?sort=${currentSort}`;
    if (currentStock === 'bookmarks') { renderBookmarks(); return; }
    else if (currentStock === 'all') url = `${API_BASE}/api/news?limit=100&sort=${currentSort}`;
    else if (currentStock !== 'global') url = `${API_BASE}/api/news/stock/${currentStock}?sort=${currentSort}`;

    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();
    allNews = data.news || [];
    renderNews();
  } catch (err) {
    document.getElementById('news-grid').innerHTML = '<div class="loading">Could not connect to server.</div>';
  }
}

async function fetchStocks() {
  trackedStocks = currentUser?.watchlist || [];
  renderStockTabs();
}

// ── Render ────────────────────────────────────────────────────────────────

function renderNews() {
  const grid = document.getElementById('news-grid');
  let news = allNews;
  if (currentSentiment !== 'all') news = news.filter(n => n.sentiment === currentSentiment);
  if (news.length === 0) {
    grid.innerHTML = '<div class="loading">No news available yet.</div>';
    return;
  }
  const bookmarks = currentUser?.bookmarks || [];
  grid.innerHTML = news.map(item => {
    const isBookmarked = bookmarks.find(b => b.id === item.id);
    return `
    <div class="news-card ${item.sentiment}">
      <div class="card-body">
        <div class="card-meta">
          <span class="stock-badge">${item.stock || 'GLOBAL'}</span>
          <span class="time-label">${timeAgo(item.publishedAt)}</span>
          <button class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}"
            onclick="toggleBookmark(event, ${JSON.stringify(item).replace(/"/g, '&quot;')})">
            ${isBookmarked ? 'Saved' : 'Save'}
          </button>
        </div>
        <div class="card-headline" spellcheck="false" onclick="window.open('${item.url || '#'}', '_blank')">${stripLinks(item.headline)}</div>
        <div class="card-story" spellcheck="false">${stripLinks(item.story)}</div>
        <div class="sentiment-tag ${item.sentiment}">${item.sentiment === 'bullish' ? 'Bullish' : item.sentiment === 'bearish' ? 'Bearish' : 'Neutral'}</div>
        <div class="card-source">${item.source}</div>
      </div>
    </div>`;
  }).join('');
}

function renderBookmarks() {
  const bookmarks = currentUser?.bookmarks || [];
  if (bookmarks.length === 0) {
    document.getElementById('news-grid').innerHTML = '<div class="loading">No saved articles yet.</div>';
    return;
  }
  allNews = bookmarks;
  renderNews();
}

function renderStockTabs() {
  const container = document.getElementById('stock-tabs');
  const stockTabsHTML = trackedStocks.map(s => `
    <div class="tab-wrap" id="wrap-${s}">
      <button class="tab ${currentStock === s ? 'active' : ''}"
        onclick="filterByStock('${s}')"
        onmousedown="startLongPress(event, '${s}')" onmouseup="cancelLongPress()" onmouseleave="cancelLongPress()"
        ontouchstart="startLongPress(event, '${s}')" ontouchend="cancelLongPress()"
      >${s}</button>
      <div class="tab-context-menu" id="ctx-${s}">
        <button class="tab-context-item" onclick="removeStock('${s}')">Remove ${s}</button>
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    <button class="tab ${currentStock === 'global' ? 'active' : ''}" onclick="filterByStock('global')">Global</button>
    <button class="tab ${currentStock === 'all' ? 'active' : ''}" onclick="filterByStock('all')">All</button>
    <button class="tab ${currentStock === 'bookmarks' ? 'active' : ''}" onclick="filterByStock('bookmarks')">Saved</button>
    ${stockTabsHTML}
    <button class="tab-add" onclick="toggleSearch()">+ Add</button>
  `;
}

// ── Long Press — position menu using fixed coords so it pops above sentiment bar ──

function startLongPress(e, symbol) {
  cancelLongPress();
  // Capture button position before timeout
  const btn = e.currentTarget || e.target;
  longPressTimer = setTimeout(() => {
    closeAllContextMenus();
    const menu = document.getElementById(`ctx-${symbol}`);
    if (!menu) return;

    // Temporarily show off-screen to measure width
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    const menuW = menu.offsetWidth;
    menu.style.display = '';
    menu.style.visibility = '';

    // Get button bounding rect for fixed positioning
    const rect = btn.getBoundingClientRect();
    const top = rect.top - 8;            // just above the button
    const left = rect.left + rect.width / 2 - menuW / 2;

    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.transform = 'translateY(-100%)';

    menu.classList.add('open');
  }, 600);
}

function cancelLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}

function closeAllContextMenus() {
  document.querySelectorAll('.tab-context-menu').forEach(m => {
    m.classList.remove('open');
    m.style.top = '';
    m.style.left = '';
    m.style.transform = '';
  });
}

// ── Actions ───────────────────────────────────────────────────────────────

function filterByStock(stock) {
  currentStock = stock;
  closeAllContextMenus();
  fetchNews();
  renderStockTabs();
}

function filterBySentiment(sentiment) {
  currentSentiment = sentiment === currentSentiment ? 'all' : sentiment;
  document.querySelectorAll('.sentiment-btn').forEach(btn => btn.classList.remove('active'));
  if (currentSentiment !== 'all') event.target.classList.add('active');
  renderNews();
  savePreferences();
}

function changeSort() {
  currentSort = document.getElementById('sort-select').value;
  fetchNews();
  savePreferences();
}

async function toggleBookmark(e, article) {
  e.stopPropagation();
  if (!isLoggedIn()) return;
  try {
    const res = await fetch(`${API_BASE}/api/auth/bookmarks`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ article })
    });
    const data = await res.json();
    currentUser.bookmarks = data.bookmarks;
    localStorage.setItem('user', JSON.stringify(currentUser));
    renderNews();
    showToast(currentUser.bookmarks.find(b => b.id === article.id) ? 'Article saved.' : 'Article removed.');
  } catch (e) {}
}

async function removeStock(symbol) {
  closeAllContextMenus();
  if (!confirm(`Remove ${symbol} from your watchlist?`)) return;
  try {
    const watchlist = (currentUser?.watchlist || []).filter(s => s !== symbol);
    const res = await fetch(`${API_BASE}/api/auth/watchlist`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ watchlist })
    });
    const data = await res.json();
    currentUser.watchlist = data.watchlist;
    localStorage.setItem('user', JSON.stringify(currentUser));
    trackedStocks = data.watchlist;
    if (currentStock === symbol) currentStock = 'global';
    renderStockTabs();
    fetchNews();
    showToast(`${symbol} removed.`);
  } catch (e) { showToast('Could not remove stock.'); }
}

async function addStock(symbol) {
  try {
    const watchlist = [...new Set([...(currentUser?.watchlist || []), symbol])];
    const res = await fetch(`${API_BASE}/api/auth/watchlist`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ watchlist })
    });
    const data = await res.json();
    currentUser.watchlist = data.watchlist;
    localStorage.setItem('user', JSON.stringify(currentUser));

    await fetch(`${API_BASE}/api/stocks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });
    await fetch(`${API_BASE}/api/stocks/fetch`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });

    trackedStocks = data.watchlist;
    currentStock = symbol;
    renderStockTabs();
    showToast(`${symbol} added. Fetching news...`);
    document.getElementById('news-grid').innerHTML = `<div class="loading">Fetching news for ${symbol}...</div>`;

    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      await fetchNews();
      if (attempts > 12) { clearInterval(poll); showToast(`Done loading ${symbol}`); }
    }, 5000);
  } catch (e) { showToast('Could not add stock. Try again.'); }
}

async function refreshNow() {
  const btn = document.getElementById('refresh-btn');
  if (btn) btn.textContent = 'Loading...';
  await fetchNews();
  if (btn) btn.textContent = 'Refresh';
}

// ── Utils ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Strip HTML tags (especially <a> links) from text — keeps plain text only
function stripLinks(html) {
  if (!html) return '';
  return html
    .replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1')  // unwrap <a> tags, keep inner text
    .replace(/<[^>]+>/g, '');                  // strip any remaining tags
}

// ── Init ──────────────────────────────────────────────────────────────────

if (isLoggedIn()) { showMainPage(); } else { showAuthPage(); }

setInterval(() => { if (isLoggedIn()) fetchNews(); }, 30000);