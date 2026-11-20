import Foundation

/// Schickt fertige Beiträge der Reihe nach an den Copilot-Server (POST /api/beitrag).
/// Im Trockenlauf wird nur ausgegeben, nichts gesendet.
actor Sender {
  let server: URL?
  let token: String
  private var warteschlange: [[String: String]] = []
  private var laeuft = false

  init(server: URL?, token: String) {
    self.server = server
    self.token = token
  }

  nonisolated func schicke(art: String, name: String, text: String) {
    Task { await self.einreihen(["art": art, "name": name, "text": text]) }
  }

  private func einreihen(_ b: [String: String]) {
    let zeit = DateFormatter.localizedString(from: Date(), dateStyle: .none, timeStyle: .medium)
    print("[\(zeit)] \(b["art"] == "chat" ? "Chat" : "Ton") · \(b["name"] ?? ""): \(b["text"] ?? "")")
    guard server != nil else { return }
    warteschlange.append(b)
    if !laeuft { laeuft = true; Task { await self.abarbeiten() } }
  }

  private func abarbeiten() async {
    while !warteschlange.isEmpty {
      let b = warteschlange.removeFirst()
      var versuch = 0
      while versuch < 3 {
        versuch += 1
        if await senden(b) { break }
        try? await Task.sleep(for: .seconds(Double(versuch)))
      }
    }
    laeuft = false
  }

  private func senden(_ b: [String: String]) async -> Bool {
    guard let server else { return true }
    var req = URLRequest(url: server.appendingPathComponent("api/beitrag"))
    req.httpMethod = "POST"
    req.timeoutInterval = 10
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.httpBody = try? JSONSerialization.data(withJSONObject: b)
    do {
      let (_, antwort) = try await URLSession.shared.data(for: req)
      let code = (antwort as? HTTPURLResponse)?.statusCode ?? 0
      if code == 401 { print("Server lehnt den Zugang ab (401). Zugangsschlüssel prüfen."); return true }
      if code != 200 { print("Server antwortet \(code), versuche erneut.") }
      return code == 200
    } catch {
      print("Senden fehlgeschlagen: \(error.localizedDescription)")
      return false
    }
  }
}

/// Liest den Zugangsschlüssel des Copilots aus dem Schlüsselbund (Dienst "aktien-copilot", Konto "coach").
func ladeToken() -> String? {
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/bin/security")
  p.arguments = ["find-generic-password", "-s", "aktien-copilot", "-a", "coach", "-w"]
  let rohr = Pipe()
  p.standardOutput = rohr
  p.standardError = FileHandle.nullDevice
  do { try p.run() } catch { return nil }
  p.waitUntilExit()
  guard p.terminationStatus == 0 else { return nil }
  let t = String(data: rohr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
    .trimmingCharacters(in: .whitespacesAndNewlines)
  return (t?.isEmpty ?? true) ? nil : t
}
