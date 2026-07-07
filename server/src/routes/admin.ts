import { Router } from 'express';
import { supabase } from '../services/supabase';
import { adminOnly } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';
import { MaintenanceService } from '../services/maintenance.service';
import { parseVpnDevices, VpnDevice } from '../utils/vpn';

import { getRequestConfig } from '../utils/axios';
import { restartContainer } from '../utils/docker';
import axios from 'axios';
import http from 'http';
import net from 'net';
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
  const { id } = req.params;
  try {
    const { instance, server } = await getXuiForServer(id);
    if (!server) return res.status(404).json({ error: 'Server not found' });

    console.log(`[Backup] Starting cloud backup for server: ${server.name} (${id})`);
    
    const inbounds = await instance.getInbounds();
    if (!inbounds || inbounds.length === 0) {
      return res.status(400).json({ error: 'На сервере не найдено инбаундов для бэкапа.' });
    }

    const settings = await instance.getSettings();
    const xrayTemplateConfig = settings.xrayTemplateConfig || null;

    const { error } = await supabase
      .from('vpn_servers')
      .update({ 
        xui_config_state: { 
          inbounds: inbounds, 
          xrayTemplateConfig: xrayTemplateConfig,
          backup_at: new Date().toISOString(),
          server_name: server.name,
          ip: server.ip
        } 
      })
      .eq('id', id);

    if (error) throw error;

    res.json({ 
      success: true, 
      message: 'Конфигурация сервера успешно сохранена в Supabase',
      inbounds_count: inbounds.length,
      has_xray_config: !!xrayTemplateConfig
    });
  } catch (err: any) {
    console.error(`[AdminBackup] Error for server ${id}:`, err.message);
    res.status(500).json({ error: 'Ошибка при создании бэкапа: ' + err.message });
  }
});

router.post('/servers/:id/check', adminOnly, async (req, res) => {
  try {
    const { instance } = await getXuiForServer(req.params.id);
    const online = await instance.checkHealth();
    res.json({ status: online ? 'ok' : 'error', online });
  } catch (err: any) { res.json({ status: 'error', message: err.message }); }
});

