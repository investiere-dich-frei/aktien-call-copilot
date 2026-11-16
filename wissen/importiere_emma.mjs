// Übernimmt Kurswissen aus der Obsidian-Wissensbasis „IDF Emma“ nach wissen/roh/kurs/.
// Aufruf: node wissen/importiere_emma.mjs "<Pfad zu Wissensdatenbank IDF Emma>" [rohordner]
// Übernommen werden nur die Bereiche für die Aktien-Calls (BEREICHE unten). Obsidian-Kopf
// (Frontmatter), Callouts, [[Links]] und Index-Seiten fallen weg. Der Zielordner wird neu befüllt.
import fs from 'node:fs';
import path from 'node:path';

const BEREICHE = [
  ['02 Kurswissen/Aktien-Mentoring-Masterclass', 'Masterclass'],
  ['02 Kurswissen/Programmuebergreifend', 'Programmübergreifend'],
  ['07 Emilia Coaching', 'Emilias Coaching-Antworten'],
  ['03 FAQ Support', 'FAQ'],
  ['04 Steuer FAQ', 'Steuer-FAQ'],
];

const quelle = process.argv[2];
const roh = path.resolve(process.argv[3] ?? 'wissen/roh');
if (!quelle || !fs.existsSync(quelle)) { console.error('Pfad zur Wissensbasis IDF Emma fehlt oder existiert nicht.'); process.exit(1); }

export function bereinige(md) {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, '')                       // Frontmatter
    .replace(/^> \[![^\]]*\][-+]?.*\n(?:>.*\n?)*/gm, '')          // Callouts (Metadaten-Kästen)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')               // [[Ziel|Text]]
    .replace(/\[\[([^\]]+)\]\]/g, '$1')                           // [[Ziel]]
    .replace(/^#+\s*/gm, '')                                      // Überschriften-Rauten
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mdDateien(ordner) {
  return fs.readdirSync(ordner, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(ordner, e.name);
    if (e.isDirectory()) return mdDateien(p);
    return e.name.endsWith('.md') && !e.name.startsWith('_Index') ? [p] : [];
  });
}

const ziel = path.join(roh, 'kurs');
fs.rmSync(ziel, { recursive: true, force: true });
let anzahl = 0, worte = 0;
for (const [rel, name] of BEREICHE) {
  const basis = path.join(quelle, rel);
  if (!fs.existsSync(basis)) { console.warn('fehlt:', rel); continue; }
  for (const datei of mdDateien(basis)) {
    const text = bereinige(fs.readFileSync(datei, 'utf8'));
    if (text.split(/\s+/).length < 15) continue;                  // leere Stubs überspringen
    const out = path.join(ziel, name, path.relative(basis, datei).replace(/\.md$/, '.txt'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text + '\n');
    anzahl++; worte += text.split(/\s+/).length;
  }
}
console.log(`${anzahl} Dateien, ca. ${worte.toLocaleString('de-DE')} Wörter → ${path.relative(process.cwd(), ziel)}`);
