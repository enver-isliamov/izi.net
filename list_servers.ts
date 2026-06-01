import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const { data: servers, error } = await supabase.from('vpn_servers').select('*').limit(1);
  if (error) {
    console.error(error);
  } else if (servers && servers.length > 0) {
    console.log('Fields in vpn_servers:', Object.keys(servers[0]));
    
    // Now select a few clean fields for all rows
    const { data: all } = await supabase.from('vpn_servers').select('*');
    if (all) {
      all.forEach(s => {
        console.log(`Server: ${s.name} (IP: ${s.ip}, Domain: ${s.domain}, api_port: ${s.api_port}, is_active: ${s.is_active})`);
        console.log(`  State keys:`, s.xui_config_state ? Object.keys(s.xui_config_state) : 'none');
        console.log(`  Routing Sync Disabled:`, s.xui_config_state?.routing_sync_disabled);
        console.log(`  Custom direct:`, s.xui_config_state?.custom_direct_domains);
        console.log(`  Custom proxy:`, s.xui_config_state?.custom_proxy_domains);
      });
    }
  } else {
    console.log('No servers found');
  }
}

run();
