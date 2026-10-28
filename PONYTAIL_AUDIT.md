# 🦥 Ponytail Audit — izi.net

**Дата:** 10 июля 2026
**Репозиторий:** `E:\YandexDisk\_Render-Snh\izi.net`
**Итого:** -2500+ строк, -4 зависимости

---

## 📦 Мёртвые зависимости (удалить)

| Зависимость | Проблема | Файл |
|-------------|----------|------|
| `crypto-js` | Нигде не импортируется. Используется нативный `crypto` | package.json |
| `@base-ui/react` | Нигде не импортируется | package.json |
| `next-themes` | Нигде не импортируется | package.json |
| `@google/genai` | Нигде не импортируется | package.json |
| `ws` | Нужен только для Node < 21. Если Node 21+ — удалить | server/src/services/supabase.ts |
| `date-fns` | 1 импорт для `format`. Заменить на `Intl.DateTimeFormat` | src/pages/Admin/Payments.tsx |
| `vite` | Дублируется в `dependencies` и `devDependencies`. Убрать из dependencies | package.json |

**Действие:** Удалить из `package.json`, пересобрать.

---

## 💀 Мёртвый код (удалить)

### Сервер

| Что | Строк | Причина | Файл |
|-----|-------|---------|------|
| `generateVlessLink()` | ~5 | Всегда бросает ошибку. Нужен `getInboundLink()` | xui.service.ts:687-689 |
| `listClients()` | ~20 | Нигде не вызывается | xui.service.ts:666-685 |
| `getOnlines()` | ~20 | Нигде не вызывается | xui.service.ts:645-663 |
| `checkRealityInbound()` | ~40 | Нигде не вызывается | xui.service.ts:595-632 |
| `syncRealityKeys()` | ~25 | Deprecated, логика дублируется в maintenance | xui.service.ts:572-593 |
| `checkConfig()` | ~3 | Просто `return this.checkHealth()`. Inline | xui.service.ts:189-191 |
| `diagnostic.ts` | ~57 | CJS в ESM проекте. Никогда не импортируется | server/src/diagnostic.ts |

### Фронтенд

| Что | Строк | Причина | Файл |
|-----|-------|---------|------|
| `Subscription.tsx` | 516 | Роут `/subscription` редиректит на `/dashboard`. Страница не рендерится | src/pages/Subscription.tsx |
| `Servers.tsx` | 122 | Нет роута в App.tsx. Использует несуществующий тип из AuthContext | src/pages/Servers.tsx |
| `check_users.ts` | 23 | CJS-скрипт в src/pages. Не React-компонент, не импортируется | src/pages/check_users.ts |
| `database.ts` | 58 | Интерфейсы нигде не используются. Весь код на `any` | src/types/database.ts |

### Скрипты

| Что | Строк | Причина | Файл |
|-----|-------|---------|------|
| `repair_xui.py` | 43 | Написано "DEPRECATED — replaced by xui_bootstrap.py" | repair_xui.py |

**Итого мёртвого кода:** ~960 строк

---

## 🔁 Дублирование (сжать)

### 1. Поиск Reality inbound на порту 443 (~12 копий)

Один и тот же фильтр скопирован по всему коду:
```ts
inbounds.find((ib: any) => {
  const ss = JSON.parse(ib.streamSettings || '{}');
  return ss.security === 'reality' && ib.port === 443;
});
```

**Где:** admin.ts, user.ts, maintenance.service.ts, config.ts, diagnostic.ts, xui.service.ts
**Экономия:** ~80 строк
**Решение:** Вынести в `findRealityInbound(inbounds)` хелпер

### 2. Регенерация VLESS-ссылок (4 дубля)

Один и тот же цикл "遍历 подписки → найти inbound → сгенерировать ссылку" повторяется в:
- `index.ts:regenerateAllVlessLinks()`
- `admin.ts:/system/regenerate-all-links`
- `admin.ts:/subscriptions/regenerate-all`
- `maintenance.service.ts:regenerateLinksForServer()`
- `config.ts` lazy-heal

**Экономия:** ~150 строк
**Решение:** Один метод в сервисе

### 3. Бизнес-логика в index.ts

`regenerateAllVlessLinks()` (53 строки) и `autoDetectServerFields()` (50 строк) — определены как глобальные функции в entry-файле.

**Решение:** Перенести в сервис

---

## 🔒 Безопасность / корректность

| Проблема | Где | Решение |
|----------|-----|---------|
| Email суперадмина `enverphoto@gmail.com` захардкожен в 3 местах | auth.ts:12, AuthContext.tsx:44,114 | Вынести в env `SUPERADMIN_EMAIL` |

---

## 🧹 Утилиты (сжать)

| Что | Строк | Проблема | Файл |
|-----|-------|----------|------|
| `stableJsonStringify` | 16 | Рукописный рекурсивный JSON с сортировкой. Используется 1 раз | server/src/utils/json.ts |
| `copyToClipboard` | 30 | Fallback для IE (`document.execCommand`). React 19 = `navigator.clipboard` | src/lib/utils.ts:8-37 |

---

## 📜 Скрипты (массовое дублирование)

23 shell-скрипта в корне. Многие пересекаются:

| Группа | Скрипты | Решение |
|--------|---------|---------|
| Диагностика (6 шт) | diagnose.sh, diagnose_panel.sh, diagnose_vpn.sh, diag_hysteria.sh, diag_port.sh, 01_DIAGNOSTIC_SCRIPT.sh | Один `debug.sh` |
| Исправления (5 шт) | fix_hysteria.sh, fix_routing.sh, fix_routing_v2.sh, fix_vpn.sh, fix_xhttp_inbound.sh | Один `fix.sh` с аргументами |
| Установка (3 шт) | setup_hysteria_on_server.sh, setup_xhttp.sh, setup_xhttp_v2.sh | Один `install.sh` |
| Волшебники (7 шт) | 00_RUN_ME_FIRST.sh .. 06_FULL_HEALTH_CHECK.sh | Удалить (то же самое что install + debug) |

**Экономия:** ~1500+ строк

---

## 📊 Итого

| Категория | Экономия |
|-----------|----------|
| Мёртвые зависимости | -4-6 пакетов |
| Мёртвый код | ~960 строк |
| Дублирование | ~230 строк |
| Скрипты | ~1500 строк |
| Утилиты | ~60 строк |
| **ИТОГО** | **-2500+ строк, -4 deps** |

---

## 🎯 Приоритеты

1. **Удалить мёртвые зависимости** из package.json (5 мин)
2. **Удалить мёртвые страницы** Subscription.tsx, Servers.tsx, check_users.ts (2 мин)
3. **Удалить мёртвые методы** XUIService (10 мин)
4. **Вынести `findRealityInbound`** хелпер (15 мин)
5. **Объединить регенерацию ссылок** в один сервис (30 мин)
6. **Консолидировать скрипты** (час)

---

*Аудит проведён по методологии ponytail-audit: только находки, исправления не применены.*
