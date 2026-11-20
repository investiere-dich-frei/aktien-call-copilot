import AppKit
import ApplicationServices
import Foundation

/// Liest den Zoom-Chat über die Bedienungshilfen von macOS (dieselbe Schnittstelle wie Vorleseprogramme).
/// Das Chatfenster bzw. die Chatleiste muss im Meeting offen sein.
final class ChatLeser {
  private let sender: Sender
  private var gesehen: [String: Int] = [:]
  private var erster = true
  private var timer: Timer?
  private var gewarnt = false

  private let leitung: String
  init(sender: Sender, leitung: String) { self.sender = sender; self.leitung = leitung }

  static func zoomApp() -> AXUIElement? {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: ZoomTon.zoomKennung).first else { return nil }
    return AXUIElementCreateApplication(app.processIdentifier)
  }

  func starte() {
    timer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in self?.abfragen() }
    abfragen()
  }

  private func abfragen() {
    guard let app = Self.zoomApp() else { return }
    let zeilen = ChatBaum.nachrichten(in: app)
    if zeilen == nil {
      if !gewarnt { print("Zoom-Chat nicht gefunden. Bitte im Meeting den Chat öffnen."); gewarnt = true }
      return
    }
    gewarnt = false
    // Nachrichten zählen, damit gleiche Texte verschiedener Personen nicht verloren gehen.
    var jetzt: [String: Int] = [:]
    for z in zeilen! {
      let schluessel = "\(z.name)|\(z.text)"
      jetzt[schluessel, default: 0] += 1
      if jetzt[schluessel]! > gesehen[schluessel, default: 0] {
        // Beim Start alles Vorhandene nur merken, nicht senden.
        let name = ["Sie", "Ich", "Me", "You"].contains(z.name) ? leitung : z.name
        if !erster { sender.schicke(art: "chat", name: name, text: z.text) }
      }
    }
    for (k, n) in jetzt where n > gesehen[k, default: 0] { gesehen[k] = n }
    erster = false
  }
}

struct ChatNachricht { let name: String; let text: String }

enum ChatBaum {
  /// Sucht im Zoom-Fenster die Chatliste und liefert deren Nachrichten (nil = kein Chat gefunden).
  static func nachrichten(in app: AXUIElement) -> [ChatNachricht]? {
    for fenster in kinder(app, kAXWindowsAttribute) {
      if let liste = finde(fenster, tiefe: 0, istChat: istChatFenster(fenster)) {
        return zeilen(von: liste)
      }
    }
    return nil
  }

  static func istChatFenster(_ e: AXUIElement) -> Bool {
    let t = [wert(e, kAXTitleAttribute), wert(e, kAXDescriptionAttribute), wert(e, kAXIdentifierAttribute)].joined(separator: " ")
    return t.range(of: "chat", options: .caseInsensitive) != nil
  }

  private static func finde(_ e: AXUIElement, tiefe: Int, istChat: Bool) -> AXUIElement? {
    if tiefe > 25 { return nil }
    let rolle = wert(e, kAXRoleAttribute)
    let chat = istChat || istChatFenster(e)
    if rolle == "AXTable", wert(e, kAXDescriptionAttribute).hasPrefix("Chat-Liste") || wert(e, kAXDescriptionAttribute).hasPrefix("Chat list") { return e }
    if chat, ["AXTable", "AXList", "AXOutline"].contains(rolle) { return e }
    for k in kinder(e, kAXChildrenAttribute) {
      if let f = finde(k, tiefe: tiefe + 1, istChat: chat) { return f }
    }
    return nil
  }

  /// Zoom (getestet 20.11.2026, Version 7.2.5): Tabelle "Chat-Liste", je Nachricht eine Zelle "ZMTextMessageCellView".
  /// Deren Kinder: Profil-Knopf, Name (AXUnknown, fehlt bei Folgenachrichten derselben Person), Uhrzeit (AXStaticText),
  /// Nachricht (AXUnknown). Systemzeilen ("Meeting gestartet", Datum) sind "ZMPromptMessageCellView" und werden übersprungen.
  private static func zeilen(von liste: AXUIElement) -> [ChatNachricht] {
    var out: [ChatNachricht] = []
    var name = "Teilnehmer:in"
    let reihen = kinder(liste, kAXRowsAttribute).isEmpty ? kinder(liste, kAXChildrenAttribute) : kinder(liste, kAXRowsAttribute)
    for reihe in reihen {
      if let zelle = findeId(reihe, "ZMTextMessageCellView", tiefe: 0) {
        let werte = kinder(zelle, kAXChildrenAttribute)
          .filter { wert($0, kAXRoleAttribute) == "AXUnknown" }
          .map { wert($0, kAXValueAttribute).trimmingCharacters(in: .whitespacesAndNewlines) }
          .filter { !$0.isEmpty }
        if werte.count >= 2 { name = werte[0]; out.append(ChatNachricht(name: name, text: werte.dropFirst().joined(separator: " "))) }
        else if werte.count == 1 { out.append(ChatNachricht(name: name, text: werte[0])) }
        continue
      }
      if findeId(reihe, "ZMPromptMessageCellView", tiefe: 0) != nil { continue }
      // Rückfallebene für andere Zoom-Fassungen: alle Texte der Zeile, Kopf "Von X an Alle" als Name.
      let texte = sammleTexte(reihe, tiefe: 0).filter { !$0.isEmpty }
      if texte.isEmpty { continue }
      if let kopf = texte.first(where: { istKopf($0) }) {
        name = kopfName(kopf)
        let rest = texte.filter { $0 != kopf && !istUhrzeit($0) }
        if !rest.isEmpty { out.append(ChatNachricht(name: name, text: rest.joined(separator: " "))) }
      } else {
        out.append(ChatNachricht(name: name, text: texte.filter { !istUhrzeit($0) }.joined(separator: " ")))
      }
    }
    return out.filter { !$0.text.isEmpty }
  }

