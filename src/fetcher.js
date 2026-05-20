const Parser = require('rss-parser');
const { save, boost } = require('./db');

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Skime/1.0; +https://skime.se)' }
});

// ── SKIP-MÖNSTER: rubriker som ALDRIG ska sparas ─────────────────────────────
const SKIP_PATTERNS = [
  // ── DAGSAMMANFATTNINGAR & META ───────────────────────────────────────────
  /nyheter från dagen/i,
  /dagens nyheter i korthet/i,
  /veckans nyheter/i,
  /tipsa oss/i, /tipsa svt/i, /nyhetsbrev/i, /kontakta svt/i,
  /^skicka tips/i, /^så bevakar vi/i,

  // ── TOPIC-SIDOR / SAMLINGSSIDOR ──────────────────────────────────────────
  /senaste nytt om/i, /– senaste nytt$/i,
  /– nyheter och uppdateringar/i, /– allt du vill veta/i,
  /– så följer du/i, /allt om /i,
  /^samlat: /i, /^bevakning: /i,
  /^liveuppdateringar/i, /^direktsändning/i,

  // ── REKLAM & PRENUMERATIONER ─────────────────────────────────────────────
  /spara \d+.*på.*plus/i, /prenumerera nu/i, /ett år för.*kronor/i,
  /^chatta om/i, /^börsmorgon \d+ /i,
  /^just nu: spara/i, /^just nu: prenumerera/i,
  /köp.*biljett/i, /vinn biljetter/i,

  // ── FASTIGHETER ──────────────────────────────────────────────────────────
  /ny ägare till/i, /köpte.*villa/i, /köpte.*hus/i,
  /sålde.*villa/i, /sålde.*hus/i, /\d+-åring.*ägare/i,
  /s(å|a)l(d|t) för.*kronor/i, /fastighetsaffär/i,
  /priset.*kronor/i, /kvadratmeter.*s(å|a)l(d|t)/i,

  // ── NYFÖRETAG ────────────────────────────────────────────────────────────
  /startar nytt.*företag/i, /nystartat.*företag/i,
  /nytt.*företag startar/i, /registrerades.*bolagsverket/i,
  /nyetablering/i, /holdingbolag/i, /investmentbolag/i,
  / ab startades/i, /nytt.*bolag.*startar/i,

  // ── SPORT-SKRÄP ──────────────────────────────────────────────────────────
  /vi sänder.*matcher/i, /vi fortsätter sända/i,
  /följ.*snacket/i, /hockeysnacket/i,
  /^liverapportering/i, /^livesändning/i,

  // ── OFÖRSTÅELIGA/SMALA RUBRIKER ──────────────────────────────────────────
  /^hallå där/i, /^möt /i, /^porträtt:/i,
  /^lyssna:/i, /^tv:/i, /^podcast:/i, /^video:/i,
  /^live:/i, /^bildspel:/i, /^bildextra:/i,
  /^säsong \d+/i, /^avsnitt \d+:/i, /poddavsnitt/i,
  /e-tidningen/i, /tekniska problem med/i,
  /veckans klickraket/i, /klickraket/i,
  /^tipset:/i, /^quiz:/i, /^test:/i,
  /^listan:/i, /^galleriet:/i,
  /^direkt:/i, /^just nu:/i,

  // ── LEDARE & OPINION ─────────────────────────────────────────────────────
  /^ledare[:\.\s]/i, /^ledar[:\.\s]/i, /\bledarartikel\b/i,
  /^krönika[:\.\s]/i, /\bkrönika\b/i, /^kolumn[:\.\s]/i,
  /^debatt[:\.\s]/i, /^opinion[:\.\s]/i, /^kommentar[:\.\s]/i,
  /^insändare[:\.\s]/i, /insändare\./i, /^replik[:\.\s]/i,
  /^chefredaktör/i, /^min mening/i,
  /^helt rätt –/i, /^inpå livet/i,

  // ── LOKALT SKRÄP ─────────────────────────────────────────────────────────
  /förrådstjuv/i, /^två personbilar/i,
  /i cirkulationsplats/i, /krockat i korsning/i,
  /^kungsgrillen/i, /^restaurang.*stänger/i,
  /^café.*öppnar/i, /^ny restaurang/i,

  // ── LISTICLES & KLICKBETEN ───────────────────────────────────────────────
  /^här är \d+/i, /^här är de \d+/i,
  /^därför /i, /^så här /i,
  /^\d+ saker/i, /^\d+ tecken/i, /^\d+ tips/i,
  /^\d+ knep/i, /^\d+ sätt/i, /^\d+ misstag/i,
  /^topp \d+/i,
  /allt du behöver veta/i, /allt vi vet hittills/i,

  // ── ÅSIKTER UTAN MARKÖR ──────────────────────────────────────────────────
  /^därför är /i, /^vi måste /i, /^det är dags /i,
  /^min syn på/i, /^därför borde /i, /^därför ska/i,
  /^därför har/i, /^varför /i,

  // ── KÄNDISAR & SKVALLER ──────────────────────────────────────────────────
  /\bkändis\b/i, /\bskvaller\b/i, /reality/i,
  /paradise hotel/i, /let's dance/i,
  /så mycket tjänar/i, /så mycket kostar/i,
  /avslöjar.*om sin/i, /öppnar upp om/i,
  /berättar om sin kärlek/i,
  /sambo/i, /exet/i, /ex-pojkvän/i, /ex-flickvän/i,

  // ── HOLLYWOOD / NÖJES-NAMN ───────────────────────────────────────────────
  /pedro pascal/i, /timothée chalamet/i, /timothee chalamet/i,
  /zendaya/i, /margot robbie/i, /ryan reynolds/i, /ryan gosling/i,
  /taylor swift/i, /beyoncé/i, /beyonce/i,
  /kim kardashian/i, /kanye west/i,
  /ariana grande/i, /selena gomez/i, /justin bieber/i,
  /harry styles/i, /tom cruise/i,
  /dwayne johnson/i, /the rock/i,
  /brad pitt/i, /angelina jolie/i, /jennifer lopez/i,
  /lady gaga/i, /rihanna/i,

  // ── LIVSSTIL & MJUKA ÄMNEN ───────────────────────────────────────────────
  /^därför blir du /i, /forskaren: /i, /experten: /i,
  /så får du /i, /så undviker du /i,
  /detta händer när du /i, /så blir du av med/i,
  /horoskop/i, /stjärntecken/i, /så lyckas du/i,
];

