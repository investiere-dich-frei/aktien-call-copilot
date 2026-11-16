# Übergabe: Aktien-Call-Copilot

Stand 16.11.2026 · Repo `investiere-dich-frei/aktien-call-copilot` (privat) · Branch `main`

Dieses Dokument ist für einen neuen Chat gedacht. Es enthält keine Schlüssel und keine Passwörter.

---

## 1. Ziel

Christian Bolda leitet Aktien-Coaching-Calls über Zoom. Auf einem zweiten Bildschirm soll ein Copilot während des Calls laufend Hinweise geben:

- **Fragen der Lernenden erkennen**, gesprochen oder im Zoom-Chat.
- **Antwortvorschlag liefern** aus einer Wissensdatenbank: Emilias Live-Calls (Zoom-Aufzeichnungen) und der komplette Videokurs in LearningSuite.

Vorlage war der IDF Sales-Copilot (`Investiere-Dich-Frei-GmbH/idf-sales-copilot`). Auf dieses Repo hatte die Sitzung keinen Zugriff, der Copilot ist deshalb neu gebaut, nach dem Übergabedokument des Sales-Copilots.

## 2. Entscheidungen

| Thema | Entscheidung |
|---|---|
| Live-Daten aus Zoom | **Zoom RTMS** (Realtime Media Streams): Zoom liefert die Mitschrift mit Sprechernamen und den öffentlichen Chat an einen eigenen Server. Kein Whisper im Browser, kein Bildschirm-Mitlesen. |
| Server | Node-Dienst auf dem bestehenden Hetzner-Server **`bot-nbg1`** (Nürnberg, IP `91.98.174.199`, Debian 13, cx23). Dort läuft schon ein kleiner Bot. Hetzner Cloud hat keinen Standort Frankfurt. Ein neuer Server scheiterte am Limit für öffentliche IPs. |
| Repo | Privat bei Christian: `investiere-dich-frei/aktien-call-copilot` |
| KI | Claude `claude-opus-5-5`, `effort: low`, strukturierte Ausgabe (Zod), Ausweichmodell bei Ablehnung über `fallbacks: 'default'`, Systemanweisung zwischengespeichert |

## 3. Was fertig ist (im Repo, 12 Tests grün)

- **Zoom-Anbindung** (`server/zoom-rtms.mjs`, `server/webhook.mjs`): RTMS-Protokoll nach der offiziellen Zoom-Doku, mit Signaturprüfung der Webhooks, Keep-alive und Neuverbindung. Es werden nur Mitschrift und öffentlicher Chat angefordert, kein Ton, kein Video.
- **Fragen-Erkennung** (`server/fragen.mjs`):
  - erkennt Fragen auch ohne Fragezeichen,
  - fügt Satzstücke derselben Person zusammen,
  - fasst gleiche Fragen zusammen („2× gefragt“),
  - Regelwächter für Christian: rot bei Renditeversprechen, Kaufempfehlungen und Kurszielen, gelb bei Hebelprodukten und Steuer-Einzelfällen.
- **Wissenssuche** (`server/wissen.mjs`, `wissen/baue_index.mjs`): Volltextsuche (BM25) über Abschnitte mit Quellenangabe. Teilnehmende aus Emilias Calls werden anonymisiert.
- **Claude-Hinweis** (`server/coach.mjs`): Stichpunkte, ein Satz zum Vorlesen, Rückfrage, Quellen, Warnung. Antwortet nur aus dem Wissen und erfindet nichts. Keine Anlageberatung.
- **Oberfläche** (`public/index.html`): Fragenkarten, Mitschrift, Fokus-Ansicht, Notaus, Testmodus. Der Testmodus spielt ein altes Transkript (.vtt) mit Chat (.txt) in 1×, 4× oder 10× ab.
- **Betrieb** (`deploy/`):
  - `install.sh`: einmalige Einrichtung mit eigenem Node 22 unter `/opt/node22`, eigenem Deploy-Schlüssel (nur lesen), systemd-Dienst auf `127.0.0.1:8765` und Caddy für HTTPS. Läuft schon Caddy, wird er ergänzt; nginx oder Apache werden nicht angefasst.
  - `copilot-update.sh`: holt alle 2 Minuten `main` und startet nur neu, wenn die Tests grün sind.
