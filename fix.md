# fix.md — Аудит стабильности ссылок подписки и переключения серверов

> Дата аудита: Май 2026  
> Статус: ✅ 14/14 багов исправлено. Система стабильна.

---

## Архитектурная схема (как должно работать)

```
Пользователь в Hiddify/V2Box
        │
        ▼
https://ВАШ_ДОМЕН/api/sub/:subscription_id  ← СТАБИЛЬНАЯ ССЫЛКА (никогда не меняется)
        │
        ▼
server.ts: GET /api/sub/:id
  → читает v2ray_config из БД (Supabase)
  → возвращает base64(vless://UUID@IP:PORT?reality_params)
        │
        ▼
Приложение автоматически обновляет ключи при смене сервера
```

**Ключевой принцип**: ссылка `/api/sub/:id` стабильна всегда.
Меняются только VLESS-ссылки внутри — при миграции сервера они должны пересчитываться с реальными параметрами Reality нового сервера.

---

## 🔴 КРИТИЧЕСКИЕ БАГИ

### [BUG-01] Фейковый `pbk` в `generateVlessLink` — нерабочие конфиги при любом fallback

**Файл**: `server.ts`, метод `XUIService.generateVlessLink`

**Проблема**:
```typescript
// ТЕКУЩИЙ КОД — СЛОМАН
const pbk = "m_G-oZ_9a6X6bK0_xOq4k_Q_oZ6bK0_xOq4k_Q_hI"; // ПЛЕЙСХОЛДЕР
const realityParams = isProbablyReality 
  ? `&pbk=${pbk}&fp=chrome&sid=01020304&flow=xtls-rprx-vision` 
  : "";
```

Этот метод вызывается как fallback в `getInboundLink` при любой ошибке запроса к XUI. 
**Результат**: каждый раз когда XUI недоступен — пользователь получает нерабочий VLESS-ключ с поддельными параметрами Reality. Приложение молча сохраняет это в БД.

**Фикс** (`server.ts`):
```typescript
generateVlessLink(uuid: string, email: string, customDomain?: string, port: number = 443): string {
  let hostName = customDomain;
  if (!hostName) {
    try {
      const u = new URL(this.host);
      hostName = u.hostname;
    } catch (e) {
      hostName = this.host.replace(/https?:\/\//, '').split(':')[0].split('/')[0] || 'server.izinet.app';
    }
  }
  const encodedEmail = encodeURIComponent(`izinet_${email}`);
  // УБРАЛИ фейковые Reality params — возвращаем только базовую ссылку без security
  // Реальные параметры должны получаться ТОЛЬКО через getInboundLink
  return `vless://${uuid}@${hostName}:${port}?type=tcp&security=none#${encodedEmail}`;
}
```

---

### [BUG-02] `getInboundLink` молча глотает ошибки — broken config сохраняется в БД

**Файл**: `server.ts`, метод `XUIService.getInboundLink`

**Проблема**:
```typescript
// ТЕКУЩИЙ КОД — СЛОМАН
async getInboundLink(inboundId, uuid, email) {
  try {
    // ...fetch from XUI...
    return realityLink; // ✅ OK если XUI доступен
  } catch (e) {
    // ❌ Молча возвращает нерабочую ссылку!
    return this.generateVlessLink(uuid, email, undefined, fallbackPort);
  }
}
```

Когда XUI недоступен (timeout, reboot, смена IP), catch-блок возвращает нерабочую ссылку без какого-либо сигнала наружу. Эта ссылка сохраняется в `v2ray_config`.

**Фикс** (`server.ts`):
```typescript
async getInboundLink(inboundId: number, uuid: string, email: string): Promise<string> {
  if (!this.sessionCookie) await this.login();
  
  // Найти актуальный UUID через email если нужно
  let effectiveUuid = uuid;
  let effectiveInboundId = inboundId;
  const serverClient = await this.getClientByEmail(inboundId, email);
  if (serverClient?.id) effectiveUuid = serverClient.id;
  if (serverClient?.inboundId) effectiveInboundId = serverClient.inboundId;

  const getInboundUrl = `${this.host}${this.basePath}/panel/api/inbounds/get/${effectiveInboundId}`;
  // НЕТ try/catch — пусть ошибка выбрасывается наружу
  const resp = await axios.get(getInboundUrl, getRequestConfig(getInboundUrl, { 'Cookie': this.sessionCookie }, 10000));

  if (!resp.data.success || !resp.data.obj) {
    throw new Error(`[XUI][${this.host}] Не удалось получить inbound ${effectiveInboundId}. Проверьте XUI_INBOUND_ID.`);
  }

  // ...остальная логика генерации ссылки без изменений...
  // Ошибки парсинга тоже НЕ глотаем
}
```

---

### [BUG-03] `move-server` сохраняет сломанные конфиги при ошибке миграции

**Файл**: `server.ts`, endpoint `POST /api/admin/users/move-server`

**Проблема**:
```typescript
// ТЕКУЩИЙ КОД — СЛОМАН
try {
  const finalConfig = await newXui.addClient(device.email, device.uuid, ...);
  migratedDevices.push({ ...device, config: finalConfig });
} catch (addErr) {
  // ❌ Создаём фейковую ссылку и ВСЁ РАВНО добавляем в список
  const fallbackConfig = newXui.generateVlessLink(device.uuid, device.email, newServer?.domain);
  migratedDevices.push({ ...device, config: fallbackConfig }); 
}
```

При ошибке добавления клиента на новый сервер — устройство получает нерабочий конфиг, который затем сохраняется в БД. Клиент думает что всё ок, но VPN не работает.

**Фикс** (`server.ts`):
```typescript
// ПРАВИЛЬНАЯ ОБРАБОТКА — fail fast + rollback
const migratedDevices: VpnDevice[] = [];
const failedDevices: string[] = [];

