# ISSUE-002: VPN и сайт недоступны из России (Крым, МТС)

**Статус:** Исправление развернуто, верификация
**Дата:** 2026-11-14
**Серьёзность:** Критическая

## Описание
Пользователь в Крыму (МТС/Infostroy LLC, ASN 208397) не мог:
1. Открыть сайт izinet.online без VPN
2. Обновить подписку в Hiddify (timeout)
3. Подключиться к VPN через VLESS/WS/Reality (timeout)

## Диагностика и первопричины
1. **L4 уровень (IP и порты)**:
   - Прямой TCP handshake на порты 443 и 2022 (gRPC) проходит успешно со всех нод РФ (`ru1`: 38.8ms, `ru2`: 42.7ms).
   - IP `89.125.17.44` не заблокирован по BGP/L4.
2. **L7 / DPI блокировка сайта**:
   - ТСПУ сбрасывает прямое TLS-соединение при указании SNI `izinet.online` к пулу зарубежного хостинга HOSTKEY.
   - Решение: включение Cloudflare Proxy (оранжевые облака) для веб-сайта.
3. **Блокировка Reality VPN**:
   - В конфигурации Reality был задан SNI `gateway.icloud.com` (Apple Private Relay).
   - В РФ ТСПУ прицельно блокирует ClientHello с `gateway.icloud.com`, если IP не принадлежит Apple/Akamai.
   - Решение: замена SNI на `dl.google.com` (Google CDN / Play Store / Chrome updates), проверен с российских нод (`ru1`, `ru2`), поддерживает TLS 1.3 и h2.
4. **Hysteria2 UDP фильтрация**:
   - В подписке отдавался порт 24433, который отсекается сотовыми вышками и мобильными провайдерами РФ как нераспознанный UDP.
   - Решение: выдача ссылки на порт UDP 443 (стандартный QUIC/HTTP3).

## Примененные исправления
- [x] Nginx stream `preread_buffer_size 64k` + `proxy_socket_keepalive on` (ISSUE-001)
- [x] Замена Reality SNI и fallback target с `gateway.icloud.com` на `dl.google.com` в:
  - `server/src/routes/config.ts`
  - `server/src/services/xui.service.ts`
  - `server/src/scripts/fix_reality_inbound.py`
  - Базе данных 3x-ui на сервере
- [x] Обновление ссылок Hysteria2 в подписке на порт UDP 443
- [x] Редизайн карточек устройств и дашборда под стиль OxyVPN (`src/pages/Dashboard.tsx`)

## Верификация
- Тест генерации ссылок подписки: ссылки отдаются с `sni=dl.google.com`.
- Перезапуск сервисов на VPS и тест доступности.
