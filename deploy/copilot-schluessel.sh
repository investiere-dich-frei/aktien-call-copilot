#!/bin/bash
# Schlüssel des Aktien-Call-Copilots verdeckt eintragen. Leere Eingabe = Wert bleibt.
set -eu
F=/etc/aktien-copilot.env
for K in ZOOM_CLIENT_ID ZOOM_CLIENT_SECRET ZOOM_WEBHOOK_SECRET_TOKEN ANTHROPIC_API_KEY; do
  read -r -s -p "$K (Enter = unverändert): " V; echo
  [ -z "$V" ] && continue
  K="$K" V="$V" /opt/node22/bin/node -e '
    const fs=require("fs"), f="/etc/aktien-copilot.env", k=process.env.K, v=process.env.V.trim();
    let t=fs.readFileSync(f,"utf8"); const re=new RegExp("^"+k+"=.*$","m");
    t = re.test(t) ? t.replace(re, () => k+"="+v) : t.replace(/\n?$/,"\n")+k+"="+v+"\n";
    fs.writeFileSync(f,t,{mode:0o600});'
  echo "  $K gesetzt"
done
systemctl restart aktien-copilot; sleep 2
echo "Dienst: $(systemctl is-active aktien-copilot)"
for K in ZOOM_CLIENT_ID ZOOM_CLIENT_SECRET ZOOM_WEBHOOK_SECRET_TOKEN ANTHROPIC_API_KEY; do
  grep -q "^$K=." $F && echo "  $K: vorhanden" || echo "  $K: fehlt"
done
