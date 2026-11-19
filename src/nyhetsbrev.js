// nyhetsbrev.js – Skimes morgonbrev via Resend.
//
// Flödet:
//   1. Besökaren skriver sin e-post i en anmälningsruta  → POST /api/prenumerera
//   2. Vi sparar adressen som "väntande" och skickar ett bekräftelsemejl
//   3. Besökaren klickar på länken                       → GET /nyhetsbrev/bekrafta?t=…
//      Adressen blir "aktiv" och får dagens brief direkt som välkomstmejl
//   4. Varje morgon 06:30 skickas morgonbriefen till alla aktiva
//   5. Varje mejl har en avregistreringslänk             → /nyhetsbrev/avsluta?t=…
//
// Bekräftelsesteget (dubbel opt-in) gör att ingen kan anmäla någon annans adress,
// och det skyddar Skimes avsändarrykte så att mejlen inte hamnar i skräpposten.

const crypto = require('crypto');
const express = require('express');
const { pool, listBriefs } = require('./db');
const { vyScript } = require('./trafik');

const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM = 'Skime <morgon@skime.se>';

// ── Hjälpfunktioner ──────────────────────────────────────────

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeUrl(u) {
  return /^https?:\/\//i.test(u || '') ? esc(u) : '#';
}

function nyToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Rimlig kontroll av e-postadress (inte perfekt – bekräftelsemejlet är det riktiga testet)
function giltigEpost(e) {
  return typeof e === 'string' && e.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(e);
}

function datumText(d) {
  return new Date(d + 'T12:00:00Z').toLocaleDateString('sv-SE', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Stockholm'
  });
}

// Dagens datum i Sverige som "2026-11-19"
function idagSE() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
}

// ── Databas ──────────────────────────────────────────────────

async function initNyhetsbrev() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      token TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      confirm_sent_at TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ,
      unsubscribed_at TIMESTAMPTZ
    )
  `);
  // Logg över utskick – gör att samma brief aldrig skickas två gånger,
  // även om servern startas om mitt i morgonen.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS newsletter_sends (
      brief_date DATE PRIMARY KEY,
      started_at TIMESTAMPTZ DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      recipients INTEGER DEFAULT 0
    )
  `);
  const { rows } = await pool.query("SELECT COUNT(*) FILTER (WHERE status = 'active') AS n FROM subscribers");
  console.log('[nyhetsbrev] ' + rows[0].n + ' aktiva prenumeranter' + (RESEND_KEY ? '' : ' (RESEND_API_KEY saknas – inga mejl skickas)'));
}

// ── Resend ───────────────────────────────────────────────────

async function resend(path, body, idempotencyKey) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY saknas');
  const headers = { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch('https://api.resend.com' + path, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Resend ' + res.status + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}

// ── Mejlens innehåll ─────────────────────────────────────────

// [ord](url) → länk. Allt annat escapas.
function inline(text) {
  const re = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(text)) !== null) {
    out += esc(text.slice(last, m.index));
    out += `<a href="${safeUrl(m[2])}" style="color:#111;text-decoration:underline;text-decoration-color:#93b4f5;">${esc(m[1])}</a>`;
    last = re.lastIndex;
  }
  return out + esc(text.slice(last));
}

function plain(s) {
  return String(s || '').replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1');
}

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
    return lines.map(l => `<p style="margin:0 0 12px;font-size:16px;line-height:1.6;">${inline(l)}</p>`).join('');
  }
  return (intro ? `<p style="margin:0 0 18px;font-size:17px;line-height:1.55;font-style:italic;color:#555;">${inline(intro)}</p>` : '') +
    items.map(it => `<p style="margin:0 0 14px;padding-left:12px;border-left:2px solid #2563eb;font-size:16px;line-height:1.6;color:#111;"><strong>${esc(it.topic)}.</strong> ${inline(it.text)}</p>`).join('');
}

function briefText(content) {
  // Textversion: länkar skrivs ut efter ordet, inom parentes
  return String(content || '').replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)');
}

