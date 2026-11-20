import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

/// Mikrofon der Call-Leitung.
final class Mikrofon {
  private let engine = AVAudioEngine()

  func starte(an ziel: Transkription) throws {
    let eingang = engine.inputNode
    let format = eingang.outputFormat(forBus: 0)
    eingang.installTap(onBus: 0, bufferSize: 4096, format: format) { puffer, _ in ziel.fuettere(puffer) }
    try engine.start()
  }

  func stoppe() { engine.inputNode.removeTap(onBus: 0); engine.stop() }
}

/// Ton, den Zoom abspielt (die Teilnehmerinnen), über ScreenCaptureKit, nur von der Zoom-App.
final class ZoomTon: NSObject, SCStreamOutput, SCStreamDelegate {
  static let zoomKennung = "us.zoom.xos"
  private var strom: SCStream?
  private var ziel: Transkription?
  private let schlange = DispatchQueue(label: "mithoerer.zoomton")

  func starte(an ziel: Transkription) async throws {
    self.ziel = ziel
    let inhalt = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    guard let zoom = inhalt.applications.first(where: { $0.bundleIdentifier == Self.zoomKennung }) else {
      throw Fehler.zoomLaeuftNicht
    }
    guard let bildschirm = inhalt.displays.first else { throw Fehler.keinBildschirm }
    let filter = SCContentFilter(display: bildschirm, including: [zoom], exceptingWindows: [])
    let cfg = SCStreamConfiguration()
    cfg.capturesAudio = true
    cfg.excludesCurrentProcessAudio = true
    cfg.sampleRate = 48_000
    cfg.channelCount = 1
    cfg.width = 2
    cfg.height = 2
    cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
    let s = SCStream(filter: filter, configuration: cfg, delegate: self)
    try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: schlange)
    try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: schlange)
    try await s.startCapture()
    strom = s
  }

  func stoppe() async { try? await strom?.stopCapture(); strom = nil }

  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .audio, sb.isValid, let puffer = Self.pcm(aus: sb) else { return }
    ziel?.fuettere(puffer)
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    print("Zoom-Ton unterbrochen: \(error.localizedDescription)")
  }

  static func pcm(aus sb: CMSampleBuffer) -> AVAudioPCMBuffer? {
    guard let beschreibung = sb.formatDescription?.audioStreamBasicDescription else { return nil }
    var asbd = beschreibung
    guard let format = AVAudioFormat(streamDescription: &asbd) else { return nil }
    let anzahl = AVAudioFrameCount(sb.numSamples)
    guard anzahl > 0, let puffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: anzahl) else { return nil }
    puffer.frameLength = anzahl
    let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(sb, at: 0, frameCount: Int32(anzahl), into: puffer.mutableAudioBufferList)
    return status == noErr ? puffer : nil
  }

  enum Fehler: LocalizedError {
    case zoomLaeuftNicht, keinBildschirm
    var errorDescription: String? {
      switch self {
      case .zoomLaeuftNicht: return "Zoom läuft nicht. Bitte zuerst das Meeting in der Zoom-App öffnen."
      case .keinBildschirm: return "Kein Bildschirm gefunden."
      }
    }
  }
}
