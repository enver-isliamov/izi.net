import { supabase } from './supabase';
import { getXuiForServer } from './xui.service';
import { restartContainer } from '../utils/docker';

export class RoutingService {
  /**
   * Pushes routing rules from DB to all active VPN servers.
   * Also initializes Xray API inbound, stats, and policy in xrayTemplateConfig.
   */
  static async syncAll() {
    console.log('🔄 [Routing] Synchronizing rules to all panels...');
    try {
      // 1. Ensure basic rules exist in DB
      const { data: existing } = await supabase.from('vpn_routing_rules').select('*').limit(1);
      if (!existing || existing.length === 0) {
        await supabase.from('vpn_routing_rules').insert([
          { name: 'Gemini / Google Services', domains: ['geosite:google', 'geosite:openai', 'geosite:gemini', 'domain:ai.com', 'geosite:anthropic'], outbound_tag: 'direct', is_active: true },
          { name: 'Russia Bypass (GeoIP + GeoSite)', domains: ['geosite:ru'], ips: ['geoip:ru'], outbound_tag: 'direct', is_active: true }
        ]);
      }

      const { data: rules } = await supabase.from('vpn_routing_rules').select('*').eq('is_active', true);
      const { data: servers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);

      if (!rules || !servers) return;

      const xrayRules = rules.map(r => {
        const rule: any = { type: "field", outboundTag: r.outbound_tag, izinet_managed: true };
        if (r.domains?.length) rule.domain = r.domains;
        if (r.ips?.length) rule.ip = r.ips;
        return rule;
      });

      for (const server of servers) {
        try {
          const { instance } = await getXuiForServer(server.id);
          const settings = await instance.getSettings();

          let xrayConfig = JSON.parse(settings.xrayTemplateConfig || '{}');

          // DEBUG: Log current state
          console.log(`🔍 [Routing] ${server.name} template BEFORE: api=${!!xrayConfig.api} stats=${!!xrayConfig.stats} policy=${!!xrayConfig.policy} inbounds=${(xrayConfig.inbounds || []).length} rules=${(xrayConfig.routing?.rules || []).length}`);

          // --- Xray API Initialization (API ядра Xray) ---
          if (!xrayConfig.api) {
            xrayConfig.api = { tag: 'api', services: ['HandlerService', 'LoggerService', 'StatsService'] };
          }
          if (!xrayConfig.stats) xrayConfig.stats = {};
          if (!xrayConfig.policy) {
            xrayConfig.policy = {
              levels: { '0': { statsUserUplink: true, statsUserDownlink: true } },
              system: { statsInboundUplink: true, statsInboundDownlink: true, statsOutboundUplink: true, statsOutboundDownlink: true }
            };
          }

          // --- DNS Configuration (only set if empty, don't overwrite bootstrap DNS) ---
          if (!xrayConfig.dns || !xrayConfig.dns.servers || xrayConfig.dns.servers.length === 0) {
            xrayConfig.dns = {
              servers: ['8.8.8.8', '1.1.1.1', 'localhost']
            };
          }

          // --- Outbounds (required for routing to work) ---
          if (!xrayConfig.outbounds || xrayConfig.outbounds.length === 0) {
            xrayConfig.outbounds = [
              { protocol: 'freedom', tag: 'direct' },
              { protocol: 'blackhole', tag: 'blocked' }
            ];
          }

          // Ensure API inbound exists (dokodemo-door on 127.0.0.1:62789)
          if (!xrayConfig.inbounds) xrayConfig.inbounds = [];
          if (!xrayConfig.inbounds.find((i: any) => i.tag === 'api')) {
            xrayConfig.inbounds.unshift({
              listen: '127.0.0.1',
              port: 62789,
              protocol: 'dokodemo-door',
              settings: { address: '127.0.0.1' },
              tag: 'api'
            });
          }

          // Remove any vless-reality inbound from template (Reality lives in SQLite, not template)
          // Previous buggy code injected a dummy inbound with empty keys that broke Xray.
          const beforeLen = xrayConfig.inbounds.length;
          xrayConfig.inbounds = xrayConfig.inbounds.filter((i: any) => i.tag !== 'vless-reality');
          if (xrayConfig.inbounds.length < beforeLen) {
            console.log(`🧹 [Routing] Removed ${beforeLen - xrayConfig.inbounds.length} stale vless-reality from template`);
          }

          // --- Routing Initialization ---
          if (!xrayConfig.routing) xrayConfig.routing = {};
          if (!xrayConfig.routing.rules) xrayConfig.routing.rules = [];

          // Add api routing if missing
          if (!xrayConfig.routing.rules.find((r: any) => r.outboundTag === 'api')) {
            xrayConfig.routing.rules.unshift({
              inboundTag: ['api'],
              outboundTag: 'api',
              type: 'field',
              izinet_managed: true
            });
          }

          // Remove old managed rules (excluding api)
          xrayConfig.routing.rules = xrayConfig.routing.rules.filter((r: any) => !r.izinet_managed || r.outboundTag === 'api');

          // Prepend current rules from DB
          const finalRules = xrayRules.map(r => ({ ...r, izinet_managed: true }));
          xrayConfig.routing.rules = [...finalRules, ...xrayConfig.routing.rules];

          settings.xrayTemplateConfig = JSON.stringify(xrayConfig, null, 2);

          // Ensure API port is set
          if (settings.apiPort === 0 || !settings.apiPort) settings.apiPort = 62789;

          // DEBUG: Log what we're about to save
          console.log(`🔍 [Routing] ${server.name} template AFTER: api=${!!xrayConfig.api} stats=${!!xrayConfig.stats} policy=${!!xrayConfig.policy} inbounds=${(xrayConfig.inbounds || []).length} rules=${(xrayConfig.routing?.rules || []).length}`);

          // 1. Update via HTTP API (JSON format — X-UI v26.4.25 requires JSON, not form-urlencoded)
          await instance.updateSettings(settings);

          // 2. Restart panel to apply changes to xray core
          await instance.restartPanel();

          console.log(`✅ [Routing] Rules synced to ${server.name}`);
        } catch (e: any) {
          console.error(`❌ [Routing] Failed on ${server.name}:`, e.message);
        }
      }

      console.log('🔄 [Routing] Restarting x3-ui to apply xrayTemplateConfig...');
      restartContainer('x3-ui').catch(e => console.warn(`⚠️ [Routing] x3-ui restart failed: ${e.message}`));

    } catch (err: any) {
      console.error('❌ [Routing] Sync failed:', err.message);
    }
  }

