import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkSchema() {
  const { data, error } = await supabase.from('users').select('*').limit(1);
  if (error) {
    console.error('Error fetching users:', error);
  } else {
    console.log('User columns:', Object.keys(data[0] || {}));
  }

  const { data: txs, error: txError } = await supabase.from('transactions').select('*').limit(1);
  if (txError) {
    console.error('Error fetching transactions:', txError);
  } else {
    console.log('transactions columns:', Object.keys(txs[0] || {}));
  }
}

checkSchema();
