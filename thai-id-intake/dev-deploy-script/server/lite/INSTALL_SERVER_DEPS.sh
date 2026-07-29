#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/server.env"
SOURCE_DIR="$SCRIPT_DIR/thai-id-intake"
KAFKA_VERSION="4.3.1"
KAFKA_SCALA_VERSION="2.13"
KAFKA_NAME="kafka_${KAFKA_SCALA_VERSION}-${KAFKA_VERSION}"
KAFKA_DIR="$SCRIPT_DIR/$KAFKA_NAME"
KAFKA_ARCHIVE="$SCRIPT_DIR/.cache/$KAFKA_NAME.tgz"
KAFKA_URL="https://archive.apache.org/dist/kafka/$KAFKA_VERSION/$KAFKA_NAME.tgz"
RUNTIME_DIR="$SCRIPT_DIR"
STAGE_DIR=""

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

detect_ip() {
  hostname -I | awk '{print $1}'
}

cleanup() {
  if [ -n "$STAGE_DIR" ] && [ -d "$STAGE_DIR" ]; then
    rm -rf "$STAGE_DIR"
  fi
}

download_kafka() {
  mkdir -p "$(dirname "$KAFKA_ARCHIVE")"

  if [ -f "$KAFKA_ARCHIVE" ]; then
    echo "Reusing cached Kafka archive: $KAFKA_ARCHIVE"
    return
  fi

  local archive_part="$KAFKA_ARCHIVE.part"
  rm -f "$archive_part"
  echo "Downloading Kafka $KAFKA_VERSION"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --retry 3 --output "$archive_part" "$KAFKA_URL"
  else
    wget --tries=3 --output-document="$archive_part" "$KAFKA_URL"
  fi
  mv "$archive_part" "$KAFKA_ARCHIVE"
}

install_kafka() {
  if [ -e "$KAFKA_DIR" ]; then
    if [ -f "$KAFKA_DIR/bin/kafka-server-start.sh" ]; then
      echo "Kafka already installed: $KAFKA_DIR"
      return
    fi
    echo "Kafka folder exists but is incomplete: $KAFKA_DIR" >&2
    echo "Fix or remove it manually, then rerun this installer." >&2
    exit 1
  fi

  download_kafka
  local extract_dir
  extract_dir="$(mktemp -d "${TMPDIR:-/tmp}/thai-id-kafka.XXXXXX")"
  trap 'rm -rf "$extract_dir"; cleanup' EXIT
  tar -xzf "$KAFKA_ARCHIVE" -C "$extract_dir"

  if [ ! -f "$extract_dir/$KAFKA_NAME/bin/kafka-server-start.sh" ]; then
    echo "Kafka archive did not contain the expected server files." >&2
    exit 1
  fi

  mv "$extract_dir/$KAFKA_NAME" "$KAFKA_DIR"
  rm -rf "$extract_dir"
  echo "Installed Kafka: $KAFKA_DIR"
}

build_workspace() {
  if [ ! -f "$SOURCE_DIR/package.json" ] || [ ! -f "$SOURCE_DIR/package-lock.json" ]; then
    echo "Workspace source is incomplete: $SOURCE_DIR" >&2
    exit 1
  fi

  pushd "$SOURCE_DIR" >/dev/null
  npm ci \
    --include-workspace-root \
    --workspace @thai-id-intake/shared-types \
    --workspace @thai-id-intake/backend \
    --workspace @thai-id-intake/nurse-webapp \
    --workspace @thai-id-intake/station-display

  npm run build -w @thai-id-intake/shared-types
  npm run build -w @thai-id-intake/backend

  unset VITE_BACKEND_URL VITE_STATION_ID VITE_NURSE_ID
  VITE_RESULT_AUTO_CLEAR_SECONDS="${RESULT_AUTO_CLEAR_SECONDS:-120}" \
    npm run build -w @thai-id-intake/nurse-webapp
  npm run build -w @thai-id-intake/station-display
  popd >/dev/null
}

stage_runtime() {
  STAGE_DIR="$(mktemp -d "$SCRIPT_DIR/.runtime-stage.XXXXXX")"
  mkdir -p \
    "$STAGE_DIR/backend/apps/backend" \
    "$STAGE_DIR/nurse-webapp" \
    "$STAGE_DIR/station-display"

  cp -a "$SOURCE_DIR/apps/backend/dist" "$STAGE_DIR/backend/apps/backend/dist"
  cp -a "$SOURCE_DIR/apps/backend/package.json" "$STAGE_DIR/backend/apps/backend/package.json"
  cp -aL "$SOURCE_DIR/node_modules" "$STAGE_DIR/backend/node_modules"
  cp -a "$SOURCE_DIR/apps/nurse-webapp/dist/." "$STAGE_DIR/nurse-webapp/"
  cp -a "$SOURCE_DIR/apps/station-display/dist/." "$STAGE_DIR/station-display/"

  rm -rf "$RUNTIME_DIR/backend" "$RUNTIME_DIR/nurse-webapp" "$RUNTIME_DIR/station-display"
  mv "$STAGE_DIR/backend" "$RUNTIME_DIR/backend"
  mv "$STAGE_DIR/nurse-webapp" "$RUNTIME_DIR/nurse-webapp"
  mv "$STAGE_DIR/station-display" "$RUNTIME_DIR/station-display"
  rm -rf "$STAGE_DIR"
  STAGE_DIR=""
}

require_command bash
require_command tar
require_command java
require_command node
require_command npm
require_command python3
require_command pm2
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  echo "Missing command: curl or wget" >&2
  exit 1
fi

SERVER_IP="${SERVER_IP:-auto}"
if [ "$SERVER_IP" = "auto" ]; then
  SERVER_IP="$(detect_ip)"
fi
if [ -z "$SERVER_IP" ]; then
  echo "Could not resolve SERVER_IP. Set it explicitly in server.env." >&2
  exit 1
fi

echo "Preparing lite deployment for server IP: $SERVER_IP"
trap cleanup EXIT
install_kafka
build_workspace
stage_runtime

echo "Installation complete. Start services with: bash START_SERVER_PM2.sh"
