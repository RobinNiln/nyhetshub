const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { pool, init, get, lastFetched, getTopStories, getTodaysBrief, hasBriefToday, cleanup } = require('./db');
const { fetchAll, SOURCES, recategorizeRecent } = require('./fetcher');
const { generateBrief } = require('./brief');
const briefsidor = require('./briefsidor');
const nyhetsbrev = require('./nyhetsbrev');
const statistik = require('./statistik');
const hett = require('./hett');
const trafik = require('./trafik');

const app = express();
app.use(cors());

// Sajtens adress. Bara www.skime.se fungerar (skime.se utan www ger fel hos domänleverantören),
// så om variabeln SITE_URL på Railway saknar www läggs det till här automatiskt.
const SITE_URL = (process.env.SITE_URL || 'https://www.skime.se')
  .replace(/\/+$/, '')
  .replace(/^https?:\/\/skime\.se$/i, 'https://www.skime.se');

// Antal unika RSS-flöden – räknas från källistan så siffran alltid stämmer
const SOURCE_COUNT = new Set(Object.values(SOURCES).flat().map(s => s.url)).size;

// Gör text säker att stoppa in i HTML. Rubriker kommer från andra sajter,
// och utan detta kan en rubrik med < eller " förstöra sidan (eller köra skript).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Släpp bara igenom vanliga webblänkar (http/https), aldrig t.ex. javascript:-länkar
function safeUrl(u) {
  return /^https?:\/\//i.test(u || '') ? esc(u) : '#';
}

// ads.txt – måste ligga FÖRE www-redirect så Google hittar den
app.get('/ads.txt', (req, res) => {
  res.type('text/plain');
  res.send('google.com, pub-5482392840942272, DIRECT, f08c47fec0942fa0');
});

// Redirect skime.se → www.skime.se (måste ligga före allt annat)
app.use((req, res, next) => {
  if (req.hostname === 'skime.se') {
    return res.redirect(301, `https://www.skime.se${req.originalUrl}`);
  }
  next();
});

// Statiska filer (bilder, favicon m.m.). index: false betyder att
// startsidan INTE skickas härifrån – den byggs av '/'-routen längre ner,
// så att varje kategori får egen titel, beskrivning och innehåll för Google.
app.use(express.static('public', { index: false }));

const ALL_REGIONS = [
  'Blekinge','Dalarna','Gotland','Gävleborg','Halland',
  'Jämtland','Jönköping','Kalmar','Kronoberg','Norrbotten',
  'Skåne','Stockholm','Södermanland','Uppsala','Värmland',
  'Västerbotten','Västernorrland','Västmanland','Västra Götaland',
  'Örebro','Östergötland'
];

// Regionsidor får rena adresser: Västra Götaland → /nyheter/vastra-gotaland
function regionSlug(r) {
  return r.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/\s+/g, '-').replace(/[^a-z-]/g, '');
}
const REGION_BY_SLUG = Object.fromEntries(ALL_REGIONS.map(r => [regionSlug(r), r]));

const CATEGORIES = ['nyheter','valet2026','samhalle','naringsliv','sport','tech','kultur','kronikor','utrikes','english'];

// Hämta nyheter var 15:e minut automatiskt
cron.schedule('*/15 * * * *', fetchAll);

// Morgonbrief 06:00 svensk tid
cron.schedule('0 6 * * *', () => generateBrief('morning'), { timezone: 'Europe/Stockholm' });

// Kvällsbrief 17:00 svensk tid
cron.schedule('0 17 * * *', () => generateBrief('evening'), { timezone: 'Europe/Stockholm' });

// Nyhetsbrevet: morgonbriefen mejlas 06:30. 07:30 är en reserv om briefen blev sen
// (utskicksloggen i databasen gör att ingen får mejlet två gånger).
cron.schedule('30 6 * * *', () => nyhetsbrev.skickaMorgonbrief(SITE_URL).catch(e => console.error('Nyhetsbrev:', e.message)), { timezone: 'Europe/Stockholm' });
cron.schedule('30 7 * * *', () => nyhetsbrev.skickaMorgonbrief(SITE_URL).catch(e => console.error('Nyhetsbrev:', e.message)), { timezone: 'Europe/Stockholm' });

// Städa bort gamla artiklar och klick 04:00 varje natt
cron.schedule('0 4 * * *', () => cleanup().catch(e => console.error('Städning:', e.message)), { timezone: 'Europe/Stockholm' });

