// Testmodus: spielt ein altes Zoom-Transkript (.vtt) und optional den gespeicherten Zoom-Chat (.txt)
// in Echtzeit (oder schneller) ab, als käme es live über RTMS.
import { parseVtt } from './wissen.mjs';

function sekunden(hms) {
  const teile = String(hms).split(':').map(Number);
  return teile.reduce((s, x) => s * 60 + x, 0);
}

// Zoom-Chat-Export, z. B. "00:12:34 Von Anna Muster an Alle: Text" oder
// "00:12:34 From Anna Muster to Everyone:" mit dem Text in der nächsten Zeile.
export function parseChat(text) {
  const out = [];
  const kopf = /^(\d{1,2}:\d{2}:\d{2})\s+(?:Von|From)\s+(.+?)\s+(?:an|to)\s+(.+?)\s*:\s*(.*)$/i;
  for (const zeile of String(text).replace(/\r/g, '').split('\n')) {
    const m = zeile.match(kopf);
    if (m) {
      const privat = !/^(alle|jeder|everyone)/i.test(m[3].trim());
      out.push({ t: sekunden(m[1]), name: m[2].trim(), text: m[4].trim(), privat });
    } else if (out.length && zeile.trim()) {
      const letzte = out[out.length - 1];
      letzte.text = (letzte.text ? letzte.text + ' ' : '') + zeile.trim();
    }
  }
  return out.filter((c) => !c.privat && c.text);
}

export function zeitleiste({ vtt = '', chat = '' }) {
  const sprache = parseVtt(vtt).map((c) => ({ t: sekunden(c.start), art: 'sprache', name: c.sprecher || 'Unbekannt', text: c.text }));
  const nachrichten = parseChat(chat).map((c) => ({ t: c.t, art: 'chat', name: c.name, text: c.text }));
  return [...sprache, ...nachrichten].sort((a, b) => a.t - b.t);
}

export function spieleAb(ereignisse, ziel, { tempo = 1, meeting = 'simulation' } = {}) {
  const timer = [];
  const t0 = ereignisse[0]?.t ?? 0;
  for (const e of ereignisse) {
    const ms = Math.max(0, (e.t - t0) * 1000 / tempo);
    const h = setTimeout(() => ziel({ ...e, meeting, zeit: Date.now() }), ms);
    h.unref?.();
    timer.push(h);
  }
  const dauer = ereignisse.length ? (ereignisse.at(-1).t - t0) / tempo : 0;
  return { anzahl: ereignisse.length, dauerSek: Math.round(dauer), stop: () => timer.forEach(clearTimeout) };
}
