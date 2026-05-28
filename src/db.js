const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── Hjälp för smartare dubblettmatchning och topprankning ──────────────

// Stoppord som inte är meningsfulla för att identifiera en story
const STOPWORDS = new Set([
  'och','att','det','som','för','har','men','inte','vid','med','till','är','de','en','ett',
  'efter','vill','blir','varit','hade','blev','kommer','nu','så','på','om','av','från',
  'kan','ska','vad','där','här','han','hon','den','dem','sig','sin','sitt','vara','också',
  'efter','före','mot','när','där','här','jag','du','vi','ni','samt','eller','utan','över',
  'under','genom','mellan','varje','alla','några','flera','ny','nya','nytt','stor','stora',
  'minst','mest','mer','mindre','andra','egen','egna','året','året','arets','årets'
]);

// Extrahera nyckelord från titel: ord > 3 tecken, ej stoppord
function extractKeywords(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-zåäö0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w));
}

// Generera matchningsnyckel: sorterade nyckelord (oberoende av ordordning)
function storyKey(title) {
  const kws = extractKeywords(title);
  // Ta upp till 6 distinkta sorterade keywords som "fingeravtryck"
  return Array.from(new Set(kws)).sort().slice(0, 6).join('|');
}

// Räkna hur många nyckelord två titlar delar
function sharedKeywords(a, b) {
  const sa = new Set(extractKeywords(a));
  let n = 0;
  for (const w of extractKeywords(b)) if (sa.has(w)) n++;
  return n;
}

// Tunga riksmedier väger mer i topprankning
const HEAVY_SOURCES = new Set([
  'SVT','SR','SR Ekot','DN','SvD','Aftonbladet','Expressen','TV4','DI','Aftonbladet Nyheter'
]);

function sourceWeight(name) {
  return HEAVY_SOURCES.has(name) ? 2 : 1;
}

