// Zoom Realtime Media Streams (RTMS): Transkript und öffentlicher Chat eines laufenden Meetings.
// Protokoll nach https://developers.zoom.us/docs/rtms/event-reference/universal-events/
//   Webhook meeting.rtms_started  →  Signaling-WebSocket (Handshake msg 1/2)
//   → Media-WebSocket (Handshake msg 3/4) → CLIENT_READY_ACK (msg 7) auf dem Signaling-Socket
//   → Transkript (msg 17) und Chat (msg 18). Keep-alive: 12 → 13 auf beiden Sockets.
// Es wird nichts gespeichert. Beiträge gehen nur als Ereignis an den Bus.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

export const MSG = {
  SIGNAL_HANDSHAKE_REQ: 1, SIGNAL_HANDSHAKE_RESP: 2,
  DATA_HANDSHAKE_REQ: 3, DATA_HANDSHAKE_RESP: 4,
  EVENT_SUBSCRIPTION: 5, EVENT_UPDATE: 6, CLIENT_READY_ACK: 7,
  STREAM_STATE_UPDATE: 8, SESSION_STATE_UPDATE: 9,
  KEEP_ALIVE_REQ: 12, KEEP_ALIVE_RESP: 13,
  MEDIA_DATA_TRANSCRIPT: 17, MEDIA_DATA_CHAT: 18,
};
export const MEDIA = { TRANSCRIPT: 8, CHAT: 16, ALL: 32 };
const SPRACHE_DEUTSCH = 14; // RTMS_TRANSCRIPT_LANGUAGE.LANGUAGE_ID_GERMAN
const CHAT_NEU = 1, CHAT_GEAENDERT = 3, CHAT_AN_ALLE = 1;

export function signatur(clientId, clientSecret, meetingUuid, streamId) {
  return crypto.createHmac('sha256', clientSecret)
    .update(`${clientId},${meetingUuid},${streamId}`).digest('hex');
}

// Chat-Inhalt: laut Doku ein UTF-8-JSON-String, im Beispiel aber Klartext. Beides abfangen.
export function chatText(data) {
  if (typeof data !== 'string') return '';
  const t = data.trim();
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t);
      return String(o.text ?? o.content ?? o.message ?? o.data ?? '').trim();
    } catch { /* kein JSON, Klartext */ }
  }
  return t;
}

export class RtmsClient extends EventEmitter {
  constructor({ clientId, clientSecret, sprache = SPRACHE_DEUTSCH, spracheFest = true, WebSocketImpl = WebSocket, maxVersuche = 3 }) {
    super();
    if (!clientId || !clientSecret) throw new Error('ZOOM_CLIENT_ID und ZOOM_CLIENT_SECRET fehlen');
    Object.assign(this, { clientId, clientSecret, sprache, spracheFest, WebSocketImpl, maxVersuche });
    this.streams = new Map(); // rtms_stream_id → Zustand
  }

  sig(meetingUuid, streamId) { return signatur(this.clientId, this.clientSecret, meetingUuid, streamId); }

  start({ meeting_uuid, rtms_stream_id, server_urls }) {
    if (!meeting_uuid || !rtms_stream_id || !server_urls) throw new Error('rtms_started ohne meeting_uuid/rtms_stream_id/server_urls');
    if (this.streams.has(rtms_stream_id)) return; // doppelter Webhook
    const s = { meetingUuid: meeting_uuid, streamId: rtms_stream_id, serverUrls: server_urls, versuche: 0, beendet: false, sockets: [] };
    this.streams.set(rtms_stream_id, s);
    this.#verbinde(s);
  }

  stop({ rtms_stream_id, meeting_uuid }) {
    for (const [id, s] of this.streams) {
      if (id === rtms_stream_id || (!rtms_stream_id && s.meetingUuid === meeting_uuid)) this.#beende(s, 'gestoppt');
    }
  }

  stopAlle() { for (const s of this.streams.values()) this.#beende(s, 'Server beendet'); }

  #beende(s, grund) {
    s.beendet = true;
    for (const ws of s.sockets) { try { ws.close(); } catch { /* egal */ } }
    this.streams.delete(s.streamId);
    this.emit('status', { meeting: s.meetingUuid, zustand: 'beendet', grund });
  }

