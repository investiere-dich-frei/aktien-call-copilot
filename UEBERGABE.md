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

## 4. Wo es hängt: Installation auf bot-nbg1

Das Installationsskript ist **noch nicht ausgeführt**. Es muss als root per SSH auf `bot-nbg1` laufen:

```bash
ssh root@91.98.174.199 'bash -s' < deploy/install.sh
```

Bisherige Hürden:

1. **Firewall:** Die Hetzner-Firewall `idf-wissen-bot` (ID 11937052) lässt SSH nur von einer festen IP zu. Sie wurde auf Christians aktuelle IP `89.182.201.84` umgestellt. Wechselt die IP, muss die Regel per Hetzner-API angepasst werden. Nur die Regel für Port 22 ändern, 80 und 443 bleiben offen.
2. **SSH-Schlüssel:** Das MacBook wird abgelehnt („Permission denied (publickey)“). Bei Hetzner ist nur der Schlüssel `christian-macmini` hinterlegt. Lösungen:
   - **Am einfachsten:** vom **Mac mini** ausführen.
   - Oder in der Hetzner-Webkonsole als root anmelden (Root-Passwort über „Rescue“ zurücksetzen) und den MacBook-Schlüssel an `/root/.ssh/authorized_keys` **anhängen**.
   - Oder (von Claude vorgeschlagen, noch nicht gemacht): Root-Passwort per API zurücksetzen und die Konsole per API (`request_console`) selbst bedienen.
3. Das Skript gibt am Ende aus:
   - den **Deploy-Schlüssel**: Christian trägt ihn unter https://github.com/investiere-dich-frei/aktien-call-copilot/settings/keys/new ein, ohne Schreibrecht. Claude darf über die GitHub-API keine Schlüssel anlegen.
   - die **Adresse der Oberfläche**: `https://91-98-174-199.sslip.io/#token=…`
   - die **Webhook-URL**: `https://91-98-174-199.sslip.io/zoom/webhook`
4. Ports 80 und 443 sind auf bot-nbg1 offen; vermutlich läuft dort schon ein Webserver. Steht in der Zeile „Fertig. Webserver:“ etwas wie „Port 80/443 belegt von nginx“, muss die HTTPS-Einbindung angepasst werden.

Danach die Schlüssel auf dem Server in `/etc/aktien-copilot.env` eintragen (`ANTHROPIC_API_KEY`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN`) und `systemctl restart aktien-copilot` ausführen.

## 5. Offene Aufgaben

1. **Installation auf bot-nbg1** abschließen (Abschnitt 4).
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
5. **Eigene Domain** statt sslip.io, z. B. `copilot.<domain>`: in `install.sh` über `COPILOT_DOMAIN` steuerbar.
6. **Rechtliches:**
   - Ansage an die Lernenden zu Beginn des Calls, rechtlich prüfen lassen.
   - AV-Vertrag mit Anthropic.
   - Zustimmung von Emilia und IDF zur Nutzung der Calls und des Kurses.
   - Regeln im Regelwächter per Rückwärtstest gegen echte Calls prüfen.
7. Später möglich: Anmeldung über Supabase wie im Sales-Copilot.

## 6. Umgebung für Claude (Cloud-Sitzungen)

- Die Cloud-Umgebung **„aktien-call-copilot“** erlaubt Zoom-Hosts (`developers.zoom.us`, `api.zoom.us`, `zoom.us`, `marketplace.zoom.us`, `devforum.zoom.us`) und `api.hetzner.cloud`.
- **Achtung:** Der Hetzner-API-Schlüssel (`HCLOUD_TOKEN`) liegt als Umgebungsvariable nur in der Umgebung **„Default“**. In einer neuen Sitzung auf „aktien-call-copilot“ fehlt er. Lösung: ihn über `request_credential` für `api.hetzner.cloud` als Netzwerk-Geheimnis in „aktien-call-copilot“ speichern lassen.
- Eine Cloud-Sitzung kann **nicht** auf Christians Mac, Chrome oder per SSH auf Server zugreifen. Für SSH, Browser und lokale Dateien besser eine Sitzung **auf dem Mac** starten: Claude-Desktop-App mit Chrome-Erweiterung oder `claude remote-control`.

## 7. Startnachricht für den neuen Chat

> Wir bauen den Aktien-Call-Copilot weiter (Repo `investiere-dich-frei/aktien-call-copilot`). Bitte lies zuerst `UEBERGABE.md` im Repo. Nächster Schritt: das Installationsskript auf dem Hetzner-Server `bot-nbg1` (91.98.174.199) ausführen, siehe Abschnitt 4, und danach die Zoom-Apps und die Wissensdatenbank aufbauen (Abschnitt 5).
