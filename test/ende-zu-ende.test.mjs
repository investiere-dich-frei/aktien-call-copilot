// Ende-zu-Ende: ein nachgebauter Zoom-RTMS-Server (Protokoll laut Zoom-Doku) liefert Transkript und Chat,
// der Copilot erkennt Fragen und schickt Karten mit Hinweis per SSE an die Oberfläche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { erstelleServer } from '../server/index.mjs';
import { signiere } from '../server/webhook.mjs';
import { signatur } from '../server/zoom-rtms.mjs';
import { Wissen } from '../server/wissen.mjs';

const ZOOM = { ZOOM_CLIENT_ID: 'cid', ZOOM_CLIENT_SECRET: 'csec', ZOOM_WEBHOOK_SECRET_TOKEN: 'whsec', COACH_TOKEN: 'testtoken', TRAINER_NAMEN: 'Christian' };

function fakeZoom() {
  const log = { signal: [], media: [] };
  const wss = new WebSocketServer({ port: 0 });
  const port = () => wss.address().port;
  wss.on('connection', (ws, req) => {
    if (req.url === '/signal') {
      ws.on('message', (raw) => {
        const m = JSON.parse(raw); log.signal.push(m);
        if (m.msg_type === 1) {
          assert.equal(m.signature, signatur('cid', 'csec', m.meeting_uuid, m.rtms_stream_id));
          ws.send(JSON.stringify({ msg_type: 2, status_code: 0, media_server: { server_urls: { all: `ws://127.0.0.1:${port()}/media` } } }));
          ws.send(JSON.stringify({ msg_type: 12, timestamp: 111 }));
        }
        if (m.msg_type === 7) log.bereit?.();
      });
    } else {
      ws.on('message', (raw) => {
        const m = JSON.parse(raw); log.media.push(m);
        if (m.msg_type === 3) {
          ws.send(JSON.stringify({ msg_type: 4, status_code: 0, media_params: { transcript: { content_type: 5 }, chat: { content_type: 5 } } }));
          log.bereit = () => {
            const t = Date.now();
            ws.send(JSON.stringify({ msg_type: 12, timestamp: 222 }));
            ws.send(JSON.stringify({ msg_type: 17, content: { user_id: 1, user_name: 'Christian Bolda', data: 'Diese Aktie ist risikolos.', timestamp: t } }));
            ws.send(JSON.stringify({ msg_type: 17, content: { user_id: 2, user_name: 'Lena Probe', data: 'Was genau sagt mir', timestamp: t } }));
            ws.send(JSON.stringify({ msg_type: 17, content: { user_id: 2, user_name: 'Lena Probe', data: 'eigentlich das KGV', timestamp: t } }));
            ws.send(JSON.stringify({ msg_type: 18, content: { timestamp: t, data: 'Wie berechne ich die Dividendenrendite?', chat_session: { type: 1 }, operation_type: 1, message_id: 'm1', sender: { user_id: 3, user_name: 'Max Test' } } }));
            ws.send(JSON.stringify({ msg_type: 18, content: { timestamp: t, data: 'wie berechnet man die dividendenrendite', chat_session: { type: 1 }, operation_type: 1, message_id: 'm2', sender: { user_id: 4, user_name: 'Sara Test' } } }));
            ws.send(JSON.stringify({ msg_type: 18, content: { timestamp: t, data: 'Danke!', chat_session: { type: 1 }, operation_type: 1, message_id: 'm3', sender: { user_id: 3, user_name: 'Max Test' } } }));
          };
        }
      });
    }
  });
  return new Promise((ok) => wss.on('listening', () => ok({ wss, log, url: `ws://127.0.0.1:${port()}/signal` })));
}

function post(port, pfad, body, headers = {}) {
  return new Promise((ok, fehler) => {
    const req = http.request({ port, path: pfad, method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => ok({ status: res.statusCode, body: d ? JSON.parse(d) : null }));
    });
    req.on('error', fehler); req.end(body);
  });
}

