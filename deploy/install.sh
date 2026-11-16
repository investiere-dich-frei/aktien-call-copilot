#!/bin/bash
# Einmalige Einrichtung des Aktien-Call-Copilots auf einem bestehenden Debian/Ubuntu-Server.
# Vom Mac aus:  ssh root@<server-ip> 'bash -s' < install.sh
#
# Was es tut (und was nicht):
# - eigenes Node.js 22 unter /opt/node22 (die System-Node-Version anderer Dienste bleibt unberührt)
# - eigener Deploy-Schlüssel nur für dieses Repo, nur lesen (privater Teil bleibt auf dem Server)
# - systemd-Dienst "aktien-copilot" auf 127.0.0.1:8765, Auto-Update per Timer
# - HTTPS: ergänzt einen laufenden Caddy um eine Site, oder installiert Caddy, wenn Port 80/443 frei sind.
#   Läuft ein anderer Webserver (nginx, Apache …), wird daran nichts geändert und nur ein Hinweis ausgegeben.
# Mehrfach ausführbar.
set -euo pipefail

PORT=8765
DIR=/opt/aktien-call-copilot
NODE_DIR=/opt/node22
ENVDATEI=/etc/aktien-copilot.env
KEY=/root/.ssh/aktien_copilot_deploy
GH_ALIAS=github-aktien-copilot
IP=$(curl -4 -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
DOMAIN=${COPILOT_DOMAIN:-$(echo "$IP" | tr . -).sslip.io}

echo "== Pakete"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl xz-utils ca-certificates openssh-client >/dev/null

echo "== Node.js 22 nach $NODE_DIR"
if [ ! -x "$NODE_DIR/bin/node" ]; then
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; *) echo "Unbekannte Architektur"; exit 1 ;; esac
  BASIS=https://nodejs.org/dist/latest-v22.x
  DATEI=$(curl -fsS "$BASIS/SHASUMS256.txt" | awk "/linux-$ARCH.tar.xz\$/ {print \$2}")
  SUMME=$(curl -fsS "$BASIS/SHASUMS256.txt" | awk "/linux-$ARCH.tar.xz\$/ {print \$1}")
  curl -fsS -o /tmp/node.tar.xz "$BASIS/$DATEI"
  echo "$SUMME  /tmp/node.tar.xz" | sha256sum -c --quiet
  mkdir -p "$NODE_DIR" && tar -xJf /tmp/node.tar.xz -C "$NODE_DIR" --strip-components=1 && rm /tmp/node.tar.xz
fi
"$NODE_DIR/bin/node" --version

echo "== Deploy-Schlüssel"
mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N "" -C "aktien-copilot@$(hostname)" -f "$KEY"
grep -q "Host $GH_ALIAS" /root/.ssh/config 2>/dev/null || cat >> /root/.ssh/config <<EOF

Host $GH_ALIAS
  HostName github.com
  User git
  IdentityFile $KEY
  IdentitiesOnly yes
EOF
# Offizieller GitHub-Hostschlüssel (docs.github.com → GitHub's SSH key fingerprints)
grep -q "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" /root/.ssh/known_hosts 2>/dev/null || \
  echo "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" >> /root/.ssh/known_hosts

echo "== Konfiguration $ENVDATEI"
if [ ! -f "$ENVDATEI" ]; then
  umask 077
  cat > "$ENVDATEI" <<EOF
