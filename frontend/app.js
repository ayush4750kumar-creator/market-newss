const API_BASE = 'https://market-newss-production.up.railway.app';

let currentStock = 'global'; // ✅ new users start on global
let currentSentiment = 'all';
let currentSort = 'newest';
let allNews = [];
let trackedStocks = [];
let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');

// ─── Auth ───────────────────────────────────────────────────────────────────

function isLoggedIn() { return !!token; }

function saveAuth(t, u) {
  token = t;
  currentUser = u;
  localStorage.setItem('token', t);
  localStorage.setItem('user', JSON.stringify(u));
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  showAuthPage();
}

function authHeaders() {
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
}

// ─── Pages ──────────────────────────────────────────────────────────────────

function showAuthPage() {
  document.getElementById('auth-page').style.display = 'flex';
  document.getElementById('main-page').style.display = 'none';
}

function showMainPage() {
  document.getElementById('auth-page').style.display = 'none';
  document.getElementById('main-page').style.display = 'block';
  document.getElementById('user-email').textContent = currentUser?.email || '';
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

// ─── Auth Actions ────────────────────────────────────────────────────────────

async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');
  err.textContent = '';
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; return; }
    saveAuth(data.token, data.user);
    showMainPage();
  } catch (e) {
    err.textContent = 'Could not connect to server.';
  }
}

async function register() {
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const err = document.getElementById('reg-error');
  err.textContent = '';
  if (password.length < 6) { err.textContent = 'Password must be at least 6 characters.'; return; }
  try {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; return; }
    saveAuth(data.token, data.user);
    showMainPage();
  } catch (e) {
    err.textContent = 'Could not connect to server.';
  }
}

// ─── Preferences ─────────────────────────────────────────────────────────────

function loadUserPreferences() {
  if (!currentUser?.preferences) return;
  currentSentiment = currentUser.preferences.sentiment || 'all';
  currentSort = currentUser.preferences.sort || 'newest';
  document.getElementById('sort-select').value = currentSort;
}

async function savePreferences() {
  if (!isLoggedIn()) return;
  await fetch(`${API_BASE}/api/auth/preferences`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ preferences: { sentiment: currentSentiment, sort: currentSort } })
  });
}

// ─── News ────────────────────────────────────────────────────────────────────

async function fetchNews() {
  try {
    let url = `${API_BASE}/api/news/global?sort=${currentSort}`;
    if (currentStock === 'bookmarks') { renderBookmarks(); return; }
    else if (currentStock === 'all') url = `${API_BASE}/api/news?limit=100&sort=${currentSort}`;
    else if (currentStock !== 'global') url = `${API_BASE}/api/news/stock/${currentStock}?sort=${currentSort}`;

    const res = await fetch(url, { headers: authHeaders() });
    const data = await res.json();
    allNews = data.news || [];

    document.getElementById('last-updated').textContent =
      data.lastUpdated ? `Updated: ${timeAgo(data.lastUpdated)}` : 'Not yet updated';

    renderNews();
  } catch (err) {
    document.getElementById('news-grid').innerHTML =
      '<div class="loading">⚠️ Could not connect to server.</div>';
  }
}

