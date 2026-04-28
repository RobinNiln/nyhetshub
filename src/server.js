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

const CATEGORIES = ['nyheter','politik','naringsliv','sport','tech','kultur','utrikes'];

// Hämta nyheter var 15:e minut automatiskt
cron.schedule('*/15 * * * *', fetchAll);

// ── API ───────────────────────────────────────────────────────
app.get('/api/news', async (req, res) => {
  try {
    const articles = await get({ category: req.query.category, region: req.query.region });
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
  <title>Om Skime – Vi sweper nyhetsinternet åt dig</title>
  <meta name="description" content="Skime är en oberoende svensk nyhetstjänst som aggregerar nyheter från SVT, DN, Aftonbladet och 40+ medier i realtid.">
  <link rel="canonical" href="https://skime.se/om-oss">
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
  <h1>Om Skime</h1>
  <p>Skime är en oberoende svensk nyhetstjänst som automatiskt samlar, rankar och presenterar nyheter från Sveriges ledande medier – nationellt och regionalt.</p>

  <h2>Vad vi gör</h2>
  <p>Vi sweper nyhetsinternet åt dig. Skime hämtar nyheter från över 40 svenska medier var 30:e minut och rankar dem efter hur många källor som rapporterar samma händelse. Ju fler medier som skriver om en nyhet, desto viktigare bedömer vi att den är.</p>

  <h2>Vad vi inte gör</h2>
  <p>Skime skapar inget eget redaktionellt innehåll. Vi är en aggregator – inte en redaktion. Allt innehåll tillhör respektive källa och publicist. Vi länkar alltid till originalkällan.</p>

  <h2>Källor</h2>
  <p>SVT, Sveriges Radio, DN, SvD, Aftonbladet, Expressen, DI, Breakit, Sydsvenskan, GP, HD, Borås Tidning, NT, Corren, MVT, Barometern, UNT, Norran, NSD, Norrbottens-Kuriren, Piteå-Tidningen, Eskilstuna-Kuriren, Södermanlands Nyheter, Strengnäs Tidning, Enköpings-Posten, Vimmerby Tidning, Västerviks-Tidningen, Gotlands Allehanda samt SVT:s lokala redaktioner i alla 21 län.</p>

  <h2>Kontakt</h2>
  <p>Frågor eller synpunkter? Hör av dig till <a href="mailto:hej@skime.se">hej@skime.se</a></p>
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
  <p>Frågor om vår integritetspolicy? Kontakta oss på <a href="mailto:hej@skime.se">hej@skime.se</a></p>
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
