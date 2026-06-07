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
  console.log('👨‍💻 [Admin] Проверка здоровья всех серверов...');
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
  console.log('👨‍💻 [Admin] Запрос диагностики серверов...');
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

// 5. Список пользователей (Fix Relationship Error)
router.get('/users', adminOnly, async (req, res) => {
  const { search } = req.query;
  console.log(`👨‍💻 [Admin] Запрос пользователей (поиск: ${search || 'все'})...`);
  
  try {
    // Шаг 1: Получаем профили
    let query = supabase.from('profiles').select('*');
    if (search) query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    const { data: profiles, error: pErr } = await query.order('created_at', { ascending: false });
    if (pErr) throw pErr;

    if (!profiles || profiles.length === 0) return res.json([]);

    const profileIds = profiles.map(p => p.id);

    // Шаг 2: Получаем балансы и подписки отдельными запросами (Fix Relationship Error)
    const [balancesRes, subsRes] = await Promise.all([
      supabase.from('balances').select('*').in('user_id', profileIds),
      supabase.from('subscriptions').select('*').in('user_id', profileIds)
    ]);

    // Шаг 3: Объединяем данные вручную
    const enrichedUsers = profiles.map(p => {
      return {
        ...p,
        balances: (balancesRes.data || []).filter(b => b.user_id === p.id),
        subscriptions: (subsRes.data || []).filter(s => s.user_id === p.id)
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

    // Обогащаем данными о почте (email)
    const userIds = Array.from(new Set(txs.map(t => t.user_id)));
    const { data: profiles } = await supabase.from('profiles').select('id, email').in('id', userIds);

    const enrichedTxs = txs.map(t => ({
      ...t,
      profiles: (profiles || []).find(p => p.id === t.user_id) || { email: 'Unknown' }
    }));

    res.json(enrichedTxs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- НАСТРОЙКИ ---

// 6. Список настроек
router.get('/settings', adminOnly, async (req, res) => {
  console.log('👨‍💻 [Admin] Запрос настроек...');
  try {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Общая диагностика системы (diag)
router.get('/diag', adminOnly, async (req, res) => {
  console.log('👨‍💻 [Admin] Общая диагностика системы...');
  try {
    const envStatus = {
      enot: !!process.env.ENOT_MERCHANT_ID,
      supabase: !!process.env.VITE_SUPABASE_URL,
      telegram: !!process.env.TELEGRAM_BOT_TOKEN
    };
    
    // Проверка таблицы настроек
    const { error: settingsErr } = await supabase.from('settings').select('key').limit(1);
    
    res.json({
      env: envStatus,
      dbSettingsTable: !settingsErr,
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
    const { count: usersCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
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
