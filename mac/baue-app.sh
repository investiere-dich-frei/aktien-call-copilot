#!/bin/zsh
# Baut die Menüleisten-App "Copilot-Mithörer.app" und legt sie nach ~/Applications.
# Signiert mit dem ersten "Apple Development"-Zertifikat im Schlüsselbund (bleibt gleich, damit die
# Mac-Freigaben nach einem Neubau erhalten bleiben), sonst ad hoc (dann Freigaben neu erteilen).
set -e
cd "${0:A:h}/Mithoerer"
swift build -c release
APP="${ZIEL:-$HOME/Applications}/Copilot-Mithörer.app"
TMP=$(mktemp -d)/Copilot-Mithörer.app
mkdir -p "$TMP/Contents/MacOS" "$TMP/Contents/Resources"
cp .build/release/Mithoerer "$TMP/Contents/MacOS/Mithoerer"
cat > "$TMP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>de.investieredichfrei.mithoerer</string>
  <key>CFBundleName</key><string>Copilot-Mithörer</string>
  <key>CFBundleDisplayName</key><string>Copilot-Mithörer</string>
  <key>CFBundleExecutable</key><string>Mithoerer</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>$(git -C .. rev-list --count HEAD 2>/dev/null || echo 1)</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Der Copilot hört im Zoom-Call dein Mikrofon mit und erkennt die Sprache direkt auf dem Mac.</string>
  <key>NSSpeechRecognitionUsageDescription</key><string>Die Spracherkennung läuft offline auf dem Mac.</string>
  <key>NSAudioCaptureUsageDescription</key><string>Der Copilot hört den Ton der Zoom-App mit.</string>
</dict></plist>
PLIST
ID=${SIGN_ID:-$(security find-identity -p codesigning -v | sed -n 's/.*"\(Apple Development[^"]*\)".*/\1/p' | head -1)}
codesign --force --options runtime --entitlements /dev/stdin --sign "${ID:--}" "$TMP" <<ENT
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.device.audio-input</key><true/></dict></plist>
ENT
mkdir -p "${APP:h}"
pkill -x Mithoerer 2>/dev/null && sleep 1 || true
rm -rf "$APP" && mv "$TMP" "$APP"
echo "Fertig: $APP (signiert: ${ID:-ad hoc})"
