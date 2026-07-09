#!/bin/bash
echo "=== Диагностика Hysteria2 ==="

echo "[1] Статус сервиса:"
systemctl status hysteria2 --no-pager | head -10

echo ""
echo "[2] Последние логи:"
journalctl -u hysteria2 --no-pager -n 20

echo ""
echo "[3] Порт UDP 443:"
ss -ulnp | grep 443

echo ""
echo "[4] UFW UDP:"
ufw status | grep -i udp

echo ""
echo "[5] Конфиг:"
cat /etc/hysteria/config.yaml

echo ""
echo "[6] Тест UDP с localhost:"
timeout 3 bash -c 'echo "test" | nc -u -w1 127.0.0.1 443' 2>&1 || echo "  UDP test completed (no response expected for non-Hysteria2 data)"
