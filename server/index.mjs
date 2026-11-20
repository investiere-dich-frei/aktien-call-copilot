// Aktien-Call-Copilot: HTTP-Server für Zoom-Webhooks (RTMS), Live-Ereignisse (SSE) und Oberfläche.
//   POST /zoom/webhook        Zoom: endpoint.url_validation, meeting.rtms_started/_stopped
//   GET  /api/stream          Live-Ereignisse für die Oberfläche (Server-Sent Events)
//   GET  /api/status          KI, Wissensdatenbank, laufende Streams
//   POST /api/karte/:id       { status: 'offen'|'beantwortet'|'verworfen' }
//   POST /api/simulation      { vtt, chat, tempo }  Aufzeichnung abspielen
//   POST /api/notaus          alles stoppen und vergessen
//   POST /api/beitrag         Mac-Mithörer: { art: 'sprache'|'chat', name, text } (fertig transkribierter Beitrag)
// Zugriff auf /api/* nur mit COACH_TOKEN (Header "Authorization: Bearer …" oder ?token=… beim Stream).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pruefeSignatur, urlValidierung } from './webhook.mjs';
import { RtmsClient } from './zoom-rtms.mjs';
import { Wissen } from './wissen.mjs';
import { erstelleCoach, ladeKompendium } from './coach.mjs';
import { Copilot } from './copilot.mjs';
import { zeitleiste, spieleAb } from './simulator.mjs';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BODY = 5 * 1024 * 1024;