// Trigga fetchAll om senaste hämtning är äldre än 15 min
async function refreshIfStale() {
  try {
    const last = await lastFetched();
    if (!last || Date.now() - new Date(last).getTime() > 15 * 60 * 1000) {
      await fetchAll();
    }
  } catch(e) { console.error('refreshIfStale:', e.message); }
}

// ── API ───────────────────────────────────────────────────────
// Klick-tracking – spara när någon klickar på en artikel
app.post('/api/click', express.json(), async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string' || url.length > 2000) return res.status(400).json({ error: 'Missing url' });
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
  'valet-2026': {
    title: 'Valet 2026',
    keywords: ['valet 2026','riksdagsvalet','kommunalvalet','regionvalet','partiledardebatt','valrörelsen','valresultat','opinionsundersökning','väljarstöd','valmanifest','valanalys','valets'],
    desc: 'Nyheter och analyser inför riksdagsvalet 2026.'
  }
};

// Permanenta omdirigeringar för borttagna sidor.
// Behåller länkvärde i Google och undviker 404 för besökare med gamla länkar.
const GONE_TOPICS = {
  'vm-2026': '/?category=sport',
};

// Topic-sida – /topic/:slug
app.get('/topic/:slug', async (req, res) => {
  const slug = req.params.slug;

  if (GONE_TOPICS[slug]) {
    return res.redirect(301, GONE_TOPICS[slug]);
  }

  // Bara små bokstäver, siffror och bindestreck – allt annat är skräp eller attackförsök
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) {
    return res.status(404).send('Sidan finns inte.');
  }

  // Kolla fasta topics först
  const fixed = FIXED_TOPICS[slug];
  const topics = await getTopics();
  const match = topics.find(t => slugify(t) === slug);
  const keyword = fixed ? null : (match || slug);
  const pageTitle = fixed ? fixed.title : (match || slug.charAt(0).toUpperCase() + slug.slice(1));
  const pageDesc = fixed ? fixed.desc : `Senaste nyheterna om ${pageTitle} från svenska medier.`;

  try {
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
        <a href="${safeUrl(a.url)}" target="_blank" rel="noopener noreferrer" style="color:#111;text-decoration:none;font-size:0.9rem;font-weight:600;line-height:1.5;">${esc(a.title)}</a>
        ${a.ingress ? `<p style="font-size:0.8rem;color:#555;margin:0;line-height:1.45;">${esc(a.ingress)}</p>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.68rem;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.5px;">${esc(a.source)}</span>
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
${trafik.vyScript('amne:' + slug)}
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
    res.json({ articles_last_hour: lastHour, intensity, sources: SOURCE_COUNT });
  } catch(e) {
    res.json({ articles_last_hour: 80, intensity: 50, sources: SOURCE_COUNT });
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

// Gamla om-sidan ersatt av /om. 301 = permanent flytt, så Google för över länkvärdet.
app.get('/om-oss', (req, res) => res.redirect(301, '/om'));

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
  <p>Skime är en oberoende svensk nyhetstjänst. Läs mer på vår <a href="/om">om-oss-sida</a>.</p>

  <footer>
    <p>© 2026 Skime · <a href="/om">Om oss</a> · <a href="/integritet">Integritetspolicy</a></p>
  </footer>
</body>
</html>`);
});
// Gamla integritetspolicyn ersatt av /integritet (den nya, korrekta versionen)
app.get('/integritetspolicy', (req, res) => res.redirect(301, '/integritet'));

app.get('/api/regions', (req, res) => res.json(ALL_REGIONS));

// Dagens morgonbrief
app.get('/api/brief', async (req, res) => {
  try {
    const brief = await getTodaysBrief();
    if (brief && brief.d) brief.url = briefsidor.briefPath(brief);
    res.json(brief || {});
  } catch(e) {
    res.status(500).json({ error: 'Kunde inte hämta brief' });
  }
});

// ── Nya juridiska sidor (separata HTML-filer i /public) ─────────
const sendStatic = (file) => (req, res) => res.sendFile(path.join(__dirname, '../public/' + file));
app.get('/om',         sendStatic('om.html'));
app.get('/integritet', sendStatic('integritet.html'));
app.get('/cookies',    sendStatic('cookies.html'));
app.get('/villkor',    sendStatic('villkor.html'));

// ── robots.txt ────────────────────────────────────────────────

