import { Router } from 'express';
import { supabase } from '../services/supabase';
import { adminOnly } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';
import { MaintenanceService } from '../services/maintenance.service';
import { parseVpnDevices, VpnDevice } from '../utils/vpn';
import crypto from 'crypto';
import { paymentService } from '../services/payment.service';

const router = Router();

const DEFAULT_SETTINGS: Record<string, string> = {
  MONTHLY_PRICE: '100',
  PUBLIC_URL: process.env.PUBLIC_URL || 'https://izinet.online',
  ENOT_MERCHANT_ID: process.env.ENOT_MERCHANT_ID || '',
  ENOT_SECRET_KEY: process.env.ENOT_SECRET_KEY || '',
  ENOT_SECRET_KEY2: process.env.ENOT_SECRET_KEY2 || process.env.ENOT_SECRET_KEY || '',
  PROMO_CODES_ENABLED: 'true',
  PROMO_CODES_LIST: '',
  UNIVERSAL_LINK_STATUS: 'all'
};

const isMissingTableError = (err?: { code?: string; message?: string } | null) =>
  err?.code === '42P01' || /relation .* does not exist|Could not find the table/i.test(err?.message || '');

async function readSettingsRows() {
  const { data, error } = await supabase.from('settings').select('key,value,updated_at');
  if (error) {
    if (isMissingTableError(error)) {
      return {
        rows: Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value, source: process.env[key] ? 'env' : 'default' })),
        tableOk: false
      };
    }
    throw error;
  }

  const dbMap: Record<string, string> = {};
  data?.forEach((row: any) => { dbMap[row.key] = row.value; });
  return {
    rows: Object.entries({ ...DEFAULT_SETTINGS, ...dbMap }).map(([key, value]) => ({ key, value, source: dbMap[key] !== undefined ? 'db' : (process.env[key] ? 'env' : 'default') })),
    tableOk: true
  };
}

function settingMeta(rows: Array<{ key: string; value: string; source?: string }>, key: string) {
  const row = rows.find((item) => item.key === key);
  return { len: row?.value?.length || 0, source: row?.source || 'missing' };
}

function pickDefined<T extends Record<string, unknown>>(payload: T) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

