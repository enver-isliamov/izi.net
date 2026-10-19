# Hysteria2 и «Маршрутизация» — ограничения, инциденты, правила безопасности

> Добавлено по итогам инцидентов 2026-10-18/19. Главное правило: **«сервис active» ≠ «VPN работает»**. Любое изменение ACL/конфига Hysteria2 проходит preflight → применение → функциональную проверку → откат при ошибке.
>
> Статус на 2026-10-19 22:56 MSK: Hysteria2 проверена живым клиентом (200/204/302 через туннель), VLESS 6/6 портов OK, ссылки подписки корректны.

## 1. Что реально применяется к Hysteria2 (v2.6.1)

| Правило в админке | Xray / VLESS | Hysteria2 2.6.1 |
|---|---|---|
| «Мимо VPN» (direct) | да | **да** — `direct(...)`; домены через `suffix:`, IP/CIDR |
| «Блокировать» (reject) | да | **да** — `reject(...)` |
| «Через VPN» (proxy) | да, если upstream-outbound есть в шаблоне Xray | **нет** — серверные outbounds в 2.6.1 не поддерживаются |
| ipv6-out | да (freedom через `::`) | нет |
| `geosite:` / `geoip:` | да | нет — пропускаются (нужны geo-базы, риск падения) |
| `regexp:` / `keyword:` / `ext:` / `dotless:` | да | нет |

Важно про смысл: серверный ACL управляет **выходом сервера**, а не обходом туннеля на клиенте. «Мимо VPN» в админке = сервер отправляет этот трафик напрямую в интернет (без upstream-цепочки). Полный обход VPN на устройстве (сайт вообще не идёт в туннель) — только клиентская маршрутизация, например Hiddify с регионом `ru`.

## 2. Формат ACL Hysteria2

Файл `/etc/hysteria/acl.txt`, одна строка = одно правило:

```
outbound(address)
```

- `outbound`: `direct` | `reject` (в 2.6.1 только встроенные; кастомные имена не работают).
- `address`: точный домен, `suffix:example.com`, `*.example.com`, IP/CIDR, `geoip:xx`, `geosite:xx`, `all`.
- `#` — комментарий.
- Неизвестный outbound → **`FATAL failed to load server config: invalid syntax at line N`** → сервис не стартует.
- Применение: только через `acl:\n  file: /etc/hysteria/acl.txt` в `/etc/hysteria/config.yaml`, затем **рестарт** (hot reload нет).

## 3. Инциденты и выводы

### 2026-10-18 — geo-записи уронили Hysteria2

ACL содержал `geosite:`/`geoip:`. Hysteria2 при старте пытается скачать geo-базы; без них сервис уходил в `activating (auto-restart)` / `exit-code`. Откат не срабатывал: `systemctl is-active` для неактивного сервиса возвращает non-zero, `execSync` бросал исключение **до** проверки статуса.

**Вывод:** для Hysteria2 geo-записи не используем; статус читать через `... || true` в цикле; откат обязателен при любом сбое.

### 2026-10-19 21:58 — блок `outbounds` сделал выход IPv6-only

Наша синхронизация добавляла в конфиг:

```yaml
outbounds:
  - name: ipv6-out
    type: direct
    direct:
      mode: 6
```

В Hysteria 2.6.1 **первый outbound становится default**. Сервис стартовал, handshake проходил, но весь трафик шёл «только IPv6»: `no IPv6 address available`, `dial tcp6 … network is unreachable`. Проверка `is-active` показывала «всё хорошо».

**Вывод:** никогда не добавлять `outbounds:` в серверный конфиг 2.6.1. В коде добавлена миграция, удаляющая этот блок (`ea82afe`). Проверять не только статус, но и реальный трафик.

### 2026-10-19 — битые ссылки `wireguard://` / `awg://`

В `vpn_servers.domain` лежал URL панели (`http://194.50.94.28:2053`), он попадал в endpoint: ссылки имели вид `@http://194.50.94.28:2053:51820`, в `.conf` — `Endpoint = http://...`. Строгие клиенты (Hiddify/iOS) такой профиль не принимают.