// ── KRÖNIKE-DETEKTOR ─────────────────────────────────────────────────────────
function looksLikeKronika(title) {
  const kronikaPattern = /^[A-ZÅÄÖ][a-zåäö]+ [A-ZÅÄÖ][a-zåäö]+(?:-[A-ZÅÄÖ][a-zåäö]+)?:/;
  return kronikaPattern.test(title);
}

function shouldSkip(title, url = '') {
  if (!title || title.trim().length < 15) return true;
  if (SKIP_PATTERNS.some(p => p.test(title))) return true;
  if (looksLikeKronika(title)) return true;

  const urlLower = url.toLowerCase();
  const skipPaths = [
    '/ledare/', '/ledar/', '/kronika/', '/krönika/',
    '/debatt/', '/opinion/', '/kommentar/', '/insandare/',
    '/insändare/', '/kolumn/', '/podcast/', '/video/',
    '/bildspel/', '/quiz/',
    '/noje/', '/nöje/', '/halsa/', '/hälsa/',
    '/livsstil/', '/mat/', '/resor/', '/relationer/',
    '/karriar/', '/karriär/',
    '/tv-och-film/', '/kungligt/', '/familj/',
    '/horoskop/', '/test/', '/quizet/',
    '/reality/', '/skvaller/', '/kandisar/', '/kändisar/',
    '/amne/', '/ämne/', '/topic/', '/tag/',
  ];
  return skipPaths.some(p => urlLower.includes(p));
}

