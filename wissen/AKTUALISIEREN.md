# Wissensdatenbank aktualisieren (Stand 16.11.2026)

Die Rohdaten liegen nicht im Repo (`wissen/roh/`, `index.json` sind in `.gitignore`). So entsteht der Index:

## 1. Kurs aus „IDF Emma“ (Obsidian, OneDrive)

```bash
node wissen/importiere_emma.mjs "$HOME/Library/CloudStorage/OneDrive-ECBHoldingGmbH/09 - Second Brain Obsidian/Wissensdatenbank IDF Emma"
```

Übernimmt Masterclass, programmübergreifendes Kurswissen, Emilias Coaching-Antworten, FAQ, Steuer-FAQ (rund 150 Dateien).

## 2. Live-Calls aus Zoom (über den Sales-Downloader auf dem Mac mini)

Der Sales-Downloader `zoom_transcripts_download.py` (Mac mini, Ordner „KPI: Sales Closer Wochenanalyse …“, Zugang in dessen `.env`) wird nur über Umgebungsvariablen umgelenkt, nicht geändert:

```bash
cd "$HOME/Desktop/KPI: Sales Closer Wochenanalyse (Wochenreport Airtable einfügen)"
ZOOM_USER_FILTER="emiliabolda@investieredichfrei.de,sarahklein@investieredichfrei.de" \
ZOOM_NO_TOPIC_FILTER=1 ZOOM_OUTPUT_DIR="$HOME/IDF-Daten-Aktien-Copilot/Zoom-Calls" \
/usr/bin/python3 zoom_transcripts_download.py --from 2024-01-01 --to <heute>
```

`--from` wirkt nur zusammen mit `--to`. Bereits geladene Dateien werden übersprungen.

Auswahl für den Copilot (nach `wissen/roh/calls/`, umbenannt in `<Datum>_<Titel> (Emilia|Sarah).vtt`):
- Emilia: „Emilia Bolda - Coaching“ (Gruppen-Coaching 2025), alle Titel mit „Advanced“, „Live Call - Aktien Coaching“, „FFC“, „FFC Live Call …“
- Sarah: alle Basic Calls („Basic Call“, „Basiccall“)
- Nicht: Podcasts, Einzelgespräche („X & Emilia“), Strategiegespräche, She Trades, Optionen-Specials, „Zoom-Meeting von Sarah Klein“

Stand 16.11.2026: 151 Calls (83 Emilia, 68 Sarah), April 2025 bis November 2026.

## 3. Index bauen und auf den Server

```bash
TRAINERIN_NAMEN="Emilia Bolda,Sarah Klein" node wissen/baue_index.mjs wissen/roh wissen/index.json
```

Volle Namen verwenden: Mit nur „Sarah“ behalten Teilnehmerinnen namens Sarah ihren Namen.
Ergebnis 16.11.2026: 11.150 Abschnitte, ca. 2,9 Mio. Wörter, 20 MB.

Auf den Server nach `/var/lib/aktien-copilot/wissen/index.json` (Pfad über `WISSEN_INDEX` in `/etc/aktien-copilot.env`), danach `systemctl restart aktien-copilot`. Der Dienst braucht damit gut 200 MB RAM.
