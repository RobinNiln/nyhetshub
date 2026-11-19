// briefsidor.js – egna sidor för varje morgon- och kvällsbrief.
//
//   /brief                       arkiv med de senaste briefarna
//   /brief/2026-11-19/morgon     en enskild brief (delbar länk, egen sida i Google)
//   /brief/rss.xml               RSS-flöde med briefarna (för nyhetsbrev och RSS-läsare)
//
// Briefen är Skimes enda egna text. Med en egen sida per brief får Google
// unikt innehåll varje dag, och varje brief får en länk som går att dela.

const { getBrief, listBriefs } = require('./db');

const TYP_TILL_SLUG = { morning: 'morgon', evening: 'kvall' };
const SLUG_TILL_TYP = { morgon: 'morning', kvall: 'evening' };
const TYP_NAMN = { morning: 'Morgonbrief', evening: 'Kvällsbrief' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeUrl(u) {
  return /^https?:\/\//i.test(u || '') ? esc(u) : '#';
}

// JSON i <script>-taggar: "</script>" i texten får inte avsluta taggen
function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function briefPath(b) {
  return `/brief/${b.d}/${TYP_TILL_SLUG[b.brief_type] || 'morgon'}`;
}

// "torsdag 19 november 2026"
function datumText(d) {
  return new Date(d + 'T12:00:00Z').toLocaleDateString('sv-SE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm'
  });
}

function briefTitel(b) {
  return `${TYP_NAMN[b.brief_type] || 'Brief'} ${datumText(b.d)}`;
}

// Gör om [ord](url) till länkar. Allt annat escapas.
function inline(text) {
  const re = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    out += `<a href="${safeUrl(m[2])}" target="_blank" rel="noopener">${esc(m[1])}</a>`;
    last = re.lastIndex;
  }
  return out + esc(text.slice(last));
}

// Ren text utan länkkod (för beskrivningar och sökmotorernas data)
function plain(s) {
  return String(s || '').replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1');
}

// Delar upp briefen i intro + punkter ("Plats. Mening.") – samma logik som startsidan
function delaUpp(content) {
  const lines = String(content || '').split('\n').map(l => l.trim()).filter(Boolean);
  const itemRe = /^([A-ZÅÄÖ][\wåäöéèüöáàíìóòúù-]+(?:\s[\wåäöéèüöáàíìóòúù-]+)?)\.\s+(.+)$/;
  let intro = '';
  const items = [];
  for (const line of lines) {
    const m = line.match(itemRe);
    if (m) items.push({ topic: m[1], text: m[2] });
    else if (!intro) intro = line;
  }
  return { intro, items, lines };
}

function briefHtml(content) {
  const { intro, items, lines } = delaUpp(content);
  if (items.length < 2) {
    return lines.map(l => `<p>${inline(l)}</p>`).join('\n');
  }
  return (intro ? `<p class="intro">${inline(intro)}</p>` : '') +
    `<div class="items">${items.map(it =>
      `<p class="item"><strong>${esc(it.topic)}.</strong> ${inline(it.text)}</p>`).join('\n')}</div>`;
}

// Samtycke + Analytics + AdSense – samma upplägg som startsidan:
// allt nekat tills besökaren sagt ja i cookiebannern på startsidan.
const TRACKING = `
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    var c = null; try { c = localStorage.getItem('skime_consent'); } catch(e) {}
    var ok = c === 'all' ? 'granted' : 'denied';
    gtag('consent', 'default', { ad_storage: ok, ad_user_data: ok, ad_personalization: ok, analytics_storage: ok });
    (window.adsbygoogle = window.adsbygoogle || []).requestNonPersonalizedAds = c === 'all' ? 0 : 1;
  </script>
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5482392840942272" crossorigin="anonymous"></script>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-KSKGKZS2NX"></script>
  <script>gtag('js', new Date()); gtag('config', 'G-KSKGKZS2NX');</script>`;

