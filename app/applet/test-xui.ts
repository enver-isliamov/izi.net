import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data } = await supabase.from('vpn_servers').select('*').eq('is_active', true).limit(1);
  if (!data || data.length === 0) return console.log('no servers');
  const server = data[0];
  let host = server.host;
  if (!host.startsWith('http')) host = 'http://' + host;
  const loginUrl = `${host}/login`;
  try {
    const res = await axios.post(loginUrl, { username: server.username, password: server.password });
    const cookie = res.headers['set-cookie']![0];
    const settingsUrl = `${host}/panel/setting/all`;
    const setRes = await axios.post(settingsUrl, {}, { headers: { Cookie: cookie } });
    console.log("KEYS:", Object.keys(setRes.data.obj));
    console.log("API:", JSON.parse(setRes.data.obj.xrayTemplateConfig).api);
  } catch (e: any) {
    console.error(e.message);
  }
}
run();
