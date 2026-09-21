#!/usr/bin/env bash
# inbound_healthcheck.sh — автопроверка живости инбаундов и контейнеров. Только чтение.
# Установка на сервере (VM-846997):
#   install -m 755 inbound_healthcheck.sh /usr/local/bin/inbound_healthcheck.sh
#   printf '*/10 * * * * root /usr/local/bin/inbound_healthcheck.sh >/dev/null 2>&1\n' > /etc/cron.d/inbound-health
# Лог: /var/log/inbound_health.log (строки с FAIL = сигнал сбоя)
set -u
LOG=/var/log/inbound_health.log
STAMP=$(date '+%Y-%m-%d %H:%M:%S')

chk_tcp() { timeout 3 bash -c "echo > /dev/tcp/127.0.0.1/$1" 2>/dev/null && echo OK || echo FAIL; }
chk_tls() { echo | timeout 5 openssl s_client -connect 127.0.0.1:$1 -servername "$2" 2>/dev/null | grep -q 'BEGIN CERTIFICATE' && echo OK || echo FAIL; }
chk_proc() { docker exec x3-ui sh -c 'ps | grep -v grep | grep -q xray' 2>/dev/null && echo OK || echo FAIL; }

XRAY=$(chk_proc)
# Публикуемые инбаунды (порты хоста): 443 Reality, 2443, 22053, 2022 (gRPC), 2087/2088 xhttp
PORTS="443 2443 22053 2022 2087 2088"
LINE="xray_proc=$XRAY"
for p in $PORTS; do
  LINE="$LINE port${p}_tcp=$(chk_tcp "$p")"
done
# TLS-контроль на основном канале (443) и одном из резервных (2443)
LINE="$LINE tls443=$(chk_tls 443 www.cloudflare.com) tls2443=$(chk_tls 2443 www.microsoft.com)"
C1=$(docker inspect -f '{{.State.Status}}' x3-ui 2>/dev/null || echo absent)
C2=$(docker inspect -f '{{.State.Status}}' izinet-app 2>/dev/null || echo absent)
LINE="$LINE containers=x3-ui:$C1,izinet-app:$C2"

echo "$STAMP $LINE" >> "$LOG"
case "$LINE" in
  *FAIL*) echo "$STAMP ATTENTION: сбой проверки — $LINE" >> "$LOG" ;;
esac
echo "$LINE"