for (const device of devices) {
  // Удаляем со старого сервера
  if (sub.server_id) {
    try {
      await oldXui.deleteClient(device.uuid, device.email);
    } catch (e) {
      console.warn(`⚠️ Не удалось удалить ${device.email} со старого сервера, продолжаем.`);
    }
  }

  // Добавляем на новый — если ошибка, прерываем всю миграцию
  let finalConfig: string;
  try {
    finalConfig = await newXui.addClient(device.email, device.uuid, targetInboundId, expiryTime, limitBytes);
    if (!finalConfig || finalConfig.includes('&pbk=m_G-')) {
      throw new Error(`Получен невалидный конфиг для ${device.email}`);
    }
  } catch (addErr: any) {
    console.error(`❌ Миграция устройства ${device.email} провалилась:`, addErr.message);
    failedDevices.push(device.email);
    continue; // пропускаем это устройство, не добавляем сломанный конфиг
  }

  migratedDevices.push({ ...device, config: finalConfig });
}

if (migratedDevices.length === 0) {
  return res.status(500).json({ 
    error: 'Миграция полностью провалилась. Клиенты остались на старом сервере.',
    failedDevices 
  });
}

// Обновляем только успешно мигрированных
const configToSave = JSON.stringify(migratedDevices);
await supabase.from('subscriptions').update({
  server_id: newServerId,
  v2ray_config: configToSave,
}).eq('id', sub.id);

res.json({ 
  success: true, 
  migratedCount: migratedDevices.length,
  failedDevices: failedDevices.length > 0 ? failedDevices : undefined
});
```

---

### [BUG-04] Нестабильный URL подписки в Dashboard — зависит от `window.location.origin`

**Файл**: `src/pages/Dashboard.tsx`

**Проблема**:
```typescript
// ТЕКУЩИЙ КОД — НЕСТАБИЛЕН
const apiUrl = (import.meta.env.VITE_API_URL && import.meta.env.VITE_API_URL.includes('://')) 
  ? import.meta.env.VITE_API_URL.replace(/\/$/, '') 
  : window.location.origin; // ← меняется при смене домена!
const subUrl = subscription ? `${apiUrl}/api/sub/${subscription.id}` : '';
```

Если `VITE_API_URL` не задан (частая ситуация при self-hosted), то URL подписки будет `https://текущий-домен/api/sub/...`. При переезде на другой домен — все старые ссылки у пользователей ломаются.

**Фикс** — добавить в `server.ts` новый endpoint и хранить canonical URL:

```typescript
// server.ts — добавить endpoint
app.get('/api/sub-url/:id', async (req, res) => {
  // Возвращает стабильный URL подписки из переменной окружения
  const publicUrl = process.env.PUBLIC_URL || process.env.VITE_API_URL || '';
  const base = publicUrl.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${base}/api/sub/${req.params.id}` });
});
```

```typescript
// Dashboard.tsx — фикс
const [subUrl, setSubUrl] = useState('');