HOST=127.0.0.1
PORT=$PORT
COACH_TOKEN=$(head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')
TRAINER_NAMEN=Christian
# Noch eintragen, dann: systemctl restart aktien-copilot
ANTHROPIC_API_KEY=
ZOOM_CLIENT_ID=
ZOOM_CLIENT_SECRET=
ZOOM_WEBHOOK_SECRET_TOKEN=
EOF
fi
if ss -ltn "sport = :$PORT" | grep -q LISTEN && ! systemctl is-active -q aktien-copilot; then
  echo "Port $PORT ist schon belegt. In $ENVDATEI einen anderen PORT eintragen und erneut ausführen."; exit 1
fi

echo "== Update-Dienst"
cat > /usr/local/bin/copilot-update <<'EOF'
#!/bin/sh
# Erstfassung aus install.sh. Wird nach dem ersten Klonen durch deploy/copilot-update.sh ersetzt.
set -eu
export PATH=/opt/node22/bin:$PATH
DIR=/opt/aktien-call-copilot
if [ ! -d "$DIR/.git" ]; then
  git clone -q --branch main git@github-aktien-copilot:investiere-dich-frei/aktien-call-copilot.git "$DIR.tmp" 2>/dev/null \
    || { rm -rf "$DIR.tmp"; echo "Repo noch nicht erreichbar (Deploy-Schlüssel in GitHub eingetragen?)"; exit 0; }
  mv "$DIR.tmp" "$DIR"
fi
exec sh "$DIR/deploy/copilot-update.sh"
EOF
chmod 755 /usr/local/bin/copilot-update
cat > /etc/systemd/system/copilot-update.service <<'EOF'
[Unit]
Description=Aktien-Call-Copilot aktualisieren
[Service]
Type=oneshot
ExecStart=/usr/local/bin/copilot-update
EOF
cat > /etc/systemd/system/copilot-update.timer <<'EOF'
[Unit]
Description=Aktien-Call-Copilot alle 2 Minuten aktualisieren
[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable -q --now copilot-update.timer

echo "== HTTPS für $DOMAIN"
WEB="nicht eingerichtet"
SITE="$DOMAIN {
	reverse_proxy 127.0.0.1:$PORT
}"
if systemctl is-active -q caddy; then
  if grep -q "^$DOMAIN " /etc/caddy/Caddyfile; then WEB="schon vorhanden"
  else
    cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.vor-copilot
    printf '\n# Aktien-Call-Copilot\n%s\n' "$SITE" >> /etc/caddy/Caddyfile
    if caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then systemctl reload caddy; WEB="Caddy ergänzt"
    else cp /etc/caddy/Caddyfile.vor-copilot /etc/caddy/Caddyfile; WEB="FEHLER: Caddyfile ungültig, nichts geändert"; fi
  fi
elif ss -ltn '( sport = :80 or sport = :443 )' | grep -q LISTEN; then
  WEB="Port 80/443 belegt von: $(ss -ltnp '( sport = :80 or sport = :443 )' | awk 'NR>1 {print $6}' | sort -u | tr '\n' ' ') → bitte Christian/Claude Bescheid geben, nichts geändert"
else
  apt-get install -y -qq caddy >/dev/null
  printf '%s\n' "$SITE" > /etc/caddy/Caddyfile
  systemctl enable -q caddy && systemctl restart caddy
  WEB="Caddy installiert"
fi

echo "== Erster Update-Lauf"
systemctl start copilot-update.service || true

TOKEN=$(grep '^COACH_TOKEN=' "$ENVDATEI" | cut -d= -f2)
cat <<EOF

==================================================================
Fertig. Webserver: $WEB

1) Deploy-Schlüssel in GitHub eintragen (nur lesen, NICHT "Allow write access"):
   https://github.com/investiere-dich-frei/aktien-call-copilot/settings/keys/new
   Titel: $(hostname) aktien-copilot
   Schlüssel:
   $(cat "$KEY.pub")
   Danach startet der Copilot innerhalb von 2 Minuten von selbst.

2) Oberfläche:   https://$DOMAIN/#token=$TOKEN
   (Zugangscode gut aufheben, nicht weitergeben)

3) Zoom-Webhook: https://$DOMAIN/zoom/webhook

4) Schlüssel eintragen:  nano $ENVDATEI  →  systemctl restart aktien-copilot
   Status:  systemctl status aktien-copilot   Log:  journalctl -u aktien-copilot -f
==================================================================
EOF