function sida({ title, description, canonical, body, schema, siteUrl }) {
  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${esc(canonical)}">
  <link rel="alternate" type="application/rss+xml" title="Skimes nyhetsbriefer" href="${siteUrl}/brief/rss.xml">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="sv_SE">
  ${schema ? `<script type="application/ld+json">${jsonForScript(schema)}</script>` : ''}
  ${TRACKING}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;background:#f4f4f4;color:#111;line-height:1.65}
    header{background:#fff;border-bottom:1px solid #e5e5e5;padding:0 20px}
    .hi{max-width:720px;margin:0 auto;height:64px;display:flex;align-items:center;justify-content:space-between}
    .logo{font-weight:600;font-size:20px;letter-spacing:-1.2px;color:#111;text-decoration:none}
    .hi nav a{color:#666;text-decoration:none;font-size:14px;margin-left:16px}
    .hi nav a:hover{color:#2563eb}
    main{max-width:720px;margin:28px auto 60px;padding:0 20px}
    .card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:28px}
    .kicker{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#2563eb;margin-bottom:6px}
    h1{font-size:28px;font-weight:800;letter-spacing:-0.5px;line-height:1.25;margin-bottom:20px}
    .intro{font-style:italic;color:#555;font-size:17px;margin-bottom:18px}
    .items{display:flex;flex-direction:column;gap:12px}
    .item{padding-left:14px;border-left:2px solid #2563eb;font-size:16px}
    .card a{color:#111;text-decoration:underline;text-decoration-color:rgba(37,99,235,.35);text-underline-offset:3px;text-decoration-thickness:1.5px}
    .card a:hover{color:#2563eb;text-decoration-color:#2563eb}
    .note{margin-top:20px;font-size:12px;color:#888}
    .share{margin-top:18px;display:flex;gap:8px;flex-wrap:wrap}
    .btn{display:inline-block;font-size:13px;padding:7px 14px;border-radius:20px;border:1px solid #e5e5e5;background:#fff;color:#111;text-decoration:none;cursor:pointer;font-family:inherit}
    .btn:hover{border-color:#2563eb;color:#2563eb}
    .pager{display:flex;justify-content:space-between;gap:12px;margin-top:20px;font-size:14px}
    .pager a{color:#2563eb;text-decoration:none}
    .arkiv li{list-style:none;padding:12px 0;border-bottom:1px solid #eee}
    .arkiv li:last-child{border:none}
    .arkiv a{font-weight:600;text-decoration:none}
    .arkiv p{font-size:14px;color:#666;margin-top:2px}
    .tillbaka{display:inline-block;margin-top:24px;font-size:14px;color:#2563eb;text-decoration:none}
    @media(max-width:600px){h1{font-size:23px}.card{padding:20px}}
  </style>
</head>
<body>
<header><div class="hi">
  <a class="logo" href="/">SKIME</a>
  <nav><a href="/">Alla nyheter</a><a href="/brief">Briefarkiv</a></nav>
</div></header>
<main>
${body}
<a class="tillbaka" href="/">← Alla nyheter på Skime</a>
</main>
</body>
</html>`;
}

function register(app, { siteUrl }) {

  // ── Arkiv ────────────────────────────────────────────────────
  app.get('/brief', async (req, res) => {
    try {
      const briefs = await listBriefs(60);
      const lista = briefs.map(b => {
        const { intro } = delaUpp(b.content);
        return `<li><a href="${briefPath(b)}">${esc(briefTitel(b))}</a>${intro ? `<p>${esc(plain(intro))}</p>` : ''}</li>`;
      }).join('\n');
      res.send(sida({
        siteUrl,
        title: 'Skimes nyhetsbriefer – dagens nyheter sammanfattade morgon och kväll',
        description: 'Arkiv med Skimes morgon- och kvällsbriefer: dagens viktigaste svenska och internationella nyheter, sammanfattade med länkar till källorna.',
        canonical: `${siteUrl}/brief`,
        body: `<div class="card">
  <div class="kicker">Briefarkiv</div>
  <h1>Skimes nyhetsbriefer</h1>
  <p class="intro">Varje morgon kl. 06 och kväll kl. 17 sammanfattar Skime dagens viktigaste nyheter – med länkar till källorna.</p>
  ${briefs.length ? `<ul class="arkiv">${lista}</ul>` : '<p>Inga briefer än.</p>'}
  <div class="share"><a class="btn" href="/brief/rss.xml">RSS-flöde</a></div>
</div>`
      }));
    } catch (e) {
      console.error('Briefarkiv:', e.message);
      res.status(500).send('Kunde inte hämta briefarna.');
    }
  });

  // ── RSS ──────────────────────────────────────────────────────
  // Används av RSS-läsare och kan driva ett nyhetsbrev (RSS-till-mejl).
  app.get('/brief/rss.xml', async (req, res) => {
    try {
      const briefs = await listBriefs(30);
      const items = briefs.map(b => {
        const url = siteUrl + briefPath(b);
        const pub = new Date(b.generated_at || (b.d + 'T06:00:00+01:00')).toUTCString();
        // ]]> får inte förekomma inuti CDATA
        const html = briefHtml(b.content).replace(/\]\]>/g, ']]&gt;');
        return `    <item>
      <title>${esc(briefTitel(b))}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="true">${esc(url)}</guid>
      <pubDate>${pub}</pubDate>
      <description><![CDATA[${html}]]></description>
    </item>`;
      }).join('\n');
      res.type('application/rss+xml');
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Skimes nyhetsbriefer</title>
    <link>${siteUrl}/brief</link>
    <atom:link href="${siteUrl}/brief/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Dagens viktigaste nyheter, sammanfattade morgon och kväll med länkar till källorna.</description>
    <language>sv-SE</language>
${items}
  </channel>
</rss>`);
    } catch (e) {
      console.error('Brief-RSS:', e.message);
      res.status(500).send('Fel');
    }
  });

  // ── Enskild brief ────────────────────────────────────────────
  app.get('/brief/:datum/:typ', async (req, res) => {
    const { datum, typ } = req.params;
    const briefTyp = SLUG_TILL_TYP[typ];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !briefTyp) {
      return res.status(404).send('Briefen finns inte.');
    }
    try {
      const b = await getBrief(datum, briefTyp);
      if (!b) return res.status(404).send('Briefen finns inte.');

      // Föregående/nästa brief för bläddring
      const alla = await listBriefs(120);
      const i = alla.findIndex(x => x.d === b.d && x.brief_type === b.brief_type);
      const nyare = i > 0 ? alla[i - 1] : null;
      const aldre = i >= 0 && i < alla.length - 1 ? alla[i + 1] : null;

      const titel = briefTitel(b);
      const { intro } = delaUpp(b.content);
      const canonical = siteUrl + briefPath(b);
      const beskrivning = plain(intro) || 'Dagens viktigaste nyheter, sammanfattade av Skime.';

      res.send(sida({
        siteUrl,
        title: `${titel} – Skime`,
        description: beskrivning.slice(0, 160),
        canonical,
        schema: {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: titel,
          description: beskrivning,
          articleBody: plain(b.content),
          datePublished: b.generated_at || b.d,
          dateModified: b.generated_at || b.d,
          inLanguage: 'sv',
          mainEntityOfPage: canonical,
          author: { '@type': 'Organization', name: 'Skime', url: siteUrl },
          publisher: { '@type': 'Organization', name: 'Skime', url: siteUrl,
            logo: { '@type': 'ImageObject', url: `${siteUrl}/Skimelogo.png` } }
        },
        body: `<article class="card">
  <div class="kicker">Skimes ${b.brief_type === 'evening' ? 'kvällsbrief' : 'morgonbrief'}</div>
  <h1>${esc(datumText(b.d).replace(/^./, c => c.toUpperCase()))}</h1>
  ${briefHtml(b.content)}
  <p class="note">Sammanställt automatiskt av Skime utifrån dagens mest rapporterade nyheter. Länkarna går till originalkällorna.</p>
  <div class="share">
    <button class="btn" onclick="dela()">Dela briefen</button>
    <a class="btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(canonical)}" target="_blank" rel="noopener">Dela på LinkedIn</a>
  </div>
</article>
<div class="pager">
  <span>${aldre ? `<a href="${briefPath(aldre)}">← ${esc(briefTitel(aldre))}</a>` : ''}</span>
  <span>${nyare ? `<a href="${briefPath(nyare)}">${esc(briefTitel(nyare))} →</a>` : ''}</span>
</div>
<script>
function dela() {
  var data = { title: document.title, url: location.href };
  if (navigator.share) { navigator.share(data).catch(function(){}); return; }
  try { navigator.clipboard.writeText(location.href); } catch (e) {}
  var b = document.querySelector('.share .btn'); if (b) b.textContent = 'Länken kopierad!';
}
</script>`
      }));
    } catch (e) {
      console.error('Briefsida:', e.message);
      res.status(500).send('Kunde inte hämta briefen.');
    }
  });
}

module.exports = { register, briefPath, listBriefs, TYP_TILL_SLUG };
