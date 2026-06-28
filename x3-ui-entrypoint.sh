#!/bin/bash
# IZINET — Custom entrypoint for x3-ui
# Starts 3x-ui, waits for config generation, patches routing, then starts Xray

echo "[izinet] Starting 3x-ui with custom entrypoint..."

# Start 3x-ui in background
/usr/local/bin/x-ui &
XUI_PID=$!

# Wait for config.json to be generated
echo "[izinet] Waiting for config.json..."
for i in $(seq 1 30); do
    if [ -f /app/bin/config.json ]; then
        echo "[izinet] config.json found after ${i}s"
        break
    fi
    sleep 1
done

# Wait a bit more for 3x-ui to finish writing
sleep 3

# Patch routing rules
echo "[izinet] Patching routing rules..."
if [ -f /tmp/patch_xray_config.py ]; then
    python3 /tmp/patch_xray_config.py
fi

# Send USR1 to Xray to reload config
echo "[izinet] Reloading Xray..."
XRAY_PID=$(pgrep xray || true)
if [ -n "$XRAY_PID" ]; then
    kill -USR1 $XRAY_PID 2>/dev/null || true
    echo "[izinet] Xray reloaded (PID=$XRAY_PID)"
fi

# Keep 3x-ui running
wait $XUI_PID