export function erstelleServer(cfg = {}) {
  const env = { ...process.env, ...cfg };
  const token = env.COACH_TOKEN || crypto.randomBytes(18).toString('base64url');
  const wissen = cfg.wissen ?? Wissen.laden(env.WISSEN_INDEX || path.join(WURZEL, 'wissen/index.json'));
  const kompendium = ladeKompendium(env.WISSEN_KOMPENDIUM || path.join(WURZEL, 'wissen/kompendium.md'));
  const coach = cfg.coach ?? erstelleCoach({ kompendium });
  const copilot = new Copilot({ coach, wissen, trainerNamen: (env.TRAINER_NAMEN || 'Christian,Emilia,Sarah').split(',').map((s) => s.trim()) });

  const zoomBereit = Boolean(env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET && env.ZOOM_WEBHOOK_SECRET_TOKEN);
  const rtms = env.ZOOM_CLIENT_ID && env.ZOOM_CLIENT_SECRET
    ? new RtmsClient({ clientId: env.ZOOM_CLIENT_ID, clientSecret: env.ZOOM_CLIENT_SECRET, WebSocketImpl: cfg.WebSocketImpl })
    : null;
  const streams = new Map();
  if (rtms) {
    rtms.on('beitrag', (b) => copilot.beitrag(b));
    rtms.on('status', (s) => {
      if (s.zustand === 'beendet') { streams.delete(s.meeting); copilot.puffer.leeren(); } else streams.set(s.meeting, s.zustand);
      sende({ typ: 'zoom', ...s });
    });
  }

  const clients = new Set();
  function sende(e) { const d = `data: ${JSON.stringify(e)}\n\n`; for (const c of clients) c.write(d); }
  copilot.on('ereignis', sende);

  let simulation = null;
  let mithoerer = null; // Zeitpunkt des letzten Beitrags vom Mac-Mithörer

  const status = () => ({
    ki: coach.modell, wissen: wissen.groesse, kompendium: kompendium.length > 0,
    zoom: zoomBereit ? 'bereit' : 'nicht eingerichtet', streams: [...streams.values()], simulation: Boolean(simulation),
    mithoerer: mithoerer && Date.now() - mithoerer < 120_000 ? 'verbunden' : 'aus',
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'POST' && url.pathname === '/zoom/webhook') return await webhook(req, res);
      if (url.pathname.startsWith('/api/')) {
        if (!erlaubt(req, url)) return json(res, 401, { fehler: 'nicht angemeldet' });
        if (req.method === 'GET' && url.pathname === '/api/stream') return stream(req, res);
        if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, status());
        if (req.method === 'POST' && url.pathname.startsWith('/api/karte/')) {
          const { status: st } = JSON.parse(await lies(req) || '{}');
          return json(res, copilot.setzeStatus(url.pathname.split('/').pop(), st) ? 200 : 404, {});
        }
        if (req.method === 'POST' && url.pathname === '/api/simulation') {
          const { vtt = '', chat = '', tempo = 1 } = JSON.parse(await lies(req) || '{}');
          simulation?.stop();
          const ereignisse = zeitleiste({ vtt, chat });
          if (!ereignisse.length) return json(res, 400, { fehler: 'Keine Beiträge in den Dateien gefunden' });
          simulation = spieleAb(ereignisse, (b) => copilot.beitrag(b), { tempo: Math.min(20, Math.max(0.5, Number(tempo) || 1)) });
          setTimeout(() => { simulation = null; }, simulation.dauerSek * 1000 + 3000).unref();
          return json(res, 200, { anzahl: simulation.anzahl, dauerSek: simulation.dauerSek });
        }
        if (req.method === 'POST' && url.pathname === '/api/beitrag') {
          const { art = 'sprache', name = '', text = '' } = JSON.parse(await lies(req) || '{}');
          const sauber = String(text).replace(/\s+/g, ' ').trim().slice(0, 4000);
          if (!['sprache', 'chat'].includes(art) || !sauber) return json(res, 400, { fehler: 'art und text nötig' });
          const n = String(name).trim().slice(0, 80) || 'Teilnehmer:in';
          const neu = !mithoerer || Date.now() - mithoerer >= 120_000;
          mithoerer = Date.now();
          if (neu) sende({ typ: 'zoom', zustand: 'mithoerer', meeting: 'mithoerer' });
          copilot.beitrag({ art, meeting: 'mithoerer', userId: n, name: n, text: sauber, zeit: Date.now() });
          return json(res, 200, {});
        }
        if (req.method === 'POST' && url.pathname === '/api/notaus') {
          simulation?.stop(); simulation = null;
          rtms?.stopAlle();
          copilot.leeren();
          return json(res, 200, {});
        }
        return json(res, 404, {});
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...SICHERHEIT });
        return fs.createReadStream(path.join(WURZEL, 'public/index.html')).pipe(res);
      }
      if (url.pathname === '/health') {
        // aktivVorSek: Sekunden seit dem letzten Beitrag (Call, Mithörer, Test). Das Update-Skript wartet, solange ein Call läuft.
        const l = copilot.letzterBeitrag;
        return json(res, 200, { ok: true, aktivVorSek: l ? Math.round((Date.now() - l) / 1000) : null });
      }
      json(res, 404, {});
    } catch (e) {
      json(res, 500, { fehler: e.message });
    }
  });

  function erlaubt(req, url) {
    const h = req.headers.authorization ?? '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token') ?? '';
    const a = Buffer.from(t), b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async function webhook(req, res) {
    const roh = await lies(req);
    const ok = pruefeSignatur({
      secret: env.ZOOM_WEBHOOK_SECRET_TOKEN, timestamp: req.headers['x-zm-request-timestamp'],
      signatur: req.headers['x-zm-signature'], rohBody: roh,
    });
    if (!ok) return json(res, 401, { fehler: 'Signatur ungültig' });
    const { event, payload = {} } = JSON.parse(roh);
    if (event === 'endpoint.url_validation') return json(res, 200, urlValidierung(env.ZOOM_WEBHOOK_SECRET_TOKEN, payload.plainToken));
    json(res, 200, {}); // Zoom erwartet eine schnelle Antwort
    if (!rtms) return;
    if (event === 'meeting.rtms_started' || event === 'webinar.rtms_started') rtms.start(payload);
    else if (event === 'meeting.rtms_stopped' || event === 'webinar.rtms_stopped') rtms.stop(payload);
  }

  function stream(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`data: ${JSON.stringify({ typ: 'start', status: status(), ...copilot.zustand() })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
  }

  return { server, token, copilot, rtms, stop: () => { simulation?.stop(); rtms?.stopAlle(); server.close(); for (const c of clients) c.end(); } };
}

const SICHERHEIT = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
};

function json(res, code, obj) {
  if (res.headersSent) return;
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...SICHERHEIT });
  res.end(JSON.stringify(obj));
}

function lies(req) {
  return new Promise((ok, fehler) => {
    let n = 0; const teile = [];
    req.on('data', (d) => { n += d.length; if (n > MAX_BODY) { fehler(new Error('Anfrage zu groß')); req.destroy(); } else teile.push(d); });
    req.on('end', () => ok(Buffer.concat(teile).toString('utf8')));
    req.on('error', fehler);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8765);
  const host = process.env.HOST || '0.0.0.0';
  const { server, token, stop } = erstelleServer();
  server.listen(port, host, () => {
    console.log(`Aktien-Call-Copilot läuft auf http://${host}:${port}`);
    if (!process.env.COACH_TOKEN) console.log(`Kein COACH_TOKEN gesetzt. Zugang für diese Sitzung: http://localhost:${port}/#token=${token}`);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(0); });
}
