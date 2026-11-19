// hett.js – "Hett just nu": lyfter 1–3 ämnen som är ovanligt heta.
//
// Hur "hett" räknas:
//   1. Volym: hur många artiklar om ämnet som kommit de senaste 3 timmarna,
//      jämfört med ämnets normala nivå (snitt per 3 timmar senaste 7 dygnen).
//      Den signalen finns alltid, eftersom Skime läser 100+ källor.
//   2. Klick: hur många läsare som klickat på ämnets nyheter senaste 6 timmarna.
//      Väger in mer ju mer trafik sajten får.
//
// Menyn ändras inte – heta ämnen visas i en egen rad, så läsarna hittar
// alltid kategorierna på samma plats.

const { pool } = require('./db');

const AMNEN = [
  { id: 'valet2026', label: 'Valet 2026', url: '/?category=valet2026', cat: 'valet2026' },
  { id: 'allsvenskan', label: 'Allsvenskan', url: '/?category=sport&sport=allsvenskan', sport: true,
    kw: ['allsvenskan', 'malmö ff', 'djurgården', 'hammarby', 'ifk göteborg', 'blåvitt', 'ifk norrköping',
         'häcken', 'elfsborg', 'mjällby', 'gais', 'sirius', 'degerfors', 'brommapojkarna', 'halmstad bk',
         'kalmar ff', 'västerås sk', 'örgryte', 'aik fotboll'] },
  { id: 'shl', label: 'SHL', url: '/?category=sport&sport=shl', sport: true,
    kw: ['shl', 'rögle', 'skellefteå aik', 'frölunda', 'färjestad', 'luleå hockey', 'brynäs', 'hv71',
         'leksand', 'timrå', 'modo hockey', 'linköping hc', 'örebro hockey', 'djurgårdens hockey', 'tre kronor'] },
  { id: 'landslaget', label: 'Herrlandslaget', url: '/?category=sport&sport=landslaget_fotboll', sport: true,
    kw: ['herrlandslaget', 'landslaget', 'blågult', 'vm-kval', 'em-kval', 'landslagstruppen'] },
  { id: 'utrikes', label: 'Utrikes', url: '/?category=utrikes', cat: 'utrikes' },
  { id: 'naringsliv', label: 'Näringsliv', url: '/?category=naringsliv', cat: 'naringsliv' },
  { id: 'tech', label: 'Tech', url: '/?category=tech', cat: 'tech' },
  { id: 'samhalle', label: 'Samhälle', url: '/?category=samhalle', cat: 'samhalle' },
  { id: 'kultur', label: 'Kultur', url: '/?category=kultur', cat: 'kultur' },
];

// Trösklar – justera här om raden visas för ofta eller för sällan
const MIN_NYA = 5;          // minst så många artiklar senaste 3 h
const MIN_FAKTOR = 1.6;     // minst 60 % mer än normalt
const MIN_KLICK = 5;        // ... eller minst så många klick senaste 6 h
const MAX_VISADE = 3;

function matchar(amne, titel, kategori) {
  if (amne.cat) return kategori === amne.cat;
  if (kategori !== 'sport') return false;
  const t = (titel || '').toLowerCase();
  return amne.kw.some(k => t.includes(k));
}

let cache = { tid: 0, data: [] };

async function beraknaHett() {
  // Ett enda SQL-anrop: för varje ämne räknas artiklar senaste 3 h och senaste 7 dygn
  const params = [];
  const villkor = AMNEN.map(a => {
    if (a.cat) {
      params.push(a.cat);
      return `category = $${params.length}`;
    }
    const delar = a.kw.map(k => { params.push('%' + k + '%'); return `title ILIKE $${params.length}`; });
    return `(category = 'sport' AND (${delar.join(' OR ')}))`;
  });
  const kolumner = villkor.map((v, i) => `
    COUNT(*) FILTER (WHERE ${v} AND fetched_at > NOW() - INTERVAL '3 hours')::int AS n${i},
    COUNT(*) FILTER (WHERE ${v})::int AS v${i}`).join(',');
  const { rows } = await pool.query(
    `SELECT ${kolumner} FROM articles WHERE fetched_at > NOW() - INTERVAL '7 days' AND region IS NULL`, params);
  const r = rows[0] || {};

  // Klick senaste 6 timmarna, fördelade på ämnen
  const { rows: klick } = await pool.query(`
    SELECT a.title, a.category FROM article_clicks c JOIN articles a ON a.url = c.url
    WHERE c.clicked_at > NOW() - INTERVAL '6 hours'`);

  const resultat = AMNEN.map((a, i) => {
    const nya = r['n' + i] || 0;
    const vecka = r['v' + i] || 0;
    const normal = Math.max(vecka / 56, 2);   // 56 = antal 3-timmarsperioder på 7 dygn
    const faktor = nya / normal;
    const klicken = klick.filter(k => matchar(a, k.title, k.category)).length;
    const hett = (nya >= MIN_NYA && faktor >= MIN_FAKTOR) || klicken >= MIN_KLICK;
    return { id: a.id, label: a.label, url: a.url, nya, faktor: +faktor.toFixed(2), klick: klicken,
             poang: +(faktor + klicken * 0.15).toFixed(2), hett };
  });

  return resultat;
}

// Bara de heta, högst MAX_VISADE, hetast först
function valjHeta(alla) {
  return alla.filter(x => x.hett).sort((a, b) => b.poang - a.poang).slice(0, MAX_VISADE);
}

// Räknas om högst var 10:e minut
async function hamtaHett() {
  if (Date.now() - cache.tid < 10 * 60 * 1000) return cache.data;
  try {
    cache = { tid: Date.now(), data: valjHeta(await beraknaHett()) };
  } catch (e) {
    console.error('Hett just nu:', e.message);
  }
  return cache.data;
}

function register(app) {
  app.get('/api/hett', async (req, res) => {
    const lista = await hamtaHett();
    res.set('Cache-Control', 'public, max-age=120');
    res.json(lista.map(({ id, label, url }) => ({ id, label, url })));
  });
}

module.exports = { register, hamtaHett, beraknaHett, MIN_NYA, MIN_FAKTOR, MIN_KLICK };
