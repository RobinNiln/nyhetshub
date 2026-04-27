const Parser = require('rss-parser');
const { save, boost } = require('./db');

const parser = new Parser({
  timeout: 8000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; Skime/1.0; +https://skime.se)'
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
    // Stampen
    { name: 'GP',                   url: 'https://www.gp.se/rss/nyheter',                              region: 'Västra Götaland' },
    { name: 'Bohuslänningen',       url: 'https://www.bohuslaningen.se/rss/nyheter',                   region: 'Västra Götaland' },
    { name: 'TTELA',                url: 'https://www.ttela.se/rss/nyheter',                           region: 'Västra Götaland' },
    // Bonnier News Local
    { name: 'Sydsvenskan',          url: 'https://www.sydsvenskan.se/rss.xml',                         region: 'Skåne' },
    { name: 'HD',                   url: 'https://www.hd.se/rss.xml',                                  region: 'Skåne' },
    { name: 'Kristianstadsbladet',  url: 'https://www.kristianstadsbladet.se/rss.xml',                 region: 'Skåne' },
    { name: 'Borås Tidning',        url: 'https://www.bt.se/rss.xml',                                  region: 'Västra Götaland' },
    // NTM
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
    // SVT lokalt
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

// Kategorier i prioritetsordning – mer specifika nyckelord först
// Varje kategori har REQUIRED-ord som MÅSTE finnas för att matcha
const CATEGORIES = [
  {
    id: 'sport',
    required: [
      'allsvenskan','superettan','premier league','serie a','la liga','bundesliga',
      'champions league','europa league','nhl','nba','nfl','vm-kval','em-kval',
      'fotbollsmatch','hockeymatch','tennismatch','golfmatch','basketmatch',
      'sm-guld','sm-final','sm-semifinal','allsvensk','djurgården','malmö ff',
      'ifk göteborg','hammarby','aik ','brommapojkarna','häcken','sirius',
      'elfsborg','kalmar ff','värnamo','mjällby','degerfors','hif','öis',
      'tre kronor','luleå hockey','frölunda','modo hockey','brynäs','rögle',
      'skellefteå aik','övergång till','transfer','landslagstruppen',
      'mål av','assist av','poäng av','rödkort','gult kort','offside',
      'halvtid','slutresultat','matcher denna','spelade i','vann mot',
      'johaug','ibrahimovic','eriksson','backstrom','hedman','lundqvist',
      'korda','mcilroy','scheffler','djokovic','nadal','federer',
      'marathon','triathlon','simning','friidrott','skidskytte','längdskidor',
      'skidåkning','backhoppning','konståkning','handboll','innebandy',
      'volleyboll','bordtennis','badminton','cykling','rodd','kanotsport'
    ]
  },
  {
    id: 'naringsliv',
    required: [
      'börsen','aktiekurs','aktier stiger','aktier faller','stockholmsbörsen',
      'nasdaq','dow jones','vinstrapport','kvartalsrapport','årsredovisning',
      'förvärvar','uppköp av','fusion med','börsnotering','ipo ',
      'inflation','räntebesked','riksbanken höjer','riksbanken sänker',
      'styrräntan','kpi ','bpi ','bnp-tillväxt','handelsbalans',
      'vd för','ny vd','avgår som vd','tillträder som vd',
      'volvo ','ericsson ','h&m ','ikea ','spotify ','klarna ',
      'saab ','atlas copco','hexagon ','telia ','swedbank ','seb ',
      'handelsbanken','nordea ','astrazeneca','investor ab',
      'vinst på','omsättning på','rörelseresultat','ebitda',
      'varslar','varsel om','permitterar','lönsamhet',
      'exporterar','importerar','handelskrig','tull på'
    ]
  },
  {
    id: 'kultur',
    required: [
      'nobelpriset','nobelprize','grammisgalan','grammis ','melodifestivalen',
      'eurovision','kulturpriset','bokmässan','litteraturpriset',
      'filmfestival','filmpremiär','ny film','ny serie','ny säsong',
      'netflix-serien','hbo-serien','svt-serien','ny bok av','debuterar med',
      'konsertturné','spelning i','album ute','singel ute','musikvideo',
      'musikalartist','ny skiva','ny låt','artist ','sångare ','regissör ',
      'skådespelare ','premiär på','teaterpremiär','dansföreställning',
      'utställning på','museum ','konstgalleri','konstpriser',
      'kulturminister','kulturnämnden','kulturanslag'
    ]
  },
  {
    id: 'tech',
    required: [
      'artificiell intelligens','ai-modell','ai-verktyg','chatgpt','openai',
      'anthropic','google gemini','microsoft copilot','meta ai',
      'startup lanserar','techbolag','techföretag','app lanseras','ny app',
      'mobiltelefon','iphone ','android ','samsung galaxy',
      'cybersäkerhet','dataintrång','hackers','ransomware','dataskydd',
      'gdpr-böter','dataskyddsbrott','it-säkerhet','nätattack',
      'kryptovaluta','bitcoin ','ethereum ','blockchain',
      'elbilar','tesla ','laddinfrastruktur','självkörande',
      'rymdfärd','spacex','nasa ','satelliter','rymdteleskop'
    ]
  },
  {
    id: 'utrikes',
    required: [
      'usa ','trump ','biden ','washington dc','vita huset','kongressen',
      'ryssland ','putin ','kreml ','ukraina ','zelenskyj',
      'kina ','xi jinping','peking ','taiwan ',
      'nato ','eu-toppmötet','eu-kommissionen','europaparlamentet',
      'fn-rådet','fn-mötet','säkerhetsrådet',
      'mellanöstern','gaza ','israel ','iran ','irak ','syrien ',
      'nordkorea ','kim jong','seoul ','tokyo ','beijing ',
      'paris ','berlin ','london ','rom ','madrid ',
      'statsbesök','utrikesminister','utrikespolitik','diplomatisk',
      'sanktioner mot','vapenvila','fredsförhandling','kriget i',
      'konflikt i','attack mot','bombning av','invasion av'
    ]
  },
  {
    id: 'politik',
    required: [
      'riksdagen','riksdagsval','riksdagsledamot','talmannen',
      'statsminister','statsråd','minister ','departement',
      'moderaterna','socialdemokraterna','sverigedemokraterna',
      'centerpartiet','vänsterpartiet','kristdemokraterna',
      'liberalerna','miljöpartiet','sd ','m ','s ','kd ','c ',
      'regeringens budget','budgetpropositionen','skattepolitik',
      'migrationspolitik','kriminalpolitik','skolpolitik',
      'sjukvårdspolitik','bostadspolitik','klimatpolitik',
      'kommunval','regionval','kommunfullmäktige','regionstyrelsen',
      'remissvar','lagstiftning','proposition om','motion om',
      'omröstning i','votering om','beslut i riksdagen'
    ]
  }
];

function categorize(title, sourceName) {
  const t = title.toLowerCase();

  // Om källan är SVT Sport → alltid sport
  if (sourceName === 'SVT Sport') return 'sport';

  // Kolla varje kategori i prioritetsordning
  for (const cat of CATEGORIES) {
    if (cat.required.some(w => t.includes(w))) return cat.id;
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
  await fetchSources([...SOURCES.national, ...SOURCES.regional]);
}

module.exports = { fetchAll, SOURCES };
