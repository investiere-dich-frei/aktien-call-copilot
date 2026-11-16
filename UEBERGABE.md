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

**Schlüssel eintragen:** Auf dem Server liegt `/usr/local/bin/copilot-schluessel` (Kopie im Repo: `deploy/copilot-schluessel.sh`). Es fragt die vier Schlüssel verdeckt ab (Enter = Wert bleibt), schreibt sie nach `/etc/aktien-copilot.env` und startet den Dienst neu. Vom MacBook aus:

```bash
ssh -t christianbolda@mac-mini-von-macmini.local "ssh -t -i ~/.ssh/idf_server -o IdentitiesOnly=yes root@91.98.174.199 /usr/local/bin/copilot-schluessel"
```

Stand 16.11.2026: die drei Zoom-Schlüssel sind eingetragen, `ANTHROPIC_API_KEY` fehlt noch.

## 4a. Zoom (seit 16.11.2026 eingerichtet)

**Wichtig:** Kontoinhaberin des IDF-Zoom-Kontos ist **Emilia**. Christian ist dort kein Admin; im Marketplace sind für ihn alle App-Arten gesperrt. Beide Apps wurden deshalb unter Emilias Anmeldung angelegt und lassen sich nur dort bearbeiten (Christian meldet sich dafür in Chrome als Emilia an).

**RTMS-App** (General App, User-managed, nur Development), App-ID `iOHYdmyKT12fSHAugMnppA`:
- Heißt bei Zoom „Aktien-Call-Copilot“ (am 16.11. umbenannt, vorher „General app 482“).
- Scopes: `meeting:read:meeting_transcript`, `meeting:read:meeting_chat`. Zoom hängt `meeting:read:meeting_audio` zwingend an und lässt es nicht abwählen. Der Code fordert deshalb beim Daten-Handshake nur Transkript und Chat an (`media_type` 8|16 = 24), damit kein Ton ankommt.
- Event-Abo „Aktien-Call-Copilot RTMS“: `meeting.rtms_started`, `meeting.rtms_stopped` an `https://91-98-174-199.sslip.io/zoom/webhook`. Zoom hat beim Speichern **keine** URL-Validierung geschickt; der Server beantwortet sie, sobald sie kommt.
- Produkt „Meetings“, Auto-Start-Vorgabe „Start for all meetings users own“, OAuth-Redirect `https://91-98-174-199.sslip.io/`.
- Christian hat die App am 16.11. unter seinem Konto zugelassen (OAuth-Freigabe, ohne „shared access permissions“). In seinen Zoom-Einstellungen → Zoom Apps → „Automatisches Starten von Apps …“ steht sie mit „Owned“ (eigene Meetings), Teilnehmer „Always ask“.
- Kontoeinstellung „Freigeben von Meeting-Inhalten in Echtzeit mit Apps“ war schon an.

**Server-to-Server-App** „Aktien-Call-Copilot Aufzeichnungen“, App-ID `2A_KDbcTSWWYNG_yFRt8JA`, aktiviert:
- Scopes: `cloud_recording:read:list_user_recordings:admin`, `cloud_recording:read:list_recording_files:admin`, `user:read:list_users:admin`.
- Entwickler-Kontakt: Christian, IDF-Adresse; Firma Investiere Dich Frei GmbH.
- Account ID, Client ID und Secret liegen nur in Zoom (App Credentials). Sie werden erst für den Downloader gebraucht.

