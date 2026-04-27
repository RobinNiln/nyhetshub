const express = require('express');
const cron = require('node-cron');
const cors = require('cors');
const path = require('path');
const { fetchAll } = require('./fetcher');
const { getArticles } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

// API
app.get('/api/news', (req, res) => {
  const { category } = req.query;
  const articles = getArticles(category);
  res.json(articles);
});

// Servera HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Hämta nyheter var 20:e minut
cron.schedule('*/20 * * * *', fetchAll);

// Starta
app.listen(PORT, async () => {
  console.log(`NyhetsHub körs på port ${PORT}`);
  await fetchAll();
});
