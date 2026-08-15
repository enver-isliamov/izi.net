#!/bin/bash
# 🔨 СКРИПТ ДЛЯ ИСПРАВЛЕНИЯ КОДА РЕПОЗИТОРИЯ

set -e

cd /opt/izinet || exit 1

echo "════════════════════════════════════════════════════════════════"
echo "🔨 ИСПРАВЛЕНИЕ БАГОВ В КОДЕ"
echo "════════════════════════════════════════════════════════════════"
echo ""

# === FIX A: ReferenceError isIPOrEmpty ===
echo "[Fix A] Проверка: ReferenceError в xui.service.ts..."

if grep -q "isIPOrEmpty" server/src/services/xui.service.ts 2>/dev/null; then
    echo "  ⚠️  Найден баг!"
    echo "  Исправляю..."
    
    # Создаём правильный код
    OLDCODE='const sni = tlsSettings.serverName || (isIPOrEmpty ? "" : hostName);'
    NEWCODE='const isIpAddr = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostName);
    const sni = tlsSettings.serverName || (isIpAddr ? "" : hostName);'
    
    if [ -f "server/src/services/xui.service.ts" ]; then
        sed -i "s|${OLDCODE}|${NEWCODE}|g" server/src/services/xui.service.ts
        echo "  ✅ Исправлено"
    fi
else
    echo "  ✅ Баг не найден (уже исправлен или версия другая)"
fi

echo ""
echo "[Fix B] Проверка: отсутствующие переменные в коде..."

if grep -r "isIPOrEmpty\|is_ip_empty" server/src --include="*.ts" | grep -v "isIpAddr"; then
    echo "  ⚠️  Найдены другие проблемы с переменными"
    echo "  Требуется ручной дебаг"
else
    echo "  ✅ OK"
fi

echo ""
echo "[Fix C] Проверка: скидочные множители на цены..."

if grep -q "0.95\|0.85\|0.75" server/src/routes/user.ts; then
    echo "  ⚠️  Найдены проблемные множители в ценах"
    echo "  Это означает что цены это float вместо integer"
    echo "  ТРЕБУЕТСЯ РУЧНОЕ ИСПРАВЛЕНИЕ:"
    echo ""
    grep -n "0.95\|0.85\|0.75" server/src/routes/user.ts
    echo ""
    echo "  Замени эти строки на Math.round() вариант"
else
    echo "  ✅ Цены выглядят OK"
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "✅ ПРОВЕРКА КОДА ЗАВЕРШЕНА"
echo "════════════════════════════════════════════════════════════════"

