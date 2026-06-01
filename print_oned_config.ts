import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const { data: server, error } = await supabase.from('vpn_servers').select('*').eq('name', 'OneD').maybeSingle();
  if (error) {
    console.error(error);
  } else if (server) {
    console.log('OneD SERVER RECORD:');
    console.log(`Name: ${server.name}`);
    console.log(`IP: ${server.ip}`);
    console.log(`Domain: ${server.domain}`);
    console.log(`api_port: ${server.api_port}`);
    console.log('xui_config_state:');
    if (server.xui_config_state) {
      const state = server.xui_config_state as any;
      console.log(`  IP in config: ${state.ip}`);
      console.log(`  Backup At: ${state.backup_at}`);
      console.log(`  Inbounds length: ${state.inbounds ? state.inbounds.length : 0}`);
      
      if (state.inbounds) {
        state.inbounds.forEach((inb: any) => {
          console.log(`\n  --- Inbound ID: ${inb.id} ---`);
          console.log(`  Protocol: ${inb.protocol}`);
          console.log(`  Port: ${inb.port}`);
          console.log(`  Remark: ${inb.remark}`);
          console.log(`  Enable: ${inb.enable}`);
          console.log(`  StreamSettings:`);
          try {
            const stream = JSON.parse(inb.streamSettings);
            console.log(JSON.stringify(stream, null, 4));
          } catch (e) {
            console.log(`    (Raw: ${inb.streamSettings})`);
          }
        });
      }
    } else {
      console.log('  (null)');
    }
  } else {
    console.log('OneD server not found');
  }
}

run();
