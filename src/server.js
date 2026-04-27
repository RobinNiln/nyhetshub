const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const { init, get } = require('./db');
const { fetchAll } = require('./fetcher');

const app = express();
app.use(cors());
app.use(express.static('public'));

app.get('/api/news', async (req, res) => {
  try {
    const articles = await get(req.query.category);
    res.json(articles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

cron.schedule('*/20 * * * *', fetchAll);

init().then(async () => {
  await fetchAll();
  app.listen(process.env.PORT || 3000, () => {
    console.log('NyhetsHub live');
  });
}).catch(console.error);