  private static func findeId(_ e: AXUIElement, _ id: String, tiefe: Int) -> AXUIElement? {
    if wert(e, kAXIdentifierAttribute) == id { return e }
    if tiefe > 4 { return nil }
    for k in kinder(e, kAXChildrenAttribute) { if let f = findeId(k, id, tiefe: tiefe + 1) { return f } }
    return nil
  }

  // "Von Anna an Alle", "From Anna to Everyone", "Anna an Alle"
  static func istKopf(_ s: String) -> Bool {
    s.range(of: #"^(Von |From )?.{1,60} (an|to) (Alle|Jeder|Everyone|alle)"#, options: .regularExpression) != nil
  }

  static func kopfName(_ s: String) -> String {
    var n = s.replacingOccurrences(of: #"^(Von |From )"#, with: "", options: .regularExpression)
    if let r = n.range(of: #" (an|to) .*$"#, options: .regularExpression) { n.removeSubrange(r) }
    return n.trimmingCharacters(in: .whitespaces)
  }

  static func istUhrzeit(_ s: String) -> Bool {
    s.range(of: #"^\d{1,2}:\d{2}( ?(AM|PM|Uhr))?$"#, options: .regularExpression) != nil
  }

  private static func sammleTexte(_ e: AXUIElement, tiefe: Int) -> [String] {
    if tiefe > 12 { return [] }
    var out: [String] = []
    let rolle = wert(e, kAXRoleAttribute)
    if rolle == "AXStaticText" || rolle == "AXTextArea" || rolle == "AXTextField" {
      let v = wert(e, kAXValueAttribute)
      out.append(v.isEmpty ? wert(e, kAXDescriptionAttribute) : v)
    }
    for k in kinder(e, kAXChildrenAttribute) { out += sammleTexte(k, tiefe: tiefe + 1) }
    return out
  }

  // MARK: Hilfen und Baum-Ausgabe zur Fehlersuche

  static func kinder(_ e: AXUIElement, _ attr: String) -> [AXUIElement] {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(e, attr as CFString, &v) == .success, let a = v as? [AXUIElement] else { return [] }
    return a
  }

  static func wert(_ e: AXUIElement, _ attr: String) -> String {
    var v: CFTypeRef?
    guard AXUIElementCopyAttributeValue(e, attr as CFString, &v) == .success, let v else { return "" }
    if let s = v as? String { return s }
    return ""
  }

  /// Gibt den Bedienungshilfen-Baum aller Zoom-Fenster aus (nur Rollen und Beschriftungen).
  static func baumAusgeben() {
    guard let app = ChatLeser.zoomApp() else { print("Zoom läuft nicht."); return }
    for (i, f) in kinder(app, kAXWindowsAttribute).enumerated() {
      print("=== Fenster \(i): \(wert(f, kAXTitleAttribute))")
      knoten(f, tiefe: 0)
    }
  }

  private static func knoten(_ e: AXUIElement, tiefe: Int) {
    if tiefe > 30 { return }
    let teile = [
      wert(e, kAXRoleAttribute),
      wert(e, kAXSubroleAttribute),
      "t=" + wert(e, kAXTitleAttribute),
      "d=" + wert(e, kAXDescriptionAttribute),
      "id=" + wert(e, kAXIdentifierAttribute),
      "v=" + String(wert(e, kAXValueAttribute).prefix(80)),
    ].filter { !$0.hasSuffix("=") && !$0.isEmpty }
    print(String(repeating: "  ", count: tiefe) + teile.joined(separator: " | "))
    for k in kinder(e, kAXChildrenAttribute) { knoten(k, tiefe: tiefe + 1) }
  }
}
