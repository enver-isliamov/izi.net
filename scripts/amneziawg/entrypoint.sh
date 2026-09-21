#!/bin/sh
# Поднимает AmneziaWG-интерфейс внутри контейнера (userspace, без модуля ядра).
set -eu
IFACE="${AWG_IFACE:-awg0}"
CONF="/etc/amnezia/amneziawg/${IFACE}.conf"

if [ ! -f "$CONF" ]; then
  echo "[awg] нет $CONF — жду, пока приложение создаст конфигурацию"
  sleep 5
fi

# userspace-реализация поднимает интерфейс по конфигу
export AWG_QUICK_USERSPACE_IMPLEMENTATION=amneziawg-go
export WG_QUICK_USERSPACE_IMPLEMENTATION=amneziawg-go

if [ -f "$CONF" ]; then
  awg-quick up "$IFACE" || echo "[awg] первый запуск интерфейса не удался — продолжаю, повторю по сигналу"
fi

# переприменяем конфигурацию при каждом изменении файла (пиры добавляет приложение)
LAST=""
while true; do
  if [ -f "$CONF" ]; then
    CUR="$(md5sum "$CONF" | cut -d' ' -f1)"
    if [ "$CUR" != "$LAST" ]; then
      LAST="$CUR"
      if awg show "$IFACE" >/dev/null 2>&1; then
        awg-quick strip "$IFACE" >/dev/null 2>&1 || true
      fi
      awg-quick up "$IFACE" >/dev/null 2>&1 || true
    fi
  fi
  sleep 5
done
