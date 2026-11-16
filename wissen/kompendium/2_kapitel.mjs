// Schritt 2: Je Thema alle Fragen und Regeln zusammenführen und ein Kapitel schreiben (Claude Opus, Batch).
// Aufruf: node wissen/kompendium/2_kapitel.mjs <rohordner> <arbeitsordner> [--neu]
// Liest <arbeit>/auszug/*.json, schreibt <arbeit>/kapitel/<thema>.md und <arbeit>/kompendium.md.
// Vorhandene Kapitel bleiben, außer mit --neu.
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { THEMEN, MODELL_KAPITEL } from './gemeinsam.mjs';

const [, arbeit] = process.argv.slice(2);
const neu = process.argv.includes('--neu');
const meta = JSON.parse(fs.readFileSync(path.join(arbeit, 'dokumente.json'), 'utf8'));
const auszugOrdner = path.join(arbeit, 'auszug');
const kapitelOrdner = path.join(arbeit, 'kapitel');
fs.mkdirSync(kapitelOrdner, { recursive: true });

// Quelle kurz und eindeutig: Kurs-Lektion oder Call mit Datum, Titel und Zeitmarke.
function quelle(id, zeit) {
  const m = meta[id] ?? { typ: '?', titel: id };
  if (m.typ === 'kurs') return `Kurs › ${m.titel}`;
  return `Call ${m.titel}${zeit ? ' ' + zeit : ''}`;
}

const proThema = Object.fromEntries(THEMEN.map(([id]) => [id, { fragen: [], regeln: [] }]));
for (const datei of fs.readdirSync(auszugOrdner).filter((f) => f.endsWith('.json'))) {
  const id = datei.replace(/\.json$/, '');
  const a = JSON.parse(fs.readFileSync(path.join(auszugOrdner, datei), 'utf8'));
  for (const f of a.fragen) proThema[f.thema]?.fragen.push(`[${quelle(id, f.zeit)} | ${f.von}] F: ${f.frage}\nA: ${f.antwort}`);
  for (const r of a.regeln) proThema[r.thema]?.regeln.push(`[${quelle(id, r.zeit)}] ${r.regel}`);
}

const SYSTEM = `Du schreibst ein Kapitel des internen Coach-Kompendiums der Aktien-Mentoring-Masterclass von Investiere Dich Frei. Leser: Christian, der als Coach Live-Calls leitet und alle Fragen der Teilnehmerinnen so beantworten will, wie Emilia Bolda (Gründerin, Strategie-Inhaberin) es tut. Das Kapitel wird außerdem einem KI-Co-Trainer als Wissensgrundlage mitgegeben.

Du bekommst alle aus Kurs und Live-Calls herausgezogenen Faustregeln und Fragen mit Antworten zu einem Thema. Viele sind doppelt oder fast gleich.

Aufbau des Kapitels (Markdown, Deutsch, Du-Form zur Teilnehmerin, wo Antworten vorgelesen werden):

## <Thema>

### Emilias Regeln
Die verbindlichen Regeln und Vorgehensweisen mit allen Zahlen, zusammengeführt und ohne Doppelungen. Je Regel eine Zeile, dahinter in Klammern die wichtigsten Quellen (höchstens 3). Wo der Kurs und die Calls verschiedene Zahlen nennen oder sich eine Regel über die Zeit geändert hat: beide Fassungen mit Datum nennen, die neueste als aktuell kennzeichnen, und den Punkt zusätzlich unter "Widersprüche" aufführen.

### Häufige Fragen
Bündle gleiche und sehr ähnliche Fragen zu einer. Sortiere nach Häufigkeit, die häufigsten zuerst. Je gebündelter Frage:
#### <Frage, allgemein formuliert> (<n>× gefragt)
**Antwort:** Kern der Antwort in 2–6 Sätzen mit allen Zahlen und Regeln, so wie Emilia/Sarah es erklären.
**Zum Vorlesen:** ein bis zwei Sätze, die der Coach wörtlich sagen kann.
**Quellen:** die besten 1–3 Fundstellen genau wie angegeben (Kurs › … bzw. Call … mit Zeitmarke).
Nimm alle Fragen auf, die mindestens zweimal vorkommen oder inhaltlich wichtig sind. Seltene Einzelfragen mit eigenem Wissenswert fasse am Ende unter "#### Weitere Einzelfragen" knapp als Frage – Antwort zusammen.

### Grenzen und Warnungen
Wo der Coach nichts Konkretes sagen darf und wie er stattdessen antwortet: keine Kauf-/Verkaufsempfehlung für einzelne Werte, keine Kursziele oder Renditeversprechen, Steuer-Einzelfälle an Steuerberatung, Risiken bei Hebelprodukten. Nur was für dieses Thema relevant ist.

### Widersprüche und offene Punkte
Liste für die Prüfung durch Emilia: abweichende Zahlen oder Aussagen zwischen Kurs, Calls, Emilia und Sarah, jeweils mit Quellen und Datum. Wenn keine: "Keine gefunden."

Regeln:
- Nur was im Material steht. Nichts ergänzen, keine eigenen Zahlen, keine eigene Meinung.
- Keine Namen von Teilnehmerinnen. Emilia und Sarah dürfen genannt werden.
- Formuliere Aussagen zu einzelnen Aktien hier nicht aus, die stehen im Unternehmens-Register.
- Länge: so knapp wie möglich, so ausführlich wie nötig, höchstens etwa 6.000 Wörter.`;

