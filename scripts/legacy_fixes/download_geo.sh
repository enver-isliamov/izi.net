#!/bin/bash
# IZINET — Download geosite.dat and geoip.dat for Xray routing
# Source: runetfreedom/russia-v2ray-rules-dat (updated every 6 hours)
# Run on host, files go to ./xray-assets/ which is mounted to /app/bin/ in container

set -e

ASSETS_DIR="$(dirname "$0")/xray-assets"
mkdir -p "$ASSETS_DIR"

echo "=== Downloading geo files ==="

# geoip.dat — IP categories (ru-blocked, ru, private, etc.)
echo "[1/2] Downloading geoip.dat..."
if curl -fL --retry 3 --retry-delay 5 \
  -o "$ASSETS_DIR/geoip.dat" \
  "https://github.com/runetfreedom/russia-v2ray-rules-dat/releases/latest/download/geoip.dat"; then
  echo "  ✅ geoip.dat downloaded ($(du -h "$ASSETS_DIR/geoip.dat" | cut -f1))"
else
  echo "  ❌ Failed to download geoip.dat"
fi

# geosite.dat — domain categories (ru-blocked, category-ads-all, google, etc.)
echo "[2/2] Downloading geosite.dat..."
if curl -fL --retry 3 --retry-delay 5 \
  -o "$ASSETS_DIR/geosite.dat" \
  "https://github.com/runetfreedom/russia-v2ray-rules-dat/releases/latest/download/geosite.dat"; then
  echo "  ✅ geosite.dat downloaded ($(du -h "$ASSETS_DIR/geosite.dat" | cut -f1))"
else
  echo "  ❌ Failed to download geosite.dat"
fi

echo ""
echo "=== Files in $ASSETS_DIR ==="
ls -lh "$ASSETS_DIR"/geo*.dat 2>/dev/null || echo "No geo files found"

echo ""
echo "Files will be available in x3-ui container at /app/bin/"
echo "Restart x3-ui to reload: docker restart x3-ui"
