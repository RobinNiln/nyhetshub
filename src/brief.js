// brief.js – genererar morgon- och kvällsbrief via Anthropic API
const { getTopHeadlinesForBrief, saveBrief } = require('./db');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

const PROMPTS = {
  morning: (today, list) =>
    `Du är redaktör på Skime, en svensk nyhetsaggregator. Skriv en kort, neutral och saklig MORGONBRIEF på svenska som sammanfattar nattens och dagens viktigaste händelser. Briefen ska vara 4–6 meningar lång, läsa flytande som ett stycke (inga punktlistor), och vara skriven i tredje person utan personliga åsikter. Tonen är vaken och informativ – som om läsaren just satt sig med morgonkaffet och vill veta vad som hänt.

VIKTIGT: Skriv ENDAST själva brödtexten. Ingen rubrik, ingen markdown (inga #, **, listor), inga inledningsfraser. Börja direkt med första meningen.

Dagens datum: ${today}.

Här är dagens topprubriker:

${list}

Svara endast med själva brödtexten – en ren paragraf utan formatering.`,

  evening: (today, list) =>
    `Du är redaktör på Skime, en svensk nyhetsaggregator. Skriv en kort, neutral och saklig KVÄLLSBRIEF på svenska som sammanfattar dagens viktigaste händelser. Briefen ska vara 4–6 meningar lång, läsa flytande som ett stycke (inga punktlistor), och vara skriven i tredje person utan personliga åsikter. Tonen är reflekterande och översiktlig – som en kort kvällsrapport som sammanfattar vad som format dagen.

VIKTIGT: Skriv ENDAST själva brödtexten. Ingen rubrik, ingen markdown (inga #, **, listor), inga inledningsfraser. Börja direkt med första meningen.

Dagens datum: ${today}.

Här är dagens topprubriker:

${list}

Svara endast med själva brödtexten – en ren paragraf utan formatering.`
};

async function generateBrief(type) {
  if (!type) type = 'morning';
  if (!API_KEY) { console.log('[brief] ANTHROPIC_API_KEY saknas'); return; }
  if (!PROMPTS[type]) { console.error('[brief] Okänd typ:', type); return; }

  const headlines = await getTopHeadlinesForBrief();
  if (!headlines.length) { console.log('[brief] Inga rubriker'); return; }

  const list = headlines.map((h, i) => {
    const sources = h.sources.map(s => s.name).join(', ');
    const ingress = (h.ingress || '').slice(0, 200);
    return `${i + 1}. ${h.title} (${sources})${ingress ? ' – ' + ingress : ''}`;
  }).join('\n');

  const today = new Date().toLocaleDateString('sv-SE', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

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
        messages: [{ role: 'user', content: PROMPTS[type](today, list) }]
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[brief] API-fel:', res.status, err.slice(0, 200));
      return;
    }
    const data = await res.json();
    let content = data.content && data.content[0] && data.content[0].text;
    if (!content) { console.error('[brief] Tomt svar'); return; }
    content = content
      .replace(/^#{1,6}\s.*$/gm, '')
      .replace(/\*\*/g, '')
      .replace(/^\s*\n+/, '')
      .trim();
    if (content.length < 100) { console.error('[brief] För kort'); return; }

    const dateStr = new Date().toISOString().slice(0, 10);
    await saveBrief(dateStr, type, content);
    console.log('[brief]', type, 'sparad', dateStr, '–', content.length, 'tecken');
  } catch (e) {
    console.error('[brief] Fel:', e.message);
  }
}

module.exports = { generateBrief };