**Вывод:** `normalizeEndpoint()` (схема/путь/порт панели отбрасываются) применяется в `endpointHost()`, `buildShareLinks()`, `buildConf()` (`97b5591`). После деплоя ссылки: `wireguard://…@194.50.94.28:51820?...`.

### 2026-10-19 — ежечасные рестарты панели

Maintenance вызывал `syncAll()` каждый час → `restartPanel()` → перезапуск Xray → падение всех пользователей на 20–30 секунд.

**Вывод:** синхронизация routing — один раз при старте приложения; при отсутствии изменений — пропуск без рестарта.

## 4. Обязательные правила (guardrails)

1. **Не добавлять** в `/etc/hysteria/config.yaml` секцию `outbounds:` — 2.6.1 игнорирует объявления, но первый элемент делает default.
2. В ACL — только `direct`/`reject`; `proxy`, `ipv6-out`, `geosite:`, `geoip:` пропускать с логом.
3. Любое изменение: backup → **preflight** (копия конфига с `listen: 127.0.0.1:0`, временный ACL, `timeout 5 hysteria2 server`) → apply → restart → `is-active` **и** функциональная проверка (клиент + curl через SOCKS5) → откат при ошибке.
4. Откат: восстановить `config.yaml.izinet.bak` + `acl.txt.izinet.bak`, рестарт, проверка. **Не восстанавливать бэкап слепо** — сначала `grep -n outbounds` (в бэкапе может быть тот же блок).
5. Не доверять `systemctl is-active`: сервис может быть `active` с нерабочим default outbound.
6. Не менять формат клиентских ссылок без проверки импорта минимум в двух клиентах.
7. После деплоя: `node scripts/compat/check_izinet.mjs --live` + probe Hysteria + проверка формата ссылок подписки.
8. Не отключать IPv6 на сервере «на всякий случай» — сперва убедиться, что default outbound не `mode: 6`.
9. Никаких периодических рестартов панели/Xray ради применения правил.

## 5. Диагностика «Hysteria не работает»

```bash
systemctl status hysteria2 --no-pager | head -6
grep -n -A6 '^acl:' /etc/hysteria/config.yaml
grep -n -A8 '^outbounds:' /etc/hysteria/config.yaml || echo 'OK: outbounds нет'
head -20 /etc/hysteria/acl.txt
grep -n 'ipv6-out' /etc/hysteria/acl.txt || echo 'OK: ipv6-out нет'
journalctl -u hysteria2 -n 40 --no-pager
```

Функциональная проверка (локально, без влияния на сервис):

```yaml
# probe-client.yaml
server: vpn.izinet.online:443
auth: <пароль из подписки>
tls:
  sni: vpn.izinet.online
  insecure: true
socks5:
  listen: 127.0.0.1:19080
```

```bash
hysteria2 client -c probe-client.yaml &
curl --socks5-hostname 127.0.0.1:19080 https://api.ipify.org   # должен вернуть 194.50.94.28
```

## 6. Ограничение «Через VPN» для Hysteria

Правила `proxy` к Hysteria2 в 2.6.1 **не применяются** — серверный ACL не умеет кастомные outbounds. Варианты:

- оставить для Hysteria только «Мимо VPN» и «Блокировать»;
- обновить Hysteria до актуальной (v2.13.0, октябрь 2026) — там серверные outbounds развиты; делать отдельной аккуратной задачей с откатом;
- «через VPN» на клиенте — клиентская маршрутизация Hiddify.

## 7. Ссылки

- `server/src/services/routing.service.ts` — `syncHysteriaAcl`, preflight, миграция outbounds
- `server/src/utils/routing.ts` — `buildHysteriaAcl`, маппинг правил
- `server/src/services/awg.service.ts` — `normalizeEndpoint`
- `server/src/tests/routing.test.ts`, `server/src/tests/compat.test.ts`
- Коммиты: `235e42a`, `97b5591`, `dc5839d`, `ea82afe`
