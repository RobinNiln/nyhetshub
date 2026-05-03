const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT UNIQUE NOT NULL,
      source TEXT NOT NULL,
      category TEXT DEFAULT 'nyheter',
      region TEXT,
      ingress TEXT,
      published_at TIMESTAMPTZ,
      score INTEGER DEFAULT 1,
      fetched_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS region TEXT');
  await pool.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS ingress TEXT');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS article_clicks (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      clicked_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_clicks_url ON article_clicks(url)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_clicks_time ON article_clicks(clicked_at)');
  const { rows } = await pool.query('SELECT COUNT(*) FROM articles');
  console.log('DB: ' + rows[0].count + ' artiklar i databasen');
}

async function save(article) {
  await pool.query(
    `INSERT INTO articles (title, url, source, category, region, ingress, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (url) DO NOTHING`,
    [article.title, article.url, article.source, article.category,
     article.region || null, article.ingress || null, article.published_at]
  );
}

async function boost(keyword) {
  await pool.query(
    `UPDATE articles SET score = LEAST(score + 1, 10)
     WHERE title ILIKE $1 AND fetched_at > NOW() - INTERVAL '3 hours'`,
    ['%' + keyword + '%']
  );
}

const SPORT_KEYWORDS = {
  allsvenskan: [
    'allsvenskan', 'fotbollsallsvenskan', 'allsvenskt', 'allsvenska',
    'djurgården', 'hammarby', 'malmö ff', 'ifk göteborg', 'ifk norrköping',
    'brommapojkarna', 'sirius fc', 'häcken', 'elfsborg', 'kalmar ff',
    'västerås sk', 'halmstad bk', 'mjällby', 'göteborg fc',
    'örebro sk', 'gais', 'degerfors', 'aik fotboll',
    'fotbollssäsongen', 'seriepremiär', 'fotbollsmatch',
    'allsvenska matchen', 'allsvenska tabellen'
  ],
  allsvenskan_exclude: ['hockeyallsvenskan', 'ishockey'],
  allsvenskan_exclude_sources: ['Hockeysverige', 'Hockeyexpressen'],
  damallsvenskan: [
    'damallsvenskan', 'damfotboll', 'damernas allsvenska',
    'rosengård', 'fc rosengård',
    'djurgårdens dam', 'djurgården dam',
    'hammarby dam', 'bajen dam',
    'göteborg dam', 'ikf göteborg dam',
    'linköping fc', 'lfc dam',
    'piteå if', 'piteå dam',
    'kif örebro', 'vittsjo', 'vittsjö',
    'eskilstuna united', 'eskilstuna dam',
    'damernas fotboll', 'svenska damlandslaget',
    'damfotbollen', 'damernas serie',
    'wp women', 'damernas vm'
  ],
  vm2026: [
    'vm 2026', 'fotbolls-vm', 'fotbolls vm', 'world cup 2026',
    'vm-slutspel', 'vm-gruppspel', 'vm-kval', 'vm-biljett',
    'usa 2026', 'kanada 2026', 'mexiko 2026', 'nordamerika vm',
    'fifa vm', 'fifa world cup', 'vm-trupp', 'vm-uttagen',
    'vm-premiar', 'vm-final 2026', 'världsmästerskapet 2026',
    'vm-lottning', 'vm-grupp', 'vm-match', 'vm-spel',
    'vm i fotboll', 'fotbolls-vm 2026', 'vm-biljetter',
    'vm-spelschema', 'vm-arenor', 'vm-städer',
    'trump vm', 'vm usa kanada'
  ],
  landslaget_fotboll: [
    'herrlandslaget', 'svenska landslaget', 'blågult', 'vm-kval', 'em-kval',
    'andersson tränar', 'ibrahimovic', 'landslagsuttagen',
    'svenska fotbollsförbundet', 'landslagstruppen'
  ],
  vm2026: [
    'vm 2026', 'fotbolls-vm', 'world cup 2026', 'vm-slutspel', 'vm-gruppspel',
    'vm-kval', 'vm-biljett', 'usa 2026', 'kanada 2026', 'mexiko 2026',
    'fifa vm', 'vm-trupp', 'vm-uttagen', 'vm-premiar', 'vm-final 2026',
    'fotbolls vm', 'världsmästerskapet 2026'
  ],
  shl: [
    'shl', 'swedish hockey league', 'rögle', 'skellefteå aik', 'frölunda',
    'djurgårdens hockey', 'brynäs', 'luleå hockey', 'linköping hc',
    'örebro hockey', 'färjestad', 'hv71', 'timrå', 'oskarshamn',
    'leksand', 'modo hockey', 'sm-final hockey', 'sm-guld hockey',
    'tre kronor', 'ishockeyförbundet', 'hockeyfinalen',
    'shl-säsongen', 'shl-matchen', 'hockeysäsongen', 'slutspelet hockey'
  ]
};

