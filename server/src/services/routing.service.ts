import { supabase } from './supabase';
import { getXuiForServer } from './xui.service';

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

          await instance.updateSettings(settings);
          await instance.restartPanel();

          console.log(`✅ [Routing] Rules synced to ${server.name}`);
        } catch (e: any) {
          console.error(`❌ [Routing] Failed on ${server.name}:`, e.message);
        }
      }
    } catch (err: any) {
      console.error('❌ [Routing] Sync failed:', err.message);
    }
  }
}
