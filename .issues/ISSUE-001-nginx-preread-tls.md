# ISSUE-001: Nginx ssl_preread не обрабатывает фрагментированный TLS

**Статус:** Исправлено
**Дата:** 2026-11-12
**Серьёзность:** Критическая

## Описание
Nginx stream блок с ssl_preread on не мог прочитать SNI из фрагментированного TLS ClientHello.
Hiddify отправляет ClientHello кусками по 10-30 байт. Nginx с дефолтным буфером 4k
делал routing decision до получения полного ClientHello → трафик уходил в reality_backend вместо web_backend.

## Первопричина
preread_buffer_size не был задан (дефолт 4k слишком мал для накопления фрагментированного ClientHello).

## Исправление
Добавлено в stream server блок /etc/nginx/nginx.conf:
- preread_buffer_size 64k;
- proxy_socket_keepalive on;
- proxy_connect_timeout увеличен до 10s

## Верификация
- nginx -t: OK
- systemctl reload nginx: OK
- Фрагментированный TLS тест: сервер ответил TLS alert (успех)
- check-host.net результаты:
  - ru1 (AS14576, Москва): HTTP 200 за 175ms ✅
  - ru2 (AS210644, Aeza Group): Connection timed out ❌ (IP-level блокировка, не связана с nginx)
