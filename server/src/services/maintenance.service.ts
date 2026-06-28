import { supabase } from './supabase';
import { getXuiForServer } from './xui.service';
import { parseVpnDevices } from '../utils/vpn';

import { RoutingService } from './routing.service';

export class MaintenanceService {
  private static interval: NodeJS.Timeout | null = null;
  private static isSyncing = false;
  private static isSyncingServers = false;

  static init() {
    if (this.interval) return;

    console.log('📦 Maintenance Service initialized (Lightweight Sync)');
    
    // Run sync every 30 minutes
    this.interval = setInterval(() => this.runFullMaintenance(), 30 * 60 * 1000);
    
    // Initial run
    setTimeout(() => this.runFullMaintenance(), 10000);
  }

  static async runFullMaintenance() {
    try {
      console.log('🔄 [Maintenance] Starting full maintenance cycle...');
      
      // DATA-005: Use catch on each step to prevent full crash
      await this.healthCheckAllServers().catch(e => console.error('❌ [Maintenance] healthCheck failed:', e.message));
      await this.cleanupExpiredSubscriptions().catch(e => console.error('❌ [Maintenance] cleanupExpired failed:', e.message));
      await this.syncTraffic().catch(e => console.error('❌ [Maintenance] syncTraffic failed:', e.message));
      await this.syncAllServers().catch(e => console.error('❌ [Maintenance] syncAllServers failed:', e.message));
      await RoutingService.syncAll().catch(e => console.error('❌ [Maintenance] Routing syncAll failed:', e.message));
      
      console.log('✅ [Maintenance] Full maintenance cycle complete.');
    } catch (err: any) {
      console.error('🔥 [Maintenance] Critical error in runFullMaintenance:', err.message);
    }
  }

