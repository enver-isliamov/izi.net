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

  const { data: subs, error: subError } = await supabase.from('subscriptions').select('*').limit(1);
  if (subError) {
    console.error('Error fetching subscriptions:', subError);
  } else {
    console.log('subscriptions columns:', Object.keys(subs[0] || {}));
  }
}

checkSchema();
