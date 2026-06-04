import { Router } from 'express';
import { supabase } from '../services/supabase';
import { adminOnly } from '../utils/auth';
import { getXuiForServer } from '../services/xui.service';

const router = Router();

// Health check all servers
router.get('/servers/health', adminOnly, async (req, res) => {
  try {
    const { data: servers, error } = await supabase.from('vpn_servers').select('id, name');
    if (error) throw error;
    
    const results = await Promise.all((servers || []).map(async (s) => {
      try {
        const { instance } = await getXuiForServer(s.id);
        const isOnline = await instance.checkHealth();
        return { id: s.id, online: isOnline };
      } catch (e: any) {
        return { id: s.id, online: false, error: e.message };
      }
    }));
    
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Admin stats
router.get('/stats', adminOnly, async (req, res) => {
  try {
    const { count: usersCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: activeSubs } = await supabase.from('subscriptions').select('*', { count: 'exact', head: true }).gt('expires_at', new Date().toISOString());
    const { data: recentRevenue } = await supabase.from('transactions').select('amount').eq('status', 'completed');
    
    const { data: servers } = await supabase.from('vpn_servers').select('id, name').eq('is_active', true);
    let totalOnline = 0;
    let serverStats: any[] = [];

    if (servers) {
      const liveData = await Promise.all(servers.map(async (s) => {
        try {
          const { instance } = await getXuiForServer(s.id);
          const onlines = await instance.getOnlines();
          return { id: s.id, name: s.name, online: onlines.length, status: 'online' };
        } catch (e) {
          return { id: s.id, name: s.name, online: 0, status: 'offline' };
        }
      }));
      totalOnline = liveData.reduce((acc, curr) => acc + curr.online, 0);
      serverStats = liveData;
    }

    const { count: adminsCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).in('role', ['admin', 'superadmin']);
    const totalRevenue = recentRevenue?.reduce((sum, tx) => sum + tx.amount, 0) || 0;

    res.json({
      totalUsers: usersCount,
      activeSubscriptions: activeSubs,
      totalRevenue,
      adminsCount,
      totalOnline,
      serverStats
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
