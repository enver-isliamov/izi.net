import { Router } from 'express';
import { supabase } from '../services/supabase';
import { adminOnly } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';

const router = Router();

// --- СЕРВЕРА ---

// Список всех серверов
router.get('/servers', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('vpn_servers').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Диагностика серверов
router.get('/servers/diag', adminOnly, async (req, res) => {
  try {
    const { data: servers, error } = await supabase.from('vpn_servers').select('id, name');
    if (error) throw error;
    
    const results = await Promise.all((servers || []).map(async (s) => {
      try {
        const { instance } = await getXuiForServer(s.id);
        const isOnline = await instance.checkHealth();
        return { id: s.id, name: s.name, online: isOnline };
      } catch (e: any) {
        return { id: s.id, name: s.name, online: false, error: e.message };
      }
    }));
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ПОЛЬЗОВАТЕЛИ ---

// Список пользователей (с поиском)
router.get('/users', adminOnly, async (req, res) => {
  const { search } = req.query;
  try {
    let query = supabase.from('users').select('*, balances(amount), subscriptions(*)');
    if (search) {
      query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ПЛАТЕЖИ ---
router.get('/payments', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('transactions').select('*, users(email)').order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- НАСТРОЙКИ ---
router.get('/settings', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) throw error;
    res.json(data || []);
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
      adminsCount: 0, // Можно добавить запрос если нужно
      totalOnline: 0
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