app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /api/
Disallow: /statistik
Disallow: /nyhetsbrev/

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
app.get('/llms.txt', async (req, res) => {
  res.type('text/plain');
  // Hämta dagens brief om den finns
  let briefBlock = '';
  try {
    const brief = await getTodaysBrief();
    if (brief && brief.content) {
      const label = brief.brief_type === 'evening' ? 'Kvällsbrief' : 'Morgonbrief';
      briefBlock = `\n## Dagens nyhetssammanfattning (${label})\n${brief.content}\n`;
    }
  } catch(e) {}

  res.send(`# Skime – Svensk nyhetsaggregator
> Skime samlar, rankar och presenterar nyheter från Sveriges ledande medier i realtid. Alla nyheter på ett ställe, utan krångel.

## Vad är Skime?
Skime är en oberoende svensk nyhetstjänst grundad 2026. Sajten aggregerar nyheter från över 100 svenska och internationella medier (${SOURCE_COUNT} nyhetsflöden) och presenterar dem sorterade efter aktualitet och antal rapporterande källor. Skime publicerar inga egna nyheter och tar inga redaktionella ställningstaganden. Varje dag publiceras dock en automatiskt genererad nyhetssammanfattning (morgon- och kvällsbrief) som ger en neutral överblick av nyhetsläget.
${briefBlock}
## Unikhet
Skimes rankningsalgoritm mäter hur många oberoende källor som rapporterar samma nyhet. En nyhet som flera medier skriver om rankas högre än en nyhet från en enda källa. Tunga riksmedier (SVT, SR, DN, SvD, Aftonbladet, Expressen, TV4, DI) väger dubbelt. Uppföljande artiklar inom 3 timmar ger ytterligare rankningsbonus.

## Täckning
- Nationella svenska nyheter: SVT, SR (Ekot), DN, SvD, Aftonbladet, Expressen, DI, TV4
- Sport nationellt: SVT Sport, Aftonbladet Sport, Expressen Sport, DN Sport, Fotbolldirekt, Hockeysverige
- Sport lokalt: 14 lokala sportkällor
- Regionalt: Minst 2-3 lokala källor per region, täcker alla 21 svenska län
- Internationellt (engelska): BBC News, BBC Europe, The Guardian, Al Jazeera, New York Times
- Kultur: SvD Kultur, DN Kultur, Aftonbladet Kultur
- Krönikor och recensioner: samlas i egen kategori, separerade från nyhetsflödet

## Kategorier
- nyheter: Riksnyheter från nationella källor, rankade efter källantal och aktualitet
- sport: Allsvenskan, SHL, Herrlandslaget – med egna underflöden per liga
- valet2026: Riksdagsvalet 2026, valrörelsen, partierna, partiledarna
- naringsliv: Ekonomi, börsen, företag, konjunktur (med separat Börs-underkategori)
- tech: AI, startups, cybersäkerhet, tekniknyheter
- utrikes: Internationella nyheter på svenska
- samhalle: Sjukvård, skola, brott, infrastruktur, bostäder
- kultur: Film, musik, konst, teater, litteratur
- kronikor: Krönikor, kolumner och recensioner från svenska medier
- english: Internationella nyheter på engelska

## Sport-undermenyer
- Allsvenskan (herr fotboll Sverige)
- Herrlandslaget (svenska fotbollslandslaget)
- SHL (Swedish Hockey League)

## Regioner – alla 21 svenska län
Blekinge, Dalarna, Gotland, Gävleborg, Halland, Jämtland, Jönköping, Kalmar, Kronoberg, Norrbotten, Skåne, Stockholm, Södermanland, Uppsala, Värmland, Västerbotten, Västernorrland, Västmanland, Västra Götaland, Örebro, Östergötland

## Topic-sidor med FAQ
- ${SITE_URL}/topic/allsvenskan – Allsvenskan fotboll, matcher, tabeller
- ${SITE_URL}/topic/shl – SHL ishockey, SM-slutspel
- ${SITE_URL}/topic/valet-2026 – Riksdagsvalet 2026, valrörelsen, opinionsundersökningar

## Rankningsmodell
Nyheter rankas med formeln: viktat källantal × (1 + recency_bonus) + uppföljarbonus. Ju fler oberoende medier som rapporterar samma händelse, desto viktigare bedöms nyheten. Toppnyheter väljs från senaste 6 timmar.

## Filtrering
Skime separerar krönikor, kolumner och recensioner till en egen kategori, och filtrerar bort ledartexter, debattartiklar, opinionsmaterial, reklam, prenumerationserbjudanden, podcasts och videoklipp från nyhetsflödet. Politiskt färgad partipress och fackliga tidningar inkluderas inte.

## Uppdateringsfrekvens
Nyheter hämtas automatiskt var 15:e minut, dygnet runt. Nyhetssammanfattningar (briefer) genereras 06:00 och 17:00 svensk tid.

## Teknisk information
- API: GET ${SITE_URL}/api/news?category=nyheter
- API: GET ${SITE_URL}/api/news?region=Stockholm
- API: GET ${SITE_URL}/api/top-stories
- API: GET ${SITE_URL}/api/brief (dagens nyhetssammanfattning)
- Briefarkiv: ${SITE_URL}/brief (alla morgon- och kvällsbriefer, RSS: ${SITE_URL}/brief/rss.xml)
- Regionsidor: ${SITE_URL}/nyheter/skane, ${SITE_URL}/nyheter/stockholm osv.
- Sitemap: ${SITE_URL}/sitemap.xml

## Ägarskap och kontakt
Skime är en oberoende svensk nyhetstjänst. Domän: skime.se. Registrerad i Sverige 2026.
Om Skime: ${SITE_URL}/om
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
      { loc: `${SITE_URL}/om`, priority: '0.8' },
      { loc: `${SITE_URL}/kontakt`, priority: '0.7' },
      { loc: `${SITE_URL}/integritet`, priority: '0.5' },
      { loc: `${SITE_URL}/cookies`, priority: '0.3' },
      { loc: `${SITE_URL}/villkor`, priority: '0.3' },
      { loc: `${SITE_URL}/topic/allsvenskan`, priority: '0.7' },
      { loc: `${SITE_URL}/topic/shl`, priority: '0.7' },
      { loc: `${SITE_URL}/topic/valet-2026`, priority: '0.7' },
      ...CATEGORIES.map(c => ({ loc: `${SITE_URL}/?category=${c}`, priority: '0.8' })),
      ...ALL_REGIONS.map(r => ({ loc: `${SITE_URL}/nyheter/${regionSlug(r)}`, priority: '0.8' })),
      { loc: `${SITE_URL}/brief`, priority: '0.8' },
      { loc: `${SITE_URL}/nyhetsbrev`, priority: '0.7' },
      ...topicUrls,
    ];
    // Varje brief de senaste 60 dagarna – Skimes egna, unika texter
    try {
      const briefs = await briefsidor.listBriefs(120);
      for (const b of briefs) staticUrls.push({ loc: SITE_URL + briefsidor.briefPath(b), priority: '0.6' });
    } catch(e) {}

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
// Varje kategori (/?category=sport) och region (/?region=Skåne) får egen
// titel, beskrivning, canonical-länk och rubriklista. Det är det Google ser.

const CAT_NAMES = {
  nyheter: 'Nyheter', valet2026: 'Valet 2026', samhalle: 'Samhälle', naringsliv: 'Näringsliv',
  sport: 'Sport', tech: 'Tech', kultur: 'Kultur', kronikor: 'Krönikor', utrikes: 'Utrikes',
  english: 'International news in English'
};

const CAT_DESCRIPTIONS = {
  nyheter: 'Senaste riksnyheterna från SVT, DN, Aftonbladet, Expressen och fler – rankade efter hur många källor som rapporterar samma händelse.',
  sport: 'Senaste sportnyheter från Allsvenskan, SHL och svenska landslaget – samlat från SVT Sport, Aftonbladet Sport och fler.',
  valet2026: 'Senaste nytt om riksdagsvalet 2026 – partierna, regeringsfrågan, opinionen och valresultatet.',
  naringsliv: 'Senaste ekonominyheter – börsen, kvartalsrapporter, företag och konjunktur från DI, SvD och fler.',
  tech: 'Senaste technyheter om AI, startups och cybersäkerhet från svenska och internationella medier.',
  utrikes: 'Senaste internationella nyheter på svenska – världspolitik, konflikter och globala händelser.',
  samhalle: 'Senaste samhällsnyheter – sjukvård, skola, brott, bostäder och infrastruktur från svenska medier.',
  kultur: 'Senaste kulturnyheter – film, musik, konst, teater och litteratur från DN Kultur, SvD Kultur och fler.',
  kronikor: 'Krönikor, kolumner och recensioner från svenska medier – samlat på ett ställe.',
  english: 'Latest international news in English – aggregated from BBC, The Guardian, Al Jazeera and New York Times.',
};

// index.html läses in en gång och sparas i minnet (snabbare än att läsa filen varje gång)
let indexHtmlCache = null;
async function readIndexHtml() {
  if (!indexHtmlCache) {
    indexHtmlCache = await require('fs').promises.readFile(path.join(__dirname, '../public/index.html'), 'utf8');
  }
  return indexHtmlCache;
}

// Vilka källor som bevakar varje region (visas i regionsidornas ingress)
const REGION_SOURCES = {};
for (const s of SOURCES.regional) {
  (REGION_SOURCES[s.region] = REGION_SOURCES[s.region] || []).push(s.name);
}
const REGION_INFO = Object.fromEntries(ALL_REGIONS.map(r =>
  [r, { slug: regionSlug(r), sources: REGION_SOURCES[r] || [] }]));

function regionIngress(region) {
  const src = REGION_SOURCES[region] || [];
  const lista = src.length > 1 ? src.slice(0, -1).join(', ') + ' och ' + src[src.length - 1] : (src[0] || 'lokala medier');
  return `Senaste nyheterna från ${region}, samlade från ${lista}. Uppdateras var 15:e minut.`;
}

// Gamla regionlänkar (/?region=Skåne) flyttas permanent till /nyheter/skane
app.get('/', (req, res, next) => {
  if (req.query.region && ALL_REGIONS.includes(req.query.region)) {
    return res.redirect(301, `/nyheter/${regionSlug(req.query.region)}`);
  }
  next();
});

app.get('/', (req, res) => {
  // Godkänn bara kända värden. Allt annat ignoreras (skyddar mot skräp i URL:en).
  const category = CATEGORIES.includes(req.query.category) ? req.query.category : '';
  renderStart(req, res, { category, region: '' });
});

app.get('/nyheter/:slug', (req, res) => {
  const region = REGION_BY_SLUG[req.params.slug];
  if (!region) return res.status(404).send('Regionen finns inte.');
  renderStart(req, res, { category: '', region });
});

async function renderStart(req, res, { category, region }) {
  try {
    // Hämta nya nyheter i bakgrunden om det behövs – men låt INTE besökaren vänta på det
    refreshIfStale();

    const articles = await get({ category: category || 'nyheter', region: region || undefined });

    let title, description, canonical;
    if (region) {
      title = `Nyheter ${region} – senaste nytt från lokala medier | Skime`;
      description = regionIngress(region);
      canonical = `${SITE_URL}/nyheter/${regionSlug(region)}`;
    } else if (category) {
      title = `${CAT_NAMES[category]} – senaste nytt | Skime`;
      description = CAT_DESCRIPTIONS[category];
      canonical = `${SITE_URL}/?category=${category}`;
    } else {
      title = null; // behåll titeln som står i index.html
      description = null;
      canonical = `${SITE_URL}/`;
    }

    // schema.org ItemList för Google och AI-crawlers
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: region ? `Nyheter från ${region}` : `Svenska nyheter – ${CAT_NAMES[category] || 'Nyheter'}`,
      itemListElement: articles.slice(0, 20).map((a, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'NewsArticle',
          headline: a.title,
          url: a.url,
          datePublished: a.published_at,
          dateModified: a.published_at,
          mainEntityOfPage: { '@type': 'WebPage', '@id': a.url },
          publisher: { '@type': 'Organization', name: a.source },
          description: a.ingress || a.title,
          ...(a.sources && a.sources.length > 1 ? { isBasedOn: a.sources.map(s => s.url) } : {})
        }
      }))
    };

    // Dagens brief (bara på startsidan / Nyheter)
    let briefSchema = '';
    let briefSsr = '';
    if (!region && (!category || category === 'nyheter')) {
      try {
        const brief = await getTodaysBrief();
        if (brief && brief.content) {
          const label = brief.brief_type === 'evening' ? 'Skimes kvällsbrief' : 'Skimes morgonbrief';
          briefSchema = `<script type="application/ld+json">${jsonForScript({
            '@context': 'https://schema.org',
            '@type': 'NewsArticle',
            headline: label + ' – ' + new Date(brief.brief_date).toLocaleDateString('sv-SE'),
            articleBody: briefPlain(brief.content),
            datePublished: brief.generated_at || brief.brief_date,
            author: { '@type': 'Organization', name: 'Skime' },
            publisher: { '@type': 'Organization', name: 'Skime', url: SITE_URL }
          })}</script>`;
          briefSsr = `<section aria-label="Dagens nyhetssammanfattning"><h2>${label}</h2><p>${esc(briefPlain(brief.content))}</p></section>`;
        }
      } catch(e) {}
    }

    // Rubriklista för besökare/crawlers utan JavaScript
    const ssrLinks = articles.slice(0, 30).map(a =>
      `<li><a href="${safeUrl(a.url)}">${esc(a.title)}</a> <span>(${esc(a.source)})</span></li>`
    ).join('\n');

    let html = await readIndexHtml();
    if (title) {
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
        .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`);
    }
    if (description) {
      html = html
        .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`)
        .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(description)}">`);
    }
    html = html
      .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(canonical)}">`)
      .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(canonical)}">`)
      .replace('</head>', `<script type="application/ld+json">${jsonForScript(schema)}</script>\n${briefSchema}\n<script>window.SKIME_REGIONER = ${jsonForScript(REGION_INFO)};</script>\n</head>`)
      .replace('<!--NYHETSBREV-->', nyhetsbrev.anmalningsruta())
      .replace('<div id="page-intro" hidden></div>', region
        ? `<div id="page-intro"><h1>Nyheter från ${esc(region)}</h1><p>${esc(regionIngress(region))}</p></div>`
        : '<div id="page-intro" hidden></div>')
      .replace('<div id="news-grid" aria-label="Nyheter"><div class="state"><div class="spinner"></div></div></div>',
        `<div id="news-grid" aria-label="Nyheter"><div class="state"><div class="spinner"></div></div></div>
    <noscript>${briefSsr}<ul>${ssrLinks}</ul></noscript>`);

    res.send(html);
  } catch(e) {
    console.error('Startsida:', e.message);
    res.sendFile(path.join(__dirname, '../public/index.html'));
  }
}

