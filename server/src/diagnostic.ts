import axios from 'axios';
import { supabase } from './services/supabase';
import { getXuiForServer } from './services/xui.service';

async function runDiagnostic() {
  console.log('🔍 [DIAGNOSTIC] Starting deep check...');

  const { data: servers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
  console.log(`📡 Found ${servers?.length || 0} active servers in Supabase`);

  if (servers) {
    for (const server of servers) {
      console.log(`--- Server: ${server.name} (${server.ip}) ---`);
      try {
        const { instance } = await getXuiForServer(server.id);
        const health = await instance.checkHealth();
        console.log(`   Health: ${health ? '✅ ONLINE' : '❌ OFFLINE'}`);

        const inbounds = await instance.getInbounds();
        const realityInbound = inbounds.find((ib: any) => {
          try {
            const ss = JSON.parse(ib.streamSettings || '{}');
            return ss.security === 'reality' && ib.port === 443;
          } catch { return false; }
        });

        if (realityInbound) {
          const ss = JSON.parse(realityInbound.streamSettings || '{}');
          const rs = ss.realitySettings || {};
          const s = rs.settings || rs;
          console.log(`   Reality inbound ID: ${realityInbound.id}`);
          console.log(`   Public Key: ${s.publicKey || 'MISSING'}`);
          console.log(`   Short IDs: ${JSON.stringify(s.shortIds || rs.shortIds || [])}`);
          console.log(`   Fingerprint: ${s.fingerprint || 'MISSING'}`);
        } else {
          console.log('   ❌ No Reality inbound on port 443');
        }
      } catch (e: any) {
        console.error(`   Error: ${e.message}`);
      }
    }
  }

  const { data: sub } = await supabase.from('subscriptions').select('v2ray_config').limit(1).single();
  if (sub?.v2ray_config) {
    console.log('✅ Subscription structure is valid (has v2ray_config)');
    if (sub.v2ray_config.startsWith('[')) {
      console.log('   Format: JSON (Modern)');
    } else {
      console.log('   Format: Text (Legacy)');
    }
  }
}

if (require.main === module) {
  runDiagnostic();
}