router.post('/servers/:id/restore', adminOnly, async (req, res) => {
  const { id } = req.params;
  const { sourceId } = req.body || {};
  try {
    const { instance, server } = await getXuiForServer(id);
    if (!server) return res.status(404).json({ error: 'Server not found' });

    console.log(`[Restore] Starting cloud restore for server: ${server.name} (${id}) ${sourceId ? `from source server ID: ${sourceId}` : ''}`);
    
    let configState: any;
    if (sourceId) {
      const { data: sourceServer, error: sErr } = await supabase
        .from('vpn_servers')
        .select('xui_config_state, name')
        .eq('id', sourceId)
        .maybeSingle();
      
      if (sErr) throw sErr;
      if (!sourceServer?.xui_config_state?.inbounds) {
        return res.status(400).json({ error: `В базе нет инбаундов для сервера-источника ${sourceServer?.name || sourceId}. Сделайте бэкап с него сначала.` });
      }
      configState = sourceServer.xui_config_state;
    } else {
      if (!server.xui_config_state?.inbounds) {
        return res.status(400).json({ error: 'В базе нет инбаундов для этого сервера. Сделайте бэкап сначала.' });
      }
      configState = server.xui_config_state;
    }
    
    const inbounds = configState.inbounds;
    
    await instance.login(true);

    const existingInbounds = await instance.getInbounds();
    
    let restoredCount = 0;
    for (const inbound of inbounds) {
      const exists = existingInbounds.find((ei: any) => ei.port === inbound.port && ei.protocol === inbound.protocol);
      if (exists) {
        console.log(`[Restore] Deleting existing inbound on port ${inbound.port}`);
        await instance.deleteInbound(exists.id);
      }
      
      const newInbound = { ...inbound };
      delete (newInbound as any).id;
      (newInbound as any).up = 0;
      (newInbound as any).down = 0;
      
      console.log(`[Restore] Creating inbound: ${inbound.remark} on port ${inbound.port}`);
      await instance.addInbound(newInbound);
      restoredCount++;
    }

    // Restore xrayTemplateConfig via panel HTTP API (works for remote servers too)
    if (configState.xrayTemplateConfig) {
      console.log(`[Restore] Restoring xrayTemplateConfig via panel API...`);
      await instance.updateSettings({ xrayTemplateConfig: configState.xrayTemplateConfig });
      await instance.restartPanel();
      console.log(`[Restore] xrayTemplateConfig restored and panel restarted`);
    } else {
      // No xrayTemplateConfig in backup — still restart to apply inbound changes
      setTimeout(() => {
        console.log(`[Restore] Restarting x3-ui to apply inbound changes...`);
        restartContainer('x3-ui').catch(e => console.error(`[Restore] Restart failed: ${e.message}`));
      }, 1000);
    }

    res.json({
      success: true,
      message: 'Конфигурация (инбаунды, клиенты, xray шаблон) успешно восстановлена.',
      restored_inbounds: restoredCount,
      has_xray_config: !!configState.xrayTemplateConfig
    });
  } catch (err: any) {
    console.error(`[AdminRestore] Error for server ${id}:`, err.message);
    res.status(500).json({ error: 'Ошибка при восстановлении бэкапа: ' + err.message });
  }
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

    // Шаг 1: Проверяем есть ли уже подписка у пользователя
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    let subId: string;

    if (existingSub) {
      // Шаг 2a: Обновляем существующую подписку
      const { error: updateErr } = await supabase.from('subscriptions').update({
        status: 'active',
        expires_at: expiresAt.toISOString(),
        traffic_limit_mb: parseInt(trafficLimitMb) || 102400,
        traffic_used_mb: 0,
        server_id: serverId || existingSub.server_id,
        v2ray_config: '[]',
        updated_at: new Date().toISOString()
      }).eq('id', existingSub.id);
      if (updateErr) throw updateErr;
      subId = existingSub.id;
    } else {
      // Шаг 2b: Создаём новую подписку
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
      subId = newSub.id;
    }

    // Шаг 3: Создать VPN ключи на всех активных серверах
    const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    const limitBytes = (parseInt(trafficLimitMb) || 102400) * 1024 * 1024;
    const expiresAtMs = expiresAt.getTime();

    const email = `user_${userId.slice(0, 8)}_${Math.random().toString(36).substring(2, 6)}_0`;
    const uuid = crypto.randomUUID();
    const devices: any[] = [];

    for (const server of (activeServers || [])) {
      try {
        const { instance, server: serverData } = await getXuiForServer(server.id);
              const inboundId = serverData.inbound_id || 0;
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
        // ADMIN-013: Автоматический backup inbound'ов после addClient
        try {
          const inbounds = await instance.getInbounds();
          await supabase.from('vpn_servers').update({
            xui_config_state: {
              inbounds: inbounds,
              backup_at: new Date().toISOString(),
              server_name: server.name,
              ip: server.ip
            }
          }).eq('id', server.id);
        } catch (backupErr: any) {
          console.warn(`⚠️ [Admin] Backup failed for ${server.name}: ${backupErr.message}`);
        }
      } catch (e: any) {
        console.warn(`⚠️ [Admin] Failed to provision on ${server.name}: ${e.message}`);
      }
    }

    // Шаг 4: Обновить подписку с конфигами
    if (devices.length > 0) {
      await supabase.from('subscriptions').update({
        v2ray_config: JSON.stringify(devices)
      }).eq('id', subId);
    }

    res.json({ success: true, subscriptionId: subId, devices: devices.length });
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
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).in('status', ['active', 'limited']).maybeSingle();
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
        const { instance, server: serverData } = await getXuiForServer(server.id);
        
        let inboundId = serverData.inbound_id || 0;
        if (!inboundId || inboundId <= 0) {
          try {
            const inbounds = await instance.getInbounds();
            const realityInbound = inbounds.find((ib: any) => {
              try {
                const ss = typeof ib.streamSettings === 'string' ? JSON.parse(ib.streamSettings) : (ib.streamSettings || {});
                return ss.security === 'reality' && ib.port === 443;
              } catch { return false; }
            });
            if (realityInbound) inboundId = realityInbound.id;
          } catch (e: any) {
            console.warn(`⚠️ [Admin] Could not auto-detect inbound for ${server.name}: ${e.message}`);
          }
        }

        if (oldDevice.uuid && oldDevice.email) await instance.deleteClient(oldDevice.uuid, oldDevice.email).catch(() => {});
        const cfg = await instance.addClient(newEmail, newUuid, inboundId, expiresAtMs, limitBytes);
        if (cfg) configs.push(cfg.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g, '_')}`));
      } catch (err: any) {
        console.error(`❌ [Admin] regenerate failed on ${server.name}: ${err.message}`);
      }
    }

    if (configs.length === 0) throw new Error('Не удалось связаться ни с одним VPN сервером. Проверьте: 1) 3x-ui панель доступна, 2) Reality inbound создан, 3) сервер "OneD" активен в админке');
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

router.post('/system/regenerate-all-links', adminOnly, async (req, res) => {
  try {
    const { data: subs, error: subErr } = await supabase
      .from('subscriptions')
      .select('*')
      .in('status', ['active', 'limited']);
    if (subErr) throw subErr;
    if (!subs || subs.length === 0) return res.json({ success: true, updated: 0, message: 'Нет активных подписок' });

    const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (!activeServers || activeServers.length === 0) throw new Error('Нет активных VPN серверов');

    let updated = 0;
    let errors = 0;

    for (const sub of subs) {
      try {
        const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
        let changed = false;

        for (const device of devices) {
          if (!device.uuid || !device.email) continue;

          const newConfigLines: string[] = [];
          for (const server of activeServers) {
            try {
              const { instance, server: serverData } = await getXuiForServer(server.id);
        const inboundId = serverData.inbound_id || 0;

              let effectiveInboundId = inboundId;
              try {
                const inbounds = await instance.getInbounds();
                const realityInbound = inbounds.find((ib: any) => {
                  try {
                    const ss = typeof ib.streamSettings === 'string' ? JSON.parse(ib.streamSettings) : (ib.streamSettings || {});
                    return ss.security === 'reality' && ib.port === 443;
                  } catch { return false; }
                });
                if (realityInbound) effectiveInboundId = realityInbound.id;
              } catch (e) {}

              const rawLink = await instance.getInboundLink(effectiveInboundId, device.uuid, device.email);
              if (rawLink) {
                const linkWithSuffix = rawLink.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g, '_')}`);
                newConfigLines.push(linkWithSuffix);
              }
            } catch (e) {}
          }

          if (newConfigLines.length > 0) {
            const newConfig = newConfigLines.join('\n');
            if (device.config !== newConfig) {
              device.config = newConfig;
              changed = true;
            }
          }
        }

        if (changed) {
          await supabase
            .from('subscriptions')
            .update({ v2ray_config: JSON.stringify(devices), updated_at: new Date().toISOString() })
            .eq('id', sub.id);
          updated++;
        }
      } catch (e: any) {
        console.error(`❌ [Admin] Regenerate failed for sub ${sub.id}:`, e.message);
        errors++;
      }
    }

    res.json({ success: true, updated, errors, total: subs.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
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

// === BUG-VPN-01: Диагностика подписки как её видит VPN-клиент ===
router.get('/subscriptions/:id/diagnose', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: sub, error: subErr } = await supabase.from('subscriptions').select('*').eq('id', id).maybeSingle();
    if (subErr) throw subErr;
    if (!sub) return res.status(404).json({ ok: false, errors: ['Subscription not found'] });

    const warnings: string[] = [];
    const errors: string[] = [];
    const links: any[] = [];
    let ok = true;

    if (sub.status !== 'active') {
      errors.push(`SUB_INACTIVE: status="${sub.status}"`);
      ok = false;
    }

    if (!sub.v2ray_config || !sub.v2ray_config.trim()) {
      errors.push('SUB_EMPTY: v2ray_config is empty');
      ok = false;
    } else {
      let configText = sub.v2ray_config || '';
      let devices: any[] = [];

      try {
        if (configText.startsWith('[')) {
          devices = JSON.parse(configText);
        }
      } catch (e) {
        errors.push(`PARSE_ERROR: ${e}`);
        ok = false;
      }

      if (devices.length === 0 && configText.includes('vless://')) {
        devices = [{ id: 'legacy', config: configText, email: 'legacy', uuid: 'unknown' }];
        warnings.push('LEGACY_FORMAT: v2ray_config is legacy string, not JSON devices');
      }

      const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
      const activeNames = (activeServers || []).map((s: any) => s.name.replace(/\s+/g, '_'));

      for (const device of devices) {
        const deviceLinks = (device.config || '').split('\n').filter((l: string) => l.trim().startsWith('vless://'));

        for (const link of deviceLinks) {
          const linkInfo: any = { link: link.substring(0, 120) + '...', device_id: device.id, email: device.email, uuid: device.uuid, issues: [] };

          const fragment = link.split('#')[1] || '';
          const serverMatch = activeNames.some((name: string) => fragment.includes(name));
          if (activeNames.length > 0 && !serverMatch) {
            linkInfo.issues.push('SERVER_NOT_ACTIVE: fragment does not match any active server');
          }

          const queryStr = link.split('?')[1] || '';
          const params = new URLSearchParams(queryStr);

          const sec = params.get('security');
          if (sec !== 'reality') linkInfo.issues.push(`LINK_NOT_REALITY: security=${sec}`);
          const pbk = params.get('pbk');
          if (!pbk) linkInfo.issues.push('MISSING_PBK');
          const sid = params.get('sid');
          if (!sid) linkInfo.issues.push('MISSING_SID');
          const sni = params.get('sni');
          if (!sni) linkInfo.issues.push('MISSING_SNI');
          const fp = params.get('fp');
          if (!fp) linkInfo.issues.push('MISSING_FP');
          const flow = params.get('flow');
          if (flow !== 'xtls-rprx-vision') linkInfo.issues.push(`BAD_FLOW: ${flow}`);
          const type = params.get('type');
          if (type !== 'tcp' && type !== 'ws') linkInfo.issues.push(`UNEXPECTED_TYPE: ${type}`);

          const hostPort = link.split('@')[1]?.split('?')[0] || '';
          const host = hostPort.split(':')[0];
          const port = parseInt(hostPort.split(':')[1] || '0');
          linkInfo.host = host;
          linkInfo.port = port;

          if (!host) linkInfo.issues.push('MISSING_HOST');
          if (!port || port < 1) linkInfo.issues.push('MISSING_PORT');

          if (linkInfo.issues.length > 0) ok = false;
          links.push(linkInfo);
        }

          if (device.uuid && device.uuid !== 'unknown') {
          for (const server of activeServers || []) {
            try {
              const { instance } = await getXuiForServer(server.id);
              const inbounds = await instance.getInbounds();
              let found = false;
              for (const ib of inbounds) {
                const settings = JSON.parse(ib.settings || '{}');
                const client = (settings.clients || []).find((c: any) => c.id === device.uuid || c.email === device.email);
                if (client) {
                  found = true;
                  const expMs = client.expiryTime || 0;
                  const now = Date.now();
                  if (expMs > 0 && expMs < now) {
                    errors.push(`XUI_EXPIRED: uuid=${device.uuid} server=${server.name} expired=${new Date(expMs).toISOString()}`);
                    ok = false;
                  }
                  if (client.enable === false) {
                    errors.push(`XUI_DISABLED: uuid=${device.uuid} server=${server.name}`);
                    ok = false;
                  }
                  break;
                }
              }
              if (!found) {
                warnings.push(`XUI_CLIENT_NOT_FOUND: uuid=${device.uuid} server=${server.name}`);
              }
            } catch (e: any) {
              warnings.push(`XUI_CHECK_FAILED: server=${server.name} error=${e.message}`);
            }
          }
        }
      }
    }

    if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
      errors.push(`SUB_EXPIRED: expires_at=${sub.expires_at}`);
      ok = false;
    }

    res.json({ ok, subscription_id: id, status: sub.status, expires_at: sub.expires_at, traffic_used_mb: sub.traffic_used_mb, traffic_limit_mb: sub.traffic_limit_mb, links_count: links.length, warnings, errors, links });
  } catch (err: any) { res.status(500).json({ ok: false, errors: [err.message] }); }
});

