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

// 2. Здоровье серверов
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

// 3. Проверка конкретного сервера
router.get('/servers/:id/check', adminOnly, async (req, res) => {
  const { id } = req.params;
  console.log(`👨‍💻 [Admin] Проверка сервера: ${id}`);
  try {
    const { instance } = await getXuiForServer(id);
    const online = await instance.checkHealth();
    res.json({ success: true, online });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ПОЛЬЗОВАТЕЛИ ---

// 4. Список пользователей (Используем profiles для фронтенда)
router.get('/users', adminOnly, async (req, res) => {
  const { search } = req.query;
  console.log(`👨‍💻 [Admin] Запрос списка профилей...`);
  try {
    let query = supabase.from('profiles').select('*');
    if (search) query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    const { data: profiles, error } = await query.order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Подгружаем балансы и подписки отдельно (Fix Relationship Error)
    const profileIds = (profiles || []).map(p => p.id);
    const [balances, subs] = await Promise.all([
      supabase.from('balances').select('*').in('user_id', profileIds),
      supabase.from('subscriptions').select('*').in('user_id', profileIds)
    ]);

    const enriched = (profiles || []).map(p => ({
      ...p,
      balances: (balances.data || []).filter(b => b.user_id === p.id),
      subscriptions: (subs.data || []).filter(s => s.user_id === p.id)
    }));

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Детальная информация по пользователю (маршруты, которые искал фронт)
router.get('/users/:id/subscription', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('subscriptions').select('*').eq('user_id', req.params.id).maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users/:id/transactions', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('transactions').select('*').eq('user_id', req.params.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ПЛАТЕЖИ И НАСТРОЙКИ ---

router.get('/payments', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('transactions').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/settings', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/diag', adminOnly, async (req, res) => {
  try {
    const { error: settingsErr } = await supabase.from('settings').select('key').limit(1);
    res.json({
      env: {
        enot: !!process.env.ENOT_MERCHANT_ID,
        supabase: !!process.env.VITE_SUPABASE_URL
      },
      dbSettingsTable: !settingsErr,
      date: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- СТАТИСТИКА ---
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const { count: usersCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
    const { data: activeSubs } = await supabase.from('subscriptions').select('id').eq('status', 'active');
    const { data: revenue } = await supabase.from('transactions').select('amount').eq('status', 'completed');
    
    res.json({
      totalUsers: usersCount || 0,
      activeSubscriptions: activeSubs?.length || 0,
      totalRevenue: revenue?.reduce((sum, tx) => sum + tx.amount, 0) || 0,
      adminsCount: 0,
      totalOnline: 0
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
