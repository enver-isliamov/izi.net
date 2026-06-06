import { Router } from 'express';
import { supabase } from '../services/supabase';
import { authenticateUser } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';
import { parseVpnDevices, VpnDevice } from '../utils/vpn';
import crypto from 'crypto';

const router = Router();

// Helper to get settings from DB with ENV fallback
async function getSystemSetting(key: string, fallback: string = ''): Promise<string> {
  try {
    const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
    return (data?.value || process.env[key] || fallback).trim();
  } catch (e) {
    return (process.env[key] || fallback).trim();
  }
}

// 💰 Plans list
router.get('/subscription/plans', async (req, res) => {
  try {
    const monthlyPriceStr = await getSystemSetting('MONTHLY_PRICE', '100');
    const basePrice = parseInt(monthlyPriceStr, 10) || 100;
    const deviceLimit = parseInt(await getSystemSetting('DEVICE_LIMIT', '2'));

    const periods = [
      { id: '1m', label: '1 месяц', days: 30, price: basePrice },
      { id: '2m', label: '2 месяца', days: 60, price: Math.round(basePrice * 2) },
      { id: '6m', label: '6 месяцев', days: 180, price: Math.round(basePrice * 6) },
      { id: '12m', label: '1 год', days: 365, price: Math.round(basePrice * 12) }
    ];

    const serverTypes = [
      { id: 'wifi', label: 'Wi-Fi / Mobile', price: 0, description: 'Стандартное подключение' }
    ];

    res.json({ periods, serverTypes, deviceLimit });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 💰 Buy/Renew Subscription
router.post('/subscription/buy', authenticateUser, async (req: any, res) => {
  const { userId, planId, price, durationDays, serverType, deviceLimit, forceNew, targetDeviceId, deviceName } = req.body;
  if (req.user.id !== userId) return res.status(401).json({ error: 'Unauthorized ID mismatch' });

  try {
    // 1. Проверка баланса
    const { data: balanceData } = await supabase.from('balances').select('amount').eq('user_id', userId).maybeSingle();
    if (!balanceData || balanceData.amount < price) return res.status(400).json({ error: 'Insufficient balance' });

    // 2. Получение активных серверов
    const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (!activeServers || activeServers.length === 0) throw new Error('Нет активных серверов для подключения');

    // 3. Генерация учетных данных
    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const trafficLimitMb = 102400; // 100 GB default
    const limitBytes = trafficLimitMb * 1024 * 1024;
    const email = `user_${userId.slice(0, 8)}_${Math.random().toString(36).substring(2, 6)}`;
    const uuid = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (durationDays || 30));

    // 4. Создание клиента на всех серверах
    let configLines: string[] = [];
    for (const server of activeServers) {
      try {
        const { instance } = await getXuiForServer(server.id);
        const rawConfig = await instance.addClient(email, uuid, inboundId, expiresAt.getTime(), limitBytes);
        if (rawConfig) {
          const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`);
          configLines.push(configWithSuffix);
        }
      } catch (e: any) {
        console.error(`❌ Ошибка на сервере ${server.name}:`, e.message);
      }
    }

    if (configLines.length === 0) throw new Error('Не удалось создать конфигурацию ни на одном сервере');

    const devices: VpnDevice[] = [{
      id: 'primary',
      label: deviceName || 'Основное устройство',
      config: configLines.join('\n'),
      email,
      uuid,
      expiresAt: expiresAt.toISOString(),
      serverType: serverType || 'WIFI',
      trafficUsedBytes: 0,
      serverId: activeServers[0].id
    }];

    // 5. Создание или обновление подписки в БД
    const { data: existingSub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
    
    if (existingSub) {
      // Продление
      const newExpiry = new Date(existingSub.expires_at);
      newExpiry.setDate(newExpiry.getDate() + (durationDays || 30));
      await supabase.from('subscriptions').update({
        expires_at: newExpiry.toISOString(),
        v2ray_config: JSON.stringify(devices),
        updated_at: new Date().toISOString()
      }).eq('id', existingSub.id);
    } else {
      // Новая подписка
      await supabase.from('subscriptions').insert({
        user_id: userId,
        status: 'active',
        plan_type: planId,
        expires_at: expiresAt.toISOString(),
        v2ray_config: JSON.stringify(devices),
        traffic_limit_mb: trafficLimitMb,
        traffic_used_mb: 0,
        device_limit: deviceLimit || 2,
        server_id: activeServers[0].id
      });
    }

    // 6. Списание баланса
    await supabase.from('balances').update({ amount: balanceData.amount - price }).eq('user_id', userId);
    
    // 7. Логирование транзакции
    await supabase.from('transactions').insert({
      user_id: userId,
      amount: -price,
      currency: 'RUB',
      type: 'withdrawal',
      status: 'completed',
      description: `Покупка подписки: ${planId}`
    });

    res.json({ success: true, message: 'Подписка успешно оформлена' });
  } catch (err: any) {
    console.error('❌ Ошибка покупки подписки:', err);
    res.status(500).json({ error: err.message });
  }
});

// 🔄 Regenerate Device Key
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

    if (!sub) return res.status(404).json({ error: 'Active subscription not found' });

    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const targetIdx = devices.findIndex(d => d.id === deviceId);
    if (targetIdx === -1) return res.status(404).json({ error: 'Device not found' });

    const target = devices[targetIdx];
    const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (!activeServers || activeServers.length === 0) throw new Error('No active servers');

    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const limitBytes = (sub.traffic_limit_mb || 102400) * 1024 * 1024;
    const newEmail = `user_${userId.slice(0, 5)}_${Math.random().toString(36).substring(2, 5)}_reg`;
    const newUuid = crypto.randomUUID();
    const expiresAtMs = new Date(sub.expires_at).getTime();

    let configLines: string[] = [];
    for (const server of activeServers) {
      try {
        const { instance } = await getXuiForServer(server.id);
        if (target.uuid && target.email) await instance.deleteClient(target.uuid, target.email).catch(() => {});
        const rawConfig = await instance.addClient(newEmail, newUuid, inboundId, expiresAtMs, limitBytes);
        if (rawConfig) {
          const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`);
          configLines.push(configWithSuffix);
        }
      } catch (e) {}
    }

    if (configLines.length === 0) throw new Error('Failed to reach VPN servers');

    devices[targetIdx] = { ...target, config: configLines.join('\n'), email: newEmail, uuid: newUuid };
    await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices) }).eq('id', sub.id);

    res.json({ success: true, message: 'Ключ успешно перегенерирован', device: devices[targetIdx] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🎁 Apply Promocode
router.post('/promocode/apply', authenticateUser, async (req: any, res) => {
  const { code } = req.body;
  const userId = req.user.id;
  // Implementation...
  res.json({ success: true, message: 'Promocode applied (mock)' });
});

export default router;