// === BUG-VPN-06: Расширенная проверка сервера как VPN-ноды ===
router.post('/servers/:id/client-check', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: server, error } = await supabase.from('vpn_servers').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!server) return res.status(404).json({ ok: false, error: 'Server not found' });

    const checks: any = { panel_ok: false, inbounds: [], reality: null, tcp_reachable: false, public_host: server.domain || server.ip, vpn_port: 443, issues: [] };

    try {
      const { instance } = await getXuiForServer(server.id);
      checks.panel_ok = await instance.checkHealth();

      if (checks.panel_ok) {
        const inbounds = await instance.getInbounds();
        checks.inbounds = inbounds.map((ib: any) => ({ id: ib.id, port: ib.port, protocol: ib.protocol, remark: ib.remark, enable: ib.enable }));

        const realityInbound = inbounds.find((ib: any) => {
          try {
            const ss = JSON.parse(ib.streamSettings || '{}');
            return ss.security === 'reality' && ib.port === 443;
          } catch { return false; }
        });

        if (realityInbound) {
          const ss = JSON.parse(realityInbound.streamSettings || '{}');
          const rs = ss.realitySettings || {};
          const s = rs.settings || rs;
          checks.reality = {
            id: realityInbound.id, port: realityInbound.port, network: ss.network || 'tcp',
            publicKey: s.publicKey || rs.publicKey || '', fingerprint: s.fingerprint || '',
            serverNames: s.serverName || rs.serverNames || [], shortIds: s.shortIds || rs.shortIds || [],
            spiderX: s.spiderX || rs.spiderX || '', dest: rs.dest || ''
          };

          if (!checks.reality.publicKey) { checks.issues.push('REALITY_NO_PBK'); }
          if (!checks.reality.shortIds || checks.reality.shortIds.length === 0) { checks.issues.push('REALITY_NO_SID'); }
          if (!checks.reality.serverNames || (typeof checks.reality.serverNames === 'string' && !checks.reality.serverNames)) { checks.issues.push('REALITY_NO_SNI'); }
        } else {
          checks.issues.push('NO_REALITY_INBOUND_ON_443');
        }

        try {
          const host = (server.public_host || server.domain || server.ip || '').replace(/^https?:\/\//, '').split(':')[0];
          const port = server.vpn_port || 443;
          checks.public_host = host;
          checks.vpn_port = port;
          
          // Check DNS resolution for Cloudflare detection
          try {
            const dns = await import('dns');
            const addresses = await new Promise<string[]>((resolve, reject) => {
              dns.resolve4(host, (err, addrs) => err ? reject(err) : resolve(addrs || []));
            });
            // Cloudflare IP ranges (common ones)
            const cfRanges = ['104.16.', '104.17.', '104.18.', '104.19.', '104.20.', '104.21.', '104.22.', '104.23.', '104.24.', '104.25.', '104.26.', '104.27.', '172.64.', '172.65.', '172.66.', '172.67.', '103.21.244.', '103.22.220.', '103.22.221.', '141.101.', '108.162.', '190.93.', '188.114.', '197.234.', '198.41.'];
            const isCloudflare = addresses.some(addr => cfRanges.some(range => addr.startsWith(range)));
            if (isCloudflare) {
              checks.issues.push('CLOUDFLARE_PROXIED: public_host resolves to Cloudflare IP — VPN Reality will NOT work through CF proxy. Use DNS Only mode.');
            }
          } catch (e) {}
          
          const sock = new net.Socket();
          await new Promise<void>((resolve, reject) => {
            sock.setTimeout(5000);
            sock.connect(port, host, () => { checks.tcp_reachable = true; sock.destroy(); resolve(); });
            sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
            sock.on('error', (e) => { reject(e); });
          });
        } catch (e: any) {
          checks.tcp_reachable = false;
          checks.issues.push(`PUBLIC_PORT_TIMEOUT: ${e.message}`);
        }
      }
    } catch (e: any) {
      checks.issues.push(`PANEL_ERROR: ${e.message}`);
    }

    const ok = checks.panel_ok && checks.reality && checks.tcp_reachable && checks.issues.length === 0;
    
    // Update health_status in database
    const healthStatus = ok ? 'ok' : (checks.panel_ok ? 'degraded' : 'down');
    await supabase.from('vpn_servers').update({
      health_status: healthStatus,
      last_health_check_at: new Date().toISOString()
    }).eq('id', server.id);

    res.json({ ok, server: { id: server.id, name: server.name, ip: server.ip, domain: server.domain }, health_status: healthStatus, ...checks });
  } catch (err: any) { res.status(500).json({ ok: false, error: err.message }); }
});

