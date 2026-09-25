import { Router } from 'express';
import { supabase } from '../services/supabase';
import { getXuiForServer } from '../services/xui.service';
import { parseVpnDevices, getPublishedVlessPorts } from '../utils/vpn';
import { MaintenanceService } from '../services/maintenance.service';
import { AwgService } from '../services/awg.service';
import { BotService } from '../services/bot.service';

const router = Router();

// --- МАРШРУТЫ СИНХРОНИЗАЦИИ ---

router.get('/config', (req, res) => {
  res.json({
    telegramBotName: BotService.getBotUsername(),
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
router.get('/universal-link-visible', async (req, res) => {
  try {
    let settingStatus = 'all';
    try {
      const { data: settingData } = await supabase.from('settings').select('value').eq('key', 'UNIVERSAL_LINK_STATUS').maybeSingle();
      if (settingData?.value) settingStatus = settingData.value;
    } catch (e) {}

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.json({ visible: settingStatus === 'all', status: settingStatus });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    
    if (authErr || !user) {
      return res.json({ visible: settingStatus === 'all', status: settingStatus });
    }

    const { data: dbUser } = await supabase
      .from('users')
      .select('id,role,is_pro,universal_access')
      .eq('id', user.id)
      .maybeSingle();

    const isAdmin = dbUser?.role === 'admin' || dbUser?.role === 'superadmin';
    const isPro = !!dbUser?.is_pro;
    const hasUniversalAccess = !!dbUser?.universal_access;

    if (hasUniversalAccess || isAdmin) {
      return res.json({ visible: true, status: settingStatus, is_pro: isPro, universal_access: true });
    }

    if (settingStatus === 'none') {
      return res.json({ visible: false, status: settingStatus, is_pro: isPro });
    }

    if (settingStatus === 'pro') {
      return res.json({ visible: isPro, status: settingStatus, is_pro: isPro });
    }

    // Default 'all'
    return res.json({ visible: true, status: settingStatus, is_pro: isPro });
  } catch (err: any) {
    return res.json({ visible: true, error: err.message });
  }
});

router.get(['/sub/:id', '/user/subscription/universal/:id', '/subscription/universal/:id', '/subscription/:id'], async (req, res) => {
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

    // Fetch user details
    const { data: subUser } = await supabase.from('users').select('email').eq('id', sub.user_id).maybeSingle();
    const userEmail = subUser?.email || '';
    const safeUserTag = userEmail ? userEmail.split('@')[0] : sub.id.slice(0, 6);

    // Fetch active servers
    const { data: allActiveServers } = await supabase
      .from('vpn_servers')
      .select('*')
      .eq('is_active', true);
    const activeServers = (allActiveServers && allActiveServers.length > 0) ? allActiveServers : [];

    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    if (deviceId) {
      devices = devices.filter((d: any) => d.id === deviceId);
    }

    const collectedVlessLinks: string[] = [];

    // Extract VLESS links from stored device configs
    for (const device of devices) {
      if (device.config) {
        const lines = device.config.split('\n').map((l: string) => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (line.startsWith('vless://')) {
            collectedVlessLinks.push(line);
          }
        }
      }
    }

    // If no VLESS links found or stored configs are empty, heal dynamically from active servers
    if (collectedVlessLinks.length === 0 && activeServers.length > 0 && devices.length > 0) {
      console.log(`🔄 [SUB] Dynamic generation of Reality links for subscription ${sub.id}`);
      for (const device of devices) {
        if (!device.uuid || !device.email) continue;
        for (const server of activeServers) {
          try {
            const { instance, server: serverData } = await getXuiForServer(server.id);
            const inbounds = await instance.getInbounds();
            const pubPorts = await getPublishedVlessPorts();
            const realityInbounds = inbounds.filter((ib: any) => {
              try {
                const ss = typeof ib.streamSettings === 'string' ? JSON.parse(ib.streamSettings) : (ib.streamSettings || {});
                return ss.security === 'reality' && ib.enable !== false && (!pubPorts || pubPorts.includes(ib.port));
              } catch { return false; }
            });
            for (const ri of realityInbounds) {
              try {
                const rawLink = await instance.getInboundLink(ri.id, device.uuid, device.email);
                if (rawLink) {
                  const sName = (server.name || 'Server').replace(/\s+/g, '_');
                  const formatted = rawLink.replace(/(#.*)?$/, `#izinet_${sName}_Reality`);
                  collectedVlessLinks.push(formatted);
                }
              } catch (e) {}
            }
          } catch (e) {}
        }
      }
    }

    const finalLinks: string[] = [];

    // 1. Add VLESS Reality links (preserving clean server-specific titles)
    for (const rawVless of collectedVlessLinks) {
      const match = rawVless.match(/#(.+)$/);
      let sTitle = match ? decodeURIComponent(match[1]) : 'Reality';
      if (!sTitle.toLowerCase().includes('izinet')) {
        sTitle = `izinet_${sTitle}`;
      }
      finalLinks.push(rawVless.replace(/(#.*)?$/, `#${sTitle}`));
    }

    // 2. Add Hysteria 2 links for each active server
    try {
      const { data: hySettings } = await supabase.from('settings').select('value').eq('key', 'HYSTERIA_PASSWORD').maybeSingle();
      const hyPassword = hySettings?.value;
      if (hyPassword) {
        if (activeServers.length > 0) {
          for (const server of activeServers) {
            const host = server.domain || server.ip || '194.50.94.28';
            const sName = (server.name || 'Server').replace(/\s+/g, '_');
            finalLinks.push(`hysteria2://${hyPassword}@${host}:443?insecure=1#izinet_${sName}_Hysteria2`);
          }
        } else {
          finalLinks.push(`hysteria2://${hyPassword}@194.50.94.28:443?insecure=1#izinet_Hysteria2`);
        }
      }
    } catch (e: any) {
      console.warn(`⚠️ [SUB] Hysteria link creation skipped: ${e.message}`);
    }

    // 3. Add AmneziaWG (WireGuard Anti-DPI) links for user
    try {
      const userIdentifier = userEmail || sub.user_id || sub.id;
      const awgData = await AwgService.getOrCreatePeerForUser(userIdentifier, `izinet_${safeUserTag}_AmneziaWG`);
      if (awgData?.wireguardUrl) {
        finalLinks.push(awgData.wireguardUrl.replace(/(#.*)?$/, `#izinet_AmneziaWG`));
      }
      if (awgData?.awgUrl) {
        finalLinks.push(awgData.awgUrl.replace(/(#.*)?$/, `#izinet_AmneziaWG_Native`));
      }
    } catch (e: any) {
      console.warn(`⚠️ [SUB] AmneziaWG link creation skipped: ${e.message}`);
    }

    // Deduplicate exact duplicate lines
    const uniqueLinks = [...new Set(finalLinks.filter(Boolean))];

    let outputText = uniqueLinks.join('\n');
    if (!outputText.trim()) {
      console.warn(`⚠️ [SUB] Empty config for subscription ${sub.id}, returning fallback notice`);
      outputText = `# profile: izinet.online\n# status: configuring\n# user: ${userEmail || sub.id}`;
    }

    const base64Config = Buffer.from(outputText).toString('base64');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('profile-title', `izinet.online${userEmail ? ' ' + userEmail : ''}`);
    res.setHeader('profile-web-page-url', 'https://izinet.online');
    res.setHeader('profile-update-interval', '6');
    res.setHeader('Content-Disposition', 'inline; filename="izinet.txt"');
    res.setHeader('Subscription-Userinfo', 'upload=0; download=' + Math.floor((sub.traffic_used_mb || 0)*1024*1024) + '; total=' + Math.floor((sub.traffic_limit_mb || 0)*1024*1024) + '; expire=' + Math.floor(new Date(sub.expires_at).getTime()/1000));
    res.send(base64Config);
  } catch (err: any) {
    console.error('🔥 [SUB] Error generating subscription config:', err);
    res.status(500).send('Error generating subscription');
  }
});

// Скачивание готового файла .conf для приложения AmneziaWG / WireGuard
router.get(['/sub/:id/awg.conf', '/subscription/awg-conf/:id', '/api/subscription/awg-conf/:id'], async (req, res) => {
  const { id } = req.params;
  try {
    let sub: any = null;
    const { data: subById } = await supabase.from('subscriptions').select('*').eq('id', id).maybeSingle();
    if (subById) {
      sub = subById;
    } else {
      const { data: subByUser } = await supabase.from('subscriptions').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (subByUser) sub = subByUser;
    }

    if (!sub) return res.status(404).send('Subscription not found');

    const { data: subUser } = await supabase.from('users').select('email').eq('id', sub.user_id).maybeSingle();
    const userIdentifier = subUser?.email || sub.user_id || sub.id;

    const awgData = await AwgService.getOrCreatePeerForUser(userIdentifier, 'izinet_AmneziaWG');
    if (!awgData?.conf) return res.status(500).send('Could not generate AmneziaWG configuration');

    const safeName = (subUser?.email || 'user').replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="izinet-${safeName}-amneziawg.conf"`);
    res.send(awgData.conf);
  } catch (err: any) {
    res.status(500).send('Error generating AmneziaWG config: ' + err.message);
  }
});

// Получение информации о параметрах подключения AmneziaWG в формате JSON
router.get(['/sub/:id/awg-info', '/subscription/awg-info/:id', '/api/subscription/awg-info/:id'], async (req, res) => {
  const { id } = req.params;
  try {
    let sub: any = null;
    const { data: subById } = await supabase.from('subscriptions').select('*').eq('id', id).maybeSingle();
    if (subById) {
      sub = subById;
    } else {
      const { data: subByUser } = await supabase.from('subscriptions').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (subByUser) sub = subByUser;
    }

    if (!sub) return res.status(404).json({ ok: false, error: 'Subscription not found' });

    const { data: subUser } = await supabase.from('users').select('email').eq('id', sub.user_id).maybeSingle();
    const userIdentifier = subUser?.email || sub.user_id || sub.id;

    const awgData = await AwgService.getOrCreatePeerForUser(userIdentifier, 'izinet_AmneziaWG');
    if (!awgData) return res.status(500).json({ ok: false, error: 'Could not generate AmneziaWG parameters' });

    res.json({
      ok: true,
      conf: awgData.conf,
      wireguardUrl: awgData.wireguardUrl,
      awgUrl: awgData.awgUrl,
      peer: awgData.peer
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;

