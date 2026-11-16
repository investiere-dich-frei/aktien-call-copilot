import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pruefeSignatur, signiere, urlValidierung } from '../server/webhook.mjs';
import { istFrage, pruefeRegeln, aehnlichkeit } from '../server/fragen.mjs';
import { Wissen, parseVtt, anonymisiere, abschnitteAusCues, abschnitteAusText, abschnitteAusKompendium, tokens } from '../server/wissen.mjs';
import { parseChat, zeitleiste } from '../server/simulator.mjs';
import { chatText, signatur } from '../server/zoom-rtms.mjs';
import { baueAnfrage } from '../server/coach.mjs';

const B = new URL('./beispiel/', import.meta.url);

test('Webhook-Signatur: gültig, falsch, zu alt', () => {
  const jetzt = Date.now(), ts = String(Math.floor(jetzt / 1000)), body = '{"event":"x"}';
  const sig = signiere('geheim', ts, body);
  assert.ok(pruefeSignatur({ secret: 'geheim', timestamp: ts, signatur: sig, rohBody: body, jetzt }));
  assert.ok(!pruefeSignatur({ secret: 'anders', timestamp: ts, signatur: sig, rohBody: body, jetzt }));
  assert.ok(!pruefeSignatur({ secret: 'geheim', timestamp: ts, signatur: sig, rohBody: body + ' ', jetzt }));
  assert.ok(!pruefeSignatur({ secret: 'geheim', timestamp: ts, signatur: sig, rohBody: body, jetzt: jetzt + 600_000 }));
  const v = urlValidierung('geheim', 'abc');
  assert.equal(v.plainToken, 'abc');
  assert.match(v.encryptedToken, /^[0-9a-f]{64}$/);
});

test('RTMS-Signatur folgt "clientId,meetingUuid,streamId"', () => {
  assert.equal(signatur('id', 'sec', 'm', 's').length, 64);
  assert.notEqual(signatur('id', 'sec', 'm', 's'), signatur('id', 'sec', 'm', 's2'));
});

test('Chat-Inhalt als Klartext oder JSON', () => {
  assert.equal(chatText('Hallo'), 'Hallo');
  assert.equal(chatText('{"text":"Wie geht das?"}'), 'Wie geht das?');
  assert.equal(chatText('{kein json'), '{kein json');
});

test('Fragen erkennen', () => {
  for (const f of ['Was genau sagt mir das KGV', 'wie berechne ich die dividendenrendite', 'Ich verstehe nicht, wann die Dividende kommt.', 'Lohnt sich ein Sparplan?', 'Gibt es einen Unterschied zwischen ETF und Fonds']) {
    assert.ok(istFrage(f), f);
  }
  for (const f of ['Danke, super erklärt!', 'Hallo zusammen', 'Habt ihr noch Fragen?', 'Ok']) assert.ok(!istFrage(f), f);
});

test('Regelwächter', () => {
  assert.deepEqual(pruefeRegeln('Diese Aktie ist risikolos').map((r) => r.id), ['versprechen']);
  assert.ok(pruefeRegeln('An deiner Stelle würde ich die verkaufen').some((r) => r.id === 'anlageberatung'));
  assert.ok(pruefeRegeln('Kauft jetzt die Aktie').some((r) => r.id === 'anlageberatung'));
  assert.equal(pruefeRegeln('Das KGV vergleicht man in derselben Branche').length, 0);
  assert.equal(pruefeRegeln('Wir sind zu 100 Prozent dabei').length, 0);
});

test('Ähnliche Fragen werden erkannt', () => {
  assert.ok(aehnlichkeit('Wie berechne ich die Dividendenrendite?', 'wie berechnet man die dividendenrendite') >= 0.5);
  assert.ok(aehnlichkeit('Wie berechne ich die Dividendenrendite?', 'Was ist ein ETF?') < 0.2);
});

test('Umlaute und Stoppwörter', () => {
  assert.deepEqual(tokens('Für Über'), []);
  assert.deepEqual(tokens('Dividenden'), tokens('Dividende'));
});

test('VTT lesen, anonymisieren, in Abschnitte teilen', () => {
  const vtt = fs.readFileSync(new URL('roh/calls/2026-03-12_Fragerunde.vtt', B), 'utf8');
  const cues = anonymisiere(parseVtt(vtt), ['Emilia']);
  assert.equal(cues.length, 3);
  assert.equal(cues[1].sprecher, 'Teilnehmer:in');
  assert.ok(cues[2].text.includes('[Name]'), 'Name im Text ersetzt');
  assert.ok(!JSON.stringify(cues).includes('Jonas'));
  assert.equal(cues[0].sprecher, 'Emilia Test');
  const ab = abschnitteAusCues(cues, { typ: 'call', titel: 'T' });
  assert.equal(ab.length, 1);
  assert.equal(ab[0].quelle.stelle, 'ab 00:00:05');
});

