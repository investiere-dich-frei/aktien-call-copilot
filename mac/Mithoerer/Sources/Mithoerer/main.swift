// Mac-Mithörer für den Aktien-Call-Copilot.
// Hört während eines Zoom-Calls mit: Mikrofon der Leitung, Ton aus Zoom (Teilnehmerinnen) und den Zoom-Chat.
// Sprache wird auf dem Mac erkannt (Apple, offline), an den Server gehen nur fertige Textbeiträge.
//
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

func bedienungshilfenErlaubt(fragen: Bool) -> Bool {
  let opt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: fragen] as CFDictionary
  return AXIsProcessTrustedWithOptions(opt)
}

if hat("--chat-baum") {
  guard bedienungshilfenErlaubt(fragen: true) else {
    print("Bitte in Systemeinstellungen › Datenschutz & Sicherheit › Bedienungshilfen das Terminal erlauben und neu starten.")
    exit(1)
  }
  ChatBaum.baumAusgeben()
  exit(0)
}

let trocken = hat("--trocken")
let leitung = wert("--name") ?? NSFullUserName()
let serverURL = URL(string: wert("--server") ?? "https://copilot.investieredichfrei.de")

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

let mikrofon = Mikrofon()
let zoomTon = ZoomTon()
var chat: ChatLeser?
var spuren: [Transkription] = []

func starte() async {
  let locale = await SpeechTranscriber_deutsch()
  if let pfad = wert("--datei") {
    // Selbsttest: eine Tondatei statt Mikrofon durch die Erkennung schicken.
    let spur = Transkription(name: leitung, locale: locale, sender: sender)
    do {
      try await spur.starte()
      let datei = try AVAudioFile(forReading: URL(fileURLWithPath: pfad))
      while datei.framePosition < datei.length {
        guard let p = AVAudioPCMBuffer(pcmFormat: datei.processingFormat, frameCapacity: 4800) else { break }
        try datei.read(into: p)
        spur.fuettere(p)
      }
      await spur.beende()
      try? await Task.sleep(for: .seconds(1))
    } catch { print("Datei: \(error.localizedDescription)") }
    exit(0)
  }
  print("Mithörer startet · Leitung: \(leitung) · \(trocken ? "Trockenlauf, nichts wird gesendet" : "Server: \(serverURL!.host() ?? "")")")

  if !hat("--ohne-mikro") {
    let erlaubt = await AVCaptureDevice.requestAccess(for: .audio)
    if !erlaubt { print("Kein Zugriff aufs Mikrofon. Bitte in den Systemeinstellungen erlauben.") } else {
      let spur = Transkription(name: leitung, locale: locale, sender: sender)
      do { try await spur.starte(); try mikrofon.starte(an: spur); spuren.append(spur); print("✓ Mikrofon läuft") }
      catch { print("Mikrofon: \(error.localizedDescription)") }
    }
  }

  if !hat("--ohne-zoom") {
    let spur = Transkription(name: "Teilnehmer:in", locale: locale, sender: sender)
    do { try await spur.starte(); try await zoomTon.starte(an: spur); spuren.append(spur); print("✓ Zoom-Ton läuft") }
    catch { print("Zoom-Ton: \(error.localizedDescription)") }
  }

  if !hat("--ohne-chat") {
    if bedienungshilfenErlaubt(fragen: true) {
      await MainActor.run { chat = ChatLeser(sender: sender); chat?.starte() }
      print("✓ Chat-Auslesen läuft (Chat im Meeting offen lassen)")
    } else {
      print("Chat: Bitte in Systemeinstellungen › Datenschutz & Sicherheit › Bedienungshilfen das Terminal erlauben, dann neu starten.")
    }
  }
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
    mikrofon.stoppe()
    await zoomTon.stoppe()
    for s in spuren { await s.beende() }
    try? await Task.sleep(for: .seconds(2))
    exit(0)
  }
}
abbruch.resume()

Task { await starte() }
RunLoop.main.run()