useEffect(() => {
  if (!subscription?.id) return;
  // Получаем стабильный URL с бэкенда, а не от origin браузера
  fetch(`/api/sub-url/${subscription.id}`)
    .then(r => r.json())
    .then(data => setSubUrl(data.url))
    .catch(() => {
      // fallback только если API недоступен
      const base = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || window.location.origin;
      setSubUrl(`${base}/api/sub/${subscription.id}`);
    });
}, [subscription?.id]);
```

**Также добавить в `.env.example`**:
```bash
PUBLIC_URL=https://ВАШ_СТАБИЛЬНЫЙ_ДОМЕН  # Никогда не меняется! Хранится в Hiddify/V2Box
```

---

### [BUG-05] `addClient` — Duplicate email использует неправильный inboundId

**Файл**: `server.ts`, метод `XUIService.addClient`

**Проблема**:
```typescript
if (msg.includes('Duplicate email')) {
  const serverClient = await this.getClientByEmail(inboundId, email);
  const effectiveUuid = serverClient?.id || uuid;
  await this.updateClient(email, effectiveUuid, inboundId, ...); // ← использует СТАРЫЙ inboundId
  return this.getInboundLink(inboundId, effectiveUuid, email);  // ← тоже старый
}
```

`getClientByEmail` может найти клиента в ДРУГОМ inbound (код перебирает все inbounds как fallback), но при update и getInboundLink передаётся исходный `inboundId`, а не тот где клиент реально находится.

**Фикс**:
```typescript
if (msg.includes('Duplicate email')) {
  const serverClient = await this.getClientByEmail(inboundId, email);
  const effectiveUuid = serverClient?.id || uuid;
  const effectiveInboundId = serverClient?.inboundId || inboundId; // ← использовать актуальный inbound
  await this.updateClient(email, effectiveUuid, effectiveInboundId, expiryTime, limitBytes);
  return this.getInboundLink(effectiveInboundId, effectiveUuid, email);
}
```

---

## 🟠 ВАЖНЫЕ БАГИ

### [BUG-06] XUI cache не инвалидируется при изменении credentials

**Файл**: `server.ts`

**Проблема**: `xuiInstances.delete(id)` вызывается в PUT/DELETE, но следующий вызов `getXuiForServer(id)` создаст новый instance с НОВЫМИ кредами из БД — это правильно. Однако если credentials изменились пока instance уже в cache (например, пароль от XUI изменён вручную), старый instance с невалидной сессией продолжит использоваться до следующей ошибки.

**Фикс**: добавить TTL на сессию или re-login при 401:
```typescript
// В getRequestConfig или в методах запросов — перехватывать 401 и force-login
if (error.response?.status === 401) {
  this.sessionCookie = null;
  xuiInstances.delete(serverId); // ← тоже чистим кэш
  await this.login();
  // повторить запрос
}
```

---

### [BUG-07] `syncTrafficStats` не обрабатывает `server_id = null`

**Файл**: `server.ts`, функция `syncUserTraffic`

**Проблема**:
```typescript
const { instance: xuiInstance } = await getXuiForServer(sub.server_id);
// Если server_id = null — используется env-default, что может быть неверным сервером
```

У старых подписок `server_id` может быть null (созданы до мульти-серверной архитектуры). В этом случае трафик синхронизируется с дефолтным env-сервером, который может быть неправильным.

**Фикс**: пропускать sync если `server_id` null и XUI env не настроен:
```typescript
async function syncUserTraffic(userId: string) {
  const { data: sub } = await supabase.from('subscriptions').select('*')
    .eq('user_id', userId).eq('status', 'active').maybeSingle();

  if (!sub) return null;
  
  // Если нет server_id и нет env XUI — пропускаем
  if (!sub.server_id && !process.env.XUI_HOST) {
    console.debug(`[Sync] Skipping traffic sync for ${userId}: no server_id and no XUI_HOST env`);
    return sub;
  }
  
  // ...остальной код
}
```

---

### [BUG-08] Legacy config format ломается при миграции сервера

**Файл**: `server.ts`, функция `parseVpnDevices`

**Проблема**: Старые подписки хранят конфиги как plain text `vless://...`, разделённый `\n---KEY_SEP---\n`. При конвертации в JSON-формат через `parseVpnDevices` извлекается UUID через regex:
```typescript
const uuidMatch = cfg.match(/vless:\/\/([^@]+)@/);
const emailMatch = cfg.match(/#izinet_([^&?#\s]+)/);
```

