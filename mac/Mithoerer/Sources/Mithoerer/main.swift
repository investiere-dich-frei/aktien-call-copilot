// Mac-Mithörer für den Aktien-Call-Copilot.
// Hört während eines Zoom-Calls mit: Mikrofon der Leitung, Ton aus Zoom (Teilnehmerinnen) und den Zoom-Chat.
// Sprache wird auf dem Mac erkannt (Apple, offline), an den Server gehen nur fertige Textbeiträge.
//
//   Copilot-Mithörer.app (ohne Argumente)       Menüleisten-App: hört automatisch bei jedem Zoom-Meeting mit
//   mithoerer --name "Emilia Bolda"            normaler Betrieb (Server: copilot.investieredichfrei.de)
//   mithoerer --trocken                        nur anzeigen, nichts senden
//   mithoerer --ohne-mikro / --ohne-zoom / --ohne-chat
//   mithoerer --chat-baum                      Bedienungshilfen-Baum von Zoom ausgeben (Fehlersuche)
//   mithoerer --server https://…               anderer Server
//   mithoerer --trocken --datei probe.aiff     Selbsttest der Spracherkennung mit einer Tondatei
// Zugangsschlüssel: einmalig  security add-generic-password -s aktien-copilot -a coach -w
import AppKit
import ApplicationServices
import AVFoundation
import Foundation

setvbuf(stdout, nil, _IOLBF, 0) // Zeilenweise ausgeben, auch in eine Datei oder Pipe
let argumente = CommandLine.arguments
func hat(_ f: String) -> Bool { argumente.contains(f) }
func wert(_ f: String) -> String? {
  guard let i = argumente.firstIndex(of: f), i + 1 < argumente.count else { return nil }
  return argumente[i + 1]
}

if hat("--hilfe") || hat("-h") {
  print("""
  mithoerer [--name "Emilia Bolda"] [--trocken] [--ohne-mikro] [--ohne-zoom] [--ohne-chat] [--chat-baum] [--server URL]
  """)
  exit(0)
}

if hat("--chat-baum") {
  guard bedienungshilfenErlaubt(fragen: true) else {
    print("Bitte in Systemeinstellungen › Datenschutz & Sicherheit › Bedienungshilfen das Terminal erlauben und neu starten.")
    exit(1)
  }
  if hat("--chat-nachrichten") {
    if let app = ChatLeser.zoomApp(), let n = ChatBaum.nachrichten(in: app) { for m in n { print("\(m.name): \(m.text)") } } else { print("Kein Chat gefunden.") }
  } else { ChatBaum.baumAusgeben() }
  exit(0)
}

let leitungStandard = UserDefaults.standard.string(forKey: "name") ?? NSFullUserName()
let serverStandard = UserDefaults.standard.string(forKey: "server") ?? "https://copilot.investieredichfrei.de"

// App-Modus: aus dem App-Paket ohne Argumente gestartet (Doppelklick, Anmeldeobjekt) oder mit --app.
if hat("--app") || (Bundle.main.bundleIdentifier != nil && argumente.count == 1) {
  if !hat("--konsole") {
    let pfad = MenueApp.protokollDatei.path
    try? FileManager.default.createDirectory(at: MenueApp.protokollDatei.deletingLastPathComponent(), withIntermediateDirectories: true)
    freopen(pfad, "a", stdout)
    freopen(pfad, "a", stderr)
    setvbuf(stdout, nil, _IOLBF, 0)
  }
  print("=== Copilot-Mithörer gestartet \(Date())")
  signal(SIGPIPE, SIG_IGN)
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  let delegat = MainActor.assumeIsolated { MenueApp(server: URL(string: wert("--server") ?? serverStandard)!, leitung: wert("--name") ?? leitungStandard) }
  app.delegate = delegat
  app.run()
  exit(0)
}

let trocken = hat("--trocken")
let leitung = wert("--name") ?? leitungStandard
let serverURL = URL(string: wert("--server") ?? serverStandard)

var token = ""
if !trocken {
  guard let t = ladeToken() else {
    print("""
    Kein Zugangsschlüssel im Schlüsselbund gefunden. Einmalig im Terminal eingeben (wird verdeckt abgefragt):
      security add-generic-password -s aktien-copilot -a coach -w
    """)
    exit(1)
  }
  token = t
}
let sender = Sender(server: trocken ? nil : serverURL, token: token)

let sitzung = MainActor.assumeIsolated { Sitzung(leitung: leitung, sender: sender) }

@MainActor func starte() async {
  let locale = await SpeechTranscriber_deutsch()
  if let pfad = wert("--datei") {
    // Selbsttest: eine Tondatei statt Mikrofon durch die Erkennung schicken.
    // --datei-name: als wen die Aufnahme gilt (Standard: --name). --ab/--bis in Minuten, --tempo: Abspieltempo (0 = so schnell wie möglich).
    let spur = Transkription(name: wert("--datei-name") ?? leitung, locale: locale, sender: sender)
    do {
      try await spur.starte()
      let datei = try AVAudioFile(forReading: URL(fileURLWithPath: pfad))
      let rate = datei.processingFormat.sampleRate
      let tempo = Double(wert("--tempo") ?? "0") ?? 0
      let ende = min(datei.length, AVAudioFramePosition((Double(wert("--bis") ?? "100000") ?? 100000) * 60 * rate))
      datei.framePosition = AVAudioFramePosition((Double(wert("--ab") ?? "0") ?? 0) * 60 * rate)
      let stueck = AVAudioFrameCount(rate / 10)
      print("Spiele \(pfad) ab Minute \(Int(Double(datei.framePosition) / rate / 60)) bis \(Int(Double(ende) / rate / 60)), Tempo \(tempo == 0 ? "max" : "\(tempo)x")")
      while datei.framePosition < ende {
        guard let p = AVAudioPCMBuffer(pcmFormat: datei.processingFormat, frameCapacity: stueck) else { break }
        try datei.read(into: p)
        spur.fuettere(p)
        if tempo > 0 { try? await Task.sleep(for: .seconds(Double(p.frameLength) / rate / tempo)) }
      }
      await spur.beende()
      try? await Task.sleep(for: .seconds(1))
    } catch { print("Datei: \(error.localizedDescription)") }
    exit(0)
  }
  print(trocken ? "Trockenlauf, nichts wird gesendet" : "Server: \(serverURL!.host() ?? "")")
  await sitzung.starte(mikro: !hat("--ohne-mikro"), zoom: !hat("--ohne-zoom"), chatLesen: !hat("--ohne-chat"))
  print("Läuft. Beenden mit Ctrl+C.")
}

func SpeechTranscriber_deutsch() async -> Locale {
  let wunsch = Locale(identifier: wert("--sprache") ?? "de-DE")
  return await sprachePruefen(wunsch)
}

// Sauber beenden: Erkennung abschließen, damit der letzte Satz noch rausgeht.
signal(SIGINT, SIG_IGN)
let abbruch = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
abbruch.setEventHandler {
  print("\nBeende …")
  Task {
    await sitzung.stoppe()
    try? await Task.sleep(for: .seconds(2))
    exit(0)
  }
}
abbruch.resume()

Task { await starte() }
RunLoop.main.run()