// Briefsidor: /brief, /brief/rss.xml, /brief/2026-11-19/morgon
briefsidor.register(app, { siteUrl: SITE_URL });

// Nyhetsbrev: /api/prenumerera, /nyhetsbrev, /nyhetsbrev/bekrafta, /nyhetsbrev/avsluta
nyhetsbrev.register(app, { siteUrl: SITE_URL });

// Statistik: /statistik (skyddad med STATS_KEY)
statistik.register(app);

// Hett just nu: /api/hett. Trafikmätning: /api/vy
hett.register(app);
trafik.register(app);

// Briefen sparas med länkar i formatet [ord](url). För Googles strukturerade
// data och utan-JavaScript-versionen vill vi ha ren text.
function briefPlain(s) {
  return String(s || '').replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1');
}

// JSON inuti <script>-taggar: "</script>" i en rubrik får inte avsluta taggen i förtid
function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

// ── Start ─────────────────────────────────────────────────────
// Webbservern startar FÖRST, oberoende av databasen. Om Postgres är nere
// svarar sajten ändå (utan artiklar) i stället för att aldrig starta alls.
app.listen(process.env.PORT || 8080, '0.0.0.0', () => console.log('Skime live'));

// Databas, hämtning och brief körs efter — fel här får inte fälla processen.
init().then(async () => {
  await nyhetsbrev.initNyhetsbrev().catch(e => console.error('Nyhetsbrev init:', e.message));
  await trafik.initTrafik().catch(e => console.error('Trafik init:', e.message));
  await recategorizeRecent().catch(e => console.error('Omsortering:', e.message));
  await fetchAll();
  // Generera saknad brief vid uppstart:
  // Klockan ≥17 → kvällsbrief om saknas, annars morgonbrief om saknas
  const hourSE = parseInt(new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', hour12: false }));
  const wantType = hourSE >= 17 ? 'evening' : 'morning';
  const exists = await hasBriefToday(wantType);
  if (!exists) generateBrief(wantType).catch(e => console.error('Initial brief:', e.message));
}).catch(e => console.error('Uppstart (db/fetch):', e.message));

// Sista skyddsnätet: en oväntad databaskrasch ska logga, inte döda servern.
process.on('unhandledRejection', e => console.error('Ohanterat fel:', e && e.message));