// Bygg story-grupper utifrån keyword-fingeravtryck + likhetsmatchning
function buildGroups(rows) {
  const groups = [];
  const byKey = new Map();
  for (const row of rows) {
    const key = storyKey(row.title);
    if (!key) continue;
    // 1. Exakt fingeravtryck → samma story
    let group = byKey.get(key);
    // 2. Annars: leta efter befintlig grupp där minst 2 keywords överlappar
    if (!group) {
      for (const g of groups) {
        if (sharedKeywords(g.title, row.title) >= 2) { group = g; break; }
      }
    }
    if (group) {
      if (!group.sources.some(s => s.name === row.source) && group.sources.length < 6) {
        group.sources.push({ name: row.source, url: row.url });
      }
    } else {
      group = {
        title: row.title,
        url: row.url,
        source: row.source,
        sources: [{ name: row.source, url: row.url }],
        category: row.category,
        region: row.region,
        ingress: row.ingress,
        published_at: row.published_at,
        score: row.score,
        _keywords: extractKeywords(row.title)
      };
      byKey.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}

// Räkna uppföljare: andra artiklar (utanför gruppen) som delar minst 2 nyckelord
function followUpBonus(group, allRows) {
  const pubTime = new Date(group.published_at).getTime();
  const groupUrls = new Set(group.sources.map(s => s.url));
  let bonus = 0;
  for (const row of allRows) {
    if (groupUrls.has(row.url)) continue;
    const dtH = Math.abs(pubTime - new Date(row.published_at).getTime()) / (1000 * 60 * 60);
    if (dtH > 3) continue;
    if (sharedKeywords(group.title, row.title) >= 2) bonus += 0.3;
  }
  return Math.min(bonus, 2); // max 2 poäng
}

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_briefs (
      brief_date DATE NOT NULL,
      brief_type TEXT NOT NULL DEFAULT 'morning',
      content TEXT NOT NULL,
      generated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (brief_date, brief_type)
    )
  `);
  // Migrera gammal tabell utan brief_type (ignorerar om kolumnen finns)
  await pool.query("ALTER TABLE daily_briefs ADD COLUMN IF NOT EXISTS brief_type TEXT NOT NULL DEFAULT 'morning'");
  const { rows } = await pool.query('SELECT COUNT(*) FROM articles');
  console.log('DB: ' + rows[0].count + ' artiklar i databasen');
}

// Hämta topprubriker för dagens brief: gruppera och vikta som getTopStories,
// men returnera fler (15) och utan score-tröskel — för att ge AI:n bra material.
async function getTopHeadlinesForBrief() {
  const { rows } = await pool.query(
    `SELECT title, source, category, ingress, published_at
     FROM articles
     WHERE fetched_at > NOW() - INTERVAL '14 hours'
       AND published_at > NOW() - INTERVAL '14 hours'
       AND region IS NULL
       AND category NOT IN ('english','kultur','kronikor')
     ORDER BY published_at DESC
     LIMIT 400`
  );
  const groups = buildGroups(rows);
  const now = Date.now();
  const scored = groups.map(g => {
    const ageH = (now - new Date(g.published_at).getTime()) / 3600000;
    const recency = Math.max(0, 1 - ageH / 14);
    const weighted = g.sources.reduce((s, x) => s + sourceWeight(x.name), 0);
    return Object.assign({}, g, { topScore: weighted * (1 + recency) });
  });
  scored.sort((a, b) => b.topScore - a.topScore);
  return scored.slice(0, 15);
}

async function saveBrief(date, type, content) {
  await pool.query(
    `INSERT INTO daily_briefs (brief_date, brief_type, content)
     VALUES ($1, $2, $3)
     ON CONFLICT (brief_date, brief_type) DO UPDATE SET content = EXCLUDED.content, generated_at = NOW()`,
    [date, type, content]
  );
}

// Hämta senaste brief för idag (kvällsbrief om finns, annars morgonbrief)
async function getTodaysBrief() {
  const { rows } = await pool.query(
    `SELECT brief_date, brief_type, content, generated_at FROM daily_briefs
     WHERE brief_date = CURRENT_DATE
     ORDER BY generated_at DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

// Kolla om en specifik typ finns för idag
async function hasBriefToday(type) {
  const { rows } = await pool.query(
    `SELECT 1 FROM daily_briefs WHERE brief_date = CURRENT_DATE AND brief_type = $1`,
    [type]
  );
  return rows.length > 0;
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
    conditions.push('region IS NULL');
    // Exkludera lokala sport-RSS från underkategorier
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
    // Lokala sport-RSS visas aldrig på nationellt sport-flöde
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
    conditions.push("category != 'kronikor'");
    // Exkludera tydliga börsnyheter från nyhetsflödet
    const borsExclude = ['stockholmsbörsen','aktiekurs','kvartalsrapport','börsnot','omxs30'];
    borsExclude.forEach(function(w) {
      params.push('%' + w + '%');
      conditions.push('title NOT ILIKE $' + params.length);
    });
    // Exkludera sport-, kultur- och engelska källor från nationellt nyhetsflöde
    const excludedSources = [
      'Barometern Sport','Borås Tidning Sport','Corren Sport','NT Sport','Norran Sport',
      'Norrbottens-Kuriren Sport','HD Sport','NSD Sport','UNT Sport','Kvällsposten Sport',
      'GT Sport','Jönköpings-Posten Sport','Smålandsposten Sport','Nerikes Allehanda Sport',
      'Fotbolldirekt','Fotbollskanalen','Hockeysverige','Hockeyexpressen',
      'SvD Kultur','DN Kultur','Aftonbladet Kultur','Nöjesguiden','Fokus',
      'BBC News','BBC Europe','Reuters','The Guardian','AP News','Al Jazeera','New York Times','NYT World'
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
    // Exkludera börsnyheter från generellt näringsliv-flöde
    if (category === 'naringsliv') {
      const borsExclude = ['börsen','aktier','aktien','aktiekurs','kvartalsrapport','rusar','rasar','faller','stiger','lyfter','stockholmsbörsen','börsnot'];
      borsExclude.forEach(function(w) {
        params.push('%' + w + '%');
        conditions.push('title NOT ILIKE $' + params.length);
      });
    }
  }

  const { rows } = await pool.query(
    'SELECT title, url, source, category, region, ingress, published_at, score ' +
    'FROM articles ' +
    'WHERE ' + conditions.join(' AND ') + ' ' +
    'ORDER BY published_at DESC ' +
    'LIMIT 400',
    params
  );

  const groups = buildGroups(rows);
  return groups.slice(0, 80);
}

async function lastFetched() {
  const { rows } = await pool.query(
    'SELECT fetched_at FROM articles ORDER BY fetched_at DESC LIMIT 1'
  );
  return rows[0] ? rows[0].fetched_at : null;
}

async function getTopStories(category, sport) {
  const conditions = [
    "fetched_at > NOW() - INTERVAL '6 hours'",
    "published_at > NOW() - INTERVAL '6 hours'",
    'region IS NULL',
    "source NOT IN ('BBC News','BBC Europe','Reuters','The Guardian','AP News','Al Jazeera','New York Times','NYT World','SvD Kultur','DN Kultur','Aftonbladet Kultur','Nöjesguiden','Fokus')"
  ];
  const params = [];

  const localSportSources = ['Barometern Sport','Borås Tidning Sport','Corren Sport','NT Sport','Norran Sport','Norrbottens-Kuriren Sport','HD Sport','NSD Sport','UNT Sport','Kvällsposten Sport','GT Sport','Jönköpings-Posten Sport','Smålandsposten Sport','Nerikes Allehanda Sport'];

  const SPORT_KW = {
    allsvenskan: ['allsvenskan','malmö ff','djurgården','hammarby','ifk göteborg','ifk norrköping','häcken','elfsborg','kalmar ff','mjällby','gais','degerfors','brommapojkarna','västerås sk','örebro sk','halmstad bk','göteborg fc'],
    vm2026: ['vm 2026','fotbolls-vm','world cup 2026','vm-kval','vm-trupp','fifa vm','vm-lottning','vm-grupp','vm-match','fotbolls vm','världsmästerskapet 2026'],
    landslaget_fotboll: ['herrlandslaget','svenska landslaget','blågult','vm-kval','em-kval','landslagstruppen','landslagsuttagen'],
    shl: ['shl','rögle','skellefteå aik','frölunda','djurgårdens hockey','brynäs','luleå hockey','linköping hc','örebro hockey','färjestad','hv71','timrå','oskarshamn','leksand','modo hockey','sm-final hockey','tre kronor','hockeyfinalen'],
  };

  if (sport && SPORT_KW[sport]) {
    // Sport-undermeny – filtrera på nyckelord
    conditions.push("category = 'sport'");
    localSportSources.forEach(function(src) {
      params.push(src);
      conditions.push('source != $' + params.length);
    });
    // Källundantag per sport (t.ex. Hockeysverige ska aldrig synas under Allsvenskan)
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
    conditions.push("category != 'kronikor'");
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

  // Extra filter för sport-toppnyheter – blockera uppenbart icke-sport
  if (category === 'sport' || sport) {
    const nonSportWords = [
      'sanktioner','bosättare','israel','palestina','gaza','ukraina','ryssland',
      'trump','biden','eu-kommissionen','nato','riksdag','regeringen','minister',
      'börsen','aktier','inflation','ränta','skatt','budget',
      'sjukhus','cancer','virus','pandemi','vaccin',
      'brand ','olycka','mord','rättegång','häktad',
      'klimat','utsläpp'
    ];
    // Trav får aldrig vara översta toppnyheten – lägg den sist i rankingen
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

  const { rows } = await pool.query(
    'SELECT title, url, source, category, region, ingress, published_at, score ' +
    'FROM articles WHERE ' + conditions.join(' AND ') + ' ' +
    'ORDER BY published_at DESC LIMIT 400',
    params
  );

  const groups = buildGroups(rows);

  const now = Date.now();
  const scored = groups.map(function(a) {
    const ageHours = (now - new Date(a.published_at).getTime()) / (1000 * 60 * 60);
    const recencyBonus = Math.max(0, 1 - (ageHours / 6));
    // Viktat antal källor: tunga riksmedier räknas dubbelt
    const weightedSources = a.sources.reduce((sum, s) => sum + sourceWeight(s.name), 0);
    // Uppföljare: andra artiklar inom 3h som delar nyckelord
    const followBonus = followUpBonus(a, rows);
    const topScore = weightedSources * (1 + recencyBonus) + followBonus;
    return Object.assign({}, a, { topScore: topScore });
  });
  scored.sort(function(a, b) { return b.topScore - a.topScore; });
  return scored.slice(0, 5);
}

module.exports = { init, save, boost, get, lastFetched, getTopStories, getTopHeadlinesForBrief, saveBrief, getTodaysBrief, hasBriefToday };
