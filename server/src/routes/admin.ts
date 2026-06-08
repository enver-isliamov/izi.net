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
    const { data, error } = await supabase.from('vpn_servers').insert([req.body]).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/servers/:id', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('vpn_servers').update(req.body).eq('id', req.params.id).select().single();
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

router.get('/servers/:id', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('vpn_servers').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Server not found' });
    res.json(data);
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

// GET версия для совместимости
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

router.put('/users/:id', adminOnly, async (req: any, res) => {
  const { id } = req.params;
  const { balance, role, is_pro } = req.body;
  
  try {
    if (balance !== undefined) {
      await supabase.from('balances').upsert({ user_id: id, amount: balance }, { onConflict: 'user_id' });
    }
    
    if (role !== undefined) {
      // Update both tables for consistency
      await Promise.all([
        supabase.from('profiles').update({ role }).eq('id', id),
        supabase.from('users').update({ role }).eq('id', id)
      ]);
    }

    if (is_pro !== undefined) {
      await supabase.from('profiles').update({ is_pro }).eq('id', id);
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users/:id/subscription', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('subscriptions').select('*').eq('user_id', req.params.id).maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/:id/subscription', adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase.from('subscriptions').upsert({ user_id: id, ...req.body }, { onConflict: 'user_id' }).select().single();
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

// --- УСТРОЙСТВА И КЛЮЧИ ---

router.post('/users/:userId/devices/:deviceId/regenerate', adminOnly, async (req, res) => {
  const { userId, deviceId } = req.params;
  try {
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (!sub) return res.status(404).json({ error: 'Active subscription not found' });

    let devices = parseVpnDevices(sub.v2ray_config);
    const idx = devices.findIndex(d => d.id === deviceId);
    if (idx === -1) return res.status(404).json({ error: 'Device not found' });

    const newUuid = crypto.randomUUID();
    const newEmail = `admin_reg_${userId.slice(0,4)}_${Math.random().toString(36).substring(2,5)}`;
    
    // В реальности тут надо еще в 3x-ui добавить, но для начала обновим в базе
    devices[idx].uuid = newUuid;
    devices[idx].email = newEmail;
    // Обновляем конфиг (упрощенно)
    devices[idx].config = devices[idx].config.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, newUuid);

    await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices) }).eq('id', sub.id);
    res.json({ success: true, device: devices[idx] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:userId/devices/:deviceId', adminOnly, async (req, res) => {
  const { userId, deviceId } = req.params;
  try {
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    let devices = parseVpnDevices(sub.v2ray_config);
    devices = devices.filter(d => d.id !== deviceId);

    await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices) }).eq('id', sub.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- СИСТЕМА ---

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
    if (!Array.isArray(settings)) throw new Error('Settings must be an array');
    
    for (const item of settings) {
      await supabase.from('settings').upsert({ key: item.key, value: item.value }, { onConflict: 'key' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/system/sync-servers', adminOnly, async (req, res) => {
  try {
    // Триггерим фоновую синхронизацию
    MaintenanceService.runFullMaintenance();
    res.json({ success: true, updatedUsers: 'Processing' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/payments', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('transactions').select('*').order('created_at', { ascending: false });
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
      env: { enot: !!process.env.ENOT_MERCHANT_ID, supabase: !!process.env.VITE_SUPABASE_URL },
      dbSettingsTable: !settingsErr,
      date: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', adminOnly, async (req, res) => {
  try {
    const { count: usersCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
    const { data: activeSubs } = await supabase.from('subscriptions').select('id').eq('status', 'active');
    const { data: revenue } = await supabase.from('transactions').select('amount').eq('status', 'completed');
    res.json({
      totalUsers: usersCount || 0,
      activeSubscriptions: activeSubs?.length || 0,
      totalRevenue: revenue?.reduce((sum, tx) => sum + tx.amount, 0) || 0
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
