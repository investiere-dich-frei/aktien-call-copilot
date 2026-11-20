#!/bin/sh
# Wird alle 2 Minuten von /usr/local/bin/copilot-update aufgerufen (siehe install.sh).
# Holt den neuesten Stand von main. Bei Änderungen: Abhängigkeiten, Tests, Neustart.
# Schlagen die Tests fehl, bleibt der vorige Stand aktiv.
set -eu
export PATH=/opt/node22/bin:$PATH
cd /opt/aktien-call-copilot

ERSTER_LAUF=0
systemctl is-enabled -q aktien-copilot 2>/dev/null || ERSTER_LAUF=1
# Sperre während eines Calls: Ein Neustart würde Karten und Mitschrift löschen. Solange in den letzten
# 10 Minuten Beiträge ankamen, wird nicht aktualisiert. Notfall: COPILOT_UPDATE_SOFORT=1 copilot-update
if [ "${COPILOT_UPDATE_SOFORT:-0}" != 1 ]; then
  HOST=$(sed -n 's/^HOST=//p' /etc/aktien-copilot.env 2>/dev/null | tail -1)
  PORT=$(sed -n 's/^PORT=//p' /etc/aktien-copilot.env 2>/dev/null | tail -1)
  AKTIV=$(curl -s --max-time 3 "http://${HOST:-127.0.0.1}:${PORT:-8765}/health" | sed -n 's/.*"aktivVorSek":\([0-9]*\).*/\1/p')
  if [ -n "$AKTIV" ] && [ "$AKTIV" -lt 600 ]; then exit 0; fi
fi
git fetch -q origin main
if [ "$ERSTER_LAUF" = 0 ] && [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then exit 0; fi
ALT=$(git rev-parse HEAD)
git reset -q --hard origin/main

npm ci --omit=dev --no-audit --no-fund -s
if ! node --test test/*.test.mjs >/var/log/copilot-tests.log 2>&1; then
  echo "Tests fehlgeschlagen, siehe /var/log/copilot-tests.log" >&2
  if [ "$ERSTER_LAUF" = 0 ]; then git reset -q --hard "$ALT"; npm ci --omit=dev --no-audit --no-fund -s; fi
  exit 1
fi
cp deploy/aktien-copilot.service /etc/systemd/system/aktien-copilot.service
systemctl daemon-reload
systemctl enable -q aktien-copilot
systemctl restart aktien-copilot
echo "Aktiv: $(git rev-parse --short HEAD)"
