import { Router } from 'express';
import { supabase } from '../services/supabase';
import { authenticateUser, adminOnly } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';

const router = Router();

// --- СЕРВЕРА ---

// Список всех серверов
router.get('/servers', adminOnly, async (req, res) => {
  console.log('👨‍💻 [Admin] Запрос списка серверов...');
  try {
    const { data, error } = await supabase.from('vpn_servers').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('❌ [Admin] Ошибка получения серверов:', error.message);
      throw error;
    }
    console.log(`✅ [Admin] Найдено серверов: ${data?.length || 0}`);
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ПОЛЬЗОВАТЕЛИ ---

// Список пользователей (используем таблицу profiles согласно схеме БД)
router.get('/users', adminOnly, async (req, res) => {
  const { search } = req.query;
  console.log(`👨‍💻 [Admin] Запрос списка пользователей (поиск: ${search || 'нет'})...`);
  
  try {
    // Согласно схеме, данные в 'profiles', а балансы и подписки привязаны к user_id
    let query = supabase.from('profiles').select(`
      *,
      balances:balances(amount),
      subscriptions:subscriptions(*)
    `);

    if (search) {
      query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ [Admin] Ошибка получения пользователей:', error.message);
      throw error;
    }

    console.log(`✅ [Admin] Найдено пользователей: ${data?.length || 0}`);
    res.json(data || []);
  } catch (err: any) {
    console.error('❌ [Admin] Критическая ошибка /users:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- ПЛАТЕЖИ ---
router.get('/payments', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*, profiles:user_id(email)')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    res.json(data || []);
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
