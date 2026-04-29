import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkData() {
  const { data: users, error: userError } = await supabase.from('users').select('*, subscriptions(*)');
  if (userError) {
    console.error('User Error:', userError);
    return;
  }

  console.log('Total users:', users.length);
  users.forEach(u => {
    const subs = u.subscriptions || [];
    console.log(`User: ${u.email}, Role: ${u.role}, Subs count: ${subs.length}`);
    subs.forEach((s: any) => {
      console.log(`  Sub ID: ${s.id}, Status: ${s.status}, Expires: ${s.expires_at}`);
    });
  });
}

checkData();
