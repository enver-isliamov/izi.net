import { Router } from 'express';
import { supabase } from '../services/supabase';
import { authenticateUser } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';
import { MaintenanceService } from '../services/maintenance.service';
import { parseVpnDevices, VpnDevice, getPublishedVlessPorts } from '../utils/vpn';
import crypto from 'crypto';

const router = Router();

// Вспомогательная функция для получения настроек из БД с откатом на ENV
async function getSystemSetting(key: string, fallback: string = ''): Promise<string> {
  try {
    const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
    return (data?.value || process.env[key] || fallback).trim();
  } catch (e) {
    return (process.env[key] || fallback).trim();
  }
}

const PLAN_OPTIONS: Record<string, { days: number; months: number }> = {
  '1m': { days: 30, months: 1 },
  '2m': { days: 60, months: 2 },
  '6m': { days: 180, months: 6 },
  '12m': { days: 365, months: 12 }
};

async function getServerPlan(planId: string) {
  const monthlyPriceStr = await getSystemSetting('MONTHLY_PRICE', '100');
  const basePrice = parseInt(monthlyPriceStr, 10) || 100;
  const selected = PLAN_OPTIONS[planId];
  if (!selected) return null;
  return {
    ...selected,
    pricePerDevice: Math.round(basePrice * selected.months)
  };
}

function clampInt(value: unknown, min: number, max: number) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

