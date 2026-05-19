const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { init, get, lastFetched, getTopStories } = require('./db');
const { fetchAll } = require('./fetcher');

const app = express();
app.use(cors());
app.use(express.static('public'));

const SITE_URL = process.env.SITE_URL || 'https://skime.se';

const ALL_REGIONS = [
  'Blekinge','Dalarna','Gotland','Gävleborg','Halland',
  'Jämtland','Jönköping','Kalmar','Kronoberg','Norrbotten',
  'Skåne','Stockholm','Södermanland','Uppsala','Värmland',
  'Västerbotten','Västernorrland','Västmanland','Västra Götaland',
  'Örebro','Östergötland'
];

const CATEGORIES = ['nyheter','valet2026','samhalle','naringsliv','sport','tech','kultur','utrikes','english'];

// Hämta nyheter var 15:e minut automatiskt
cron.schedule('*/15 * * * *', fetchAll);

// ── API ───────────────────────────────────────────────────────
// Klick-tracking – spara när någon klickar på en artikel
app.post('/api/click', express.json(), async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing url' });
    const { Pool } = require('pg');
    const pool = new (require('pg').Pool)({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    await pool.query(`
      INSERT INTO article_clicks (url, clicked_at)
      VALUES ($1, NOW())
    `, [url]);
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false });
  }
});

// Mest läst – senaste 24 timmar
app.get('/api/most-read', async (req, res) => {
  try {
    const { Pool } = require('pg');
    const pool = new (require('pg').Pool)({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    const { rows } = await pool.query(`
      SELECT a.title, a.url, COUNT(c.url) as clicks
      FROM articles a
      JOIN article_clicks c ON a.url = c.url
      WHERE c.clicked_at > NOW() - INTERVAL '24 hours'
      GROUP BY a.title, a.url
      ORDER BY clicks DESC
      LIMIT 7
    `);
    res.json(rows);
  } catch(e) {
    res.json([]);
  }
});

// ── TRENDING TOPICS ──────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  // Svenska småord
  'och','att','för','inte','med','den','det','som','på','av','en','ett','är',
  'var','har','har','hade','ska','kan','till','från','om','när','under','efter',
  'över','inom','utan','samt','men','eller','även','också','sedan','redan',
  'detta','dessa','detta','detta','hela','andra','alla','många','flera',
  'varje','något','någon','några','vilka','vilket','vilken','denna','dessa',
  'hans','hennes','deras','vår','våra','ditt','dina','sina','sitt','sin',
  'just','dock','dock','ändå','ändå','bara','bort','fram','igen','kvar',
  'länge','länge','lite','mycket','mer','mest','mindre','minst','nästan',
  'aldrig','alltid','ofta','sällan','nog','faktiskt','verkligen','ungefär',
  'kommer','gjorde','gick','fick','blev','tagit','tagits','säger','enligt',
  'mot','hos','vid','kring','bland','bakom','framför','utanför','innanför',
  'trots','trots','pga','via','resp','dvs','osv','etc',
  // Engelska småord
  'the','and','for','with','that','this','from','have','will','after',
  'about','into','they','their','there','been','were','would','could',
  // Källnamn – ska ej bli hashtaggar
  'svt','aftonbladet','expressen','sydsvenskan','dn','svd','sr','gp',
  'di','norran','barometern','corren','bt','nt','unt','nsd','vlt','na',
  'hockeysverige','fotbollskanalen','breakit','tv4','sverigesradio',
  // Vanliga nyhetsord som inte ger värde
  'polisen','räddningstjänsten','kommunen','regionen','rapporten',
  'beslutet','frågan','saken','händelsen','situationen','problemet',
]);

const MIN_LENGTH = 4;
const MIN_ARTICLES = 3;

let topicsCache = [];
let topicsCacheTime = 0;

