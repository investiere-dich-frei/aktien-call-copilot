// Schritt 3: Unternehmens-Register aus den Auszügen – ohne KI, nur zusammenführen und sortieren.
// Aufruf: node wissen/kompendium/3_unternehmen.mjs <rohordner> <arbeitsordner>
// Schreibt <rohordner>/unternehmen/<Name>.txt (für die Suche des Copilots, jede Zeile mit Name)
// und <arbeitsordner>/unternehmen.md (lesbares Register, alphabetisch).
import fs from 'node:fs';
import path from 'node:path';

const [roh, arbeit] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(path.join(arbeit, 'dokumente.json'), 'utf8'));
const auszugOrdner = path.join(arbeit, 'auszug');

const RECHTSFORM = /\b(inc|incorporated|corp|corporation|co|company|ag|se|sa|nv|plc|ltd|limited|holdings?|group|gmbh|class [abc]|the)\b\.?/gi;
export const schluessel = (name) => name.toLowerCase().replace(/\(.*?\)/g, '').replace(RECHTSFORM, '').replace(/[^a-z0-9äöü]+/g, '');

function wer(m) {
  if (m.typ === 'kurs') return 'Kurs';
  return /\(Sarah\)$/.test(m.titel) ? 'Sarah' : 'Emilia';
}

// Einträge sammeln
const eintraege = [];
for (const datei of fs.readdirSync(auszugOrdner).filter((f) => f.endsWith('.json'))) {
  const id = datei.replace(/\.json$/, '');
  const m = meta[id]; if (!m) continue;
  for (const u of JSON.parse(fs.readFileSync(path.join(auszugOrdner, datei), 'utf8')).unternehmen) {
    if (!u.name?.trim()) continue;
    eintraege.push({ ...u, ticker: u.ticker.trim().toUpperCase(), datum: m.datum, wer: wer(m),
      quelle: m.typ === 'kurs' ? `Kurs › ${m.titel}` : `${m.titel.replace(/^\d{4}-\d{2}-\d{2}_/, '').replace(/ \((Emilia|Sarah)\)$/, '')}` });
  }
}

// Gruppieren: erst über Ticker, sonst über bereinigten Namen. Ticker und Namen verbinden sich gegenseitig.
const gruppeVon = new Map(); const gruppen = [];
for (const e of eintraege) {
  const keys = [schluessel(e.name), e.ticker && 't:' + e.ticker].filter(Boolean);
  let g = keys.map((k) => gruppeVon.get(k)).find(Boolean);
  if (!g) { g = { eintraege: [], namen: new Map(), ticker: new Map() }; gruppen.push(g); }
  for (const k of keys) gruppeVon.set(k, g);
  g.eintraege.push(e);
  g.namen.set(e.name, (g.namen.get(e.name) ?? 0) + 1);
  if (e.ticker) g.ticker.set(e.ticker, (g.ticker.get(e.ticker) ?? 0) + 1);
}
const haeufigster = (map) => [...map].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

const RANG = { Analyse: 0, Einschätzung: 1, Beispiel: 2, Erwähnung: 3 };
const ziel = path.join(roh, 'unternehmen');
fs.rmSync(ziel, { recursive: true, force: true }); fs.mkdirSync(ziel, { recursive: true });
const register = [];
for (const g of gruppen) {
  const name = haeufigster(g.namen); const ticker = haeufigster(g.ticker);
  const kopf = ticker ? `${name} (${ticker})` : name;
  // Neueste zuerst; Kurs ohne Datum ans Ende. Reine Erwähnungen nur, wenn sonst nichts da ist.
  let liste = g.eintraege.sort((a, b) => (b.datum || '0').localeCompare(a.datum || '0') || RANG[a.art] - RANG[b.art]);
  const gehaltvoll = liste.filter((e) => e.art !== 'Erwähnung');
  if (gehaltvoll.length) liste = gehaltvoll;
  const zeilen = liste.map((e) => `${kopf} – ${e.datum ? e.datum.split('-').reverse().join('.') : 'Kurs'}, ${e.wer}${e.datum ? ' im Call „' + e.quelle + '“' : ' (' + e.quelle + ')'}${e.zeit ? ' ab ' + e.zeit : ''} [${e.art}]: ${e.aussage}`);
  const datei = kopf.replace(/[\/\\:*?"<>|]+/g, '-').slice(0, 80) + '.txt';
  fs.writeFileSync(path.join(ziel, datei), `Unternehmens-Register: ${kopf}. Frühere Aussagen aus Kurs und Live-Calls, keine Empfehlung.\n\n${zeilen.join('\n\n')}\n`);
  register.push({ kopf, anzahl: liste.length, gehaltvoll: gehaltvoll.length, zeilen, letztes: liste[0]?.datum ?? '' });
}

register.sort((a, b) => a.kopf.localeCompare(b.kopf, 'de'));
const md = [`# Unternehmens-Register\n\nWas Emilia und Sarah in Live-Calls und im Kurs zu einzelnen Unternehmen gesagt haben, neueste Aussage zuerst. Historische Einordnung, keine Empfehlung: Kurse, Zahlen und Einschätzungen können sich seitdem geändert haben.\n\n${register.length} Unternehmen, davon ${register.filter((r) => r.gehaltvoll).length} mit inhaltlicher Aussage.`];
for (const r of register.filter((x) => x.gehaltvoll)) {
  md.push(`## ${r.kopf}\n\n${r.zeilen.map((z) => '- ' + z.replace(/^.*? – /, '')).join('\n')}`);
}
const nur = register.filter((x) => !x.gehaltvoll).map((x) => x.kopf);
if (nur.length) md.push(`## Nur erwähnt\n\n${nur.join(', ')}`);
fs.writeFileSync(path.join(arbeit, 'unternehmen.md'), md.join('\n\n') + '\n');
console.log(`${eintraege.length} Aussagen → ${register.length} Unternehmen (${register.filter((r) => r.gehaltvoll).length} mit inhaltlicher Aussage) → ${path.relative(process.cwd(), ziel)}`);