function sseSammeln(port, token, bis) {
  return new Promise((ok, fehler) => {
    const ereignisse = [];
    const req = http.get({ port, path: `/api/stream?token=${token}` }, (res) => {
      let puffer = '';
      res.on('data', (c) => {
        puffer += c;
        let i;
        while ((i = puffer.indexOf('\n\n')) >= 0) {
          const block = puffer.slice(0, i); puffer = puffer.slice(i + 2);
          if (block.startsWith('data: ')) { ereignisse.push(JSON.parse(block.slice(6))); if (bis(ereignisse)) { req.destroy(); ok(ereignisse); } }
        }
      });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') fehler(e); });
  });
}

test('Zoom-RTMS bis zur Fragekarte', async () => {
  const zoom = await fakeZoom();
  const anfragen = [];
  const coach = { modell: 'fake', antworte: async ({ beitrag, verlauf, treffer }) => {
    anfragen.push({ beitrag, verlauf, treffer });
    return { ist_frage: true, frage: beitrag.text, thema: 'T', antwort_stichpunkte: ['a'], antwort_satz: 's', rueckfrage: '', abgedeckt: 'wissensbasis', quellen: [], warnung: '' };
  } };
  const wissen = new Wissen([{ quelle: { typ: 'kurs', titel: 'KGV' }, text: 'Das KGV teilt den Kurs durch den Gewinn.' }]);
  const { server, stop } = erstelleServer({ ...ZOOM, coach, wissen });
  await new Promise((ok) => server.listen(0, ok));
  const port = server.address().port;

  try {
    // ohne Token kein Zugriff
    assert.equal((await post(port, '/api/notaus', '{}')).status, 401);

    // URL-Validierung und falsche Signatur
    const ts = String(Math.floor(Date.now() / 1000));
    const val = JSON.stringify({ event: 'endpoint.url_validation', payload: { plainToken: 'pt' } });
    const r1 = await post(port, '/zoom/webhook', val, { 'x-zm-request-timestamp': ts, 'x-zm-signature': signiere('whsec', ts, val) });
    assert.equal(r1.body.plainToken, 'pt');
    assert.equal((await post(port, '/zoom/webhook', val, { 'x-zm-request-timestamp': ts, 'x-zm-signature': 'v0=falsch' })).status, 401);

    const fertig = sseSammeln(port, 'testtoken', (e) => {
      const karten = new Map(e.filter((x) => x.typ === 'karte').map((x) => [x.karte.id, x.karte]));
      return [...karten.values()].filter((k) => k.status === 'offen').length >= 2 && [...karten.values()].some((k) => k.mehrfach === 2);
    });
    await new Promise((ok) => setTimeout(ok, 100));

    const start = JSON.stringify({ event: 'meeting.rtms_started', payload: { meeting_uuid: 'm==', rtms_stream_id: 's1', server_urls: zoom.url } });
    const r2 = await post(port, '/zoom/webhook', start, { 'x-zm-request-timestamp': ts, 'x-zm-signature': signiere('whsec', ts, start) });
    assert.equal(r2.status, 200);

    const ereignisse = await fertig;

    // Protokoll: Handshakes, Keep-alive beantwortet, CLIENT_READY_ACK gesendet
    assert.ok(zoom.log.signal.some((m) => m.msg_type === 13 && m.timestamp === 111), 'Keep-alive Signaling');
    assert.ok(zoom.log.signal.some((m) => m.msg_type === 7 && m.rtms_stream_id === 's1'), 'CLIENT_READY_ACK');
    const hs = zoom.log.media.find((m) => m.msg_type === 3);
    assert.equal(hs.media_type, 32);
    assert.equal(hs.media_params.transcript.src_language, 14);
    assert.ok(zoom.log.media.some((m) => m.msg_type === 13 && m.timestamp === 222), 'Keep-alive Media');

    // Regelwächter für den Trainer
    assert.ok(ereignisse.some((e) => e.typ === 'regel' && e.treffer[0].id === 'versprechen'));
    // Transkript-Stücke derselben Person wurden zu einer Frage zusammengefügt
    const karten = new Map(ereignisse.filter((x) => x.typ === 'karte').map((x) => [x.karte.id, x.karte]));
    const texte = [...karten.values()].map((k) => k.text);
    assert.ok(texte.includes('Was genau sagt mir eigentlich das KGV'), texte.join(' | '));
    assert.ok(!texte.some((t) => t.includes('Danke')), 'Danke ist keine Frage');
    // doppelte Chat-Frage wurde zusammengefasst, Claude nur zweimal gefragt
    assert.equal(anfragen.length, 2);
    // an Claude gehen keine Namen der Lernenden
    for (const a of anfragen) assert.ok(!a.verlauf.join(' ').match(/Lena|Max|Sara/), a.verlauf.join(' '));
    assert.equal(anfragen.find((a) => a.beitrag.text.includes('KGV')).treffer[0].quelle.titel, 'KGV');

    // Notaus löscht alles
    const n = await post(port, '/api/notaus', '{}', { authorization: 'Bearer testtoken' });
    assert.equal(n.status, 200);
  } finally {
    stop(); zoom.wss.close();
  }
});