// ── GOOGLE NEWS WHITELIST ────────────────────────────────────────────────────
// Bara dessa källor accepteras från Google News-flödet
const GOOGLE_NEWS_WHITELIST = new Set([
  // Public service & nyhetsbyråer
  'SVT', 'SVT Nyheter', 'Sveriges Radio', 'SR', 'TT', 'TT Nyhetsbyrån',
  // Stora dagstidningar
  'Dagens Nyheter', 'DN', 'Dagens Nyheter (DN)',
  'Svenska Dagbladet', 'SvD',
  'Göteborgs-Posten', 'GP',
  'Sydsvenskan', 'Helsingborgs Dagblad', 'HD',
  // Kvällstidningar
  'Aftonbladet', 'Expressen', 'Kvällsposten', 'GT',
  // TV
  'TV4', 'TV4 Nyheterna',
  // Affärsmedia
  'Dagens industri', 'DI', 'Breakit', 'Affärsvärlden',
  // Övriga etablerade nationella
  'Omni', 'Fokus', 'Dagen', 'ETC', 'Nyheter Idag',
  // Sport
  'Fotbollskanalen', 'Fotbolldirekt', 'Hockeysverige', 'Sportbladet',
  // Internationellt
  'BBC', 'BBC News', 'Reuters', 'AP', 'AP News', 'The Guardian'
]);

