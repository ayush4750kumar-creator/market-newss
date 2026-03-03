const API_BASE = 'https://market-newss-production.up.railway.app'; 

let currentStock = 'all';
let currentSentiment = 'all';
let allNews = [];
let trackedStocks = [];

async function fetchNews() {
  try {
    let url = `${API_BASE}/api/news?limit=100`;
    if (currentStock === 'global') url = `${API_BASE}/api/news/global`;
    else if (currentStock !== 'all') url = `${API_BASE}/api/news/stock/${currentStock}`;

    const res = await fetch(url);
    const data = await res.json();
    allNews = data.news || [];

    document.getElementById('last-updated').textContent =
      data.lastUpdated ? `Updated: ${timeAgo(data.lastUpdated)}` : 'Not yet updated';

    renderNews();
  } catch (err) {
    document.getElementById('news-grid').innerHTML =
      '<div class="loading">⚠️ Could not connect to server. Make sure backend is running.</div>';
  }
}

async function fetchStocks() {
  try {
    const res = await fetch(`${API_BASE}/api/stocks`);
    const data = await res.json();
    trackedStocks = data.stocks || [];
    renderStockTabs();
  } catch (e) {}
}

function renderNews() {
  const grid = document.getElementById('news-grid');
  let news = allNews;

  if (currentSentiment !== 'all') {
    news = news.filter(n => n.sentiment === currentSentiment);
  }

  if (news.length === 0) {
    grid.innerHTML = '<div class="loading">No news available yet. Pipeline is running...</div>';
    return;
  }

  grid.innerHTML = news.map(item => `
    <div class="news-card ${item.sentiment}" onclick="window.open('${item.url || '#'}', '_blank')">
      <div class="card-body">
        <div class="card-meta">
          <span class="stock-badge">${item.stock || '🌍 GLOBAL'}</span>
          <span class="time-label">${timeAgo(item.publishedAt)}</span>
        </div>
        <div class="card-headline">${item.headline}</div>
        <div class="card-story">${item.story}</div>
        <div class="sentiment-tag ${item.sentiment}">${item.sentimentLabel || ''}</div>
        <div class="card-source">${item.source}</div>
      </div>
    </div>
  `).join('');
}

function renderStockTabs() {
  const container = document.getElementById('stock-tabs');
  const stockTabsHTML = trackedStocks.map(s =>
    `<button class="tab ${currentStock === s ? 'active' : ''}" onclick="filterByStock('${s}')">${s}</button>`
  ).join('');

  container.innerHTML = `
    <button class="tab ${currentStock === 'all' ? 'active' : ''}" onclick="filterByStock('all')">All</button>
    <button class="tab ${currentStock === 'global' ? 'active' : ''}" onclick="filterByStock('global')">🌍 Global</button>
    ${stockTabsHTML}
    <button class="tab" onclick="showAddStock()" style="border-style:dashed">+ Add</button>
  `;
}

function filterByStock(stock) {
  currentStock = stock;
  fetchNews();
  fetchStocks();
}

function filterBySentiment(sentiment) {
  currentSentiment = sentiment;
  document.querySelectorAll('.sentiment-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  renderNews();
}

function showAddStock() {
  const stock = prompt('Enter stock symbol (e.g. TCS, NVDA, META):');
  if (stock) addStock(stock.trim().toUpperCase());
}

async function addStock(symbol) {
  try {
    const res = await fetch(`${API_BASE}/api/stocks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });
    const data = await res.json();
    trackedStocks = data.stocks;
    renderStockTabs();
    await fetch(`${API_BASE}/api/refresh`, { method: 'POST' });
    alert(`✅ Added ${symbol}! News will appear in ~2 minutes.`);
  } catch (e) {
    alert('Could not add stock. Check backend.');
  }
}

async function refreshNow() {
  document.getElementById('refresh-btn').textContent = '⟳ Running...';
  await fetch(`${API_BASE}/api/refresh`, { method: 'POST' });
  let attempts = 0;
  const poll = setInterval(async () => {
    attempts++;
    await fetchNews();
    if (attempts > 10) {
      clearInterval(poll);
      document.getElementById('refresh-btn').textContent = '⟳ Refresh';
    }
  }, 3000);
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function sentimentEmoji(s) {
  return { bullish: '📈', bearish: '📉', neutral: '📰' }[s] || '📰';
}

fetchStocks();
fetchNews();
setInterval(fetchNews, 30000);