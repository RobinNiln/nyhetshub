// statistik.js – lösenordsskyddad sida med nyhetsbrevets siffror.
//
//   Första gången: www.skime.se/statistik?nyckel=DITT_LÖSENORD
//   Sidan sparar en kaka och skickar dig vidare till /statistik, så att
//   lösenordet inte ligger kvar i adressfältet eller webbläsarhistoriken.
//   Lösenordet sätts som variabeln STATS_KEY på Railway.

const crypto = require('crypto');
const { pool } = require('./db');
const trafik = require('./trafik');
const hett = require('./hett');

const STATS_KEY = process.env.STATS_KEY || '';
const COOKIE = 'skime_stats';

function hash(s) {
  return crypto.createHash('sha256').update('skime-stats:' + s).digest('hex');
}

// Jämför utan att läcka tidsskillnader (skydd mot gissningsattacker)
function lika(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function lasKaka(req) {
  const m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([a-f0-9]{64})').exec(req.headers.cookie || '');
  return m ? m[1] : '';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// r***@gmail.com – nog för att känna igen, utan att visa hela adressen
function maska(email) {
  const [namn, doman] = String(email).split('@');
  return (namn ? namn[0] : '') + '***@' + (doman || '');
}

const nf = n => Number(n || 0).toLocaleString('sv-SE');

function datumKort(d) {
  return new Date(d + 'T12:00:00Z').toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', timeZone: 'Europe/Stockholm' });
}

// ── Data ─────────────────────────────────────────────────────

async function hamtaData() {
  const q = (sql, p) => pool.query(sql, p).then(r => r.rows);

  const [status, rorelse, tillvaxt, utskick, senaste, sajt] = await Promise.all([
    q(`SELECT status, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE want_morning)::int AS morgon,
              COUNT(*) FILTER (WHERE want_evening)::int AS kvall
       FROM subscribers GROUP BY status`),
    q(`SELECT
         COUNT(*) FILTER (WHERE confirmed_at > NOW() - INTERVAL '7 days')::int  AS nya7,
         COUNT(*) FILTER (WHERE confirmed_at > NOW() - INTERVAL '30 days')::int AS nya30,
         COUNT(*) FILTER (WHERE unsubscribed_at > NOW() - INTERVAL '7 days')::int  AS avsl7,
         COUNT(*) FILTER (WHERE unsubscribed_at > NOW() - INTERVAL '30 days')::int AS avsl30
       FROM subscribers`),
    // Antal aktiva vid slutet av varje dag, senaste 30 dagarna (svensk tid)
    q(`WITH dagar AS (
         SELECT generate_series(
           (NOW() AT TIME ZONE 'Europe/Stockholm')::date - 29,
           (NOW() AT TIME ZONE 'Europe/Stockholm')::date,
           '1 day')::date AS dag
       )
       SELECT to_char(d.dag, 'YYYY-MM-DD') AS dag,
         (SELECT COUNT(*) FROM subscribers s
           WHERE s.confirmed_at IS NOT NULL
             AND s.confirmed_at < ((d.dag + 1)::timestamp AT TIME ZONE 'Europe/Stockholm')
             AND (s.unsubscribed_at IS NULL OR s.unsubscribed_at >= ((d.dag + 1)::timestamp AT TIME ZONE 'Europe/Stockholm'))
         )::int AS aktiva
       FROM dagar d ORDER BY d.dag`),
    q(`SELECT to_char(brief_date, 'YYYY-MM-DD') AS d, brief_type, recipients, started_at, finished_at
       FROM newsletter_sends ORDER BY brief_date DESC, brief_type DESC LIMIT 40`),
    q(`SELECT email, status, created_at, confirmed_at FROM subscribers ORDER BY created_at DESC LIMIT 10`),
    q(`SELECT
         (SELECT COUNT(*) FROM articles WHERE fetched_at > NOW() - INTERVAL '24 hours')::int AS artiklar24,
         (SELECT COUNT(*) FROM article_clicks WHERE clicked_at > NOW() - INTERVAL '7 days')::int AS klick7,
         (SELECT COUNT(*) FROM daily_briefs)::int AS briefer`)
  ]);

  const per = Object.fromEntries(status.map(r => [r.status, r.n]));
  const aktivRad = status.find(r => r.status === 'active') || { morgon: 0, kvall: 0 };
  return {
    aktiva: per.active || 0,
    aktivaMorgon: aktivRad.morgon,
    aktivaKvall: aktivRad.kvall,
    vantande: per.pending || 0,
    avslutade: per.unsubscribed || 0,
    ...rorelse[0],
    tillvaxt, utskick, senaste, sajt: sajt[0]
  };
}

// ── Diagram: aktiva prenumeranter, 30 dagar ──────────────────
// En serie → ingen förklaringsruta, rubriken säger vad som visas.
// 2px linje, svag yta under, slutpunkt med värde, hårfina rutnätslinjer.

function snyggtMax(v) {
  if (v <= 5) return 5;
  const steg = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * steg >= v) return m * steg;
  return 10 * steg;
}

function diagram(punkter, nyckel, enhet) {
  const W = 640, H = 200, L = 40, R = 44, T = 14, B = 26;
  const iw = W - L - R, ih = H - T - B;
  const max = snyggtMax(Math.max(...punkter.map(p => p[nyckel]), 1));
  const x = i => L + (punkter.length === 1 ? iw / 2 : (i / (punkter.length - 1)) * iw);
  const y = v => T + ih - (v / max) * ih;

  const linje = punkter.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[nyckel]).toFixed(1)}`).join(' ');
  const yta = `${linje} L${x(punkter.length - 1).toFixed(1)},${(T + ih).toFixed(1)} L${x(0).toFixed(1)},${(T + ih).toFixed(1)} Z`;

  const ticks = [0, max / 2, max].map(v => `
    <line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e8e8e6" stroke-width="1"/>
    <text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${nf(v)}</text>`).join('');

  const xEtiketter = [0, Math.floor((punkter.length - 1) / 2), punkter.length - 1].map(i => `
    <text x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === punkter.length - 1 ? 'end' : 'middle'}" class="ax">${esc(datumKort(punkter[i].dag))}</text>`).join('');

  const sista = punkter[punkter.length - 1];
  const data = JSON.stringify(punkter.map((p, i) => ({ x: +x(i).toFixed(1), y: +y(p[nyckel]).toFixed(1), d: datumKort(p.dag), v: p[nyckel] })));

  return `<div class="chart" id="chart">
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(enhet)} senaste 30 dagarna, senast ${sista[nyckel]}">
    ${ticks}
    <path d="${yta}" fill="#2563eb" fill-opacity="0.1"/>
    <path d="${linje}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(punkter.length - 1)}" cy="${y(sista[nyckel])}" r="4" fill="#2563eb" stroke="#fff" stroke-width="2"/>
    <text x="${x(punkter.length - 1) + 8}" y="${y(sista[nyckel]) + 4}" class="val">${nf(sista[nyckel])}</text>
    ${xEtiketter}
    <line id="hair" x1="0" x2="0" y1="${T}" y2="${T + ih}" stroke="#bbb" stroke-width="1" visibility="hidden"/>
    <circle id="hdot" r="4" fill="#2563eb" stroke="#fff" stroke-width="2" visibility="hidden"/>
    <rect x="${L}" y="${T}" width="${iw}" height="${ih}" fill="transparent" id="hit"/>
  </svg>
  <div id="tip" class="tip" hidden></div>
</div>
<script>
(function(){
  var P=${data}, svg=document.querySelector('#chart svg'), hit=document.getElementById('hit'),
      hair=document.getElementById('hair'), dot=document.getElementById('hdot'), tip=document.getElementById('tip');
  function visa(ev){
    var r=svg.getBoundingClientRect(), sx=${W}/r.width, mx=(ev.clientX-r.left)*sx, best=P[0];
    P.forEach(function(p){ if(Math.abs(p.x-mx)<Math.abs(best.x-mx)) best=p; });
    hair.setAttribute('x1',best.x); hair.setAttribute('x2',best.x); hair.setAttribute('visibility','visible');
    dot.setAttribute('cx',best.x); dot.setAttribute('cy',best.y); dot.setAttribute('visibility','visible');
    tip.innerHTML='<strong>'+best.v.toLocaleString('sv-SE')+'</strong> ${esc(enhet)}<br><span>'+best.d+'</span>';
    tip.hidden=false;
    var left=best.x/sx, w=tip.offsetWidth;
    tip.style.left=Math.max(0,Math.min(r.width-w,left-w/2))+'px';
    tip.style.top=(best.y/sx-56)+'px';
  }
  function gom(){ hair.setAttribute('visibility','hidden'); dot.setAttribute('visibility','hidden'); tip.hidden=true; }
  hit.addEventListener('mousemove',visa); hit.addEventListener('touchstart',function(e){visa(e.touches[0]);},{passive:true});
  hit.addEventListener('mouseleave',gom);
})();
</script>`;
}

