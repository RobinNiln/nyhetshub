const Parser = require('rss-parser');
const { save, boost } = require('./db');

const parser = new Parser({ timeout: 8000 });

export const SOURCES = {
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
    { name: 'GP',          url: 'https://www.gp.se/rss/',                    region: 'Västra Götaland' },
    { name: 'SVT Göteborg',url: 'https://www.svt.se/nyheter/lokalt/vast/rss.xml', region: 'Västra Götaland' },
    { name: 'Sydsvenskan', url: 'https://www.sydsvenskan.se/rss.xml',         region: 'Skåne' },
    { name: 'SVT Skåne',   url: 'https://www.svt.se/nyheter/lokalt/skane/rss.xml', region: 'Skåne' },
    { name: 'SVT Stockholm', url: 'https://www.svt.se/nyheter/lokalt/stockholm/rss.xml', region: 'Stockholm' },
    { name: 'SVT Östergötland', url: 'https://www.svt.se/nyheter/lokalt/ost/rss.xml', region: 'Östergötland' },
    { name: 'SVT Dalarna', url: 'https://www.svt.se/nyheter/lokalt/dalarna/rss.xml', region: 'Dalarna' },
    { name: 'SVT Norrbotten', url: 'https://www.svt.se/nyheter/lokalt/norrbotten/rss.xml', region: 'Norrbotten' },
    { name: 'SVT Västernorrland', url: 'https://www.svt.se/nyheter/lokalt/vasternorrland/rss.xml', region: 'Västernorrland' },
    { name: 'SVT Värmland', url: 'https://www.svt.se/nyheter/lokalt/varmland/rss.xml', region: 'Värmland' },
    { name: 'SVT Örebro',  url: 'https://www.svt.se/nyheter/lokalt/orebro/rss.xml', region: 'Örebro' },
    { name: 'SVT Uppsala', url: 'https://www.svt.se/nyheter/lokalt/uppland/rss.xml', region: 'Uppsala' },
    { name: 'Barometern',  url: 'https://www.barometern.se/rss/',             region: 'Kalmar' },
    { name: 'NT',          url: 'https://www.nt.se/rss/',                     region: 'Östergötland' },
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

async function fetchSources(sources) {
  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of feed.items.slice(0, 15)) {
        if (!item.title || !item.link) continue;
        await save({
          title: item.title.trim(),
          url: item.link,
          source: source.name,
          category: categorize(item.title),
          region: source.region || null,
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