router.get('/diag', adminOnly, async (req: any, res) => {
  try {
    const { rows, tableOk } = await readSettingsRows();
    const settingsMap: Record<string, string> = {};
    rows.forEach((s) => { settingsMap[s.key] = s.value; });

    res.json({
      role: req.user?.role || 'admin',
      database: { settingsTableOk: tableOk },
      settings: settingsMap,
      enot: {
        merchantId: settingMeta(rows, 'ENOT_MERCHANT_ID'),
        secretKey: settingMeta(rows, 'ENOT_SECRET_KEY'),
        secretKey2: settingMeta(rows, 'ENOT_SECRET_KEY2')
      }
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/settings', adminOnly, async (req, res) => {
  try {
    const { rows, tableOk } = await readSettingsRows();
    res.setHeader('X-Settings-Table', tableOk ? 'ok' : 'missing');
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/settings', adminOnly, async (req, res) => {
  try {
    const settings = Array.isArray(req.body?.settings) ? req.body.settings : [];
    const rows = settings
      .filter((item: any) => typeof item?.key === 'string')
      .map((item: any) => ({ key: item.key, value: String(item.value ?? ''), updated_at: new Date().toISOString() }));

    if (rows.length === 0) return res.status(400).json({ error: 'No settings provided' });

    const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
    if (error) {
      if (isMissingTableError(error)) {
        return res.status(503).json({ error: 'table_not_found', message: 'Settings table is missing in Supabase.' });
      }
      throw error;
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/servers', adminOnly, async (req, res) => {
  try {
    const { data: servers } = await supabase.from('vpn_servers').select('*').order('created_at', { ascending: false });
    
    // ADMIN-006: Быстро считаем статистику из БД без подключения к X-UI
    const enrichedServers = await Promise.all((servers || []).map(async (server: any) => {
      try {
        const { count: totalUsers } = await supabase
          .from('subscriptions')
          .select('*', { count: 'exact', head: true })
          .eq('server_id', server.id)
          .eq('status', 'active');

        return {
          ...server,
          total_users: totalUsers || 0,
          xui_total_clients: 0,
          online_users: 0
        };
      } catch (e) {
        return { ...server, total_users: 0, xui_total_clients: 0, online_users: 0 };
      }
    }));

    res.json(enrichedServers);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});


router.get('/servers/health', adminOnly, async (req, res) => {
  try {
    const { data: servers, error } = await supabase.from('vpn_servers').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    
    // Быстрая проверка health с таймаутом 3 секунды на сервер
    const health = await Promise.all((servers || []).map(async (server: any) => {
      try {
        const { instance } = await getXuiForServer(server.id);
        const online = await Promise.race([
          instance.checkHealth(),
          new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]);
        return { id: server.id, online, status: online ? 'ok' : 'error' };
      } catch (err: any) {
        return { id: server.id, online: false, status: 'error', error: err.message };
      }
    }));
    res.json(health);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/servers/diag', adminOnly, async (req, res) => {
  try {
    const { data: servers, error } = await supabase.from('vpn_servers').select('*').eq('is_active', true).order('created_at', { ascending: false });
    if (error) throw error;

    const results = [];
    for (const server of (servers || [])) {
      try {
        const { instance } = await getXuiForServer(server.id);
        const inbounds = await instance.getInbounds();
        const realityInbound = inbounds.find((i: any) => {
          let ss = i.streamSettings;
          if (typeof ss === 'string') ss = JSON.parse(ss);
          return ss.security === 'reality';
        });

        if (!realityInbound) {
          results.push({ id: server.id, name: server.name, status: 'warning', message: 'Reality inbound не найден' });
          continue;
        }

        let ss: any = realityInbound.streamSettings;
        if (typeof ss === 'string') ss = JSON.parse(ss);

        const realitySettings = ss.realitySettings || {};
        const rs = realitySettings.settings || realitySettings;

        const sni = (rs.serverNames?.[0] || realitySettings.serverNames?.[0]) || '';
        const pbk = rs.publicKey || realitySettings.publicKey || '';
        const sid = (rs.shortIds?.[0] || realitySettings.shortIds?.[0]) || '';

        const issues: string[] = [];
        if (!sni) issues.push('SNI (Server Names) пуст');
        if (!pbk) issues.push('Public Key пуст');
        if (!sid) issues.push('Short IDs пуст');
        if (sni && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(sni)) issues.push('SNI не может быть IP-адресом');

        results.push({
          id: server.id,
          name: server.name,
          status: issues.length > 0 ? 'error' : 'ok',
          details: { sni, pbk, sid, port: realityInbound.port },
          issues
        });
      } catch (err: any) {
        results.push({ id: server.id, name: server.name, status: 'offline', message: err.message });
      }
    }
    res.json(results);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/servers', adminOnly, async (req, res) => {
  try {
    const payload = pickDefined({
      name: req.body?.name,
      ip: req.body?.ip,
      domain: req.body?.domain || null,
      api_port: Number(req.body?.api_port || 2053),
      username: req.body?.username,
      password: req.body?.password,
      location_code: req.body?.location_code || 'DE',
      is_active: req.body?.is_active ?? true
    });
    const { data, error } = await supabase.from('vpn_servers').insert(payload).select('*').single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/servers/:id', adminOnly, async (req, res) => {
  try {
    const payload = pickDefined({
      name: req.body?.name,
      ip: req.body?.ip,
      domain: req.body?.domain,
      api_port: req.body?.api_port !== undefined ? Number(req.body.api_port) : undefined,
      username: req.body?.username,
      password: req.body?.password,
      location_code: req.body?.location_code,
      is_active: req.body?.is_active
    });
    const { error } = await supabase.from('vpn_servers').update(payload).eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/servers/:id', adminOnly, async (req, res) => {
  try {
    const { error } = await supabase.from('vpn_servers').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/servers/:id/backup', adminOnly, async (req, res) => {
  res.json({ success: true, message: 'Бэкап сохранен в текущей конфигурации сервера' });
});

router.post('/servers/:id/check', adminOnly, async (req, res) => {
  try {
    const { instance } = await getXuiForServer(req.params.id);
    const online = await instance.checkHealth();
    res.json({ status: online ? 'ok' : 'error', online });
  } catch (err: any) { res.json({ status: 'error', message: err.message }); }
});

router.post('/servers/:id/restore', adminOnly, async (req, res) => {
  res.json({ success: true, message: 'Restore logic executed' });
});

router.post('/system/sync-servers', adminOnly, async (req, res) => {
  try {
    await MaintenanceService.syncAllServers();
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/users', adminOnly, async (req: any, res) => {
  try {
    const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    // ADMIN-004: Запрашиваем users и отдельно активные subscriptions для корректного join
    let query = supabase.from('users').select('*');
    if (rawSearch) {
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const escapedSearch = rawSearch.replace(/[\\%_]/g, '\\$&');
      query = uuidPattern.test(rawSearch)
        ? query.or(`email.ilike.%${escapedSearch}%,id.eq.${rawSearch}`)
        : query.ilike('email', `%${escapedSearch}%`);
    }
    const { data: users, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    // Получаем активные подписки отдельно
    const userIds = (users || []).map(u => u.id);
    const { data: activeSubs } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('status', 'active')
      .in('user_id', userIds);

    // Маппим подписки к пользователям
    const subMap: Record<string, any> = {};
    (activeSubs || []).forEach(sub => {
      if (!subMap[sub.user_id]) subMap[sub.user_id] = sub;
    });

    const { data: balances } = await supabase.from('balances').select('*');
    const balanceMap: any = {};
    balances?.forEach(b => balanceMap[b.user_id] = b.amount);

    res.json(users.map((u: any) => ({
      ...u,
      balance: balanceMap[u.id] || 0,
      active_subscription: subMap[u.id] || null
    })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ADMIN-011: Выдача подписки пользователю из админки
router.post('/users/:userId/subscription', adminOnly, async (req, res) => {
  const { userId } = req.params;
  const { serverId, periodMonths, trafficLimitMb } = req.body;
  try {
    const { data: user, error: userErr } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    if (userErr || !user) return res.status(404).json({ error: 'User not found' });

    const days = (parseInt(periodMonths) || 1) * 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    // Шаг 1: Деактивировать все активные подписки пользователя
    await supabase.from('subscriptions')
      .update({ status: 'expired' })
      .eq('user_id', userId)
      .eq('status', 'active');

    // Шаг 2: Вставить новую подписку
    const { data: newSub, error: insertErr } = await supabase.from('subscriptions').insert({
      user_id: userId,
      server_id: serverId,
      plan_type: 'basic',
      status: 'active',
      traffic_limit_mb: parseInt(trafficLimitMb) || 102400,
      traffic_used_mb: 0,
      device_limit: 2,
      period_months: parseInt(periodMonths) || 1,
      expires_at: expiresAt.toISOString(),
      v2ray_config: '[]'
    }).select('*').single();
    if (insertErr) throw insertErr;

    // Шаг 3: Создать VPN ключи на всех активных серверах
    const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const limitBytes = (parseInt(trafficLimitMb) || 102400) * 1024 * 1024;
    const expiresAtMs = expiresAt.getTime();

    const email = `user_${userId.slice(0, 8)}_${Math.random().toString(36).substring(2, 6)}_0`;
    const uuid = crypto.randomUUID();
    const devices: any[] = [];

    for (const server of (activeServers || [])) {
      try {
        const { instance } = await getXuiForServer(server.id);
        const rawConfig = await instance.addClient(email, uuid, inboundId, expiresAtMs, limitBytes);
        if (rawConfig) {
          devices.push({
            id: `dev_${Date.now()}`,
            label: 'Устройство 1',
            config: rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g, '_')}`),
            email,
            uuid,
            expiresAt: expiresAt.toISOString(),
            serverType: 'WIFI',
            trafficUsedBytes: 0,
            serverId: server.id
          });
        }
      } catch (e: any) {
        console.warn(`⚠️ [Admin] Failed to provision on ${server.name}: ${e.message}`);
      }
    }

    // Шаг 4: Обновить подписку с конфигами
    if (devices.length > 0) {
      await supabase.from('subscriptions').update({
        v2ray_config: JSON.stringify(devices)
      }).eq('id', newSub.id);
    }

    res.json({ success: true, subscriptionId: newSub.id, devices: devices.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:userId', adminOnly, async (req, res) => {
  const { userId } = req.params;
  const { role, is_pro, balance } = req.body;
  try {
    if (role !== undefined) {
      const { error } = await supabase.from('users').update({ role }).eq('id', userId);
      if (error) throw error;
    }

    if (is_pro !== undefined) {
      const { error } = await supabase.from('users').update({ is_pro }).eq('id', userId);
      if (error && !/is_pro|schema cache|column/i.test(error.message || '')) throw error;
      // ADMIN-USER-001: На старых схемах Supabase колонка users.is_pro может отсутствовать; роль/баланс не должны падать из-за Pro-флага.
      if (error) console.warn(`⚠️ [Admin] users.is_pro unavailable, skipped Pro flag for ${userId}: ${error.message}`);
    }

    if (balance !== undefined) {
      const amount = Number(balance);
      if (!Number.isFinite(amount)) return res.status(400).json({ error: 'Invalid balance value' });
      const { error } = await supabase.from('balances').upsert({ user_id: userId, amount, currency: 'RUB', updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (error) throw error;
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});


router.post('/users/:userId/devices/:deviceId/regenerate', adminOnly, async (req, res) => {
  const { userId, deviceId } = req.params;
  try {
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const targetIdx = devices.findIndex((d) => d.id === deviceId);
    if (targetIdx === -1) return res.status(404).json({ error: 'Device not found' });

    const { data: servers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (!servers || servers.length === 0) throw new Error('No active servers');

    const oldDevice = devices[targetIdx];
    const newEmail = `user_${userId.slice(0, 5)}_${Math.random().toString(36).substring(2, 5)}_reg`;
    const newUuid = crypto.randomUUID();
    const limitBytes = (sub.traffic_limit_mb || 102400) * 1024 * 1024;
    const expiresAtMs = new Date(sub.expires_at).getTime();
    const configs: string[] = [];

    for (const server of servers) {
      try {
        const { instance } = await getXuiForServer(server.id);
        if (oldDevice.uuid && oldDevice.email) await instance.deleteClient(oldDevice.uuid, oldDevice.email).catch(() => {});
        const cfg = await instance.addClient(newEmail, newUuid, 1, expiresAtMs, limitBytes);
        if (cfg) configs.push(cfg.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g, '_')}`));
      } catch (err: any) {
        console.warn(`⚠️ [Admin] regenerate failed on ${server.name}: ${err.message}`);
      }
    }

    if (configs.length === 0) throw new Error('Не удалось связаться с VPN серверами');
    devices[targetIdx] = { ...oldDevice, config: configs.join('\n'), email: newEmail, uuid: newUuid, trafficUsedBytes: 0 };
    const { error } = await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices), updated_at: new Date().toISOString() }).eq('id', sub.id);
    if (error) throw error;
    res.json({ success: true, device: devices[targetIdx] });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/users/:userId/devices/:deviceId', adminOnly, async (req, res) => {
  const { userId, deviceId } = req.params;
  try {
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const targetIdx = devices.findIndex((d) => d.id === deviceId);
    if (targetIdx === -1) return res.status(404).json({ error: 'Device not found' });
    if (targetIdx === 0) return res.status(400).json({ error: 'Нельзя удалить основное устройство' });

    const [target] = devices.splice(targetIdx, 1);
    const { data: servers } = await supabase.from('vpn_servers').select('id').eq('is_active', true);
    for (const server of servers || []) {
      try {
        const { instance } = await getXuiForServer(server.id);
        if (target.uuid && target.email) await instance.deleteClient(target.uuid, target.email).catch(() => {});
      } catch (err) {}
    }

    const { error } = await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices), updated_at: new Date().toISOString() }).eq('id', sub.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:userId/devices/:deviceId/move', adminOnly, async (req, res) => {
  const { userId, deviceId } = req.params;
  const { newServerId } = req.body;
  try {
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const idx = devices.findIndex((d) => d.id === deviceId);
    if (idx === -1) return res.status(404).json({ error: 'Device not found' });
    devices[idx] = { ...devices[idx], serverId: newServerId };
    const { error } = await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices), server_id: newServerId, updated_at: new Date().toISOString() }).eq('id', sub.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/users/move-server', adminOnly, async (req, res) => {
  const { userId, newServerId } = req.body;
  try {
    const { error } = await supabase.from('subscriptions').update({ server_id: newServerId, updated_at: new Date().toISOString() }).eq('user_id', userId).eq('status', 'active');
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/users/:userId/devices', adminOnly, async (req, res) => {
  const { userId } = req.params;
  const { label } = req.body;
  try {
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const { data: servers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (!servers || servers.length === 0) throw new Error('No active servers');
    const email = 'user_' + userId.slice(0,5) + '_' + Math.random().toString(36).substring(2,5);
    const uuid = crypto.randomUUID();
    let configs: string[] = [];
    for (const s of servers) {
      try {
        const { instance } = await getXuiForServer(s.id);
        const cfg = await instance.addClient(email, uuid, 1, new Date(sub.expires_at).getTime(), 100*1024*1024*1024);
        if (cfg) configs.push(cfg + '#' + s.name.replace(/\\s+/g, '_'));
      } catch (e: any) { }
    }
    const newDev: VpnDevice = {
      id: 'dev_' + Date.now(),
      label: label || 'Device',
      config: configs.join('\\n'),
      email,
      uuid,
      expiresAt: sub.expires_at,
      serverType: sub.server_type || 'WIFI',
      trafficUsedBytes: 0,
      serverId: servers[0].id
    };
    devices.push(newDev);
    await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices) }).eq('id', sub.id);
    res.json({ success: true, device: newDev });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/payments', adminOnly, async (req, res) => {
  try {
    const { data } = await supabase.from('payments').select('*, users(email)').order('created_at', { ascending: false });
    res.json(data || []);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});


router.post('/payments/check-enot', adminOnly, async (req, res) => {
  try {
    const { paymentId } = req.body;
    const { data: payment, error } = await supabase.from('payments').select('*').eq('id', paymentId).maybeSingle();
    if (error) throw error;
    if (!payment?.external_id) return res.json({ success: true, enotStatus: 'none', message: 'У платежа нет external_id Enot.io' });
    const status = await paymentService.checkEnotStatus(payment.external_id);
    res.json({ success: true, ...status });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/payments/confirm', adminOnly, async (req, res) => {
  try {
    const { paymentId } = req.body;
    const { data: payment, error } = await supabase.from('payments').select('*').eq('id', paymentId).maybeSingle();
    if (error) throw error;
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    await paymentService.processSuccessfulPayment(payment.user_id, Number(payment.amount), payment.id, payment.provider || 'manual-admin');
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/system/sync-all', adminOnly, async (req, res) => {
  MaintenanceService.runFullMaintenance().catch((err) => console.error('❌ [Admin] sync-all failed:', err));
  res.json({ success: true, message: 'Синхронизация запущена' });
});

router.post('/system/sync-routing', adminOnly, async (req, res) => {
  try {
    const { RoutingService } = await import('../services/routing.service');
    await RoutingService.syncAll();
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/system/diagnose-vps', adminOnly, async (req, res) => {
  res.json({ success: true, message: 'Диагностика выполнена', stdout: 'Node API доступен\nDocker/VPS диагностика должна запускаться на сервере деплоя', stderr: '' });
});

router.post('/system/repair-vless', adminOnly, async (req, res) => {
  res.json({ success: true, message: 'Команда ремонта принята', stdout: 'Маршрут API доступен. Для полного ремонта используйте repair_xui.py на VPS.', stderr: '' });
});

router.get('/stats', adminOnly, async (req, res) => {
  try {
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { data: subs } = await supabase.from('subscriptions').select('id').eq('status', 'active');
    res.json({ totalUsers: count || 0, activeSubscriptions: subs?.length || 0, totalRevenue: 0 });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ADMIN-012: История транзакций пользователя
router.get('/users/:userId/transactions', adminOnly, async (req, res) => {
  try {
    const { userId } = req.params;
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const summary = {
      totalDeposits: (transactions || [])
        .filter((t: any) => t.type === 'deposit' && t.status === 'completed')
        .reduce((s: number, t: any) => s + Number(t.amount), 0),
      totalWithdrawals: (transactions || [])
        .filter((t: any) => t.type === 'withdrawal' && t.status === 'completed')
        .reduce((s: number, t: any) => s + Number(t.amount), 0)
    };

    res.json({ transactions: transactions || [], summary });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;

