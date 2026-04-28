const Parser = require('rss-parser');
const { save, boost } = require('./db');

const parser = new Parser({
  timeout: 8000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Skime/1.0; +https://skime.se)' }
});

const SKIP_PATTERNS = [
  /nyheter från dagen/i,
  /dagens nyheter i korthet/i,
  /veckans nyheter/i,
  /tipsa oss/i, /tipsa svt/i,
  /nyhetsbrev/i, /prenumerera/i,
  /kontakta svt/i,
  /kvadratmeter.*s(å|a)l(d|t)/i,
  /s(å|a)l(d|t) för.*kronor/i,
  /fastighetsaffär/i,
  /priset.*kronor/i,
  /startar nytt.*företag/i,
  /nystartat.*företag/i,
  /nytt.*företag startar/i,
  /registrerades.*bolagsverket/i,
  /startades \d+ /i,
  /nyetablering/i,
  /får tillskott.*nytt företag/i,
  /vi sänder.*matcher/i,
  /vi fortsätter sända/i,
  /glädjebeskedet.*sänder/i,
  /följ.*snacket/i,
  /hockeysnacket/i,
  /insändare\./i,
];

function shouldSkip(title) {
  return SKIP_PATTERNS.some(p => p.test(title));
}

const SOURCES = {

  // ── NATIONELLA KÄLLOR ─────────────────────────────────────────────────────
  // Visas under "Nyheter" nationellt. GP och Sydsvenskan ingår här.
  national: [
    { name: 'SVT',          url: 'https://www.svt.se/nyheter/rss.xml' },
    { name: 'SR',           url: 'https://api.sr.se/api/rss/program/83?format=1' },
    { name: 'DN',           url: 'https://www.dn.se/rss/' },
    { name: 'SvD',          url: 'https://www.svd.se/feed/articles.rss' },
    { name: 'Aftonbladet',  url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/' },
    { name: 'Expressen',    url: 'https://feeds.expressen.se/nyheter/' },
    { name: 'DI',           url: 'https://www.di.se/rss' },
    { name: 'Breakit',      url: 'https://www.breakit.se/feed/articles' },
    { name: 'GP',           url: 'https://www.gp.se/rss/nyheter' },
    { name: 'Sydsvenskan',  url: 'https://www.sydsvenskan.se/rss.xml' },
    { name: 'TV4',          url: 'https://www.tv4.se/rss' },
  ],

  // ── SPORT-KÄLLOR (nationella) ─────────────────────────────────────────────
  sport_national: [
    { name: 'SVT Sport',        url: 'https://www.svt.se/sport/rss.xml' },
    { name: 'Aftonbladet Sport', url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/' },
    { name: 'Expressen Sport',  url: 'https://feeds.expressen.se/sport/' },
    { name: 'DN Sport',         url: 'https://www.dn.se/rss/sport' },
  ],

  // ── REGIONALA KÄLLOR ──────────────────────────────────────────────────────
  regional: [

    // Stockholm
    { name: 'SVT Stockholm',      url: 'https://www.svt.se/nyheter/lokalt/stockholm/rss.xml',       region: 'Stockholm' },
    { name: 'DN Stockholm',       url: 'https://www.dn.se/rss/sthlm',                               region: 'Stockholm' },

    // Skåne
    { name: 'SVT Skåne',          url: 'https://www.svt.se/nyheter/lokalt/skane/rss.xml',           region: 'Skåne' },
    { name: 'Sydsvenskan',        url: 'https://www.sydsvenskan.se/rss.xml',                         region: 'Skåne' },
    { name: 'HD',                 url: 'https://www.hd.se/rss.xml',                                  region: 'Skåne' },
    { name: 'Kristianstadsbladet',url: 'https://www.kristianstadsbladet.se/rss.xml',                 region: 'Skåne' },
    { name: 'Kvällsposten',       url: 'https://www.kvallsposten.se/rss.xml',                        region: 'Skåne' },
    { name: 'Ystads Allehanda',   url: 'https://www.ystadsallehanda.se/rss.xml',                     region: 'Skåne' },
    { name: 'Trelleborgs Allehanda', url: 'https://www.trelleborgsallehanda.se/rss.xml',             region: 'Skåne' },

    // Västra Götaland
    { name: 'SVT Göteborg',       url: 'https://www.svt.se/nyheter/lokalt/vast/rss.xml',            region: 'Västra Götaland' },
    { name: 'GP',                 url: 'https://www.gp.se/rss/nyheter',                              region: 'Västra Götaland' },
    { name: 'Bohuslänningen',     url: 'https://www.bohuslaningen.se/rss/nyheter',                   region: 'Västra Götaland' },
    { name: 'TTELA',              url: 'https://www.ttela.se/rss/nyheter',                           region: 'Västra Götaland' },
    { name: 'Borås Tidning',      url: 'https://www.bt.se/rss.xml',                                  region: 'Västra Götaland' },
    { name: 'Strömstads Tidning', url: 'https://www.stromstadstidning.se/rss/nyheter',               region: 'Västra Götaland' },
    { name: 'Alingsås Tidning',   url: 'https://www.alingsastidning.se/rss/nyheter',                 region: 'Västra Götaland' },

    // Halland
    { name: 'SVT Halland',        url: 'https://www.svt.se/nyheter/lokalt/halland/rss.xml',         region: 'Halland' },
    { name: 'Hallandsposten',     url: 'https://www.hallandsposten.se/rss/nyheter',                  region: 'Halland' },
    { name: 'Hallands Nyheter',   url: 'https://www.hn.se/rss/nyheter',                              region: 'Halland' },

    // Östergötland
    { name: 'SVT Östergötland',   url: 'https://www.svt.se/nyheter/lokalt/ost/rss.xml',             region: 'Östergötland' },
    { name: 'NT',                 url: 'https://www.nt.se/rss/nyheter',                              region: 'Östergötland' },
    { name: 'Corren',             url: 'https://www.corren.se/rss/nyheter',                          region: 'Östergötland' },
    { name: 'MVT',                url: 'https://www.mvt.se/rss/nyheter',                             region: 'Östergötland' },

    // Södermanland
    { name: 'SVT Sörmland',       url: 'https://www.svt.se/nyheter/lokalt/sormland/rss.xml',        region: 'Södermanland' },
    { name: 'Katrineholms-Kuriren', url: 'https://www.kkuriren.se/rss/nyheter',                      region: 'Södermanland' },
    { name: 'Södermanlands Nyheter', url: 'https://www.sn.se/rss/nyheter',                           region: 'Södermanland' },
    { name: 'Eskilstuna-Kuriren', url: 'https://www.ekuriren.se/rss/nyheter',                        region: 'Södermanland' },
    { name: 'Strengnäs Tidning',  url: 'https://www.strengnastidning.se/rss/nyheter',                region: 'Södermanland' },

    // Uppsala
    { name: 'SVT Uppsala',        url: 'https://www.svt.se/nyheter/lokalt/uppsala/rss.xml',         region: 'Uppsala' },
    { name: 'UNT',                url: 'https://www.unt.se/rss/nyheter',                             region: 'Uppsala' },
    { name: 'Enköpings-Posten',   url: 'https://www.eposten.se/rss/nyheter',                        region: 'Uppsala' },

    // Dalarna
    { name: 'SVT Dalarna',        url: 'https://www.svt.se/nyheter/lokalt/dalarna/rss.xml',         region: 'Dalarna' },
    { name: 'Dala-Demokraten',    url: 'https://www.dalademokraten.se/rss/nyheter',                  region: 'Dalarna' },
    { name: 'Falukuriren',        url: 'https://www.falukuriren.se/rss/nyheter',                     region: 'Dalarna' },

    // Gävleborg
    { name: 'SVT Gävleborg',      url: 'https://www.svt.se/nyheter/lokalt/gavleborg/rss.xml',       region: 'Gävleborg' },
    { name: 'Gefle Dagblad',      url: 'https://www.gd.se/rss/nyheter',                              region: 'Gävleborg' },
    { name: 'Arbetarbladet',      url: 'https://www.arbetarbladet.se/rss/nyheter',                   region: 'Gävleborg' },

    // Västmanland
    { name: 'SVT Västmanland',    url: 'https://www.svt.se/nyheter/lokalt/vastmanland/rss.xml',     region: 'Västmanland' },
    { name: 'Vestmanlands Läns Tidning', url: 'https://www.vlt.se/rss/nyheter',                     region: 'Västmanland' },

    // Örebro
    { name: 'SVT Örebro',         url: 'https://www.svt.se/nyheter/lokalt/orebro/rss.xml',          region: 'Örebro' },
    { name: 'Nerikes Allehanda',  url: 'https://www.na.se/rss/nyheter',                              region: 'Örebro' },

    // Värmland
    { name: 'SVT Värmland',       url: 'https://www.svt.se/nyheter/lokalt/varmland/rss.xml',        region: 'Värmland' },
    { name: 'Värmlands Folkblad', url: 'https://www.vf.se/rss/nyheter',                              region: 'Värmland' },
    { name: 'NWT',                url: 'https://www.nwt.se/rss/nyheter',                             region: 'Värmland' },

    // Jämtland
    { name: 'SVT Jämtland',       url: 'https://www.svt.se/nyheter/lokalt/jamtland/rss.xml',        region: 'Jämtland' },
    { name: 'Östersunds-Posten',  url: 'https://www.op.se/rss/nyheter',                              region: 'Jämtland' },
    { name: 'Länstidningen Östersund', url: 'https://www.ltz.se/rss/nyheter',                        region: 'Jämtland' },

    // Västernorrland
    { name: 'SVT Västernorrland', url: 'https://www.svt.se/nyheter/lokalt/vasternorrland/rss.xml',  region: 'Västernorrland' },
    { name: 'Sundsvalls Tidning', url: 'https://www.st.nu/rss/nyheter',                              region: 'Västernorrland' },
    { name: 'Härnösands-Posten',  url: 'https://www.harnosandsposten.se/rss/nyheter',                region: 'Västernorrland' },

    // Västerbotten
    { name: 'SVT Västerbotten',   url: 'https://www.svt.se/nyheter/lokalt/vasterbotten/rss.xml',    region: 'Västerbotten' },
    { name: 'Norran',             url: 'https://www.norran.se/rss/nyheter',                          region: 'Västerbotten' },
    { name: 'Västerbottens-Kuriren', url: 'https://www.vk.se/rss/nyheter',                          region: 'Västerbotten' },

    // Norrbotten
    { name: 'SVT Norrbotten',     url: 'https://www.svt.se/nyheter/lokalt/norrbotten/rss.xml',      region: 'Norrbotten' },
    { name: 'Norrbottens-Kuriren',url: 'https://www.kuriren.nu/rss/nyheter',                        region: 'Norrbotten' },
    { name: 'NSD',                url: 'https://www.nsd.se/rss/nyheter',                             region: 'Norrbotten' },
    { name: 'Piteå-Tidningen',    url: 'https://www.pt.se/rss/nyheter',                             region: 'Norrbotten' },

    // Kalmar
    { name: 'SVT Småland',        url: 'https://www.svt.se/nyheter/lokalt/smaland/rss.xml',         region: 'Kalmar' },
    { name: 'Barometern',         url: 'https://www.barometern.se/rss/nyheter',                      region: 'Kalmar' },
    { name: 'Vimmerby Tidning',   url: 'https://www.vimmerbytidning.se/rss/nyheter',                 region: 'Kalmar' },
    { name: 'Västerviks-Tidningen', url: 'https://www.vt.se/rss/nyheter',                           region: 'Kalmar' },

    // Kronoberg
    { name: 'SVT Kronoberg',      url: 'https://www.svt.se/nyheter/lokalt/smaland/rss.xml',         region: 'Kronoberg' },
    { name: 'Smålandsposten',     url: 'https://www.smp.se/rss/nyheter',                             region: 'Kronoberg' },
    { name: 'Smålänningen',       url: 'https://www.smalanningen.se/rss/nyheter',                   region: 'Kronoberg' },

    // Blekinge
    { name: 'SVT Blekinge',       url: 'https://www.svt.se/nyheter/lokalt/blekinge/rss.xml',        region: 'Blekinge' },
    { name: 'Blekinge Läns Tidning', url: 'https://www.blt.se/rss/nyheter',                         region: 'Blekinge' },

    // Gotland
    { name: 'SVT Gotland',        url: 'https://www.svt.se/nyheter/lokalt/gotland/rss.xml',         region: 'Gotland' },
    { name: 'Gotlands Allehanda', url: 'https://www.helagotland.se/rss/nyheter',                    region: 'Gotland' },

    // Jönköping
    { name: 'SVT Jönköping',      url: 'https://www.svt.se/nyheter/lokalt/jonkoping/rss.xml',       region: 'Jönköping' },
    { name: 'Jönköpings-Posten',  url: 'https://www.jp.se/rss/nyheter',                             region: 'Jönköping' },
    { name: 'Smålandsposten',     url: 'https://www.smp.se/rss/nyheter',                             region: 'Jönköping' },
  ]
};

const KEYWORDS = {
  sport:      ['fotboll','hockey','tennis','golf','allsvenskan','superettan','nhl','nba','vm ','em ','match','spelare','tränar','lag ','shl ','damallsvenskan'],
  naringsliv: ['börsen','aktier','ekonomi','inflation','ränta','riksbank','företag','förvärv','vinst','omsättning'],
  kultur:     ['film','musik','konst','teater','bok','nobel','konsert','netflix','melodifestivalen','artist'],
  tech:       ['ai ','artificiell intelligens','chatgpt','tech','app ','startup','microsoft','google','apple','cybersäkerhet','hack'],
  politik:    ['riksdag','regering','minister','statsminister','parti','val ','riksdagen','eu ','nato '],
  utrikes:    ['usa ','trump','biden','ryssland','kina','ukraina','mellanöstern','fn ','nato ','internationell','konflikt'],
};

function categorize(title, sourceName) {
  if (sourceName === 'SVT Sport' || sourceName === 'Aftonbladet Sport' || sourceName === 'Expressen Sport' || sourceName === 'DN Sport') return 'sport';
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
  return sentence ? sentence[0].trim() : clean.slice(0, 120);
}

async function fetchSources(sources) {
  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of feed.items.slice(0, 15)) {
        if (!item.title || !item.link) continue;
        if (shouldSkip(item.title)) continue;
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
      console.log(`  ⚠ ${source.name}: ${e.message}`);
    }
  }
}

async function fetchAll() {
  console.log(`[${new Date().toLocaleTimeString('sv-SE')}] Hämtar nyheter...`);
  const all = [
    ...SOURCES.national,
    ...SOURCES.sport_national,
    ...SOURCES.regional
  ];
  await fetchSources(all);
}

module.exports = { fetchAll, SOURCES };
