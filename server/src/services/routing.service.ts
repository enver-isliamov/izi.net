import { supabase } from './supabase';
import { getXuiForServer } from './xui.service';

export class RoutingService {
  /**
   * Pushes routing rules from DB to all active VPN servers
   * Ensures izinet.online and server IP are ALWAYS 'direct'
   */
  static async syncAll() {
    console.log('🔄 [Routing] Synchronizing rules to all panels...');
    try {
      // 1. Ensure basic rules exist in DB
      const { data: existing } = await supabase.from('vpn_routing_rules').select('*').limit(1);
      if (!existing || existing.length === 0) {
        await supabase.from('vpn_routing_rules').insert([
          { name: 'Self-Bypass (Critical)', domains: ['domain:izinet.online', 'full:izinet.online', 'domain:izinet.online'], outbound_tag: 'direct', is_active: true },
          { name: 'Google/Gemini Services', domains: ['geosite:google', 'geosite:openai'], outbound_tag: 'direct', is_active: true },
          { name: 'Russia Bypass', domains: ['geosite:ru'], ips: ['geoip:ru'], outbound_tag: 'direct', is_active: true }
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
          if (!xrayConfig.routing) xrayConfig.routing = { rules: [] };
          if (!xrayConfig.routing.rules) xrayConfig.routing.rules = [];

          // Clean old managed rules
          xrayConfig.routing.rules = xrayConfig.routing.rules.filter((r: any) => !r.izinet_managed);
          
          // Prepend new rules
          xrayConfig.routing.rules = [...xrayRules, ...xrayConfig.routing.rules];
          
          settings.xrayTemplateConfig = JSON.stringify(xrayConfig, null, 2);
          await instance.updateSettings(settings);
          // Restart core to apply
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
