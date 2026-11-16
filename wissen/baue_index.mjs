// Baut wissen/index.json aus den Rohdaten.
//   wissen/roh/kurs/<Modul>/<Lektion>.(vtt|txt|md)   → Videokurs (LearningSuite)
//   wissen/roh/calls/<Datum Titel>.vtt                → Emilias Live-Calls (Zoom)
// Teilnehmende in den Calls werden anonymisiert, nur TRAINERIN_NAMEN (Standard: Emilia) bleibt stehen.
// Aufruf: node wissen/baue_index.mjs [rohordner] [ausgabe.json]
import fs from 'node:fs';
import path from 'node:path';
import { parseVtt, anonymisiere, abschnitteAusCues, abschnitteAusText } from '../server/wissen.mjs';

const roh = path.resolve(process.argv[2] ?? 'wissen/roh');
const ziel = path.resolve(process.argv[3] ?? 'wissen/index.json');
const trainerin = (process.env.TRAINERIN_NAMEN ?? 'Emilia').split(',').map((s) => s.trim()).filter(Boolean);

function dateien(ordner) {
  if (!fs.existsSync(ordner)) return [];
  return fs.readdirSync(ordner, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(ordner, e.name);
    return e.isDirectory() ? dateien(p) : /\.(vtt|txt|md)$/i.test(e.name) ? [p] : [];
  }).sort();
}

const titelAus = (basis, datei) => path.relative(basis, datei).replace(/\.(vtt|txt|md)$/i, '').split(path.sep).join(' › ').replace(/[_]+/g, ' ');

const abschnitte = [];
const statistik = { kurs: 0, calls: 0 };

for (const datei of dateien(path.join(roh, 'kurs'))) {
  const inhalt = fs.readFileSync(datei, 'utf8');
  const quelle = { typ: 'kurs', titel: 'Kurs › ' + titelAus(path.join(roh, 'kurs'), datei) };
  const neu = /\.vtt$/i.test(datei) ? abschnitteAusCues(parseVtt(inhalt), quelle) : abschnitteAusText(inhalt, quelle);
  abschnitte.push(...neu); statistik.kurs++;
}

for (const datei of dateien(path.join(roh, 'calls'))) {
  if (!/\.vtt$/i.test(datei)) continue;
  const cues = anonymisiere(parseVtt(fs.readFileSync(datei, 'utf8')), trainerin);
  const quelle = { typ: 'call', titel: 'Live-Call › ' + titelAus(path.join(roh, 'calls'), datei) };
  abschnitte.push(...abschnitteAusCues(cues, quelle)); statistik.calls++;
}

abschnitte.forEach((a, i) => { a.id = `a${i + 1}`; });
fs.mkdirSync(path.dirname(ziel), { recursive: true });
fs.writeFileSync(ziel, JSON.stringify({ erstellt: new Date().toISOString(), abschnitte }, null, 1));
const worte = abschnitte.reduce((s, a) => s + a.text.split(/\s+/).length, 0);
console.log(`${statistik.kurs} Kurs-Dateien, ${statistik.calls} Calls → ${abschnitte.length} Abschnitte, ca. ${worte.toLocaleString('de-DE')} Wörter → ${path.relative(process.cwd(), ziel)}`);
