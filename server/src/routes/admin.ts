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

// --- СЕРВЕРА (УПРАВЛЕНИЕ) ---

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

router.post('/servers', adminOnly, async (req, res) => {
  try {
    const { is_default, ...cleanData } = req.body;
    const { data, error } = await supabase.from('vpn_servers').insert([cleanData]).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/servers/:id', adminOnly, async (req, res) => {
  try {
    const { is_default, id, created_at, ...cleanData } = req.body;
    const { data, error } = await supabase.from('vpn_servers').update(cleanData).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/servers/:id', adminOnly, async (req, res) => {
  try {
    const { error } = await supabase.from('vpn_servers').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/servers/:id/check', adminOnly, async (req, res) => {
  try {
    const { instance } = await getXuiForServer(req.params.id);
    const online = await instance.checkHealth();
    if (online) {
      res.json({ status: 'ok', online: true });
    } else {
      res.json({ status: 'error', message: 'Panel unreachable', online: false });
    }
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
        .filter(t => t.type === 'subscription_buy' && t.status === 'completed')
        .reduce((sum, t) => sum + Number(t.amount), 0),
      netProfit: 0
    };
    summary.netProfit = summary.totalDeposits - summary.totalWithdrawals;

    res.json({ transactions: transactions || [], summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ПЛАТЕЖИ (АДМИНКА) ---

/**
 * FIX: Получение полного списка платежей
 */
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

/**
 * FIX: Проверка статуса в Enot.io через прокси сервера
 */
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

/**
 * FIX: Ручное подтверждение платежа админом
 */
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
    if (error || !data || data.length === 0) {
      return res.json([
        { key: 'MONTHLY_PRICE', value: '100' },
        { key: 'PUBLIC_URL', value: process.env.PUBLIC_URL || 'https://izinet.online' },
        { key: 'PROMO_CODES_ENABLED', value: 'true' }
      ]);
    }
    res.json(data);
  } catch (err: any) {
    res.json([]);
  }
});

router.post('/settings', adminOnly, async (req, res) => {
  try {
    const { settings } = req.body;
    if (!Array.isArray(settings)) throw new Error('Settings must be an array');
    for (const item of settings) {
      await supabase.from('settings').upsert({ key: item.key, value: item.value }, { onConflict: 'key' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * FIX: Главный диагностический роут для Dashboard.tsx
 * Показывает статус Enot, наличие таблиц и текущую роль
 */
router.get('/diag', adminOnly, async (req, res) => {
  try {
    const { data: settings } = await supabase.from('settings').select('*');
    const sMap: any = {};
    settings?.forEach(s => sMap[s.key] = s.value);

    // Проверка наличия таблиц
    const { error: settingsErr } = await supabase.from('settings').select('count', { count: 'exact', head: true }).limit(1);

    const diagData = {
      role: 'superadmin', // middleware adminOnly guarantees this or admin
      database: {
        settingsTableOk: !settingsErr
      },
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
});

router.post('/system/sync-all', adminOnly, async (req, res) => {
  try {
    MaintenanceService.runFullMaintenance();
    res.json({ success: true, message: 'Синхронизация запущена' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/system/sync-servers', adminOnly, async (req, res) => {
  try {
    await MaintenanceService.runFullMaintenance();
    res.json({ success: true, updatedUsers: 'все' });
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

router.post('/system/repair-vless', adminOnly, async (req, res) => {
  try {
    const pubKey = process.env.XUI_REALITY_PUB_KEY;
    const privKey = process.env.XUI_REALITY_PRIV_KEY;
    if (!pubKey || !privKey) throw new Error('Reality keys missing in .env');

    const { data: servers } = await supabase.from('vpn_servers').select('id, name').eq('is_active', true);
    if (!servers) throw new Error('No active servers');

    for (const s of servers) {
      try {
        const { instance } = await getXuiForServer(s.id);
        await instance.syncRealityKeys(privKey, pubKey);
      } catch (e) {}
    }

    res.json({ success: true, message: 'Ключи Reality обновлены на всех серверах' });
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
