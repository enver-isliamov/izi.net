import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';
dotenv.config();

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

async function fix() {
  const host = (process.env.XUI_HOST || '').trim().replace(/\/+$/, "").replace(/\/panel$/, "");
  const user = process.env.XUI_USERNAME;
  const pass = process.env.XUI_PASSWORD;
  const inboundId = process.env.XUI_INBOUND_ID || '4';

  try {
    console.log("Logging in to XUI...");
    const loginResp = await axios.post(`${host}/login`, `username=${user}&password=${pass}`, { 
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent 
    });
    const cookie = loginResp.headers['set-cookie'][0];
    
    console.log(`Fetching inbound ${inboundId}...`);
    const inboundResp = await axios.get(`${host}/panel/api/inbounds/get/${inboundId}`, {
      headers: { Cookie: cookie },
      httpsAgent
    });
    
    const inbound = inboundResp.data.obj;
    const settings = JSON.parse(inbound.settings);
    
    console.log(`Updating ${settings.clients.length} clients to limitIp: 1...`);
    settings.clients = settings.clients.map((c: any) => ({ ...c, limitIp: 1 }));
    
    await axios.post(`${host}/panel/api/inbounds/update/${inboundId}`, {
      ...inbound,
      settings: JSON.stringify(settings)
    }, {
      headers: { Cookie: cookie },
      httpsAgent
    });
    
    console.log("✅ All clients updated to limitIp: 1");
  } catch (err: any) {
    console.error("Error:", err.message);
  }
}
fix();
