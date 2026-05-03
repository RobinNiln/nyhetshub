const Parser = require('rss-parser');
const { save, boost } = require('./db');

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Skime/1.0; +https://skime.se)' }
});

const SKIP_PATTERNS = [
  // Dagsammanfattningar och tips
  /nyheter från dagen/i,
  /dagens nyheter i korthet/i,
  /veckans nyheter/i,
  /tipsa oss/i, /tipsa svt/i,
  /nyhetsbrev/i, /prenumerera/i,
  /kontakta svt/i,
  // Fastigheter
  /kvadratmeter.*s(å|a)l(d|t)/i,
  /s(å|a)l(d|t) för.*kronor/i,
  /fastighetsaffär/i,
  /priset.*kronor/i,
  // Nyföretag – bara specifika mönster
  /startar nytt.*företag/i,
  /nystartat.*företag/i,
  /nytt.*företag startar/i,
  /registrerades.*bolagsverket/i,
  /nyetablering/i,
  /holdingbolag/i,
  /investmentbolag/i,
  / ab startades/i,
  // Sport-skräp
  /vi sänder.*matcher/i,
  /vi fortsätter sända/i,
  /glädjebeskedet.*sänder/i,
  /följ.*snacket/i,
  /hockeysnacket/i,
  // Smala rubriker
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
  // Ledare och opinion
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
];

function shouldSkip(title, url = '') {
  if (SKIP_PATTERNS.some(p => p.test(title))) return true;
  const urlLower = url.toLowerCase();
  const skipPaths = ['/ledare/', '/ledar/', '/kronika/', '/krönika/', '/debatt/', '/opinion/', '/kommentar/', '/insandare/', '/insändare/', '/kolumn/'];
  return skipPaths.some(p => urlLower.includes(p));
}

