import { supabase } from './supabase';
import { getXuiForServer } from './xui.service';
import { parseVpnDevices } from '../utils/vpn';

import { RoutingService } from './routing.service';

export class MaintenanceService {
  private static interval: NodeJS.Timeout | null = null;
  private static isSyncing = false;

  static init() {
    if (this.interval) return;

    console.log('📦 Maintenance Service initialized (Lightweight Sync)');
    
    // Run sync every 30 minutes
    this.interval = setInterval(() => this.runFullMaintenance(), 30 * 60 * 1000);
    
    // Initial run
    setTimeout(() => this.runFullMaintenance(), 10000);
  }

  static async runFullMaintenance() {
    await this.syncTraffic();
    await this.syncAllServers();
    await RoutingService.syncAll();
  }

  static async syncAllServers() {
    console.log('🔄 [Maintenance] Syncing all users to all active servers...');
    try {
      const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
      const { data: activeSubs } = await supabase.from('subscriptions').select('*').eq('status', 'active');

      if (!activeServers || !activeSubs) return;

      for (const sub of activeSubs) {
        try {
          const devices = parseVpnDevices(sub.v2ray_config);
          if (devices.length === 0) continue;

          const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
          const limitBytes = (sub.traffic_limit_mb || 102400) * 1024 * 1024;
          const expiryTime = new Date(sub.expires_at).getTime();

          for (const server of activeServers) {
            const { instance } = await getXuiForServer(server.id);
            
            // Синхронизация ключей Reality при каждом обслуживании
            const privKey = process.env.XUI_REALITY_PRIV_KEY;
            const pubKey = process.env.XUI_REALITY_PUB_KEY;
            if (privKey && pubKey) {
              await instance.syncRealityKeys(privKey, pubKey).catch(() => {});
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
        .eq('status', 'active');

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
