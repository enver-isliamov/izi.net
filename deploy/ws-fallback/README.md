# IZINET VLESS WebSocket Fallback

Резервный VLESS WebSocket канал для клиентов, чьи провайдеры в РФ блокируют прямой IP сервера (`89.125.17.44`).

## Архитектура
1. Клиент подключается к `izinet.online:443` (Cloudflare CDN с включенным Orange Cloud).
2. Cloudflare перенаправляет HTTPS-запрос с заголовками WebSocket на хост Nginx.
3. Nginx (`/etc/nginx/sites-available/izinet`) через `location /izinet-ws` проксирует соединение на локальный Xray WS (`127.0.0.1:8080`).
4. Клиент получает защищённый туннель с внешним выходом через VPS.

## Установка
```bash
sudo cp deploy/ws-fallback/izinet-ws.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now izinet-ws
```