  #verbinde(s) {
    const sig = new this.WebSocketImpl(s.serverUrls);
    s.sockets = [sig];
    sig.on('open', () => {
      sig.send(JSON.stringify({
        msg_type: MSG.SIGNAL_HANDSHAKE_REQ, protocol_version: 1, sequence: 0,
        meeting_uuid: s.meetingUuid, rtms_stream_id: s.streamId, signature: this.sig(s.meetingUuid, s.streamId),
      }));
    });
    sig.on('message', (raw) => {
      const msg = parse(raw); if (!msg) return;
      if (msg.msg_type === MSG.SIGNAL_HANDSHAKE_RESP) {
        if (msg.status_code !== 0) return this.#fehler(s, `Signaling-Handshake abgelehnt (status ${msg.status_code} ${msg.reason ?? ''})`, false);
        const urls = msg.media_server?.server_urls ?? {};
        const url = urls.all ?? urls.transcript;
        if (!url) return this.#fehler(s, 'Keine Media-URL im Signaling-Handshake', false);
        this.#verbindeMedia(s, url, sig);
      } else if (msg.msg_type === MSG.KEEP_ALIVE_REQ) {
        sig.send(JSON.stringify({ msg_type: MSG.KEEP_ALIVE_RESP, timestamp: msg.timestamp }));
      }
    });
    sig.on('error', (e) => this.emit('status', { meeting: s.meetingUuid, zustand: 'fehler', grund: `Signaling: ${e.message}` }));
    sig.on('close', () => this.#fehler(s, 'Signaling-Verbindung getrennt', true));
  }

  #verbindeMedia(s, url, sig) {
    const media = new this.WebSocketImpl(url);
    s.sockets.push(media);
    media.on('open', () => {
      // Nur Transkript und Chat anfordern (Bitmaske 8|16). Zoom hängt an den Transkript-Scope
      // zwingend meeting:read:meeting_audio an; mit "all" käme deshalb auch der Ton mit.
      media.send(JSON.stringify({
        msg_type: MSG.DATA_HANDSHAKE_REQ, protocol_version: 1, sequence: 0,
        meeting_uuid: s.meetingUuid, rtms_stream_id: s.streamId, signature: this.sig(s.meetingUuid, s.streamId),
        media_type: MEDIA.TRANSCRIPT | MEDIA.CHAT,
        media_params: { transcript: { content_type: 5, src_language: this.sprache, enable_lid: !this.spracheFest } },
      }));
    });
    media.on('message', (raw) => {
      const msg = parse(raw); if (!msg) return; // Binärdaten (Ton/Video) ignorieren
      switch (msg.msg_type) {
        case MSG.DATA_HANDSHAKE_RESP:
          if (msg.status_code !== 0) return this.#fehler(s, `Media-Handshake abgelehnt (status ${msg.status_code} ${msg.reason ?? ''})`, false);
          sig.send(JSON.stringify({ msg_type: MSG.CLIENT_READY_ACK, rtms_stream_id: s.streamId }));
          s.versuche = 0;
          this.emit('status', { meeting: s.meetingUuid, zustand: 'live', medien: Object.keys(msg.media_params ?? {}) });
          break;
        case MSG.KEEP_ALIVE_REQ:
          media.send(JSON.stringify({ msg_type: MSG.KEEP_ALIVE_RESP, timestamp: msg.timestamp }));
          break;
        case MSG.MEDIA_DATA_TRANSCRIPT: {
          const c = msg.content ?? {};
          const text = String(c.data ?? '').trim();
          if (text) this.emit('beitrag', {
            art: 'sprache', meeting: s.meetingUuid, userId: c.user_id, name: c.user_name ?? 'Unbekannt',
            text, zeit: c.end_time ?? c.timestamp ?? Date.now(),
          });
          break;
        }
        case MSG.MEDIA_DATA_CHAT: {
          const c = msg.content ?? {};
          if ((c.chat_session?.type ?? CHAT_AN_ALLE) !== CHAT_AN_ALLE) break;
          if (![CHAT_NEU, CHAT_GEAENDERT].includes(c.operation_type ?? CHAT_NEU)) break;
          const text = chatText(c.data);
          if (text) this.emit('beitrag', {
            art: 'chat', meeting: s.meetingUuid, userId: c.sender?.user_id, name: c.sender?.user_name ?? 'Unbekannt',
            text, zeit: c.timestamp ?? Date.now(), id: c.message_id, geaendert: c.operation_type === CHAT_GEAENDERT,
          });
          break;
        }
      }
    });
    media.on('error', (e) => this.emit('status', { meeting: s.meetingUuid, zustand: 'fehler', grund: `Media: ${e.message}` }));
    media.on('close', () => { if (!s.beendet) try { sig.close(); } catch { /* egal */ } });
  }

  #fehler(s, grund, wiederholbar) {
    if (s.beendet) return;
    for (const ws of s.sockets) { try { ws.removeAllListeners('close'); ws.close(); } catch { /* egal */ } }
    if (wiederholbar && s.versuche < this.maxVersuche) {
      s.versuche++;
      const warte = 1000 * 2 ** (s.versuche - 1);
      this.emit('status', { meeting: s.meetingUuid, zustand: 'neuverbindung', grund, versuch: s.versuche });
      setTimeout(() => { if (!s.beendet) this.#verbinde(s); }, warte).unref?.();
    } else {
      this.#beende(s, grund);
    }
  }
}

function parse(raw) {
  try { return JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')); } catch { return null; }
}