// Gemensam ram för alla mejl
function ram({ rubrik, innehall, fot }) {
  return `<!DOCTYPE html><html lang="sv"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;">
<tr><td style="padding:24px 28px 8px;">
  <div style="font-size:20px;font-weight:700;letter-spacing:-1px;">SKIME</div>
  <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1.5px;color:#2563eb;margin-top:18px;">${esc(rubrik)}</div>
</td></tr>
<tr><td style="padding:12px 28px 24px;">${innehall}</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="padding:16px 28px;font-size:12px;line-height:1.6;color:#888;text-align:center;">${fot}</td></tr>
</table>
</td></tr></table></body></html>`;
}

function morgonMejl({ brief, briefUrl, avslutaUrl, valkommen }) {
  const rubrik = (valkommen ? 'Välkommen! Här är dagens brief · ' : 'Morgonbrief · ') + datumText(brief.d);
  const html = ram({
    rubrik,
    innehall: briefHtml(brief.content) +
      `<p style="margin:22px 0 0;"><a href="${safeUrl(briefUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;">Läs och dela på Skime</a></p>
       <p style="margin:18px 0 0;font-size:13px;color:#666;">Alla nyheter, uppdaterade var 15:e minut: <a href="https://www.skime.se/?utm_source=nyhetsbrev" style="color:#2563eb;">skime.se</a></p>`,
    fot: `Du får det här mejlet för att du prenumererar på Skimes morgonbrief.<br>
          Briefen sammanställs automatiskt utifrån dagens mest rapporterade nyheter.<br>
          <a href="${safeUrl(avslutaUrl)}" style="color:#888;">Avsluta prenumerationen</a>`
  });
  const text = `${rubrik}\n\n${briefText(brief.content)}\n\nLäs på Skime: ${briefUrl}\n\n—\nAvsluta prenumerationen: ${avslutaUrl}`;
  return { subject: valkommen ? 'Välkommen till Skimes morgonbrief' : `Morgonbrief: ${plain(delaUpp(brief.content).intro).slice(0, 90) || datumText(brief.d)}`, html, text };
}

function bekraftelseMejl(bekraftaUrl) {
  const html = ram({
    rubrik: 'Bekräfta din prenumeration',
    innehall: `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Tack för att du vill få Skimes morgonbrief – dagens viktigaste nyheter, sammanfattade med länkar till källorna, varje morgon kl. 06:30.</p>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.6;">Klicka på knappen för att bekräfta din adress:</p>
      <p style="margin:0;"><a href="${safeUrl(bekraftaUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">Ja, skicka morgonbriefen till mig</a></p>`,
    fot: 'Har du inte anmält dig? Då kan du bortse från det här mejlet – du får inga fler.'
  });
  const text = `Bekräfta din prenumeration på Skimes morgonbrief:\n${bekraftaUrl}\n\nHar du inte anmält dig? Bortse från det här mejlet.`;
  return { subject: 'Bekräfta Skimes morgonbrief', html, text };
}

// ── Utskick ──────────────────────────────────────────────────

function lankar(siteUrl, token) {
  return {
    avslutaUrl: `${siteUrl}/nyhetsbrev/avsluta?t=${token}`,
    // Används av Gmail/Outlook för "Avsluta prenumeration"-knappen (ett klick)
    oneClickUrl: `${siteUrl}/nyhetsbrev/avsluta?t=${token}&oneclick=1`
  };
}

function briefPathFor(b) {
  return `/brief/${b.d}/${b.brief_type === 'evening' ? 'kvall' : 'morgon'}`;
}

