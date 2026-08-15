#!/bin/bash
# IZINET — Диагностика Hysteria2

echo "=========================================="
echo "  IZINET: Диагностика Hysteria2"
echo "=========================================="
echo ""

# 1. Установлен ли
echo "[1] Проверка установки:"
if command -v hysteria2 &>/dev/null; then
  echo "  ✅ Hysteria2 установлен: $(hysteria2 version 2>&1 | head -1)"
else
  echo "  ❌ Hysteria2 НЕ установлен"
  echo "  Решение: bash install_hysteria.sh"
  exit 1
fi
echo ""

# 2. Статус сервиса
echo "[2] Статус сервиса:"
if systemctl is-active hysteria2 &>/dev/null; then
  echo "  ✅ Сервис активен"
  systemctl status hysteria2 --no-pager | head -5
else
  echo "  ❌ Сервис не активен"
  systemctl status hysteria2 --no-pager 2>&1 | head -10
fi
echo ""

# 3. Логи
echo "[3] Последние логи (20 строк):"
journalctl -u hysteria2 --no-pager -n 20 2>/dev/null || echo "  Нет логов"
echo ""

# 4. Порт UDP 443
echo "[4] Порт UDP 443:"
if ss -ulnp 2>/dev/null | grep -q ":443 "; then
  echo "  ✅ UDP 443 слушает:"
  ss -ulnp | grep ":443 "
else
  echo "  ❌ UDP 443 не слушает"
  echo "  Возможные причины:"
  echo "    - Hysteria2 не запущен"
  echo "    - Порт занят другим сервисом"
fi
echo ""

# 5. UFW
echo "[5] Firewall (UFW):"
if command -v ufw &>/dev/null; then
  if ufw status 2>/dev/null | grep -q "443/udp"; then
    echo "  ✅ UDP 443 разрешен в UFW"
  else
    echo "  ⚠️ UDP 443 не разрешен в UFW"
    echo "  Решение: ufw allow 443/udp"
  fi
else
  echo "  ⚠️ UFW не установлен"
fi
echo ""

# 6. Конфиг
echo "[6] Конфиг (/etc/hysteria/config.yaml):"
if [ -f /etc/hysteria/config.yaml ]; then
  echo "  ✅ Конфиг существует"
  echo "  Пароль: $(grep 'password:' /etc/hysteria/config.yaml | awk '{print $2}' | head -1)"
  echo "  Порт: $(grep 'listen:' /etc/hysteria/config.yaml | awk '{print $2}')"
else
  echo "  ❌ Конфиг не найден"
fi
echo ""

# 7. Сертификат
echo "[7] Сертификат:"
if [ -f /etc/hysteria/cert.pem ] && [ -f /etc/hysteria/key.pem ]; then
  echo "  ✅ Сертификаты найдены"
  echo "  Истекает: $(openssl x509 -enddate -noout -in /etc/hysteria/cert.pem 2>/dev/null | cut -d= -f2)"
else
  echo "  ❌ Сертификаты не найдены"
fi
echo ""

# 8. Supabase
echo "[8] Пароль в Supabase:"
if [ -f /opt/izinet/.env ]; then
  source /opt/izinet/.env 2>/dev/null || true
fi
if [ -n "$VITE_SUPABASE_URL" ] && [ -n "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  RESULT=$(curl -s "${VITE_SUPABASE_URL}/rest/v1/settings?key=eq.HYSTERIA_PASSWORD&select=value" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" 2>&1)
  if echo "$RESULT" | grep -q "value"; then
    echo "  ✅ Пароль сохранен в Supabase"
  else
    echo "  ⚠️ Пароль не найден в Supabase"
    echo "  Решение: через админку или SQL"
  fi
else
  echo "  ⚠️ Supabase не настроен"
fi
echo ""

# 9. Тест подключения
echo "[9] Тест UDP подключения:"
if timeout 2 bash -c 'echo "" | nc -u -w1 127.0.0.1 443' 2>/dev/null; then
  echo "  ✅ UDP 443 отвечает на localhost"
else
  echo "  ⚠️ UDP 443 не отвечает (нормально для Hysteria2 на случайные данные)"
fi
echo ""

echo "=========================================="
echo "  ДИАГНОСТИКА ЗАВЕРШЕНА"
echo "=========================================="
