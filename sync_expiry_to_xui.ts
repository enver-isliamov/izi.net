import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function sync() {
  const host = (process.env.XUI_HOST || '').trim().replace(/\/+$/, "").replace(/\/panel$/, "");
  const user = process.env.XUI_USERNAME;
  const pass = process.env.XUI_PASSWORD;
  const inboundId = process.env.XUI_INBOUND_ID || '1';

  try {
    console.log("Logging in to XUI...");
    const loginResp = await axios.post(`${host}/login`, `username=${user}&password=${pass}`, { 
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent 
    });
    const cookie = loginResp.headers['set-cookie'][0];
    
    const { data: subs } = await supabase.from('subscriptions').select('user_id, v2ray_config, expires_at');
    if (!subs) return;

    for (const sub of subs) {
      const vpnEmail = `user_${sub.user_id.slice(0, 8)}`;
      const expiryTimestamp = new Date(sub.expires_at).getTime();
      const uuidMatch = sub.v2ray_config.match(/vless:\/\/([^@]+)@/);
      
      if (uuidMatch) {
        const uuid = uuidMatch[1];
        console.log(`Syncing ${vpnEmail} (Expires: ${sub.expires_at})...`);
        
        await axios.post(`${host}/panel/api/inbounds/updateClient/${uuid}`, {
          id: parseInt(inboundId),
          settings: JSON.stringify({
            clients: [
              {
                id: uuid,
                flow: "xtls-rprx-vision",
                email: vpnEmail,
                limitIp: 1,
                totalGB: 0,
                expiryTime: expiryTimestamp,
                enable: true
              }
            ]
          })
        }, {
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          httpsAgent
        });
      }
    }
    console.log("✅ Sync complete");
  } catch (err: any) {
    console.error("Error:", err.message);
  }
}
sync();
