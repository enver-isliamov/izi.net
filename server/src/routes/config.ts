import { Router } from 'express';
import { supabase } from '../services/supabase';
import { getXuiForServer } from '../services/xui.service';
import { parseVpnDevices } from '../utils/vpn';
import { MaintenanceService } from '../services/maintenance.service';

const router = Router();

// --- МАРШРУТЫ СИНХРОНИЗАЦИИ ---

router.get('/config', (req, res) => {
  res.json({
    telegramBotName: process.env.VITE_TELEGRAM_BOT_NAME || 'izinet_bot',
    publicUrl: process.env.PUBLIC_URL || 'https://izinet.online'
  });
});

// Синхронизация серверов (фронтенд вызывает это через /api/subscription/sync-servers)
router.post('/sync-servers', async (req, res) => {
  try {
    // В фоне запускаем синхронизацию
    MaintenanceService.syncAllServers().catch(e => console.error('Background sync servers error:', e));
    res.json({ success: true, message: 'Синхронизация серверов запущена' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Синхронизация трафика (/api/subscription/sync-traffic)
router.post('/sync-traffic', async (req, res) => {
  try {
    MaintenanceService.syncTraffic().catch(e => console.error('Background sync traffic error:', e));
    res.json({ success: true, message: 'Синхронизация трафика запущена' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Универсальная видимость ссылок (/api/subscription/universal-link-visible)
router.get('/universal-link-visible', (req, res) => {
  res.json({ visible: true });
});

router.get('/sub/:id', async (req, res) => {
  const { id } = req.params;
  const { deviceId } = req.query;

  try {
    const { data: sub, error } = await supabase.from('subscriptions').select('*').eq('id', id).maybeSingle();

    if (error || !sub || sub.status !== 'active') {
      return res.status(404).send('Subscription not found');
    }

    // CACHE-001: VPN clients always get fresh subscription data
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    let configText = sub.v2ray_config || '';
    try {
      if (configText.startsWith('[')) {
        let devices = JSON.parse(configText);
        if (deviceId) devices = devices.filter((d: any) => d.id === deviceId);

        // Get active server names for filtering (only healthy servers)
        const { data: activeServers } = await supabase
          .from('vpn_servers')
          .select('name')
          .eq('is_active', true)
          .eq('health_status', 'ok');
        const activeNames = (activeServers || []).map((s: any) => s.name.replace(/\s+/g, '_'));

        // Join device configs with real newline
        const allLines = devices.map((d: any) => d.config).join('\n');

        // Filter: keep lines from active servers (or all if no active servers found)
        if (activeNames.length > 0) {
          const filtered = allLines.split('\n').filter((line: string) => {
            const suffix = line.split('#')[1] || '';
            return activeNames.some((name: string) => suffix.includes(name));
          });
          configText = filtered.length > 0 ? filtered.join('\n') : allLines;
        } else {
          configText = allLines;
        }
      }
    } catch (e) {}

    // Fallback: if config is empty after filtering, try lazy regeneration
    if (!configText || !configText.trim()) {
      console.log(`🔄 [SUB] Lazy heal for ${id} — v2ray_config empty or no valid links`);
      try {
        const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
        const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true).eq('health_status', 'ok');
        if (devices.length > 0 && activeServers && activeServers.length > 0) {
          let changed = false;
          for (const device of devices) {
            if (!device.uuid || !device.email) continue;
            const lines: string[] = [];
            for (const server of activeServers) {
              try {
                const { instance, server: serverData } = await getXuiForServer(server.id);
                let effectiveInboundId = serverData.inbound_id || 0;
                if (!effectiveInboundId || effectiveInboundId <= 0) {
                  const inbounds = await instance.getInbounds();
                  const ri = inbounds.find((ib: any) => {
                    try { const ss = JSON.parse(ib.streamSettings || '{}'); return ss.security === 'reality' && ib.port === 443; } catch { return false; }
                  });
                  if (ri) effectiveInboundId = ri.id;
                }
                const rawLink = await instance.getInboundLink(effectiveInboundId, device.uuid, device.email);
                if (rawLink) lines.push(rawLink.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g, '_')}`));
              } catch (e) {}
            }
            if (lines.length > 0) { device.config = lines.join('\n'); changed = true; }
          }
          if (changed) {
            await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices), updated_at: new Date().toISOString() }).eq('id', id);
            configText = devices.map((d: any) => d.config).join('\n');
            console.log(`✅ [SUB] Lazy heal succeeded for ${id}`);
          }
        }
      } catch (e: any) {
        console.error(`❌ [SUB] Lazy heal failed for ${id}: ${e.message}`);
      }
    }

    if (!configText || !configText.trim()) {
      return res.status(404).send('No valid VPN configs found for this subscription');
    }

    const base64Config = Buffer.from(configText).toString('base64');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('profile-title', 'izi.net VPN');
    res.setHeader('profile-web-page-url', 'https://izinet.online');
    res.setHeader('profile-update-interval', '12');
    res.setHeader('Subscription-Userinfo', 'upload=0; download=' + Math.floor((sub.traffic_used_mb || 0)*1024*1024) + '; total=' + Math.floor((sub.traffic_limit_mb || 0)*1024*1024) + '; expire=' + Math.floor(new Date(sub.expires_at).getTime()/1000));
    res.send(base64Config);
  } catch (err) {
    res.status(500).send('Error');
  }
});

export default router;

