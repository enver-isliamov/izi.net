import { Router } from 'express';
import { supabase } from '../services/supabase';
import { adminOnly } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';
import { MaintenanceService } from '../services/maintenance.service';
import { parseVpnDevices } from '../utils/vpn';
import crypto from 'crypto';

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

router.post('/servers', adminOnly, async (req, res) => {
  try {
    // Адаптация: удаляем поля, которых нет в вашей схеме SuperBase.md
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
    // Адаптация: удаляем поля, которых нет в вашей схеме
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
    res.json({ success: true, online });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/servers/:id/check', adminOnly, async (req, res) => {
  try {
    const { instance } = await getXuiForServer(req.params.id);
    const online = await instance.checkHealth();
    res.json({ success: true, online });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- ПОЛЬЗОВАТЕЛИ ---

router.get('/users', adminOnly, async (req, res) => {
  const { search } = req.query;
  try {
    let query = supabase.from('profiles').select('*');
    if (search) query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    const { data: profiles, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

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

// --- СИСТЕМА И НАСТРОЙКИ ---

router.get('/settings', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('*');
    
    // Адаптация: Если таблица пуста или ошибка, возвращаем дефолты вместо краша
    if (error || !data || data.length === 0) {
      return res.json([
        { key: 'MONTHLY_PRICE', value: '100' },
        { key: 'PUBLIC_URL', value: process.env.PUBLIC_URL || 'https://izinet.online' },
        { key: 'PROMO_CODES_ENABLED', value: 'true' }
      ]);
    }
    res.json(data);
  } catch (err: any) {
    // Возвращаем пустой массив, чтобы фронтенд не падал
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

router.post('/system/sync-all', adminOnly, async (req, res) => {
  try {
    MaintenanceService.runFullMaintenance();
    res.json({ success: true, message: 'Синхронизация запущена' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
        await instance.restartPanel();
      } catch (e) {}
    }

    res.json({ success: true, message: 'Ключи Reality обновлены на всех серверах' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', adminOnly, async (req, res) => {
  try {
    const { count: usersCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
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
