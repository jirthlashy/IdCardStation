#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/server.env"
UFW_RULES_FILE="$SCRIPT_DIR/.ufw-opened-ports"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

MANAGE_UFW_RULES="${MANAGE_UFW_RULES:-true}"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "Missing command: pm2"
  exit 1
fi

remove_firewall_ports() {
  if [ "$MANAGE_UFW_RULES" != "true" ]; then
    return
  fi

  if [ ! -f "$UFW_RULES_FILE" ]; then
    echo "No recorded UFW rules to remove."
    return
  fi

  if ! command -v ufw >/dev/null 2>&1; then
    echo "UFW not found; cannot remove recorded firewall rules."
    return
  fi

  if ! sudo ufw status 2>/dev/null | grep -q "^Status: active"; then
    echo "UFW is not active; removing local UFW rule record only."
    rm -f "$UFW_RULES_FILE"
    return
  fi

  sort -u "$UFW_RULES_FILE" | while read -r port; do
    if echo "$port" | grep -Eq '^[0-9]+$'; then
      echo "Removing firewall port $port/tcp"
      sudo ufw delete allow "$port/tcp" >/dev/null 2>&1 || true
    fi
  done

  rm -f "$UFW_RULES_FILE"
}

pm2 stop thai-id-backend thai-id-nurse-webapp thai-id-station-display thai-id-kafka >/dev/null 2>&1 || true
remove_firewall_ports

echo "PM2 server apps stopped."
pm2 list
