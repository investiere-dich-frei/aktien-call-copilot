#!/bin/sh
# Holt den neuesten Stand von main (beim ersten Mal: klont das Repo).
# Bei Änderungen: Abhängigkeiten, Tests, Neustart. Läuft alle 2 Minuten per systemd-Timer.
set -eu
REPO=git@github.com:investiere-dich-frei/aktien-call-copilot.git
DIR=/opt/aktien-call-copilot

if [ ! -d "$DIR/.git" ]; then
  # Klappt erst, wenn der Deploy-Schlüssel im GitHub-Repo eingetragen ist
  git clone -q --branch main "$REPO" "$DIR.tmp" 2>/dev/null || { rm -rf "$DIR.tmp"; echo "Repo noch nicht erreichbar (Deploy-Schlüssel eingetragen?)"; exit 0; }
  mv "$DIR.tmp" "$DIR"
  ALT=""
else
  cd "$DIR"
  git fetch -q origin main
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0
  ALT=$(git rev-parse HEAD)
  git reset -q --hard origin/main
fi

cd "$DIR"
npm ci --omit=dev --no-audit --no-fund -s
if ! node --test test/*.test.mjs >/var/log/copilot-tests.log 2>&1; then
  echo "Tests fehlgeschlagen" >&2
  if [ -n "$ALT" ]; then git reset -q --hard "$ALT"; npm ci --omit=dev --no-audit --no-fund -s; fi
  exit 1
fi
cp deploy/aktien-copilot.service /etc/systemd/system/aktien-copilot.service
systemctl daemon-reload
systemctl enable -q aktien-copilot
systemctl restart aktien-copilot
echo "Aktiv: $(git rev-parse --short HEAD)"
