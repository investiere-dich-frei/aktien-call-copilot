// Kern: nimmt Beiträge (Zoom oder Simulator) an, pflegt die Mitschrift im Arbeitsspeicher,
// erkennt Fragen, holt Fundstellen und lässt Claude einen Hinweis schreiben.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { istFrage, aehnlichkeit, pruefeRegeln, Satzpuffer } from './fragen.mjs';

const VERLAUF_ZEILEN = 40;
const AEHNLICH_AB = 0.5;
const AEHNLICH_FENSTER_MS = 5 * 60_000;
const PARALLEL = 3;

export class Copilot extends EventEmitter {
  constructor({ coach, wissen, trainerNamen = [] }) {
    super();
    this.coach = coach; this.wissen = wissen;
    this.trainerNamen = trainerNamen.map((n) => n.toLowerCase()).filter(Boolean);
    this.verlauf = [];      // Zeilen für Claude, ohne Namen der Lernenden
    this.mitschrift = [];   // für die Oberfläche (mit Namen, nur im Arbeitsspeicher)
    this.karten = new Map();
    this.warteschlange = []; this.laufend = 0;
    this.puffer = new Satzpuffer((b) => this.#pruefeKandidat(b));
  }

  istTrainer(name = '') {
    const n = name.toLowerCase();
    return this.trainerNamen.some((t) => n.includes(t));
  }

  beitrag(b) {
    const trainer = this.istTrainer(b.name);
    const rolle = trainer ? 'Trainer' : b.art === 'chat' ? 'Teilnehmer:in (Chat)' : 'Teilnehmer:in';
    this.verlauf.push(`${rolle}: ${b.text}`);
    if (this.verlauf.length > VERLAUF_ZEILEN) this.verlauf.shift();
    const zeile = { art: b.art, name: b.name, trainer, text: b.text, zeit: b.zeit ?? Date.now() };
    this.mitschrift.push(zeile);
    if (this.mitschrift.length > 300) this.mitschrift.shift();
    this.emit('ereignis', { typ: 'mitschrift', zeile });

    if (trainer) {
      const treffer = pruefeRegeln(b.text);
      if (treffer.length) this.emit('ereignis', { typ: 'regel', text: b.text, treffer, zeit: zeile.zeit });
      return;
    }
    if (b.art === 'chat') this.#pruefeKandidat(b);
    else this.puffer.rein(b);
  }

  #pruefeKandidat(b) {
    if (!istFrage(b.text)) return;
    const jetzt = Date.now();
    for (const k of this.karten.values()) {
      if (k.status === 'beantwortet' || k.status === 'verworfen') continue;
      if (jetzt - k.erstellt > AEHNLICH_FENSTER_MS) continue;
      if (aehnlichkeit(k.text, b.text) >= AEHNLICH_AB) {
        k.mehrfach = (k.mehrfach ?? 1) + 1;
        k.namen = [...new Set([...(k.namen ?? []), b.name])];
        return this.emit('ereignis', { typ: 'karte', karte: k });
      }
    }
    const karte = {
      id: crypto.randomUUID(), status: 'pruefe', art: b.art, name: b.name, namen: [b.name],
      text: b.text, erstellt: jetzt, mehrfach: 1,
    };
    this.karten.set(karte.id, karte);
    this.emit('ereignis', { typ: 'karte', karte });
    this.warteschlange.push({ karte, verlauf: [...this.verlauf] });
    this.#weiter();
  }

  #weiter() {
    while (this.laufend < PARALLEL && this.warteschlange.length) {
      const job = this.warteschlange.shift();
      this.laufend++;
      this.#bearbeite(job).finally(() => { this.laufend--; this.#weiter(); });
    }
  }

  async #bearbeite({ karte, verlauf }) {
    const start = Date.now();
    try {
      // Erst das bereinigte Kompendium, dann die besten Stellen aus Kurs und Calls.
      const q = karte.text + ' ' + verlauf.slice(-4).join(' ');
      const treffer = [
        ...this.wissen.suche(q, 3, (a) => a.quelle?.typ === 'kompendium'),
        ...this.wissen.suche(q, 4, (a) => a.quelle?.typ !== 'kompendium'),
      ];
      const hinweis = await this.coach.antworte({ beitrag: karte, verlauf, treffer });
      if (!this.karten.has(karte.id)) return; // inzwischen gelöscht (Notaus)
      if (!hinweis.ist_frage) { karte.status = 'verworfen'; }
      else { karte.status = karte.status === 'beantwortet' ? 'beantwortet' : 'offen'; karte.hinweis = hinweis; }
      karte.dauerMs = Date.now() - start;
    } catch (e) {
      if (!this.karten.has(karte.id)) return;
      karte.status = 'fehler'; karte.fehler = e.message;
    }
    this.emit('ereignis', { typ: 'karte', karte });
  }

  setzeStatus(id, status) {
    const k = this.karten.get(id);
    if (!k || !['offen', 'beantwortet', 'verworfen'].includes(status)) return false;
    k.status = status;
    this.emit('ereignis', { typ: 'karte', karte: k });
    return true;
  }

  zustand() {
    return { mitschrift: this.mitschrift.slice(-80), karten: [...this.karten.values()].filter((k) => k.status !== 'verworfen') };
  }

  // Notaus: alles vergessen
  leeren() {
    this.puffer.offen.forEach((e) => clearTimeout(e.timer)); this.puffer.offen.clear();
    this.verlauf = []; this.mitschrift = []; this.karten.clear(); this.warteschlange = [];
    this.emit('ereignis', { typ: 'geleert' });
  }
}
