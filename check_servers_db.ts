import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkServers() {
  const { data, error } = await supabase.from('vpn_servers').select('*');
  if (error) {
    console.error('Error fetching servers:', error);
    return;
  }
  console.log('Servers in DB:', data);
}

checkServers();