  /**
   * Restores inbound configs from Supabase backup to X-UI panels.
   * Called at server startup to restore configs after fresh deploy or reinstall.
   * Compares backup inbounds with current panel inbounds by port+protocol.
   */
  static async restoreAllPanelsFromBackup() {
    console.log('🔄 [Routing] Checking for panels that need config restoration...');
    try {
      const { data: servers } = await supabase
        .from('vpn_servers')
        .select('*')
        .eq('is_active', true);

      if (!servers) return;

      for (const server of servers) {
        const configState = server.xui_config_state;
        if (!configState?.inbounds?.length) continue;

        try {
          const { instance } = await getXuiForServer(server.id);
          const currentInbounds = await instance.getInbounds();

          // Отключаем inbound-8443 если он включён (требует несуществующий сертификат)
          for (const ib of currentInbounds) {
            if (ib.port === 8443 && ib.enable) {
              console.log(`⚠️ [Routing] Disabling inbound-8443 (${ib.remark}) on ${server.name} — requires missing TLS cert`);
              try {
                await instance.deleteInbound(ib.id);
              } catch (e: any) {
                console.warn(`⚠️ [Routing] Could not disable inbound-8443: ${e.message}`);
              }
            }
          }

          // Определяем какие inbound'ы из backup отсутствуют в панели
          const missingInbounds = configState.inbounds.filter((backupInbound: any) => {
            const exists = currentInbounds.find((ci: any) =>
              ci.port === backupInbound.port && ci.protocol === backupInbound.protocol
            );
            return !exists;
          });

          if (missingInbounds.length > 0) {
            console.log(`🔄 [Routing] Restoring ${missingInbounds.length} missing inbounds for ${server.name}...`);
            for (const inbound of missingInbounds) {
              const newInbound = { ...inbound };
              delete (newInbound as any).id;
              delete (newInbound as any).up;
              delete (newInbound as any).down;
              delete (newInbound as any).total;
              try {
                await instance.addInbound(newInbound);
                console.log(`  ✅ Restored inbound: ${inbound.remark || inbound.port}/${inbound.protocol}`);
              } catch (e: any) {
                console.warn(`  ⚠️ Failed to restore inbound ${inbound.remark || inbound.port}: ${e.message}`);
              }
            }
          }

          // Восстанавливаем xrayTemplateConfig из backup
          if (configState.xrayTemplateConfig) {
            const settings = await instance.getSettings();
            if (settings.xrayTemplateConfig !== configState.xrayTemplateConfig) {
              console.log(`🔄 [Routing] Restoring xrayTemplateConfig for ${server.name}...`);
              settings.xrayTemplateConfig = configState.xrayTemplateConfig;
              await instance.updateSettings(settings);
              console.log(`✅ [Routing] xrayTemplateConfig restored for ${server.name}`);
            }
          }

          if (missingInbounds.length === 0 && !configState.xrayTemplateConfig) {
            console.log(`✅ [Routing] ${server.name} — backup matches current state, no restore needed`);
          }
        } catch (e: any) {
          console.warn(`⚠️ [Routing] Could not check/restore ${server.name}: ${e.message}`);
        }
      }
    } catch (err: any) {
      console.error('❌ [Routing] Restore failed:', err.message);
    }
  }
}
