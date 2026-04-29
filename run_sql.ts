import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  console.log('Attempting to add base_path column...');
  // Usually izinet apps have a 'exec_sql' or similar if they use certain templates, 
  // but if not, we will get an error.
  const { data, error } = await supabase.rpc('exec_sql', { 
    sql: 'ALTER TABLE vpn_servers ADD COLUMN IF NOT EXISTS base_path TEXT;' 
  });
  
  if (error) {
    console.error('RPC exec_sql failed:', error.message);
    console.log('We will use the "ip" field parsing strategy instead.');
  } else {
    console.log('Successfully added base_path column!');
  }
}

run();
