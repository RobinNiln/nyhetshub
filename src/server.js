const express = require('express');
const cors = require('cors');
const path = require('path');
const { init, get, lastFetched } = require('./db');
const { fetchAll } = require('./fetcher');

const app = express();
app.use(cors());
app.use(express.static('public'));

const ALL_REGIONS = [
  'Blekinge','Dalarna','Gotland','Gävleborg','Halland',
  'Jämtland','Jönköping','Kalmar','Kronoberg','Norrbotten',
  'Skåne','Stockholm','Södermanland','Uppsala','Värmland',
  'Västerbotten','Västernorrland','Västmanland','Västra Götaland',
  'Örebro','Östergötland'
];

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
  res.json(ALL_REGIONS);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

init().then(async () => {
  await fetchAll();
  app.listen(process.env.PORT || 8080, '0.0.0.0', () => console.log('NyhetsHub live'));
}).catch(console.error);
