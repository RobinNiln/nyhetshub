const Parser = require('rss-parser');
const { saveArticle, boostScore } = require('./db');
const { categorize } = require('./categorizer');

const parser = new Parser({ timeout: 10000 });

// Svenska RSS-flöden
const SOURCES = [
  // Nyheter
  { name: 'SVT Nyheter',    url: 'https://www.svt.se/nyheter/rss.xml' },
  { name: 'SR Nyheter',     url: 'https://api.sr.se/api/rss/program/83?format=1' },
  { name: 'DN',             url: 'https://www.dn.se/rss/' },
  { name: 'SvD',            url: 'https://www.svd.se/feed/articles.rss' },
  { name: 'Aftonbladet',    url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/' },
  { name: 'Expressen',      url: 'https://feeds.expressen.se/nyheter/' },
  // Sport
  { name: 'SVT Sport',      url: 'https://www.svt.se/sport/rss.xml' },
  { name: 'Aftonbladet Sport', url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/' },
  // Näringsliv
  { name: 'DI',             url: 'https://www.di.se/rss' },
  { name: 'Breakit',        url: 'https://www.breakit.se/feed/articles' },
  // Kultur
  { name: 'SVT Kultur',     url: 'https://www.svt.se/kultur/rss.xml' },
  // Regional
  { name: 'GP',             url: 'https://www.gp.se/rss/' },
];

async function fetchAll() {
  console.log(`[${new Date().toLocaleTimeString('sv-SE')}] Hämtar nyheter...`);
  let saved = 0;

  for (const source of SOURCES) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of feed.items.slice(0, 15)) {
        if (!item.title || !item.link) continue;
        
        const category = categorize(item.title);
        const article = {
          title: item.title.trim(),
          url: item.link,
          source: source.name,
          category,
          published_at: item.pubDate || new Date().toISOString()
        };
        
        saveArticle(article);
        boostScore(item.title);
        saved++;
      }
    } catch (err) {
      console.log(`  ⚠️  ${source.name}: ${err.message}`);
    }
  }
  console.log(`  ✅ ${saved} artiklar behandlade`);
}

module.exports = { fetchAll };
