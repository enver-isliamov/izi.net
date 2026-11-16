import { Router } from 'express';
import { supabase } from '../services/supabase';
import { getXuiForServer } from '../services/xui.service';
import { parseVpnDevices, getPublishedVlessPorts } from '../utils/vpn';
import { MaintenanceService } from '../services/maintenance.service';
import { AwgService } from '../services/awg.service';
import { BotService } from '../services/bot.service';
import { authenticateUser } from '../utils/auth';

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
router.post('/sync-servers', authenticateUser, async (req, res) => {
  try {
    // В фоне запускаем синхронизацию
    MaintenanceService.syncAllServers().catch(e => console.error('Background sync servers error:', e));
    res.json({ success: true, message: 'Синхронизация серверов запущена' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Синхронизация трафика (/api/subscription/sync-traffic)
router.post('/sync-traffic', authenticateUser, async (req, res) => {
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

router.get(['/:id', '/sub/:id', '/user/subscription/universal/:id', '/subscription/universal/:id', '/subscription/:id', '/universal/:id'], async (req, res) => {
  const { id } = req.params;
  const { deviceId, cdn, ws, mode } = req.query;
  const isCdnOnly = cdn === '1' || ws === '1' || mode === 'cdn' || mode === 'ws';

  // Prevent routing collisions with static sub-routes
  if (['config', 'servers', 'sync-servers', 'sync-traffic', 'universal-link-visible'].includes(id)) {
    return res.status(404).send('Not found');
  }

  try {
    let sub: any = null;
    const { data: subById } = await supabase.from('subscriptions').select('*').eq('id', id).maybeSingle();
    
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
    let isSpecificDevice = false;
    if (deviceId) {
      const filtered = devices.filter((d: any) => d.id === deviceId);
      if (filtered.length > 0) {
        devices = filtered;
        isSpecificDevice = true;
      }
    }

    const finalLinks: string[] = [];

    // Helper: Find server from host/ip in link
    const findMatchingServer = (link: string) => {
      const hostMatch = link.match(/@([^:/?#]+):/);
      if (!hostMatch) return null;
      const host = hostMatch[1].toLowerCase();
      const found = activeServers.find((s: any) => 
        (s.ip && s.ip.toLowerCase().includes(host)) ||
        (s.domain && s.domain.toLowerCase() === host) ||
        (s.public_host && s.public_host.toLowerCase() === host) ||
        (host === 'izinet.online' && (s.domain === 'vpn.izinet.online' || s.public_host === 'vpn.izinet.online'))
      );
      return found || null;
    };

    // Collections categorized by priority to ensure reliable direct-IP nodes are always tested first
    const primaryDirectLinks: string[] = [];
    const secondaryDirectLinks: string[] = [];
    const fallbackCdnLinks: string[] = [];

    // Helper: Clean remark format
    const formatRemark = (serverName: string, suffix?: string) => {
      const cleanName = serverName.trim().replace(/\s+/g, '_');
      const base = cleanName.startsWith('izinet_') ? cleanName : `izinet_${cleanName}`;
      return suffix ? `${base}_${suffix}` : base;
    };

    // 1. Process VLESS WebSocket fallback links
    try {
      const { data: wsFallback } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'WS_FALLBACK_LINK')
        .maybeSingle();
      const rawWs = (wsFallback?.value || '').trim();
      if (rawWs) {
        for (const line of rawWs.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('vless://')) {
            const hasTag = trimmed.includes('#');
            const link = hasTag ? trimmed : `${trimmed}#izinet_WS_Fallback`;
            // Categorize: direct IP WS vs Cloudflare CDN WS
            if (link.includes('Cloudflare') || link.includes('@izinet.online') || link.includes('@172.67.') || link.includes('@104.21.')) {
              fallbackCdnLinks.push(link);
            } else if (link.includes('_IP') || link.includes('@89.125.17.44')) {
              primaryDirectLinks.push(link);
            } else {
              secondaryDirectLinks.push(link);
            }
          }
        }
        // Add dynamic Cloudflare Auto proxy node for proxied domain to fallback list
        if (!rawWs.includes('@izinet.online:443')) {
          fallbackCdnLinks.push(`vless://4a668db8-1558-4d46-9ff5-99487dc6632b@izinet.online:443?alpn=http%2F1.1&encryption=none&fp=firefox&host=izinet.online&path=%2Fizinet-ws&security=tls&sni=izinet.online&type=ws&packetEncoding=xudp#izinet_Cloudflare_Auto`);
        }
      }
    } catch (e: any) {
      console.warn(`⚠️ [SUB] WS fallback skipped: ${e.message}`);
    }

    // 2. Add VLESS Reality / AWG device links (skipped in CDN-only mode to prevent Hiddify healthcheck drops)
    if (!isCdnOnly) {
      for (const device of devices) {
        const isAwgDevice = String(device.serverType).toUpperCase() === 'AWG' || String(device.serverType).toUpperCase() === 'ROUTER';

        if (isAwgDevice) {
          // AmneziaWG device
          try {
            const userIdentifier = device.email || userEmail || sub.user_id || sub.id;
            const awgData = await AwgService.getOrCreatePeerForUser(userIdentifier, formatRemark(device.label || 'AmneziaWG'));
            if (awgData?.wireguardUrl) {
              secondaryDirectLinks.push(awgData.wireguardUrl.replace(/(#.*)?$/, `#${formatRemark(device.label || 'AmneziaWG')}`));
            }
            if (awgData?.awgUrl) {
              secondaryDirectLinks.push(awgData.awgUrl.replace(/(#.*)?$/, `#${formatRemark(device.label || 'AmneziaWG', 'Native')}`));
            }
          } catch (e: any) {
            console.warn(`⚠️ [SUB] AWG device link error: ${e.message}`);
          }
        } else {
          // VLESS Reality device
          const collectedVless: string[] = [];

          if (device.config) {
            const lines = device.config.split('\n').map((l: string) => l.trim()).filter(Boolean);
            for (const line of lines) {
              if (line.startsWith('vless://')) {
                collectedVless.push(line);
              }
            }
          }

          // If no VLESS links found in stored config, heal dynamically
          if (collectedVless.length === 0 && activeServers.length > 0 && device.uuid && device.email) {
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
                      collectedVless.push(rawLink);
                    }
                  } catch (e) {}
                }
              } catch (e) {}
            }
          }

          // Format each VLESS link with proper server name and heal outdated/blocked SNIs
          for (let rawVless of collectedVless) {
            const matchedServer = findMatchingServer(rawVless);
            const activeHost = matchedServer?.domain || matchedServer?.ip || 'vpn.izinet.online';

            // Route node directly to VPS (vpn.izinet.online) to bypass Cloudflare CDN edge
            const targetHost = (activeHost && activeHost !== 'izinet.online') ? activeHost : 'vpn.izinet.online';
            rawVless = rawVless.replace(/@[^:/?#]+:/, `@${targetHost}:`);

            // Heal blocked/mismatched SNI in cached links to use unblocked Google CDN SNI
            if (rawVless.includes('security=reality')) {
              rawVless = rawVless
                .replace(/([?&]sni=)[^&#]+/, '$1dl.google.com')
                .replace(/([?&]host=)[^&#]+/, '$1dl.google.com');
            }

            const portMatch = rawVless.match(/:(\d+)\?/);
            const port = portMatch ? portMatch[1] : '';
            const protoSuffix = rawVless.includes('type=grpc') ? 'gRPC' : (rawVless.includes('type=xhttp') ? 'XHTTP' : (port === '443' ? 'Reality' : `Reality_${port}`));
            const serverBaseName = matchedServer?.name || 'OneD';

            const rawIp = matchedServer?.ip || '89.125.17.44';
            const serverIp = rawIp.replace(/^https?:\/\//, '').split(':')[0] || '89.125.17.44';

            // Special handling for standard Port 443 Reality (best camouflage against TSPU DPI)
            if (port === '443' && rawVless.includes('security=reality')) {
              // 1. Microsoft camouflage (clean foreign CDN, passes TSPU without ASN mismatch)
              const msVless = rawVless
                .replace(/([?&]sni=)[^&#]+/, '$1www.microsoft.com')
                .replace(/([?&]host=)[^&#]+/, '$1www.microsoft.com');
              if (serverIp) {
                const ipMsVless = msVless.replace(/@[^:/?#]+:/, `@${serverIp}:`);
                primaryDirectLinks.push(ipMsVless.replace(/(#.*)?$/, `#${formatRemark(serverBaseName, 'Reality_Microsoft_IP')}`));
              }
              secondaryDirectLinks.push(msVless.replace(/(#.*)?$/, `#${formatRemark(serverBaseName, 'Reality_Microsoft')}`));

              // 2. Samsung camouflage (clean foreign CDN, alternative TLS certificate)
              const samsungVless = rawVless
                .replace(/([?&]sni=)[^&#]+/, '$1www.samsung.com')
                .replace(/([?&]host=)[^&#]+/, '$1www.samsung.com');
              if (serverIp) {
                const ipSamsungVless = samsungVless.replace(/@[^:/?#]+:/, `@${serverIp}:`);
                primaryDirectLinks.push(ipSamsungVless.replace(/(#.*)?$/, `#${formatRemark(serverBaseName, 'Reality_Samsung_IP')}`));
              }
              secondaryDirectLinks.push(samsungVless.replace(/(#.*)?$/, `#${formatRemark(serverBaseName, 'Reality_Samsung')}`));

              // 3. Google camouflage direct IP
              if (serverIp && serverIp !== targetHost) {
                const ipVless = rawVless.replace(/@[^:/?#]+:/, `@${serverIp}:`);
                primaryDirectLinks.push(ipVless.replace(/(#.*)?$/, `#${formatRemark(serverBaseName, `${protoSuffix}_IP`)}`));
              }
              secondaryDirectLinks.push(rawVless.replace(/(#.*)?$/, `#${formatRemark(serverBaseName, protoSuffix)}`));

              // 4. Yandex camouflage (for ISPs requiring domestic SNI)
              const yandexVless = rawVless
                .replace(/([?&]sni=)[^&#]+/, '$1docs.yandex.ru')
                .replace(/([?&]host=)[^&#]+/, '$1docs.yandex.ru');
              if (serverIp && serverIp !== targetHost) {
                const ipYandexVless = yandexVless.replace(/@[^:/?#]+:/, `@${serverIp}:`);
                secondaryDirectLinks.push(ipYandexVless.replace(/(#.*)?$/, `#${formatRemark(serverBaseName, `${protoSuffix}_Yandex_IP`)}`));
              }
              secondaryDirectLinks.push(yandexVless.replace(/(#.*)?$/, `#${formatRemark(serverBaseName, `${protoSuffix}_Yandex`)}`));
            } else {
              // Non-443 Reality (gRPC 2022, XHTTP 2088)
              secondaryDirectLinks.push(rawVless.replace(/(#.*)?$/, `#${formatRemark(serverBaseName, protoSuffix)}`));
              if (serverIp && serverIp !== targetHost) {
                const ipVless = rawVless.replace(/@[^:/?#]+:/, `@${serverIp}:`);
                secondaryDirectLinks.push(ipVless.replace(/(#.*)?$/, `#${formatRemark(serverBaseName, `${protoSuffix}_IP`)}`));
              }
              if (rawVless.includes('security=reality')) {
                const yandexVless = rawVless
                  .replace(/([?&]sni=)[^&#]+/, '$1docs.yandex.ru')
                  .replace(/([?&]host=)[^&#]+/, '$1docs.yandex.ru');
                secondaryDirectLinks.push(yandexVless.replace(/(#.*)?$/, `#${formatRemark(serverBaseName, `${protoSuffix}_Yandex`)}`));
                if (serverIp && serverIp !== targetHost) {
                  const ipYandexVless = yandexVless.replace(/@[^:/?#]+:/, `@${serverIp}:`);
                  secondaryDirectLinks.push(ipYandexVless.replace(/(#.*)?$/, `#${formatRemark(serverBaseName, `${protoSuffix}_Yandex_IP`)}`));
                }
              }
            }
          }
        }
      }

      // 3. Add Hysteria 2 links for each active server (using UDP port 443 - primary anti-DPI protocol)
      try {
        const { data: hySettings } = await supabase.from('settings').select('value').eq('key', 'HYSTERIA_PASSWORD').maybeSingle();
        const hyPassword = hySettings?.value;
        if (hyPassword) {
          const defaultVpnHost = process.env.PUBLIC_HOST || 'vpn.izinet.online';
          if (activeServers.length > 0) {
            for (const server of activeServers) {
              const host = server.domain || server.public_host || server.ip || defaultVpnHost;
              const cleanIp = (server.ip || '89.125.17.44').replace(/^https?:\/\//, '').split(':')[0];
              if (cleanIp) {
                primaryDirectLinks.push(`hysteria2://${hyPassword}@${cleanIp}:443?insecure=1&sni=vpn.izinet.online#${formatRemark(server.name || 'Server', 'Hysteria2_IP')}`);
              }
              secondaryDirectLinks.push(`hysteria2://${hyPassword}@${host}:443?insecure=1&sni=vpn.izinet.online#${formatRemark(server.name || 'Server', 'Hysteria2')}`);
            }
          } else {
            primaryDirectLinks.push(`hysteria2://${hyPassword}@89.125.17.44:443?insecure=1&sni=vpn.izinet.online#izinet_Hysteria2_IP`);
            secondaryDirectLinks.push(`hysteria2://${hyPassword}@${defaultVpnHost}:443?insecure=1&sni=vpn.izinet.online#izinet_Hysteria2`);
          }
        }
      } catch (e: any) {
        console.warn(`⚠️ [SUB] Hysteria link creation skipped: ${e.message}`);
      }
    }

    // Assemble finalLinks in strictly ordered priority:
    // 1. Primary Direct IP links (Reality Microsoft/Samsung IP, Hysteria 2 IP, WS Direct IP)
    // 2. Secondary Direct links (Domain-based Reality, non-443 Reality, gRPC, XHTTP)
    // 3. Cloudflare CDN Fallback links (at the end so they do not cause healthcheck/balancer drops)
    const finalLinks: string[] = [
      ...primaryDirectLinks,
      ...secondaryDirectLinks,
      ...fallbackCdnLinks
    ];

    // 4. Add AmneziaWG (WireGuard Anti-DPI) links only for native AWG clients,
    // as Hiddify/sing-box hangs when encountering custom awg:// or obfuscated wireguard:// in universal subs.
    // AWG users receive their config via the dedicated .conf endpoint, the dashboard button, or Telegram.

    // Ensure all VLESS WebSocket links have packetEncoding=xudp for UDP/DNS tunneling
    const normalizedLinks = finalLinks.map(link => {
      if (link.startsWith('vless://') && link.includes('type=ws') && !link.includes('packetEncoding=')) {
        return link.replace(/(#.*)?$/, '&packetEncoding=xudp$1');
      }
      return link;
    });

    // Deduplicate exact duplicate lines
    const uniqueLinks = [...new Set(normalizedLinks.filter(Boolean))];

    let outputText = uniqueLinks.join('\n');
    if (!outputText.trim()) {
      console.warn(`⚠️ [SUB] Empty config for subscription ${sub.id}, returning fallback notice`);
      outputText = `# profile: izinet.online\n# status: configuring\n# user: ${userEmail || sub.id}`;
    }

    const base64Config = Buffer.from(outputText).toString('base64');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('profile-title', `izinet.online${userEmail ? ' ' + userEmail : ''}`);
    res.setHeader('profile-web-page-url', 'https://izinet.online');
    res.setHeader('profile-update-interval', '24');
    res.setHeader('Content-Disposition', 'inline; filename="izinet.txt"');
    res.setHeader('Subscription-Userinfo', 'upload=0; download=' + Math.floor((sub.traffic_used_mb || 0)*1024*1024) + '; total=' + Math.floor((sub.traffic_limit_mb || 0)*1024*1024) + '; expire=' + Math.floor(new Date(sub.expires_at).getTime()/1000));
    res.send(base64Config);
  } catch (err: any) {
    console.error('🔥 [SUB] Error generating subscription config:', err);
    res.status(500).send('Error generating subscription');
  }
});

// Скачивание готового файла .conf для приложения AmneziaWG / WireGuard
router.get(['/:id/awg.conf', '/sub/:id/awg.conf', '/subscription/awg-conf/:id', '/api/subscription/awg-conf/:id', '/awg-conf/:id'], async (req, res) => {
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
router.get(['/:id/awg-info', '/sub/:id/awg-info', '/subscription/awg-info/:id', '/api/subscription/awg-info/:id', '/awg-info/:id'], async (req, res) => {
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

