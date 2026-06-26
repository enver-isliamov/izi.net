# План исправления VPN для Hiddify

Дата ревизии: 2026-06-27  
Репозиторий: `izi.net-main`  
Цель: после исправлений пользователь обновляет подписку в Hiddify и получает рабочие VLESS Reality-ноды без таймаутов при использовании из РФ.

## Короткий вывод

Hiddify пишет timeout не обязательно из-за одной причины. В текущем репозитории есть несколько точек, где можно выдать пользователю формально валидную подписку, но фактически нерабочий VPN:

- в `subscriptions.v2ray_config` могут лежать старые или неполные VLESS Reality-ссылки;
- backend использует один глобальный `XUI_INBOUND_ID` для всех VPN-серверов;
- админка не хранит отдельные поля `panel_url`, `panel_path`, `public_host`, `inbound_id`, поэтому легко смешать URL панели 3x-ui и публичный host для VPN;
- продление подписки может обновить базу и списать баланс даже если `updateClient()` в 3x-ui вернул `false`;
- нет endpoint-а, который проверяет подписку глазами Hiddify: скачать `/api/sub/:id`, декодировать base64, проверить Reality-параметры и сверить клиента с 3x-ui;
- настройки Reality/fallback/DNS/Cloudflare для РФ не проверяются автоматически.

Главный рабочий путь: сначала сделать диагностику и регенерацию подписок, потом привести модель серверов к явным полям, затем мигрировать существующих пользователей и только после этого просить их обновить подписку в Hiddify.

## Текущий путь данных

1. Пользователь покупает или продлевает тариф в `POST /api/subscription/buy` (`server.ts`).
2. Backend выбирает `serverId`, создает или обновляет клиента в 3x-ui через `XUIService`.
3. Backend сохраняет ссылки в `subscriptions.v2ray_config`.
4. Личный кабинет показывает пользователю subscription URL через `/api/sub-url/:id`.
5. Hiddify скачивает `/api/sub/:id`.
6. `/api/sub/:id` берет `v2ray_config`, фильтрует `vless://`, кодирует список в base64 и отдает Hiddify.
7. Hiddify подключается к host/port из VLESS-ссылки и использует Reality-параметры `sni`, `pbk`, `sid`, `fp`, `flow`.

Если любой пункт 2, 3, 6 или 7 неверный, пользователь видит timeout.

## P0. Диагностика подписки как ее видит Hiddify

### BUG-HID-01: нет проверки фактического содержимого `/api/sub/:id`

**Как проявляется**

- Hiddify принимает ссылку подписки, но при подключении пишет timeout.
- В личном кабинете подписка выглядит активной.
- Админка может показывать сервер активным, но это не доказывает, что конкретный VLESS-ключ рабочий.

**Где в коде**

- `/api/sub/:id`: `server.ts:1556-1620`
- генерация Reality-ссылки: `server.ts:388-459`
- сохранение `v2ray_config`: `server.ts:2219-2229`, `server.ts:2268-2305`

**Причина**

Сейчас нет системной проверки: `subscription_id -> base64 decode -> vless links -> Reality params -> matching client in 3x-ui -> TCP reachability`.

**Путь решения**

1. Добавить admin endpoint `GET /api/admin/subscriptions/:id/diagnose-hiddify`.
2. Endpoint должен:
   - прочитать `subscriptions.v2ray_config`;
   - распарсить JSON/legacy формат через общую функцию;
   - собрать ровно тот текст, который получает Hiddify из `/api/sub/:id`;
   - декодировать base64 и проверить каждую строку;
   - проверить наличие `vless://`;
   - проверить обязательные Reality-параметры: `security=reality`, `type=tcp`, `sni`, `pbk`, `fp`, `sid`, `flow=xtls-rprx-vision`;
   - проверить `host` и `port`;
   - найти клиента в 3x-ui по email/uuid;
   - проверить expiryTime, enable, totalGB;
   - вернуть JSON с `ok`, `warnings`, `errors`, `links`.
3. Добавить кнопку диагностики в админке пользователя или сервера.

