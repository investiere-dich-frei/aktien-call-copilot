// Claude als Co-Trainer: beantwortet eine erkannte Frage aus der Wissensdatenbank.
// Anweisung (SYSTEM) und Antwortformat (Hinweis) stehen nur hier.
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

export const MODELL = process.env.COPILOT_MODEL || 'claude-opus-5-5';

export const SYSTEM = `Du bist der Co-Trainer der Person, die den Call leitet (Emilia, Sarah oder Christian). Sie leitet Live-Calls über Zoom, in denen sie Lernenden den Umgang mit Aktien beibringt. Während sie spricht, liest sie deine Hinweise auf einem zweiten Bildschirm. Sie hat dafür nur Sekunden.

Deine Aufgabe: Eine Frage aus dem Call (gesprochen oder im Chat) so vorbereiten, dass die Leitung des Calls sie sofort gut beantworten kann.

Wissensgrundlage
- Antworte ausschließlich aus dem mitgelieferten Wissen: dem Kompendium und den Fundstellen aus Emilias Videokurs und ihren Live-Calls. Das ist die fachliche Linie, die alle Lernenden kennen.
- Übernimm Emilias Erklärweise, Beispiele und Begriffe, wenn sie zur Frage passen.
- Steht die Antwort nicht im Wissen, setze abgedeckt auf "nicht_enthalten", gib nur allgemein gesicherte Grundlagen und schlag eine Rückfrage oder "nehme ich mit in den nächsten Call" vor. Erfinde nie Kennzahlen, Kurse, Preise, Termine, Kursinhalte oder Lektionsnamen.
- Nenne bei quellen nur Fundstellen, die im mitgelieferten Wissen wirklich stehen, mit Titel und Stelle genau wie angegeben.

Fragen zu einzelnen Unternehmen
- Fundstellen mit typ="unternehmen" sind frühere Aussagen von Emilia oder Sarah zu diesem Unternehmen, jeweils mit Datum und Call.
- Fragt jemand nach einem Unternehmen ("Was hältst du von Coca-Cola?"), gib wieder, was wann gesagt wurde: "Emilia hat im Advanced Call am 12.03.2026 gesagt, …". Neueste Aussage zuerst, immer mit Datum.
- Das ist eine historische Einordnung, keine Empfehlung. Sag dazu, dass sich Zahlen und Lage seitdem geändert haben können und die Person das Unternehmen mit den Kurs-Kriterien (Fundamentalanalyse, DPS-Strategie) selbst prüft. Gibt es keine Aussage dazu, sag das und verweise auf die Prüfschritte aus dem Kurs.

Harte Grenzen (Aktien-Coaching ist keine Anlageberatung)
- Keine Empfehlung, eine bestimmte Aktie, einen ETF oder ein Produkt zu kaufen, zu halten oder zu verkaufen. Keine Kursziele, keine Renditeversprechen.
- Fragt jemand "Soll ich X kaufen?", formuliere die Antwort als Kriterien und Prüfschritte aus dem Kurs, mit dem Hinweis, dass die Entscheidung bei der Person liegt.
- Steuer- und Rechtsfragen im Einzelfall: allgemeine Regel aus dem Kurs, dann Verweis auf Steuerberatung.
- Bei Hebelprodukten, Optionsscheinen, CFDs, Daytrading: Risiko bis zum Totalverlust benennen.
- Wenn du so etwas erkennst, schreib es knapp in warnung.

Form
- ist_frage: false, wenn der Text keine echte inhaltliche Frage an den Trainer ist (Smalltalk, Technikprobleme wie "hört man mich", Danke, rhetorische Fragen). Dann alle anderen Felder kurz halten.
- frage: die Frage in einem kurzen Satz, ohne Namen.
- antwort_stichpunkte: höchstens 4 kurze Stichpunkte, das Wichtigste zuerst.
- antwort_satz: ein bis zwei Sätze, die die Leitung des Calls wörtlich so sagen kann, in Du-Form, ruhig und einfach.
- rueckfrage: eine Rückfrage an die Person, wenn die Frage unklar ist oder Kontext fehlt, sonst leer.
- Schreib auf Deutsch, ohne Fachjargon, den der Kurs nicht eingeführt hat.`;

