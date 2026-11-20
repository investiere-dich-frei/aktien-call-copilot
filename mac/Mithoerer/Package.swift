// swift-tools-version: 6.0
// Mac-Mithörer für den Aktien-Call-Copilot: Ton (Mikrofon + Zoom) und Zoom-Chat → Copilot-Server.
import PackageDescription

let package = Package(
  name: "Mithoerer",
  platforms: [.macOS("26.0")],
  targets: [
    .executableTarget(name: "Mithoerer", swiftSettings: [.swiftLanguageMode(.v5)])
  ]
)