**Ожидаемый результат**

Админ видит точную причину timeout: пустая подписка, старый host, неверный inbound, нет клиента в 3x-ui, истекший expiry, неправильный Reality publicKey, DNS/порт недоступен.

## P0. Регенерация уже выданных подписок

### BUG-HID-02: пользователи могут хранить старые VLESS-ссылки

**Как проявляется**

- Новые пользователи могут работать, старые получают timeout.
- После правки серверных настроек Hiddify продолжает использовать старые параметры.
- Пользователь обновляет подписку, но в ней остается старый host/pbk/sid/sni.

**Где в коде**

- `v2ray_config` сохраняется как JSON устройств или legacy string.
- `/api/sub/:id` просто отдает сохраненную ссылку, не пересобирая ее из текущего inbound.
- Старый скрипт `fix_hiddify_links.ts` есть, но он работает только с env-сервером и legacy-форматом, не с multi-server.

**Причина**

VLESS Reality-ссылка сохраняется как статический текст. Если изменились `public_host`, `inbound`, Reality keys, порт, SNI или сервер подписки, старый `v2ray_config` не обновится сам.

**Путь решения**

1. Сделать безопасный endpoint `POST /api/admin/subscriptions/:id/regenerate-config`.
2. Для каждой device-записи:
   - найти фактический server через `server_id`;
   - найти клиента в 3x-ui по `uuid` или `email`;
   - не создавать нового клиента, если существующий найден;
   - получить текущий inbound через `getInboundLink()`;
   - заменить только `device.config`;
   - сохранить JSON обратно в `v2ray_config`.
3. Сделать batch endpoint `POST /api/admin/subscriptions/regenerate-all`.
4. Перед batch:
   - сделать backup таблицы `subscriptions`;
   - обработку вести батчами по 10-20 подписок;
   - писать `regeneration_status`, `last_error`, `updated_count`.
5. После batch пользователю достаточно обновить подписку в Hiddify.

**Ожидаемый результат**

Все активные пользователи получают актуальные VLESS Reality-ссылки. Hiddify после обновления профиля начинает подключаться к актуальным host/port/SNI/pbk/sid.

## P0. Глобальный inbound ID ломает multi-server

### BUG-HID-03: `XUI_INBOUND_ID` используется для всех серверов

**Как проявляется**

- Один сервер работает, второй таймаутит.
- Пользователь покупает тариф на OneD/другой сервер, но клиент создается не в том inbound или не создается вообще.
- `/api/admin/servers/:id/check` может быть OK, но покупка VPN на этом сервере не работает.

**Где в коде**

- `const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1')`: `server.ts:2200`, `server.ts:2431`
- при миграции серверов inbound ищется по порту, но при покупке нет per-server inbound.

**Причина**

У каждого 3x-ui сервера inbound ID может отличаться. Глобальная env-переменная подходит только для одного сервера.

**Путь решения**

1. Добавить в `vpn_servers` поля:
   - `panel_url text not null`
   - `panel_path text`
   - `public_host text not null`
   - `inbound_id integer not null`
   - `vpn_port integer`
   - `reality_sni text`
   - `xui_request_timeout_ms integer default 15000`
2. В админке серверов добавить обязательное поле `Inbound ID`.
3. В `getXuiForServer()` возвращать `server.inbound_id`.
4. В `POST /api/subscription/buy`, renew, delete, sync использовать inbound конкретного сервера.
5. Добавить fallback: если `inbound_id` пустой, искать первый enabled `vless` inbound с `security=reality`, но сохранять найденный ID в БД.

**Ожидаемый результат**

Каждый сервер создает и обновляет клиентов в своем inbound. Покупка, продление и регенерация не зависят от одной глобальной переменной.

## P0. Продление может пройти, даже если 3x-ui не обновился

### BUG-HID-04: `updateClient()` возвращает `false`, но покупка продолжается

**Как проявляется**

- Пользователь оплатил продление.
- В кабинете дата подписки новая.
- В 3x-ui expiryTime остался старым или клиент выключен.
- Hiddify после обновления подписки все равно timeout или expired.

