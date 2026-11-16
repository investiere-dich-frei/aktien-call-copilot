// Prüfung der Zoom-Webhooks.
// Zoom signiert jeden Aufruf: x-zm-signature = "v0=" + HMAC_SHA256(secretToken, "v0:{timestamp}:{rohBody}").
// Beim Eintragen der URL schickt Zoom "endpoint.url_validation" und erwartet plainToken + encryptedToken.
import crypto from 'node:crypto';

const MAX_ALTER_S = 300; // ältere Aufrufe gelten als Wiederholung (Replay) und werden abgelehnt

function hmacHex(secret, text) {
  return crypto.createHmac('sha256', secret).update(text).digest('hex');
}

export function signiere(secret, timestamp, rohBody) {
  return 'v0=' + hmacHex(secret, `v0:${timestamp}:${rohBody}`);
}

export function pruefeSignatur({ secret, timestamp, signatur, rohBody, jetzt = Date.now() }) {
  if (!secret || !timestamp || !signatur) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(jetzt / 1000 - ts) > MAX_ALTER_S) return false;
  const erwartet = Buffer.from(signiere(secret, timestamp, rohBody));
  const erhalten = Buffer.from(String(signatur));
  return erwartet.length === erhalten.length && crypto.timingSafeEqual(erwartet, erhalten);
}

export function urlValidierung(secret, plainToken) {
  return { plainToken, encryptedToken: hmacHex(secret, plainToken) };
}