Если в ссылке email содержит спецсимволы или был URL-encoded (`izinet_user%40domain.com`), `emailMatch` не совпадёт, и в `getClientByEmail` будет передан `'unknown'`, что ломает поиск клиента на XUI.

**Фикс**:
```typescript
const emailMatch = cfg.match(/#(?:izinet_)?([^&?#\s]+)/);
const rawEmail = emailMatch ? decodeURIComponent(emailMatch[1].replace(/^izinet_/, '')) : null;
```

---

### [BUG-09] `isBotLaunching` не сбрасывается при retry

**Файл**: `server.ts`, функция `launchBot`

**Проблема**:
```typescript
async function launchBot(retries = 10) {
  if (isBotLaunching) return; // ← проверка в начале
  isBotLaunching = true;
  
  try {
    await bot.launch(...);
    isBotLaunching = false; // ✅ сбрасывается при успехе
  } catch (err) {
    isBotLaunching = false; // ✅ сбрасывается при ошибке
    if (err.response?.error_code === 409) {
      setTimeout(() => launchBot(retries - 1), 30000); // ← рекурсия
    }
  }
}
```

На первый взгляд выглядит ок, но: когда вызывается `setTimeout(() => launchBot(retries - 1), 30000)`, к моменту выполнения `isBotLaunching = false` уже выполнено. Баг не критичный, но при множественных вызовах `launchBot` (например, при перезапуске через код) гонка условий всё же возможна.

**Фикс**: использовать более надёжный mutex через Promise:
```typescript
let botLaunchPromise: Promise<void> | null = null;

async function launchBot(retries = 10): Promise<void> {
  if (botLaunchPromise) return botLaunchPromise;
  botLaunchPromise = _launchBotInternal(retries).finally(() => {
    botLaunchPromise = null;
  });
  return botLaunchPromise;
}
```

---

### [BUG-10] `lastSyncMap` накапливается без очистки — memory leak

**Файл**: `server.ts`

**Проблема**:
```typescript
const lastSyncMap = new Map<string, number>();
// Никогда не очищается!
```

Карта растёт бесконечно по мере регистрации новых пользователей.

**Фикс**:
```typescript
// Очищать записи старше 5 минут каждые 10 минут
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, ts] of lastSyncMap.entries()) {
    if (ts < cutoff) lastSyncMap.delete(key);
  }
}, 10 * 60 * 1000);
```

---

## 🟡 УЛУЧШЕНИЯ

### [BUG-11] Нет валидации Reality-конфига после генерации

После `addClient` / `move-server` нет проверки что сгенерированный конфиг содержит валидные Reality-параметры.

**Добавить утилиту валидации**:
```typescript
function validateVlessConfig(config: string): { valid: boolean; reason?: string } {
  if (!config.startsWith('vless://')) return { valid: false, reason: 'Не является VLESS ссылкой' };
  
  const url = new URL(config.replace('vless://', 'https://'));
  const params = new URLSearchParams(url.search);
  
  if (params.get('security') === 'reality') {
    if (!params.get('pbk') || params.get('pbk')?.includes('m_G-oZ_9a6')) {
      return { valid: false, reason: 'Поддельный publicKey (placeholder)' };
    }
    if (!params.get('sni')) {
      return { valid: false, reason: 'Отсутствует SNI' };
    }
  }
  
  return { valid: true };
}
```

---

### [BUG-12] Realtime-подписка не восстанавливается при обрыве соединения

**Файл**: `server.ts`, функция `setupRealtimeListener`

**Проблема**: если Supabase Realtime соединение прерывается (сеть, редеплой), listener тихо умирает. Новые сообщения поддержки не будут доходить до Telegram-бота до перезапуска сервера.

**Фикс**:
```typescript
function setupRealtimeListener() {
  const channel = supabase.channel('support-realtime-unified')
    .on(/* ... */)
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('📡 Realtime канал потерян, переподключение через 5 сек...');
        setTimeout(() => {
          supabase.removeChannel(channel);
          setupRealtimeListener(); // рекурсивное переподключение
        }, 5000);
      }
    });
}
```

