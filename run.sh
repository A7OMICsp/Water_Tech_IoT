#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="$PROJECT_DIR/dashboard"
DASHBOARD_PORT="${DASHBOARD_PORT:-8000}"
NODE_RED_PORT="${NODE_RED_PORT:-1880}"

PIDS=()
CLEANED_UP=0

cleanup() {
  if [ "$CLEANED_UP" -eq 1 ]; then
    return
  fi
  CLEANED_UP=1

  echo
  echo "Deteniendo servicios..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

is_port_busy() {
  local port="$1"
  lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

trap cleanup EXIT INT TERM

echo "Sistema IoT Agua"
echo "Proyecto: $PROJECT_DIR"
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 no está instalado o no está en PATH."
  exit 1
fi

if is_port_busy "$DASHBOARD_PORT"; then
  echo "Dashboard: el puerto $DASHBOARD_PORT ya está en uso."
  echo "Usa otro puerto con: DASHBOARD_PORT=8001 ./run.sh"
else
  echo "Arrancando dashboard en http://localhost:$DASHBOARD_PORT"
  (cd "$DASHBOARD_DIR" && python3 -m http.server "$DASHBOARD_PORT") >/tmp/iot_dashboard.log 2>&1 &
  PIDS+=("$!")
fi

echo
if command -v npx node-red >/dev/null 2>&1; then
  if is_port_busy "$NODE_RED_PORT"; then
    echo "Node-RED: el puerto $NODE_RED_PORT ya está en uso."
    echo "Usa otro puerto con: NODE_RED_PORT=1881 ./run.sh"
  else
    echo "Arrancando Node-RED en http://localhost:$NODE_RED_PORT"
    echo "Flujo: $PROJECT_DIR/node_red_flow.json"
    npx node-red --port "$NODE_RED_PORT" "$PROJECT_DIR/node_red_flow.json" >/tmp/iot_node_red.log 2>&1 &
    PIDS+=("$!")
  fi
else
  echo "Node-RED no está instalado. Si lo necesitas:"
  echo "  npm install -g node-red"
  echo "Luego vuelve a ejecutar:"
  echo "  ./run.sh"
fi

echo
echo "MQTT: el proyecto usa broker.hivemq.com, no hace falta arrancar broker local."
echo "ESP32: el firmware se sube desde Arduino IDE; este script no flashea la placa."
echo
echo "Logs:"
echo "  Dashboard: /tmp/iot_dashboard.log"
echo "  Node-RED:  /tmp/iot_node_red.log"
echo
echo "Pulsa Ctrl+C para detener los servicios arrancados por este script."

if [ "${#PIDS[@]}" -eq 0 ]; then
  echo
  echo "No se arrancó ningún servicio."
  exit 1
fi

wait