**Stand 16.11.2026 abends – RTMS startet noch nicht:**
- Eigene Adresse `https://copilot.investieredichfrei.de` (A-Record in der Hetzner Console, Projekt „konsoleH“, Zone investieredichfrei.de; eigener Abschnitt in der Caddyfile des Wissens-Bots, Sicherung `Caddyfile.vor-copilot-domain`). Die sslip.io-Adresse läuft parallel. Das Event-Abo der RTMS-App zeigt auf `https://copilot.investieredichfrei.de/zoom/webhook`; die OAuth-Redirect-URL steht noch auf sslip.io.
- Symptom: Im Meeting zeigt die App „Von Ihnen aktiviert“, Auto-Start greift nicht; „Starten“ → „Verbindung wird hergestellt…“ → zurück auf „Starten“. Zoom ruft den Server nie auf, auch keine URL-Validierung. Server und Signaturprüfung sind getestet und korrekt.
- Ursache laut Zoom-Support (Chat 16.11.): **RTMS muss von Zoom für das Konto freigeschaltet werden** (Formular `https://www.zoom.com/en/realtime-media-streams/#form`). Antrag am 16.11. abgeschickt (Kontakt Christian). Zoom meldet sich nach der Freigabe. Offen: ob die App dafür veröffentlicht werden muss oder Development/Local test reicht (Frage an Zoom-Entwicklersupport / devforum.zoom.us).
- Das Zoom-Programm auf dem MacBook muss angemeldet sein; Meetings über „Neues Meeting“ starten, nicht im Raum eines anderen Kontos.
- Wissensdatenbank seit 16.11.2026 auf dem Server: Kurs aus „IDF Emma“ plus 151 Live-Calls (Emilia Advanced/Coaching, Sarah Basic), 11.150 Abschnitte. Wie sie gebaut und aktualisiert wird: `wissen/AKTUALISIEREN.md`. Testlauf mit Claude liefert Antworten mit Lektionen als Quelle.
- Zugriff: Ist das MacBook nicht im Heimnetz, den Mac mini über Tailscale (`100.124.116.34`) statt `mac-mini-von-macmini.local` nehmen. Log-Mitschnitt für Tests: `/root/copilot-watch.sh <Sekunden>` auf dem Server.

## 5. Offene Aufgaben

1. **Developer Pack** ist seit 16.11.2026 in Emilias Zoom-Konto gebucht (nutzungsbasiert, 0 € vorab, monatliche Abrechnung über ihre Zahlungsmethode, kündbar unter zoom.us/billing). Die echten Minutenpreise stehen in der Bestätigungsmail bzw. unter zoom.us/billing; die Forumswerte (ca. 0,009 €/Min Stream, 0,018 €/Min Transkription) sind nicht bestätigt.
2. **RTMS-Freischaltung durch Zoom abwarten** (Abschnitt 4a, Stand 16.11. abends). `ANTHROPIC_API_KEY` ist eingetragen. Danach **Test-Meeting**: Christian hostet ein kurzes Meeting, Oberfläche offen, prüfen ob Mitschrift und Chat ankommen. Christians Zoom-Anzeigename muss `TRAINER_NAMEN` enthalten (Standard „Christian“).
3. **Wissensdatenbank und Kompendium:** erledigt am 16.11.2026 (siehe `wissen/AKTUALISIEREN.md`): Kurs, 151 Calls, Coach-Kompendium (14 Kapitel, 440 gebündelte Fragen, als Suche eingebunden), Unternehmens-Register (546 Unternehmen, im Co-Trainer noch aus). Offen: Emilia prüft die Abschnitte „Widersprüche und offene Punkte“; rechtliche Freigabe für das Register; neue Calls regelmäßig nachladen.
4. **Claude live testen:** im Testmodus erledigt (16.11.2026); live erst nach RTMS-Freischaltung.
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

> Wir bauen den Aktien-Call-Copilot weiter (Repo `investiere-dich-frei/aktien-call-copilot`). Bitte lies zuerst `UEBERGABE.md` im Repo. Der Copilot läuft schon auf `bot-nbg1` (Abschnitt 4). Die Zoom-Apps sind eingerichtet (Abschnitt 4a). Nächste Schritte: RTMS-Freischaltung durch Zoom abwarten (Abschnitt 4a), dann Test-Meeting. Die Wissensdatenbank steht (wissen/AKTUALISIEREN.md). SSH auf den Server geht nur über den Mac mini; Zoom-Apps bearbeiten nur mit Emilias Login.
