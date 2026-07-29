#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/server.env"
KAFKA_DIR="$SCRIPT_DIR/kafka_2.13-4.3.1"
BACKEND_DIR="$SCRIPT_DIR/backend"
NURSE_WEB_DIR="$SCRIPT_DIR/nurse-webapp"
STATION_DISPLAY_DIR="$SCRIPT_DIR/station-display"
LOG_DIR="$SCRIPT_DIR/logs"
UFW_RULES_FILE="$SCRIPT_DIR/.ufw-opened-ports"

mkdir -p "$LOG_DIR"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

detect_ip() {
  hostname -I | awk '{print $1}'
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

require_installation() {
  local missing=0
  for path in \
    "$KAFKA_DIR/bin/kafka-server-start.sh" \
    "$BACKEND_DIR/apps/backend/dist/index.js" \
    "$BACKEND_DIR/node_modules" \
    "$NURSE_WEB_DIR/index.html" \
    "$STATION_DISPLAY_DIR/index.html"; do
    if [ ! -e "$path" ]; then
      echo "Missing installation artifact: $path" >&2
      missing=1
    fi
  done
  if [ "$missing" -ne 0 ]; then
    echo "Run: bash INSTALL_SERVER_DEPS.sh" >&2
    exit 1
  fi
}

set_kafka_property() {
  local key="$1"
  local value="$2"
  local file="$KAFKA_DIR/config/server.properties"
  if grep -q "^$key=" "$file"; then
    sed -i "s|^$key=.*|$key=$value|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

prepare_kafka_permissions() {
  chmod +x "$KAFKA_DIR"/bin/*.sh
}

format_kafka_if_needed() {
  local config="$KAFKA_DIR/config/server.properties"
  local log_dirs
  log_dirs="$(grep '^log.dirs=' "$config" | cut -d= -f2- || true)"
  log_dirs="${log_dirs:-/tmp/kraft-combined-logs}"

  if [ ! -f "$log_dirs/meta.properties" ]; then
    echo "Formatting Kafka storage at $log_dirs"
    local cluster_id
    cluster_id="$(bash "$KAFKA_DIR/bin/kafka-storage.sh" random-uuid)"
    bash "$KAFKA_DIR/bin/kafka-storage.sh" format --standalone -t "$cluster_id" -c "$config"
  fi
}

ufw_is_active() {
  command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q '^Status: active'
}

ufw_rule_exists() {
  local port="$1"
  sudo ufw status 2>/dev/null | grep -Eq "(^|[[:space:]])${port}/tcp[[:space:]].*ALLOW"
}

open_firewall_ports() {
  if [ "$MANAGE_UFW_RULES" != "true" ]; then
    return
  fi
  if ! command -v ufw >/dev/null 2>&1; then
    echo "UFW not found; skipping firewall port setup."
    return
  fi
  if ! ufw_is_active; then
    echo "UFW is not active; skipping firewall port setup."
    return
  fi

  : > "$UFW_RULES_FILE"
  for port in "$NURSE_WEB_PORT" "$BACKEND_PORT" "$STATION_DISPLAY_PORT" "$KAFKA_PORT"; do
    if ! echo "$port" | grep -Eq '^[0-9]+$'; then
      echo "Skipping invalid firewall port: $port"
      continue
    fi
    if ufw_rule_exists "$port"; then
      echo "Firewall already allows $port/tcp; leaving existing rule alone."
    else
      echo "Opening firewall port $port/tcp"
      sudo ufw allow "$port/tcp"
      echo "$port" >> "$UFW_RULES_FILE"
    fi
  done
}

print_station_urls() {
  local station_ids=""
  if [ -n "${STATIONS_CONFIG_PATH:-}" ] && [ -f "$STATIONS_CONFIG_PATH" ]; then
    station_ids="$(node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); console.log((data.stations || []).map((station) => station.stationId).filter(Boolean).join(' '));" "$STATIONS_CONFIG_PATH")"
  else
    station_ids="$(printf '%s' "$ALLOWED_STATION_IDS" | tr ',' ' ')"
  fi

  echo
  echo "Configured stations:"
  for station_id in $station_ids; do
    echo "  $station_id"
    echo "    Nurse webapp:    http://$SERVER_IP:$NURSE_WEB_PORT/?stationId=$station_id"
    echo "    Station display: http://$SERVER_IP:$STATION_DISPLAY_PORT/?stationId=$station_id"
  done
}

require_command java
require_command node
require_command python3
require_command bash
require_command pm2
require_installation

SERVER_IP="${SERVER_IP:-auto}"
if [ "$SERVER_IP" = "auto" ]; then
  SERVER_IP="$(detect_ip)"
fi
if [ -z "$SERVER_IP" ]; then
  echo "Could not resolve SERVER_IP. Set it explicitly in server.env." >&2
  exit 1
fi

KAFKA_PORT="${KAFKA_PORT:-9092}"
BACKEND_PORT="${BACKEND_PORT:-3001}"
NURSE_WEB_PORT="${NURSE_WEB_PORT:-3000}"
STATION_DISPLAY_PORT="${STATION_DISPLAY_PORT:-3002}"
STATION_ID="${STATION_ID:-A01}"
ALLOWED_STATION_IDS="${ALLOWED_STATION_IDS:-A01}"
KAFKA_BROKERS="${KAFKA_BROKERS:-$SERVER_IP:$KAFKA_PORT}"
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-http://$SERVER_IP:$NURSE_WEB_PORT,http://$SERVER_IP:$STATION_DISPLAY_PORT}"
MANAGE_UFW_RULES="${MANAGE_UFW_RULES:-true}"

if [ -n "${STATIONS_CONFIG_PATH:-}" ]; then
  case "$STATIONS_CONFIG_PATH" in
    /*) ;;
    *) STATIONS_CONFIG_PATH="$SCRIPT_DIR/$STATIONS_CONFIG_PATH" ;;
  esac
fi

prepare_kafka_permissions
set_kafka_property "listeners" "PLAINTEXT://0.0.0.0:$KAFKA_PORT,CONTROLLER://localhost:9093"
set_kafka_property "advertised.listeners" "PLAINTEXT://$SERVER_IP:$KAFKA_PORT"
format_kafka_if_needed
open_firewall_ports

export BACKEND_HOST=0.0.0.0
export BACKEND_PORT
export KAFKA_BROKERS
export STATION_ID
export ALLOWED_STATION_IDS
if [ -n "${STATIONS_CONFIG_PATH:-}" ]; then
  export STATIONS_CONFIG_PATH
fi
export CORS_ALLOWED_ORIGINS
export SCAN_REQUEST_TTL_SECONDS="${SCAN_REQUEST_TTL_SECONDS:-90}"
export STATION_COOLDOWN_MS="${STATION_COOLDOWN_MS:-3000}"
export QUEUED_REQUEST_MAX_AGE_SECONDS="${QUEUED_REQUEST_MAX_AGE_SECONDS:-300}"
export RESULT_AUTO_CLEAR_SECONDS="${RESULT_AUTO_CLEAR_SECONDS:-120}"
export MAX_QUEUE_DEPTH_PER_STATION="${MAX_QUEUE_DEPTH_PER_STATION:-10}"
export SCAN_REQUEST_RATE_LIMIT_WINDOW_MS="${SCAN_REQUEST_RATE_LIMIT_WINDOW_MS:-60000}"
export SCAN_REQUEST_RATE_LIMIT_MAX="${SCAN_REQUEST_RATE_LIMIT_MAX:-20}"
export READER_HEARTBEAT_MS="${READER_HEARTBEAT_MS:-10000}"

pm2 delete thai-id-kafka thai-id-backend thai-id-nurse-webapp thai-id-station-display >/dev/null 2>&1 || true

pm2 start bash \
  --name thai-id-kafka \
  -- "$KAFKA_DIR/bin/kafka-server-start.sh" "$KAFKA_DIR/config/server.properties"

sleep 5

pm2 start node \
  --name thai-id-backend \
  --cwd "$BACKEND_DIR" \
  -- apps/backend/dist/index.js

pm2 start python3 \
  --name thai-id-nurse-webapp \
  --cwd "$NURSE_WEB_DIR" \
  -- -m http.server "$NURSE_WEB_PORT" --bind 0.0.0.0

pm2 start python3 \
  --name thai-id-station-display \
  --cwd "$STATION_DISPLAY_DIR" \
  -- -m http.server "$STATION_DISPLAY_PORT" --bind 0.0.0.0

pm2 save

cat <<EOF
Server apps started under PM2.

Server IP:        $SERVER_IP
Kafka:            $KAFKA_BROKERS
Backend:          http://$SERVER_IP:$BACKEND_PORT
Nurse webapp:     http://$SERVER_IP:$NURSE_WEB_PORT
Station display:  http://$SERVER_IP:$STATION_DISPLAY_PORT
EOF
print_station_urls

echo
echo "Use: pm2 list"
echo "Use: pm2 logs"