- **Datenschutz:**
  - Gespeichert wird nichts; alles liegt nur im Arbeitsspeicher.
  - An Claude gehen nur Rollen („Teilnehmer:in“), keine Namen.
  - Zugriff auf die Oberfläche nur mit `COACH_TOKEN`.

Lokal testen:

```bash
npm install
npm test
node wissen/baue_index.mjs test/beispiel/roh wissen/index.json
COPILOT_MOCK=1 COACH_TOKEN=demo npm start
```

Dann `http://localhost:8765/#token=demo` öffnen.

## 4. Stand auf bot-nbg1 (seit 16.11.2026 installiert)

`install.sh` ist ausgeführt, der Deploy-Schlüssel ist in GitHub eingetragen, der Dienst `aktien-copilot` läuft und zieht sich `main` alle 2 Minuten.

- Oberfläche: `https://91-98-174-199.sslip.io/#token=…` (Token steht als `COACH_TOKEN` in `/etc/aktien-copilot.env` auf dem Server)
- Zoom-Webhook: `https://91-98-174-199.sslip.io/zoom/webhook` (antwortet ohne gültige Signatur mit 401, so soll es sein)
- Zertifikat: Let's Encrypt, holt Caddy selbst

**Zugang per SSH:** Nur vom **Mac mini** aus. Bei Hetzner ist nur dessen Schlüssel hinterlegt, das MacBook wird abgelehnt. Vom MacBook geht es über den Mac mini im selben Netz:

```bash
ssh christianbolda@mac-mini-von-macmini.local
ssh -i ~/.ssh/idf_server root@91.98.174.199
```

Die Hetzner-Firewall `idf-wissen-bot` (ID 11937052) lässt Port 22 nur von Christians fester IP (`89.182.201.84`) zu. Wechselt die IP, nur die Regel für Port 22 per Hetzner-API anpassen; 80 und 443 bleiben offen.

**HTTPS läuft über den Caddy des Wissens-Bots, nicht über einen eigenen.** Auf bot-nbg1 belegt der Docker-Container `bot-nbg1-caddy-1` die Ports 80/443. Er bedient auch `wissen.investieredichfrei.de` (Teams-Nachrichten, Content-Agent, Zentrale). `install.sh` erkennt das und ändert dort nichts; die Einbindung wurde von Hand gemacht:

- `/opt/idf-wissen-bot/deploy/bot-nbg1/Caddyfile`: Abschnitt `91-98-174-199.sslip.io` angehängt, `reverse_proxy 172.18.0.1:8765`. Die Fassung davor liegt als `Caddyfile.vor-copilot` daneben.
- `/etc/aktien-copilot.env`: `HOST=172.18.0.1` (Gateway des Docker-Netzes `bot-nbg1_intern`), damit der Container den Copilot erreicht. Von außen bleibt 8765 zu.
- ufw: `allow from 172.18.0.0/16 to 172.18.0.1 port 8765 proto tcp`.

Beim Ändern der Caddyfile beachten:

- Die Datei ist als Einzeldatei in den Container gemountet. Nur anhängen oder mit `cat > Caddyfile` überschreiben, **nie `sed -i`**: Das legt eine neue Datei an, und der Container sieht weiter die alte.
- Vor dem Laden prüfen, dann ohne Neustart laden:
  `docker exec bot-nbg1-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`
  `docker exec -w /etc/caddy bot-nbg1-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`
- Danach prüfen, ob Uptime-Kuma weiter 200 auf `wissen.investieredichfrei.de/status` bekommt (`docker logs bot-nbg1-caddy-1 | grep Uptime-Kuma`). Ein Abruf per curl bekommt dort 404, das ist normal.

