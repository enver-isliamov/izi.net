import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);
async function check() {
  const { data, error } = await supabase.from('subscriptions').select('*').limit(1);
  console.log("COLUMNS:");
  console.log(data && data.length > 0 ? Object.keys(data[0]) : (data ? "EMPTY" : error));
}
check();
