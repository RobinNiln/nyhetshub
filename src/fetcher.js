const Parser = require('rss-parser');
const { save, pool } = require('./db');

const parser = new Parser({ timeout: 15000 });

// Riktiga webbläsarheaders. Många sajter (bl.a. SVT) svarar 403 på
// User-Agents som ser ut som robotar, men släpper igenom vanliga läsare.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
  'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8'
};

// Entiteter som XML alltid förstår, plus HTML:s namngivna (&nbsp;, &auml; …)
// som vi lånar listan för från sax – parsern som rss-parser använder.
const XML_ENTITETER = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
let HTML_ENTITETER = {};
try { HTML_ENTITETER = require('sax').ENTITIES || {}; } catch (e) {}

// Städar XML som annars får rss-parser att krascha.
function stadaXml(text) {
  // 1. Ta bort BOM och allt skräp före första taggen (cookie-banners, HTML-rester).
  const start = text.search(/<(\?xml|rss|feed)\b/i);
  if (start > 0) text = text.slice(start);
  else if (start === -1) return text; // ingen XML alls – låt parsern fela

  // 2. Gå igenom alla &-tecken. Riktiga entiteter behålls, allt annat escapas.
  //    "Ris & ros" är ogiltig XML; "Ris &amp; ros" är giltig.
  //    Påhittade entiteter som "&aZ;" kraschar parsern, så de escapas också.
  text = text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,30})?(;)?/g, (m, namn, semi) => {
    if (!namn || !semi) return '&amp;' + (namn || '') + (semi || '');
    if (namn[0] === '#') {
      const kod = namn[1] === 'x' ? parseInt(namn.slice(2), 16) : parseInt(namn.slice(1), 10);
      // Bara tecken som är tillåtna i XML (inga styrtecken som &#1;)
      const giltig = kod === 9 || kod === 10 || kod === 13 ||
        (kod >= 0x20 && kod <= 0xD7FF) || (kod >= 0xE000 && kod <= 0xFFFD) ||
        (kod >= 0x10000 && kod <= 0x10FFFF);
      return giltig ? m : '&amp;' + namn + ';';
    }
    if (XML_ENTITETER.has(namn)) return m;
    // HTML-entiteter som &nbsp; och &auml; görs om till sifferkod, som all XML förstår
    const tecken = HTML_ENTITETER[namn];
    if (tecken != null) {
      const kp = typeof tecken === 'number' ? tecken : String(tecken).codePointAt(0);
      return '&#' + kp + ';';
    }
    return '&amp;' + namn + ';';
  });

  // 3. Ta bort kontrolltecken som är förbjudna i XML.
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  return text;
}

// Hämtar och parsar ett flöde. Ersätter parser.parseURL för att vi ska
// kunna sätta egna headers och städa XML:en innan den parsas.
async function hamtaFlode(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error('Status ' + res.status);
    const text = await res.text();
    if (!/<(\?xml|rss|feed)\b/i.test(text)) {
      throw new Error('Inte RSS – adressen skickar en vanlig webbsida (flödet är troligen nedlagt)');
    }
    const xml = stadaXml(text);
    try {
      return await parser.parseString(xml);
    } catch (e) {
      e.utdrag = utdragVidFel(xml, e.message);
      throw e;
    }
  } finally {
    clearTimeout(timer);
  }
}

// Plockar ut texten runt felet (parsern anger rad och kolumn), så att loggen
// visar exakt vad i flödet som är trasigt. Utan rad/kolumn: början av svaret.
function utdragVidFel(xml, msg) {
  const rad = /Line: (\d+)/.exec(msg || '');
  const kol = /Column: (\d+)/.exec(msg || '');
  if (!rad || !kol) return xml.slice(0, 160).replace(/\s+/g, ' ');
  const rader = xml.split('\n');
  const r = rader[parseInt(rad[1], 10)] || '';
  const k = parseInt(kol[1], 10);
  return r.slice(Math.max(0, k - 80), k + 40).replace(/\s+/g, ' ');
}

// Varje trasigt flödes utdrag loggas bara en gång per omstart, inte var 15:e minut
const loggadeUtdrag = new Set();

