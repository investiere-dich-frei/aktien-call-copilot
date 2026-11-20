# Mac-Mithörer

Ersatz für Zoom RTMS (seit 20.11.2026 verworfen: Zoom verlangt mindestens 1.500 USD/Monat).
Läuft auf dem Mac, auf dem der Call geführt wird, und schickt fertige Textbeiträge an den Copilot-Server (`POST /api/beitrag`).

- **Mikrofon** = Leitung des Calls (`--name`, muss einen Namen aus `TRAINER_NAMEN` enthalten, z. B. "Emilia Bolda").
- **Zoom-Ton** = Teilnehmerinnen, über ScreenCaptureKit nur von der Zoom-App (`us.zoom.xos`).
- **Zoom-Chat** über die Bedienungshilfen (Chat im Meeting offen lassen).
- Spracherkennung: Apple `SpeechTranscriber`, offline auf dem Mac (macOS 26+). Ton verlässt den Mac nicht, an den Server gehen nur Texte.
- Kopfhörer benutzen, sonst landet Teilnehmerinnen-Ton auch im Mikrofon.

## Bauen und starten

```bash
cd mac/Mithoerer && swift build -c release
security add-generic-password -s aktien-copilot -a coach -w   # einmalig, COACH_TOKEN verdeckt eingeben
.build/release/Mithoerer --name "Emilia Bolda"
```

Selbsttest ohne Server: `.build/release/Mithoerer --trocken --datei probe.aiff` (Probe z. B. mit `say -v Anna -o probe.aiff "…"`).
Fehlersuche Chat: `.build/release/Mithoerer --chat-baum` gibt den Bedienungshilfen-Baum der Zoom-Fenster aus.

## Rechte (einmalig, Systemeinstellungen › Datenschutz & Sicherheit)

Für die App, aus der der Mithörer gestartet wird (z. B. Terminal): Mikrofon, Bildschirm- und Systemaudioaufnahme (für den Zoom-Ton), Bedienungshilfen (für den Chat).