async function provisionDeviceOnServers(params: {
  userId: string;
  activeServers: any[];
  inboundId: number;
  expiresAt: Date;
  trafficLimitMb: number;
  serverType: string;
  label: string;
  id: string;
}) {
  const email = `user_${params.userId.slice(0, 8)}_${Math.random().toString(36).substring(2, 6)}`;
  const uuid = crypto.randomUUID();
  const limitBytes = params.trafficLimitMb * 1024 * 1024;
  const configLines: string[] = [];

  for (const server of params.activeServers) {
    try {
      const { instance, server: serverData } = await getXuiForServer(server.id);
      
      let effectiveInboundId = serverData.inbound_id || params.inboundId;
      if (!effectiveInboundId || effectiveInboundId <= 0) {
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
      }

            try {
        const inbounds = await instance.getInbounds();
        const pubPorts = await getPublishedVlessPorts();
        const realityInbounds = inbounds.filter((ib: any) => {
          try {
            const ss = typeof ib.streamSettings === 'string' ? JSON.parse(ib.streamSettings) : (ib.streamSettings || {});
            return ss.security === 'reality' && ib.enable !== false && (!pubPorts || pubPorts.includes(ib.port));
          } catch { return false; }
        });
        for (const ri of realityInbounds) {
          try {
            const inboundEmail = ri.id === effectiveInboundId ? email : `${email}_${ri.port}`;
            await instance.addClient(inboundEmail, uuid, ri.id, params.expiresAt.getTime(), limitBytes);
            const rawLink = await instance.getInboundLink(ri.id, uuid, inboundEmail);
            if (rawLink) {
              configLines.push(rawLink.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g, '_')}`));
            }
          } catch (e: any) {
            console.error(`XUI provisioning failed on ${server.name} inbound ${ri.id}:`, e.message);
          }
        }
      } catch (e: any) {
        console.error(`XUI provisioning failed on ${server.name}:`, e.message);
        throw e;
      }
    } catch (e: any) {
      console.error(`XUI provisioning failed on ${server.name}:`, e.message);
    }
  }

  if (configLines.length === 0) {
    throw new Error('Не удалось создать конфигурацию ни на одном VPN сервере. Проверьте связь с панелями.');
  }

  return {
    id: params.id,
    label: params.label,
    config: configLines.join('\n'),
    email,
    uuid,
    expiresAt: params.expiresAt.toISOString(),
    serverType: params.serverType,
    trafficUsedBytes: 0,
    serverId: params.activeServers[0].id
  } satisfies VpnDevice;
}

async function handleSubscriptionBuy(req: any, res: any) {
  const { userId, planId, serverType, deviceLimit, deviceName, forceNew, targetDeviceId } = req.body;
  if (req.user.id !== userId) return res.status(401).json({ error: 'Unauthorized ID mismatch' });

  try {
    const plan = await getServerPlan(planId);
    if (!plan) return res.status(400).json({ error: 'Invalid subscription plan' });

    const globalDeviceLimit = clampInt(await getSystemSetting('DEVICE_LIMIT', '2'), 1, 20);
    const normalizedServerType = String(serverType || 'WIFI').toUpperCase();
    const inboundId = 0;
    const trafficLimitMb = 102400;
    const now = new Date();

    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    const existingDevices = existingSub ? parseVpnDevices(existingSub.v2ray_config, existingSub.expires_at, existingSub.server_type) : [];
    const requestedDeviceCount = existingSub
      ? (forceNew || targetDeviceId ? 1 : Math.max(existingDevices.length, 1))
      : clampInt(deviceLimit, 1, globalDeviceLimit);
    const price = plan.pricePerDevice * requestedDeviceCount;

    // CORE-005: Atomic balance deduction using RPC
    const { data: deductSuccess, error: deductError } = await supabase.rpc('deduct_user_balance', { 
      p_user_id: userId, 
      p_amount: price 
    });

    if (deductError || !deductSuccess) {
      return res.status(400).json({ error: 'Недостаточно средств на балансе или ошибка списания' });
    }

    try {
      const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true).eq('health_status', 'ok');
      if (!activeServers || activeServers.length === 0) throw new Error('Нет здоровых серверов для подключения. Попробуйте позже.');

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + plan.days);

      let devices: VpnDevice[] = [];
      let subscriptionExpiresAt = expiresAt;

      if (existingSub) {
        devices = existingDevices;

        if (forceNew) {
          if (devices.length >= globalDeviceLimit) throw new Error(`Достигнут лимит устройств (${globalDeviceLimit})`);
          const newDevice = await provisionDeviceOnServers({
            userId,
            activeServers,
            inboundId,
            expiresAt,
            trafficLimitMb,
            serverType: normalizedServerType,
            label: deviceName || `Устройство ${devices.length + 1}`,
            id: `device_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
          });
          
          // CORE-004: Atomic device append
          const { error: rpcError } = await supabase.rpc('append_vpn_device', { 
            p_sub_id: existingSub.id, 
            p_device_data: newDevice 
          });
          if (rpcError) {
            console.warn('⚠️ [User] append_vpn_device RPC failed, falling back to direct update:', rpcError.message);
            devices.push(newDevice);
            const { error: directError } = await supabase.from('subscriptions').update({
              v2ray_config: JSON.stringify(devices),
              updated_at: new Date().toISOString()
            }).eq('id', existingSub.id);
            if (directError) throw new Error('Не удалось добавить устройство в подписку');
          } else {
            subscriptionExpiresAt = new Date(Math.max(new Date(existingSub.expires_at).getTime() || 0, expiresAt.getTime()));
            devices.push(newDevice);
          }
        } else if (targetDeviceId) {
          const targetIdx = devices.findIndex((device) => device.id === targetDeviceId);
          if (targetIdx === -1) throw new Error('Устройство не найдено');
          
          const updatedDevice = await provisionDeviceOnServers({
            userId,
            activeServers,
            inboundId,
            expiresAt,
            trafficLimitMb,
            serverType: devices[targetIdx].serverType || normalizedServerType,
            label: deviceName || devices[targetIdx].label || 'Устройство',
            id: devices[targetIdx].id
          });
          
          devices[targetIdx] = updatedDevice;
          subscriptionExpiresAt = new Date(Math.max(new Date(existingSub.expires_at).getTime() || 0, expiresAt.getTime()));
        } else {
          // Renewal
          const currentExpiry = new Date(existingSub.expires_at);
          const renewalBase = currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
          subscriptionExpiresAt = new Date(renewalBase);
          subscriptionExpiresAt.setDate(subscriptionExpiresAt.getDate() + plan.days);
          devices = devices.map((device) => ({ ...device, expiresAt: subscriptionExpiresAt.toISOString() }));

          // DATA-002: Reset traffic + sync expiry to panel on renewal
          const renewalMs = subscriptionExpiresAt.getTime();
          for (const server of activeServers) {
            try {
              const { instance, server: serverData } = await getXuiForServer(server.id);
              const effectiveInboundId = serverData.inbound_id || inboundId;
              for (const dev of devices) {
                await instance.resetClientTraffic(effectiveInboundId, dev.email).catch(() => {});
                if (dev.uuid && dev.email) {
                  await instance.updateClient(dev.email, dev.uuid, effectiveInboundId, renewalMs, 0).catch(() => {});
                }
              }
            } catch (e: any) {
              console.warn(`⚠️ [User] Renewal sync failed for ${server.name}: ${e.message}`);
            }
          }
        }

        // Final update for expiry and config (if not forceNew which was handled atomically)
        if (!forceNew) {
           const { error: updateError } = await supabase.from('subscriptions').update({
            expires_at: subscriptionExpiresAt.toISOString(),
            v2ray_config: JSON.stringify(devices),
            traffic_used_mb: targetDeviceId ? undefined : 0, // Reset traffic on renewal
            device_limit: Math.max(Number(existingSub.device_limit || 0), globalDeviceLimit),
            updated_at: new Date().toISOString()
          }).eq('id', existingSub.id);
          if (updateError) throw updateError;
        } else {
           // If forceNew, we still need to update the subscription expiry if it changed
           await supabase.from('subscriptions').update({
             expires_at: subscriptionExpiresAt.toISOString(),
             updated_at: new Date().toISOString()
           }).eq('id', existingSub.id);
        }
      } else {
        // New Subscription
        for (let i = 0; i < requestedDeviceCount; i += 1) {
          devices.push(await provisionDeviceOnServers({
            userId,
            activeServers,
            inboundId,
            expiresAt,
            trafficLimitMb,
            serverType: normalizedServerType,
            label: i === 0 ? (deviceName || 'Основное устройство') : `Устройство ${i + 1}`,
            id: i === 0 ? 'primary' : `device_${Date.now()}_${i}`
          }));
        }

        // SUB-001: в БД уникальный индекс на user_id (subscriptions_user_id_key) —
        // после истечения подписки новая строка даёт duplicate key. Используем upsert:
        // для нового пользователя — INSERT, для существующей (в т.ч. expired) — UPDATE.
        const { error: insertError } = await supabase.from('subscriptions').upsert({
          user_id: userId,
          status: 'active',
          plan_type: planId,
          expires_at: expiresAt.toISOString(),
          v2ray_config: JSON.stringify(devices),
          traffic_limit_mb: trafficLimitMb,
          traffic_used_mb: 0,
          device_limit: globalDeviceLimit,
          server_id: activeServers[0].id
        }, { onConflict: 'user_id' });
        if (insertError) throw insertError;
      }

      // Record transaction
      await supabase.from('transactions').insert({
        user_id: userId,
        amount: -price,
        currency: 'RUB',
        type: 'withdrawal',
        status: 'completed',
        description: `Покупка подписки: ${planId}`
      });

      return res.json({ success: true, message: 'Подписка успешно оформлена', charged: price, devices });
    } catch (err) {
      // ROLLBACK: Refund balance if anything failed after deduction
      console.error('Provisioning failed, refunding balance:', err);
      await supabase.rpc('refund_user_balance', { p_user_id: userId, p_amount: price });
      throw err;
    }
  } catch (err: any) {
    console.error('Subscription purchase failed:', err);
    return res.status(500).json({ error: err.message });
  }
}