**Где в коде**

- `updateClient()` возвращает boolean: `server.ts:503-588`
- результат не проверяется: `server.ts:2250-2251`
- база обновляется и баланс списывается после этого: `server.ts:2268-2323`

**Причина**

Контракт `updateClient()` не является обязательным для бизнес-операции. Ошибка 3x-ui логируется, но не блокирует успешный ответ API.

**Путь решения**

1. После `await xuiInstance.updateClient(...)` проверять результат.
2. Если `false`, пробовать восстановление:
   - найти клиента по uuid/email во всех inbounds сервера;
   - если найден, обновить фактический inbound;
   - если не найден, создать клиента заново с тем же uuid/email;
   - после создания получить новый `getInboundLink()`.
3. Если восстановить не удалось, не обновлять `subscriptions`, не списывать баланс, вернуть `503` с кодом `XUI_SYNC_FAILED`.
4. Ввести статус provisioning: `pending`, `synced`, `failed`.

**Ожидаемый результат**

Пользователь не получает ложный успех. Если кабинет показал активную подписку, клиент в 3x-ui точно обновлен.

## P0. Смешаны URL панели и публичный VPN host

### BUG-HID-05: поле `domain` используется двусмысленно

**Как проявляется**

- В админке введен домен, но backend ходит в панель по IP.
- В VLESS-ссылке может появиться IP вместо домена или наоборот.
- Если домен в Cloudflare Proxied, Hiddify получает timeout.
- Если в `domain` записан secret path панели, он не является публичным VPN host.

**Где в коде**

- форма админки: `src/pages/Admin/Servers.tsx:187-209`
- сборка host: `server.ts:747-785`
- генерация host в VLESS: `server.ts:424-447`

**Причина**

Одно поле `domain` пытается означать и публичный host для VLESS, и path панели 3x-ui.

**Путь решения**

1. Разделить поля:
   - `panel_url`: полный URL панели, например `http://1.2.3.4:2053/secret`;
   - `public_host`: host в VLESS, например `node1.example.com`;
   - `panel_path`: вычисляемое или отдельное поле, если нужно;
   - `domain` оставить как legacy alias только на время миграции.
2. В админке заменить подписи:
   - "URL панели 3x-ui"
   - "Публичный host VPN"
   - "Inbound ID"
3. Добавить валидацию:
   - `public_host` не должен начинаться с `http://` или `https://`;
   - `panel_url` обязан иметь схему `http://` или `https://`;
   - если `public_host` домен под Cloudflare, показать предупреждение "DNS Only".

**Ожидаемый результат**

Backend стабильно управляет 3x-ui по panel URL, а Hiddify получает стабильный публичный host для подключения.

## P0. Reality/fallback/DNS/Cloudflare не проверяются

### BUG-HID-06: сервер может быть OK для панели, но не OK для Hiddify

**Как проявляется**

- `/api/admin/servers/:id/check` успешен.
- Hiddify timeout.
- Сайт может открываться, но VPN не подключается или наоборот.

**Где в коде**

- check endpoint проверяет login и inbounds: `server.ts:1340-1355`
- он не проверяет публичный TCP порт, Reality handshake, DNS, Cloudflare mode, fallback.

**Причина**

Проверка 3x-ui панели не равна проверке VPN-ноды. Для Hiddify важно, чтобы был доступен публичный `host:port`, совпадали Reality params и не было Cloudflare proxy между клиентом и Reality.

**Путь решения**

1. Расширить `/api/admin/servers/:id/check`:
   - показать `panel_url`;
   - показать `public_host`;
   - показать inbound id, port, protocol, security;
   - показать `realitySettings.serverNames`, `publicKey`, `shortIds`, `spiderX`, `dest`;
   - сделать TCP connect к `public_host:vpn_port` с backend;
   - проверить DNS A/AAAA записи;
   - предупредить, если `public_host` указывает на Cloudflare IP ranges или proxy.