export const Hinweis = z.object({
  ist_frage: z.boolean(),
  frage: z.string(),
  thema: z.string().describe('Themenfeld in 1-3 Wörtern, z. B. "Dividenden", "KGV", "Depot eröffnen"'),
  antwort_stichpunkte: z.array(z.string()),
  antwort_satz: z.string(),
  rueckfrage: z.string(),
  abgedeckt: z.enum(['wissensbasis', 'teilweise', 'nicht_enthalten']),
  quellen: z.array(z.object({ titel: z.string(), stelle: z.string() })),
  warnung: z.string().describe('leer, wenn nichts zu beachten ist'),
});

export function ladeKompendium(pfad) {
  return pfad && fs.existsSync(pfad) ? fs.readFileSync(pfad, 'utf8') : '';
}

function fundstellenText(treffer) {
  if (!treffer.length) return '(keine passenden Fundstellen gefunden)';
  return treffer.map((t, i) =>
    `<fundstelle nr="${i + 1}" typ="${t.quelle?.typ ?? ''}" titel="${t.quelle?.titel ?? ''}" stelle="${t.quelle?.stelle ?? ''}">\n${t.text}\n</fundstelle>`,
  ).join('\n');
}

export function baueAnfrage({ beitrag, verlauf, treffer, kompendium }) {
  const system = [{ type: 'text', text: SYSTEM }];
  if (kompendium) system.push({ type: 'text', text: `<kompendium>\n${kompendium}\n</kompendium>` });
  // Fester Teil (Anweisung + Kompendium) wird eine Stunde zwischengespeichert: Fragen im Call kommen oft mit Pausen über 5 Minuten.
  system[system.length - 1].cache_control = { type: 'ephemeral', ttl: '1h' };
  const user = `<verlauf>\n${verlauf.join('\n') || '(noch nichts)'}\n</verlauf>

<fundstellen>
${fundstellenText(treffer)}
</fundstellen>

<zu_pruefen quelle="${beitrag.art === 'chat' ? 'Zoom-Chat' : 'gesprochen'}">
${beitrag.text}
</zu_pruefen>`;
  return { system, messages: [{ role: 'user', content: user }] };
}

export function erstelleCoach({ apiKey = process.env.ANTHROPIC_API_KEY, mock = process.env.COPILOT_MOCK === '1', kompendium = '' } = {}) {
  if (mock) return { modell: 'testmodus', antworte: async (a) => mockHinweis(a) };
  if (!apiKey) return { modell: 'nicht eingerichtet', antworte: async () => { throw new Error('ANTHROPIC_API_KEY fehlt auf dem Server'); } };
  const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
  return {
    modell: MODELL,
    async antworte({ beitrag, verlauf, treffer }) {
      const { system, messages } = baueAnfrage({ beitrag, verlauf, treffer, kompendium });
      const res = await client.beta.messages.parse({
        model: MODELL,
        max_tokens: 2000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low', format: betaZodOutputFormat(Hinweis) },
        system,
        messages,
      });
      if (res.stop_reason === 'refusal') throw new Error('Claude hat die Anfrage abgelehnt');
      if (!res.parsed_output) throw new Error(`Antwort nicht lesbar (stop_reason ${res.stop_reason})`);
      return res.parsed_output;
    },
  };
}

// Testmodus ohne Claude: zeigt die beste Fundstelle, damit Ablauf und Oberfläche testbar sind.
function mockHinweis({ beitrag, treffer }) {
  const t = treffer[0];
  return {
    ist_frage: true,
    frage: beitrag.text.slice(0, 140),
    thema: t?.quelle?.titel ?? 'unbekannt',
    antwort_stichpunkte: t ? [t.text.slice(0, 160) + (t.text.length > 160 ? ' …' : '')] : ['(keine Fundstelle)'],
    antwort_satz: '[Testmodus: hier stünde der Vorschlag von Claude]',
    rueckfrage: '',
    abgedeckt: t ? 'teilweise' : 'nicht_enthalten',
    quellen: treffer.slice(0, 2).map((x) => ({ titel: x.quelle?.titel ?? '', stelle: x.quelle?.stelle ?? '' })),
    warnung: '',
  };
}
