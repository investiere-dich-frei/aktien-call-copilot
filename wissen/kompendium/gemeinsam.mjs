// Gemeinsame Bausteine für das Kompendium: Themen, Dokumente einlesen, Ausgabe-Schema, Prompts.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { parseVtt, anonymisiere } from '../../server/wissen.mjs';

export const MODELL_EXTRAKT = 'claude-sonnet-5-5'; // Massenauszug (vom Nutzer freigegeben: günstigeres Modell)
export const MODELL_KAPITEL = 'claude-opus-5-5';

// Themen des Kompendiums (Reihenfolge = Reihenfolge im Dokument).
export const THEMEN = [
  ['finanzplan', 'Finanzplan, Ziele und Sparrate', 'Finanzielle Ausgangslage, Ziele, Rentenlücke, Notgroschen, Sparrate, wie viel investieren'],
  ['mindset', 'Mindset und Umgang mit Emotionen', 'Angst, Geduld, Disziplin, Umgang mit Verlusten und Rücksetzern, Dranbleiben'],
  ['grundlagen', 'Aktien-Grundlagen', 'Börse, Aktie, Indizes, Börsenplätze, Handelszeiten, Orderarten, Kerzen, Begriffe'],
  ['broker', 'Broker und Depot', 'Broker-Wahl, Depoteröffnung, Scalable Capital, CapTrader, Interactive Brokers, Gebühren, Sparpläne, Währung'],
  ['dps', 'DPS-Strategie', 'Die DPS-Strategie von Emilia: Aufbau, Regeln, Ablauf, Abgrenzung zu anderen Strategien'],
  ['fundamental', 'Fundamentalanalyse', 'Unternehmen finden und prüfen, Kennzahlen (KGV, PEG, Umsatz, Gewinn, Marge, Verschuldung, Dividende), Quellen'],
  ['technisch', 'Technische Analyse und Einstieg', 'Charts, Trends, Unterstützung und Widerstand, Einstiegszeitpunkt, TradingView, Zeiteinheiten'],
  ['indikatoren', 'Indikatoren', 'RSI, MACD, gleitende Durchschnitte und weitere Indikatoren, Einstellungen, Deutung'],
  ['depot', 'Depot-Management', 'Stop-Loss, Gewinne sichern, Nachkaufen, Verkaufen, Positionsgröße, Diversifikation, Depotaufteilung, Rebalancing'],
  ['langfrist', 'Buy & Hold, ETFs und Dividenden', 'Buy-and-Hold-Teil, ETFs, Dividendenstrategie, Sparpläne langfristig'],
  ['steuern', 'Steuern', 'Abgeltungsteuer, Freistellungsauftrag, Quellensteuer, Verlustverrechnung, Österreich, Schweiz'],
  ['tools', 'Tools und Excel-Listen', 'Excel-Tools, Renditecheck, Börsencockpit, Watchlist, Hilfsmittel aus dem Kurs'],
  ['markt', 'Marktlage und Zeitgeschehen', 'Allgemeine Marktphasen, Zinsen, Krisen, Crashs, Makro – zeitgebunden, immer mit Datum'],
  ['kurs', 'Kurs, Calls und Organisatorisches', 'Aufbau der Masterclass, Module, Calls, LearningSuite, Zertifikat, Community'],
];
export const THEMEN_IDS = THEMEN.map((t) => t[0]);

// Ausgabe des Auszugs je Dokument.
export const Auszug = z.object({
  fragen: z.array(z.object({
    thema: z.enum(THEMEN_IDS),
    frage: z.string().describe('Die Frage der Teilnehmerin, allgemein und ohne Namen formuliert'),
    antwort: z.string().describe('Kern der Antwort von Emilia/Sarah bzw. aus dem Kurs, sachlich, 1–5 Sätze, mit Zahlen und Regeln'),
    von: z.enum(['Emilia', 'Sarah', 'Kurs']),
    zeit: z.string().describe('Zeitmarke hh:mm:ss der Frage im Call, leer bei Kurs'),
  })),
  regeln: z.array(z.object({
    thema: z.enum(THEMEN_IDS),
    regel: z.string().describe('Faustregel, Vorgehen oder feste Aussage mit konkreten Zahlen'),
    zeit: z.string(),
  })),
  unternehmen: z.array(z.object({
    name: z.string().describe('Gängiger Unternehmensname ohne Rechtsform, z. B. "Coca-Cola", "Alphabet (Google)"'),
    ticker: z.string().describe('Ticker, wenn genannt oder eindeutig, sonst leer'),
    art: z.enum(['Analyse', 'Einschätzung', 'Beispiel', 'Erwähnung']),
    aussage: z.string().describe('Was genau dazu gesagt wurde, 1–4 Sätze, ohne eigene Bewertung'),
    zeit: z.string(),
  })),
});

