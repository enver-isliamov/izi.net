# План обхода блокировок — izinet.online

**Обновлено:** 09.07.2026
**Источники:** Habr 992232, Habr 1027276, runetfreedom/russia-v2ray-rules-dat, ku78/tspu-checker

---

## Что такое белые списки (главная проблема)

Провайдеры используют **двухуровневую фильтрацию**:

```
Пакет → [L3: IP в белом списке?]
          ↓ НЕТ → DROP (пакет исчезает)
          ↓ ДА
       [L7: SNI в чёрном списке?]
          ↓ ДА → RST (соединение рвётся)
          ↓ НЕТ → PASS
```

**L3 (сетевой):** Пакет физически не покидает сеть если dst IP не в белом списке. 63,126 IP из 46 миллионов — это 0.14%.

**L7 (приложения):** Даже если IP разрешён, DPI проверяет SNI. Заблокированный SNI = RST.

---

## Наша проблема

| Что | Статус |
|-----|--------|
| Сервер | Нидерланды (194.50.94.28) — IP **НЕ в белом списке** |
| Reality+TCP:443 | Блокируется早期 DPI |
| Reality+XHTTP:2088 | Блокируется早期 DPI |
| v2rayNG через OpenVPN | Работает (трафик идёт через другой IP) |

**Вывод:** Провайдер использует белые списки. Наш сервер за границей — IP заблокирован на уровне L3. Никакой протокол не поможет если IP не в белом списке.

---

## Что работает для обхода (из статей)

### Метод 1: VLESS+Reality на РОССИЙСКОМ VPS ⭐

**Единственный надёжный метод для белых списков.**

Требования:
1. IP сервера в белом списке (Timeweb, Yandex.Cloud, VK Cloud)
2. SNI whitelisted домена (vk.com, ya.ru, userapi.com)
3. Reality + XTLS-Vision + uTLS chrome

Где брать VPS:
- **Timeweb** — бесплатный reroll IP, высокий шанс попасть в БС
- **Yandex.Cloud** — грант 4000₽ при регистрации
- **VK Cloud** — дороже, сложная верификация

Хорошие SNI для маскировки:
- `storage.yandex.net`, `yastatic.net` (Яндекс CDN)
- `userapi.com`, `vkuser.net` (VK CDN)
- `hosting.reg.ru` (хостинг)
- `cdnvideo.ru`, `okcdn.ru` (CDN)

**Реализация:** Тот же Xray + Reality, но на российском сервере.

### Метод 2: Yandex Cloud Functions

Serverless-функция как прокси. `functions.yandexcloud.net` — в БС у всех провайдеров.

Free tier: 1M вызовов/мес, 100K ГБ-секунд.

Схема:
```
Клиент → Yandex Functions → VPN-сервер
```

### Метод 3: TURN relay

Публичные TURN серверы VK/Яндекса для relay. Работает но быстро банят.

### Метод 4: xDNS

Туннелирование через DNS-запросы. Низкая скорость, только для текста/SSH.

---

## Что НЕ работает

| Метод | Почему не работает |
|-------|-------------------|
| QUIC/HTTP3 | UDP:443 режется в БС |
| ECH/ESNI | Блокируется ТСПУ + бесполезно при L3 блокировке |
| Обычный VPN за границей | IP не в БС — DROP на L3 |
| Cloudflare Workers | Не поддерживают raw TCP для Reality |
| Нестандартные порты | DPI проверяет и порты тоже |

---

## Что делать нам

### Срочно: Получить российский VPS

1. Зарегистрироваться в **Timeweb** или **Yandex.Cloud**
2. Создать VPS в России
3. Установить Xray + Reality
4. Настроить SNI: `vk.com` или `userapi.com` (в белом списке)
5. Настроить DNS-маршрутизацию: российский трафик → напрямую, иностранный → через VPN

### Для гео-маршрутизации

Использовать `russia-v2ray-rules-dat` для определения российских IP/доменов:
- `geoip:ru-blocked` — заблокированные в РФ IP
- `geosite:ru-blocked` — заблокированные домены
- `geosite:ru-available-only-inside` — доступные только в РФ

Ссылки для скачивания:
- geoip.dat: `https://raw.githubusercontent.com/runetfreedom/russia-v2ray-rules-dat/release/geoip.dat`
- geosite.dat: `https://raw.githubusercontent.com/runetfreedom/russia-v2ray-rules-dat/release/geosite.dat`

### Инструменты диагностики

- **tspu-checker** (`github.com/ku78/tspu-checker`) — диагностика блокировок из CLI
- **rkn-block-checker** (`github.com/MayersScott/rkn-block-checker`) — проверка блокировок
- **vpn-configs-for-russia** (`github.com/igareck/vpn-configs-for-russia`) — готовые конфиги

---

## Приоритеты реализации

| # | Задача | Сложность | Срочность |
|---|--------|-----------|-----------|
| 1 | Купить российский VPS (Timeweb/Yandex) | Низкая | 🔴 Высокая |
| 2 | Настроить Xray+Reality на российском VPS | Средняя | 🔴 Высокая |
| 3 | Настроить geo-маршрутизацию | Средняя | 🟡 Средняя |
| 4 | Интегрировать в izinet | Средняя | 🟡 Средняя |
| 5 | Yandex Functions как запасной вариант | Низкая | 🟢 Низкая |

---

## Ключевые ссылки

- [Habr: Как работают ТСПУ и DPI](https://habr.com/ru/articles/992232/)
- [Habr: Белые списки — 6 способов обхода](https://habr.com/ru/articles/1027276/)
- [runetfreedom/russia-v2ray-rules-dat](https://github.com/runetfreedom/russia-v2ray-rules-dat) — geo файлы
- [ku78/tspu-checker](https://github.com/ku78/tspu-checker) — диагностика
- [openlibrecommunity/twl](https://github.com/openlibrecommunity/twl) — сканирование БС
- [igareck/vpn-configs-for-russia](https://github.com/igareck/vpn-configs-for-russia) — готовые конфиги