test('Suche findet die passende Lektion', () => {
  const w = new Wissen([
    { quelle: { typ: 'kurs', titel: 'Dividenden' }, text: 'Die Dividendenrendite ist die Dividende geteilt durch den Kurs.' },
    { quelle: { typ: 'kurs', titel: 'KGV' }, text: 'Das Kurs-Gewinn-Verhältnis teilt den Kurs durch den Gewinn je Aktie.' },
  ]);
  assert.equal(w.suche('Was sagt das Kurs-Gewinn-Verhältnis?')[0].quelle.titel, 'KGV');
  assert.equal(w.suche('Wie hoch ist die Dividendenrendite')[0].quelle.titel, 'Dividenden');
  assert.deepEqual(new Wissen([]).suche('egal'), []);
});

test('Zoom-Chat-Export: nur Nachrichten an alle', () => {
  const c = parseChat(fs.readFileSync(new URL('chat.txt', B), 'utf8'));
  assert.equal(c.length, 3);
  assert.ok(!c.some((x) => x.text.includes('privat')));
  const z = zeitleiste({ vtt: fs.readFileSync(new URL('live.vtt', B), 'utf8'), chat: fs.readFileSync(new URL('chat.txt', B), 'utf8') });
  assert.deepEqual(z.map((e) => e.t), [...z.map((e) => e.t)].sort((a, b) => a - b));
  assert.equal(z.length, 6);
});

test('Anfrage an Claude: keine Namen von Lernenden, Systemteil gecacht', () => {
  const { system, messages } = baueAnfrage({
    beitrag: { art: 'chat', text: 'Wie berechne ich die Dividendenrendite?', name: 'Max Test' },
    verlauf: ['Teilnehmer:in (Chat): Wie berechne ich die Dividendenrendite?'],
    treffer: [{ quelle: { typ: 'kurs', titel: 'Kurs › Dividenden', stelle: 'Teil 1' }, text: 'X' }],
    kompendium: 'K',
  });
  assert.ok(!messages[0].content.includes('Max'));
  assert.equal(system.at(-1).cache_control.type, 'ephemeral');
  assert.equal(system.at(-1).cache_control.ttl, '1h');
  assert.ok(messages[0].content.includes('titel="Kurs › Dividenden"'));
});

test('Langes Transkript ohne Absätze wird in handliche Abschnitte geteilt', () => {
  const satz = 'Die Stop-Loss-Order sichert deinen Gewinn ab, sobald der Kurs gestiegen ist. ';
  const text = satz.repeat(200); // ca. 2.400 Wörter, ein einziger Absatz
  const teile = abschnitteAusText(text, { typ: 'kurs', titel: 'Test' });
  assert.ok(teile.length >= 10);
  for (const t of teile) assert.ok(t.text.split(/\s+/).length <= 230);
  assert.equal(teile[0].quelle.stelle, 'Teil 1');
});

test('Kompendium: je Frage ein Abschnitt, Suche lässt sich auf das Kompendium filtern', () => {
  const md = `# Titel\n\n## Depot-Management\n\n### Emilias Regeln\n- Ab 20 % Gewinn Stop-Loss 5 % darunter setzen.\n\n### Häufige Fragen\n#### Wann setze ich den Stop-Loss? (12× gefragt)\n**Antwort:** Ab 20 % Plus, Abstand 5 %.\n\n#### Wie oft nachziehen? (3× gefragt)\n**Antwort:** Einmal am Tag.\n`;
  const teile = abschnitteAusKompendium(md);
  assert.equal(teile.length, 3);
  assert.equal(teile[1].quelle.stelle, 'Wann setze ich den Stop-Loss? (12× gefragt)');
  assert.ok(teile[1].text.startsWith('Depot-Management › Häufige Fragen'));
  const w = new Wissen([...teile, { quelle: { typ: 'kurs', titel: 'Kurs › 6.5' }, text: 'Stop-Loss setzen im Kurs' }]);
  const nurKompendium = w.suche('Stop-Loss', 5, (a) => a.quelle.typ === 'kompendium');
  assert.ok(nurKompendium.length >= 1 && nurKompendium.every((t) => t.quelle.typ === 'kompendium'));
});