router.get('/subscription/plans', async (req, res) => {
  try {
    const monthlyPriceStr = await getSystemSetting('MONTHLY_PRICE', '100');
    const basePrice = parseInt(monthlyPriceStr, 10) || 100;
    const deviceLimit = parseInt(await getSystemSetting('DEVICE_LIMIT', '2'));

    // Все цены округляются до целых чисел (Fix Платежей)
    const periods = [
      { id: '1m', label: '1 месяц', days: 30, price: basePrice },
      { id: '2m', label: '2 месяца', days: 60, price: Math.round(basePrice * 2) },
      { id: '6m', label: '6 месяцев', days: 180, price: Math.round(basePrice * 6) },
      { id: '12m', label: '1 год', days: 365, price: Math.round(basePrice * 12) }
    ];

    const serverTypes = [
      { id: 'wifi', label: 'Wi-Fi / Mobile', price: 0, description: 'Стандартное Reality подключение' }
    ];

    res.json({ periods, serverTypes, deviceLimit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 💰 Покупка или продление подписки (Ядро системы)
router.post('/subscription/buy', authenticateUser, async (req: any, res) => {
  return handleSubscriptionBuy(req, res);
});

router.post('/user/devices/:deviceId/regenerate', authenticateUser, async (req: any, res) => {
  const { deviceId } = req.params;
  const userId = req.user.id;
  
  try {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['active', 'limited'])
      .maybeSingle();

    if (!sub) return res.status(404).json({ error: 'Активная подписка не найдена' });

    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const targetIdx = devices.findIndex(d => d.id === deviceId);
    if (targetIdx === -1) return res.status(404).json({ error: 'Устройство не найдено' });

    const target = devices[targetIdx];
    const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (!activeServers || activeServers.length === 0) throw new Error('Нет активных серверов');

    const limitBytes = (sub.traffic_limit_mb || 102400) * 1024 * 1024;
    const newEmail = `user_${userId.slice(0, 5)}_${Math.random().toString(36).substring(2, 5)}_reg`;
    const newUuid = crypto.randomUUID();
    const expiresAtMs = new Date(sub.expires_at).getTime();

    let configLines: string[] = [];
    for (const server of activeServers) {
      try {
        const { instance, server: serverData } = await getXuiForServer(server.id);
        
        let effectiveInboundId = serverData.inbound_id || 0;
        if (!effectiveInboundId || effectiveInboundId <= 0) {
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
        }

        if (target.uuid && target.email) await instance.deleteClient(target.uuid, target.email).catch(() => {});
        const rawConfig = await instance.addClient(newEmail, newUuid, effectiveInboundId, expiresAtMs, limitBytes);
        if (rawConfig) {
          const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`);
          configLines.push(configWithSuffix);
        }
      } catch (e: any) {
        console.error(`❌ [User] regenerate failed for device ${deviceId} on ${server.name}: ${e.message}`);
      }
    }

    if (configLines.length === 0) throw new Error('Не удалось связаться с VPN серверами. Проверьте настройки сервера в админке.');

    devices[targetIdx] = { ...target, config: configLines.join('\n'), email: newEmail, uuid: newUuid };
    await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices) }).eq('id', sub.id);

    res.json({ success: true, message: 'Ключ успешно перегенерирован', device: devices[targetIdx] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🎁 Активация промокода (TRIAL-001: заглушка не создавала подписку — теперь создаёт)
router.post('/promocode/apply', authenticateUser, async (req: any, res) => {
  const { code } = req.body;
  const userId = req.user.id;

  try {
    if (code?.toUpperCase() !== 'TRIAL24') {
      return res.status(400).json({ error: 'Неверный или просроченный промокод' });
    }

    // Уже есть активная подписка? Не перезаписываем.
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (existingSub && existingSub.status === 'active' && new Date(existingSub.expires_at).getTime() > Date.now()) {
      return res.json({ success: true, message: 'У вас уже есть активная подписка' });
    }

    // Здоровые серверы (health-gate как в buy)
    const { data: activeServers } = await supabase
      .from('vpn_servers')
      .select('*')
      .eq('is_active', true)
      .eq('health_status', 'ok');
    if (!activeServers || activeServers.length === 0) {
      return res.status(500).json({ error: 'Нет здоровых серверов для подключения. Попробуйте позже.' });
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const deviceLimit = clampInt(await getSystemSetting('DEVICE_LIMIT', '2'), 1, 20);

    // Провижиним устройство на 3x-ui (как в buy)
    const device = await provisionDeviceOnServers({
      userId,
      activeServers,
      inboundId: 0,
      expiresAt,
      trafficLimitMb: 102400,
      serverType: 'WIFI',
      label: 'Основное устройство',
      id: 'primary'
    });

    // SUB-001: upsert по user_id — не падаем на duplicate key после истечения
    const { error: subError } = await supabase.from('subscriptions').upsert({
      user_id: userId,
      status: 'active',
      plan_type: 'trial',
      expires_at: expiresAt.toISOString(),
      v2ray_config: JSON.stringify([device]),
      traffic_limit_mb: 102400,
      traffic_used_mb: 0,
      device_limit: deviceLimit,
      server_id: activeServers[0].id
    }, { onConflict: 'user_id' });
    if (subError) throw subError;

    res.json({ success: true, message: 'Промокод активирован: +24 часа доступа!' });
  } catch (err: any) {
    console.error('Promocode activation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- СИНХРОНИЗАЦИЯ И СЕРВИСНЫЕ МАРШРУТЫ ---

// Удаление устройства пользователем
router.post('/subscription/device/delete', authenticateUser, async (req: any, res) => {
  const { userId, deviceId } = req.body;
  if (req.user.id !== userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (!sub) return res.status(404).json({ error: 'Подписка не найдена' });

    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const targetIdx = devices.findIndex(d => d.id === deviceId);
    if (targetIdx === -1) return res.status(404).json({ error: 'Устройство не найдено' });
    if (targetIdx === 0) return res.status(400).json({ error: 'Нельзя удалить основное устройство' });

    const target = devices[targetIdx];
    const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);

    // Удаление клиента со всех серверов для чистоты базы 3x-ui
    for (const server of (activeServers || [])) {
      try {
        const { instance } = await getXuiForServer(server.id);
        if (target.uuid && target.email) await instance.deleteClient(target.uuid, target.email).catch(() => {});
      } catch (e) {}
    }

    devices.splice(targetIdx, 1);
    await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices), updated_at: new Date().toISOString() }).eq('id', sub.id);

    res.json({ success: true, message: 'Устройство удалено' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Получение истории транзакций для кошелька
router.get('/transactions', authenticateUser, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { data: transactions, error } = await supabase.from('transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(transactions || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// USER-FLOWS: серверные эндпоинты для сценариев личного кабинета.
// Раньше фронтенд писал в Supabase напрямую и падал: RLS (403/42501) и
// NOT NULL (telegram_linking_tokens.token). Теперь пишет сервер под service-role.
// ============================================================================

function parseJsonDevices(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Свежий расход трафика по устройствам подписки (сумма up+down из панели). */
async function refreshTrafficUsed(sub: any): Promise<number> {
  const devices = parseJsonDevices(sub?.v2ray_config);
  let totalBytes = 0;
  let anyOk = false;
  for (const device of devices) {
    if (!device?.email || !device?.serverId) continue;
    try {
      const { instance } = await getXuiForServer(device.serverId);
      const traffic: any = await instance.getClientTraffic(device.email);
      if (traffic) {
        totalBytes += Number(traffic.up || 0) + Number(traffic.down || 0);
        anyOk = true;
      }
    } catch (e: any) {
      console.warn(`[User] traffic refresh failed for ${device.email}: ${e.message}`);
    }
  }
  const stored = Number(sub?.traffic_used_mb || 0);
  if (!anyOk) return stored;
  const freshMb = Math.max(0, Math.round(totalBytes / (1024 * 1024)));
  if (freshMb !== stored) {
    try {
      await supabase.from('subscriptions').update({ traffic_used_mb: freshMb, updated_at: new Date().toISOString() }).eq('id', sub.id);
    } catch (e: any) {
      console.warn(`[User] traffic save failed: ${e.message}`);
    }
  }
  return freshMb;
}

// 1. Сводка личного кабинета: пользователь, подписка (трафик + срок), настройки
router.get('/profile-summary', authenticateUser, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const [{ data: user }, { data: sub }, { data: settings }] = await Promise.all([
      supabase.from('users').select('*').eq('id', userId).maybeSingle(),
      supabase.from('subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('notification_settings').select('*').eq('user_id', userId).maybeSingle()
    ]);

    let trafficUsedMb = Number(sub?.traffic_used_mb || 0);
    if (sub) trafficUsedMb = await refreshTrafficUsed(sub);

    const limitMb = Number(sub?.traffic_limit_mb || 102400);
    const expiresAt = sub?.expires_at || null;
    const daysLeft = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)) : null;
    const devices = parseJsonDevices(sub?.v2ray_config);

    res.json({
      user: {
        id: userId,
        email: user?.email || req.user.email || null,
        name: user?.name || null,
        referral_code: user?.referral_code || null,
        telegram_id: user?.telegram_id || null,
        telegram_linked: Boolean(user?.telegram_linked),
        balance: Number(user?.balance || 0),
        role: user?.role || 'user'
      },
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            expires_at: expiresAt,
            days_left: daysLeft,
            traffic_used_mb: trafficUsedMb,
            traffic_limit_mb: limitMb,
            traffic_used_gb: Number((trafficUsedMb / 1024).toFixed(2)),
            traffic_limit_gb: Number((limitMb / 1024).toFixed(1)),
            traffic_percent: limitMb > 0 ? Math.min(100, Math.round((trafficUsedMb / limitMb) * 100)) : 0,
            device_limit: Number(sub.device_limit || 0),
            devices_count: devices.length,
            is_expired: expiresAt ? new Date(expiresAt).getTime() < Date.now() : false
          }
        : null,
      devices: devices.map((d: any) => ({
        id: d.id,
        label: d.label,
        email: d.email,
        expiresAt: d.expiresAt || expiresAt,
        trafficUsedBytes: Number(d.trafficUsedBytes || 0)
      })),
      settings: settings || null
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Реферальный код: выдать, если ещё не выдан (клиентская запись блокировалась RLS)
router.post('/referral/ensure', authenticateUser, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { data: user } = await supabase.from('users').select('referral_code').eq('id', userId).maybeSingle();
    if (user?.referral_code) return res.json({ referral_code: user.referral_code, created: false });

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = crypto.randomBytes(4).toString('hex');
      const { error } = await supabase.from('users').update({ referral_code: code }).eq('id', userId);
      if (!error) return res.json({ referral_code: code, created: true });
      if (!/duplicate|unique|referral_code/i.test(error.message || '')) throw error;
    }
    throw new Error('Не удалось подобрать уникальный реферальный код');
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Токен привязки Telegram (раньше вставка с клиента не проходила: токен не доходил)
router.post('/telegram/link-token', authenticateUser, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const token = crypto.randomBytes(8).toString('hex');
    const { error } = await supabase.from('telegram_linking_tokens').insert({ token, user_id: userId });
    if (error) throw error;
    res.json({ token });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Настройки уведомлений (раньше upsert блокировал RLS)
const NOTIFICATION_KEYS = ['subscription_expiring', 'subscription_expired', 'payment_success', 'news', 'promo'];

router.get('/notification-settings', authenticateUser, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { data } = await supabase.from('notification_settings').select('*').eq('user_id', userId).maybeSingle();
    res.json(data || { user_id: userId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/notification-settings', authenticateUser, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const patch: Record<string, any> = { user_id: userId };
    for (const key of NOTIFICATION_KEYS) {
      if (typeof req.body?.[key] === 'boolean') patch[key] = req.body[key];
    }
    if (Object.keys(patch).length === 1) return res.status(400).json({ error: 'Нет настроек для сохранения' });

    const { data: existing } = await supabase.from('notification_settings').select('id').eq('user_id', userId).maybeSingle();
    if (existing) {
      const { error } = await supabase.from('notification_settings').update(patch).eq('user_id', userId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('notification_settings').insert(patch);
      if (error) throw error;
    }
    const { data: saved } = await supabase.from('notification_settings').select('*').eq('user_id', userId).maybeSingle();
    res.json(saved || patch);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Поддержка: тикеты и сообщения (клиентские вставки блокировал RLS)
router.get('/support/tickets', authenticateUser, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/support/tickets', authenticateUser, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Пустое сообщение' });
    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        user_id: userId,
        subject: String(req.body?.subject || 'Поддержка izinet').slice(0, 200),
        message: message.slice(0, 4000),
        status: 'open',
        priority: 'medium'
      })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/support/messages/:ticketId', authenticateUser, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const { data: ticket } = await supabase.from('support_tickets').select('id, user_id').eq('id', req.params.ticketId).maybeSingle();
    if (!ticket || ticket.user_id !== userId) return res.status(403).json({ error: 'Тикет не найден' });
    const { data, error } = await supabase
      .from('support_messages')
      .select('*')
      .eq('ticket_id', req.params.ticketId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/support/messages', authenticateUser, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const ticketId = String(req.body?.ticket_id || '').trim();
    const content = String(req.body?.content || '').trim();
    if (!ticketId || !content) return res.status(400).json({ error: 'Нужны ticket_id и content' });

    const { data: ticket } = await supabase.from('support_tickets').select('id, user_id').eq('id', ticketId).maybeSingle();
    if (!ticket || ticket.user_id !== userId) return res.status(403).json({ error: 'Тикет не найден' });

    const { data, error } = await supabase
      .from('support_messages')
      .insert({ ticket_id: ticketId, sender: 'user', content: content.slice(0, 4000) })
      .select()
      .single();
    if (error) throw error;
    try {
      await supabase.from('support_tickets').update({ updated_at: new Date().toISOString(), status: 'open' }).eq('id', ticketId);
    } catch (e: any) {}
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