// ── Sidor ────────────────────────────────────────────────────

function ram(titel, body) {
  return `<!DOCTYPE html><html lang="sv"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(titel)} – Skime</title><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;background:#f4f4f4;color:#111;line-height:1.5}
.wrap{max-width:760px;margin:0 auto;padding:28px 16px 60px}
.top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:18px}
.logo{font-weight:700;font-size:20px;letter-spacing:-1px;color:#111;text-decoration:none}
.muted{color:#777;font-size:13px}
h1{font-size:22px;font-weight:800;letter-spacing:-0.4px;margin-bottom:14px}
h2{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;color:#666;margin:26px 0 10px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.tile{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:14px}
.tile .n{font-size:28px;font-weight:800;letter-spacing:-0.5px;line-height:1.1}
.tile .l{font-size:12px;color:#666;margin-top:4px}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:16px}
.chart{position:relative}
.chart svg{width:100%;height:auto;display:block}
.ax{font-size:11px;fill:#888}
.val{font-size:12px;font-weight:700;fill:#111}
.tip{position:absolute;pointer-events:none;background:#111;color:#fff;font-size:12px;padding:6px 9px;border-radius:6px;white-space:nowrap}
.tip span{color:#bbb}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;font-size:12px;font-weight:600;color:#777;padding:6px 8px;border-bottom:1px solid #e5e5e5}
td{padding:7px 8px;border-bottom:1px solid #f0f0f0}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
.pill{font-size:11px;padding:2px 8px;border-radius:10px;background:#f1f1f1;color:#555}
.pill.active{background:#e7f6ec;color:#166534}
.pill.pending{background:#fff7e0;color:#854d0e}
details summary{cursor:pointer;font-size:13px;color:#2563eb;margin-top:10px}
.empty{color:#888;font-size:14px;padding:6px 0}
.flikar{display:inline-flex;background:#e9e9e7;border-radius:10px;padding:3px;gap:2px;margin-bottom:18px}
.flikar a{padding:7px 16px;border-radius:8px;font-size:14px;font-weight:600;color:#555;text-decoration:none}
.flikar a.aktiv{background:#fff;color:#111;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.bar{height:8px;border-radius:0 4px 4px 0;background:#2563eb;min-width:2px}
td.barcell{width:40%}
.not{font-size:12px;color:#888;margin-top:10px;line-height:1.5}
.ok{color:#166534;font-weight:600}
@media(max-width:640px){.tiles{grid-template-columns:repeat(2,1fr)}.ax{font-size:18px}.val{font-size:20px}}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

// ── Flik: Nyhetsbrev ─────────────────────────────────────────
async function nyhetsbrevFlik() {
  const d = await hamtaData();
  const utskickRader = d.utskick.map(u => `<tr>
      <td>${esc(datumKort(u.d))}</td>
      <td>${u.brief_type === 'evening' ? 'Kväll' : 'Morgon'}</td>
      <td class="r">${nf(u.recipients)}</td>
      <td class="r muted">${u.finished_at ? new Date(u.finished_at).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' }) : 'pågår/misslyckat'}</td>
    </tr>`).join('');
  const senasteRader = d.senaste.map(s => `<tr>
      <td>${esc(maska(s.email))}</td>
      <td><span class="pill ${esc(s.status)}">${{ active: 'Aktiv', pending: 'Ej bekräftad', unsubscribed: 'Avslutad' }[s.status] || esc(s.status)}</span></td>
      <td class="r muted">${new Date(s.created_at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'short' })}</td>
    </tr>`).join('');
  const tabell = d.tillvaxt.slice().reverse().map(p => `<tr><td>${esc(datumKort(p.dag))}</td><td class="r">${nf(p.aktiva)}</td></tr>`).join('');

  return `
<h1>Nyhetsbrevet</h1>
<div class="tiles">
  <div class="tile"><div class="n">${nf(d.aktiva)}</div><div class="l">Aktiva prenumeranter</div></div>
  <div class="tile"><div class="n">${nf(d.nya7)}</div><div class="l">Nya senaste 7 dagarna</div></div>
  <div class="tile"><div class="n">${nf(d.vantande)}</div><div class="l">Ej bekräftade</div></div>
  <div class="tile"><div class="n">${nf(d.avsl30)}</div><div class="l">Avslutade senaste 30 dagarna</div></div>
</div>

<h2>Aktiva prenumeranter, senaste 30 dagarna</h2>
<div class="card">
  ${diagram(d.tillvaxt, 'aktiva', 'aktiva')}
  <details><summary>Visa som tabell</summary>
    <table><thead><tr><th>Dag</th><th class="r">Aktiva</th></tr></thead><tbody>${tabell}</tbody></table>
  </details>
</div>

<h2>Utskick</h2>
<div class="card">
  ${utskickRader ? `<table><thead><tr><th>Datum</th><th>Brief</th><th class="r">Mottagare</th><th class="r">Klart kl.</th></tr></thead><tbody>${utskickRader}</tbody></table>`
    : '<p class="empty">Inga utskick än. Morgonbriefen går kl. 06:30 och kvällsbriefen kl. 17:30.</p>'}
</div>

<h2>Senaste anmälningarna</h2>
<div class="card">
  ${senasteRader ? `<table><thead><tr><th>Adress</th><th>Status</th><th class="r">Anmäld</th></tr></thead><tbody>${senasteRader}</tbody></table>`
    : '<p class="empty">Inga anmälningar än.</p>'}
  <p class="not">Av de aktiva vill ${nf(d.aktivaMorgon)} ha morgonbriefen och ${nf(d.aktivaKvall)} kvällsbriefen.</p>
  <p class="not">Totalt: ${nf(d.aktiva)} aktiva · ${nf(d.vantande)} ej bekräftade · ${nf(d.avslutade)} avslutade. Senaste 7 dagarna: ${nf(d.nya7)} nya, ${nf(d.avsl7)} avslutade.</p>
</div>`;
}

// ── Flik: Sajt ───────────────────────────────────────────────
async function sajtFlik() {
  const [t, d, amnen] = await Promise.all([trafik.hamtaTrafik(), hamtaData(), hett.beraknaHett().catch(() => [])]);
  const tomt = !t.forsta;

  const maxKalla = Math.max(1, ...t.kallor.map(k => k.besok));
  const summaKallor = t.kallor.reduce((a, k) => a + k.besok, 0) || 1;
  const kallRader = t.kallor.map(k => `<tr>
      <td>${esc(k.kalla)}</td>
      <td class="barcell"><div class="bar" style="width:${Math.max(1, Math.round(k.besok / maxKalla * 100))}%"></div></td>
      <td class="r">${nf(k.besok)}</td>
      <td class="r muted">${Math.round(k.besok / summaKallor * 100)} %</td>
    </tr>`).join('');

  const sidRader = t.sidor.map(p => `<tr><td>${esc(trafik.sidNamn(p.sida))}</td><td class="r">${nf(p.visningar)}</td></tr>`).join('');
  const klickRader = t.klickade.map(k => `<tr><td>${esc(k.title)}<div class="muted">${esc(k.source)}</div></td><td class="r">${nf(k.klick)}</td></tr>`).join('');
  const heta = amnen.filter(a => a.hett).sort((a, b) => b.poang - a.poang).slice(0, 3).map(a => a.id);
  const amneRader = amnen.slice().sort((a, b) => b.poang - a.poang).map(a => `<tr>
      <td>${esc(a.label)}</td>
      <td class="r">${nf(a.nya)}</td>
      <td class="r">${a.faktor.toLocaleString('sv-SE')}×</td>
      <td class="r">${nf(a.klick)}</td>
      <td class="r">${heta.includes(a.id) ? '<span class="ok">Visas</span>' : '<span class="muted">–</span>'}</td>
    </tr>`).join('');
  const tabell = t.perDag.slice().reverse().map(p => `<tr><td>${esc(datumKort(p.dag))}</td><td class="r">${nf(p.besok)}</td><td class="r">${nf(p.visningar)}</td></tr>`).join('');

  return `
<h1>Sajten</h1>
${tomt ? '<p class="not" style="margin:-6px 0 14px;">Mätningen har precis startat – siffrorna fylls på allt eftersom besökare kommer.</p>' : ''}
<div class="tiles">
  <div class="tile"><div class="n">${nf(t.besok_idag)}</div><div class="l">Besök i dag</div></div>
  <div class="tile"><div class="n">${nf(t.besok7)}</div><div class="l">Besök senaste 7 dagarna</div></div>
  <div class="tile"><div class="n">${nf(t.vis7)}</div><div class="l">Sidvisningar, 7 dagar</div></div>
  <div class="tile"><div class="n">${nf(d.sajt.klick7)}</div><div class="l">Klick till källor, 7 dagar</div></div>
</div>

<h2>Besök per dag, senaste 30 dagarna</h2>
<div class="card">
  ${diagram(t.perDag, 'besok', 'besök')}
  <details><summary>Visa som tabell</summary>
    <table><thead><tr><th>Dag</th><th class="r">Besök</th><th class="r">Visningar</th></tr></thead><tbody>${tabell}</tbody></table>
  </details>
</div>

<h2>Varifrån besökarna kommer, 7 dagar</h2>
<div class="card">
  ${kallRader ? `<table><thead><tr><th>Källa</th><th></th><th class="r">Besök</th><th class="r">Andel</th></tr></thead><tbody>${kallRader}</tbody></table>`
    : '<p class="empty">Inga besök registrerade än.</p>'}
</div>

<h2>Mest visade sidor, 7 dagar</h2>
<div class="card">
  ${sidRader ? `<table><thead><tr><th>Sida</th><th class="r">Visningar</th></tr></thead><tbody>${sidRader}</tbody></table>`
    : '<p class="empty">Inga visningar registrerade än.</p>'}
</div>

<h2>Mest klickade nyheter, 7 dagar</h2>
<div class="card">
  ${klickRader ? `<table><thead><tr><th>Nyhet</th><th class="r">Klick</th></tr></thead><tbody>${klickRader}</tbody></table>`
    : '<p class="empty">Inga klick än.</p>'}
</div>

<h2>Hett just nu – så räknas det</h2>
<div class="card">
  <table><thead><tr><th>Ämne</th><th class="r">Nya 3 h</th><th class="r">Mot normalt</th><th class="r">Klick 6 h</th><th class="r">Status</th></tr></thead><tbody>${amneRader}</tbody></table>
  <p class="not">Ett ämne visas när minst ${hett.MIN_NYA} artiklar kommit senaste 3 timmarna och takten är minst ${String(hett.MIN_FAKTOR).replace('.', ',')}× det normala, eller när minst ${hett.MIN_KLICK} läsare klickat på ämnets nyheter senaste 6 timmarna. Högst tre ämnen visas.</p>
</div>

<p class="not">Skimes egen mätning är cookiefri och sparar inga IP-adresser, så den räknar alla besökare – även de som nekar cookies. Robotar filtreras bort. Ett "besök" är en ankomst utifrån; "visningar" räknar även flikbyten.</p>`;
}

function register(app) {
  app.get('/statistik', async (req, res) => {
    // Utan STATS_KEY på Railway finns sidan inte alls
    if (!STATS_KEY) return res.status(404).send('Sidan finns inte.');

    // Inloggning via ?nyckel= → spara kaka, skicka vidare utan nyckeln i adressen
    if (req.query.nyckel !== undefined) {
      if (lika(hash(String(req.query.nyckel)), hash(STATS_KEY))) {
        res.setHeader('Set-Cookie', `${COOKIE}=${hash(STATS_KEY)}; Path=/statistik; Max-Age=${60 * 60 * 24 * 90}; HttpOnly; Secure; SameSite=Lax`);
        return res.redirect(302, '/statistik');
      }
      return res.status(403).send(ram('Fel nyckel', '<h1>Fel nyckel</h1>'));
    }
    if (!lika(lasKaka(req), hash(STATS_KEY))) {
      return res.status(403).send(ram('Statistik', '<h1>Ingen åtkomst</h1><p class="muted">Öppna sidan med ?nyckel=… första gången.</p>'));
    }

    try {
      const flik = req.query.flik === 'nyhetsbrev' ? 'nyhetsbrev' : 'sajt';
      res.setHeader('Cache-Control', 'no-store');
      const nu = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', dateStyle: 'medium', timeStyle: 'short' });
      const topp = `<div class="top"><a class="logo" href="/">SKIME</a><span class="muted">Uppdaterad ${esc(nu)}</span></div>
<nav class="flikar"><a href="/statistik?flik=sajt" class="${flik === 'sajt' ? 'aktiv' : ''}">Sajt</a><a href="/statistik?flik=nyhetsbrev" class="${flik === 'nyhetsbrev' ? 'aktiv' : ''}">Nyhetsbrev</a></nav>`;
      const body = flik === 'sajt' ? await sajtFlik() : await nyhetsbrevFlik();
      res.send(ram('Statistik', topp + body));
    } catch (e) {
      console.error('Statistik:', e.message);
      res.status(500).send(ram('Fel', '<h1>Kunde inte hämta statistiken</h1>'));
    }
  });
}

module.exports = { register };
