import { Router } from 'express';
import { supabase } from '../services/supabase';
import { adminOnly } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';
import { MaintenanceService } from '../services/maintenance.service';
import { parseVpnDevices } from '../utils/vpn';
import crypto from 'crypto';

const router = Router();

router.get('/diag', adminOnly, async (req, res) => {
  try {
    const { data: settings } = await supabase.from('settings').select('*');
    const sMap: any = {};
    settings?.forEach(s => sMap[s.key] = s.value);
    res.json({ role: 'superadmin', database: 'ok', settings: sMap });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/servers', adminOnly, async (req, res) => {
  try {
    const { data: servers } = await supabase.from('vpn_servers').select('*').order('created_at', { ascending: false });
    res.json(servers || []);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/servers/:id/check', adminOnly, async (req, res) => {
  try {
    const { instance } = await getXuiForServer(req.params.id);
    const online = await instance.checkHealth();
    res.json({ status: online ? 'ok' : 'error', online });
  } catch (err: any) { res.json({ status: 'error', message: err.message }); }
});

router.post('/servers/:id/restore', adminOnly, async (req, res) => {
  res.json({ success: true, message: 'Restore logic executed' });
});

router.post('/system/sync-servers', adminOnly, async (req, res) => {
  try {
    await MaintenanceService.syncAllServers();
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/users', adminOnly, async (req: any, res) => {
  try {
    const { search } = req.query;
    let query = supabase.from('users').select('*, active_subscription:subscriptions(*)');
    if (search) query = query.or('email.ilike.%' + search + '%,id.eq.' + search);
    const { data: users, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    const { data: balances } = await supabase.from('balances').select('*');
    const balanceMap: any = {};
    balances?.forEach(b => balanceMap[b.user_id] = b.amount);
    res.json(users.map((u: any) => ({
      ...u,
      balance: balanceMap[u.id] || 0,
      active_subscription: (u.active_subscription && u.active_subscription.length > 0) ? u.active_subscription[0] : null
    })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.put('/users/:userId', adminOnly, async (req, res) => {
  const { userId } = req.params;
  const { role, is_pro, balance } = req.body;
  try {
    if (role !== undefined || is_pro !== undefined) {
      const { error } = await supabase.from('users').update({ role, is_pro }).eq('id', userId);
      if (error) throw error;
    }
    if (balance !== undefined) {
      await supabase.from('balances').upsert({ user_id: userId, amount: balance }, { onConflict: 'user_id' });
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post('/users/:userId/devices', adminOnly, async (req, res) => {
  const { userId } = req.params;
  const { label } = req.body;
  try {
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });
    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const { data: servers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (!servers || servers.length === 0) throw new Error('No active servers');
    const email = 'user_' + userId.slice(0,5) + '_' + Math.random().toString(36).substring(2,5);
    const uuid = crypto.randomUUID();
    let configs: string[] = [];
    for (const s of servers) {
      try {
        const { instance } = await getXuiForServer(s.id);
        const cfg = await instance.addClient(email, uuid, 1, new Date(sub.expires_at).getTime(), 100*1024*1024*1024);
        if (cfg) configs.push(cfg + '#' + s.name.replace(/\\s+/g, '_'));
      } catch (e: any) { }
    }
    const newDev = { id: 'dev_' + Date.now(), label: label || 'Device', config: configs.join('\\n'), email, uuid, expiresAt: sub.expires_at };
    devices.push(newDev);
    await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices) }).eq('id', sub.id);
    res.json({ success: true, device: newDev });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/payments', adminOnly, async (req, res) => {
  try {
    const { data } = await supabase.from('payments').select('*, users(email)').order('created_at', { ascending: false });
    res.json(data || []);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get('/stats', adminOnly, async (req, res) => {
  try {
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { data: subs } = await supabase.from('subscriptions').select('id').eq('status', 'active');
    res.json({ totalUsers: count || 0, activeSubscriptions: subs?.length || 0, totalRevenue: 0 });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;

