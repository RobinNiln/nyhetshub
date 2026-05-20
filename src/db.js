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
  // NYTT: källviktning lagras med varje artikel
  await pool.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS source_weight REAL DEFAULT 1');

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
  // Kontrollera max 20 artiklar per källa i databasen
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) FROM articles WHERE source = $1 AND fetched_at > NOW() - INTERVAL '36 hours'`,
    [article.source]
  );
  if (parseInt(countRows[0].count) >= 20) return;

  // NYTT: sparar även source_weight (default 1 om inget skickas)
  await pool.query(
    `INSERT INTO articles (title, url, source, category, region, ingress, published_at, source_weight)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (url) DO NOTHING`,
    [article.title, article.url, article.source, article.category,
     article.region || null, article.ingress || null, article.published_at,
     article.source_weight || 1]
  );
}

async function boost(keyword) {
  await pool.query(
    `UPDATE articles SET score = LEAST(score + 1, 10)
     WHERE title ILIKE $1 AND fetched_at > NOW() - INTERVAL '3 hours'`,
    ['%' + keyword + '%']
  );
}

// ── TIER-1 KÄLLOR ────────────────────────────────────────────────────────────
// "Sanningskällor" – minst en av dessa måste rapportera om något
// för att artikeln ska kunna bli toppnyhet
const TIER_1_SOURCES = new Set([
  'TT', 'TT Nyhetsbyrån',
  'SVT', 'SVT Nyheter', 'SR', 'Sveriges Radio',
  'BBC News', 'BBC',
  'Reuters', 'AP News', 'AP',
  'DN', 'Dagens Nyheter',
  'SvD', 'Svenska Dagbladet'
]);

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
    conditions.push('region IS NULL');
    const localSportSources = ['Barometern Sport','Borås Tidning Sport','Corren Sport','NT Sport','Norran Sport','Norrbottens-Kuriren Sport','HD Sport','NSD Sport','UNT Sport','Kvällsposten Sport','GT Sport','Jönköpings-Posten Sport','Smålandsposten Sport','Nerikes Allehanda Sport'];
    localSportSources.forEach(function(src) {
      params.push(src);
      conditions.push('source != $' + params.length);
    });
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
  } else if (category === 'sport') {
    conditions.push("category = 'sport'");
    conditions.push('region IS NULL');
    const localSportSources = ['Barometern Sport','Borås Tidning Sport','Corren Sport','NT Sport','Norran Sport','Norrbottens-Kuriren Sport','HD Sport','NSD Sport','UNT Sport','Kvällsposten Sport','GT Sport','Jönköpings-Posten Sport','Smålandsposten Sport','Nerikes Allehanda Sport'];
    localSportSources.forEach(function(src) {
      params.push(src);
      conditions.push('source != $' + params.length);
    });
  } else if (category === 'bors') {
    conditions.push('region IS NULL');
    const borsWords = ['börsen','aktier','aktien','aktiekurs','rapport','kvartalsrapport','rusar','rasar','faller','stiger','lyfter','analytiker','börsnot','stockholmsbörsen','omxs','nasdaq','warranter','fonder'];
    const borsConditions = borsWords.map(function(w) {
      params.push('%' + w + '%');
      return 'title ILIKE $' + params.length;
    });
    conditions.push('(' + borsConditions.join(' OR ') + ')');
  } else if (category === 'nyheter') {
    conditions.push('region IS NULL');
    conditions.push("category != 'sport'");
    conditions.push("category != 'english'");
    conditions.push("category != 'kultur'");
    const borsExclude = ['börsen','aktier','aktien','aktiekurs','kvartalsrapport','rusar','rasar','faller','stiger','lyfter','stockholmsbörsen'];
    borsExclude.forEach(function(w) {
      params.push('%' + w + '%');
      conditions.push('title NOT ILIKE $' + params.length);
    });
    const excludedSources = [
      'Barometern Sport','Borås Tidning Sport','Corren Sport','NT Sport','Norran Sport',
      'Norrbottens-Kuriren Sport','HD Sport','NSD Sport','UNT Sport','Kvällsposten Sport',
      'GT Sport','Jönköpings-Posten Sport','Smålandsposten Sport','Nerikes Allehanda Sport',
      'Fotbolldirekt','Fotbollskanalen','Hockeysverige','Hockeyexpressen',
      'SvD Kultur','DN Kultur','Nöjesguiden','Fokus'
    ];
    excludedSources.forEach(function(src) {
      params.push(src);
      conditions.push('source != $' + params.length);
    });
  } else if (category && category !== 'alla') {
    params.push(category);
    conditions.push('category = $' + params.length);
    if (category !== 'sport' && category !== 'english') {
      conditions.push('region IS NULL');
      conditions.push("category != 'english'");
    }
    if (category === 'naringsliv') {
      const borsExclude = ['börsen','aktier','aktien','aktiekurs','kvartalsrapport','rusar','rasar','faller','stiger','lyfter','stockholmsbörsen','börsnot'];
      borsExclude.forEach(function(w) {
        params.push('%' + w + '%');
        conditions.push('title NOT ILIKE $' + params.length);
      });
    }
  }

  // NYTT: hämta även source_weight för viktning
  const { rows } = await pool.query(
    'SELECT title, url, source, category, region, ingress, published_at, score, source_weight ' +
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
      const sourceExists = group.sources.some(s => s.name === row.source);
      if (!sourceExists && group.sources.length < 6) {
        group.sources.push({ name: row.source, url: row.url });
      }
    } else {
      const group = {
        title: row.title,
        url: row.url,
        source: row.source,
        sources: [{ name: row.source, url: row.url, weight: row.source_weight || 1 }],
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

async function getTopStories(category, sport) {
  const isSportSub = !!sport;
  const scoreThreshold = isSportSub ? 0 : 1;
  const conditions = ["fetched_at > NOW() - INTERVAL '6 hours'", 'region IS NULL', 'score >= ' + scoreThreshold];
  const params = [];

  const localSportSources = ['Barometern Sport','Borås Tidning Sport','Corren Sport','NT Sport','Norran Sport','Norrbottens-Kuriren Sport','HD Sport','NSD Sport','UNT Sport','Kvällsposten Sport','GT Sport','Jönköpings-Posten Sport','Smålandsposten Sport','Nerikes Allehanda Sport'];

  const SPORT_KW = {
    allsvenskan: ['allsvenskan','malmö ff','djurgården','hammarby','ifk göteborg','ifk norrköping','häcken','elfsborg','kalmar ff','mjällby','gais','degerfors','brommapojkarna','västerås sk','örebro sk','halmstad bk','göteborg fc'],
    vm2026: ['vm 2026','fotbolls-vm','world cup 2026','vm-kval','vm-trupp','fifa vm','vm-lottning','vm-grupp','vm-match','fotbolls vm','världsmästerskapet 2026'],
    landslaget_fotboll: ['herrlandslaget','svenska landslaget','blågult','vm-kval','em-kval','landslagstruppen','landslagsuttagen'],
    shl: ['shl','rögle','skellefteå aik','frölunda','djurgårdens hockey','brynäs','luleå hockey','linköping hc','örebro hockey','färjestad','hv71','timrå','oskarshamn','leksand','modo hockey','sm-final hockey','tre kronor','hockeyfinalen'],
  };

  if (sport && SPORT_KW[sport]) {
    conditions.push("category = 'sport'");
    localSportSources.forEach(function(src) {
      params.push(src);
      conditions.push('source != $' + params.length);
    });
    const sportExcludeSources = {
      allsvenskan: ['Hockeysverige','Hockeyexpressen'],
    };
    if (sportExcludeSources[sport]) {
      sportExcludeSources[sport].forEach(function(src) {
        params.push(src);
        conditions.push('source != $' + params.length);
      });
    }
    const kwConds = SPORT_KW[sport].map(function(kw) {
      params.push('%' + kw + '%');
      return 'title ILIKE $' + params.length;
    });
    conditions.push('(' + kwConds.join(' OR ') + ')');
  } else if (category && category !== 'nyheter') {
    params.push(category);
    conditions.push('category = $' + params.length);
    localSportSources.forEach(function(src) {
      params.push(src);
      conditions.push('source != $' + params.length);
    });
  } else {
    conditions.push("category != 'sport'");
    conditions.push("category != 'english'");
    conditions.push("category != 'kultur'");
    const excludedSources = [
      ...localSportSources,
      'Fotbolldirekt','Fotbollskanalen','Hockeysverige','Hockeyexpressen',
      'SvD Kultur','DN Kultur','Nöjesguiden','Fokus'
    ];
    excludedSources.forEach(function(src) {
      params.push(src);
      conditions.push('source != $' + params.length);
    });
  }

  if (category === 'sport' || sport) {
    const nonSportWords = [
      'sanktioner','bosättare','israel','palestina','gaza','ukraina','ryssland',
      'trump','biden','eu-kommissionen','nato','riksdag','regeringen','minister',
      'börsen','aktier','inflation','ränta','skatt','budget',
      'sjukhus','cancer','virus','pandemi','vaccin',
      'brand ','olycka','mord','rättegång','häktad',
      'klimat','utsläpp'
    ];
    const travWords = ['trav','travet','travhäst','v75','v86','v64','jackpot trav','solvalla','åby','jägersro','bergsåker'];
    nonSportWords.forEach(function(w) {
      params.push('%' + w + '%');
      conditions.push('title NOT ILIKE $' + params.length);
    });
    travWords.forEach(function(w) {
      params.push('%' + w + '%');
      conditions.push('title NOT ILIKE $' + params.length);
    });
  }

  // NYTT: hämta även source_weight
  const { rows } = await pool.query(
    'SELECT title, url, source, category, region, ingress, published_at, score, source_weight ' +
    'FROM articles WHERE ' + conditions.join(' AND ') + ' ' +
    'ORDER BY published_at DESC, score DESC LIMIT 400',
    params
  );

  const groups = [];
  const seen = new Map();
  for (const row of rows) {
    const key = row.title.toLowerCase().replace(/[^a-zåäö\s]/g, '').split(/\s+/).slice(0, 5).join(' ');
    if (seen.has(key)) {
      const group = seen.get(key);
      const sourceExists = group.sources.some(s => s.name === row.source);
      if (!sourceExists && group.sources.length < 6) {
        group.sources.push({ name: row.source, url: row.url, weight: row.source_weight || 1 });
      }
    } else {
      const group = {
        title: row.title, url: row.url, source: row.source,
        sources: [{ name: row.source, url: row.url, weight: row.source_weight || 1 }],
        category: row.category, region: row.region, ingress: row.ingress,
        published_at: row.published_at, score: row.score
      };
      seen.set(key, group);
      groups.push(group);
    }
  }

  // ── NY TOPP-ALGORITM MED KÄLLVIKTNING ───────────────────────────────────
  const now = Date.now();
  const isMainNews = !category || category === 'nyheter' || category === 'alla';

  const scored = groups.map(function(a) {
    const ageHours = (now - new Date(a.published_at).getTime()) / (1000 * 60 * 60);
    const recencyBonus = Math.max(0, 1 - (ageHours / 6));

    // SUMMAN av källornas vikter istället för bara antal
    // Tier 1 (SVT/TT/SR) = 3, Tier 2 (DN/SvD/GP) = 2, småsajter = 1, Google News = 0.5
    const weightedSourceScore = a.sources.reduce(function(sum, s) {
      return sum + (s.weight || 1);
    }, 0);

    // Kolla om någon Tier-1-källa finns med
    const hasTier1 = a.sources.some(function(s) {
      return TIER_1_SOURCES.has(s.name);
    });

    return Object.assign({}, a, {
      topScore: weightedSourceScore * (1 + recencyBonus),
      hasTier1: hasTier1
    });
  });

  // FÖR HUVUDNYHETER: kräv att minst en Tier-1-källa rapporterar
  // (Detta gäller inte sport eller specifika kategorier)
  let filtered = scored;
  if (isMainNews) {
    filtered = scored.filter(function(a) { return a.hasTier1; });
    // Säkerhetsnät: om filtret tar bort allt, använd ofiltrerade resultat
    if (filtered.length < 2) filtered = scored;
  }

  filtered.sort(function(a, b) { return b.topScore - a.topScore; });

  // ── PER-KÄLLA-TAK: max 2 artiklar från samma "huvudkälla" i toppen ──
  // Förhindrar att DN eller liknande dominerar
  const sourceCount = {};
  const capped = [];
  for (const article of filtered) {
    const primarySource = article.source;
    sourceCount[primarySource] = (sourceCount[primarySource] || 0) + 1;
    if (sourceCount[primarySource] <= 2) {
      capped.push(article);
    }
    if (capped.length >= 5) break;
  }

  return capped.slice(0, 5);
}

module.exports = { init, save, boost, get, lastFetched, getTopStories };