function extractTopics(articles) {
  const wordCount = new Map();

  for (const article of articles) {
    const words = article.title
      .replace(/[–—\-]/g, ' ')
      .split(/\s+/)
      .map(w => w.replace(/[^a-zåäöA-ZÅÄÖ]/g, ''))
      .filter(w => w.length >= MIN_LENGTH);

    const seen = new Set();
    for (const word of words) {
      const lower = word.toLowerCase();
      if (STOPWORDS.has(lower)) continue;
      if (seen.has(lower)) continue;
      seen.add(lower);

      // Prioritera ord som börjar med versal (egennamn)
      const isProperNoun = word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase();
      const weight = isProperNoun ? 2 : 1;
      wordCount.set(lower, (wordCount.get(lower) || 0) + weight);
    }
  }

  return Array.from(wordCount.entries())
    .filter(([, count]) => count >= MIN_ARTICLES)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => {
      // Kapitalisera första bokstaven
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
}

function slugify(word) {
  return word.toLowerCase()
    .replace(/å/g,'a').replace(/ä/g,'a').replace(/ö/g,'o')
    .replace(/[^a-z0-9]/g,'');
}

async function getTopics() {
  const now = Date.now();
  if (topicsCache.length && now - topicsCacheTime < 60 * 60 * 1000) {
    return topicsCache;
  }
  try {
    const { Pool } = require('pg');
    const pool = new (require('pg').Pool)({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    const { rows } = await pool.query(`
      SELECT title FROM articles
      WHERE fetched_at > NOW() - INTERVAL '3 hours'
      AND region IS NULL
    `);
    topicsCache = extractTopics(rows);
    topicsCacheTime = now;
  } catch(e) {
    console.error('Topics error:', e.message);
  }
  return topicsCache;
}

app.get('/api/trending-topics', async (req, res) => {
  const topics = await getTopics();
  res.json(topics.map(t => ({ word: t, slug: slugify(t) })));
});

// Fasta topic-definitioner för viktiga ämnen
const FIXED_TOPICS = {
  'allsvenskan': {
    title: 'Allsvenskan',
    keywords: ['allsvenskan','malmö ff','djurgården','hammarby','ifk göteborg','ifk norrköping','häcken','elfsborg','kalmar ff','mjällby','gais','degerfors','brommapojkarna','västerås sk','örebro sk','halmstad bk','göteborg fc'],
    desc: 'Senaste nytt från Allsvenskan – matcher, tabeller och transfernyheter.'
  },
  'shl': {
    title: 'SHL',
    keywords: ['shl','rögle','skellefteå aik','frölunda','djurgårdens hockey','brynäs','luleå hockey','linköping hc','örebro hockey','färjestad','hv71','timrå','oskarshamn','leksand','modo hockey','sm-final','tre kronor'],
    desc: 'Senaste nytt från SHL – matcher, SM-slutspel och hockeynyheter.'
  },
  'vm-2026': {
    title: 'VM 2026',
    keywords: ['vm 2026','fotbolls-vm','world cup 2026','vm-kval','vm-trupp','fifa vm','vm-lottning','vm-grupp','vm-match','fotbolls vm','världsmästerskapet 2026'],
    desc: 'Allt om fotbolls-VM 2026 i USA, Kanada och Mexiko.'
  },
  'valet-2026': {
    title: 'Valet 2026',
    keywords: ['valet 2026','riksdagsvalet','kommunalvalet','regionvalet','partiledardebatt','valrörelsen','valresultat','opinionsundersökning','väljarstöd','valmanifest','valanalys','valets'],
    desc: 'Nyheter och analyser inför riksdagsvalet 2026.'
  }
};

// Topic-sida – /topic/:slug
app.get('/topic/:slug', async (req, res) => {
  const slug = req.params.slug;

  // Kolla fasta topics först
  const fixed = FIXED_TOPICS[slug];
  const topics = await getTopics();
  const match = topics.find(t => slugify(t) === slug);
  const keyword = fixed ? null : (match || slug);
  const pageTitle = fixed ? fixed.title : (match || slug.charAt(0).toUpperCase() + slug.slice(1));
  const pageDesc = fixed ? fixed.desc : `Senaste nyheterna om ${pageTitle} från svenska medier.`;

  try {
    const { Pool } = require('pg');
    const pool = new (require('pg').Pool)({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    let rows;
    if (fixed) {
      const kwConditions = fixed.keywords.map((kw, i) => `title ILIKE $${i + 1}`);
      const params = fixed.keywords.map(kw => `%${kw}%`);
      const { rows: r } = await pool.query(`
        SELECT title, url, source, ingress, published_at, category
        FROM articles
        WHERE (${kwConditions.join(' OR ')})
        AND fetched_at > NOW() - INTERVAL '24 hours'
        ORDER BY published_at DESC
        LIMIT 60
      `, params);
      rows = r;
    } else {
      const { rows: r } = await pool.query(`
        SELECT title, url, source, ingress, published_at, category
        FROM articles
        WHERE title ILIKE $1
        AND fetched_at > NOW() - INTERVAL '24 hours'
        ORDER BY published_at DESC
        LIMIT 60
      `, [`%${keyword}%`]);
      rows = r;
    }

    const cards = rows.map(a => {
      const time = a.published_at
        ? new Date(a.published_at).toLocaleString('sv-SE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})
        : '';
      return `<article style="background:#fff;border:1px solid #e5e5e5;border-radius:6px;padding:14px;display:flex;flex-direction:column;gap:8px;">
        <a href="${a.url}" target="_blank" rel="noopener noreferrer" style="color:#111;text-decoration:none;font-size:0.9rem;font-weight:600;line-height:1.5;">${a.title}</a>
        ${a.ingress ? `<p style="font-size:0.8rem;color:#555;margin:0;line-height:1.45;">${a.ingress}</p>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.68rem;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.5px;">${a.source}</span>
          <span style="font-size:0.68rem;color:#999;">${time}</span>
        </div>
      </article>`;
    }).join('');

    // FAQ-innehåll för fasta topics
    const FAQ = {
      'allsvenskan': [
        { q: 'Vad är Allsvenskan?', a: 'Allsvenskan är den högsta divisionen i svensk fotboll för herrar. Serien spelas varje år med 16 lag och avgör vilket lag som blir svenska mästare.' },
        { q: 'Vilka lag spelar i Allsvenskan?', a: 'Allsvenskan 2026 innehåller lag som Malmö FF, Djurgårdens IF, Hammarby IF, IFK Göteborg, IFK Norrköping, Häcken, IF Elfsborg och fler.' },
        { q: 'Var kan jag följa Allsvenskan-nyheter?', a: 'Skime samlar Allsvenskan-nyheter från SVT Sport, Aftonbladet Sport, Expressen Sport, Fotbollskanalen och lokaltidningar i realtid.' },
      ],
      'shl': [
        { q: 'Vad är SHL?', a: 'SHL (Swedish Hockey League) är den högsta divisionen i svensk ishockey. Serien avgör vilket lag som blir svenska mästare i hockey.' },
        { q: 'Vilka lag spelar i SHL?', a: 'SHL innehåller lag som Rögle BK, Skellefteå AIK, Frölunda, Djurgårdens Hockey, Brynäs, Luleå Hockey, Färjestad och fler.' },
        { q: 'Var kan jag följa SHL-nyheter?', a: 'Skime samlar SHL-nyheter från Hockeysverige, SVT Sport, Expressen Sport och lokaltidningar i realtid.' },
      ],
      'vm-2026': [
        { q: 'Var spelas fotbolls-VM 2026?', a: 'Fotbolls-VM 2026 spelas i USA, Kanada och Mexiko. Det är det första VM med 48 deltagande nationer.' },
        { q: 'När spelas fotbolls-VM 2026?', a: 'Fotbolls-VM 2026 spelas sommaren 2026, med final den 19 juli 2026 på MetLife Stadium i New Jersey.' },
        { q: 'Är Sverige med i VM 2026?', a: 'Sverige spelar VM-kval för att ta sig till VM 2026. Följ de senaste nyheterna om det svenska landslaget på Skime.' },
      ],
      'valet-2026': [
        { q: 'När är riksdagsvalet 2026?', a: 'Riksdagsvalet 2026 hålls den andra söndagen i september 2026, det vill säga den 13 september 2026.' },
        { q: 'Vilka partier ställer upp i valet 2026?', a: 'Alla riksdagspartier ställer upp: Socialdemokraterna, Moderaterna, Sverigedemokraterna, Centerpartiet, Vänsterpartiet, Kristdemokraterna, Liberalerna och Miljöpartiet.' },
        { q: 'Var kan jag följa valrörelsen 2026?', a: 'Skime samlar de senaste valnyheterna från SVT, SR, DN, SvD, Aftonbladet och Expressen i realtid.' },
      ],
    };

    const faqData = FAQ[slug] || [];
    const faqSchema = faqData.length ? JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': faqData.map(f => ({
        '@type': 'Question',
        'name': f.q,
        'acceptedAnswer': { '@type': 'Answer', 'text': f.a }
      }))
    }) : null;

    const collectionSchema = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      'name': `${pageTitle} – nyheter`,
      'description': pageDesc,
      'url': `https://www.skime.se/topic/${slug}`,
      'about': { '@type': 'Thing', 'name': pageTitle },
      'publisher': { '@type': 'Organization', 'name': 'Skime', 'url': 'https://www.skime.se' },
      'numberOfItems': rows.length,
      'dateModified': new Date().toISOString()
    });

    const faqHtml = faqData.length ? `
      <div style="margin-top:32px;border-top:1px solid #e5e5e5;padding-top:24px;">
        <h2 style="font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:700;margin-bottom:16px;color:#111;">Vanliga frågor om ${pageTitle}</h2>
        ${faqData.map(f => `
          <details style="margin-bottom:12px;border:1px solid #e5e5e5;border-radius:6px;padding:12px 16px;background:#fff;cursor:pointer;">
            <summary style="font-weight:600;font-size:0.9rem;color:#111;list-style:none;">${f.q}</summary>
            <p style="margin-top:8px;font-size:0.85rem;color:#555;line-height:1.6;">${f.a}</p>
          </details>`).join('')}
      </div>` : '';

    res.send(`<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle} nyheter – Skime</title>
  <meta name="description" content="${pageDesc}">
  <link rel="canonical" href="https://www.skime.se/topic/${slug}">
  <meta property="og:title" content="${pageTitle} nyheter – Skime">
  <meta property="og:description" content="${pageDesc}">
  <meta property="og:url" content="https://www.skime.se/topic/${slug}">
  <meta property="og:type" content="website">
  <script type="application/ld+json">${collectionSchema}</script>
  ${faqSchema ? `<script type="application/ld+json">${faqSchema}</script>` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;background:#f4f4f4;color:#111;min-height:100vh}
    header{background:#fff;border-bottom:1px solid #e5e5e5;padding:0 20px}
    .header-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;height:80px;gap:16px}
    .logo img{height:60px;width:auto}
    .layout{max-width:1200px;margin:32px auto;padding:0 20px}
    h1{font-family:'Syne',sans-serif;font-size:1.8rem;font-weight:800;margin-bottom:6px}
    .meta{font-size:0.8rem;color:#888;margin-bottom:8px}
    .desc{font-size:0.9rem;color:#555;margin-bottom:24px;line-height:1.6;}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
    .empty{text-align:center;padding:60px;color:#999}
    details summary::-webkit-details-marker{display:none}
    @media(max-width:600px){.grid{grid-template-columns:1fr}.header-inner{height:60px}.logo img{height:44px}}
  </style>
</head>
<body>
<header>
  <div class="header-inner">
    <div class="logo"><a href="/"><img src="/Skimelogo.png" alt="Skime"></a></div>
  </div>
</header>
<div class="layout">
  <h1>${pageTitle}</h1>
  <p class="desc">${pageDesc}</p>
  <p class="meta">${rows.length} nyheter de senaste 24 timmarna · Uppdateras var 15:e minut</p>
  ${rows.length ? `<div class="grid">${cards}</div>` : '<div class="empty">Inga nyheter hittades om detta ämne just nu.</div>'}
  ${faqHtml}
  <p style="margin-top:32px;font-size:0.8rem;color:#999"><a href="/" style="color:#2563eb">← Tillbaka till Skime</a></p>
</div>
</body>
</html>`);
  } catch(e) {
    res.status(500).send('Fel vid hämtning av artiklar.');
  }
});

app.get('/api/top-stories', async (req, res) => {
  try {
    const stories = await getTopStories(req.query.category || null, req.query.sport || null);
    res.json(stories);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/meter', async (req, res) => {
  try {
    const { Pool } = require('pg');
    const pool = new (require('pg').Pool)({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE fetched_at > NOW() - INTERVAL '1 hour') AS last_hour,
        COUNT(*) FILTER (WHERE fetched_at > NOW() - INTERVAL '1 day') / 24.0 AS daily_avg,
        COUNT(DISTINCT category) AS categories
      FROM articles
      WHERE fetched_at > NOW() - INTERVAL '1 day'
    `);
    const lastHour = parseInt(rows[0].last_hour) || 0;
    const dailyAvg = parseFloat(rows[0].daily_avg) || 1;
    const intensity = Math.min(100, Math.round((lastHour / dailyAvg) * 50));
    res.json({ articles_last_hour: lastHour, intensity });
  } catch(e) {
    res.json({ articles_last_hour: 80, intensity: 50 });
  }
});

app.get('/api/news', async (req, res) => {
  try {
    const articles = await get({
      category: req.query.category,
      region: req.query.region,
      sport: req.query.sport
    });
    res.json(articles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/om-oss', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Om Skime – Alla svenska nyheter på ett ställe</title>
  <meta name="description" content="Skime är en oberoende svensk nyhetstjänst som samlar nyheter från 100+ svenska medier i realtid. Läs om hur vi väljer källor, hur algoritmen fungerar och varför Skime byggdes.">
  <link rel="canonical" href="https://www.skime.se/om-oss">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"AboutPage","name":"Om Skime","description":"Skime är en oberoende svensk nyhetstjänst som samlar nyheter från 100+ svenska medier i realtid.","url":"https://www.skime.se/om-oss","publisher":{"@type":"Organization","name":"Skime","url":"https://www.skime.se","logo":{"@type":"ImageObject","url":"https://www.skime.se/Skimelogo.png"}}}</script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;max-width:720px;margin:0 auto;padding:40px 24px 80px;color:#111;line-height:1.8;background:#fff;}
    h1{font-size:2rem;font-weight:800;margin-bottom:12px;letter-spacing:-1px;line-height:1.2;}
    h2{font-size:1.1rem;font-weight:700;margin:40px 0 8px;color:#111;}
    h3{font-size:1rem;font-weight:600;margin:24px 0 6px;color:#333;}
    p{margin-bottom:16px;color:#333;font-size:1rem;}
    .lead{font-size:1.15rem;color:#444;margin-bottom:32px;line-height:1.7;}
    .highlight{background:#f0f5ff;border-left:3px solid #2563eb;padding:16px 20px;border-radius:4px;margin:32px 0;}
    .highlight p{margin:0;color:#1e3a8a;font-weight:500;}
    .stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:24px 0;}
    .stat{background:#f9f9f9;border:1px solid #e5e5e5;border-radius:8px;padding:16px;text-align:center;}
    .stat-num{font-size:1.8rem;font-weight:700;color:#2563eb;display:block;}
    .stat-label{font-size:0.78rem;color:#888;margin-top:4px;display:block;}
    .source-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin:16px 0;}
    .source-tag{background:#f4f4f4;border-radius:6px;padding:6px 10px;font-size:0.82rem;color:#444;text-align:center;}
    a{color:#2563eb;}
    .back{display:inline-block;margin-bottom:32px;color:#888;text-decoration:none;font-size:0.9rem;}
    .back:hover{color:#111;}
    .divider{height:1px;background:#e5e5e5;margin:40px 0;}
    footer{margin-top:60px;padding-top:24px;border-top:1px solid #e5e5e5;font-size:0.8rem;color:#aaa;}
    @media(max-width:600px){.stat-grid{grid-template-columns:1fr 1fr;}.stat-num{font-size:1.4rem;}}
  </style>
</head>
<body>
  <a class="back" href="/">← Tillbaka till Skime</a>
  <h1>Om Skime</h1>
  <p class="lead">Skime är en oberoende svensk nyhetstjänst som samlar nyheter från över 100 svenska och internationella medier på ett ställe – uppdaterat var 15:e minut, helt gratis.</p>

  <div class="highlight">
    <p>Vi sweper nyhetsinternet åt dig. Du behöver inte göra det.</p>
  </div>

  <div class="stat-grid">
    <div class="stat"><span class="stat-num">100+</span><span class="stat-label">Aktiva källor</span></div>
    <div class="stat"><span class="stat-num">15 min</span><span class="stat-label">Uppdateringsintervall</span></div>
    <div class="stat"><span class="stat-num">21</span><span class="stat-label">Svenska regioner</span></div>
  </div>

  <h2>Varför Skime byggdes</h2>
  <p>Idén till Skime kom ur en enkel frustration: att hålla koll på svenska nyheter kräver att man hoppar mellan SVT, DN, Aftonbladet, Expressen och ett dussintal lokaltidningar varje morgon. Det är tidskrävande och ineffektivt.</p>
  <p>Skime byggdes för att lösa det. En sajt, alla nyheter, utan krångel. Ingen inloggning, inga prerolls, inga pop-ups.</p>

  <h2>Hur Skime fungerar</h2>
  <p>Skime hämtar automatiskt nyheter från RSS-flöden hos Sveriges ledande medier var 15:e minut, dygnet runt. Varje artikel analyseras, kategoriseras och rankas baserat på hur många oberoende källor som rapporterar om samma händelse.</p>

  <h3>Rankningsalgoritmen</h3>
  <p>En nyhet som rapporteras av sex oberoende medier anses viktigare än en nyhet som bara en källa skriver om. Algoritmen kombinerar källantal med aktualitet – färska nyheter med bred täckning rankas högst som toppnyheter.</p>
  <p>Formeln är enkel: <strong>topScore = källantal × (1 + recency_bonus)</strong> där recency_bonus sjunker från 1.0 till 0 under 6 timmar. Det innebär att en nyhet aldrig kan ligga kvar som toppnyhet hur länge som helst – nya viktiga nyheter tar automatiskt över.</p>

  <h3>Kategorisering</h3>
  <p>Varje artikel kategoriseras automatiskt baserat på nyckelord i rubriken. Kategorierna är: Nyheter, Sport, Valet 2026, Näringsliv, Tech, Utrikes, Samhälle, Kultur och International news in English. Artiklar som inte passar in i en specifik kategori hamnar under Nyheter.</p>

  <h3>Filtrering</h3>
  <p>Skime filtrerar aktivt bort ledartexter, krönikor, debattartiklar, opinionsmaterial, reklam och prenumerationserbjudanden. Det är ett medvetet val för att hålla innehållet objektivt och nyhetsbaserat.</p>

  <h2>Källor</h2>
  <p>Skime hämtar nyheter från följande kategorier av källor:</p>

  <h3>Nationella medier</h3>
  <div class="source-grid">
    <div class="source-tag">SVT</div><div class="source-tag">SR</div><div class="source-tag">DN</div>
    <div class="source-tag">SvD</div><div class="source-tag">Aftonbladet</div><div class="source-tag">Expressen</div>
    <div class="source-tag">DI</div><div class="source-tag">Breakit</div><div class="source-tag">GP</div>
    <div class="source-tag">Sydsvenskan</div><div class="source-tag">TV4</div><div class="source-tag">Omni</div><div class="source-tag">TT</div>
  </div>

  <h3>Sport</h3>
  <div class="source-grid">
    <div class="source-tag">SVT Sport</div><div class="source-tag">Aftonbladet Sport</div>
    <div class="source-tag">Expressen Sport</div><div class="source-tag">Fotbollskanalen</div>
    <div class="source-tag">Fotbolldirekt</div><div class="source-tag">Hockeysverige</div>
    <div class="source-tag">Hockeyexpressen</div>
  </div>

  <h3>Regionala medier</h3>
  <p>Skime täcker alla 21 svenska län med minst 2–3 lokala källor per region, inklusive SVT:s lokala nyhetssändningar och regionala tidningar.</p>

  <h3>Internationella källor</h3>
  <div class="source-grid">
    <div class="source-tag">BBC News</div><div class="source-tag">Reuters</div>
    <div class="source-tag">The Guardian</div><div class="source-tag">AP News</div>
    <div class="source-tag">Al Jazeera</div><div class="source-tag">New York Times</div>
  </div>

  <div class="divider"></div>

  <h2>Vad Skime inte är</h2>
  <p>Skime är inte en redaktion. Vi skriver inga egna nyheter, tar inga politiska ställningstaganden och har inga egna agendor. Vi är ett fönster mot det svenska medielandskapet – inte en röst i det.</p>
  <p>Skime publicerar aldrig ledartexter, krönikor eller opinionsmaterial. Vi visar nyheter – inte åsikter.</p>

  <h2>Upphovsrätt och källhänvisning</h2>
  <p>Allt innehåll på Skime tillhör respektive källa. Skime visar enbart rubriker, korta ingresser och länkar till originalartiklarna. Klickar du på en nyhet skickas du direkt till källans webbplats. Skime gör inga anspråk på äganderätt till källornas innehåll.</p>

  <h2>Finansiering</h2>
  <p>Skime är gratis att använda. Sajten finansieras av annonser via Google AdSense. Vi samlar inte in personuppgifter och säljer inte användardata. Se vår <a href="/integritetspolicy">integritetspolicy</a> för mer information.</p>

  <h2>Kontakt</h2>
  <p>Har du frågor, feedback eller vill rapportera ett problem? Besök vår <a href="/kontakt">kontaktsida</a>.</p>

  <footer>
    <p>© 2026 Skime · <a href="/integritetspolicy">Integritetspolicy</a> · <a href="/kontakt">Kontakt</a></p>
  </footer>
</body>
</html>`);
});

app.get('/kontakt', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kontakt – Skime</title>
  <meta name="description" content="Kontakta Skime med frågor, feedback eller rapportera ett problem.">
  <link rel="canonical" href="https://www.skime.se/kontakt">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;max-width:720px;margin:0 auto;padding:40px 24px 80px;color:#111;line-height:1.8;background:#fff;}
    h1{font-size:2rem;font-weight:800;margin-bottom:12px;letter-spacing:-1px;}
    h2{font-size:1.1rem;font-weight:700;margin:32px 0 8px;}
    p{margin-bottom:16px;color:#333;font-size:1rem;}
    .lead{font-size:1.1rem;color:#444;margin-bottom:32px;}
    .contact-card{background:#f9f9f9;border:1px solid #e5e5e5;border-radius:10px;padding:24px;margin:24px 0;}
    .contact-card h3{font-size:1rem;font-weight:600;margin-bottom:8px;}
    .contact-card p{margin:0;color:#555;}
    a{color:#2563eb;}
    .back{display:inline-block;margin-bottom:32px;color:#888;text-decoration:none;font-size:0.9rem;}
    .back:hover{color:#111;}
    .divider{height:1px;background:#e5e5e5;margin:32px 0;}
    footer{margin-top:60px;padding-top:24px;border-top:1px solid #e5e5e5;font-size:0.8rem;color:#aaa;}
  </style>
</head>
<body>
  <a class="back" href="/">← Tillbaka till Skime</a>
  <h1>Kontakt</h1>
  <p class="lead">Vi välkomnar feedback, frågor och rapporter om problem på sajten.</p>

  <div class="contact-card">
    <h3>Allmänna frågor och feedback</h3>
    <p>Har du förslag på förbättringar, saknar en nyhetskälla eller vill ge feedback? Hör av dig via e-post till <a href="https://www.linkedin.com/company/skime/" target="_blank" rel="noopener noreferrer">Skimes LinkedIn-sida</a></p>
  </div>

  <div class="contact-card">
    <h3>Rapportera ett problem</h3>
    <p>Om du upptäcker ett tekniskt fel, en felkategoriserad artikel eller annat problem är du välkommen att rapportera det till <a href="https://www.linkedin.com/company/skime/" target="_blank" rel="noopener noreferrer">Skimes LinkedIn-sida</a></p>
  </div>

  <div class="contact-card">
    <h3>Upphovsrättsfrågor</h3>
    <p>Är du representant för ett medium och har frågor om hur Skime hanterar ditt innehåll? Kontakta oss på <a href="https://www.linkedin.com/company/skime/" target="_blank" rel="noopener noreferrer">Skimes LinkedIn-sida</a> så återkommer vi inom 48 timmar.</p>
  </div>

  <div class="divider"></div>

  <h2>Om Skime</h2>
  <p>Skime är en oberoende svensk nyhetstjänst. Läs mer på vår <a href="/om-oss">om-oss-sida</a>.</p>

  <footer>
    <p>© 2026 Skime · <a href="/om-oss">Om oss</a> · <a href="/integritetspolicy">Integritetspolicy</a></p>
  </footer>
</body>
</html>`);
});
app.get('/integritetspolicy', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Integritetspolicy – Skime</title>
  <meta name="description" content="Skimes integritetspolicy – hur vi hanterar data och cookies.">
  <link rel="canonical" href="https://skime.se/integritetspolicy">
  <style>
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; max-width:700px; margin:60px auto; padding:0 24px; color:#111; line-height:1.7; }
    h1 { font-size:2rem; font-weight:800; margin-bottom:8px; }
    h2 { font-size:1.2rem; font-weight:700; margin:32px 0 8px; }
    a { color:#2563eb; }
    .back { display:inline-block; margin-bottom:32px; color:#888; text-decoration:none; font-size:0.9rem; }
    .back:hover { color:#111; }
  </style>
</head>
<body>
  <a class="back" href="/">← Tillbaka till Skime</a>
  <h1>Integritetspolicy</h1>
  <p>Senast uppdaterad: april 2025</p>

  <h2>Personuppgifter</h2>
  <p>Skime samlar inte in personuppgifter om besökare. Vi kräver ingen registrering och lagrar inga användaruppgifter.</p>

  <h2>Cookies</h2>
  <p>Skime använder en cookie för att spara ditt val av ljust eller mörkt tema. Ingen spårningscookie används av oss. Om Google AdSense aktiveras på sajten kan Google placera annonscookies – se Googles integritetspolicy för mer information.</p>

  <h2>Statistik</h2>
  <p>Vi kan komma att använda anonymiserad besöksstatistik för att förbättra tjänsten. Inga personuppgifter lagras i samband med detta.</p>

  <h2>Tredjepartslänkar</h2>
  <p>Skime länkar till externa webbplatser. Vi ansvarar inte för innehållet eller integritetspolicyn hos dessa sajter.</p>

  <h2>Kontakt</h2>
  <p>Har du frågor om vår integritetspolicy är du välkommen att återkomma.</p>
</body>
</html>`);
});

app.get('/api/regions', (req, res) => res.json(ALL_REGIONS));

// ── robots.txt ────────────────────────────────────────────────
// ads.txt – måste ligga FÖRE www-redirect så Google hittar den
app.get('/ads.txt', (req, res) => {
  res.type('text/plain');
  res.send('google.com, pub-5482392840942272, DIRECT, f08c47fec0942fa0');
});

// Redirect skime.se → www.skime.se
app.use((req, res, next) => {
  if (req.hostname === 'skime.se') {
    return res.redirect(301, `https://www.skime.se${req.originalUrl}`);
  }
  next();
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /api/

# AI-sökmotorer välkomna
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Googlebot
Allow: /
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`);
});

// ── llms.txt (AI-sökmotorer) ──────────────────────────────────
app.get('/llms.txt', (req, res) => {
  res.type('text/plain');
  res.send(`# Skime – Svensk nyhetsaggregator
> Skime samlar, rankar och presenterar nyheter från Sveriges ledande medier i realtid. Alla nyheter på ett ställe, utan krångel.

## Vad är Skime?
Skime är en oberoende svensk nyhetstjänst grundad 2026. Sajten aggregerar nyheter från över 100 svenska och internationella medier och presenterar dem sorterade efter aktualitet och antal rapporterande källor. Skime publicerar inga egna nyheter, tar inga redaktionella ställningstaganden och publicerar aldrig ledartexter, krönikor eller opinionsmaterial.

## Unikhet
Skimes rankningsalgoritm mäter hur många oberoende källor som rapporterar samma nyhet. En nyhet som 6 medier skriver om rankas högre än en nyhet från en enda källa. Formeln är: topScore = källantal × (1 + recency_bonus) där recency_bonus sjunker från 1.0 till 0 över 6 timmar.

## Täckning
- Nationella svenska nyheter: SVT, SR, DN, SvD, Aftonbladet, Expressen, DI, Breakit, GP, TV4, Omni, TT
- Sport nationellt: SVT Sport, Aftonbladet Sport, Expressen Sport, Fotbollskanalen, Fotbolldirekt, Hockeysverige, Hockeyexpressen
- Sport lokalt: 14 lokala sportkällor
- Regionalt: Minst 2-3 lokala källor per region, täcker alla 21 svenska län
- Internationellt (engelska): BBC News, Reuters, The Guardian, AP News, Al Jazeera, New York Times
- Kultur: SvD Kultur, DN Kultur, Nöjesguiden, Fokus
- Google News-komplement för Valet 2026, Tech, VM 2026, Allsvenskan och SHL

## Kategorier
- nyheter: Riksnyheter från nationella källor, rankade efter källantal och aktualitet
- sport: Allsvenskan, SHL, VM 2026, Herrlandslaget – med egna underflöden per liga
- valet2026: Riksdagsvalet 2026, valrörelsen, partierna, partiledarna
- naringsliv: Ekonomi, börsen, företag, konjunktur (med separat Börs-underkategori)
- tech: AI, startups, cybersäkerhet, tekniknyheter
- utrikes: Internationella nyheter på svenska
- samhalle: Sjukvård, skola, brott, infrastruktur, bostäder
- kultur: Film, musik, konst, teater, litteratur
- english: Internationella nyheter på engelska från BBC, Reuters, Guardian, AP, Al Jazeera, NYT

## Sport-undermenyer
- Allsvenskan (herr fotboll Sverige)
- Herrlandslaget (svenska fotbollslandslaget)
- VM 2026 (fotbolls-VM i USA, Kanada, Mexiko)
- SHL (Swedish Hockey League)

## Regioner – alla 21 svenska län
Blekinge, Dalarna, Gotland, Gävleborg, Halland, Jämtland, Jönköping, Kalmar, Kronoberg, Norrbotten, Skåne, Stockholm, Södermanland, Uppsala, Värmland, Västerbotten, Västernorrland, Västmanland, Västra Götaland, Örebro, Östergötland

## Topic-sidor med FAQ
- ${SITE_URL}/topic/allsvenskan – Allsvenskan fotboll, matcher, tabeller
- ${SITE_URL}/topic/shl – SHL ishockey, SM-slutspel
- ${SITE_URL}/topic/vm-2026 – Fotbolls-VM 2026 i USA/Kanada/Mexiko
- ${SITE_URL}/topic/valet-2026 – Riksdagsvalet 2026, valrörelsen, opinionsundersökningar

## Rankningsmodell
Nyheter rankas med formeln: källantal × recency_bonus. Ju fler oberoende medier som rapporterar samma händelse, desto viktigare bedöms nyheten vara. Toppnyheter väljs från senaste 6 timmar.

## Filtrering
Skime filtrerar aktivt bort: ledartexter, krönikor, debattartiklar, opinionsmaterial, reklam, prenumerationserbjudanden, fastighetsaffärer och nyföretagsnyheter.

## Uppdateringsfrekvens
Nyheter hämtas automatiskt var 15:e minut, dygnet runt. Databasen rymmer artiklar från senaste 36 timmar.

## Teknisk information
- Byggd med: Node.js, Express, PostgreSQL, Railway
- API: GET ${SITE_URL}/api/news?category=nyheter
- API: GET ${SITE_URL}/api/news?region=Stockholm
- API: GET ${SITE_URL}/api/top-stories
- Sitemap: ${SITE_URL}/sitemap.xml

## Ägarskap och kontakt
Skime är en oberoende svensk nyhetstjänst. Domän: skime.se. Registrerad i Sverige 2026.
Kontakt: ${SITE_URL}/kontakt
LinkedIn: https://www.linkedin.com/company/skime/`);
});

// ── sitemap.xml ───────────────────────────────────────────────
app.get('/sitemap.xml', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const topics = await getTopics();
    const topicUrls = topics.map(t => ({ loc: `${SITE_URL}/topic/${slugify(t)}`, priority: '0.6' }));

    const staticUrls = [
      { loc: `${SITE_URL}`, priority: '1.0' },
      { loc: `${SITE_URL}/om-oss`, priority: '0.8' },
      { loc: `${SITE_URL}/kontakt`, priority: '0.7' },
      { loc: `${SITE_URL}/integritetspolicy`, priority: '0.5' },
      ...CATEGORIES.map(c => ({ loc: `${SITE_URL}/?category=${c}`, priority: '0.8' })),
      ...ALL_REGIONS.map(r => ({ loc: `${SITE_URL}/?region=${encodeURIComponent(r)}`, priority: '0.7' })),
      ...topicUrls,
    ];

    res.type('application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${now}</lastmod>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`);
  } catch(e) {
    res.status(500).send('Error generating sitemap');
  }
});

// ── SSR: Huvud-HTML med server-renderat innehåll för crawlers ─
app.get('/', async (req, res) => {
  try {
    await refreshIfStale();
    const articles = await get({ category: req.query.category, region: req.query.region });
    const category = req.query.category || 'alla';
    const region = req.query.region || '';

    // Bygg schema.org ItemList för AI-crawlers
    const schemaItems = articles.slice(0, 20).map((a, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'NewsArticle',
        headline: a.title,
        url: a.url,
        datePublished: a.published_at,
        publisher: { '@type': 'Organization', name: a.source },
        description: a.ingress || ''
      }
    }));

    const schema = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: region ? `Nyheter från ${region}` : `Svenska nyheter – ${category}`,
      itemListElement: schemaItems
    };

    // Server-renderade nyhetsrubriker för crawlers (dolt för användare)
    const ssrLinks = articles.slice(0, 30).map(a =>
      `<li><a href="${a.url}">${a.title}</a> <span>(${a.source})</span></li>`
    ).join('\n');

    const catDescriptions = {
      nyheter: 'Senaste riksnyheterna från SVT, DN, Aftonbladet, Expressen och fler – rankade efter hur många källor som rapporterar samma händelse.',
      sport: 'Senaste sportnyheter från Allsvenskan, SHL, VM 2026 och svenska landslaget – samlat från SVT Sport, Aftonbladet Sport och fler.',
      valet2026: 'Senaste nytt inför riksdagsvalet 2026 – valrörelsen, partierna, opinionsundersökningar och partiledardebatter.',
      naringsliv: 'Senaste ekonominyheter – börsen, kvartalsrapporter, företag och konjunktur från DI, SvD och fler.',
      tech: 'Senaste technyheter om AI, startups och cybersäkerhet från svenska och internationella medier.',
      utrikes: 'Senaste internationella nyheter på svenska – världspolitik, konflikter och globala händelser.',
      samhalle: 'Senaste samhällsnyheter – sjukvård, skola, brott, bostäder och infrastruktur från svenska medier.',
      kultur: 'Senaste kulturnyheter – film, musik, konst, teater och litteratur från DN Kultur, SvD Kultur och fler.',
      english: 'Latest international news in English – aggregated from BBC, Reuters, The Guardian, AP News, Al Jazeera and New York Times.',
    };

    const title = region
      ? `${region} nyheter – Skime`
      : category
        ? `${category.charAt(0).toUpperCase() + category.slice(1)} – Skime`
        : `Skime – Svenska nyheter samlat`;

    const description = region
      ? `Senaste nyheterna från ${region}. Aggregerat från lokala medier i realtid.`
      : catDescriptions[category] || 'Skime samlar 100+ svenska medier på ett ställe – uppdaterat var 15:e minut, helt gratis.';

    const html = await require('fs').promises.readFile(
      path.join(__dirname, '../public/index.html'), 'utf8'
    );

    // Injicera dynamisk meta + schema + SSR-innehåll
    const enriched = html
      .replace('<title>Skime – Svenska nyheter samlat</title>',
        `<title>${title}</title>`)
      .replace('<meta name="description" content="Snabb överblick över Sveriges nyheter från SVT, DN, Aftonbladet och fler – nationellt och regionalt.">',
        `<meta name="description" content="${description}">`)
      .replace('</head>',
        `<script type="application/ld+json">${JSON.stringify(schema)}</script>\n</head>`)
      .replace('<div id="news-grid"><div class="state"><div class="spinner"></div></div></div>',
        `<div id="news-grid"><div class="state"><div class="spinner"></div></div></div>
        <noscript><ul style="display:none">${ssrLinks}</ul></noscript>`);

    res.send(enriched);
  } catch(e) {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
});

// ── Start ─────────────────────────────────────────────────────
init().then(async () => {
  await fetchAll();
  app.listen(process.env.PORT || 8080, '0.0.0.0', () => console.log('Skime live'));
}).catch(console.error);
