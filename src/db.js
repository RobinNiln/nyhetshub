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
      published_at TIMESTAMPTZ,
      score INTEGER DEFAULT 1,
      fetched_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function save(article) {
  await pool.query(
    `INSERT INTO articles (title, url, source, category, published_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (url) DO NOTHING`,
    [article.title, article.url, article.source, article.category, article.published_at]
  );
}

async function boost(keyword) {
  await pool.query(
    `UPDATE articles SET score = score + 1
     WHERE title ILIKE $1 AND fetched_at > NOW() - INTERVAL '3 hours'`,
    [`%${keyword}%`]
  );
}

async function get(category) {
  const where = category && category !== 'alla'
    ? `AND category = '${category}'` : '';
  const { rows } = await pool.query(`
    SELECT title, url, source, category, published_at, score
    FROM articles
    WHERE fetched_at > NOW() - INTERVAL '6 hours'
    ${where}
    ORDER BY score DESC, published_at DESC
    LIMIT 60
  `);
  return rows;
}

module.exports = { init, save, boost, get };
