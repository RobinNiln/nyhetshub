// Diagnosverktyg – körs manuellt, påverkar inte sajten.
// Kör med:  node src/diagnos.js
//
// Testar varje trasig källa med tre olika strategier och visar vilken som funkar.
// Syftet är att skilja "de blockerar vår User-Agent" från "de blockerar vår server".

const { SOURCES } = require('./fetcher');

const STRATEGIER = {
  nuvarande: {
    'User-Agent': 'Mozilla/5.0 (compatible; Skime/1.0; +https://skime.se)'
  },
  webblasare: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8'
  },
  lasare: {
    'User-Agent': 'Feedly/1.0 (+http://www.feedly.com/fetcher.html; like FeedFetcher-Google)',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*'
  }
};

// Källorna som felade i loggen
const TESTA = [
  'SVT', 'SVT Sport', 'SVT Stockholm', 'SVT Norrbotten',
  'GP', 'Sydsvenskan Sport', 'Västerbottens-Kuriren',
  'Bohuslänningen', 'TTELA', 'Alingsås Tidning',
  'Hallandsposten', 'Hallands Nyheter', 'SvenskaFans'
];

async function test(url, headers) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(t);
    const text = await res.text();
    const start = text.trimStart().slice(0, 60).replace(/\s+/g, ' ');
    const arXml = /^<(\?xml|rss|feed)/i.test(text.trimStart());
    return {
      status: res.status,
      ok: res.ok && arXml,
      typ: res.headers.get('content-type') || '?',
      start,
      arXml
    };
  } catch (e) {
    return { status: 'FEL', ok: false, start: e.message, arXml: false };
  }
}

(async () => {
  const alla = [
    ...SOURCES.national, ...SOURCES.sport_national, ...SOURCES.sport_local,
    ...SOURCES.english, ...SOURCES.kultur_national, ...SOURCES.regional
  ];

  for (const namn of TESTA) {
    const s = alla.find(x => x.name === namn);
    if (!s) { console.log(`\n${namn}: hittades inte i källistan`); continue; }

    console.log(`\n═══ ${namn}`);
    console.log(`    ${s.url}`);
    for (const [strategi, headers] of Object.entries(STRATEGIER)) {
      const r = await test(s.url, headers);
      const flagga = r.ok ? '✅' : '❌';
      console.log(`    ${flagga} ${strategi.padEnd(12)} ${String(r.status).padEnd(5)} ${r.typ}`);
      if (!r.ok && r.start) console.log(`       └─ ${r.start.slice(0, 90)}`);
    }
  }
  console.log('\nKlart.');
})();