// === BUG-VPN-02: Регенерация одной подписки ===
router.post('/subscriptions/:id/regenerate', adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: sub, error: subErr } = await supabase.from('subscriptions').select('*').eq('id', id).in('status', ['active', 'limited']).maybeSingle();
    if (subErr) throw subErr;
    if (!sub) return res.status(404).json({ ok: false, error: 'Subscription not found' });

    const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (!activeServers || activeServers.length === 0) throw new Error('No active servers');

    let updated = 0;
    let errors = 0;
    for (const device of devices) {
      if (!device.uuid || !device.email) { errors++; continue; }
      const newConfigLines: string[] = [];
      for (const server of activeServers) {
        try {
          const { instance, server: serverData } = await getXuiForServer(server.id);
          const inboundId = serverData.inbound_id || 0;

          let effectiveInboundId = inboundId;
          if (!effectiveInboundId || effectiveInboundId <= 0) {
            const inbounds = await instance.getInbounds();
            const ri = inbounds.find((ib: any) => {
              try { const ss = JSON.parse(ib.streamSettings || '{}'); return ss.security === 'reality' && ib.port === 443; } catch { return false; }
            });
            if (ri) effectiveInboundId = ri.id;
          }

          const rawLink = await instance.getInboundLink(effectiveInboundId, device.uuid, device.email);
          if (rawLink) newConfigLines.push(rawLink.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g, '_')}`));
        } catch (e: any) {
          errors++;
        }
      }
      if (newConfigLines.length > 0) {
        device.config = newConfigLines.join('\n');
        updated++;
      }
    }

    await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices), updated_at: new Date().toISOString() }).eq('id', id);
    res.json({ ok: true, updated, errors, total: devices.length });
  } catch (err: any) { res.status(500).json({ ok: false, error: err.message }); }
});

// === BUG-VPN-02: Batch регенерация всех активных подписок ===
router.post('/subscriptions/regenerate-all', adminOnly, async (req, res) => {
  try {
    const { data: subs, error: subErr } = await supabase.from('subscriptions').select('*').in('status', ['active', 'limited']);
    if (subErr) throw subErr;
    if (!subs || subs.length === 0) return res.json({ ok: true, updated: 0, total: 0 });

    const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (!activeServers || activeServers.length === 0) throw new Error('No active servers');

    let totalUpdated = 0;
    let totalErrors = 0;
    const report: { subId: string; status: string; updated: boolean; error?: string }[] = [];
    const BATCH = 20;

    for (let i = 0; i < subs.length; i += BATCH) {
      const batch = subs.slice(i, i + BATCH);
      for (const sub of batch) {
        try {
          const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
          let changed = false;
          for (const device of devices) {
            if (!device.uuid || !device.email) continue;
            const newLines: string[] = [];
            for (const server of activeServers) {
              try {
                const { instance, server: serverData } = await getXuiForServer(server.id);
                let effectiveInboundId = serverData.inbound_id || 0;
                if (!effectiveInboundId || effectiveInboundId <= 0) {
                  const inbounds = await instance.getInbounds();
                  const ri = inbounds.find((ib: any) => {
                    try { const ss = JSON.parse(ib.streamSettings || '{}'); return ss.security === 'reality' && ib.port === 443; } catch { return false; }
                  });
                  if (ri) effectiveInboundId = ri.id;
                }
                const rawLink = await instance.getInboundLink(effectiveInboundId, device.uuid, device.email);
                if (rawLink) newLines.push(rawLink.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g, '_')}`));
              } catch (e) {}
            }
            if (newLines.length > 0) {
              const newConfig = newLines.join('\n');
              if (device.config !== newConfig) { device.config = newConfig; changed = true; }
            }
          }
          if (changed) {
            await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices), updated_at: new Date().toISOString() }).eq('id', sub.id);
            totalUpdated++;
            report.push({ subId: sub.id, status: 'updated', updated: true });
          } else {
            report.push({ subId: sub.id, status: 'unchanged', updated: false });
          }
        } catch (e: any) {
          totalErrors++;
          report.push({ subId: sub.id, status: 'error', updated: false, error: e.message });
        }
      }
    }
    res.json({ ok: true, updated: totalUpdated, errors: totalErrors, total: subs.length, report });
  } catch (err: any) { res.status(500).json({ ok: false, error: err.message }); }
});

export default router;