const SKIP_PATTERNS = [
  // ── DAGSAMMANFATTNINGAR & META ───────────────────────────────────────────
  /nyheter från dagen/i,
  /dagens nyheter i korthet/i,
  /veckans nyheter/i,
  /tipsa oss/i,
  /tipsa svt/i,
  /nyhetsbrev/i,
  /kontakta svt/i,
  /^skicka tips/i,
  /^så bevakar vi/i,

  // ── REKLAM & PRENUMERATIONER ─────────────────────────────────────────────
  /spara \d+.*på.*plus/i,
  /prenumerera nu/i,
  /ett år för.*kronor/i,
  /^chatta om/i,
  /^börsmorgon \d+ /i,
  /^just nu: spara/i,
  /^just nu: prenumerera/i,
  /köp.*biljett/i,
  /vinn biljetter/i,

  // ── FASTIGHETER ──────────────────────────────────────────────────────────
  /ny ägare till/i,
  /köpte.*villa/i,
  /köpte.*hus/i,
  /sålde.*villa/i,
  /sålde.*hus/i,
  /\d+-åring.*ägare/i,
  /s(å|a)l(d|t) för.*kronor/i,
  /fastighetsaffär/i,
  /priset.*kronor/i,
  /kvadratmeter.*s(å|a)l(d|t)/i,

  // ── NYFÖRETAG ────────────────────────────────────────────────────────────
  /startar nytt.*företag/i,
  /nystartat.*företag/i,
  /nytt.*företag startar/i,
  /registrerades.*bolagsverket/i,
  /nyetablering/i,
  /holdingbolag/i,
  /investmentbolag/i,
  / ab startades/i,
  /nytt.*bolag.*startar/i,

  // ── SPORT-SKRÄP ──────────────────────────────────────────────────────────
  /vi sänder.*matcher/i,
  /vi fortsätter sända/i,
  /följ.*snacket/i,
  /hockeysnacket/i,
  /^liverapportering/i,
  /^livesändning/i,

  // ── OFÖRSTÅELIGA/SMALA RUBRIKER ──────────────────────────────────────────
  /^hallå där/i,
  /^möt /i,
  /^porträtt:/i,
  /^lyssna:/i,
  /^tv:/i,
  /^podcast:/i,
  /^video:/i,
  /^live:/i,
  /^bildspel:/i,
  /^bildextra:/i,
  /^säsong \d+/i,
  /^avsnitt \d+:/i,
  /poddavsnitt/i,
  /e-tidningen/i,
  /tekniska problem med/i,
  /veckans klickraket/i,
  /klickraket/i,
  /^tipset:/i,
  /^quiz:/i,
  /^test:/i,
  /^listan:/i,
  /^galleriet:/i,
  /^direkt:/i,
  /^just nu:/i,

  // ── LEDARE & OPINION ─────────────────────────────────────────────────────
  /^ledare[:\.\s]/i,
  /^ledar[:\.\s]/i,
  /\bledarartikel\b/i,
  /^krönika[:\.\s]/i,
  /\bkrönika\b/i,
  /^kolumn[:\.\s]/i,
  /^debatt[:\.\s]/i,
  /^opinion[:\.\s]/i,
  /^kommentar[:\.\s]/i,
  /^insändare[:\.\s]/i,
  /insändare\./i,
  /^replik[:\.\s]/i,
  /^chefredaktör/i,
  /^min mening/i,
  /^helt rätt –/i,
  /^inpå livet/i,

  // ── LOKALT SKRÄP ─────────────────────────────────────────────────────────
  /förrådstjuv/i,
  /^två personbilar/i,
  /i cirkulationsplats/i,
  /krockat i korsning/i,
  /^kungsgrillen/i,
  /^restaurang.*stänger/i,
  /^café.*öppnar/i,
  /^ny restaurang/i,
];

// Rubrikmönster som indikerar krönika/tyckande/recension
// Matchar "Namn Efternamn:" inkl. diakritiska tecken (é, ü, ó) och initialer (Mats J:)
const NAME_OPINION = /^[A-ZÅÄÖ][\wåäöéèüöáàíìóòúù.-]+(?: [A-ZÅÄÖ][\wåäöéèüöáàíìóòúù.-]*)+\s*:/;

// URL-paths som indikerar krönika eller recension (= ska klassas som 'kronikor')
const KRONIKA_PATHS = [
  '/kronika/', '/krönika/', '/kronikor/', '/krönikor/',
  '/kolumn/', '/tyckare/', '/analys/',
  '/recension/', '/recensioner/', '/film-tv/recension', '/tv-recension/'
];

// URL-paths som ska skippas helt (ledare, debatt, podcast, video, bildspel, quiz)
const SKIP_PATHS = [
  '/ledare/', '/ledar/', '/debatt/', '/opinion/', '/kommentar/',
  '/insandare/', '/insändare/', '/podcast/', '/podcasts/',
  '/video/', '/bildspel/', '/quiz/', '/reportage/profil/'
];