export const SYSTEM_AUSZUG = `Du wertest Material der Aktien-Mentoring-Masterclass von Investiere Dich Frei (Coach: Emilia Bolda) für ein internes Coach-Kompendium aus. Du bekommst entweder das Transkript eines Live-Calls (Emilia: Advanced Calls und Gruppen-Coaching; Sarah Klein: Basic Calls für Modul 1–5) oder eine Kurslektion bzw. FAQ-Seite.

Ziehe heraus:
1. fragen: jede inhaltliche Frage einer Teilnehmerin mit der Antwort von Emilia/Sarah. Formuliere die Frage allgemein (ohne Namen, ohne persönliche Depotstände), die Antwort als Kern mit allen Zahlen und Regeln. Bei Kurs/FAQ: die Fragen, die die Lektion beantwortet, mit von="Kurs".
2. regeln: Faustregeln und feste Vorgehensweisen mit konkreten Zahlen (z. B. Prozentwerte, Abstände, Reihenfolgen).
3. unternehmen: jede Aktie bzw. jedes Unternehmen, über das etwas gesagt wird, mit dem, was genau gesagt wurde (Analyse-Ergebnis, Einschätzung, ob im Depot, gekauft, beobachtet, verkauft, warum). Reine Namensnennungen ohne Aussage als art="Erwähnung" knapp.

Regeln:
- Nur was im Material steht. Nichts ergänzen, nichts bewerten.
- Keine Namen von Teilnehmerinnen, keine E-Mail-Adressen, keine Kontostände einzelner Personen.
- Small Talk, Technikprobleme, Begrüßung, reine Organisation ohne Wissenswert weglassen.
- zeit: Zeitmarke hh:mm:ss aus dem Transkript, bei Kurs leer.
- Antworte auf Deutsch.`;

// Rohdokumente einlesen. Calls werden anonymisiert und kompakt mit Zeitmarken aufbereitet.
export function dokumente(roh, trainerin = ['Emilia Bolda', 'Sarah Klein']) {
  const out = [];
  const liste = (o) => fs.existsSync(o) ? fs.readdirSync(o, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(o, e.name); return e.isDirectory() ? liste(p) : [p];
  }).sort() : [];
  for (const d of liste(path.join(roh, 'calls')).filter((p) => p.endsWith('.vtt'))) {
    const name = path.basename(d, '.vtt');
    const cues = anonymisiere(parseVtt(fs.readFileSync(d, 'utf8')), trainerin);
    const text = cues.map((c) => `[${c.start}] ${c.sprecher ? c.sprecher + ': ' : ''}${c.text}`).join('\n');
    out.push({ id: 'call-' + name.slice(0, 10) + '-' + kurz(name), typ: 'call', titel: name, datum: name.slice(0, 10), text });
  }
  for (const d of liste(path.join(roh, 'kurs')).filter((p) => p.endsWith('.txt'))) {
    const rel = path.relative(path.join(roh, 'kurs'), d).replace(/\.txt$/, '');
    out.push({ id: 'kurs-' + kurz(rel), typ: 'kurs', titel: rel.split(path.sep).join(' › '), datum: '', text: fs.readFileSync(d, 'utf8') });
  }
  return out;
}

function kurz(s) {
  let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/-+$/, '') + '-' + h.toString(36);
}

export function auszugAnfrage(dok) {
  const art = dok.typ === 'call' ? `Live-Call vom ${dok.datum}: ${dok.titel}` : `Kursmaterial: ${dok.titel}`;
  return {
    model: MODELL_EXTRAKT,
    max_tokens: 32000,
    system: SYSTEM_AUSZUG,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: zodOutputFormat(Auszug).schema } },
    messages: [{ role: 'user', content: `${art}\n\n<material>\n${dok.text}\n</material>` }],
  };
}
