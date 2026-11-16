#!/bin/sh
# Holt den neuesten Stand von main. Bei Änderungen: Abhängigkeiten, Tests, Neustart.
set -eu
cd /opt/aktien-call-copilot
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0
ALT=$(git rev-parse HEAD)
git reset -q --hard origin/main
npm ci --omit=dev --no-audit --no-fund -s
if ! node --test test/*.test.mjs >/var/log/copilot-tests.log 2>&1; then
  echo "Tests fehlgeschlagen, zurück auf $ALT" >&2
  git reset -q --hard "$ALT"; npm ci --omit=dev --no-audit --no-fund -s
  exit 1
fi
cp deploy/aktien-copilot.service /etc/systemd/system/aktien-copilot.service
systemctl daemon-reload
systemctl restart aktien-copilot
echo "Aktualisiert auf $(git rev-parse --short HEAD)"
