import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

async function fix() {
  console.log("Fetching XUI settings...");
  const host = process.env.XUI_HOST;
  const user = process.env.XUI_USERNAME;
  const pass = process.env.XUI_PASSWORD;
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  let realityConfig = null;
  let port = 443;
  let realHost = 'server.izinet.app';

  try {
    const urlParts = new URL(host);
    realHost = urlParts.hostname;
    
    const loginResp = await axios.post(`${host}/login`, { username: user, password: pass }, { httpsAgent });
    const cookie = loginResp.headers['set-cookie'][0];
    const inboundId = process.env.XUI_INBOUND_ID || '4';
    const inboundResp = await axios.get(`${host}/panel/api/inbounds/get/${inboundId}`, { headers: { Cookie: cookie }, httpsAgent });
    
    const streamSettings = JSON.parse(inboundResp.data.obj.streamSettings);
    port = inboundResp.data.obj.port;
    realityConfig = streamSettings.realitySettings;
  } catch (err) {
    console.error("Failed to get XUI:", err.message);
    return;
  }

  const sni = realityConfig.serverNames?.[0] || 'google.com';
  const pbk = realityConfig.settings?.publicKey || realityConfig.publicKey || '';
  const sid = realityConfig.shortIds?.[0] || '';

  console.log(`Using settings -> PORT: ${port}, SNI: ${sni}, PBK: ${pbk}, SID: ${sid}`);

  const { data: subs } = await supabase.from('subscriptions').select('id, user_id, v2ray_config');
  if (!subs) return console.log("No subs to fix");

  for (const sub of subs) {
    const { data: userData } = await supabase.from('users').select('email').eq('id', sub.user_id).single();
    let email = userData?.email || sub.user_id;
    email = email.split('@')[0];

    // Extract UUID from old config
    let uuidMatch = sub.v2ray_config.match(/vless:\/\/([^@]+)@/);
    if (!uuidMatch) continue;
    let uuid = uuidMatch[1];

    let newLink = `vless://${uuid}@${realHost}:${port}?type=tcp&security=reality&sni=${sni}&pbk=${pbk}&fp=chrome&sid=${sid}&flow=xtls-rprx-vision#izinet_${email}`;

    await supabase.from('subscriptions').update({ v2ray_config: newLink }).eq('id', sub.id);
    console.log(`Updated sub ${sub.id} -> ${newLink}`);
  }
}
fix();
