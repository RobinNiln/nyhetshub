const express = require('express');
const cors = require('cors');
const path = require('path');
const { init, get, lastFetched } = require('./db');
const { fetchAll } = require('./fetcher');

const app = express();
app.use(cors());
app.use(express.static('public'));

const SITE_URL = process.env.SITE_URL || 'https://nyhetshub.se';

const ALL_REGIONS = [
  'Blekinge','Dalarna','Gotland','Gävleborg','Halland',
  'Jämtland','Jönköping','Kalmar','Kronoberg','Norrbotten',
  'Skåne','Stockholm','Södermanland','Uppsala','Värmland',
  'Västerbotten','Västernorrland','Västmanland','Västra Götaland',
  'Örebro','Östergötland'
];

const CATEGORIES = ['nyheter','politik','naringsliv','sport','tech','kultur','utrikes'];

let fetching = false;

async function refreshIfStale() {
  if (fetching) return;
  const last = await lastFetched();
  if (!last || (Date.now() - new Date(last)) > 30 * 60 * 1000) {
    fetching = true;
    fetchAll().finally(() => { fetching = false; });
  }
}

// ── API ───────────────────────────────────────────────────────
app.get('/api/news', async (req, res) => {
  try {
    await refreshIfStale();
    const articles = await get({ category: req.query.category, region: req.query.region });
    res.json(articles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/regions', (req, res) => res.json(ALL_REGIONS));

// ── robots.txt ────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml`);
});

// ── llms.txt (AI-sökmotorer) ──────────────────────────────────
app.get('/llms.txt', (req, res) => {
  res.type('text/plain');
  res.send(`# NyhetsHub

> NyhetsHub aggregerar och rankar nyheter från Sveriges ledande medier i realtid.

## Vad är NyhetsHub?
NyhetsHub är en svensk nyhetstjänst som samlar nyheter från SVT, SR, DN, SvD, Aftonbladet, Expressen, DI och ett 40-tal regionala tidningar. Nyheter rankas efter hur många källor som rapporterar samma händelse.

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
    const articles = await get({});
    const now = new Date().toISOString();

    const staticUrls = [
      { loc: SITE_URL, priority: '1.0' },
      ...CATEGORIES.map(c => ({ loc: `${SITE_URL}/?category=${c}`, priority: '0.8' })),
      ...ALL_REGIONS.map(r => ({ loc: `${SITE_URL}/?region=${encodeURIComponent(r)}`, priority: '0.7' })),
    ];

    const articleUrls = articles.slice(0, 100).map(a => ({
      loc: a.url,
      lastmod: a.published_at ? new Date(a.published_at).toISOString() : now,
      priority: '0.6'
    }));

    const allUrls = [...staticUrls, ...articleUrls];

    res.type('application/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(u => `  <url>
    <loc>${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : `<lastmod>${now}</lastmod>`}
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
      ? `${region} nyheter – NyhetsHub`
      : `NyhetsHub – Svenska nyheter samlat`;

    const description = region
      ? `Senaste nyheterna från ${region}. Aggregerat från lokala medier i realtid.`
      : `Snabb överblick över Sveriges nyheter från SVT, DN, Aftonbladet och 40+ medier – nationellt och regionalt.`;

    const html = await require('fs').promises.readFile(
      path.join(__dirname, '../public/index.html'), 'utf8'
    );

    // Injicera dynamisk meta + schema + SSR-innehåll
    const enriched = html
      .replace('<title>NyhetsHub – Svenska nyheter samlat</title>',
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
  app.listen(process.env.PORT || 8080, '0.0.0.0', () => console.log('NyhetsHub live'));
}).catch(console.error);
