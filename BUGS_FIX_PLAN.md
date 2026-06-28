# План исправления багов — ВСЁ ИСПРАВЛЕНО ✅

Дата создания: 2026-06-28
Последнее обновление: 2026-06-28 (VPN работает)

---

## BUG-0: xray-assets volume mount убивал Xray binary ✅ ИСПРАВЛЕНО

**Проблема:** Volume mount `./xray-assets:/app/bin` в docker-compose.yml **ПЕРЕЗАПИСЫВАЛ** директорию `/app/bin/`, удаляя Xray binary. VPN не работал: `fork/exec bin/xray-linux-amd64: no such file or directory`.

**Решение:** Убран volume mount `./xray-assets:/app/bin` из docker-compose.yml.

**Правило:** НИКОГДА не монтировать volume на `/app/bin/` — там лежит Xray binary.

---

## BUG-1: 4 призрачных VLESS-ссылки ✅ ИСПРАВЛЕНО

**Проблема:** regenerateAllVlessLinks() генерировал ссылки для ВСЕХ Reality inbound'ов (4 штуки), а не только для порта 443.

**Решение:** `server/src/index.ts:139` — добавлен `&& ib.port === 443`

---

## BUG-2:Reality publicKey mismatch ✅ ИСПРАВЛЕНО

**Проблема:** `getInboundLink()` в `xui.service.ts:329` читал `realitySettings.settings.publicKey` (устаревший) вместо `realitySettings.publicKey` (текущий). VLESS ссылки содержали неправильный pbk → Reality handshake не проходил → таймаут.

**Решение:** `server/src/services/xui.service.ts:329` — изменён приоритет:
```ts
// БЫЛО:
const pbk = (rs.publicKey || realitySettings.publicKey || '').trim();
// СТАЛО:
const pbk = (realitySettings.publicKey || rs.publicKey || '').trim();
```

---

## BUG-3: Reality target → Microsoft вместо Nginx ✅ ИСПРАВЛЕНО

**Проблема:** `target=www.microsoft.com:443` — весь non-Reality трафик (браузер) перенаправлялся на Microsoft, получая его SSL сертификат вместо Let's Encrypt.

**Решение:**
- `xui_bootstrap.py` — target изменён на `host.docker.internal:3443`
- `fix_reality_inbound.py` — автоматически исправляет target
- `normalize_reality()` в xui_bootstrap.py — меняет microsoft/google targets

---

## BUG-4: Fingerprint randomized ✅ ИСПРАВЛЕНО

**Проблема:** `fingerprint=randomized` — не валидный uTLS fingerprint. Reality handshake не проходил.

**Решение:**
- `xui_bootstrap.py:194` — проверка `!= "chrome"` вместо `not settings.get("fingerprint")`
- `fix_reality_inbound.py` — автоматически исправляет на `chrome`

---

## BUG-5: ServerNames пустые ✅ ИСПРАВЛЕНО

**Проблема:** `serverNames: []` — Reality требует serverNames совпадающие с target.

**Решение:** `fix_reality_inbound.py` — автоматически находит inbound по порту 443 и устанавливает `['www.microsoft.com', 'microsoft.com']`

---

## BUG-6: Inbound ID захардкожен ✅ ИСПРАВЛЕНО

**Проблема:** `fix_reality_inbound.py` был нацелен на ID=32, но inbound мог иметь другой ID.

**Решение:** Скрипт ищет inbound динамически по порту 443 + security=reality.

---

## BUG-7: Python fallback в контейнере ✅ ИСПРАВЛЕНО

**Проблема:** `spawn python3 ENOENT` — контейнер Node.js не имеет Python.

**Решение:** Убран Python fallback из `routing.service.ts`. SQLite patching делается через `update.sh` на хосте.

---

## BUG-8: MozillaCookiejar импорт ✅ ИСПРАВЛЕНО

**Проблема:** `http.cookiejar.MozillaCookiejar` не работал в Python 3.12.

**Решение:** `patch_xray_routing.py:150` — изменён на `from http.cookiejar import MozillaCookiejar`

---

## BUG-9: add_reality_ws.sh 404 ✅ ИСПРАВЛЕНО

**Проблема:** `split("\\t")` разбивал по literal `\t` вместо таба. Cookies не читались.

**Решение:** `add_reality_ws.sh:121` — изменён на `split("\t")`

---

## Рабочая конфигурация (June 28, 2026)

### Xray Reality inbound (port 443):
```
publicKey: 5c63w00dONo3ks5GAOMf5WMsnV1cD2vvLCUpE3Os6xo
privateKey: kJ2F0HSQBw2hNydpwjCcmYoX5wgxbk0-zW2zr5PP630
serverNames: ['www.microsoft.com', 'microsoft.com']
fingerprint: chrome
target: host.docker.internal:3443
flow: xtls-rprx-vision
```

### VLESS ссылка (пример):
```
vless://UUID@vpn.izinet.online:443?type=tcp&encryption=none&security=reality
&sni=www.microsoft.com&pbk=5c63w00dONo3ks5GAOMf5WMsnV1cD2vvLCUpE3Os6xo
&fp=chrome&sid=5cb64dcd6d60c1&spx=%2F&flow=xtls-rprx-vision#OneD
```

### Критические уроки:
1. **publicKey**: читать `realitySettings.publicKey`, НЕ `realitySettings.settings.publicKey`
2. **target**: ДОЛЖЕН быть `host.docker.internal:3443`, НЕ `www.microsoft.com:443`
3. **Docker**: после git pull ОБЯЗАТЕЛЬНО `docker compose up -d --build`
4. **Сервер**: 2GB RAM — update.sh через SSH вызывает OOM, только через Proxmox console
