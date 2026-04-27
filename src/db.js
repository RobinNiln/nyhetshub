const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../news.db'));

// Skapa tabellen om den inte finns
db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT UNIQUE NOT NULL,
    source TEXT NOT NULL,
    category TEXT DEFAULT 'nyheter',
    published_at TEXT,
    fetched_at TEXT DEFAULT (datetime('now')),
    score INTEGER DEFAULT 1
  )
`);

// Spara artikel (ignorera dubletter)
function saveArticle(article) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO articles (title, url, source, category, published_at)
    VALUES (@title, @url, @source, @category, @published_at)
  `);
  stmt.run(article);
}

// Hämta senaste nyheter per kategori
function getArticles(category = null, lang = 'sv', limit = 50) {
  let query = `
    SELECT * FROM articles 
    WHERE fetched_at > datetime('now', '-6 hours')
  `;
  if (category && category !== 'alla') {
    query += ` AND category = '${category}'`;
  }
  query += ` ORDER BY score DESC, published_at DESC LIMIT ${limit}`;
  return db.prepare(query).all();
}

// Öka poäng om flera källor rapporterar samma sak
function boostScore(title) {
  const keywords = title.split(' ').filter(w => w.length > 4).slice(0, 3);
  if (keywords.length === 0) return;
  const like = `%${keywords[0]}%`;
  db.prepare(`
    UPDATE articles SET score = score + 1 
    WHERE title LIKE ? AND fetched_at > datetime('now', '-3 hours')
  `).run(like);
}

module.exports = { saveArticle, getArticles, boostScore };