// ✅ Only show user's personal watchlist
async function fetchStocks() {
  try {
    const userWatchlist = currentUser?.watchlist || [];
    trackedStocks = userWatchlist;
    renderStockTabs();
  } catch (e) {}
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderNews() {
  const grid = document.getElementById('news-grid');
  let news = allNews;
  if (currentSentiment !== 'all') news = news.filter(n => n.sentiment === currentSentiment);

  if (news.length === 0) {
    grid.innerHTML = '<div class="loading">No news available yet. Pipeline is running...</div>';
    return;
  }

  const bookmarks = currentUser?.bookmarks || [];
  grid.innerHTML = news.map(item => {
    const isBookmarked = bookmarks.find(b => b.id === item.id);
    return `
    <div class="news-card ${item.sentiment}">
      <div class="card-body">
        <div class="card-meta">
          <span class="stock-badge">${item.stock || '🌍 GLOBAL'}</span>
          <span class="time-label">${timeAgo(item.publishedAt)}</span>
          <button class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}" onclick="toggleBookmark(event, ${JSON.stringify(item).replace(/"/g, '&quot;')})">
            ${isBookmarked ? '🔖' : '🏷️'}
          </button>
        </div>
        <div class="card-headline" onclick="window.open('${item.url || '#'}', '_blank')">${item.headline}</div>
        <div class="card-story">${item.story}</div>
        <div class="sentiment-tag ${item.sentiment}">${item.sentimentLabel || ''}</div>
        <div class="card-source">${item.source}</div>
      </div>
    </div>
  `}).join('');
}

function renderBookmarks() {
  const grid = document.getElementById('news-grid');
  const bookmarks = currentUser?.bookmarks || [];
  if (bookmarks.length === 0) {
    grid.innerHTML = '<div class="loading">No bookmarks yet. Click 🏷️ on any article to save it.</div>';
    return;
  }
  allNews = bookmarks;
  renderNews();
}

function renderStockTabs() {
  const container = document.getElementById('stock-tabs');
  const stockTabsHTML = trackedStocks.map(s => `
    <div class="tab-wrap">
      <button class="tab ${currentStock === s ? 'active' : ''}" onclick="filterByStock('${s}')">${s}</button>
      <button class="tab-remove" onclick="removeStock('${s}')" title="Remove">✕</button>
    </div>
  `).join('');

  container.innerHTML = `
    <button class="tab ${currentStock === 'global' ? 'active' : ''}" onclick="filterByStock('global')">🌍 Global</button>
    <button class="tab ${currentStock === 'all' ? 'active' : ''}" onclick="filterByStock('all')">All</button>
    <button class="tab ${currentStock === 'bookmarks' ? 'active' : ''}" onclick="filterByStock('bookmarks')">🔖 Saved</button>
    ${stockTabsHTML}
    <button class="tab" onclick="showAddStock()" style="border-style:dashed">+ Add Stock</button>
  `;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

function filterByStock(stock) {
  currentStock = stock;
  fetchNews();
  renderStockTabs();
}

function filterBySentiment(sentiment) {
  currentSentiment = sentiment;
  document.querySelectorAll('.sentiment-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
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
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ article })
    });
    const data = await res.json();
    currentUser.bookmarks = data.bookmarks;
    localStorage.setItem('user', JSON.stringify(currentUser));
    renderNews();
  } catch (e) {}
}

async function removeStock(symbol) {
  if (!confirm(`Remove ${symbol} from your watchlist?`)) return;
  try {
    const watchlist = (currentUser?.watchlist || []).filter(s => s !== symbol);
    const res = await fetch(`${API_BASE}/api/auth/watchlist`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ watchlist })
    });
    const data = await res.json();
    currentUser.watchlist = data.watchlist;
    localStorage.setItem('user', JSON.stringify(currentUser));
    trackedStocks = data.watchlist;
    if (currentStock === symbol) currentStock = 'global';
    renderStockTabs();
    fetchNews();
  } catch (e) {
    alert('Could not remove stock.');
  }
}

function showAddStock() {
  const stock = prompt('Enter stock symbol (e.g. TCS, NVDA, META):');
  if (stock) addStock(stock.trim().toUpperCase());
}

// ✅ Adds to user watchlist + triggers mini pipeline immediately
async function addStock(symbol) {
  try {
    // Save to user watchlist
    const watchlist = [...new Set([...(currentUser?.watchlist || []), symbol])];
    const res = await fetch(`${API_BASE}/api/auth/watchlist`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ watchlist })
    });
    const data = await res.json();
    currentUser.watchlist = data.watchlist;
    localStorage.setItem('user', JSON.stringify(currentUser));

    // Add to pipeline tracking
    await fetch(`${API_BASE}/api/stocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });

    // ✅ Trigger mini pipeline just for this stock
    await fetch(`${API_BASE}/api/stocks/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });

    trackedStocks = data.watchlist;
    currentStock = symbol; // switch to the new stock tab
    renderStockTabs();

    // ✅ Poll every 5 seconds for up to 1 minute for news to appear
    document.getElementById('news-grid').innerHTML = '<div class="loading">⏳ Fetching news for ' + symbol + '...</div>';
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      await fetchNews();
      if (attempts > 12) {
        clearInterval(poll);
      }
    }, 5000);

  } catch (e) {
    alert('Could not add stock. Check backend.');
  }
}

// ✅ Just fetches latest news, doesn't trigger pipeline
async function refreshNow() {
  document.getElementById('refresh-btn').textContent = '⟳ Loading...';
  await fetchNews();
  document.getElementById('refresh-btn').textContent = '⟳ Refresh';
}

// ─── Utils ───────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Init ────────────────────────────────────────────────────────────────────

if (isLoggedIn()) {
  showMainPage();
} else {
  showAuthPage();
}

setInterval(() => { if (isLoggedIn()) fetchNews(); }, 30000);