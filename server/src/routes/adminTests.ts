import { Router } from 'express';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import axios from 'axios';
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

// Гео-контроль: что видят внешние сервисы (страна, ASN, признаки хостинга), какие DNS-резолверы
// использует приложение и есть ли IPv6-выход (частая утечка мимо VLESS-туннеля).
router.get('/geo', adminOnly, async (_req, res) => {
  const started = Date.now();
  const results: TestResult[] = [];
  const push = (group: string, id: string, name: string, status: TestStatus, detail: string, ms = 0) =>
    results.push({ group, id, name, status, detail, ms });

  // 1. Выходной IP — тот же адрес, через который выходят пользователи VPN
  let ip = '';
  try {
    const r = await axios.get('https://api.ipify.org?format=json', { timeout: 8000 });
    ip = String(r.data?.ip || '');
  } catch (e) {}
  if (!ip) {
    try { ip = String((await axios.get('https://ifconfig.me/ip', { timeout: 8000 })).data || '').trim(); } catch (e) {}
  }
  push('Гео', 'exit-ip', 'Выходной IP (как его видят сайты)', ip ? 'ok' : 'fail', ip || 'не удалось определить');

  // 2. Гео и репутация адреса
  if (ip) {
    try {
      const t = Date.now();
      const r = await axios.get(
        `http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,isp,org,as,asname,proxy,hosting,mobile`,
        { timeout: 8000 }
      );
      const d = r.data || {};
      if (d.status === 'success') {
        const code = String(d.countryCode || '').toUpperCase();
        push('Гео', 'exit-geo', 'Страна выходного IP', code === 'RU' ? 'fail' : 'ok',
          `${d.country} (${code}), ${d.city || '—'}; ${d.asname || d.as || d.isp || '—'}`, Date.now() - t);
        push('Гео', 'exit-flags', 'Признаки адреса', d.hosting ? 'warn' : 'ok',
          `hosting=${Boolean(d.hosting)}, proxy=${Boolean(d.proxy)}, mobile=${Boolean(d.mobile)}` +
          (d.hosting ? ' — адрес хостинга: часть сервисов (Google и др.) относится к таким адресам настороженно' : ''));
      } else {
        push('Гео', 'exit-geo', 'Страна выходного IP', 'warn', 'сервис геолокации не ответил');
      }
    } catch (e: any) {
      push('Гео', 'exit-geo', 'Страна выходного IP', 'warn', 'не удалось получить гео: ' + e.message);
    }
  }

  // 3. DNS-резолверы контейнера/сервера
  try {
    const resolv = fs.readFileSync('/etc/resolv.conf', 'utf8');
    const servers = resolv
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('nameserver'))
      .map((l) => l.split(/\s+/)[1])
      .filter(Boolean);
    push('Сеть', 'dns', 'DNS-резолверы контейнера', servers.length ? 'ok' : 'warn',
      servers.length ? servers.join(', ') : 'не найдены');
    const ruResolvers = servers.filter((s) => s.startsWith('77.88.') || s.startsWith('77.88'));
    if (ruResolvers.length) {
      push('Сеть', 'dns-ru', 'Российские DNS-резолверы', 'fail', 'обнаружены РФ-резолверы: ' + ruResolvers.join(', '));
    }
  } catch (e: any) {
    push('Сеть', 'dns', 'DNS-резолверы контейнера', 'warn', e.message);
  }

  // 4. IPv6-выход
  let v6 = false;
  try {
    const r = await axios.get('https://api6.ipify.org?format=json', { timeout: 6000 });
    v6 = Boolean(r.data?.ip);
  } catch (e) {}
  const ifaces = os.networkInterfaces();
  const v6Addrs = Object.entries(ifaces).flatMap(([name, addrs]) =>
    (addrs || [])
      .filter((a: any) => a.family === 'IPv6' && !a.internal)
      .map((a: any) => `${name}:${a.address}`)
  );
  push('Утечки', 'ipv6', 'IPv6-выход', v6 ? 'warn' : 'ok',
    v6
      ? 'у контейнера есть IPv6-выход — убедитесь, что клиенты не уходят по IPv6 напрямую'
      : 'IPv6-выход недоступен (утечки мимо туннеля нет)' + (v6Addrs.length ? `; адреса: ${v6Addrs.join(', ')}` : ''));

  // 5. Что проверяется на стороне клиента
  push('Клиент', 'client-hints', 'Что проверить в клиенте', 'ok',
    'DNS внутри туннеля (не системный), IPv6 выключен, без «Round robin» с мёртвыми прокси, QUIC в браузере выключен, часовой пояс и язык не российские');

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === 'ok').length,
    warn: results.filter((r) => r.status === 'warn').length,
    fail: results.filter((r) => r.status === 'fail').length,
    ms: Date.now() - started
  };
  res.json({ summary, results, exitIp: ip, generatedAt: new Date().toISOString() });
});

export default router;
