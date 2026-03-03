const API_BASE = 'https://market-newss-production.up.railway.app';

let currentStock = 'global';
let currentSentiment = 'all';
let currentSort = 'newest';
let allNews = [];
let trackedStocks = [];
let token = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || 'null');
let longPressTimer = null;
let activeContextMenu = null;

// ─── Toast ───────────────────────────────────────────────────────────────────

function showToast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ─── Auth ────────────────────────────────────────────────────────────────────

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

// ─── Profile Menu ────────────────────────────────────────────────────────────

function toggleProfile() {
  const dd = document.getElementById('profile-dropdown');
  dd.classList.toggle('open');
}

function closeProfile() {
  document.getElementById('profile-dropdown').classList.remove('open');
}

function showNewest() {
  currentSort = 'newest';
  document.getElementById('sort-select').value = 'newest';
  fetchNews();
  closeProfile();
}

// Close profile dropdown when clicking outside
document.addEventListener('click', e => {
  const wrap = document.querySelector('.profile-wrap');
  if (wrap && !wrap.contains(e.target)) closeProfile();
});

// ─── Pages ───────────────────────────────────────────────────────────────────

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

// ─── Auth Actions ─────────────────────────────────────────────────────────────

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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error; return; }
    saveAuth(data.token, data.user);
    showMainPage();
  } catch (e) { err.textContent = 'Could not connect to server.'; }
}

// ─── Preferences ──────────────────────────────────────────────────────────────

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

// ─── News ─────────────────────────────────────────────────────────────────────

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
      '<div class="loading">Could not connect to server.</div>';
  }
}

async function fetchStocks() {
  try {
    trackedStocks = currentUser?.watchlist || [];
    renderStockTabs();
  } catch (e) {}
}

// ─── Render ───────────────────────────────────────────────────────────────────

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
          <span class="stock-badge">${item.stock || 'GLOBAL'}</span>
          <span class="time-label">${timeAgo(item.publishedAt)}</span>
          <button class="bookmark-btn ${isBookmarked ? 'bookmarked' : ''}"
            onclick="toggleBookmark(event, ${JSON.stringify(item).replace(/"/g, '&quot;')})">
            ${isBookmarked ? 'Saved' : 'Save'}
          </button>
        </div>
        <div class="card-headline" onclick="window.open('${item.url || '#'}', '_blank')">${item.headline}</div>
        <div class="card-story">${item.story}</div>
        <div class="sentiment-tag ${item.sentiment}">${item.sentiment === 'bullish' ? 'Bullish' : item.sentiment === 'bearish' ? 'Bearish' : 'Neutral'}</div>
        <div class="card-source">${item.source}</div>
      </div>
    </div>`
  }).join('');
}

function renderBookmarks() {
  const bookmarks = currentUser?.bookmarks || [];
  if (bookmarks.length === 0) {
    document.getElementById('news-grid').innerHTML =
      '<div class="loading">No saved articles yet. Click Save on any article.</div>';
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
        onmousedown="startLongPress('${s}')"
        onmouseup="cancelLongPress()"
        onmouseleave="cancelLongPress()"
        ontouchstart="startLongPress('${s}')"
        ontouchend="cancelLongPress()"
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
  `;
}

// ─── Long Press for Remove ────────────────────────────────────────────────────

function startLongPress(symbol) {
  cancelLongPress();
  longPressTimer = setTimeout(() => {
    closeAllContextMenus();
    const menu = document.getElementById(`ctx-${symbol}`);
    if (menu) {
      menu.classList.add('open');
      activeContextMenu = symbol;
    }
  }, 600); // 600ms hold
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function closeAllContextMenus() {
  document.querySelectorAll('.tab-context-menu').forEach(m => m.classList.remove('open'));
  activeContextMenu = null;
}

// Close context menus when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.tab-wrap')) closeAllContextMenus();
});

// ─── Actions ──────────────────────────────────────────────────────────────────

function filterByStock(stock) {
  currentStock = stock;
  closeAllContextMenus();
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
    showToast(currentUser.bookmarks.find(b => b.id === article.id) ? 'Article saved.' : 'Article removed.');
  } catch (e) {}
}

async function removeStock(symbol) {
  closeAllContextMenus();
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
    showToast(`${symbol} removed from watchlist.`);
  } catch (e) {
    showToast('Could not remove stock.');
  }
}

// ─── Search + Add ─────────────────────────────────────────────────────────────

function handleSearch(e) {
  if (e.key === 'Enter') {
    const val = document.getElementById('stock-search').value.trim().toUpperCase();
    if (!val) return;
    document.getElementById('stock-search').value = '';
    if (trackedStocks.includes(val)) {
      filterByStock(val);
      showToast('Switched to ' + val);
    } else {
      addStock(val);
    }
  }
}

async function addStock(symbol) {
  try {
    const watchlist = [...new Set([...(currentUser?.watchlist || []), symbol])];
    const res = await fetch(`${API_BASE}/api/auth/watchlist`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ watchlist })
    });
    const data = await res.json();
    currentUser.watchlist = data.watchlist;
    localStorage.setItem('user', JSON.stringify(currentUser));

    await fetch(`${API_BASE}/api/stocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });

    await fetch(`${API_BASE}/api/stocks/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });

    trackedStocks = data.watchlist;
    currentStock = symbol;
    renderStockTabs();
    showToast(`${symbol} added. Fetching news...`);
    document.getElementById('news-grid').innerHTML =
      `<div class="loading">Fetching news for ${symbol}...</div>`;

    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      await fetchNews();
      if (attempts > 12) {
        clearInterval(poll);
        showToast(`Done fetching news for ${symbol}`);
      }
    }, 5000);
  } catch (e) {
    showToast('Could not add stock. Try again.');
  }
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

async function refreshNow() {
  document.getElementById('refresh-btn').textContent = 'Loading...';
  await fetchNews();
  document.getElementById('refresh-btn').textContent = 'Refresh';
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

if (isLoggedIn()) {
  showMainPage();
} else {
  showAuthPage();
}

setInterval(() => { if (isLoggedIn()) fetchNews(); }, 30000);