// Avgör om en artikel är en krönika/recension (ska få kategori 'kronikor')
function isKronika(title, url = '') {
  if (NAME_OPINION.test((title || '').trim())) return true;
  const u = (url || '').toLowerCase();
  return KRONIKA_PATHS.some(p => u.includes(p));
}

function shouldSkip(title, url = '') {
  if (!title || title.trim().length < 15) return true;
  if (SKIP_PATTERNS.some(p => p.test(title))) return true;
  const u = url.toLowerCase();
  return SKIP_PATHS.some(p => u.includes(p));
}

const SOURCES = {

  // ── NATIONELLA KÄLLOR ────────────────────────────────────────────────────
  national: [
    { name: 'SVT',           url: 'https://www.svt.se/nyheter/rss.xml' },
    { name: 'SR Ekot',       url: 'https://api.sr.se/api/rss/program/83?format=145' },
    { name: 'DN',            url: 'https://www.dn.se/rss/' },
    { name: 'DN Politik',    url: 'https://www.dn.se/rss/politik/' },
    { name: 'DN Ekonomi',    url: 'https://www.dn.se/rss/ekonomi/' },
    { name: 'SvD',           url: 'https://www.svd.se/?service=rss' },
    { name: 'SvD Näringsliv', url: 'https://www.svd.se/?service=rss&type=articles&tag=naringsliv' },
    { name: 'Aftonbladet',   url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/' },
    { name: 'Aftonbladet Nyheter', url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/nyheter/' },
    { name: 'Expressen',     url: 'https://feeds.expressen.se/nyheter/' },
    { name: 'DI',            url: 'https://www.di.se/rss' },
    { name: 'TV4',           url: 'https://www.tv4.se/rss' },
  ],

  // ── SPORT-KÄLLOR (nationella) ────────────────────────────────────────────
  sport_national: [
    { name: 'SVT Sport',          url: 'https://www.svt.se/sport/rss.xml' },
    { name: 'Aftonbladet Sport',  url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/' },
    { name: 'Aftonbladet Fotboll',url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/fotboll/' },
    { name: 'Expressen Sport',    url: 'https://feeds.expressen.se/sport/' },
    { name: 'Expressen Fotboll',  url: 'https://feeds.expressen.se/sport/fotboll/' },
    { name: 'DN Sport',           url: 'https://www.dn.se/rss/sport' },
    { name: 'Fotbolldirekt',      url: 'https://www.fotbolldirekt.se/rss' },
    { name: 'Hockeysverige',      url: 'https://www.hockeysverige.se/rss' },
  ],

  // ── SPORT-KÄLLOR (lokala) ────────────────────────────────────────────────
  sport_local: [
    { name: 'Barometern Sport',          url: 'https://www.barometern.se/rss/sport',        region: null },
    { name: 'Borås Tidning Sport',       url: 'https://www.bt.se/rss/sport',                region: null },
    { name: 'Corren Sport',              url: 'https://www.corren.se/rss/sport',            region: null },
    { name: 'NT Sport',                  url: 'https://www.nt.se/rss/sport',                region: null },
    { name: 'Norran Sport',              url: 'https://www.norran.se/rss/sport',            region: null },
    { name: 'Norrbottens-Kuriren Sport', url: 'https://www.kuriren.nu/rss/sport',           region: null },
    { name: 'HD Sport',                  url: 'https://www.hd.se/rss/sport',                region: null },
    { name: 'NSD Sport',                 url: 'https://www.nsd.se/rss/sport',               region: null },
    { name: 'UNT Sport',                 url: 'https://www.unt.se/rss/sport',               region: null },
    { name: 'Kvällsposten Sport',        url: 'https://www.kvallsposten.se/rss/sport',      region: null },
    { name: 'GT Sport',                  url: 'https://www.gt.se/rss/sport',                region: null },
    { name: 'Jönköpings-Posten Sport',   url: 'https://www.jp.se/rss/sport',                region: null },
    { name: 'Smålandsposten Sport',      url: 'https://www.smp.se/rss/sport',               region: null },
    { name: 'Nerikes Allehanda Sport',   url: 'https://www.na.se/rss/sport',                region: null },
  ],

  // ── ENGELSKA KÄLLOR (internationella) ───────────────────────────────────
  english: [
    { name: 'BBC News',       url: 'http://feeds.bbci.co.uk/news/world/rss.xml' },
    { name: 'BBC Europe',     url: 'http://feeds.bbci.co.uk/news/world/europe/rss.xml' },
    { name: 'The Guardian',   url: 'https://www.theguardian.com/world/rss' },
    { name: 'Al Jazeera',     url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
    { name: 'NYT World',      url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
  ],

  // ── KULTUR-KÄLLOR (nationella) ───────────────────────────────────────────
  kultur_national: [
    { name: 'SvD Kultur',       url: 'https://www.svd.se/?service=rss&type=articles&tag=kultur' },
    { name: 'DN Kultur',        url: 'https://www.dn.se/rss/kultur' },
    { name: 'Aftonbladet Kultur', url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/kultur/' },
  ],

  // ── REGIONALA KÄLLOR ─────────────────────────────────────────────────────
  // Borttagna nov 2026 (döda flöden): Sydsvenskan Sport (404), SVT Gotland (404,
  // Gotland bevakas av SVT Öst), Västerbottens-Kuriren (403, spärrar oss),
  // TTELA, Hallands Nyheter, Bohuslänningen, Alingsås Tidning, Hallandsposten
  // och SvenskaFans (skickar en webbsida i stället för RSS).
  regional: [

    // Stockholm – utökat med fler källor
    { name: 'SVT Stockholm',      url: 'https://www.svt.se/nyheter/lokalt/stockholm/rss.xml',   region: 'Stockholm' },
    { name: 'DN Stockholm',       url: 'https://www.dn.se/rss/sthlm',                           region: 'Stockholm' },
    { name: 'SVT Södertälje',     url: 'https://www.svt.se/nyheter/lokalt/sodertalje/rss.xml',  region: 'Stockholm' },

    // Skåne
    { name: 'SVT Skåne',          url: 'https://www.svt.se/nyheter/lokalt/skane/rss.xml',       region: 'Skåne' },
    { name: 'Sydsvenskan',        url: 'https://www.sydsvenskan.se/rss.xml',                     region: 'Skåne' },
    { name: 'HD',                 url: 'https://www.hd.se/rss.xml',                              region: 'Skåne' },
    { name: 'Kristianstadsbladet',url: 'https://www.kristianstadsbladet.se/rss.xml',             region: 'Skåne' },
    { name: 'Ystads Allehanda',   url: 'https://www.ystadsallehanda.se/rss.xml',                 region: 'Skåne' },
    { name: 'Trelleborgs Allehanda', url: 'https://www.trelleborgsallehanda.se/rss.xml',         region: 'Skåne' },

    // Västra Götaland
    { name: 'SVT Göteborg',       url: 'https://www.svt.se/nyheter/lokalt/vast/rss.xml',        region: 'Västra Götaland' },
    { name: 'GP',                 url: 'https://www.gp.se/?rss',                                 region: 'Västra Götaland' },
    { name: 'Borås Tidning',      url: 'https://www.bt.se/rss.xml',                              region: 'Västra Götaland' },

    // Halland
    { name: 'SVT Halland',        url: 'https://www.svt.se/nyheter/lokalt/halland/rss.xml',     region: 'Halland' },

    // Östergötland
    { name: 'SVT Östergötland',   url: 'https://www.svt.se/nyheter/lokalt/ost/rss.xml',         region: 'Östergötland' },
    { name: 'NT',                 url: 'https://www.nt.se/rss/nyheter',                          region: 'Östergötland' },
    { name: 'Corren',             url: 'https://www.corren.se/rss/nyheter',                      region: 'Östergötland' },
    { name: 'MVT',                url: 'https://www.mvt.se/rss/nyheter',                         region: 'Östergötland' },

    // Södermanland
    { name: 'SVT Sörmland',       url: 'https://www.svt.se/nyheter/lokalt/sormland/rss.xml',    region: 'Södermanland' },
    { name: 'Katrineholms-Kuriren', url: 'https://www.kkuriren.se/rss/nyheter',                  region: 'Södermanland' },
    { name: 'Södermanlands Nyheter', url: 'https://www.sn.se/rss/nyheter',                       region: 'Södermanland' },
    { name: 'Eskilstuna-Kuriren', url: 'https://www.ekuriren.se/rss/nyheter',                    region: 'Södermanland' },

    // Uppsala
    { name: 'SVT Uppsala',        url: 'https://www.svt.se/nyheter/lokalt/uppsala/rss.xml',     region: 'Uppsala' },
    { name: 'UNT',                url: 'https://www.unt.se/rss/nyheter',                         region: 'Uppsala' },
    { name: 'Enköpings-Posten',   url: 'https://www.eposten.se/rss/nyheter',                    region: 'Uppsala' },

    // Dalarna
    { name: 'SVT Dalarna',        url: 'https://www.svt.se/nyheter/lokalt/dalarna/rss.xml',     region: 'Dalarna' },
    { name: 'Dala-Demokraten',    url: 'https://www.dalademokraten.se/rss/nyheter',              region: 'Dalarna' },
    { name: 'Falukuriren',        url: 'https://www.falukuriren.se/rss/nyheter',                 region: 'Dalarna' },

    // Gävleborg
    { name: 'SVT Gävleborg',      url: 'https://www.svt.se/nyheter/lokalt/gavleborg/rss.xml',   region: 'Gävleborg' },
    { name: 'Gefle Dagblad',      url: 'https://www.gd.se/rss/nyheter',                          region: 'Gävleborg' },
    { name: 'Arbetarbladet',      url: 'https://www.arbetarbladet.se/rss/nyheter',               region: 'Gävleborg' },

    // Västmanland
    { name: 'SVT Västmanland',    url: 'https://www.svt.se/nyheter/lokalt/vastmanland/rss.xml', region: 'Västmanland' },
    { name: 'VLT',                url: 'https://www.vlt.se/rss/nyheter',                         region: 'Västmanland' },

    // Örebro
    { name: 'SVT Örebro',         url: 'https://www.svt.se/nyheter/lokalt/orebro/rss.xml',      region: 'Örebro' },
    { name: 'Nerikes Allehanda',  url: 'https://www.na.se/rss/nyheter',                          region: 'Örebro' },

    // Värmland
    { name: 'SVT Värmland',       url: 'https://www.svt.se/nyheter/lokalt/varmland/rss.xml',    region: 'Värmland' },
    { name: 'Värmlands Folkblad', url: 'https://www.vf.se/rss/nyheter',                          region: 'Värmland' },
    { name: 'NWT',                url: 'https://www.nwt.se/rss/nyheter',                         region: 'Värmland' },

    // Jämtland
    { name: 'SVT Jämtland',       url: 'https://www.svt.se/nyheter/lokalt/jamtland/rss.xml',    region: 'Jämtland' },
    { name: 'Östersunds-Posten',  url: 'https://www.op.se/rss/nyheter',                          region: 'Jämtland' },
    { name: 'Länstidningen Östersund', url: 'https://www.ltz.se/rss/nyheter',                    region: 'Jämtland' },

    // Västernorrland
    { name: 'SVT Västernorrland', url: 'https://www.svt.se/nyheter/lokalt/vasternorrland/rss.xml', region: 'Västernorrland' },
    { name: 'Sundsvalls Tidning', url: 'https://www.st.nu/rss/nyheter',                          region: 'Västernorrland' },

    // Västerbotten
    { name: 'SVT Västerbotten',   url: 'https://www.svt.se/nyheter/lokalt/vasterbotten/rss.xml', region: 'Västerbotten' },
    { name: 'Norran',             url: 'https://www.norran.se/rss/nyheter',                      region: 'Västerbotten' },

    // Norrbotten
    { name: 'SVT Norrbotten',     url: 'https://www.svt.se/nyheter/lokalt/norrbotten/rss.xml',  region: 'Norrbotten' },
    { name: 'Norrbottens-Kuriren',url: 'https://www.kuriren.nu/rss/nyheter',                    region: 'Norrbotten' },
    { name: 'NSD',                url: 'https://www.nsd.se/rss/nyheter',                         region: 'Norrbotten' },
    { name: 'Piteå-Tidningen',    url: 'https://www.pt.se/rss/nyheter',                         region: 'Norrbotten' },

    // Kalmar
    { name: 'SVT Småland',        url: 'https://www.svt.se/nyheter/lokalt/smaland/rss.xml',     region: 'Kalmar' },
    { name: 'Barometern',         url: 'https://www.barometern.se/rss/nyheter',                  region: 'Kalmar' },
    { name: 'Vimmerby Tidning',   url: 'https://www.vimmerbytidning.se/rss/nyheter',             region: 'Kalmar' },
    { name: 'Västerviks-Tidningen', url: 'https://www.vt.se/rss/nyheter',                       region: 'Kalmar' },

    // Kronoberg
    { name: 'SVT Kronoberg',      url: 'https://www.svt.se/nyheter/lokalt/smaland/rss.xml',     region: 'Kronoberg' },
    { name: 'Smålandsposten',     url: 'https://www.smp.se/rss/nyheter',                         region: 'Kronoberg' },
    { name: 'Smålänningen',       url: 'https://www.smalanningen.se/rss/nyheter',               region: 'Kronoberg' },

    // Blekinge
    { name: 'SVT Blekinge',       url: 'https://www.svt.se/nyheter/lokalt/blekinge/rss.xml',    region: 'Blekinge' },
    { name: 'Blekinge Läns Tidning', url: 'https://www.blt.se/rss/nyheter',                     region: 'Blekinge' },

    // Gotland
    { name: 'Gotlands Allehanda', url: 'https://www.helagotland.se/rss/nyheter',                region: 'Gotland' },

    // Jönköping
    { name: 'SVT Jönköping',      url: 'https://www.svt.se/nyheter/lokalt/jonkoping/rss.xml',   region: 'Jönköping' },
    { name: 'Jönköpings-Posten',  url: 'https://www.jp.se/rss/nyheter',                         region: 'Jönköping' },
    { name: 'Smålandsposten',     url: 'https://www.smp.se/rss/nyheter',                         region: 'Jönköping' },
  ]
};

const KEYWORDS = {
  sport:      ['fotboll','hockey','tennis','golf','allsvenskan','superettan','nhl','nba','vm ','em ','match','spelare','tränar','shl ','damallsvenskan','ishockey','basketboll','friidrott','simning','cykling','boxning','mma','formel'],
  // Rubriker med de här orden är inte sport, även om t.ex. "VM" eller "spelare" nämns
  sport_never: ['skådespelare','kvartal','vd:','vd ','börs','aktie','rörelseresultat','vinst','omsättning','vakansgrad','lägenhet'],

  naringsliv: ['börsen','aktier','aktien','aktiekurs','rapport','kvartalsrapport','vinst','omsättning','förvärv','investering','börsnot','konjunktur','tillväxt','export','import','arbetsmarknad','sysselsättning','konkurs','vd ','vdn ','ränta','riksbank','inflation','bnp','ekonomi','analytiker','prognos','rusar','faller','rasar','stiger','lyfter','rekord','börs','lönsamhet','aktieägare','kvartalet','helåret','rörelseresultat','ebitda','börsvärde','notering','avnotering','utdelning','warranter','fonder','börsöppning','börsras','börsdag','börsfall','börsuppgång'],
  naringsliv_never: ['hamas','gaza','palestina','israel','ukraina','ryssland','sexuellt våld','terrorattack','krigsbrott','massaker','folkmord','humanitär','flyktingar','sanktioner'],

  // Kultur – bara tydliga kulturnyheter, aldrig politik/utrikes
  kultur: ['spelfilm','dokumentär','utställning','konsert','konstutställning','musikalbum','teaterpremiär','filmpremiär','kulturpriset','nobelpriset i litteratur','melodifestivalen','grammisgalan','guldbagge','filmfestival','bokmässa','konstmässa','netflix-serie','hbo-serie','ny bok','ny roman','ny skiva','kulturhuset','operan','dramaten','folkoperan'],
  kultur_never: ['krig','attack','konflikt','politik','riksdag','regering','minister','ekonomi','börsen','aktier','ukraina','ryssland','israel','palestina','trump','biden','nato','eu-'],

  // Samhälle – fokus på rikstäckande samhällsfrågor, inte lokala händelser
  samhalle: ['sjukvården','vårdkrisen','vårdbrist','sjukhuset','ambulansen','1177','skolan','skolresultat','gymnasiet','bostadsbristen','hyresrätt','infrastrukturen','järnvägen','motorvägen','polisen','brottsligheten','gängkriminalitet','rättegången','häktas','gripen','räddningstjänsten','socialtjänsten','äldreomsorgen','migrations','asylsökande','anhållna','åtalas','döms','fängelse','skjuten','skottlossning','mördad','explosion','terrorbrott','mordet','rättssystemet','kriminalvården','diskriminering','jämställdhet','välfärden'],
  samhalle_never: ['lokalt','kommunen beslut','kommunfullmäktige'],

  // Valet 2026 – utökat med fler triggers
  valet2026: [
    'riksdagsvalet','valet 2026','valrörelsen','valresultat','valundersökning',
    'opinionsundersökning','väljarstöd','opinionsmätning','supervalåret',
    'valmanifest','valanalys','valdebatten','valkampanj','valdagen',
    'valets','valvinst','valförlust','mandatfördelning','riksdagsmandat',
    'väljarnas','partiledardebatt','partiledare','partierna','partipolitik',
    'riksdag','riksdagen','riksdagsbeslut','kommunalvalet','regionvalet',
    'budgetpropositionen','statsbudgeten','regeringsförklaring',
    'oppositionen','majoriteten','minoritetsregering',
    'socialdemokraterna','moderaterna','sverigedemokraterna','vänsterpartiet',
    'centerpartiet','liberalerna','kristdemokraterna','miljöpartiet',
    'ulf kristersson','magdalena andersson','jimmie åkesson','nooshi dadgostar',
    'annie lööf','johan pehrson','ebba busch','märta stenevi',
    'statsminister','statsministern','regeringen','regeringsbeslut',
    'utrikesminister','justitieminister','finansminister','socialminister',
    'försvarsminister','inrikesminister','migrationsminister','statsråd',
    'tobias billström','maria malmer stenergard',
    'migrationspolitik','integrationspolitik','försvarspolitik',
    'säkerhetspolitik','klimatpolitik','energipolitik','skattereform',
    'skattehöjning','skattesänkning','välfärdspolitik','skolpolitik',
    'sjukvårdspolitik','rättspolitik','bostadspolitik',
    'nato ','nato-','eu-kommissionen','eu-parlamentet','eu-valet',
    'koalition','samarbetsregering','tidöavtalet',
    // Extra triggers för lugna dagar
    'politiken','politiska','politiskt','partiet ','partiets',
    'riksdagsledamot','riksdagsledamöter','utskottet','utskotten',
    'lagstiftning','proposition ','motion ','remiss ','votering',
    'alliansen','vänsterblocket','högerblocket','decemberöverenskommelsen',
  ],
  utrikes:    ['ukraina','mellanöstern','gaza','israel','putin','nordkorea','klimat','kriget','nato-toppmöte','fn-möte','trump','biden','ryssland','kina','usa '],

  // Tech – AI, startups, teknik, digitalisering
  tech: [
    'artificiell intelligens','ai-modell','ai-bolag','ai-startup','ai-verktyg','ai-assistent',
    'chatgpt','openai','claude','anthropic','gemini','deepmind','grok','mistral','meta ai',
    'algoritm','algoritmer','maskininlärning','neuralt nätverk','språkmodell','llm ',
    'startup','startupen','startupbolag','techbolag','tech-bolag','tech-jätten','tech-jättarna',
    'enhörning','unicorn','vc-bolag','venture capital','riskkapital','funding-runda',
    'mjukvara','hårdvara','app ','appen ','plattform ','sociala medier','sociala medier-',
    'instagram','tiktok','snapchat','youtube','twitch','linkedin','threads',
    'apple','google','microsoft','amazon','tesla','spacex','nvidia','intel','samsung',
    'spotify','klarna','ericsson','epidemic sound','northvolt','voi','einride','truecaller',
    'cybersäkerhet','cyberattack','dataintrång','ransomware','phishing','hackare','läckta uppgifter',
    'kryptovaluta','bitcoin','ethereum','blockchain','nft ','stablecoin',
    'gpu','chip ','halvledare','semiconductor','kvantdator','5g ','6g ','bredband',
    'elbil','elbilar','batteriteknik','laddstation','självkörande','autonom bil',
    'rymdfärd','satellit ','satelliter','rymdresa','starship','falcon ','mars-uppdrag',
    'robot ','robotar','drönare','drönar','vr-glasögon','ar-glasögon','metaverse',
    'sociala plattformen','digitalisering','digital tjänst','molntjänst','molnet',
    'streamingtjänst','streaming-tjänst','strömningstjänsten'
  ],
  tech_never: ['gänget','skjutning','knivhugg','misshandel','våldtäkt','döms','häktas','dödad','mördad'],
};

function categorize(title, sourceName) {
  const sportSources = ['SVT Sport','Aftonbladet Sport','Expressen Sport','DN Sport','GP Sport','Sydsvenskan Sport','Fotbollskanalen','Fotbolldirekt','Hockeysverige','Hockeyexpressen'];
  const sportLocalSources = ['Barometern Sport','Borås Tidning Sport','Corren Sport','NT Sport','Norran Sport','Norrbottens-Kuriren Sport','HD Sport','NSD Sport','UNT Sport','Kvällsposten Sport','GT Sport','Jönköpings-Posten Sport','Smålandsposten Sport','Nerikes Allehanda Sport'];
  const kulturSources = ['SvD Kultur','DN Kultur','Nöjesguiden','Fokus'];
  const englishSources = ['BBC News','BBC Europe','Reuters','The Guardian','AP News','Al Jazeera','New York Times','NYT World'];

  // Kultur-källor – alltid kultur
  if (kulturSources.includes(sourceName)) return 'kultur';
  // Engelska källor – alltid english
  if (englishSources.includes(sourceName)) return 'english';

  const t = title.toLowerCase();

  // Alla sportkällor – ALLTID sport (oavsett rubrik)
  if (sportSources.includes(sourceName) || sportLocalSources.includes(sourceName)) {
    return 'sport';
  }

  for (const [cat, words] of Object.entries(KEYWORDS)) {
    if (cat.endsWith('_never')) continue;
    if (words.some(w => matchar(t, w))) {
      // Kolla om titeln innehåller ett "aldrig"-ord för denna kategori
      const neverKey = cat + '_never';
      if (KEYWORDS[neverKey] && KEYWORDS[neverKey].some(w => matchar(t, w))) continue;
      return cat;
    }
  }
  return 'nyheter';
}

// Matchar ett nyckelord mot en rubrik (gemener).
// Korta ord (max 4 tecken, t.ex. "vm", "em", "mma", "nhl") måste stå som EGNA ord –
// annars matchar "em" i "Fem saker…" och "mma" i "tomma lägenheter".
// Längre ord matchas som förut, även inuti sammansättningar ("damfotboll").
const kortaOrdCache = new Map();
function matchar(t, w) {
  const k = w.trim();
  if (k.length > 4) return t.includes(w);
  let re = kortaOrdCache.get(k);
  if (!re) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp('(^|[^a-zåäöéü0-9])' + escaped + '($|[^a-zåäöéü0-9])');
    kortaOrdCache.set(k, re);
  }
  return re.test(t);
}

function snippet(item) {
  const raw = item.contentSnippet || item.summary || item.content || '';
  const clean = raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const sentence = clean.match(/^[^.!?]+[.!?]/);
  return sentence ? sentence[0].trim() : clean.slice(0, 150);
}

// Källor som aldrig får sparas (politiskt färgade, fackliga, partipress, övrigt skräp)
const BLOCKED_SOURCES = [
  'proletären','proletaren','seko','arbetaren','flamman',
  'nya tider','nyatider','samtiden','frihetsnytt','fria tider',
  'kommunalarbetaren','dagens arena','dagens etc','etc',
  'tidningen syre','syre','internationalen',
  'realtid','nextconomy','nextconomy.se','nyteknik','ny teknik',
  'riksdagen','mynewsdesk'
];

function isBlocked(sourceName) {
  if (!sourceName) return false;
  const s = sourceName.toLowerCase().trim();
  return BLOCKED_SOURCES.some(b => s === b || s.includes(b));
}

async function fetchSources(sources) {
  for (const source of sources) {
    if (isBlocked(source.name)) continue;
    try {
      const feed = await hamtaFlode(source.url);
      for (const item of feed.items.slice(0, 20)) {
        if (!item.title || !item.link) continue;
        if (!/^https?:\/\//i.test(item.link)) continue; // bara riktiga webblänkar
        if (shouldSkip(item.title, item.link)) continue;

        await save({
          title: item.title.trim(),
          url: item.link,
          source: source.name,
          category: isKronika(item.title, item.link) ? 'kronikor' : categorize(item.title, source.name),
          region: source.region || null,
          ingress: snippet(item),
          published_at: item.pubDate || new Date()
        });
      }
    } catch (e) {
      console.log('  \u26a0 ' + source.name + ': ' + String(e.message).split('\n')[0]);
      if (e.utdrag && !loggadeUtdrag.has(source.name)) {
        loggadeUtdrag.add(source.name);
        console.log('    utdrag ' + source.name + ': ' + JSON.stringify(e.utdrag));
      }
    }
  }
}

// Spärr så att två hämtningar aldrig körs samtidigt
// (t.ex. cron-jobbet och en besökare som triggar refresh på samma gång).
let fetching = false;

async function fetchAll() {
  if (fetching) return;
  fetching = true;
  try {
    console.log('[' + new Date().toLocaleTimeString('sv-SE') + '] Hämtar nyheter...');
    const all = [
      ...SOURCES.national,
      ...SOURCES.sport_national,
      ...SOURCES.sport_local,
      ...SOURCES.english,
      ...SOURCES.kultur_national,
      ...SOURCES.regional
    ];
    await fetchSources(all);
  } finally {
    fetching = false;
  }
}

// Sorterar om artiklarna från de senaste två dygnen med nuvarande regler.
// Körs vid uppstart, så att en ändrad kategorisering slår igenom direkt
// i stället för att felsorterade artiklar ligger kvar tills de blir för gamla.
async function recategorizeRecent() {
  const { rows } = await pool.query(
    "SELECT id, title, url, source, category FROM articles WHERE fetched_at > NOW() - INTERVAL '48 hours'"
  );
  let changed = 0;
  for (const r of rows) {
    const cat = isKronika(r.title, r.url) ? 'kronikor' : categorize(r.title, r.source);
    if (cat !== r.category) {
      await pool.query('UPDATE articles SET category = $1 WHERE id = $2', [cat, r.id]);
      changed++;
    }
  }
  console.log('[omsortering] ' + changed + ' av ' + rows.length + ' artiklar bytte kategori');
}

module.exports = { fetchAll, SOURCES, categorize, recategorizeRecent };
