import { Router } from 'express';
import { execSync } from 'child_process';
import { supabase } from '../services/supabase';
import { adminOnly } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';

const router = Router();

type TestStatus = 'ok' | 'warn' | 'fail';

interface TestResult {
  id: string;
  group: string;
  name: string;
  status: TestStatus;
  detail: string;
  ms: number;
}

/** Безопасный разбор settings/streamSettings: строка ИЛИ объект (новый API панели отдаёт объект). */
function parseMaybe(value: any, fallback: any = {}): any {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
}

/** Публично опубликованные порты контейнера x3-ui (через docker CLI внутри контейнера приложения). */
function readPublishedX3Ports(): string[] {
  try {
    const out = execSync('docker ps --format "{{.Names}}|{{.Ports}}"', { timeout: 8000 }).toString();
    const line = out.split('\n').find((l) => l.startsWith('x3-ui'));
    if (!line) return [];
    const ports = line.match(/(\d+)->\d+/g) || [];
    return ports.map((p) => p.split('->')[0]);
  } catch {
    return [];
  }
}

router.get('/tests', adminOnly, async (_req, res) => {
  const started = Date.now();
  const results: TestResult[] = [];
  const push = (group: string, id: string, name: string, status: TestStatus, detail: string, ms = 0) =>
    results.push({ group, id, name, status, detail, ms });

  // 1. Конфигурация приложения
  const xuiHost = process.env.XUI_HOST || '';
  push('Конфигурация', 'env-xui-host', 'XUI_HOST задан', xuiHost ? 'ok' : 'fail', xuiHost || 'переменная не задана');
  const intervalMin = process.env.MAINTENANCE_INTERVAL_MIN || '60';
  push('Конфигурация', 'env-interval', 'Интервал цикла обслуживания', 'ok', `${intervalMin} мин`);

  // 2. База данных
  const { data: servers, error: serversErr } = await supabase.from('vpn_servers').select('*');
  if (serversErr) {
    push('База данных', 'db-servers', 'Чтение таблицы серверов', 'fail', serversErr.message);
  } else {
    const active = (servers || []).filter((s: any) => s.is_active);
    push('База данных', 'db-servers', 'Записи серверов', (servers || []).length ? 'ok' : 'fail',
      `всего ${(servers || []).length}, активных ${active.length}`);
  }

  const { data: rules } = await supabase.from('vpn_routing_rules').select('id,is_active').eq('is_active', true);
  push('База данных', 'routing-rules', 'Правила маршрутизации', (rules || []).length ? 'ok' : 'warn',
    `${(rules || []).length} активных`);

  // 3. Docker: опубликованные порты панели
  const publishedPorts = readPublishedX3Ports();
  push('Инфраструктура', 'docker-ports', 'Опубликованные порты контейнера x3-ui',
    publishedPorts.length ? 'ok' : 'warn',
    publishedPorts.length ? publishedPorts.join(', ') : 'не удалось определить (docker CLI недоступен)');

  // 4. По каждому активному серверу
  for (const server of (servers || []).filter((s: any) => s.is_active)) {
    const label = `«${server.name}»`;

    // 4.1 Панель доступна
    let instance: any = null;
    const tPanel = Date.now();
    try {
      const { instance: inst } = await getXuiForServer(server.id);
      instance = inst;
      const ok = await Promise.race([
        instance.checkHealth(),
        new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error('таймаут 5 с')), 5000)),
      ]);
      push('Панель', `panel-${server.id}`, `Панель ${label} доступна`, ok ? 'ok' : 'fail',
        ok ? 'ответ получен' : 'нет ответа', Date.now() - tPanel);
    } catch (e: any) {
      push('Панель', `panel-${server.id}`, `Панель ${label} доступна`, 'fail', e.message, Date.now() - tPanel);
      continue;
    }

    // 4.2 Инбаунды
    let inbounds: any[] = [];
    try {
      const t = Date.now();
      inbounds = (await instance.getInbounds()) || [];
      const enabled = inbounds.filter((i: any) => i.enable);
      push('Инбаунды', `inbounds-${server.id}`, `Инбаунды ${label}`, enabled.length ? 'ok' : 'fail',
        `всего ${inbounds.length}, включено ${enabled.length}: ${enabled.map((i: any) => i.port).join(', ')}`,
        Date.now() - t);

      // 4.3 Порты инбаундов опубликованы
      if (publishedPorts.length) {
        const apiPort = String(server.api_port || '2053');
        const notPublished = enabled.filter(
          (i: any) => !publishedPorts.includes(String(i.port)) && String(i.port) !== apiPort && String(i.port) !== '2022'
        );
        push('Инбаунды', `ports-${server.id}`, `Порты инбаундов ${label} опубликованы`,
          notPublished.length ? 'warn' : 'ok',
          notPublished.length
            ? `не опубликованы: ${notPublished.map((i: any) => i.port).join(', ')}`
            : 'все включённые инбаунды доступны снаружи');
      }

      // 4.4 Reality-ключи на основном инбаунде
      const reality = enabled.find((i: any) => parseMaybe(i.streamSettings).security === 'reality');
      if (reality) {
        const rs = parseMaybe(reality.streamSettings).realitySettings || {};
        const inner = rs.settings || rs;
        const hasKey = Boolean(inner.publicKey || rs.publicKey);
        const sni = inner.serverName || rs.serverName || inner.dest || rs.dest || '';
        push('Инбаунды', `reality-${server.id}`, `Reality-параметры ${label}`, hasKey ? 'ok' : 'fail',
          hasKey ? `SNI: ${sni || '—'}` : 'отсутствует publicKey');
      }

      // 4.5 Клиенты в инбаундах
      const counts = enabled.map((i: any) => `${i.port}:${(parseMaybe(i.settings).clients || []).length}`);
      const anyClients = enabled.some((i: any) => (parseMaybe(i.settings).clients || []).length > 0);
      push('Клиенты', `clients-${server.id}`, `Клиенты в инбаундах ${label}`, anyClients ? 'ok' : 'warn',
        counts.join(', '));
    } catch (e: any) {
      push('Инбаунды', `inbounds-${server.id}`, `Инбаунды ${label}`, 'fail', e.message);
    }

    // 4.6 Чтение статистики трафика (первый клиент)
    try {
      const t = Date.now();
      const firstInbound = inbounds.find((i: any) => (parseMaybe(i.settings).clients || []).length > 0);
      const client = firstInbound ? parseMaybe(firstInbound.settings).clients[0] : null;
      if (client?.email) {
        const traffic = await instance.getClientTraffic(client.email);
        push('Статистика', `traffic-${server.id}`, `Статистика трафика ${label}`,
          traffic ? 'ok' : 'warn',
          traffic ? `клиент ${client.email}: ${traffic.used} байт` : `нет данных для ${client.email}`,
          Date.now() - t);
      } else {
        push('Статистика', `traffic-${server.id}`, `Статистика трафика ${label}`, 'warn', 'нет клиентов для проверки');
      }
    } catch (e: any) {
      push('Статистика', `traffic-${server.id}`, `Статистика трафика ${label}`, 'fail', e.message);
    }

    // 4.7 Чтение списка онлайна
    try {
      const onlines = await instance.getOnlines();
      push('Статистика', `onlines-${server.id}`, `Список онлайна ${label}`, 'ok', `онлайн: ${onlines.length}`);
    } catch (e: any) {
      push('Статистика', `onlines-${server.id}`, `Список онлайна ${label}`, 'fail', e.message);
    }

    // 4.8 Чтение настроек панели (маршрутизация)
    try {
      const settings = await instance.getSettings();
      const sizeKb = settings ? Math.round(JSON.stringify(settings).length / 1024) : 0;
      push('Маршрутизация', `settings-${server.id}`, `Настройки панели ${label} читаются`,
        settings ? 'ok' : 'fail', settings ? `получено, ${sizeKb} КБ` : 'пустой ответ');
    } catch (e: any) {
      push('Маршрутизация', `settings-${server.id}`, `Настройки панели ${label} читаются`, 'fail', e.message);
    }
  }

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    warn: results.filter((r) => r.status === 'warn').length,
    fail: results.filter((r) => r.status === 'fail').length,
    ms: Date.now() - started,
  };

  res.json({ summary, results, generatedAt: new Date().toISOString() });
});

export default router;
