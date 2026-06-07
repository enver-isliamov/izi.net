import { Router } from 'express';
import { supabase } from '../services/supabase';
import { adminOnly } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';

const router = Router();

// --- СЕРВЕРА ---

// 1. Список всех серверов
router.get('/servers', adminOnly, async (req, res) => {
  console.log('👨‍💻 [Admin] Запрос списка серверов...');
  try {
    const { data, error } = await supabase.from('vpn_servers').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    console.error('❌ [Admin] Ошибка /servers:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Статус здоровья серверов (health)
router.get('/servers/health', adminOnly, async (req, res) => {
  try {
    const { data: servers } = await supabase.from('vpn_servers').select('id, name');
    const results = await Promise.all((servers || []).map(async (s) => {
      try {
        const { instance } = await getXuiForServer(s.id);
        const online = await instance.checkHealth();
        return { id: s.id, online };
      } catch (e) {
        return { id: s.id, online: false };
      }
    }));
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Диагностика серверов (diag)
router.get('/servers/diag', adminOnly, async (req, res) => {
  try {
    const { data: servers } = await supabase.from('vpn_servers').select('id, name');
    const results = await Promise.all((servers || []).map(async (s) => {
      try {
        const { instance } = await getXuiForServer(s.id);
        const online = await instance.checkHealth();
        return { id: s.id, name: s.name, online };
      } catch (e) {
        return { id: s.id, name: s.name, online: false };
      }
    }));
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Проверка конкретного сервера
router.get('/servers/:id/check', adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    const { instance } = await getXuiForServer(id);
    const online = await instance.checkHealth();
    res.json({ success: true, online });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ПОЛЬЗОВАТЕЛИ ---

// 5. Список пользователей (Используем public.users согласно Supabase.md)
router.get('/users', adminOnly, async (req, res) => {
  const { search } = req.query;
  console.log(`👨‍💻 [Admin] Запрос пользователей из public.users...`);
  
  try {
    // Согласно Supabase.md, таблица называется public.users
    let query = supabase.from('users').select('*');
    if (search) query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    const { data: users, error: pErr } = await query.order('created_at', { ascending: false });
    if (pErr) throw pErr;

    if (!users || users.length === 0) return res.json([]);

    const userIds = users.map(u => u.id);

    // Получаем балансы и подписки отдельными запросами (Fix Relationship Error)
    const [balancesRes, subsRes] = await Promise.all([
      supabase.from('balances').select('*').in('user_id', userIds),
      supabase.from('subscriptions').select('*').in('user_id', userIds)
    ]);

    // Объединяем данные
    const enrichedUsers = users.map(u => {
      return {
        ...u,
        balances: (balancesRes.data || []).filter(b => b.user_id === u.id),
        subscriptions: (subsRes.data || []).filter(s => s.user_id === u.id)
      };
    });

    res.json(enrichedUsers);
  } catch (err: any) {
    console.error('❌ [Admin] Ошибка /users:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- ПЛАТЕЖИ ---
router.get('/payments', adminOnly, async (req, res) => {
  try {
    const { data: txs, error: txErr } = await supabase.from('transactions').select('*').order('created_at', { ascending: false });
    if (txErr) throw txErr;

    if (!txs || txs.length === 0) return res.json([]);

    const userIds = Array.from(new Set(txs.map(t => t.user_id)));
    const { data: users } = await supabase.from('users').select('id, email').in('id', userIds);

    const enrichedTxs = txs.map(t => ({
      ...t,
      users: (users || []).find(u => u.id === t.user_id) || { email: 'Unknown' }
    }));

    res.json(enrichedTxs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- НАСТРОЙКИ ---
router.get('/settings', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) {
       console.error('❌ [Admin] Ошибка таблицы settings:', error.message);
       throw error;
    }
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ДИАГНОСТИКА ---
router.get('/diag', adminOnly, async (req, res) => {
  try {
    const { error: settingsErr } = await supabase.from('settings').select('key').limit(1);
    const { error: usersErr } = await supabase.from('users').select('id').limit(1);
    
    res.json({
      env: {
        enot: !!process.env.ENOT_MERCHANT_ID,
        supabase: !!process.env.VITE_SUPABASE_URL,
        telegram: !!process.env.TELEGRAM_BOT_TOKEN
      },
      db: {
        settingsTable: !settingsErr,
        usersTable: !usersErr
      },
      nodeVersion: process.version,
      date: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- СТАТИСТИКА ---
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const { count: usersCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { data: activeSubs } = await supabase.from('subscriptions').select('id').eq('status', 'active');
    const { data: revenue } = await supabase.from('transactions').select('amount').eq('status', 'completed');
    
    const totalRevenue = revenue?.reduce((sum, tx) => sum + tx.amount, 0) || 0;

    res.json({
      totalUsers: usersCount || 0,
      activeSubscriptions: activeSubs?.length || 0,
      totalRevenue,
      adminsCount: 0,
      totalOnline: 0
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
