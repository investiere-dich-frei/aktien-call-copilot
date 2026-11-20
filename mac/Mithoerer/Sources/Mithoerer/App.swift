import AppKit
import AVFoundation
import CoreGraphics
import Foundation
import ServiceManagement

/// Menüleisten-App: startet mit dem Mac, hört automatisch mit, sobald ein Zoom-Meeting offen ist,
/// und öffnet dazu die Copilot-Seite als eigenes Chrome-Fenster.
@MainActor
final class MenueApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
  private let server: URL
  private let token: String?
  private let sitzung: Sitzung?
  private var item: NSStatusItem!
  private var pruefer: Timer?
  private var ohneMeetingSeit: Date?
  private var automatischGestartet = false
  private let einst = UserDefaults.standard

  private var automatik: Bool {
    get { einst.object(forKey: "automatik") as? Bool ?? true }
    set { einst.set(newValue, forKey: "automatik") }
  }
  private var seiteOeffnen: Bool {
    get { einst.object(forKey: "seiteOeffnen") as? Bool ?? true }
    set { einst.set(newValue, forKey: "seiteOeffnen") }
  }

  init(server: URL, leitung: String) {
    self.server = server
    token = ladeToken()
    sitzung = token.map { Sitzung(leitung: leitung, sender: Sender(server: server, token: $0)) }
    super.init()
  }

  func applicationDidFinishLaunching(_ n: Notification) {
    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let menue = NSMenu()
    menue.delegate = self
    item.menu = menue
    aktualisiereSymbol()
    if SMAppService.mainApp.status == .notRegistered { try? SMAppService.mainApp.register() }
    if token == nil { print("Kein Zugangsschlüssel im Schlüsselbund (Dienst aktien-copilot, Konto coach).") }
    // Rechte gleich beim ersten Start abfragen, nicht erst mitten im Call.
    _ = bedienungshilfenErlaubt(fragen: true)
    if !CGPreflightScreenCaptureAccess() { CGRequestScreenCaptureAccess() }
    if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined { AVCaptureDevice.requestAccess(for: .audio) { _ in } }
    pruefer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated { self?.pruefe() }
    }
    pruefe()
  }

  private func pruefe() {
    guard let sitzung, automatik else { return }
    let meeting = Meeting.laeuft()
    if meeting {
      ohneMeetingSeit = nil
      if !sitzung.laeuft {
        automatischGestartet = true
        print("Zoom-Meeting erkannt.")
        if seiteOeffnen { oeffneCopilot() }
        Task { await sitzung.starte(); aktualisiereSymbol() }
      }
    } else if sitzung.laeuft && automatischGestartet {
      // Kurze Lücken (Fensterwechsel, Breakout-Räume) überbrücken.
      if ohneMeetingSeit == nil { ohneMeetingSeit = Date() }
      if Date().timeIntervalSince(ohneMeetingSeit!) > 60 {
        ohneMeetingSeit = nil
        automatischGestartet = false
        Task { await sitzung.stoppe(); aktualisiereSymbol() }
      }
    }
  }

  private func aktualisiereSymbol() {
    let an = sitzung?.laeuft ?? false
    let bild = NSImage(systemSymbolName: an ? "waveform.circle.fill" : "waveform.circle", accessibilityDescription: "Copilot-Mithörer")
    bild?.isTemplate = !an
    item.button?.image = bild
    item.button?.contentTintColor = an ? .systemGreen : nil
    item.button?.toolTip = an ? "Copilot hört mit" : "Copilot wartet auf ein Zoom-Meeting"
  }

  // Menü wird bei jedem Öffnen neu gebaut, damit der Zustand stimmt.
  func menuNeedsUpdate(_ menue: NSMenu) {
    menue.removeAllItems()
    let an = sitzung?.laeuft ?? false
    let kopf: String
    if token == nil { kopf = "Kein Zugangsschlüssel hinterlegt" }
    else if an { kopf = "Hört mit: " + (sitzung?.teile.joined(separator: ", ") ?? "") }
    else { kopf = automatik ? "Wartet auf ein Zoom-Meeting" : "Aus" }
    let k = NSMenuItem(title: kopf, action: nil, keyEquivalent: "")
    k.isEnabled = false
    menue.addItem(k)
    menue.addItem(.separator())
    menue.addItem(eintrag("Copilot öffnen", #selector(copilotOeffnen), "o"))
    if sitzung != nil {
      menue.addItem(eintrag(an ? "Mithören beenden" : "Jetzt mithören", #selector(umschalten), ""))
    }
    menue.addItem(.separator())
    let a = eintrag("Automatisch bei Zoom-Meetings", #selector(automatikUmschalten), "")
    a.state = automatik ? .on : .off
    menue.addItem(a)
    let s = eintrag("Copilot-Seite dabei öffnen", #selector(seiteUmschalten), "")
    s.state = seiteOeffnen ? .on : .off
    menue.addItem(s)
    let l = eintrag("Beim Anmelden starten", #selector(anmeldungUmschalten), "")
    l.state = SMAppService.mainApp.status == .enabled ? .on : .off
    menue.addItem(l)
    menue.addItem(eintrag("Protokoll anzeigen", #selector(protokoll), ""))
    menue.addItem(.separator())
    menue.addItem(eintrag("Beenden", #selector(beenden), "q"))
  }

  private func eintrag(_ t: String, _ a: Selector, _ k: String) -> NSMenuItem {
    let i = NSMenuItem(title: t, action: a, keyEquivalent: k)
    i.target = self
    return i
  }

  @objc private func copilotOeffnen() { oeffneCopilot() }

  @objc private func umschalten() {
    guard let sitzung else { return }
    if sitzung.laeuft {
      automatischGestartet = false
      Task { await sitzung.stoppe(); aktualisiereSymbol() }
    } else {
      automatischGestartet = false
      Task { await sitzung.starte(); aktualisiereSymbol() }
    }
  }

  @objc private func automatikUmschalten() { automatik.toggle() }
  @objc private func seiteUmschalten() { seiteOeffnen.toggle() }

  @objc private func anmeldungUmschalten() {
    if SMAppService.mainApp.status == .enabled { try? SMAppService.mainApp.unregister() }
    else { try? SMAppService.mainApp.register() }
  }

  @objc private func protokoll() { NSWorkspace.shared.open(MenueApp.protokollDatei) }

  @objc private func beenden() {
    Task {
      await sitzung?.stoppe()
      NSApp.terminate(nil)
    }
  }

  /// Öffnet die Copilot-Seite als schlankes Chrome-Fenster (ohne Tabs und Adressleiste), angemeldet.
  private func oeffneCopilot() {
    var adresse = server.absoluteString
    if let token, let t = token.addingPercentEncoding(withAllowedCharacters: .alphanumerics) { adresse += "/#token=" + t }
    if let chrome = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.Chrome") {
      let cfg = NSWorkspace.OpenConfiguration()
      cfg.arguments = ["--app=" + adresse]
      cfg.createsNewApplicationInstance = true
      NSWorkspace.shared.openApplication(at: chrome, configuration: cfg)
    } else if let url = URL(string: adresse) {
      NSWorkspace.shared.open(url)
    }
  }

  nonisolated static let protokollDatei = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Logs/Copilot-Mithoerer.log")
}
