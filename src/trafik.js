// trafik.js – Skimes egen, cookiefria trafikmätning.
//
// Webbläsaren skickar en liten signal ("beacon") till /api/vy när en sida visas.
// Vi sparar bara summor per dag: vilken sida, varifrån besökaren kom och hur många.
// Inga kakor, inga IP-adresser, ingen enskild besökare kan pekas ut – därför
// behövs inget samtycke, och siffrorna kommer även från dem som nekar cookies
// (till skillnad från Google Analytics).
//
//   visningar = varje gång en sida eller flik visas
//   besök     = en ny ankomst till sajten utifrån (från Google, LinkedIn, direkt …)

const express = require('express');
const { pool } = require('./db');

const BOT = /bot|crawl|spider|slurp|headless|preview|lighthouse|python|curl|wget|facebookexternalhit|monitor|uptime/i;

async function initTrafik() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_views (
      dag DATE NOT NULL,
      sida TEXT NOT NULL,
      kalla TEXT NOT NULL,
      visningar INTEGER NOT NULL DEFAULT 0,
      besok INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (dag, sida, kalla)
    )
  `);
}

// Översätter varifrån-adressen till en begriplig källa
function kallaFran(referrer, utm) {
  if (utm) {
    const u = String(utm).toLowerCase();
    if (u === 'nyhetsbrev') return 'Nyhetsbrevet';
    if (u === 'linkedin') return 'LinkedIn';
    return u.slice(0, 30);
  }
  if (!referrer) return 'Direkt / okänd';
  let host = '';
  try { host = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return 'Direkt / okänd'; }
  const regler = [
    [/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/duckduckgo\.com$/, 'DuckDuckGo'],
    [/(^|\.)linkedin\.com$|lnkd\.in$/, 'LinkedIn'], [/facebook\.com$|(^|\.)fb\.com$|fb\.me$/, 'Facebook'],
    [/instagram\.com$/, 'Instagram'], [/(^|\.)t\.co$|(^|\.)x\.com$|twitter\.com$/, 'X'],
    [/chatgpt\.com$|openai\.com$/, 'ChatGPT'], [/perplexity\.ai$/, 'Perplexity'], [/claude\.ai$/, 'Claude'],
    [/mail\.|outlook\.|gmail\./, 'E-post'], [/reddit\.com$/, 'Reddit'], [/flashback\.org$/, 'Flashback'],
  ];
  for (const [re, namn] of regler) if (re.test(host)) return namn;
  return host.slice(0, 40);
}

// Enkel spärr mot den som försöker blåsa upp siffrorna
const perIp = new Map();
function forMycket(ip) {
  const nu = Date.now();
  const lista = (perIp.get(ip) || []).filter(t => nu - t < 60 * 1000);
  lista.push(nu);
  perIp.set(ip, lista);
  if (perIp.size > 10000) perIp.clear();
  return lista.length > 60;
}

function idagSE() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}

function register(app) {
  // sendBeacon skickar som text – därför express.text och JSON.parse
  app.post('/api/vy', express.text({ type: '*/*', limit: '2kb' }), async (req, res) => {
    res.status(204).end();
    try {
      if (BOT.test(req.get('user-agent') || '')) return;
      if (forMycket(req.ip)) return;
      const d = JSON.parse(req.body || '{}');
      const sida = String(d.s || '');
      if (!/^[a-zåäöé0-9:_\- ]{1,60}$/i.test(sida)) return;
      const ankomst = !!d.e;
      const kalla = ankomst ? kallaFran(d.r, d.u) : 'intern';
      await pool.query(
        `INSERT INTO site_views (dag, sida, kalla, visningar, besok) VALUES ($1, $2, $3, 1, $4)
         ON CONFLICT (dag, sida, kalla) DO UPDATE
         SET visningar = site_views.visningar + 1, besok = site_views.besok + EXCLUDED.besok`,
        [idagSE(), sida, kalla, ankomst ? 1 : 0]);
    } catch (e) { if (process.env.DEBUG_VY) console.error("vy:", e.message); }
  });
}

// Skript för sidor som visas en gång (briefsidor, nyhetsbrev, ämnessidor).
// Startsidan har en egen variant eftersom flikbyten där sker utan omladdning.
function vyScript(sida) {
  return `<script>(function(){try{var r=document.referrer,e=!r||!/(^|\\.)skime\\.se$/.test(new URL(r).hostname);
var u=new URLSearchParams(location.search).get('utm_source')||'';
navigator.sendBeacon('/api/vy',JSON.stringify({s:${JSON.stringify(sida)},e:e?1:0,r:e?r:'',u:u}));}catch(x){}})();</script>`;
}

// ── Data för statistiksidan ──────────────────────────────────

async function hamtaTrafik() {
  const q = (sql, p) => pool.query(sql, p).then(r => r.rows);
  const [summor, perDag, kallor, sidor, klickade] = await Promise.all([
    q(`SELECT
         COALESCE(SUM(besok) FILTER (WHERE dag = (NOW() AT TIME ZONE 'Europe/Stockholm')::date), 0)::int AS besok_idag,
         COALESCE(SUM(besok) FILTER (WHERE dag > (NOW() AT TIME ZONE 'Europe/Stockholm')::date - 7), 0)::int AS besok7,
         COALESCE(SUM(besok) FILTER (WHERE dag > (NOW() AT TIME ZONE 'Europe/Stockholm')::date - 30), 0)::int AS besok30,
         COALESCE(SUM(visningar) FILTER (WHERE dag > (NOW() AT TIME ZONE 'Europe/Stockholm')::date - 7), 0)::int AS vis7,
         MIN(dag) AS forsta
       FROM site_views`),
    q(`WITH dagar AS (
         SELECT generate_series((NOW() AT TIME ZONE 'Europe/Stockholm')::date - 29,
                                (NOW() AT TIME ZONE 'Europe/Stockholm')::date, '1 day')::date AS dag)
       SELECT to_char(d.dag, 'YYYY-MM-DD') AS dag,
              COALESCE(SUM(v.besok), 0)::int AS besok, COALESCE(SUM(v.visningar), 0)::int AS visningar
       FROM dagar d LEFT JOIN site_views v ON v.dag = d.dag
       GROUP BY d.dag ORDER BY d.dag`),
    q(`SELECT kalla, SUM(besok)::int AS besok FROM site_views
       WHERE dag > (NOW() AT TIME ZONE 'Europe/Stockholm')::date - 7 AND kalla <> 'intern'
       GROUP BY kalla ORDER BY besok DESC LIMIT 10`),
    q(`SELECT sida, SUM(visningar)::int AS visningar FROM site_views
       WHERE dag > (NOW() AT TIME ZONE 'Europe/Stockholm')::date - 7
       GROUP BY sida ORDER BY visningar DESC LIMIT 12`),
    q(`SELECT a.title, a.source, COUNT(*)::int AS klick FROM article_clicks c JOIN articles a ON a.url = c.url
       WHERE c.clicked_at > NOW() - INTERVAL '7 days'
       GROUP BY a.title, a.source ORDER BY klick DESC LIMIT 10`),
  ]);
  return { ...summor[0], perDag, kallor, sidor, klickade };
}

// Gör sidnycklar läsbara: "region:Skåne" → "Region · Skåne"
const KAT = { nyheter: 'Nyheter', sport: 'Sport', valet2026: 'Valet 2026', naringsliv: 'Näringsliv', tech: 'Tech',
  utrikes: 'Utrikes', samhalle: 'Samhälle', kultur: 'Kultur', kronikor: 'Krönikor', english: 'English', bors: 'Börsen' };
const SPORT = { allsvenskan: 'Allsvenskan', shl: 'SHL', landslaget_fotboll: 'Herrlandslaget', damallsvenskan: 'Damallsvenskan' };
function sidNamn(s) {
  const [typ, v] = s.split(':');
  if (typ === 'start') return 'Startsidan';
  if (typ === 'kategori') return KAT[v] || v;
  if (typ === 'sport') return 'Sport · ' + (SPORT[v] || v);
  if (typ === 'region') return 'Region · ' + v;
  if (typ === 'brief') return 'Briefsida';
  if (typ === 'briefarkiv') return 'Briefarkiv';
  if (typ === 'amne') return 'Ämne · ' + v;
  if (typ === 'nyhetsbrev') return 'Nyhetsbrev-sidan';
  return s;
}

module.exports = { initTrafik, register, vyScript, hamtaTrafik, sidNamn, kallaFran };
