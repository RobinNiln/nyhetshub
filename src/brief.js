// brief.js – genererar morgon- och kvällsbrief via Anthropic API
const { getTopHeadlinesForBrief, saveBrief } = require('./db');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

const PROMPTS = {
  morning: (today, list) =>
    `Du är redaktör på Skime, en svensk nyhetsaggregator. Skriv en MORGONBRIEF på svenska baserat på dagens topprubriker. Tonen är vaken och informativ.

FORMAT (strikt):
Rad 1: En kursiv intromening (max 25 ord) som sammanfattar dagen i stort.
Rad 2: tom rad
Rad 3 och framåt: 4-5 punkter, en per rad, i formatet "Plats. Mening om vad som hänt."
   - "Plats" är max 1-2 ord (t.ex. "Sverige.", "Belgien.", "Norge.", "Iran.", "USA.", "Internationellt.")
   - Meningen är högst 25 ord och saklig.

EXEMPEL:
Dagen domineras av tragedin i Belgien, kollektivtrafikförslag i Sverige och försämring för Mette-Marit.

Belgien. Fyra döda när skolbuss påkördes av tåg – två barn och två vuxna enligt belgisk minister.
Sverige. Halverat pris på kollektivtrafikens månadskort föreslås av regering och SD.
Norge. Mette-Marits hälsa försämras enligt kronprins Haakon.
Iran. Beslut om att öppna internet hävs av domstolsväsendet.

Inga rubriker, ingen markdown, inga inledningsfraser. Skriv direkt enligt formatet ovan.

Dagens datum: ${today}.

Topprubriker:
${list}`,

  evening: (today, list) =>
    `Du är redaktör på Skime, en svensk nyhetsaggregator. Skriv en KVÄLLSBRIEF på svenska baserat på dagens topprubriker. Tonen är reflekterande och översiktlig.

FORMAT (strikt):
Rad 1: En kursiv intromening (max 25 ord) som sammanfattar dagen.
Rad 2: tom rad
Rad 3 och framåt: 4-5 punkter, en per rad, i formatet "Plats. Mening om vad som hänt."
   - "Plats" är max 1-2 ord (t.ex. "Sverige.", "Belgien.", "Norge.", "Iran.", "USA.", "Internationellt.")
   - Meningen är högst 25 ord och saklig.

Inga rubriker, ingen markdown, inga inledningsfraser.

Dagens datum: ${today}.

Topprubriker:
${list}`
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
        max_tokens: 600,
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