const offen = THEMEN.filter(([id]) => neu || !fs.existsSync(path.join(kapitelOrdner, id + '.md')))
  .filter(([id]) => proThema[id].fragen.length + proThema[id].regeln.length > 0);
for (const [id, name] of THEMEN) console.log(`${name}: ${proThema[id].fragen.length} Fragen, ${proThema[id].regeln.length} Regeln`);

const client = new Anthropic();
if (offen.length) {
  const batch = await client.messages.batches.create({
    requests: offen.map(([id, name, beschreibung]) => ({
      custom_id: id,
      params: {
        model: MODELL_KAPITEL,
        max_tokens: 64000,
        system: SYSTEM,
        output_config: { effort: 'high' },
        messages: [{ role: 'user', content: `Thema: ${name}\nUmfang: ${beschreibung}\n\n<regeln anzahl="${proThema[id].regeln.length}">\n${proThema[id].regeln.join('\n')}\n</regeln>\n\n<fragen anzahl="${proThema[id].fragen.length}">\n${proThema[id].fragen.join('\n\n')}\n</fragen>` }],
      },
    })),
  });
  console.log('Batch', batch.id, 'gestartet für', offen.length, 'Themen');
  let b;
  for (;;) {
    b = await client.messages.batches.retrieve(batch.id);
    if (b.processing_status === 'ended') break;
    console.log(new Date().toISOString().slice(11, 19), b.request_counts);
    await new Promise((r) => setTimeout(r, 60_000));
  }
  for await (const r of await client.messages.batches.results(batch.id)) {
    if (r.result.type !== 'succeeded') { console.warn(r.custom_id, r.result.type); continue; }
    const m = r.result.message;
    if (m.stop_reason !== 'end_turn') console.warn(r.custom_id, 'stop_reason', m.stop_reason);
    const text = m.content.filter((x) => x.type === 'text').map((x) => x.text).join('').trim();
    if (text) fs.writeFileSync(path.join(kapitelOrdner, r.custom_id + '.md'), text + '\n');
  }
}

// Kompendium zusammensetzen.
const stand = new Date().toISOString().slice(0, 10);
const teile = THEMEN.map(([id]) => path.join(kapitelOrdner, id + '.md')).filter((p) => fs.existsSync(p)).map((p) => fs.readFileSync(p, 'utf8').trim());
const kopf = `# Coach-Kompendium Aktien-Mentoring-Masterclass\n\nStand ${stand}. Zusammengeführt aus Emilias Videokurs, FAQ und ${Object.values(meta).filter((m) => m.typ === 'call').length} Live-Calls (Emilia: Advanced Calls und Coachings, Sarah: Basic Calls). Aussagen zu einzelnen Unternehmen stehen im Unternehmens-Register, nicht hier.\n`;
fs.writeFileSync(path.join(arbeit, 'kompendium.md'), [kopf, ...teile].join('\n\n') + '\n');
const worte = teile.join(' ').split(/\s+/).length;
console.log(`kompendium.md: ${teile.length} Kapitel, ca. ${worte.toLocaleString('de-DE')} Wörter`);
