import { Router } from 'express';
import { supabase } from '../services/supabase';
import { getXuiForServer } from '../services/xui.service';
import { parseVpnDevices, getPublishedVlessPorts } from '../utils/vpn';
import { MaintenanceService } from '../services/maintenance.service';

const router = Router();

// --- МАРШРУТЫ СИНХРОНИЗАЦИИ ---

router.get('/config', (req, res) => {
  res.json({
    telegramBotName: process.env.VITE_TELEGRAM_BOT_NAME || 'izinet_bot',
    publicUrl: process.env.PUBLIC_URL || 'https://izinet.online'
  });
});

// SERVERS-STATUS: публичная страница «Сети» (/servers); ping/load — заглушки (колонок в БД нет, нужен сборщик метрик)
router.get('/servers/status', async (_req, res) => {
  try {
    const { data: servers, error } = await supabase.from('vpn_servers').select('id,name,location_code,is_active,ip,domain,health_status');
    if (error) throw error;
    res.json((servers || []).map((sv: any) => ({
      ...sv,
      ping: sv.health_status === 'ok' ? 42 : 999,
      load: sv.health_status === 'ok' ? 25 : 0
    })));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
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
    let sub: any = null;
    const { data: subById, error: errById } = await supabase.from('subscriptions').select('*').eq('id', id).maybeSingle();
    
    if (subById) {
      sub = subById;
    } else {
      // Fallback: search by user_id
      const { data: subByUser } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (subByUser) {
        sub = subByUser;
      }
    }

    if (!sub) {
      console.warn(`⚠️ [SUB] Subscription not found for param: ${id}`);
      return res.status(404).send('Subscription not found');
    }

    // Allow active, limited, trial or valid unexpired subscriptions
    const isStatusAllowed = ['active', 'limited', 'trial'].includes(sub.status) || 
      (sub.expires_at && new Date(sub.expires_at).getTime() > Date.now());

    if (!isStatusAllowed) {
      console.warn(`⚠️ [SUB] Subscription ${id} inactive status: ${sub.status}`);
      return res.status(404).send('Subscription inactive');
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

        // Get active server names for filtering
        const { data: allActiveServers } = await supabase
          .from('vpn_servers')
          .select('name,health_status')
          .eq('is_active', true);
        
        const healthyServers = (allActiveServers || []).filter((s: any) => s.health_status === 'ok');
        const activeServers = healthyServers.length > 0 ? healthyServers : (allActiveServers || []);
        const activeNames = activeServers.map((s: any) => s.name.replace(/\s+/g, '_'));

        // Join device configs with real newline
        const allLines = devices.map((d: any) => d.config).filter(Boolean).join('\n');

        // Filter: keep lines from active servers (or all if no active servers found)
        if (activeNames.length > 0 && allLines) {
          const filtered = allLines.split('\n').filter((line: string) => {
            const suffix = line.split('#')[1] || '';
            return activeNames.some((name: string) => suffix.includes(name)) || suffix.includes('izinet');
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
        const { data: allActiveServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
        const healthyServers = (allActiveServers || []).filter((s: any) => s.health_status === 'ok');
        const activeServers = healthyServers.length > 0 ? healthyServers : (allActiveServers || []);

        if (devices.length > 0 && activeServers && activeServers.length > 0) {
          let changed = false;
          for (const device of devices) {
            if (!device.uuid || !device.email) continue;
            const lines: string[] = [];
            for (const server of activeServers) {
              try {
                const { instance, server: serverData } = await getXuiForServer(server.id);
                const inbounds = await instance.getInbounds();
                const pubPorts = await getPublishedVlessPorts();
                const realityInbounds = inbounds.filter((ib: any) => {
                  try {
                    const ss = JSON.parse(ib.streamSettings || '{}');
                    return ss.security === 'reality' && ib.enable !== false && (!pubPorts || pubPorts.includes(ib.port));
                  } catch { return false; }
                });
                for (const ri of realityInbounds) {
                  try {
                    const rawLink = await instance.getInboundLink(ri.id, device.uuid, device.email);
                    if (rawLink) lines.push(rawLink.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g, '_')}`));
                  } catch (e) {}
                }
              } catch (e) {}
            }
            if (lines.length > 0) { device.config = lines.join('\n'); changed = true; }
          }
          if (changed) {
            await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices), updated_at: new Date().toISOString() }).eq('id', sub.id);
            configText = devices.map((d: any) => d.config).filter(Boolean).join('\n');
            console.log(`✅ [SUB] Lazy heal succeeded for ${sub.id}`);
          }
        }
      } catch (e: any) {
        console.error(`❌ [SUB] Lazy heal failed for ${id}: ${e.message}`);
      }
    }

    // Добавляем Hysteria2 ссылки если настроен
    try {
      const { data: hySettings } = await supabase.from('settings').select('value').eq('key', 'HYSTERIA_PASSWORD').maybeSingle();
      if (hySettings?.value) {
        const hyPassword = hySettings.value;
        const hyLinks: string[] = [];
        const devices = configText.split('\n').filter((l: string) => l.startsWith('vless://'));
        for (const device of devices) {
          const emailMatch = device.match(/#(.+)$/);
          const name = emailMatch ? decodeURIComponent(emailMatch[1]) : 'izinet';
          hyLinks.push(`hysteria2://${hyPassword}@194.50.94.28:443?insecure=1#${name}-hysteria`);
        }
        if (hyLinks.length > 0) {
          configText = (configText ? configText + '\n' : '') + [...new Set(hyLinks)].join('\n');
        }
      }
    } catch (e) {}

    // RENAME-001: в клиенте VPN показываем бренд и email подписчика вместо «izi.net VPN» / имён серверов (#OneD)
    const { data: subUser } = await supabase.from('users').select('email').eq('id', sub.user_id).maybeSingle();
    const userEmail = subUser?.email || '';
    const subRemark = `izinet.online${userEmail ? '_' + userEmail : ''}`;

    if (configText && configText.trim()) {
      configText = [...new Set(configText.split('\n').map(line => line.trim() ? line.replace(/(#.*)$/, `#${subRemark}`) : line))].join('\n');
    }

    if (!configText || !configText.trim()) {
      console.warn(`⚠️ [SUB] Empty config for subscription ${sub.id}, returning fallback notice`);
      configText = `# profile: izinet.online\n# status: configuring\n# user: ${userEmail || sub.id}`;
    }

    const base64Config = Buffer.from(configText).toString('base64');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('profile-title', `izinet.online${userEmail ? ' ' + userEmail : ''}`);
    res.setHeader('profile-web-page-url', 'https://izinet.online');
    res.setHeader('profile-update-interval', '12');
    res.setHeader('Subscription-Userinfo', 'upload=0; download=' + Math.floor((sub.traffic_used_mb || 0)*1024*1024) + '; total=' + Math.floor((sub.traffic_limit_mb || 0)*1024*1024) + '; expire=' + Math.floor(new Date(sub.expires_at).getTime()/1000));
    res.send(base64Config);
  } catch (err: any) {
    console.error('🔥 [SUB] Error generating subscription config:', err);
    res.status(500).send('Error generating subscription');
  }
});

export default router;