// ── KÄLLOR ───────────────────────────────────────────────────────────────────
// OBS: trasiga källor borttagna baserat på Railway-loggar
const SOURCES = {

  // ── NATIONELLA KÄLLOR ────────────────────────────────────────────────────
  // BORTTAGNA: TT, GP, Omni, Breakit, Fokus (alla 404/format-fel)
  // - TT, GP, Omni, Breakit hämtas istället via Google News-proxy nedan
  national: [
    { name: 'SVT',           url: 'https://www.svt.se/nyheter/rss.xml' },
    { name: 'SR',            url: 'https://api.sr.se/api/rss/program/83?format=1' },
    { name: 'DN',            url: 'https://www.dn.se/rss/' },
    { name: 'SvD',           url: 'https://www.svd.se/feed/articles.rss' },
    { name: 'Aftonbladet',   url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/' },
    { name: 'Expressen',     url: 'https://feeds.expressen.se/nyheter/' },
    { name: 'DI',            url: 'https://www.di.se/rss' },
    { name: 'TV4',           url: 'https://www.tv4.se/rss' },
  ],

  // ── SPORT-KÄLLOR (nationella) ────────────────────────────────────────────
  // BORTTAGNA: GP Sport (404), Fotbollskanalen (404), Hockeyexpressen (XML-fel)
  sport_national: [
    { name: 'SVT Sport',          url: 'https://www.svt.se/sport/rss.xml' },
    { name: 'Aftonbladet Sport',  url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/' },
    { name: 'Expressen Sport',    url: 'https://feeds.expressen.se/sport/' },
    { name: 'DN Sport',           url: 'https://www.dn.se/rss/sport' },
    { name: 'Fotbolldirekt',      url: 'https://www.fotbolldirekt.se/rss' },
    { name: 'Hockeysverige',      url: 'https://www.hockeysverige.se/rss' },
  ],

  // ── SPORT-KÄLLOR (lokala) ────────────────────────────────────────────────
  // BORTTAGNA: Sydsvenskan Sport (404), Norran Sport (400)
  sport_local: [
    { name: 'Barometern Sport',          url: 'https://www.barometern.se/rss/sport',        region: null },
    { name: 'Borås Tidning Sport',       url: 'https://www.bt.se/rss/sport',                region: null },
    { name: 'Corren Sport',              url: 'https://www.corren.se/rss/sport',            region: null },
    { name: 'NT Sport',                  url: 'https://www.nt.se/rss/sport',                region: null },
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

  // ── ENGELSKA KÄLLOR ──────────────────────────────────────────────────────
  // BORTTAGNA: Reuters (domän död), AP News (403)
  english: [
    { name: 'BBC News',       url: 'http://feeds.bbci.co.uk/news/rss.xml' },
    { name: 'The Guardian',   url: 'https://www.theguardian.com/world/rss' },
    { name: 'Al Jazeera',     url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { name: 'New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
  ],

  // ── KULTUR-KÄLLOR ────────────────────────────────────────────────────────
  // BORTTAGNA: Nöjesguiden (SSL-fel), Fokus (kräver inlogg)
  kultur_national: [
    { name: 'SvD Kultur',         url: 'https://www.svd.se/feed/articles.rss?tag=kultur' },
    { name: 'DN Kultur',          url: 'https://www.dn.se/rss/kultur' },
    { name: 'Google News Kultur', url: 'https://news.google.com/rss/search?q=kultur+film+musik+teater&hl=sv&gl=SE&ceid=SE:sv' },
    { name: 'Google News Nöje',   url: 'https://news.google.com/rss/search?q=nöje+premiär+konsert&hl=sv&gl=SE&ceid=SE:sv' },
  ],

  // ── GOOGLE NEWS – PROXY FÖR TRASIGA KÄLLOR (NYTT) ────────────────────────
  // När en sajts egen RSS är trasig kan vi använda Google News som proxy.
  // "site:domän.se" hämtar bara artiklar från den specifika sajten.
  google_news: [
    // Befintliga teman
    { name: 'Google News Valet',       url: 'https://news.google.com/rss/search?q=riksdagsvalet+2026+valrörelsen&hl=sv&gl=SE&ceid=SE:sv' },
    { name: 'Google News Politik',     url: 'https://news.google.com/rss/search?q=riksdag+regering+partiledare&hl=sv&gl=SE&ceid=SE:sv' },
    { name: 'Google News Tech',        url: 'https://news.google.com/rss/search?q=AI+tech+startup+Sverige&hl=sv&gl=SE&ceid=SE:sv' },
    { name: 'Google News VM 2026',     url: 'https://news.google.com/rss/search?q=fotbolls-VM+2026&hl=sv&gl=SE&ceid=SE:sv' },
    { name: 'Google News Allsvenskan', url: 'https://news.google.com/rss/search?q=allsvenskan+fotboll&hl=sv&gl=SE&ceid=SE:sv' },
    { name: 'Google News SHL',         url: 'https://news.google.com/rss/search?q=SHL+ishockey+Sverige&hl=sv&gl=SE&ceid=SE:sv' },

    // NYTT: Proxy för trasiga källor
    { name: 'Google News TT',          url: 'https://news.google.com/rss/search?q=site:tt.se&hl=sv&gl=SE&ceid=SE:sv' },
    { name: 'Google News GP',          url: 'https://news.google.com/rss/search?q=site:gp.se&hl=sv&gl=SE&ceid=SE:sv' },
    { name: 'Google News Omni',        url: 'https://news.google.com/rss/search?q=site:omni.se&hl=sv&gl=SE&ceid=SE:sv' },
    { name: 'Google News Breakit',     url: 'https://news.google.com/rss/search?q=site:breakit.se&hl=sv&gl=SE&ceid=SE:sv' },
  ],

  // ── REGIONALA KÄLLOR ─────────────────────────────────────────────────────
  // BORTTAGNA: Mitt i Stockholm (404), Bohuslänningen (HTML), TTELA (XML-fel),
  //   Alingsås Tidning (HTML), Hallandsposten (HTML), Hallands Nyheter (XML-fel),
  //   Värmlands Folkblad (404), NWT (404), VK (404), SVT Gotland (404)
  regional: [

    // Stockholm
    { name: 'SVT Stockholm',         url: 'https://www.svt.se/nyheter/lokalt/stockholm/rss.xml',   region: 'Stockholm' },
    { name: 'DN Stockholm',          url: 'https://www.dn.se/rss/sthlm',                           region: 'Stockholm' },
    { name: 'Aftonbladet Stockholm', url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/', region: 'Stockholm' },

    // Skåne
    { name: 'SVT Skåne',             url: 'https://www.svt.se/nyheter/lokalt/skane/rss.xml',       region: 'Skåne' },
    { name: 'Sydsvenskan',           url: 'https://www.sydsvenskan.se/rss.xml',                    region: 'Skåne' },
    { name: 'HD',                    url: 'https://www.hd.se/rss.xml',                             region: 'Skåne' },
    { name: 'Kristianstadsbladet',   url: 'https://www.kristianstadsbladet.se/rss.xml',            region: 'Skåne' },
    { name: 'Ystads Allehanda',      url: 'https://www.ystadsallehanda.se/rss.xml',                region: 'Skåne' },
    { name: 'Trelleborgs Allehanda', url: 'https://www.trelleborgsallehanda.se/rss.xml',           region: 'Skåne' },

    // Västra Götaland (GP via Google News-proxy ovan, inte här)
    { name: 'SVT Göteborg',          url: 'https://www.svt.se/nyheter/lokalt/vast/rss.xml',        region: 'Västra Götaland' },
    { name: 'Borås Tidning',         url: 'https://www.bt.se/rss.xml',                             region: 'Västra Götaland' },

    // Halland
    { name: 'SVT Halland',           url: 'https://www.svt.se/nyheter/lokalt/halland/rss.xml',     region: 'Halland' },

    // Östergötland
    { name: 'SVT Östergötland',      url: 'https://www.svt.se/nyheter/lokalt/ost/rss.xml',         region: 'Östergötland' },
    { name: 'NT',                    url: 'https://www.nt.se/rss/nyheter',                         region: 'Östergötland' },
    { name: 'Corren',                url: 'https://www.corren.se/rss/nyheter',                     region: 'Östergötland' },
    { name: 'MVT',                   url: 'https://www.mvt.se/rss/nyheter',                        region: 'Östergötland' },

    // Södermanland
    { name: 'SVT Sörmland',          url: 'https://www.svt.se/nyheter/lokalt/sormland/rss.xml',    region: 'Södermanland' },
    { name: 'Katrineholms-Kuriren',  url: 'https://www.kkuriren.se/rss/nyheter',                   region: 'Södermanland' },
    { name: 'Södermanlands Nyheter', url: 'https://www.sn.se/rss/nyheter',                         region: 'Södermanland' },
    { name: 'Eskilstuna-Kuriren',    url: 'https://www.ekuriren.se/rss/nyheter',                   region: 'Södermanland' },

    // Uppsala
    { name: 'SVT Uppsala',           url: 'https://www.svt.se/nyheter/lokalt/uppsala/rss.xml',     region: 'Uppsala' },
    { name: 'UNT',                   url: 'https://www.unt.se/rss/nyheter',                        region: 'Uppsala' },
    { name: 'Enköpings-Posten',      url: 'https://www.eposten.se/rss/nyheter',                    region: 'Uppsala' },

    // Dalarna
    { name: 'SVT Dalarna',           url: 'https://www.svt.se/nyheter/lokalt/dalarna/rss.xml',     region: 'Dalarna' },
    { name: 'Dala-Demokraten',       url: 'https://www.dalademokraten.se/rss/nyheter',             region: 'Dalarna' },
    { name: 'Falukuriren',           url: 'https://www.falukuriren.se/rss/nyheter',                region: 'Dalarna' },

    // Gävleborg
    { name: 'SVT Gävleborg',         url: 'https://www.svt.se/nyheter/lokalt/gavleborg/rss.xml',   region: 'Gävleborg' },
    { name: 'Gefle Dagblad',         url: 'https://www.gd.se/rss/nyheter',                         region: 'Gävleborg' },
    { name: 'Arbetarbladet',         url: 'https://www.arbetarbladet.se/rss/nyheter',              region: 'Gävleborg' },

    // Västmanland
    { name: 'SVT Västmanland',       url: 'https://www.svt.se/nyheter/lokalt/vastmanland/rss.xml', region: 'Västmanland' },
    { name: 'VLT',                   url: 'https://www.vlt.se/rss/nyheter',                        region: 'Västmanland' },

    // Örebro
    { name: 'SVT Örebro',            url: 'https://www.svt.se/nyheter/lokalt/orebro/rss.xml',      region: 'Örebro' },
    { name: 'Nerikes Allehanda',     url: 'https://www.na.se/rss/nyheter',                         region: 'Örebro' },

    // Värmland (NWT och Värmlands Folkblad borttagna - 404)
    { name: 'SVT Värmland',          url: 'https://www.svt.se/nyheter/lokalt/varmland/rss.xml',    region: 'Värmland' },

    // Jämtland
    { name: 'SVT Jämtland',          url: 'https://www.svt.se/nyheter/lokalt/jamtland/rss.xml',    region: 'Jämtland' },
    { name: 'Östersunds-Posten',     url: 'https://www.op.se/rss/nyheter',                         region: 'Jämtland' },
    { name: 'Länstidningen Östersund', url: 'https://www.ltz.se/rss/nyheter',                      region: 'Jämtland' },

    // Västernorrland
    { name: 'SVT Västernorrland',    url: 'https://www.svt.se/nyheter/lokalt/vasternorrland/rss.xml', region: 'Västernorrland' },
    { name: 'Sundsvalls Tidning',    url: 'https://www.st.nu/rss/nyheter',                         region: 'Västernorrland' },

    // Västerbotten (VK borttagen - 404)
    { name: 'SVT Västerbotten',      url: 'https://www.svt.se/nyheter/lokalt/vasterbotten/rss.xml', region: 'Västerbotten' },
    { name: 'Norran',                url: 'https://www.norran.se/rss/nyheter',                     region: 'Västerbotten' },

    // Norrbotten
    { name: 'SVT Norrbotten',        url: 'https://www.svt.se/nyheter/lokalt/norrbotten/rss.xml',  region: 'Norrbotten' },
    { name: 'Norrbottens-Kuriren',   url: 'https://www.kuriren.nu/rss/nyheter',                    region: 'Norrbotten' },
    { name: 'NSD',                   url: 'https://www.nsd.se/rss/nyheter',                        region: 'Norrbotten' },
    { name: 'Piteå-Tidningen',       url: 'https://www.pt.se/rss/nyheter',                         region: 'Norrbotten' },

    // Kalmar
    { name: 'SVT Småland',           url: 'https://www.svt.se/nyheter/lokalt/smaland/rss.xml',     region: 'Kalmar' },
    { name: 'Barometern',            url: 'https://www.barometern.se/rss/nyheter',                 region: 'Kalmar' },
    { name: 'Vimmerby Tidning',      url: 'https://www.vimmerbytidning.se/rss/nyheter',            region: 'Kalmar' },
    { name: 'Västerviks-Tidningen',  url: 'https://www.vt.se/rss/nyheter',                         region: 'Kalmar' },

    // Kronoberg
    { name: 'SVT Kronoberg',         url: 'https://www.svt.se/nyheter/lokalt/smaland/rss.xml',     region: 'Kronoberg' },
    { name: 'Smålandsposten',        url: 'https://www.smp.se/rss/nyheter',                        region: 'Kronoberg' },
    { name: 'Smålänningen',          url: 'https://www.smalanningen.se/rss/nyheter',               region: 'Kronoberg' },

    // Blekinge
    { name: 'SVT Blekinge',          url: 'https://www.svt.se/nyheter/lokalt/blekinge/rss.xml',    region: 'Blekinge' },
    { name: 'Blekinge Läns Tidning', url: 'https://www.blt.se/rss/nyheter',                        region: 'Blekinge' },

    // Gotland (SVT Gotland borttagen - 404)
    { name: 'Gotlands Allehanda',    url: 'https://www.helagotland.se/rss/nyheter',                region: 'Gotland' },

    // Jönköping
    { name: 'SVT Jönköping',         url: 'https://www.svt.se/nyheter/lokalt/jonkoping/rss.xml',   region: 'Jönköping' },
    { name: 'Jönköpings-Posten',     url: 'https://www.jp.se/rss/nyheter',                         region: 'Jönköping' },
  ]
};

// ── KÄLLVIKTNING ─────────────────────────────────────────────────────────────
const SOURCE_WEIGHTS = {
  'TT': 3, 'TT Nyhetsbyrån': 3,
  'SVT': 3, 'SVT Nyheter': 3, 'SR': 3, 'Sveriges Radio': 3,
  'BBC News': 3, 'BBC': 3,
  'DN': 2, 'Dagens Nyheter': 2, 'SvD': 2, 'Svenska Dagbladet': 2,
  'GP': 2, 'Göteborgs-Posten': 2,
  'Aftonbladet': 2, 'Expressen': 2,
  'TV4': 2, 'TV4 Nyheterna': 2,
  'Omni': 2, 'DI': 2, 'Dagens industri': 2,
  'The Guardian': 2, 'New York Times': 2,
  'Al Jazeera': 2, 'Sydsvenskan': 2, 'HD': 2,
  'Breakit': 1, 'Fokus': 1,
  'Fotbollskanalen': 1, 'Fotbolldirekt': 1,
  'Hockeysverige': 1,
};

function getSourceWeight(sourceName) {
  if (SOURCE_WEIGHTS[sourceName]) return SOURCE_WEIGHTS[sourceName];
  if (sourceName.startsWith('Google News')) return 0.5;
  return 1;
}

// ── KATEGORI-NYCKELORD ───────────────────────────────────────────────────────
const KEYWORDS = {
  sport:      ['fotboll','hockey','tennis','golf','allsvenskan','superettan','nhl','nba','vm ','em ','match','spelare','tränar','shl ','damallsvenskan','ishockey','basketboll','friidrott','simning','cykling','boxning','mma','formel'],
  naringsliv: ['börsen','aktier','aktien','aktiekurs','rapport','kvartalsrapport','vinst','omsättning','förvärv','investering','börsnot','konjunktur','tillväxt','export','import','arbetsmarknad','sysselsättning','konkurs','vd ','vdn ','ränta','riksbank','inflation','bnp','ekonomi','analytiker','prognos','rusar','faller','rasar','stiger','lyfter','rekord','börs','lönsamhet','aktieägare','kvartalet','helåret','rörelseresultat','ebitda','börsvärde','notering','avnotering','utdelning','warranter','fonder'],
  naringsliv_never: ['hamas','gaza','palestina','israel','ukraina','ryssland','sexuellt våld','terrorattack','krigsbrott','massaker','folkmord','humanitär','flyktingar','sanktioner'],
  kultur:     ['film','musik','konst','teater','bok','nobel','konsert','netflix','melodifestivalen','artist','kulturhus','tv-serie','premiär','spelfilm','dokumentär','utställning','festival','recension','roman','författar'],
  tech:       ['ai ','artificiell intelligens','chatgpt','openai','tech','startup','microsoft','google','apple','cybersäkerhet','hack','algoritm','robot','programvara','iphone','android','tesla','chipset','halvledare'],
  samhalle:   ['sjukhus','vård','1177','ambulans','skola','förskola','gymnasium','bostäder','hyresrätt','järnväg','motorväg','polis','brott','rättegång','dom ','häkta','gripen','brand ','räddningstjänst','socialtjänst','äldreomsorg','migration','asyl','anhållen','åtalas','döms','fängelse','skjuten','skottlossning','mördad','explosion'],
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
  ],
  utrikes:    ['ukraina','mellanöstern','gaza','israel','putin','nordkorea','klimat','kriget','nato-toppmöte','fn-möte','trump','biden','ryssland','kina','usa '],
};

// ── KATEGORISERING ───────────────────────────────────────────────────────────
function categorize(title, sourceName) {
  const sportSources = ['SVT Sport','Aftonbladet Sport','Expressen Sport','DN Sport','Fotbolldirekt','Hockeysverige'];
  const sportLocalSources = ['Barometern Sport','Borås Tidning Sport','Corren Sport','NT Sport','Norrbottens-Kuriren Sport','HD Sport','NSD Sport','UNT Sport','Kvällsposten Sport','GT Sport','Jönköpings-Posten Sport','Smålandsposten Sport','Nerikes Allehanda Sport'];
  const kulturSources = ['SvD Kultur','DN Kultur'];
  const englishSources = ['BBC News','The Guardian','Al Jazeera','New York Times'];

  // Sport-källor → alltid sport (oavsett titel)
  if (sportSources.includes(sourceName) || sportLocalSources.includes(sourceName)) {
    return 'sport';
  }

  // Google News-källor – kategorisera efter sökterm
  const googleNewsSources = ['Google News Valet','Google News Politik','Google News Tech','Google News VM 2026','Google News Allsvenskan','Google News SHL','Google News Kultur','Google News Nöje','Google News TT','Google News GP','Google News Omni','Google News Breakit'];
  if (googleNewsSources.includes(sourceName)) {
    if (sourceName.includes('Valet') || sourceName.includes('Politik')) return 'valet2026';
    if (sourceName.includes('Tech')) return 'tech';
    if (sourceName.includes('VM 2026')) return 'sport';
    if (sourceName.includes('Allsvenskan')) return 'sport';
    if (sourceName.includes('SHL')) return 'sport';
    if (sourceName.includes('Kultur') || sourceName.includes('Nöje')) return 'kultur';
    // TT/GP/Omni/Breakit-proxy: kategorisera baserat på titel
  }

  if (kulturSources.includes(sourceName)) return 'kultur';
  if (englishSources.includes(sourceName)) return 'english';

  const t = title.toLowerCase();
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    if (cat.endsWith('_never')) continue;
    if (words.some(w => t.includes(w))) {
      const neverKey = cat + '_never';
      if (KEYWORDS[neverKey] && KEYWORDS[neverKey].some(w => t.includes(w))) continue;
      return cat;
    }
  }
  return 'nyheter';
}

function snippet(item) {
  const raw = item.contentSnippet || item.summary || item.content || '';
  const clean = raw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const sentence = clean.match(/^[^.!?]+[.!?]/);
  return sentence ? sentence[0].trim() : clean.slice(0, 150);
}

// ── HEALTH STATUS (NYTT) ─────────────────────────────────────────────────────
// Loggar hur många artiklar varje källa levererade senaste hämtningen
const sourceHealth = {};

function recordHealth(sourceName, status, count, error) {
  sourceHealth[sourceName] = {
    status,                          // 'ok' eller 'error'
    count: count || 0,
    error: error || null,
    lastChecked: new Date().toISOString()
  };
}

function getHealthStatus() {
  const entries = Object.entries(sourceHealth);
  const ok = entries.filter(([_, v]) => v.status === 'ok').length;
  const failed = entries.filter(([_, v]) => v.status === 'error').length;
  return {
    total: entries.length,
    ok,
    failed,
    sources: sourceHealth
  };
}

// ── HÄMTNING ─────────────────────────────────────────────────────────────────
async function fetchSources(sources) {
  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.url);
      const isGoogleNews = source.name.startsWith('Google News');
      const maxItems = isGoogleNews ? 5 : 20;
      let savedCount = 0;

      for (const item of feed.items.slice(0, maxItems)) {
        if (!item.title || !item.link) continue;
        if (shouldSkip(item.title, item.link)) continue;

        // Extrahera riktigt källnamn från Google News
        let sourceName = source.name;
        if (isGoogleNews && item.source && item.source.title) {
          sourceName = item.source.title;
        } else if (isGoogleNews) {
          const match = item.title.match(/\s[-–]\s([^-–]+)$/);
          if (match) sourceName = match[1].trim();
        }

        // Google News whitelist – bara betrodda källor passerar
        if (isGoogleNews && !GOOGLE_NEWS_WHITELIST.has(sourceName)) {
          continue;
        }

        await save({
          title: item.title.replace(/\s[-–]\s[^-–]+$/, '').trim(),
          url: item.link,
          source: sourceName,
          category: categorize(item.title, source.name),
          region: source.region || null,
          ingress: snippet(item),
          published_at: item.pubDate || new Date(),
          source_weight: getSourceWeight(sourceName)
        });
        savedCount++;
        const kw = item.title.split(' ').find(w => w.length > 5);
        if (kw) await boost(kw);
      }

      recordHealth(source.name, 'ok', savedCount);
    } catch (e) {
      console.log('  \u26a0 ' + source.name + ': ' + e.message);
      recordHealth(source.name, 'error', 0, e.message);
    }
  }
}

async function fetchAll() {
  console.log('[' + new Date().toLocaleTimeString('sv-SE') + '] Hämtar nyheter...');
  const all = [
    ...SOURCES.national,
    ...SOURCES.sport_national,
    ...SOURCES.sport_local,
    ...SOURCES.english,
    ...SOURCES.kultur_national,
    ...SOURCES.google_news,
    ...SOURCES.regional
  ];
  await fetchSources(all);
  const health = getHealthStatus();
  console.log(`[\u2713] ${health.ok}/${health.total} k\u00e4llor OK (${health.failed} fel)`);
}

module.exports = {
  fetchAll,
  SOURCES,
  SOURCE_WEIGHTS,
  getSourceWeight,
  getHealthStatus    // exporteras f\u00f6r att server.js kan visa health endpoint
};
