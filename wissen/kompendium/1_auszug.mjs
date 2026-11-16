// Schritt 1: Je Call und Kursdatei Fragen/Antworten, Regeln und Unternehmens-Aussagen herausziehen.
// Aufruf:
//   node wissen/kompendium/1_auszug.mjs <rohordner> <arbeitsordner> --test <anzahl>   direkt, ohne Batch
//   node wissen/kompendium/1_auszug.mjs <rohordner> <arbeitsordner>                   alle offenen per Batch (50 % Preis)
// Ergebnisse: <arbeitsordner>/auszug/<id>.json. Bereits vorhandene werden übersprungen (wiederaufnehmbar).
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { dokumente, auszugAnfrage, Auszug } from './gemeinsam.mjs';

const [roh, arbeit] = process.argv.slice(2);
const test = process.argv.includes('--test') ? Number(process.argv[process.argv.indexOf('--test') + 1] || 1) : 0;
const zielOrdner = path.join(arbeit, 'auszug');
fs.mkdirSync(zielOrdner, { recursive: true });
const client = new Anthropic();

const alle = dokumente(roh);
const meta = Object.fromEntries(alle.map((d) => [d.id, { typ: d.typ, titel: d.titel, datum: d.datum }]));
fs.writeFileSync(path.join(arbeit, 'dokumente.json'), JSON.stringify(meta, null, 1));
const offen = alle.filter((d) => !fs.existsSync(path.join(zielOrdner, d.id + '.json')));
console.log(`${alle.length} Dokumente, ${offen.length} offen`);

function speichere(id, msg) {
  if (msg.stop_reason === 'refusal') throw new Error(`${id}: abgelehnt (${msg.stop_details?.category ?? '?'})`);
  if (msg.stop_reason === 'max_tokens') throw new Error(`${id}: Ausgabe abgeschnitten`);
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const daten = Auszug.parse(JSON.parse(text));
  fs.writeFileSync(path.join(zielOrdner, id + '.json'), JSON.stringify(daten, null, 1));
  return daten;
}

if (test) {
  for (const d of offen.filter((x) => x.typ === 'call').slice(0, test)) {
    const msg = await client.messages.stream(auszugAnfrage(d)).finalMessage();
    const a = speichere(d.id, msg);
    console.log(`${d.titel}: ${a.fragen.length} Fragen, ${a.regeln.length} Regeln, ${a.unternehmen.length} Unternehmen · Token ein ${msg.usage.input_tokens} aus ${msg.usage.output_tokens}`);
  }
  process.exit(0);
}

if (!offen.length) process.exit(0);
const batch = await client.messages.batches.create({
  requests: offen.map((d) => ({ custom_id: d.id, params: auszugAnfrage(d) })),
});
console.log('Batch', batch.id, 'gestartet');
fs.writeFileSync(path.join(arbeit, 'batch_auszug.txt'), batch.id);
let b;
for (;;) {
  b = await client.messages.batches.retrieve(batch.id);
  if (b.processing_status === 'ended') break;
  console.log(new Date().toISOString().slice(11, 19), b.request_counts);
  await new Promise((r) => setTimeout(r, 60_000));
}
let ok = 0, fehler = 0;
for await (const r of await client.messages.batches.results(batch.id)) {
  try {
    if (r.result.type !== 'succeeded') throw new Error(`${r.custom_id}: ${r.result.type}`);
    speichere(r.custom_id, r.result.message); ok++;
  } catch (e) { fehler++; console.warn('  ', e.message); }
}
console.log(`Fertig: ${ok} gespeichert, ${fehler} Fehler (erneut starten holt die fehlenden nach)`);
