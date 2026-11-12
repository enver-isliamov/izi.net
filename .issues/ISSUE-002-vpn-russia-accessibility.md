# ISSUE-002: VPN и сайт недоступны из России (Крым, МТС)

**Статус:** В работе
**Дата:** 2026-11-12
**Серьёзность:** Критическая

## Описание
Пользователь в Крыму (МТС/Infostroy LLC, ASN 208397) не может:
1. Открыть сайт izinet.online без VPN
2. Обновить подписку в Hiddify (timeout)
3. Подключиться к VPN через VLESS/WS/Reality (timeout)

## Диагностика
- check-host.net ru1 (AS14576, Москва): HTTP 200 за 172ms ✅
- check-host.net ru2 (AS210644, Aeza Group): Connection timeout ❌
- Сервер сам по себе работает корректно (curl localhost возвращает 200)
- Проблема: ISP-level TSPU фильтрация трафика к 89.125.17.44

## Текущий прогресс
- [x] Исправлен Nginx preread буфер (ISSUE-001)
- [x] Добавлен прямой IP узел в подписку (izinet_WS_Direct_IP)  
- [ ] Cloudflare CDN не включён (серые облака в DNS)
- [ ] Hysteria2 на порту 24433 — потенциальный обходной путь

## Следующие шаги
1. Включить Cloudflare CDN (оранжевые облака) для izinet.online и vpn.izinet.online
2. Настроить WebSocket через Cloudflare
3. Тестировать Hysteria2 как fallback
