import { Router } from 'express';
import { supabase } from '../services/supabase';
import { authenticateUser } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';
import { MaintenanceService } from '../services/maintenance.service';
import { parseVpnDevices, VpnDevice } from '../utils/vpn';
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
      const { instance } = await getXuiForServer(server.id);
      const rawConfig = await instance.addClient(email, uuid, params.inboundId, params.expiresAt.getTime(), limitBytes);
      if (rawConfig) {
        const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g, '_')}`);
        configLines.push(configWithSuffix);
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
    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
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
      const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
      if (!activeServers || activeServers.length === 0) throw new Error('Нет активных серверов для подключения');

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
          await supabase.rpc('append_vpn_device', { 
            p_sub_id: existingSub.id, 
            p_device_data: newDevice 
          });
          
          subscriptionExpiresAt = new Date(Math.max(new Date(existingSub.expires_at).getTime() || 0, expiresAt.getTime()));
          devices.push(newDevice);
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
          
          // DATA-002: Reset traffic on renewal
          for (const server of activeServers) {
            const { instance } = await getXuiForServer(server.id);
            for (const dev of devices) {
              await instance.resetClientTraffic(inboundId, dev.email).catch(() => {});
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

        const { error: insertError } = await supabase.from('subscriptions').insert({
          user_id: userId,
          status: 'active',
          plan_type: planId,
          expires_at: expiresAt.toISOString(),
          v2ray_config: JSON.stringify(devices),
          traffic_limit_mb: trafficLimitMb,
          traffic_used_mb: 0,
          device_limit: globalDeviceLimit,
          server_id: activeServers[0].id
        });
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
      .eq('status', 'active')
      .maybeSingle();

    if (!sub) return res.status(404).json({ error: 'Активная подписка не найдена' });

    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const targetIdx = devices.findIndex(d => d.id === deviceId);
    if (targetIdx === -1) return res.status(404).json({ error: 'Устройство не найдено' });

    const target = devices[targetIdx];
    const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (!activeServers || activeServers.length === 0) throw new Error('Нет активных серверов');

    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const limitBytes = (sub.traffic_limit_mb || 102400) * 1024 * 1024;
    const newEmail = `user_${userId.slice(0, 5)}_${Math.random().toString(36).substring(2, 5)}_reg`;
    const newUuid = crypto.randomUUID();
    const expiresAtMs = new Date(sub.expires_at).getTime();

    let configLines: string[] = [];
    for (const server of activeServers) {
      try {
        const { instance } = await getXuiForServer(server.id);
        // Удаляем старый ключ перед созданием нового
        if (target.uuid && target.email) await instance.deleteClient(target.uuid, target.email).catch(() => {});
        const rawConfig = await instance.addClient(newEmail, newUuid, inboundId, expiresAtMs, limitBytes);
        if (rawConfig) {
          const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`);
          configLines.push(configWithSuffix);
        }
      } catch (e) {}
    }

    if (configLines.length === 0) throw new Error('Не удалось связаться с VPN серверами');

    devices[targetIdx] = { ...target, config: configLines.join('\n'), email: newEmail, uuid: newUuid };
    await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices) }).eq('id', sub.id);

    res.json({ success: true, message: 'Ключ успешно перегенерирован', device: devices[targetIdx] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🎁 Активация промокода
router.post('/promocode/apply', authenticateUser, async (req: any, res) => {
  const { code } = req.body;
  const userId = req.user.id;
  
  try {
    // Временная заглушка для промокода
    if (code?.toUpperCase() === 'TRIAL24') {
      res.json({ success: true, message: 'Промокод активирован: +24 часа доступа!' });
    } else {
      res.status(400).json({ error: 'Неверный или просроченный промокод' });
    }
  } catch (err: any) {
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

export default router;
