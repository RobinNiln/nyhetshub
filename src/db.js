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
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS region TEXT`);
  await pool.query(`ALTER TABLE articles ADD COLUMN IF NOT EXISTS ingress TEXT`);
  const { rows } = await pool.query(`SELECT COUNT(*) FROM articles`);
  console.log(`DB: ${rows[0].count} artiklar i databasen`);
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
    `UPDATE articles SET score = score + 1
     WHERE title ILIKE $1 AND fetched_at > NOW() - INTERVAL '3 hours'`,
    [`%${keyword}%`]
  );
}

async function get({ category, region } = {}) {
  const conditions = [`fetched_at > NOW() - INTERVAL '24 hours'`];
  const params = [];
  if (region) {
    params.push(region);
    conditions.push(`region = $${params.length}`);
  } else if (category && category !== 'alla') {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  const { rows } = await pool.query(`
    SELECT title, url, source, category, region, ingress, published_at, score
    FROM articles
    WHERE ${conditions.join(' AND ')}
    ORDER BY score DESC, published_at DESC
    LIMIT 60
  `, params);
  console.log(`get() returnerade ${rows.length} artiklar`);
  return rows;
}

async function lastFetched() {
  const { rows } = await pool.query(
    `SELECT fetched_at FROM articles ORDER BY fetched_at DESC LIMIT 1`
  );
  return rows[0]?.fetched_at || null;
}

module.exports = { init, save, boost, get, lastFetched };
