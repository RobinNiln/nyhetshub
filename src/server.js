const express = require('express');
const cron = require('node-cron');
const cors = require('cors');
const path = require('path');
const { fetchAll } = require('./fetcher');
const { getArticles } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

// ── API-endpoint ──────────────────────────────────────────
app.get('/api/news', (req, res) => {
  const { category, lang } = req.query;
  const articles = getArticles(category, lang);
  res.json(articles);
});

// ── Huvud-HTML (hela sajten) ──────────────────────────────
app.get('/', (req, res) => {
  res.send(generateHTML());
});

// ── Cron: hämta nyheter var 20:e minut ───────────────────
cron.schedule('*/20 * * * *', fetchAll);

// ── Starta servern ────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 NyhetsHub körs på http://localhost:${PORT}\n`);
  await fetchAll(); // hämta direkt vid start
});

// ── HTML-generator ────────────────────────────────────────
function generateHTML() {
  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  
  <!-- SEO -->
  <title>NyhetsHub – Sveriges nyheter samlat på ett ställe</title>
  <meta name="description" content="Få en snabb överblick över det senaste från svenska medier. Nyheter, sport, näringsliv och kultur – aggregerat och rankat i realtid.">
  <meta name="keywords" content="svenska nyheter, nyhetsöversikt, Sverige nyheter, SVT, DN, Aftonbladet, sport, näringsliv">
  <link rel="canonical" href="https://nyhetshub.se/">
  
  <!-- Open Graph (för delning) -->
  <meta property="og:title" content="NyhetsHub – Sveriges nyheter">
  <meta property="og:description" content="Snabb nyhetsöversikt från alla stora svenska medier.">
  <meta property="og:type" content="website">
  
  <!-- Schema.org strukturerad data för AI-sökning -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "NewsMediaOrganization",
    "name": "NyhetsHub",
    "description": "Aggregerad nyhetstjänst för svenska nyheter",
    "url": "https://nyhetshub.se"
  }
  </script>

  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f4f4f4;
      color: #1a1a1a;
    }

    /* ── Header ── */
    header {
      background: #1a1a2e;
      color: white;
      padding: 0 20px;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .header-inner {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 60px;
    }
    .logo { font-size: 1.4rem; font-weight: 800; letter-spacing: -0.5px; }
    .logo span { color: #e94560; }
    
    .lang-toggle {
      background: #e94560;
      border: none;
      color: white;
      padding: 6px 14px;
      border-radius: 20px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 600;
    }

    /* ── Google Ad: Leaderboard ── */
    .ad-leaderboard {
      background: #fff;
      text-align: center;
      padding: 10px;
      border-bottom: 1px solid #e0e0e0;
    }
    .ad-placeholder {
      background: #f0f0f0;
      border: 1px dashed #ccc;
      color: #999;
      font-size: 0.75rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
    }

    /* ── Kategorimeny ── */
    nav {
      background: white;
      border-bottom: 2px solid #e94560;
      overflow-x: auto;
      white-space: nowrap;
      -webkit-overflow-scrolling: touch;
    }
    .nav-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 20px;
      display: flex;
      gap: 4px;
    }
    .cat-btn {
      background: none;
      border: none;
      padding: 14px 16px;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 500;
      color: #555;
      border-bottom: 3px solid transparent;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .cat-btn:hover { color: #e94560; }
    .cat-btn.active {
      color: #e94560;
      border-bottom-color: #e94560;
      font-weight: 700;
    }

    /* ── Huvudinnehåll ── */
    .main-layout {
      max-width: 1200px;
      margin: 24px auto;
      padding: 0 20px;
      display: grid;
      grid-template-columns: 1fr 300px;
      gap: 24px;
    }
    @media (max-width: 768px) {
      .main-layout { grid-template-columns: 1fr; }
      .sidebar { display: none; }
    }

    /* ── Nyhetsrutnät ── */
    #news-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .news-card {
      background: white;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      transition: transform 0.15s, box-shadow 0.15s;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .news-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    }

    .card-source {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .source-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #e94560;
      flex-shrink: 0;
    }
    .source-name {
      font-size: 0.75rem;
      font-weight: 600;
      color: #e94560;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .cat-badge {
      margin-left: auto;
      font-size: 0.7rem;
      background: #f0f0f0;
      color: #666;
      padding: 2px 8px;
      border-radius: 10px;
    }

    .news-card a {
      text-decoration: none;
      color: #1a1a1a;
      font-size: 0.95rem;
      font-weight: 600;
      line-height: 1.4;
    }
    .news-card a:hover { color: #e94560; }

    .card-time {
      font-size: 0.75rem;
      color: #999;
      margin-top: auto;
    }

    /* Annons var 8:e kort */
    .ad-in-feed {
      background: white;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 120px;
      border: 1px dashed #ddd;
    }

    /* ── Sidebar ── */
    .sidebar { display: flex; flex-direction: column; gap: 20px; }

    .sidebar-widget {
      background: white;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .widget-title {
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #999;
      margin-bottom: 12px;
    }

    .trending-item {
      display: flex;
      gap: 10px;
      padding: 8px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .trending-num {
      font-size: 1.2rem;
      font-weight: 800;
      color: #e0e0e0;
      min-width: 24px;
    }
    .trending-item a {
      font-size: 0.85rem;
      color: #1a1a1a;
      text-decoration: none;
      line-height: 1.3;
    }
    .trending-item a:hover { color: #e94560; }

    /* ── Loading & states ── */
    .loading {
      grid-column: 1/-1;
      text-align: center;
      padding: 60px;
      color: #999;
    }
    .spinner {
      width: 32px; height: 32px;
      border: 3px solid #f0f0f0;
      border-top-color: #e94560;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Footer ── */
    footer {
      background: #1a1a2e;
      color: #aaa;
      text-align: center;
      padding: 24px;
      margin-top: 40px;
      font-size: 0.85rem;
    }
    footer a { color: #e94560; text-decoration: none; }
  </style>
</head>
<body>

<!-- Header -->
<header>
  <div class="header-inner">
    <div class="logo">Nyhets<span>Hub</span></div>
    <button class="lang-toggle" onclick="toggleLang()">🌐 EN</button>
  </div>
</header>

<!-- Google AdSense: Leaderboard (728x90) -->
<div class="ad-leaderboard">
  <!-- ERSÄTT MED DIN ADSENSE-KOD:
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXX" crossorigin="anonymous"></script>
  <ins class="adsbygoogle" style="display:inline-block;width:728px;height:90px" data-ad-client="ca-pub-XXXXXXXXXX" data-ad-slot="XXXXXXXXXX"></ins>
  -->
  <div class="ad-placeholder" style="width:728px;height:90px">Annons 728×90</div>
</div>

<!-- Kategorimeny -->
<nav>
  <div class="nav-inner" id="cat-nav">
    <button class="cat-btn active" onclick="loadNews('alla')" data-sv="🏠 Alla" data-en="🏠 All">🏠 Alla</button>
    <button class="cat-btn" onclick="loadNews('nyheter')" data-sv="📰 Nyheter" data-en="📰 News">📰 Nyheter</button>
    <button class="cat-btn" onclick="loadNews('politik')" data-sv="🏛️ Politik" data-en="🏛️ Politics">🏛️ Politik</button>
    <button class="cat-btn" onclick="loadNews('naringsliv')" data-sv="📈 Näringsliv" data-en="📈 Business">📈 Näringsliv</button>
    <button class="cat-btn" onclick="loadNews('sport')" data-sv="⚽ Sport" data-en="⚽ Sports">⚽ Sport</button>
    <button class="cat-btn" onclick="loadNews('tech')" data-sv="💻 Tech" data-en="💻 Tech">💻 Tech</button>
    <button class="cat-btn" onclick="loadNews('kultur')" data-sv="🎭 Kultur" data-en="🎭 Culture">🎭 Kultur</button>
    <button class="cat-btn" onclick="loadNews('utrikes')" data-sv="🌍 Utrikes" data-en="🌍 World">🌍 Utrikes</button>
  </div>
</nav>

<!-- Huvudlayout -->
<div class="main-layout">
  <main>
    <div id="news-grid">
      <div class="loading">
        <div class="spinner"></div>
        <div>Hämtar nyheter...</div>
      </div>
    </div>
  </main>

  <aside class="sidebar">
    <!-- Google AdSense: Rectangle (300x250) -->
    <div class="sidebar-widget">
      <!-- ERSÄTT MED DIN ADSENSE-KOD -->
      <div class="ad-placeholder" style="width:300px;height:250px">Annons 300×250</div>
    </div>

    <div class="sidebar-widget">
      <div class="widget-title" id="trending-title">🔥 Trending nu</div>
      <div id="trending-list"></div>
    </div>

    <div class="sidebar-widget">
      <div class="widget-title">Om NyhetsHub</div>
      <p style="font-size:0.82rem;color:#666;line-height:1.5">
        Vi aggregerar nyheter från Sveriges ledande medier och rankar dem efter aktualitet. Klicka på en rubrik för att läsa hela artikeln hos källan.
      </p>
    </div>
  </aside>
</div>
