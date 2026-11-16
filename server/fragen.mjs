// Fragen erkennen (ohne KI, sofort) und Regelwächter für das, was der Trainer selbst sagt.
import { tokens } from './wissen.mjs';

const FRAGEWORT = /^(wie|was|warum|wieso|weshalb|wann|wo|woher|wohin|wozu|womit|wofür|welche[rsmn]?|wer|wem|wen|kann|könnte|kannst|könnt|soll|sollte|sollen|muss|müsste|darf|ist|sind|gibt'?s|gibt es|macht es|macht das|lohnt|hast du|habt ihr|haben sie|weißt du|wisst ihr|bedeutet|heißt|stimmt es|würdest du|würden sie|bringt)\b/i;
const FRAGE_SIGNAL = /\b(frage|verstehe (ich )?nicht|nicht verstanden|nicht ganz klar|unterschied zwischen|erklär|was genau|wie genau|nochmal erklären|ich frag mich|ich frage mich|bin unsicher|keine ahnung wie)\b/i;
// Typische Moderationsfragen des Trainers sind keine Lernenden-Fragen
const TRAINER_FLOSKEL = /\b(habt ihr (noch )?fragen|gibt es (noch )?fragen|alle(s)? klar|könnt ihr mich (hören|sehen)|seht ihr (meinen|den) bildschirm|noch jemand)\b/i;

export function istFrage(text) {
  const t = String(text).trim();
  if (t.length < 8) return false;
  if (TRAINER_FLOSKEL.test(t)) return false;
  if (t.includes('?')) return true;
  // Gesprochene Sätze kommen aus dem Transkript oft ohne Fragezeichen
  const saetze = t.split(/(?<=[.!])\s+/);
  return saetze.some((s) => FRAGEWORT.test(s.trim())) || FRAGE_SIGNAL.test(t);
}

// Ähnlichkeit zweier Fragen (Jaccard über Wortstämme): erkennt "+1"-Fragen im Chat
export function aehnlichkeit(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let schnitt = 0; for (const t of A) if (B.has(t)) schnitt++;
  return schnitt / (A.size + B.size - schnitt);
}

// Regelwächter: rot = darf so nicht gesagt werden, gelb = Hinweis.
// Gilt für den Trainer (Christian), nicht für Lernende. Vor dem Live-Einsatz per Rückwärtstest prüfen.
export const REGELN = [
  { id: 'anlageberatung', stufe: 'rot', re: /\b(kauf|kauft|kaufen sie|verkauf|verkauft|nimm|nehmt) (jetzt |unbedingt |sofort )?(die|diese|den|das)? ?(aktie|position|etf|titel)\b|\b(an deiner|an eurer|an ihrer) stelle würde ich\b|\bich würde (jetzt|sofort|unbedingt) (kaufen|verkaufen|einsteigen|aussteigen)\b/i,
    text: 'Klingt nach individueller Anlageempfehlung. Besser: Kriterien erklären, Entscheidung bleibt bei der Person.' },
  { id: 'versprechen', stufe: 'rot', re: /\b(garantiert|sichere rendite|risikolos|ohne risiko|kann nicht fallen|wird (sicher|garantiert) steigen|todsicher|100 ?(%|prozent) sicher)\b/i,
    text: 'Rendite- oder Sicherheitsversprechen. Aktien können fallen, bis zum Totalverlust.' },
  { id: 'kursziel', stufe: 'rot', re: /\b(geht|steigt|läuft) (die aktie|der kurs) (sicher |bald )?(auf|bis) \d/i,
    text: 'Kursprognose für eine einzelne Aktie. Als Meinung kennzeichnen oder weglassen.' },
  { id: 'steuer', stufe: 'gelb', re: /\b(in deinem fall|bei dir) (musst du|zahlst du|sparst du) (keine |weniger )?steuer/i,
    text: 'Einzelfall-Steuerauskunft. Auf Steuerberatung verweisen.' },
  { id: 'hebel', stufe: 'gelb', re: /\b(hebel|knock.?out|optionsschein|cfd|turbo.?zertifikat|daytrading)\b/i,
    text: 'Hochriskantes Produkt erwähnt. Risiko (bis Totalverlust) klar benennen.' },
];

export function pruefeRegeln(text) {
  return REGELN.filter((r) => r.re.test(text)).map(({ id, stufe, text: hinweis }) => ({ id, stufe, hinweis }));
}

// Fasst kurz aufeinanderfolgende Transkript-Stücke derselben Person zusammen,
// damit eine Frage nicht in drei halben Sätzen ankommt.
export class Satzpuffer {
  constructor(ausgabe, pauseMs = 2500) { this.ausgabe = ausgabe; this.pauseMs = pauseMs; this.offen = new Map(); }
  rein(b) {
    const key = `${b.meeting}|${b.userId ?? b.name}`;
    const alt = this.offen.get(key);
    if (alt) { clearTimeout(alt.timer); alt.text += ' ' + b.text; alt.zeit = b.zeit; } else this.offen.set(key, { ...b });
    const e = this.offen.get(key);
    e.timer = setTimeout(() => { this.offen.delete(key); const { timer, ...rest } = e; this.ausgabe(rest); }, this.pauseMs);
    e.timer.unref?.();
  }
  leeren() { for (const [k, e] of this.offen) { clearTimeout(e.timer); this.offen.delete(k); const { timer, ...rest } = e; this.ausgabe(rest); } }
}
