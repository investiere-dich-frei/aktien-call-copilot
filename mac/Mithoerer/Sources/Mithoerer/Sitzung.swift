import AppKit
import ApplicationServices
import AVFoundation
import CoreGraphics
import Foundation

/// Ein Mithör-Durchgang: Mikrofon, Zoom-Ton und Chat starten bzw. sauber beenden.
@MainActor
final class Sitzung {
  let leitung: String
  let sender: Sender
  private var mikrofon: Mikrofon?
  private var zoomTon: ZoomTon?
  private var chat: ChatLeser?
  private var spuren: [Transkription] = []
  private var sprache: Locale?
  private(set) var laeuft = false
  private(set) var teile: [String] = []

  init(leitung: String, sender: Sender) {
    self.leitung = leitung
    self.sender = sender
  }

  func starte(mikro: Bool = true, zoom: Bool = true, chatLesen: Bool = true) async {
    guard !laeuft else { return }
    laeuft = true
    teile = []
    let locale: Locale
    if let s = sprache { locale = s } else { locale = await sprachePruefen(Locale(identifier: "de-DE")); sprache = locale }
    print("Mithören startet · Leitung: \(leitung)")

    if mikro {
      if await AVCaptureDevice.requestAccess(for: .audio) {
        let spur = Transkription(name: leitung, locale: locale, sender: sender)
        let m = Mikrofon()
        do { try await spur.starte(); try m.starte(an: spur); spuren.append(spur); mikrofon = m; teile.append("Mikrofon"); print("✓ Mikrofon läuft") }
        catch { print("Mikrofon: \(error.localizedDescription)") }
      } else { print("Kein Zugriff aufs Mikrofon. Bitte in den Systemeinstellungen erlauben.") }
    }

    if zoom {
      let spur = Transkription(name: "Teilnehmer:in", locale: locale, sender: sender)
      let z = ZoomTon()
      do { try await spur.starte(); try await z.starte(an: spur); spuren.append(spur); zoomTon = z; teile.append("Zoom-Ton"); print("✓ Zoom-Ton läuft") }
      catch { print("Zoom-Ton: \(error.localizedDescription)") }
    }

    if chatLesen {
      if bedienungshilfenErlaubt(fragen: true) {
        let c = ChatLeser(sender: sender, leitung: leitung)
        c.starte()
        chat = c
        teile.append("Chat")
        print("✓ Chat-Auslesen läuft (Chat im Meeting offen lassen)")
      } else {
        print("Chat: Bitte unter Datenschutz & Sicherheit › Bedienungshilfen erlauben.")
      }
    }
  }

  func stoppe() async {
    guard laeuft else { return }
    print("Mithören endet …")
    chat?.stoppe(); chat = nil
    mikrofon?.stoppe(); mikrofon = nil
    await zoomTon?.stoppe(); zoomTon = nil
    for s in spuren { await s.beende() }
    spuren = []
    teile = []
    laeuft = false
    print("Mithören beendet.")
  }
}

func bedienungshilfenErlaubt(fragen: Bool) -> Bool {
  let opt = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: fragen] as CFDictionary
  return AXIsProcessTrustedWithOptions(opt)
}

/// Erkennt, ob gerade ein Zoom-Meeting offen ist: Meetingfenster der Zoom-App oder laufende Bildschirmfreigabe.
enum Meeting {
  static let titel = ["Zoom Meeting", "Zoom-Meeting", "Zoom Webinar", "Zoom-Webinar"]

  static func laeuft() -> Bool {
    guard let app = ChatLeser.zoomApp() else { return false }
    // 1. Über die Bedienungshilfen (Fenstertitel der Zoom-App)
    if bedienungshilfenErlaubt(fragen: false) {
      for f in ChatBaum.kinder(app, kAXWindowsAttribute) {
        let t = ChatBaum.wert(f, kAXTitleAttribute)
        if titel.contains(where: { t.hasPrefix($0) }) { return true }
      }
    }
    // 2. Über die Fensterliste (braucht die Bildschirmaufnahme-Freigabe)
    if let liste = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] {
      for w in liste where (w[kCGWindowOwnerName as String] as? String) == "zoom.us" {
        let t = w[kCGWindowName as String] as? String ?? ""
        if titel.contains(where: { t.hasPrefix($0) }) { return true }
      }
    }
    // 3. Bildschirmfreigabe: dann ist das Meetingfenster versteckt, Zoom startet aber den Helfer CptHost.
    return prozessLaeuft("CptHost")
  }

  private static func prozessLaeuft(_ name: String) -> Bool {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
    p.arguments = ["-x", name]
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return false }
    p.waitUntilExit()
    return p.terminationStatus == 0
  }
}