async function get(opts) {
  const category = opts && opts.category;
  const region = opts && opts.region;
  const sport = opts && opts.sport;

  const conditions = ["fetched_at > NOW() - INTERVAL '36 hours'"];
  const params = [];

  if (region) {
    params.push(region);
    conditions.push('region = $' + params.length);
  } else if (sport && SPORT_KEYWORDS[sport]) {
    conditions.push("category = 'sport'");
    const kws = SPORT_KEYWORDS[sport];
    const kwConditions = kws.map(function(kw) {
      params.push('%' + kw + '%');
      return 'title ILIKE $' + params.length;
    });
    conditions.push('(' + kwConditions.join(' OR ') + ')');
    const excludeKey = sport + '_exclude';
    if (SPORT_KEYWORDS[excludeKey]) {
      SPORT_KEYWORDS[excludeKey].forEach(function(kw) {
        params.push('%' + kw + '%');
        conditions.push('title NOT ILIKE $' + params.length);
      });
    }
    const excludeSourcesKey = sport + '_exclude_sources';
    if (SPORT_KEYWORDS[excludeSourcesKey]) {
      SPORT_KEYWORDS[excludeSourcesKey].forEach(function(src) {
        params.push(src);
        conditions.push('source != $' + params.length);
      });
    }
  } else if (category === 'nyheter') {
    conditions.push('region IS NULL');
    conditions.push("category != 'sport'");
  } else if (category && category !== 'alla') {
    params.push(category);
    conditions.push('category = $' + params.length);
    if (category !== 'sport') {
      conditions.push('region IS NULL');
    }
  }

  const { rows } = await pool.query(
    'SELECT title, url, source, category, region, ingress, published_at, score ' +
    'FROM articles ' +
    'WHERE ' + conditions.join(' AND ') + ' ' +
    'ORDER BY published_at DESC, score DESC ' +
    'LIMIT 400',
    params
  );

  const groups = [];
  const seen = new Map();

  for (const row of rows) {
    const key = row.title
      .toLowerCase()
      .replace(/[^a-zåäö\s]/g, '')
      .split(/\s+/)
      .slice(0, 5)
      .join(' ');

    if (seen.has(key)) {
      const group = seen.get(key);
      if (group.sources.length < 6) {
        group.sources.push({ name: row.source, url: row.url });
      }
    } else {
      const group = {
        title: row.title,
        url: row.url,
        source: row.source,
        sources: [{ name: row.source, url: row.url }],
        category: row.category,
        region: row.region,
        ingress: row.ingress,
        published_at: row.published_at,
        score: row.score
      };
      seen.set(key, group);
      groups.push(group);
    }
  }

  return groups.slice(0, 80);
}

async function lastFetched() {
  const { rows } = await pool.query(
    'SELECT fetched_at FROM articles ORDER BY fetched_at DESC LIMIT 1'
  );
  return rows[0] ? rows[0].fetched_at : null;
}

module.exports = { init, save, boost, get, lastFetched };