// Skickar dagens morgonbrief till alla aktiva prenumeranter. Körs 06:30.
async function skickaMorgonbrief(siteUrl) {
  if (!RESEND_KEY) { console.log('[nyhetsbrev] hoppar över – RESEND_API_KEY saknas'); return; }
  const dag = idagSE();
  const briefs = await listBriefs(4);
  const brief = briefs.find(b => b.d === dag && b.brief_type === 'morning');
  if (!brief) { console.log('[nyhetsbrev] ingen morgonbrief för ' + dag + ' – inget utskick'); return; }

  // Lås: bara ett utskick per dag, även vid omstart
  const lock = await pool.query(
    'INSERT INTO newsletter_sends (brief_date) VALUES ($1) ON CONFLICT DO NOTHING RETURNING brief_date', [dag]);
  if (!lock.rowCount) { console.log('[nyhetsbrev] redan skickat för ' + dag); return; }

  const { rows: subs } = await pool.query("SELECT email, token FROM subscribers WHERE status = 'active' ORDER BY id");
  const briefUrl = siteUrl + briefPathFor(brief) + '?utm_source=nyhetsbrev';
  let skickade = 0;

  for (let i = 0; i < subs.length; i += 100) {
    const grupp = subs.slice(i, i + 100);
    const mejl = grupp.map(s => {
      const { avslutaUrl, oneClickUrl } = lankar(siteUrl, s.token);
      const { subject, html, text } = morgonMejl({ brief, briefUrl, avslutaUrl });
      return {
        from: FROM, to: [s.email], subject, html, text,
        headers: {
          'List-Unsubscribe': `<${oneClickUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      };
    });
    try {
      // Idempotency-Key: om anropet skulle göras om skickar Resend inte dubbelt
      await resend('/emails/batch', mejl, `morgon-${dag}-${i}`);
      skickade += grupp.length;
    } catch (e) {
      console.error('[nyhetsbrev] fel i grupp ' + (i / 100 + 1) + ':', e.message);
    }
  }
  await pool.query('UPDATE newsletter_sends SET finished_at = NOW(), recipients = $2 WHERE brief_date = $1', [dag, skickade]);
  console.log('[nyhetsbrev] morgonbrief ' + dag + ' skickad till ' + skickade + ' av ' + subs.length);
}

// ── Sidor och API ────────────────────────────────────────────

function enkelSida(titel, innehall) {
  return `<!DOCTYPE html><html lang="sv"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titel)} – Skime</title><meta name="robots" content="noindex">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;background:#f4f4f4;color:#111;line-height:1.6}
.wrap{max-width:520px;margin:60px auto;padding:0 20px}
.card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:28px}
.logo{font-weight:700;font-size:20px;letter-spacing:-1px;color:#111;text-decoration:none;display:inline-block;margin-bottom:20px}
h1{font-size:24px;font-weight:800;margin-bottom:10px;letter-spacing:-0.4px}
p{margin-bottom:12px;color:#444}
button,.btn{display:inline-block;background:#2563eb;color:#fff;border:0;border-radius:8px;padding:11px 20px;font-size:15px;font-weight:600;cursor:pointer;text-decoration:none;font-family:inherit}
a{color:#2563eb}
</style></head><body><div class="wrap"><a class="logo" href="/">SKIME</a><div class="card">${innehall}</div></div></body></html>`;
}

// Enkel spärr mot missbruk: max 5 anmälningar per IP och timme
const anmalningarPerIp = new Map();
function forMangaForsok(ip) {
  const nu = Date.now();
  const lista = (anmalningarPerIp.get(ip) || []).filter(t => nu - t < 3600 * 1000);
  lista.push(nu);
  anmalningarPerIp.set(ip, lista);
  if (anmalningarPerIp.size > 5000) anmalningarPerIp.clear();
  return lista.length > 5;
}

function register(app, { siteUrl }) {

  // Anmälan
  app.post('/api/prenumerera', express.json(), async (req, res) => {
    try {
      const email = String((req.body && req.body.email) || '').trim().toLowerCase();
      // Honungsfälla: ett dolt fält som bara robotar fyller i
      if (req.body && req.body.website) return res.json({ ok: true });
      if (!giltigEpost(email)) return res.status(400).json({ ok: false, error: 'Skriv en giltig e-postadress.' });
      if (forMangaForsok(req.ip)) return res.status(429).json({ ok: false, error: 'För många försök. Prova igen om en stund.' });

      const { rows } = await pool.query('SELECT token, status, confirm_sent_at FROM subscribers WHERE email = $1', [email]);
      let token;
      if (rows.length) {
        const s = rows[0];
        // Redan aktiv: svara likadant som vid ny anmälan (avslöja inte vilka adresser som finns)
        if (s.status === 'active') return res.json({ ok: true });
        // Skicka inte om bekräftelsen oftare än var 10:e minut
        if (s.confirm_sent_at && Date.now() - new Date(s.confirm_sent_at).getTime() < 10 * 60 * 1000) {
          return res.json({ ok: true });
        }
        token = s.token;
        await pool.query("UPDATE subscribers SET status = 'pending', unsubscribed_at = NULL WHERE email = $1", [email]);
      } else {
        token = nyToken();
        await pool.query('INSERT INTO subscribers (email, token) VALUES ($1, $2)', [email, token]);
      }

      const { subject, html, text } = bekraftelseMejl(`${siteUrl}/nyhetsbrev/bekrafta?t=${token}`);
      await resend('/emails', { from: FROM, to: [email], subject, html, text });
      await pool.query('UPDATE subscribers SET confirm_sent_at = NOW() WHERE email = $1', [email]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[nyhetsbrev] anmälan:', e.message);
      res.status(500).json({ ok: false, error: 'Något gick fel. Prova igen om en stund.' });
    }
  });

  // Bekräftelse
  app.get('/nyhetsbrev/bekrafta', async (req, res) => {
    const t = String(req.query.t || '');
    if (!/^[a-f0-9]{48}$/.test(t)) return res.status(400).send(enkelSida('Ogiltig länk', '<h1>Länken fungerar inte</h1><p>Prova att anmäla dig igen på <a href="/">skime.se</a>.</p>'));
    try {
      const { rows } = await pool.query(
        `UPDATE subscribers SET status = 'active', confirmed_at = COALESCE(confirmed_at, NOW()), unsubscribed_at = NULL
         WHERE token = $1 RETURNING email, (confirmed_at = NOW()) AS ny`, [t]);
      if (!rows.length) return res.status(404).send(enkelSida('Ogiltig länk', '<h1>Länken fungerar inte</h1><p>Prova att anmäla dig igen på <a href="/">skime.se</a>.</p>'));

      // Välkomstmejl med senaste morgonbriefen, bara första gången
      if (rows[0].ny) {
        try {
          const briefs = await listBriefs(4);
          const brief = briefs.find(b => b.brief_type === 'morning') || briefs[0];
          if (brief) {
            const { avslutaUrl, oneClickUrl } = lankar(siteUrl, t);
            const { subject, html, text } = morgonMejl({ brief, briefUrl: siteUrl + briefPathFor(brief) + '?utm_source=nyhetsbrev', avslutaUrl, valkommen: true });
            await resend('/emails', {
              from: FROM, to: [rows[0].email], subject, html, text,
              headers: { 'List-Unsubscribe': `<${oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
            });
          }
        } catch (e) { console.error('[nyhetsbrev] välkomstmejl:', e.message); }
      }

      res.send(enkelSida('Klart', `<h1>Klart – välkommen!</h1>
        <p>Du får Skimes morgonbrief varje morgon kl. 06:30. Vi har precis skickat dagens brief till dig.</p>
        <p><a class="btn" href="/">Till Skime</a></p>`));
    } catch (e) {
      console.error('[nyhetsbrev] bekräfta:', e.message);
      res.status(500).send(enkelSida('Fel', '<h1>Något gick fel</h1><p>Prova igen om en stund.</p>'));
    }
  });

  // Avregistrering – sida med knapp (så att mejlprogram som "förhandsklickar"
  // på länkar inte råkar avsluta prenumerationen)
  app.get('/nyhetsbrev/avsluta', async (req, res) => {
    const t = String(req.query.t || '');
    if (!/^[a-f0-9]{48}$/.test(t)) return res.status(400).send(enkelSida('Ogiltig länk', '<h1>Länken fungerar inte</h1>'));
    res.send(enkelSida('Avsluta prenumeration', `<h1>Avsluta morgonbriefen?</h1>
      <p>Du slutar få Skimes morgonbrief via e-post. Du kan alltid anmäla dig igen.</p>
      <form method="post" action="/nyhetsbrev/avsluta?t=${esc(t)}"><button type="submit">Ja, avsluta</button></form>`));
  });

  // Själva avregistreringen. Tar även emot Gmails/Outlooks "ett klick"-anrop.
  app.post('/nyhetsbrev/avsluta', express.urlencoded({ extended: false }), async (req, res) => {
    const t = String(req.query.t || '');
    if (!/^[a-f0-9]{48}$/.test(t)) return res.status(400).send('Ogiltig länk');
    try {
      await pool.query(
        "UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = NOW() WHERE token = $1", [t]);
      if (req.query.oneclick) return res.status(200).send('OK');
      res.send(enkelSida('Avslutad', `<h1>Du är avregistrerad</h1>
        <p>Du får inga fler morgonbriefer från Skime. Ångrar du dig kan du anmäla dig igen på <a href="/">skime.se</a>.</p>`));
    } catch (e) {
      console.error('[nyhetsbrev] avsluta:', e.message);
      res.status(500).send(enkelSida('Fel', '<h1>Något gick fel</h1><p>Prova igen om en stund.</p>'));
    }
  });

  // Landningssida för nyhetsbrevet (att länka till från LinkedIn m.m.)
  app.get('/nyhetsbrev', (req, res) => {
    res.send(enkelSida('Skimes morgonbrief', `<h1>Skimes morgonbrief</h1>
      <p>Dagens viktigaste nyheter, sammanfattade på en minut – med länkar till källorna. I din inkorg varje morgon kl. 06:30. Gratis.</p>
      ${anmalningsruta()}
      <p style="margin-top:16px;font-size:13px;color:#888;">Se ett exempel i <a href="/brief">briefarkivet</a>. Vi använder din adress bara till briefen, och du kan avsluta när du vill. <a href="/integritet">Integritetspolicy</a>.</p>
      ${vyScript('nyhetsbrev')}`)
      .replace('<meta name="robots" content="noindex">', `<meta name="description" content="Få dagens viktigaste nyheter sammanfattade i inkorgen varje morgon kl. 06:30. Gratis nyhetsbrev från Skime."><link rel="canonical" href="${siteUrl}/nyhetsbrev">`));
  });
}

