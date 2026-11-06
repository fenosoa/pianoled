#!/bin/sh
# Stops the control panel (npm run ui:run) and the LED service it supervises. Raspberry Pi.
# systemd unit if it is the one running, otherwise whatever listens on the control port.
PORT="${CONTROL_PORT:-8787}"
if systemctl is-active --quiet pianoled-control 2>/dev/null; then
  sudo systemctl stop pianoled-control && echo "pianoled-control stopped (systemd)"
elif command -v fuser >/dev/null 2>&1 && fuser "$PORT/tcp" >/dev/null 2>&1; then
  fuser -k -TERM "$PORT/tcp" >/dev/null 2>&1 && echo "control panel stopped (port $PORT)"
else
  echo "nothing listening on port $PORT"
fi
