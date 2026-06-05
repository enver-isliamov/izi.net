import { Router } from 'express';
import { supabase } from '../services/supabase';

const router = Router();

router.get('/sub/:id', async (req, res) => {
  const { id } = req.params;
  const { deviceId } = req.query;
  
  try {
    const { data: sub } = await supabase.from('subscriptions').select('*').eq('id', id).maybeSingle();
    if (!sub || sub.status !== 'active') return res.status(404).send('Subscription not found');

    const now = new Date();
    if (new Date(sub.expires_at) < now) return res.status(403).send('Expired');

    // Retrieve all servers to distinguish between active, inactive, and legacy links
    const { data: allServers } = await supabase.from('vpn_servers').select('name, is_active');
    const activeSuffices = (allServers || []).filter(s => s.is_active).map((s: any) => `#${s.name.replace(/\s+/g,'_')}`);
    const inactiveSuffices = (allServers || []).filter(s => !s.is_active).map((s: any) => `#${s.name.replace(/\s+/g,'_')}`);

    let configText = "";
    try {
      if (sub.v2ray_config) {
        if (sub.v2ray_config.trim().startsWith('[')) {
          let devices = JSON.parse(sub.v2ray_config);
          if (deviceId && Array.isArray(devices)) {
            devices = devices.filter((d: any) => d.id === deviceId);
          }
          configText = devices.map((d: any) => d.config).join('\n');
        } else {
          configText = sub.v2ray_config;
        }
      }
    } catch (e) {
      configText = sub.v2ray_config || "";
    }

    const configLines = configText.split('\n')
      .map(l => l.trim())
      .filter(line => line.startsWith('vless://') || line.startsWith('vmess://') || line.startsWith('trojan://'))
      .filter(line => {
        const isExplicitlyInactive = inactiveSuffices.some((suffix: string) => line.endsWith(suffix));
        if (isExplicitlyInactive) return false;
        const isActive = activeSuffices.some((suffix: string) => line.endsWith(suffix));
        if (isActive) return true;
        return true; // Keep legacy links
      })
      .join('\n');
    
    if (!configLines) return res.status(200).send('');

    const base64Config = Buffer.from(configLines).toString('base64');
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('profile-title', 'izinet-vpn');
    res.setHeader('Subscription-Userinfo', `upload=0; download=${Math.floor((sub.traffic_used_mb || 0)*1024*1024)}; total=${Math.floor((sub.traffic_limit_mb || 0)*1024*1024)}; expire=${Math.floor(new Date(sub.expires_at).getTime()/1000)}`);
    
    res.send(base64Config);
  } catch (err) {
    res.status(500).send('Error');
  }
});

export default router;