2. Добавить отдельный "Hiddify node check":
   - сгенерировать тестовый VLESS link;
   - проверить, что в нем нет пустого `pbk`, `sid`, `sni`;
   - проверить, что port совпадает с inbound.port.
3. В документации запретить Cloudflare Proxied для Reality host. Нужен DNS Only.

**Ожидаемый результат**

Админка показывает не просто "XUI OK", а "Hiddify-ready OK". Сервер не попадает в выдачу пользователям, пока Reality-нода не проходит проверку.

## P1. `/api/sub/:id` не умеет самовосстанавливаться

### BUG-HID-07: подписка отдает то, что сохранено, даже если это уже невалидно

**Как проявляется**

- В БД лежит битая ссылка.
- Hiddify всегда получает ту же битую ссылку.
- Пользователь обновляет подписку, но ничего не меняется.

**Где в коде**

- `/api/sub/:id`: `server.ts:1556-1620`

**Причина**

Endpoint не делает validation или lazy regeneration.

**Путь решения**

1. Вынести функцию `buildSubscriptionPayload(sub)`:
   - возвращает decoded links, base64, warnings.
2. Если нет валидных ссылок, возвращать не пустую строку `200`, а понятную ошибку для диагностики:
   - для Hiddify можно оставить `200` с пустым телом, но логировать structured error;
   - для browser/admin добавить JSON endpoint диагностики.
3. Добавить lazy-heal для активной подписки:
   - если `v2ray_config` пустой или не содержит Reality params, запустить regeneration;
   - если regeneration успешен, отдать уже исправленную подписку.

**Ожидаемый результат**

Обновление подписки в Hiddify реально приносит новые ключи, а не бесконечно отдает старую ошибку.

## P1. Некорректная синхронизация при ручном изменении подписки

### BUG-HID-08: Realtime update использует неправильный email клиента

**Как проявляется**

- Админ вручную меняет `expires_at` или лимит.
- В БД дата меняется.
- 3x-ui обновляется не тот клиент или обновление падает.
- Hiddify продолжает видеть timeout/expired.

**Где в коде**

- Realtime listener: `server.ts:2415-2440`
- он строит `vpnEmail = user_${newData.user_id.slice(0, 8)}`, хотя реальные email устройств создаются как `user_${slice}_${randomSuffix}`.

**Причина**

Фактический email клиента хранится в `VpnDevice.email`, но listener его игнорирует.

**Путь решения**

1. В Realtime listener распарсить `newData.v2ray_config` через `parseVpnDevices()`.
2. Обновлять каждый `device.email` и `device.uuid`.
3. Использовать per-server inbound id.
4. Если обновление не удалось, писать `subscriptions.sync_error`.

**Ожидаемый результат**

Ручные правки в админке больше не ломают связь БД и 3x-ui.

## P1. Нет нормальной миграции legacy `v2ray_config`

### BUG-HID-09: legacy string и JSON devices живут одновременно

**Как проявляется**

- Одни пользователи получают одну ссылку, другие несколько.
- Скрипты починки работают только с одним форматом.
- После sync traffic `v2ray_config` может быть перезаписан в JSON, но старые данные парсятся не полностью.

**Где в коде**

- `parseVpnDevices()`: `server.ts:85-110`
- `/api/sub/:id`: `server.ts:1581-1599`
- `fix_hiddify_links.ts` работает с legacy regex.

**Причина**

Нет одноразовой миграции к единому формату.

**Путь решения**

1. Создать `migrate_v2ray_config_devices.ts`.
2. Для каждой активной подписки:
   - если legacy string, превратить в массив `VpnDevice`;
   - заполнить `id`, `email`, `uuid`, `config`, `expiresAt`, `serverType`;
   - если email неизвестен, найти клиента в 3x-ui по uuid;
   - сохранить JSON.
3. После миграции запретить запись legacy string.

**Ожидаемый результат**

Все операции работают с единым форматом, а регенерация и диагностика становятся надежными.

## P1. Выбор сервера не учитывает рабочее состояние Hiddify

### BUG-HID-10: новый пользователь может попасть на сервер, где XUI login OK, но VPN-порт не работает