const SOURCES = {

  // ── NATIONELLA KÄLLOR ────────────────────────────────────────────────────
  national: [
    { name: 'SVT',           url: 'https://www.svt.se/nyheter/rss.xml' },
    { name: 'SR',            url: 'https://api.sr.se/api/rss/program/83?format=1' },
    { name: 'DN',            url: 'https://www.dn.se/rss/' },
    { name: 'SvD',           url: 'https://www.svd.se/feed/articles.rss' },
    { name: 'Aftonbladet',   url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/' },
    { name: 'Expressen',     url: 'https://feeds.expressen.se/nyheter/' },
    { name: 'DI',            url: 'https://www.di.se/rss' },
    { name: 'Breakit',       url: 'https://www.breakit.se/feed/articles' },
    { name: 'GP',            url: 'https://www.gp.se/rss/nyheter' },
    { name: 'Sydsvenskan',   url: 'https://www.sydsvenskan.se/rss.xml' },
    { name: 'TV4',           url: 'https://www.tv4.se/rss' },
    { name: 'Omni',          url: 'https://omni.se/rss' },
    { name: 'TT',            url: 'https://tt.se/rss.xml' },
  ],

  // ── SPORT-KÄLLOR (nationella) ────────────────────────────────────────────
  sport_national: [
    { name: 'SVT Sport',          url: 'https://www.svt.se/sport/rss.xml' },
    { name: 'Aftonbladet Sport',  url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/' },
    { name: 'Expressen Sport',    url: 'https://feeds.expressen.se/sport/' },
    { name: 'DN Sport',           url: 'https://www.dn.se/rss/sport' },
    { name: 'GP Sport',           url: 'https://www.gp.se/rss/sport' },
    { name: 'Sydsvenskan Sport',  url: 'https://www.sydsvenskan.se/sport/rss.xml' },
    { name: 'Fotbollskanalen',    url: 'https://www.fotbollskanalen.se/rss' },
    { name: 'Fotbolldirekt',      url: 'https://www.fotbolldirekt.se/rss' },
    { name: 'Hockeysverige',      url: 'https://www.hockeysverige.se/rss' },
    { name: 'Hockeyexpressen',    url: 'https://www.hockeyexpressen.se/rss' },
  ],

  // ── SPORT-KÄLLOR (lokala) ────────────────────────────────────────────────
  sport_local: [
    { name: 'Barometern Sport',      url: 'https://www.barometern.se/rss/sport',      region: null },
    { name: 'Borås Tidning Sport',   url: 'https://www.bt.se/rss/sport',              region: null },
    { name: 'Corren Sport',          url: 'https://www.corren.se/rss/sport',          region: null },
    { name: 'NT Sport',              url: 'https://www.nt.se/rss/sport',              region: null },
    { name: 'Norran Sport',          url: 'https://www.norran.se/rss/sport',          region: null },
    { name: 'Norrbottens-Kuriren Sport', url: 'https://www.kuriren.nu/rss/sport',     region: null },
    { name: 'HD Sport',              url: 'https://www.hd.se/rss/sport',              region: null },
  ],

  // ── REGIONALA KÄLLOR ─────────────────────────────────────────────────────
  regional: [

    // Stockholm – utökat med fler källor
    { name: 'SVT Stockholm',      url: 'https://www.svt.se/nyheter/lokalt/stockholm/rss.xml',   region: 'Stockholm' },
    { name: 'DN Stockholm',       url: 'https://www.dn.se/rss/sthlm',                           region: 'Stockholm' },
    { name: 'Aftonbladet Stockholm', url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/', region: 'Stockholm' },
    { name: 'Mitt i Stockholm',   url: 'https://www.mitti.se/rss/nyheter',                      region: 'Stockholm' },

    // Skåne
    { name: 'SVT Skåne',          url: 'https://www.svt.se/nyheter/lokalt/skane/rss.xml',       region: 'Skåne' },
    { name: 'Sydsvenskan',        url: 'https://www.sydsvenskan.se/rss.xml',                     region: 'Skåne' },
    { name: 'HD',                 url: 'https://www.hd.se/rss.xml',                              region: 'Skåne' },
    { name: 'Kristianstadsbladet',url: 'https://www.kristianstadsbladet.se/rss.xml',             region: 'Skåne' },
    { name: 'Ystads Allehanda',   url: 'https://www.ystadsallehanda.se/rss.xml',                 region: 'Skåne' },
    { name: 'Trelleborgs Allehanda', url: 'https://www.trelleborgsallehanda.se/rss.xml',         region: 'Skåne' },

    // Västra Götaland
    { name: 'SVT Göteborg',       url: 'https://www.svt.se/nyheter/lokalt/vast/rss.xml',        region: 'Västra Götaland' },
    { name: 'GP',                 url: 'https://www.gp.se/rss/nyheter',                          region: 'Västra Götaland' },
    { name: 'Bohuslänningen',     url: 'https://www.bohuslaningen.se/rss/nyheter',               region: 'Västra Götaland' },
    { name: 'TTELA',              url: 'https://www.ttela.se/rss/nyheter',                       region: 'Västra Götaland' },
    { name: 'Borås Tidning',      url: 'https://www.bt.se/rss.xml',                              region: 'Västra Götaland' },
    { name: 'Alingsås Tidning',   url: 'https://www.alingsastidning.se/rss/nyheter',             region: 'Västra Götaland' },

    // Halland
    { name: 'SVT Halland',        url: 'https://www.svt.se/nyheter/lokalt/halland/rss.xml',     region: 'Halland' },
    { name: 'Hallandsposten',     url: 'https://www.hallandsposten.se/rss/nyheter',              region: 'Halland' },
    { name: 'Hallands Nyheter',   url: 'https://www.hn.se/rss/nyheter',                          region: 'Halland' },

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
    { name: 'Västerbottens-Kuriren', url: 'https://www.vk.se/rss/nyheter',                      region: 'Västerbotten' },

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
    { name: 'SVT Gotland',        url: 'https://www.svt.se/nyheter/lokalt/gotland/rss.xml',     region: 'Gotland' },
    { name: 'Gotlands Allehanda', url: 'https://www.helagotland.se/rss/nyheter',                region: 'Gotland' },

    // Jönköping
    { name: 'SVT Jönköping',      url: 'https://www.svt.se/nyheter/lokalt/jonkoping/rss.xml',   region: 'Jönköping' },
    { name: 'Jönköpings-Posten',  url: 'https://www.jp.se/rss/nyheter',                         region: 'Jönköping' },
    { name: 'Smålandsposten',     url: 'https://www.smp.se/rss/nyheter',                         region: 'Jönköping' },
  ]
};

const KEYWORDS = {
  sport:      ['fotboll','hockey','tennis','golf','allsvenskan','superettan','nhl','nba','vm ','em ','match','spelare','tränar','shl ','damallsvenskan','ishockey','basketboll','friidrott','simning','cykling','boxning','mma','formel'],
  naringsliv: ['börsen','aktier','ekonomi','inflation','ränta','riksbank','förvärv','vinst','omsättning','kvartalsrapport','investering','börsnot','konjunktur','tillväxt','export','import','arbetsmarknad','sysselsättning','konkurs'],
  kultur:     ['film','musik','konst','teater','bok','nobel','konsert','netflix','melodifestivalen','artist','kulturhus','tv-serie','premiär','spelfilm','dokumentär','utställning','festival','recension','årets '],
  tech:       ['ai ','artificiell intelligens','chatgpt','tech','startup','microsoft','google','apple','cybersäkerhet','hack','algoritm','openai','robot','programvara','app ','iphone','android','tesla','chipset','halvledare'],
  samhalle:   ['sjukhus','vård','1177','ambulans','skola','förskola','gymnasium','bostäder','hyresrätt','infrastruktur','järnväg','motorväg','polis','brott','rättegång','dom ','häkta','gripen','brand ','räddningstjänst','socialtjänst','äldreomsorg','migration','asyl'],
  politik:    ['riksdag','statsminister','riksdagen','socialdemokraterna','moderaterna','sverigedemokraterna','vänsterpartiet','centerpartiet','liberalerna','kristdemokraterna','miljöpartiet','partiledare','partiledardebatt','valet ','valresultat','opposition','koalition','eu-kommissionen','nato-toppmöte','regering ','regeringen','minister ','finansminister','utrikesminister','justitieminister','riksdagsvalet','kommunalvalet','riksdagsbeslut','riksdagsval','budgetpropositionen'],
  utrikes:    ['usa ','trump','biden','ryssland','kina','ukraina','mellanöstern','fn ','nato ','internationell','konflikt','gaza','israel','putin','eu ','europa','frankrike','tyskland','storbritannien','iran','nordkorea','klimat'],
};

function categorize(title, sourceName) {
  const sportSources = ['SVT Sport','Aftonbladet Sport','Expressen Sport','DN Sport','GP Sport','Sydsvenskan Sport','Fotbollskanalen','Fotbolldirekt','Hockeysverige','Hockeyexpressen','Barometern Sport','Borås Tidning Sport','Corren Sport','NT Sport','Norran Sport','Norrbottens-Kuriren Sport','HD Sport'];
  if (sportSources.includes(sourceName)) return 'sport';
  const t = title.toLowerCase();
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    if (words.some(w => t.includes(w))) return cat;
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

async function fetchSources(sources) {
  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of feed.items.slice(0, 20)) {
        if (!item.title || !item.link) continue;
        if (shouldSkip(item.title, item.link)) continue;
        await save({
          title: item.title.trim(),
          url: item.link,
          source: source.name,
          category: categorize(item.title, source.name),
          region: source.region || null,
          ingress: snippet(item),
          published_at: item.pubDate || new Date()
        });
        const kw = item.title.split(' ').find(w => w.length > 5);
        if (kw) await boost(kw);
      }
    } catch (e) {
      console.log('  \u26a0 ' + source.name + ': ' + e.message);
    }
  }
}

async function fetchAll() {
  console.log('[' + new Date().toLocaleTimeString('sv-SE') + '] Hämtar nyheter...');
  const all = [
    ...SOURCES.national,
    ...SOURCES.sport_national,
    ...SOURCES.sport_local,
    ...SOURCES.regional
  ];
  await fetchSources(all);
}

module.exports = { fetchAll, SOURCES };