  // BUG-VPN-10: Health check all servers
  static async healthCheckAllServers() {
    console.log('🏥 [Maintenance] Running health check on all servers...');
    try {
      const { data: servers, error } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
      if (error || !servers || servers.length === 0) return;

      const net = await import('net');
      
      for (const server of servers) {
        try {
          const { instance } = await getXuiForServer(server.id);
          const panelOk = await instance.checkHealth();
          
          let tcpReachable = false;
          if (panelOk) {
            try {
              const host = (server.public_host || server.domain || server.ip || '').replace(/^https?:\/\//, '').split(':')[0];
              const port = server.vpn_port || 443;
              if (host) {
                const sock = new net.Socket();
                await new Promise<void>((resolve, reject) => {
                  sock.setTimeout(5000);
                  sock.connect(port, host, () => { tcpReachable = true; sock.destroy(); resolve(); });
                  sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
                  sock.on('error', (e) => { reject(e); });
                });
              }
            } catch (e) {}
          }

          const healthStatus = panelOk && tcpReachable ? 'ok' : (panelOk ? 'degraded' : 'down');
          
          await supabase.from('vpn_servers').update({
            health_status: healthStatus,
            last_health_check_at: new Date().toISOString()
          }).eq('id', server.id);

          console.log(`🏥 [Health] ${server.name}: ${healthStatus} (panel=${panelOk}, tcp=${tcpReachable})`);
        } catch (e: any) {
          console.error(`❌ [Health] ${server.name} check failed: ${e.message}`);
          await supabase.from('vpn_servers').update({
            health_status: 'down',
            last_health_check_at: new Date().toISOString()
          }).eq('id', server.id);
        }
      }
    } catch (err: any) {
      console.error('❌ [Health] healthCheckAllServers failed:', err.message);
    }
  }

  // INFRA-002: Delete X-UI clients for expired subscriptions
  static async cleanupExpiredSubscriptions() {
    console.log('🧹 [Maintenance] Cleaning up expired subscriptions...');
    try {
      const now = new Date().toISOString();
      
      // Find active subscriptions that have expired
      const { data: expiredSubs, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('status', 'active')
        .lt('expires_at', now);

      if (error || !expiredSubs || expiredSubs.length === 0) {
        console.log('✅ [Maintenance] No expired subscriptions found.');
        return;
      }

      console.log(`🧹 [Maintenance] Found ${expiredSubs.length} expired subscriptions, cleaning up...`);

      const { data: servers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
      if (!servers) return;

      for (const sub of expiredSubs) {
        try {
          const devices = parseVpnDevices(sub.v2ray_config);
          
          // Delete X-UI clients for each device
          for (const server of servers) {
            const { instance } = await getXuiForServer(server.id);
            for (const dev of devices) {
              if (dev.uuid && dev.email) {
                await instance.deleteClient(dev.uuid, dev.email).catch(() => {});
              }
            }
          }

          // Mark subscription as expired
          await supabase
            .from('subscriptions')
            .update({ status: 'expired', updated_at: now })
            .eq('id', sub.id);

          console.log(`✅ [Maintenance] Expired subscription ${sub.id} cleaned up.`);
        } catch (e: any) {
          console.error(`❌ [Maintenance] Failed to cleanup subscription ${sub.id}:`, e.message);
        }
      }
    } catch (err: any) {
      console.error('❌ [Maintenance] cleanupExpiredSubscriptions error:', err.message);
    }
  }

  static async syncAllServers() {
    // CORE-006: Prevent concurrent server sync
    if (this.isSyncingServers) {
      console.log('⚠️ [Maintenance] syncAllServers already running, skipping...');
      return;
    }
    this.isSyncingServers = true;

    console.log('🔄 [Maintenance] Syncing all users to all active servers...');
    try {
      const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
      const { data: activeSubs } = await supabase.from('subscriptions').select('*').in('status', ['active', 'limited']);

      if (!activeServers || !activeSubs) return;

      for (const sub of activeSubs) {
        try {
          const devices = parseVpnDevices(sub.v2ray_config);
          if (devices.length === 0) continue;

          const defaultInboundId = 0;
          const limitBytes = (sub.traffic_limit_mb || 102400) * 1024 * 1024;
          const expiryTime = new Date(sub.expires_at).getTime();

          for (const server of activeServers) {
            const { instance, server: serverData } = await getXuiForServer(server.id);

            let inboundId = serverData.inbound_id || defaultInboundId;
            if (!inboundId || inboundId <= 0) {
              try {
                const inbounds = await instance.getInbounds();
                const realityInbound = inbounds.find((ib: any) => {
                  try {
                    const ss = typeof ib.streamSettings === 'string' ? JSON.parse(ib.streamSettings) : (ib.streamSettings || {});
                    return ss.security === 'reality' && ib.port === 443;
                  } catch { return false; }
                });
                if (realityInbound) inboundId = realityInbound.id;
              } catch (e) {}
            }

            for (const dev of devices) {
              await instance.addClient(dev.email, dev.uuid, inboundId, expiryTime, limitBytes).catch(e => {
                console.warn(`⚠️ [Sync] Failed to sync ${dev.email} to ${server.name}: ${e.message}`);
              });
            }
          }
        } catch (e) {}
      }
      console.log('✅ [Maintenance] Server sync complete.');
    } catch (err: any) {
      console.error('❌ [Maintenance] Sync error:', err.message);
    } finally {
      this.isSyncingServers = false;
    }
  }

  static async syncTraffic() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      console.log('🔄 [Maintenance] Starting background traffic sync...');
      
      const { data: subs, error } = await supabase
        .from('subscriptions')
        .select('*')
        .in('status', ['active', 'limited']);

      if (error || !subs) throw error || new Error('No active subs');

      // Process users in SMALL batches with DELAYS to keep network stable
      const BATCH_SIZE = 3;
      const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds

      for (let i = 0; i < subs.length; i += BATCH_SIZE) {
        const batch = subs.slice(i, i + BATCH_SIZE);
        
        await Promise.allSettled(batch.map(async (sub) => {
          try {
            const devices = parseVpnDevices(sub.v2ray_config);
            if (devices.length === 0) return;

            let totalUsedBytes = 0;

            // Check traffic on servers
            const { data: servers } = await supabase.from('vpn_servers').select('id').eq('is_active', true);
            if (!servers) return;

            for (const s of servers) {
              const { instance } = await getXuiForServer(s.id);
              
              // Skip if server is known to be offline
              const isHealthy = await instance.checkConfig();
              if (!isHealthy) continue;

              for (const dev of devices) {
                const stats = await instance.getClientTraffic(dev.email);
                if (stats) totalUsedBytes += stats.used;
              }
            }

            const usedMb = Math.floor(totalUsedBytes / (1024 * 1024));
            
            if (usedMb > (sub.traffic_used_mb || 0)) {
              await supabase
                .from('subscriptions')
                .update({ traffic_used_mb: usedMb })
                .eq('id', sub.id);
            }
          } catch (e) {}
        }));

        // Breath time for the server network stack
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }

      console.log('✅ [Maintenance] Traffic sync complete.');
    } catch (err: any) {
      console.error('❌ [Maintenance] Sync error:', err.message);
    } finally {
      this.isSyncing = false;
    }
  }

  static stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
