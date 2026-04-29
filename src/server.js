const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { init, get, lastFetched } = require('./db');
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

const CATEGORIES = ['nyheter','politik','samhalle','naringsliv','sport','tech','kultur','utrikes'];

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

// Topic-sida – /topic/:slug
app.get('/topic/:slug', async (req, res) => {
  const slug = req.params.slug;
  const topics = await getTopics();
  const match = topics.find(t => slugify(t) === slug);
  const keyword = match || slug;

  try {
    const { Pool } = require('pg');
    const pool = new (require('pg').Pool)({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    const { rows } = await pool.query(`
      SELECT title, url, source, ingress, published_at, category
      FROM articles
      WHERE title ILIKE $1
      AND fetched_at > NOW() - INTERVAL '24 hours'
      ORDER BY published_at DESC
      LIMIT 60
    `, [`%${keyword}%`]);

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

    res.send(`<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>#${keyword} – Skime</title>
  <meta name="description" content="Senaste nyheterna om ${keyword} från svenska medier – samlat på Skime.">
  <link rel="canonical" href="https://www.skime.se/topic/${slug}">
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
    .meta{font-size:0.8rem;color:#888;margin-bottom:24px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px}
    .empty{text-align:center;padding:60px;color:#999}
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
  <h1>#${keyword}</h1>
  <p class="meta">${rows.length} nyheter de senaste 24 timmarna</p>
  ${rows.length ? `<div class="grid">${cards}</div>` : '<div class="empty">Inga nyheter hittades om detta ämne just nu.</div>'}
  <p style="margin-top:32px;font-size:0.8rem;color:#999"><a href="/" style="color:#2563eb">← Tillbaka till Skime</a></p>
</div>
</body>
</html>`);
  } catch(e) {
    res.status(500).send('Fel vid hämtning av artiklar.');
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
  <title>Vad är Skime? – Vi sweper nyhetsinternet åt dig</title>
  <meta name="description" content="Skime samlar de senaste nyheterna från över 40 svenska medier – utan prerolls, utan inloggning, utan krångel.">
  <link rel="canonical" href="https://www.skime.se/om-oss">
  <style>
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; max-width:700px; margin:60px auto; padding:0 24px; color:#111; line-height:1.8; }
    h1 { font-size:2.2rem; font-weight:800; margin-bottom:12px; letter-spacing:-1px; }
    h2 { font-size:1.15rem; font-weight:700; margin:40px 0 8px; color:#111; }
    p { margin-bottom:16px; color:#333; font-size:1rem; }
    .lead { font-size:1.15rem; color:#444; margin-bottom:32px; }
    .highlight { background:#f0f5ff; border-left:3px solid #2563eb; padding:16px 20px; border-radius:4px; margin:32px 0; }
    .highlight p { margin:0; color:#1e3a8a; font-weight:500; }
    a { color:#2563eb; }
    .back { display:inline-block; margin-bottom:32px; color:#888; text-decoration:none; font-size:0.9rem; }
    .back:hover { color:#111; }
    footer { margin-top:60px; padding-top:24px; border-top:1px solid #e5e5e5; font-size:0.8rem; color:#aaa; }
  </style>
</head>
<body>
  <a class="back" href="/">← Tillbaka till Skime</a>
  <h1>Vad är Skime?</h1>
  <p class="lead">Skime är en svensk nyhetstjänst som samlar det senaste från landets ledande medier – på ett ställe, utan krångel.</p>

  <div class="highlight">
    <p>Vi sweper nyhetsinternet åt dig. Du behöver inte göra det.</p>
  </div>

  <h2>Enkelt, snabbt, rent</h2>
  <p>Vi tror att nyheter ska vara lätta att ta till sig. Ingen ska behöva klicka sig igenom prerolls, sitta och vänta på att en video ska laddas eller stöta på pop-ups som kräver att man stänger tre fönster innan man ens sett rubriken. Skime visar rubriken, en kort ingress och var du kan läsa mer. Sedan är det upp till dig.</p>

  <h2>Samlat från de bästa källorna</h2>
  <p>Vi hämtar nyheter var 15:e minut från över 40 svenska medier – nationella som SVT, SR, DN, SvD, Aftonbladet, Expressen och DI, men också lokala tidningar från alla 21 svenska län. En nyhet som rapporteras av många källor lyfts automatiskt fram. Det är vår enkla modell för att avgöra vad som är viktigt just nu.</p>

  <h2>Inga egna åsikter</h2>
  <p>Skime är inte en redaktion. Vi skriver inga egna nyheter, tar inga politiska ställningstaganden och har inga egna agendor. Vi är ett fönster mot det svenska medielandskapet – inte en röst i det.</p>

  <h2>Inga ledare, alltid objektivt</h2>
  <p>Skime plockar aldrig in ledartexter eller opinionsmaterial. Vi visar nyheter – inte åsikter. Det är ett aktivt val vi gör för att hålla sajten så objektiv som möjligt och låta dig bilda din egen uppfattning.</p>

  <h2>Inga ledare eller krönikor</h2>
  <p>Vi plockar aldrig in ledartexter, krönikor, debattartiklar eller opinionsmaterial. Det är ett medvetet val för objektivitetens skull. Skime ska spegla vad som händer – inte vad någon tycker om det.</p>

  <h2>En sak vi inte kan styra</h2>
  <p>Vissa artiklar hos källorna ligger bakom betalväggar eller kräver prenumeration. Det är källornas beslut, inte vårt. Vi visar alltid vem som är källan så att du vet vad du klickar på.</p>

  <h2>Gratis, alltid</h2>
  <p>Skime är gratis att använda. Det finns inga konton, inga prenumerationer och ingen data vi samlar in om dig för att sälja vidare. Sajten finansieras av annonser.</p>

  <footer>
    <p>© 2025 Skime · <a href="/integritetspolicy">Integritetspolicy</a></p>
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
app.get('/ads.txt', (req, res) => {
  res.type('text/plain');
  res.send('google.com, pub-5482392840942272, DIRECT, f08c47fec0942fa0');
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml`);
});

// ── llms.txt (AI-sökmotorer) ──────────────────────────────────
app.get('/llms.txt', (req, res) => {
  res.type('text/plain');
  res.send(`# Skime

> Skime aggregerar och rankar nyheter från Sveriges ledande medier i realtid.

## Vad är Skime?
Skime är en svensk nyhetstjänst som samlar nyheter från SVT, SR, DN, SvD, Aftonbladet, Expressen, DI och ett 40-tal regionala tidningar. Nyheter rankas efter hur många källor som rapporterar samma händelse.

## Kategorier
- Nationella nyheter: inrikes, utrikes, politik, näringsliv, sport, tech, kultur
- Regionala nyheter: alla 21 svenska län

## Källor
SVT, SR, DN, SvD, Aftonbladet, Expressen, DI, Breakit, Sydsvenskan, GP, Corren, NT, Barometern, UNT och fler.

## Uppdateringsfrekvens
Nyheter uppdateras var 30:e minut automatiskt.

## API
GET ${SITE_URL}/api/news?category=nyheter
GET ${SITE_URL}/api/news?region=Stockholm
GET ${SITE_URL}/api/regions`);
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

    const title = region
      ? `${region} nyheter – Skime`
      : `Skime – Svenska nyheter samlat`;

    const description = region
      ? `Senaste nyheterna från ${region}. Aggregerat från lokala medier i realtid.`
      : `Snabb överblick över Sveriges nyheter från SVT, DN, Aftonbladet och 40+ medier – nationellt och regionalt.`;

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
