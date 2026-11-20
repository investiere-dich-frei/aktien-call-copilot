import AVFoundation
import Foundation
import Speech

/// Eine Tonspur → Apples Spracherkennung auf dem Gerät (kein Ton verlässt den Mac) → fertige Sätze an den Sender.
final class Transkription: @unchecked Sendable {
  let name: String
  let sender: Sender
  private let transcriber: SpeechTranscriber
  private let analyzer: SpeechAnalyzer
  private let eingabe: AsyncStream<AnalyzerInput>
  private let fortsetzung: AsyncStream<AnalyzerInput>.Continuation
  private var zielformat: AVAudioFormat?
  private var wandler: AVAudioConverter?
  private var quellformat: AVAudioFormat?
  private let sperre = NSLock()
  private(set) var pegel: Float = 0

  init(name: String, locale: Locale, sender: Sender) {
    self.name = name
    self.sender = sender
    transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [])
    analyzer = SpeechAnalyzer(modules: [transcriber])
    (eingabe, fortsetzung) = AsyncStream<AnalyzerInput>.makeStream(bufferingPolicy: .bufferingNewest(400))
  }

  /// Lädt bei Bedarf das Sprachmodell und startet die Erkennung.
  func starte() async throws {
    if let anfrage = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
      print("Lade das deutsche Sprachmodell (einmalig) …")
      try await anfrage.downloadAndInstall()
    }
    zielformat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
    try await analyzer.start(inputSequence: eingabe)
    Task {
      do {
        for try await ergebnis in transcriber.results where ergebnis.isFinal {
          let text = String(ergebnis.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
          if text.count > 1 { sender.schicke(art: "sprache", name: name, text: text) }
        }
      } catch {
        print("Spracherkennung (\(name)) beendet: \(error.localizedDescription)")
      }
    }
  }

  /// Nimmt einen Tonpuffer in beliebigem Format an und reicht ihn im Format der Erkennung weiter.
  func fuettere(_ puffer: AVAudioPCMBuffer) {
    sperre.lock(); defer { sperre.unlock() }
    guard let ziel = zielformat, puffer.frameLength > 0 else { return }
    pegel = max(pegel * 0.9, spitze(puffer))
    if quellformat != puffer.format {
      quellformat = puffer.format
      wandler = AVAudioConverter(from: puffer.format, to: ziel)
    }
    guard let wandler else { return }
    let verhaeltnis = ziel.sampleRate / puffer.format.sampleRate
    let kapazitaet = AVAudioFrameCount(Double(puffer.frameLength) * verhaeltnis) + 64
    guard let aus = AVAudioPCMBuffer(pcmFormat: ziel, frameCapacity: kapazitaet) else { return }
    var geliefert = false
    var fehler: NSError?
    wandler.convert(to: aus, error: &fehler) { _, status in
      if geliefert { status.pointee = .noDataNow; return nil }
      geliefert = true
      status.pointee = .haveData
      return puffer
    }
    if fehler == nil, aus.frameLength > 0 { fortsetzung.yield(AnalyzerInput(buffer: aus)) }
  }

  func beende() async {
    fortsetzung.finish()
    try? await analyzer.finalizeAndFinishThroughEndOfInput()
  }

  private func spitze(_ p: AVAudioPCMBuffer) -> Float {
    guard let daten = p.floatChannelData else { return 0 }
    var m: Float = 0
    for i in 0..<Int(p.frameLength) { m = max(m, abs(daten[0][i])) }
    return m
  }
}

/// Prüft, ob die gewünschte Sprache auf dem Gerät erkannt werden kann, sonst Deutsch.
func sprachePruefen(_ wunsch: Locale) async -> Locale {
  if let l = await SpeechTranscriber.supportedLocale(equivalentTo: wunsch) { return l }
  print("Sprache \(wunsch.identifier) wird nicht unterstützt, nehme de-DE.")
  return Locale(identifier: "de-DE")
}
