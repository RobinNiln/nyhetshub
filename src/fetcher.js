const Parser = require('rss-parser');
const { save, boost } = require('./db');

const parser = new Parser({
  timeout: 8000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; NyhetsHub/1.0; +https://nyhetshub.se)'
  }
});

const SKIP_PATTERNS = [
  /nyheter från dagen/i,
  /dagens nyheter i korthet/i,
  /veckans nyheter/i,
  /tipsa oss/i,
  /tipsa svt/i,
  /nyhetsbrev/i,
  /prenumerera/i,
];

function shouldSkip(title) {
  return SKIP_PATTERNS.some(p => p.test(title));
}

const SOURCES = {
  national: [
    { name: 'SVT',         url: 'https://www.svt.se/nyheter/rss.xml' },
    { name: 'SR',          url: 'https://api.sr.se/api/rss/program/83?format=1' },
    { name: 'DN',          url: 'https://www.dn.se/rss/' },
    { name: 'SvD',         url: 'https://www.svd.se/feed/articles.rss' },
    { name: 'Aftonbladet', url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/' },
    { name: 'Expressen',   url: 'https://feeds.expressen.se/nyheter/' },
    { name: 'SVT Sport',   url: 'https://www.svt.se/sport/rss.xml' },
    { name: 'DI',          url: 'https://www.di.se/rss' },
  ],
  regional: [
    // ── Stampen ───────────────────────────────────────────────────
    { name: 'GP',                   url: 'https://www.gp.se/rss/nyheter',                              region: 'Västra Götaland' },
    { name: 'Bohuslänningen',       url: 'https://www.bohuslaningen.se/rss/nyheter',                   region: 'Västra Götaland' },
    { name: 'TTELA',                url: 'https://www.ttela.se/rss/nyheter',                           region: 'Västra Götaland' },
    // ── Bonnier News Local ────────────────────────────────────────
    { name: 'Sydsvenskan',          url: 'https://www.sydsvenskan.se/rss.xml',                         region: 'Skåne' },
    { name: 'HD',                   url: 'https://www.hd.se/rss.xml',                                  region: 'Skåne' },
    { name: 'Kristianstadsbladet',  url: 'https://www.kristianstadsbladet.se/rss.xml',                 region: 'Skåne' },
    { name: 'Borås Tidning',        url: 'https://www.bt.se/rss.xml',                                  region: 'Västra Götaland' },
    // ── NTM ──────────────────────────────────────────────────────
    { name: 'NT',                   url: 'https://www.nt.se/rss/nyheter',                              region: 'Östergötland' },
    { name: 'Corren',               url: 'https://www.corren.se/rss/nyheter',                          region: 'Östergötland' },
    { name: 'MVT',                  url: 'https://www.mvt.se/rss/nyheter',                             region: 'Östergötland' },
    { name: 'Vimmerby Tidning',     url: 'https://www.vimmerbytidning.se/rss/nyheter',                 region: 'Kalmar' },
    { name: 'Västerviks-Tidningen', url: 'https://www.vt.se/rss/nyheter',                              region: 'Kalmar' },
    { name: 'Barometern',           url: 'https://www.barometern.se/rss/nyheter',                      region: 'Kalmar' },
    { name: 'Katrineholms-Kuriren', url: 'https://www.kkuriren.se/rss/nyheter',                        region: 'Södermanland' },
    { name: 'Södermanlands Nyheter',url: 'https://www.sn.se/rss/nyheter',                              region: 'Södermanland' },
    { name: 'Eskilstuna-Kuriren',   url: 'https://www.ekuriren.se/rss/nyheter',                        region: 'Södermanland' },
    { name: 'Strengnäs Tidning',    url: 'https://www.strengnastidning.se/rss/nyheter',                region: 'Södermanland' },
    { name: 'UNT',                  url: 'https://www.unt.se/rss/nyheter',                             region: 'Uppsala' },
    { name: 'Enköpings-Posten',     url: 'https://www.eposten.se/rss/nyheter',                        region: 'Uppsala' },
    { name: 'Norran',               url: 'https://www.norran.se/rss/nyheter',                          region: 'Västerbotten' },
    { name: 'Norrbottens-Kuriren',  url: 'https://www.kuriren.nu/rss/nyheter',                        region: 'Norrbotten' },
    { name: 'NSD',                  url: 'https://www.nsd.se/rss/nyheter',                             region: 'Norrbotten' },
    { name: 'Piteå-Tidningen',      url: 'https://www.pt.se/rss/nyheter',                             region: 'Norrbotten' },
    { name: 'Gotlands Allehanda',   url: 'https://www.helagotland.se/rss/nyheter',                    region: 'Gotland' },
    // ── SVT lokalt ───────────────────────────────────────────────
    { name: 'SVT Stockholm',        url: 'https://www.svt.se/nyheter/lokalt/stockholm/rss.xml',       region: 'Stockholm' },
    { name: 'SVT Skåne',            url: 'https://www.svt.se/nyheter/lokalt/skane/rss.xml',           region: 'Skåne' },
    { name: 'SVT Göteborg',         url: 'https://www.svt.se/nyheter/lokalt/vast/rss.xml',            region: 'Västra Götaland' },
    { name: 'SVT Östergötland',     url: 'https://www.svt.se/nyheter/lokalt/ost/rss.xml',             region: 'Östergötland' },
    { name: 'SVT Gotland',          url: 'https://www.svt.se/nyheter/lokalt/ost/rss.xml',             region: 'Gotland' },
    { name: 'SVT Dalarna',          url: 'https://www.svt.se/nyheter/lokalt/dalarna/rss.xml',         region: 'Dalarna' },
    { name: 'SVT Norrbotten',       url: 'https://www.svt.se/nyheter/lokalt/norrbotten/rss.xml',      region: 'Norrbotten' },
    { name: 'SVT Västernorrland',   url: 'https://www.svt.se/nyheter/lokalt/vasternorrland/rss.xml',  region: 'Västernorrland' },
    { name: 'SVT Värmland',         url: 'https://www.svt.se/nyheter/lokalt/varmland/rss.xml',        region: 'Värmland' },
    { name: 'SVT Örebro',           url: 'https://www.svt.se/nyheter/lokalt/orebro/rss.xml',          region: 'Örebro' },
    { name: 'SVT Uppsala',          url: 'https://www.svt.se/nyheter/lokalt/uppsala/rss.xml',         region: 'Uppsala' },
    { name: 'SVT Sörmland',         url: 'https://www.svt.se/nyheter/lokalt/sormland/rss.xml',        region: 'Södermanland' },
    { name: 'SVT Halland',          url: 'https://www.svt.se/nyheter/lokalt/halland/rss.xml',         region: 'Halland' },
    { name: 'SVT Blekinge',         url: 'https://www.svt.se/nyheter/lokalt/blekinge/rss.xml',        region: 'Blekinge' },
    { name: 'SVT Småland',          url: 'https://www.svt.se/nyheter/lokalt/smaland/rss.xml',         region: 'Kronoberg' },
    { name: 'SVT Gävleborg',        url: 'https://www.svt.se/nyheter/lokalt/gavleborg/rss.xml',       region: 'Gävleborg' },
    { name: 'SVT Jämtland',         url: 'https://www.svt.se/nyheter/lokalt/jamtland/rss.xml',        region: 'Jämtland' },
    { name: 'SVT Jönköping',        url: 'https://www.svt.se/nyheter/lokalt/jonkoping/rss.xml',       region: 'Jönköping' },
    { name: 'SVT Västmanland',      url: 'https://www.svt.se/nyheter/lokalt/vastmanland/rss.xml',     region: 'Västmanland' },
    { name: 'SVT Västerbotten',     url: 'https://www.svt.se/nyheter/lokalt/vasterbotten/rss.xml',    region: 'Västerbotten' },
  ]
};

const KEYWORDS = {
  sport:      ['fotboll','hockey','tennis','golf','allsvenskan','nhl','nba','vm','em','match','spelare'],
  naringsliv: ['börsen','aktier','ekonomi','inflation','ränta','riksbank','företag','förvärv','vinst'],
  kultur:     ['film','musik','konst','teater','bok','nobel','konsert','netflix','melodifestivalen'],
  tech:       ['ai','tech','app','startup','microsoft','google','apple','cybersäkerhet','hack'],
  politik:    ['riksdag','regering','minister','statsminister','parti','val','riksdagen','eu','nato'],
  utrikes:    ['usa','ryssland','kina','ukraina','mellanöstern','fn','internationell','konflikt'],
};

function categorize(title) {
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
          category: categorize(item.title),
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
  await fetchSources([...SOURCES.national, ...SOURCES.regional]);
}

module.exports = { fetchAll, SOURCES };
