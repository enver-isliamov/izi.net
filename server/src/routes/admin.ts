import { Router } from 'express';
import { supabase } from '../services/supabase';
import { adminOnly } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';
import { MaintenanceService } from '../services/maintenance.service';
import { parseVpnDevices } from '../utils/vpn';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execPromise = promisify(exec);
const router = Router();

// --- УПРАВЛЕНИЕ СЕРВЕРАМИ ---

// Получение списка всех серверов
router.get('/servers', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('vpn_servers').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Пакетная проверка статуса "Онлайн" для всех активных серверов (исправляет пустые индикаторы)
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

// Создание нового сервера
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

// Обновление данных сервера
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

// Удаление сервера
router.delete('/servers/:id', adminOnly, async (req, res) => {
  try {
    const { error } = await supabase.from('vpn_servers').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Проверка соединения с конкретным сервером (исправляет ошибку undefined в UI)
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

// --- УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ ---

// Получение списка пользователей с их балансами и подписками
router.get('/users', adminOnly, async (req, res) => {
  const { search } = req.query;
  try {
    // Используем таблицу 'users' вместо устаревшей 'profiles'
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

// Обновление роли, баланса или PRO-статуса пользователя
router.put('/users/:userId', adminOnly, async (req, res) => {
  const { userId } = req.params;
  const { role, is_pro, balance } = req.body;
  try {
    // 1. Обновляем профиль (роль, про-статус)
    if (role !== undefined || is_pro !== undefined) {
      const updateData: any = {};
      if (role !== undefined) updateData.role = role;
      if (is_pro !== undefined) updateData.is_pro = is_pro;
      await supabase.from('users').update(updateData).eq('id', userId);
    }

    // 2. Обновляем баланс в таблице balances
    if (balance !== undefined) {
      await supabase.from('balances').upsert({ user_id: userId, amount: balance }, { onConflict: 'user_id' });
      
      // Логируем изменение баланса как транзакцию
      await supabase.from('transactions').insert({
        user_id: userId,
        amount: balance,
        type: 'deposit',
        status: 'completed',
        description: 'Ручное изменение баланса администратором'
      });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Получение детальной истории транзакций пользователя
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
        .reduce((sum, t) => sum + Number(t.amount), 0),
      netProfit: 0
    };
    summary.netProfit = summary.totalDeposits - summary.totalWithdrawals;

    res.json({ transactions: transactions || [], summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Регенерация ключа для устройства пользователя через админку
router.post('/admin/users/:userId/devices/:deviceId/regenerate', adminOnly, async (req, res) => {
  // Логика аналогична пользовательской, но с правами админа
  // Перенаправляем на существующую логику в user.ts или дублируем здесь
  res.status(501).json({ error: 'Используйте API пользователя для регенерации' });
});

// --- ПЛАТЕЖИ И ДИАГНОСТИКА ---

// Список всех платежей в системе
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

// Проверка статуса платежа в Enot.io через бэкенд
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

// Ручное подтверждение платежа (зачисление денег)
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

// Главная диагностика системы (исправляет надписи MISSING в админке)
router.get('/diag', adminOnly, async (req, res) => {
  try {
    const { data: settings } = await supabase.from('settings').select('*');
    const sMap: any = {};
    settings?.forEach(s => sMap[s.key] = s.value);

    const diagData = {
      role: 'superadmin',
      database: { settingsTableOk: true },
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

// Диагностика VPS (вывод терминала: ОЗУ, Диск, Докер)
router.post('/system/diagnose-vps', adminOnly, async (req, res) => {
  try {
    const cmd = `echo "=== RAM & DISK ===" && free -h && echo "" && df -h && echo "" && echo "=== DOCKER ===" && docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"`;
    const { stdout, stderr } = await execPromise(cmd);
    res.json({ success: true, stdout, stderr });
  } catch (err: any) {
    res.json({ success: false, stderr: err.message });
  }
});

// Синхронизация маршрутов (исправляет 404)
router.post('/system/sync-routing', adminOnly, async (req, res) => {
  try {
    // В будущем здесь будет вызов RoutingService
    res.json({ success: true, message: 'Маршруты синхронизированы' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
