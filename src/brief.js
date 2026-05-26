// brief.js – genererar dagens nyhetsbrief via Anthropic API
const { getTopHeadlinesForBrief, saveBrief } = require('./db');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

async function generateBrief() {
  if (!API_KEY) {
    console.log('[brief] ANTHROPIC_API_KEY saknas – hoppar över');
    return;
  }

  const headlines = await getTopHeadlinesForBrief();
  if (!headlines.length) {
    console.log('[brief] Inga rubriker att sammanfatta');
    return;
  }

  // Formatera rubrikerna för promten
  const list = headlines.map((h, i) => {
    const sources = h.sources.map(s => s.name).join(', ');
    const ingress = (h.ingress || '').slice(0, 200);
    return `${i + 1}. ${h.title} (${sources})${ingress ? ' – ' + ingress : ''}`;
  }).join('\n');

  const today = new Date().toLocaleDateString('sv-SE', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  const prompt = `Du är redaktör på Skime, en svensk nyhetsaggregator. Skriv en kort, neutral och saklig morgonbrief på svenska som sammanfattar dagens viktigaste nyheter. Briefen ska vara 4–6 meningar lång, läsa flytande som ett stycke (inga punktlistor), och vara skriven i tredje person utan personliga åsikter.

Dagens datum: ${today}.

Här är dagens topprubriker:

${list}

Skriv briefen direkt utan inledningsfraser som "Här är dagens brief". Börja direkt med innehållet.`;

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[brief] API-fel:', res.status, err.slice(0, 200));
      return;
    }

    const data = await res.json();
    const content = data.content?.[0]?.text?.trim();
    if (!content || content.length < 100) {
      console.error('[brief] Svar för kort eller tomt');
      return;
    }

    // Spara med dagens datum (lokal tid)
    const today = new Date().toISOString().slice(0, 10);
    await saveBrief(today, content);
    console.log('[brief] Sparad för', today, '–', content.length, 'tecken');
  } catch (e) {
    console.error('[brief] Fel:', e.message);
  }
}

module.exports = { generateBrief };
