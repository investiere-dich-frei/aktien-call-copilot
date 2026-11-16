// Wissensdatenbank: Abschnitte aus Kurs-Lektionen und Emilias Live-Calls, Volltextsuche (BM25).
// Ein Abschnitt: { id, quelle: { typ: 'kurs'|'call', titel, stelle }, text }
import fs from 'node:fs';

const STOPP = new Set(`aber alle allem allen aller alles als also am an ans auch auf aus bei beim bin bis bist da dadurch daher
darum das dass dein deine dem den der des dessen deshalb die dies diese diesem diesen dieser dieses doch dort du durch ein eine
einem einen einer eines er es euch euer eure für hatte hatten hattest hast hat habe haben hier hin hinter ich ihr ihre im in ist
ja jede jedem jeden jeder jedes jetzt kann kannst kein keine man mein meine mich mir mit muss nach nein nicht nichts noch nun nur
ob oder ohne sehr sein seine sich sie sind so solche soll sollen sollte sondern sonst über um und uns unser unter vom von vor
war waren warst was weg weil weiter welche welchem welchen welcher welches wenn wer werde werden wie wieder will wir wird wirst
wo wollen wollte würde würden zu zum zur zwar zwischen mal halt eben genau okay ok ähm äh hm einfach dann denn man eigentlich`.split(/\s+/).map(umlaute));

function umlaute(w) {
  return w.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

// Sehr einfache deutsche Stammformbildung: reicht, damit "Dividenden" und "Dividende" zusammenfinden.
function stamm(w) {
  for (const endung of ['ungen', 'heiten', 'keiten', 'est', 'ern', 'et', 'en', 'er', 'es', 'em', 'st', 'e', 'n', 's']) {
    if (w.length - endung.length >= 4 && w.endsWith(endung)) return w.slice(0, -endung.length);
  }
  return w;
}

export function tokens(text) {
  return umlaute(String(text))
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPP.has(w))
    .map(stamm);
}

export class Wissen {
  constructor(abschnitte = []) {
    this.abschnitte = abschnitte;
    this.docs = abschnitte.map((a) => {
      const tf = new Map();
      // Titel zählt doppelt, damit Lektionsnamen beim Treffer helfen
      for (const t of [...tokens(a.text), ...tokens(a.quelle?.titel ?? ''), ...tokens(a.quelle?.titel ?? '')]) tf.set(t, (tf.get(t) ?? 0) + 1);
      let len = 0; for (const n of tf.values()) len += n;
      return { tf, len };
    });
    this.df = new Map();
    for (const d of this.docs) for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avg = this.docs.reduce((s, d) => s + d.len, 0) / Math.max(1, this.docs.length);
  }

  static laden(pfad) {
    if (!pfad || !fs.existsSync(pfad)) return new Wissen([]);
    const daten = JSON.parse(fs.readFileSync(pfad, 'utf8'));
    return new Wissen(Array.isArray(daten) ? daten : daten.abschnitte ?? []);
  }

  get groesse() { return this.abschnitte.length; }

  suche(frage, k = 5) {
    const q = [...new Set(tokens(frage))];
    if (!q.length || !this.docs.length) return [];
    const N = this.docs.length, k1 = 1.4, b = 0.75;
    const treffer = [];
    this.docs.forEach((d, i) => {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t); if (!f) continue;
        const df = this.df.get(t);
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / this.avg));
      }
      if (score > 0) treffer.push({ score, ...this.abschnitte[i] });
    });
    return treffer.sort((a, b2) => b2.score - a.score).slice(0, k);
  }
}

// ---------- Aufbereitung (wird von wissen/baue_index.mjs genutzt) ----------

// WebVTT (Zoom-Transkript) → [{ start: 'hh:mm:ss', sprecher, text }]
export function parseVtt(vtt) {
  const cues = [];
  const bloecke = String(vtt).replace(/\r/g, '').split(/\n\n+/);
  for (const block of bloecke) {
    const zeilen = block.split('\n').filter(Boolean);
    const zi = zeilen.findIndex((z) => z.includes('-->'));
    if (zi < 0) continue;
    const start = zeilen[zi].split('-->')[0].trim().replace(/\.\d+$/, '');
    let text = zeilen.slice(zi + 1).join(' ').trim();
    let sprecher = '';
    const m = text.match(/^([^:]{1,60}):\s+(.*)$/);
    if (m) { sprecher = m[1].trim(); text = m[2]; }
    if (text) cues.push({ start, sprecher, text });
  }
  return cues;
}

// Teilnehmende anonymisieren: Nur die Trainerin behält ihren Namen.
// Namen anderer Sprecher werden auch im Text ersetzt (Vor- und Nachname einzeln).
export function anonymisiere(cues, trainerinNamen = []) {
  const istTrainerin = (s) => trainerinNamen.some((n) => s.toLowerCase().includes(n.toLowerCase()));
  const fremde = new Set();
  for (const c of cues) if (c.sprecher && !istTrainerin(c.sprecher)) {
    for (const teil of c.sprecher.split(/\s+/)) if (teil.length >= 3) fremde.add(teil);
  }
  const re = fremde.size ? new RegExp(`\\b(${[...fremde].map(esc).join('|')})\\b`, 'gi') : null;
  return cues.map((c) => ({
    ...c,
    sprecher: !c.sprecher ? '' : istTrainerin(c.sprecher) ? c.sprecher : 'Teilnehmer:in',
    text: re ? c.text.replace(re, '[Name]') : c.text,
  }));
}

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Cues zu Abschnitten von ca. maxWorte Wörtern bündeln, mit Startzeit als Fundstelle.
export function abschnitteAusCues(cues, quelle, maxWorte = 220) {
  const out = [];
  let akt = [], worte = 0, start = null;
  const flush = () => {
    if (!akt.length) return;
    out.push({ quelle: { ...quelle, stelle: start ? `ab ${start}` : '' }, text: akt.join('\n') });
    akt = []; worte = 0; start = null;
  };
  for (const c of cues) {
    start ??= c.start;
    akt.push(c.sprecher ? `${c.sprecher}: ${c.text}` : c.text);
    worte += c.text.split(/\s+/).length;
    if (worte >= maxWorte) flush();
  }
  flush();
  return out;
}

// Fließtext (Kurs-Skript, Notizen) an Absätzen in Abschnitte teilen.
export function abschnitteAusText(text, quelle, maxWorte = 220) {
  const absaetze = String(text).replace(/\r/g, '').split(/\n\s*\n/).map((a) => a.trim()).filter(Boolean)
    // Zu lange Absätze (z. B. Video-Transkripte ohne Umbrüche) an Satzgrenzen zerlegen.
    .flatMap((a) => a.split(/\s+/).length <= maxWorte ? [a] : a.split(/(?<=[.!?])\s+/))
    // Stücke ohne Satzzeichen notfalls hart nach Wortzahl teilen.
    .flatMap((a) => {
      const w = a.split(/\s+/);
      if (w.length <= maxWorte) return [a];
      const out = [];
      for (let i = 0; i < w.length; i += maxWorte) out.push(w.slice(i, i + maxWorte).join(' '));
      return out;
    });
  const out = []; let akt = [], worte = 0, nr = 1;
  const flush = () => { if (akt.length) { out.push({ quelle: { ...quelle, stelle: `Teil ${nr++}` }, text: akt.join('\n\n') }); akt = []; worte = 0; } };
  for (const a of absaetze) {
    const n = a.split(/\s+/).length;
    if (worte + n > maxWorte && akt.length) flush();
    akt.push(a); worte += n;
  }
  flush();
  return out;
}