// HTML för anmälningsrutan – används på startsidan, briefsidor och /nyhetsbrev.
// Formuläret skickas med JavaScript (ingen sidomladdning).
function anmalningsruta() {
  return `<form class="skime-nl" onsubmit="return skimeNl(this)" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
  <input type="email" name="email" required placeholder="din@epost.se" aria-label="E-postadress"
    style="flex:1;min-width:200px;padding:10px 14px;border:1px solid #d4d4d4;border-radius:8px;font-size:15px;font-family:inherit;">
  <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <button type="submit" style="background:#2563eb;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;">Prenumerera</button>
  <div class="skime-nl-msg" style="width:100%;font-size:14px;"></div>
</form>
<script>
function skimeNl(f){
  var msg=f.querySelector('.skime-nl-msg'), btn=f.querySelector('button');
  btn.disabled=true; msg.style.color='#666'; msg.textContent='Skickar…';
  fetch('/api/prenumerera',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:f.email.value,website:f.website.value})})
  .then(function(r){return r.json()}).then(function(d){
    if(d.ok){msg.style.color='#15803d';msg.textContent='Nästan klart! Kolla din inkorg och klicka på bekräftelselänken.';f.email.value='';}
    else{msg.style.color='#b91c1c';msg.textContent=d.error||'Något gick fel.';btn.disabled=false;}
  }).catch(function(){msg.style.color='#b91c1c';msg.textContent='Något gick fel. Prova igen.';btn.disabled=false;});
  return false;
}
</script>`;
}

module.exports = { initNyhetsbrev, register, skickaMorgonbrief, anmalningsruta };
