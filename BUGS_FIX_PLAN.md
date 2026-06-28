# План исправления 3 багов

Дата: 2026-06-28

---

## BUG-1: 4 призрачных VLESS-ссылки с нерабочими ключами

### Симптом
Hiddify показывает 4 ноды "OneD", но только одна работает (pbk=CXL0o8BEC7wz...). Остальные 3 таймаутят.

### Корень
`regenerateAllVlessLinks()` в `server/src/index.ts:136-141` фильтрует inbound'ы по `security === 'reality' && ib.enable !== false`, но НЕ проверяет `ib.port === 443`. В панели 3x-ui есть 4 Reality inbound'а на разных портах (созданы xui_bootstrap.py / backup-restore), каждый со своей парой ключей x25519.

### Исправление
`server/src/index.ts:139` — добавить `&& ib.port === 443`:
```ts
return ss.security === 'reality' && ib.enable !== false && ib.port === 443;
```

### Дополнительно
- В панели 3x-ui удалить неиспользуемые Reality inbound'ы (порт != 443)
- В `routing.service.ts:restoreAllPanelsFromBackup()` — при восстановлении не создавать inbound'ы с портами != 443 еслиReality-ключи не совпадают с основным

### Тест
1. Запустить `POST /api/admin/subscriptions/regenerate-all`
2. Декодировать `/api/sub/:id` — должна быть 1 строка `vless://` с pbk=CXL0o8BEC7wz...
3. Hiddify → Update profile → 1 нода → подключение работает

---

## BUG-2: ERR_CONNECTION_RESET — прямые обращения к Supabase

### Симптом
Консоль браузера: `GET https://rtynukkoueqpvemlshdx.supabase.co/rest/v1/users?select=... ERR_CONNECTION_RESET` (8+ раз). Dashboard не грузит данные.

### Корень
Proxy в `src/lib/supabase.ts` перехватывает URL начинающиеся с `supabaseUrl`, но Supabase JS-клиент может строить URL в другом формате (с trailing slash, другим protocol и т.д.). Также `/api/subscription/plans` → ERR_CONNECTION_RESET = backend недоступен.

### Исправление
1. `src/lib/supabase.ts` — усилить проверку URL: сравнивать hostname вместо全长 URL
2. Добавить fallback: если proxy не сработал, повторить запрос через proxy

### Тест
1. Открыть Dashboard → нет ERR_CONNECTION_RESET в консоли
2. Все запросы к Supabase идут через `/api/supabase-proxy/`

---

## BUG-3: Устройство не появляется в дашборде

### Симптом
Пользователь добавляет устройство на сайте, но в дашборде оно не отображается.

### Корень
1. Dashboard обновляется только поллингом (30 сек) или рефетчем при закрытии мастера
2. RPC `append_vpn_device` может молча писать не в тот столбец
3. Нет Realtime-подписки на изменения subscriptions

### Исправление
1. После успешного добавления устройства — принудительно обновить данные с задержкой 2 сек
2. Добавить Realtime-подписку на таблицу subscriptions в Dashboard
3. Проверить RPC `append_vpn_device` — убедиться что пишет в `v2ray_config`

### Тест
1. Добавить устройство → через 2-3 сек оно появляется в дашборде
2. Обновить страницу → устройство на месте

---

## Порядок исправления

1. **BUG-1** (1 строка) — критичный, VPN не работает
2. **BUG-2** (proxy fix) — критичный, dashboard не грузится
3. **BUG-3** (realtime + retry) — важный, UX

---

## Acceptance checklist

- [ ] `/api/sub/:id` возвращает 1 VLESS-ссылку (не 4)
- [ ] Hiddify → Update profile → 1 нода → подключение без таймаута
- [ ] Dashboard загружается без ERR_CONNECTION_RESET
- [ ] Добавление устройства → появление в дашборде за 3 сек
- [ ] `npm run build` проходит
- [ ] `npx tsc --noEmit` без ошибок