**Как проявляется**

- Пользователь покупает подписку, получает сервер с минимальной нагрузкой.
- Hiddify timeout, потому что сервер был активен в БД, но не готов как VPN-нода.

**Где в коде**

- выбор сервера: `server.ts:2172-2195`
- `/api/locations` отдает все `is_active=true`: `server.ts:2032-2044`

**Причина**

`is_active` означает "показывать сервер", но не означает "прошел Hiddify-ready диагностику".

**Путь решения**

1. Добавить поля:
   - `health_status`: `unknown`, `ok`, `degraded`, `down`;
   - `last_health_check_at`;
   - `last_hiddify_check_error`.
2. `/api/locations` должен отдавать только `is_active=true AND health_status='ok'`.
3. `POST /api/subscription/buy` должен выбирать только healthy servers.
4. Если healthy серверов нет, покупка должна возвращать `503`, не списывать баланс.

**Ожидаемый результат**

Новые пользователи не получают заведомо нерабочие ноды.

## P1. PUBLIC_URL и subscription URL могут быть нестабильны

### BUG-HID-11: Hiddify может получать ссылку на неправильный backend

**Как проявляется**

- В кабинете скопирована ссылка на preview/локальный/старый домен.
- Hiddify не может обновить подписку или получает старый backend.

**Где в коде**

- `/api/sub-url/:id`: `server.ts:1543-1553`
- Dashboard fallback: `src/pages/Dashboard.tsx:85-106`
- warning при старте: `server.ts:2954-2957`

**Причина**

Если `PUBLIC_URL` не задан, URL строится из request host. При Vercel proxy, preview domains и прямом IP это может быть нестабильно.

**Путь решения**

1. В production сделать `PUBLIC_URL` обязательным.
2. Если `PUBLIC_URL` пустой в production, backend должен не только warning писать, а отдавать health status `degraded`.
3. Dashboard должен показывать ошибку "PUBLIC_URL не настроен" админам.
4. Hiddify subscription URL должен быть один канонический домен.

**Ожидаемый результат**

Пользователь всегда копирует один стабильный subscription URL. Обновление профиля Hiddify не зависит от preview-домена или IP.

## P2. Недостаточная операционная безопасность deploy

### BUG-HID-12: исправление backend может случайно дернуть VPN-инфраструктуру

**Как проявляется**

- После deploy backend пользователи получают временные отваливания.
- Полный `docker compose up -d --build` может пересоздать сервисы не только приложения.

**Где в коде**

- `docker-compose.yml`
- старые repair scripts из working snapshot напрямую меняют 3x-ui SQLite и рестартуют compose.

**Причина**

Нет четкого runbook-а "backend-only deploy" и "VPN infra deploy".

**Путь решения**

1. Для code-only deploy использовать:
   ```bash
   docker compose up -d --build --no-deps izinet-app
   ```
2. Перед любым изменением 3x-ui:
   - backup `x-ui.db`;
   - backup `.env`;
   - backup nginx config;
   - фиксация commit SHA.
3. Не запускать repair scripts на live без dry-run.

**Ожидаемый результат**

Исправления кабинета и API не вызывают лишних рестартов VPN-ноды.

## План работ по порядку

### Этап 1. Диагностика без изменения пользователей

1. Добавить `GET /api/admin/subscriptions/:id/diagnose-hiddify`.
2. Добавить расширенный `POST /api/admin/servers/:id/check`.
3. Добавить структурированные ошибки: `SUB_EMPTY`, `LINK_NOT_REALITY`, `XUI_CLIENT_NOT_FOUND`, `XUI_EXPIRED`, `PUBLIC_PORT_TIMEOUT`, `CLOUDFLARE_PROXIED`.
4. Проверить несколько реальных проблемных подписок.

**Ожидаемый результат этапа**

Становится понятно, почему конкретно Hiddify пишет timeout.

### Этап 2. Исправить модель серверов

1. Добавить поля `panel_url`, `public_host`, `inbound_id`, `vpn_port`, `health_status`.
2. Написать миграцию из текущих `ip/domain/api_port`.
3. Обновить админку серверов.
4. Обновить `getXuiForServer()`.
5. Обновить покупку, продление, удаление, sync traffic, move server.

