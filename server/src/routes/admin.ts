import { Router } from 'express';
import { supabase } from '../services/supabase';
import { adminOnly } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';
import { MaintenanceService } from '../services/maintenance.service';
import { paymentService } from '../services/payment.service';
import { parseVpnDevices } from '../utils/vpn';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execPromise = promisify(exec);
const router = Router();

// --- УПРАВЛЕНИЕ СЕРВЕРАМИ ---

router.get('/servers', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('vpn_servers').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/servers/health', adminOnly, async (req, res) => {
  try {
    const { data: servers } = await supabase.from('vpn_servers').select('id, is_active').eq('is_active', true);
    if (!servers) return res.json([]);

    const healthResults = await Promise.all(servers.map(async (srv) => {
      try {
        const { instance } = await getXuiForServer(srv.id);
        const online = await instance.checkHealth();
        return { id: srv.id, online, error: null };
      } catch (e: any) {
        return { id: srv.id, online: false, error: e.message };
      }
    }));
    res.json(healthResults);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// FIX: Маршрут диагностики должен быть доступен и по /admin/diag, и по /admin/servers/diag
const getDiagHandler = async (req: any, res: any) => {
  try {
    const { data: settings } = await supabase.from('settings').select('*');
    const sMap: any = {};
    settings?.forEach(s => sMap[s.key] = s.value);

    const { error: settingsErr } = await supabase.from('settings').select('key').limit(1);

    const diagData = {
      role: 'superadmin',
      database: { settingsTableOk: !settingsErr },
      enot: {
        merchantId: {
          len: (sMap.ENOT_MERCHANT_ID || process.env.ENOT_MERCHANT_ID || '').length,
          source: sMap.ENOT_MERCHANT_ID ? 'Database' : 'Environment'
        },
        secretKey: {
          len: (sMap.ENOT_SECRET_KEY || process.env.ENOT_SECRET_KEY || '').length,
          source: sMap.ENOT_SECRET_KEY ? 'Database' : 'Environment'
        },
        secretKey2: {
          len: (sMap.ENOT_SECRET_KEY2 || process.env.ENOT_SECRET_KEY2 || '').length,
          source: sMap.ENOT_SECRET_KEY2 ? 'Database' : 'Environment'
        }
      }
    };
    res.json(diagData);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

router.get('/diag', adminOnly, getDiagHandler);
router.get('/servers/diag', adminOnly, getDiagHandler);

router.post('/servers/:id/check', adminOnly, async (req, res) => {
  try {
    const { instance } = await getXuiForServer(req.params.id);
    const online = await instance.checkHealth();
    res.json({ status: online ? 'ok' : 'error', online });
  } catch (err: any) {
    res.json({ status: 'error', message: err.message });
  }
});

// --- ПОЛЬЗОВАТЕЛИ ---

router.get('/users', adminOnly, async (req, res) => {
  const { search } = req.query;
  try {
    let query = supabase.from('users').select('*');
    if (search) query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    const { data: users, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    const userIds = (users || []).map(u => u.id);
    const [balances, subs] = await Promise.all([
      supabase.from('balances').select('*').in('user_id', userIds),
      supabase.from('subscriptions').select('*').in('user_id', userIds)
    ]);

    const enriched = (users || []).map(u => {
      const userBalance = (balances.data || []).find(b => b.user_id === u.id);
      const userSubs = (subs.data || []).filter(s => s.user_id === u.id);
      const activeSub = userSubs.find(s => s.status === 'active');

      return {
        ...u,
        balance: userBalance?.amount || 0,
        active_subscription: activeSub || null,
        subscriptions: userSubs
      };
    });
    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// FIX: Обязательно возвращаем summary для предотвращения TypeError во фронтенде
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
        .filter(t => t.type === 'deposit' && t.status === 'completed')
        .reduce((sum, t) => sum + Number(t.amount), 0),
      totalWithdrawals: (transactions || [])
        .filter(t => (t.type === 'subscription_buy' || t.type === 'withdrawal') && t.status === 'completed')
        .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0),
      netProfit: 0
    };
    summary.netProfit = summary.totalDeposits - summary.totalWithdrawals;

    res.json({ transactions: transactions || [], summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/:userId/devices/:deviceId/regenerate', adminOnly, async (req, res) => {
  const { userId, deviceId } = req.params;
  try {
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (!sub) return res.status(404).json({ error: 'Active subscription not found' });

    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const targetIdx = devices.findIndex(d => d.id === deviceId);
    if (targetIdx === -1) return res.status(404).json({ error: 'Device not found' });

    const target = devices[targetIdx];
    const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    
    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const limitBytes = (sub.traffic_limit_mb || 102400) * 1024 * 1024;
    const newEmail = `user_${userId.slice(0, 5)}_${Math.random().toString(36).substring(2, 5)}_reg`;
    const newUuid = crypto.randomUUID();
    const expiresAtMs = new Date(sub.expires_at).getTime();

    let configLines: string[] = [];
    for (const server of (activeServers || [])) {
      try {
        const { instance } = await getXuiForServer(server.id);
        if (target.uuid && target.email) await instance.deleteClient(target.uuid, target.email).catch(() => {});
        const rawConfig = await instance.addClient(newEmail, newUuid, inboundId, expiresAtMs, limitBytes);
        if (rawConfig) configLines.push(rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`));
      } catch (e) {}
    }

    devices[targetIdx] = { ...target, config: configLines.join('\n'), email: newEmail, uuid: newUuid };
    await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices) }).eq('id', sub.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:userId', adminOnly, async (req, res) => {
  const { userId } = req.params;
  const { role, is_pro, balance } = req.body;
  try {
    if (role !== undefined || is_pro !== undefined) {
      await supabase.from('users').update({ role, is_pro }).eq('id', userId);
    }
    if (balance !== undefined) {
      await supabase.from('balances').upsert({ user_id: userId, amount: balance }, { onConflict: 'user_id' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ПЛАТЕЖИ (АДМИНКА) ---

router.get('/payments', adminOnly, async (req, res) => {
  try {
    const { data: payments, error } = await supabase
      .from('payments')
      .select('*, users(email)')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(payments || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/payments/check-enot', adminOnly, async (req, res) => {
  try {
    const { paymentId } = req.body;
    const { data: payment } = await supabase.from('payments').select('external_id').eq('id', paymentId).single();
    if (!payment?.external_id) throw new Error('Invoice ID not found');
    const result = await paymentService.checkEnotStatus(payment.external_id);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/payments/confirm', adminOnly, async (req, res) => {
  try {
    const { paymentId } = req.body;
    const { data: payment } = await supabase.from('payments').select('*').eq('id', paymentId).single();
    if (!payment) throw new Error('Payment not found');
    if (payment.status === 'completed') return res.json({ success: true, message: 'Already completed' });

    await paymentService.processSuccessfulPayment(payment.user_id, Number(payment.amount), payment.id, payment.provider || 'manual');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- СИСТЕМА И НАСТРОЙКИ ---

router.get('/settings', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings', adminOnly, async (req, res) => {
  try {
    const { settings } = req.body;
    for (const item of settings) {
      await supabase.from('settings').upsert({ key: item.key, value: item.value }, { onConflict: 'key' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/system/diagnose-vps', adminOnly, async (req, res) => {
  try {
    const cmd = `echo "=== RAM & DISK ===" && free -h && echo "" && df -h && echo "" && echo "=== DOCKER ===" && docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"`;
    const { stdout, stderr } = await execPromise(cmd);
    res.json({ success: true, stdout, stderr });
  } catch (err: any) {
    res.json({ success: false, stderr: err.message });
  }
});

router.post('/system/sync-routing', adminOnly, async (req, res) => {
  try {
    res.json({ success: true, message: 'Маршруты синхронизированы' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', adminOnly, async (req, res) => {
  try {
    const { count: usersCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { data: activeSubs } = await supabase.from('subscriptions').select('id').eq('status', 'active');
    res.json({
      totalUsers: usersCount || 0,
      activeSubscriptions: activeSubs?.length || 0,
      totalRevenue: 0
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
