// Nyckelord per kategori
const categories = {
  sport: [
    'fotboll','hockey','tennis','golf','allsvenskan','vm','em','os',
    'olympiska','match','lag','spelare','tränar','mål','poäng','serie a',
    'premier league','nhl','nba','fifa','uefa'
  ],
  naringsliv: [
    'börsen','aktier','ekonomi','inflation','ränta','riksbank','företag',
    'vd','förvärv','vinst','omsättning','investering','marknad','handel',
    'export','import','budget','skatt','tillväxt','h&m','volvo','ericsson',
    'spotify','ikea','klarna'
  ],
  kultur: [
    'film','musik','konst','teater','bok','litteratur','nobel','grammi',
    'konsert','utställning','serie','tv','streaming','netflix','svt play',
    'melodifestivalen','eurovision','artist','regissör','författare'
  ],
  tech: [
    'ai','artificiell intelligens','teknik','teknologi','app','startup',
    'silicon','microsoft','google','apple','meta','openai','robot',
    'cybersäkerhet','hack','datasäkerhet','mjukvara','hårdvara'
  ],
  politik: [
    'riksdag','regering','minister','statsminister','parti','val','sd',
    'socialdemokraterna','moderaterna','sverigedemokraterna','mp','kd',
    'liberalerna','centerpartiet','vänsterpartiet','opposition','debatt',
    'lagstiftning','eu','nato','ukraina','kriget'
  ],
  utrikes: [
    'usa','ryssland','kina','europa','mellanöstern','nato','fn','biden',
    'trump','putin','xi','internationell','utland','global','världen',
    'krigszonen','konflikt'
  ]
};

function categorize(title) {
  const lower = title.toLowerCase();
  
  for (const [cat, keywords] of Object.entries(categories)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return cat;
    }
  }
  return 'nyheter'; // default
}

module.exports = { categorize };
