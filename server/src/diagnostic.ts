import axios from 'axios';
import { supabase } from './services/supabase';
import { getXuiForServer } from './services/xui.service';

async function runDiagnostic() {
  console.log('🔍 [DIAGNOSTIC] Starting deep check...');
  
  // 1. Check Reality Keys
  const pubKey = process.env.XUI_REALITY_PUB_KEY;
  const privKey = process.env.XUI_REALITY_PRIV_KEY;
  
  if (!pubKey || !privKey) {
    console.error('❌ Reality keys missing in .env');
  } else {
    console.log('✅ Reality keys found in .env');
  }

  // 2. Check Active Servers
  const { data: servers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
  console.log(`📡 Found ${servers?.length || 0} active servers in Supabase`);

  if (servers) {
    for (const server of servers) {
      console.log(`--- Server: ${server.name} (${server.ip}) ---`);
      try {
        const { instance } = await getXuiForServer(server.id);
        const health = await instance.checkHealth();
        console.log(`   Health: ${health ? '✅ ONLINE' : '❌ OFFLINE'}`);
        
        // Check 443 port settings
        // To be implemented...
      } catch (e: any) {
        console.error(`   Error connecting to server: ${e.message}`);
      }
    }
  }

  // 3. Check Subscription Structure
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