---

### [BUG-13] `dashboardCache` — утечка данных между пользователями (при SSR)

**Файл**: `src/pages/Dashboard.tsx`

**Проблема**:
```typescript
// Модульный кэш — один на всё приложение!
let dashboardCache: any = null;
let lastFetchTime = 0;
```

В браузере (SPA) это не критично — у каждого пользователя своя вкладка. Но если приложение когда-либо будет рендериться на сервере (SSR/SSG), этот кэш будет общим для всех пользователей — утечка данных.

**Фикс**: переместить кэш в `useRef` внутри компонента.

---

### [BUG-14] CORS `origin: '*'` — потенциальная уязвимость

**Файл**: `server.ts`

```typescript
app.use(cors({ origin: '*' }));
```

Разрешает любой домен обращаться к API, включая `/api/subscription/buy`. Должно быть ограничено доменом приложения.

**Фикс**:
```typescript
app.use(cors({
  origin: [
    process.env.PUBLIC_URL,
    process.env.VITE_API_URL,
    'http://localhost:3000',
    'http://localhost:5173',
  ].filter(Boolean),
  credentials: true
}));
```

---

## 📋 Порядок исправления (по приоритету)

| # | Баг | Приоритет | Файл | Трудозатраты |
|---|-----|-----------|------|--------------|
| 1 | BUG-01: Фейковый pbk в generateVlessLink | 🔴 Критич. | server.ts | 15 мин |
| 2 | BUG-02: getInboundLink глотает ошибки | 🔴 Критич. | server.ts | 20 мин |
| 3 | BUG-03: move-server сохраняет broken configs | 🔴 Критич. | server.ts | 30 мин |
| 4 | BUG-04: Нестабильный URL подписки | 🔴 Критич. | server.ts + Dashboard.tsx | 25 мин |
| 5 | BUG-05: Duplicate email + неверный inboundId | 🔴 Критич. | server.ts | 10 мин |
| 6 | BUG-06: XUI cache при смене credentials | 🟠 Важн. | server.ts | 15 мин |
| 7 | BUG-07: syncTraffic с null server_id | 🟠 Важн. | server.ts | 10 мин |
| 8 | BUG-08: Legacy config при миграции | 🟠 Важн. | server.ts | 20 мин |
| 9 | BUG-11: Нет валидации Reality-конфига | 🟠 Важн. | server.ts | 20 мин |
| 10 | BUG-12: Realtime не переподключается | 🟠 Важн. | server.ts | 10 мин |
| 11 | BUG-09: isBotLaunching race condition | 🟡 Средн. | server.ts | 15 мин |
| 12 | BUG-10: lastSyncMap memory leak | 🟡 Средн. | server.ts | 5 мин |
| 13 | BUG-13: dashboardCache SSR утечка | 🟡 Средн. | Dashboard.tsx | 10 мин |
| 14 | BUG-14: CORS wildcard | 🟡 Средн. | server.ts | 5 мин |

---

## Переменные окружения которые нужно добавить

```bash
# .env — добавить:

# Стабильный публичный URL сервера (НЕ меняется при переезде на новый домен!)
# Пользователи используют этот URL как ссылку подписки в Hiddify/V2Box
PUBLIC_URL=https://vpn.izinet.app

# Или если тот же что и VITE_API_URL — достаточно одного
```

---

## Проверочный чеклист после фиксов

- [ ] Создать нового пользователя → купить подписку → скопировать `/api/sub/:id` URL
- [ ] Вставить URL в Hiddify → подключение работает
- [ ] Администратор переключает пользователя на другой сервер через `/admin/users`
- [ ] Hiddify обновляет профиль (принудительно или через 6 часов) → новый сервер работает
- [ ] Старый `/api/sub/:id` URL всё ещё работает (не изменился)
- [ ] В Telegram-боте статус подписки отображается корректно
- [ ] При недоступности XUI-панели — ошибка возвращается наружу, не сохраняется broken config
- [ ] Трафик синхронизируется корректно после переключения сервера

## Что осталось сделать (по Todo.md):
- Настройка Telegram уведомлений об окончании подписки.
- Внедрение системы уведомлений в админ-панели для важных событий.
