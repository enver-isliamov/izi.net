import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  console.log('Attempting to add columns to vpn_servers...');
  
  const queries = [
    'ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS base_path TEXT;',
    'ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;'
  ];

  for (const sql of queries) {
    const { error } = await supabase.rpc('exec_sql', { sql });
    if (error) {
      console.error(`RPC exec_sql failed for: ${sql}`, error.message);
    } else {
      console.log(`Success: ${sql}`);
    }
  }
}

run();