**Ожидаемый результат этапа**

Серверы описаны однозначно: куда backend ходит управлять панелью и куда Hiddify подключается как VPN-клиент.

### Этап 3. Сделать безопасную регенерацию подписок

1. Добавить `regenerate-config` для одной подписки.
2. Добавить batch regeneration для всех активных.
3. Не удалять клиентов при регенерации, только пересобирать ссылки из текущего inbound.
4. Сохранять отчет по каждой подписке.

**Ожидаемый результат этапа**

Существующие пользователи получают актуальные ссылки без перевыпуска аккаунтов.

### Этап 4. Исправить покупку и продление

1. Проверять результат `updateClient()`.
2. Не списывать баланс и не обновлять БД, если 3x-ui не синхронизирован.
3. Добавить recovery: найти клиента, обновить, если нет - создать заново.
4. Сделать provisioning status.

**Ожидаемый результат этапа**

После покупки/продления Hiddify работает сразу после обновления подписки.

### Этап 5. Включить health-gate для выдачи серверов

1. Запускать Hiddify-ready check по расписанию.
2. `/api/locations` отдает только healthy servers.
3. Покупка выбирает только healthy servers.
4. Если сервер деградировал, админка показывает причину.

**Ожидаемый результат этапа**

Пользователи не попадают на серверы, которые уже известно что не работают.

### Этап 6. Миграция пользователей

1. Сделать backup `subscriptions`.
2. Запустить диагностику всех активных подписок.
3. Запустить `regenerate-all`.
4. Проверить отчет.
5. Для пользователей отправить инструкцию: "Откройте Hiddify -> профиль izinet -> Update/Обновить подписку".
6. Если Hiddify кеширует старый профиль, попросить удалить профиль и добавить subscription URL заново.

**Ожидаемый результат этапа**

Пользователи обновляют подписку и получают новые рабочие ноды.

## Минимальный acceptance checklist

Перед тем как считать задачу закрытой:

- `npm run lint` проходит.
- `npm run build` проходит.
- `/api/health` показывает `status=ok`, `PUBLIC_URL` настроен.
- `/api/admin/servers/:id/check` показывает `hiddify_ready=true`.
- `/api/sub/:id` возвращает base64, который декодируется в одну или несколько `vless://` строк.
- Каждая строка содержит `security=reality`, `sni`, `pbk`, `sid`, `fp`, `flow`.
- Host в VLESS совпадает с `vpn_servers.public_host`.
- Port в VLESS совпадает с inbound.port.
- Клиент с uuid/email есть в 3x-ui, `enable=true`, `expiryTime` в будущем.
- Cloudflare для `public_host` выключен в режим DNS Only.
- Hiddify на Android/iOS/Windows после Update profile подключается без timeout.
- Существующий пользователь после регенерации не теряет device list.

## Что должен увидеть пользователь

1. В личном кабинете остается та же ссылка подписки.
2. Пользователь нажимает "Обновить подписку" в Hiddify.
3. В профиле появляются актуальные ноды.
4. Подключение занимает обычное время, без timeout.
5. При продлении тарифа дата в Hiddify/3x-ui совпадает с датой в кабинете.

## Что делать, если после всех исправлений Hiddify все еще timeout

Проверять в таком порядке:

1. Декодировать `/api/sub/:id` и убедиться, что ссылка не старая.
2. Проверить `public_host:vpn_port` из сети РФ, не только с backend-сервера.
3. Проверить DNS Only у домена Reality.
4. Проверить inbound Reality: `serverNames`, `publicKey`, `shortIds`, `dest`, `spiderX`.
5. Проверить, что Xray реально слушает порт из VLESS-ссылки.
6. Проверить, что firewall пропускает TCP port.
7. Проверить, что клиент в 3x-ui enabled и не expired.
8. Удалить профиль в Hiddify и добавить subscription URL заново, если Hiddify закешировал старую ноду.

