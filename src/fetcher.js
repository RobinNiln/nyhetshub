const Parser = require('rss-parser');
const { save, boost } = require('./db');

const parser = new Parser({ timeout: 8000 });

const SOURCES = [
  { name: 'SVT',         url: 'https://www.svt.se/nyheter/rss.xml',                        },
  { name: 'SR',          url: 'https://api.sr.se/api/rss/program/83?format=1'               },
  { name: 'DN',          url: 'https://www.dn.se/rss/'                                      },
  { name: 'SvD',         url: 'https://www.svd.se/feed/articles.rss'                        },
  { name: 'Aftonbladet', url: 'https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/' },
  { name: 'Expressen',   url: 'https://feeds.expressen.se/nyheter/'                         },
  { name: 'SVT Sport',   url: 'https://www.svt.se/sport/rss.xml'                            },
  { name: 'DI',          url: 'https://www.di.se/rss'                                       },
  { name: 'Breakit',     url: 'https://www.breakit.se/feed/articles'                        },
  { name: 'GP',          url: 'https://www.gp.se/rss/'                                      },
];

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

async function fetchAll() {
  console.log(`[${new Date().toLocaleTimeString('sv-SE')}] Hämtar nyheter...`);
  for (const source of SOURCES) {
    try {
      const feed = await parser.parseURL(source.url);
      for (const item of feed.items.slice(0, 15)) {
        if (!item.title || !item.link) continue;
        const category = categorize(item.title);
        await save({ title: item.title.trim(), url: item.link, source: source.name, category, published_at: item.pubDate || new Date() });
        const keyword = item.title.split(' ').find(w => w.length > 5);
        if (keyword) await boost(keyword);
      }
    } catch (e) {
      console.log(`  ⚠ ${source.name}: ${e.message}`);
    }
  }
}

module.exports = { fetchAll };
