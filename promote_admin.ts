import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAndMakeAdmin(email: string) {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, role')
    .eq('email', email)
    .single();

  if (error) {
    console.error('Error fetching user:', error);
    return;
  }

  console.log('Current user:', user);

  if (user.role !== 'admin' && user.role !== 'superadmin') {
    console.log('Promoting to admin...');
    const { error: updateError } = await supabase
      .from('users')
      .update({ role: 'admin' })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error promoting user:', updateError);
    } else {
      console.log('User promoted to admin successfully!');
    }
  } else {
    console.log('User is already admin.');
  }
}

checkAndMakeAdmin('enverphoto@gmail.com');