**Noch offen:** die Schlüssel in `/etc/aktien-copilot.env` eintragen (`ANTHROPIC_API_KEY`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN`), dann `systemctl restart aktien-copilot`.

## 5. Offene Aufgaben

1. **Schlüssel auf bot-nbg1 eintragen** (Abschnitt 4, letzter Punkt).
2. **Zoom-Apps** (Christian als Zoom-Admin, marketplace.zoom.us):
   - **Server-to-Server-OAuth-App** zum Herunterladen von Emilias Aufzeichnungen. Scopes: `cloud_recording:read:list_user_recordings:admin`, `cloud_recording:read:list_recording_files:admin`, `user:read:list_users:admin`. Die Account ID darf in den Chat. Client ID und Secret gehen über das sichere Formular (`request_credential`, Host `zoom.us`, Typ basic).
   - **General App (user-managed) mit RTMS** für den Live-Teil:
     - Scopes: `meeting:read:meeting_transcript` und der RTMS-Chat-Scope, keine weiteren Medien.
     - Events: `meeting.rtms_started` und `meeting.rtms_stopped`, Endpunkt ist die Webhook-URL.
     - In den Kontoeinstellungen „Echtzeit-Meetinginhalte für Apps“ erlauben, bei Christian Auto-Start einschalten.
     - Developer Pack mit Guthaben buchen. Laut Forum kostet es ca. 0,009 €/Min für den Stream und 0,018 €/Min für die Transkription; das ist nicht offiziell bestätigt.
     - Christians Zoom-Anzeigename muss `TRAINER_NAMEN` enthalten (Standard „Christian“).
3. **Wissensdatenbank:**
   - Downloader für Emilias Zoom-Aufzeichnungen schreiben: Transkripte (.vtt) nach `wissen/roh/calls/`, fehlt ein Transkript, den Ton transkribieren.
   - LearningSuite klären: API, Export oder Admin-Zugang zu den Videos. Lektionen nach `wissen/roh/kurs/<Modul>/<Lektion>`.
   - `TRAINERIN_NAMEN=Emilia node wissen/baue_index.mjs` ausführen.
   - Optional `wissen/kompendium.md` (nach Themen geordnet) mit Claude erzeugen.
   - `wissen/roh/`, `index.json` und `kompendium.md` sind in `.gitignore` und müssen getrennt auf den Server.
4. **Claude live testen**, sobald ein `ANTHROPIC_API_KEY` da ist. In der Cloud-Umgebung dafür `api.anthropic.com` freigeben.
5. **Eigene Domain** statt sslip.io, z. B. `copilot.<domain>`: DNS-Eintrag auf 91.98.174.199 setzen und den Abschnitt in der Caddyfile des Wissens-Bots umbenennen (siehe Abschnitt 4). `COPILOT_DOMAIN` in `install.sh` greift hier nicht, weil das Skript den Docker-Caddy nicht anfasst.
6. **Rechtliches:**
   - Ansage an die Lernenden zu Beginn des Calls, rechtlich prüfen lassen.
   - AV-Vertrag mit Anthropic.
   - Zustimmung von Emilia und IDF zur Nutzung der Calls und des Kurses.
   - Regeln im Regelwächter per Rückwärtstest gegen echte Calls prüfen.
7. Später möglich: Anmeldung über Supabase wie im Sales-Copilot.

## 6. Umgebung für Claude (Cloud-Sitzungen)

- Die Cloud-Umgebung **„aktien-call-copilot“** erlaubt Zoom-Hosts (`developers.zoom.us`, `api.zoom.us`, `zoom.us`, `marketplace.zoom.us`, `devforum.zoom.us`) und `api.hetzner.cloud`.
- **Achtung:** Der Hetzner-API-Schlüssel (`HCLOUD_TOKEN`) liegt als Umgebungsvariable nur in der Umgebung **„Default“**. In einer neuen Sitzung auf „aktien-call-copilot“ fehlt er. Lösung: ihn über `request_credential` für `api.hetzner.cloud` als Netzwerk-Geheimnis in „aktien-call-copilot“ speichern lassen.
- Für SSH auf bot-nbg1 siehe Abschnitt 4 (nur über den Mac mini).
- Eine Cloud-Sitzung kann **nicht** auf Christians Mac, Chrome oder per SSH auf Server zugreifen. Für SSH, Browser und lokale Dateien besser eine Sitzung **auf dem Mac** starten: Claude-Desktop-App mit Chrome-Erweiterung oder `claude remote-control`.

## 7. Startnachricht für den neuen Chat

> Wir bauen den Aktien-Call-Copilot weiter (Repo `investiere-dich-frei/aktien-call-copilot`). Bitte lies zuerst `UEBERGABE.md` im Repo. Der Copilot läuft schon auf `bot-nbg1` (Abschnitt 4). Nächste Schritte: die Zoom-Apps anlegen, die Schlüssel auf dem Server eintragen und die Wissensdatenbank aufbauen (Abschnitt 5). SSH auf den Server geht nur über den Mac mini.
