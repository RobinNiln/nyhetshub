const express = require('express');
const cors = require('cors');
const path = require('path');
const { init, get, lastFetched } = require('./db');
const { fetchAll, SOURCES } = require('./fetcher');

const app = express();
app.use(cors());
app.use(express.static('public'));

let fetching = false;

async function refreshIfStale() {
  if (fetching) return;
  const last = await lastFetched();
  if (!last || (Date.now() - new Date(last)) > 30 * 60 * 1000) {
    fetching = true;
    fetchAll().finally(() => { fetching = false; });
  }
}

app.get('/api/news', async (req, res) => {
  try {
    await refreshIfStale();
    const articles = await get({ category: req.query.category, region: req.query.region });
    res.json(articles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/regions', (req, res) => {
  const regions = [...new Set(SOURCES.regional.map(s => s.region))].sort();
  res.json(regions);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

init().then(async () => {
  await fetchAll();
app.listen(process.env.PORT || 8080, '0.0.0.0', () => console.log('NyhetsHub live'));
}).catch(console.error);
