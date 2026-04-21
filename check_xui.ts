import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
  const host = process.env.XUI_HOST;
  const user = process.env.XUI_USERNAME;
  const pass = process.env.XUI_PASSWORD;
  const httpsAgent = new https.Agent({ rejectUnauthorized: false });

  try {
    const loginResp = await axios.post(`${host}/login`, { username: user, password: pass }, { httpsAgent });
    const cookie = loginResp.headers['set-cookie'][0];
    
    const inboundResp = await axios.get(`${host}/panel/api/inbounds/get/1`, {
      headers: { Cookie: cookie },
      httpsAgent
    });
    console.log(inboundResp.data.obj.streamSettings);
  } catch (err) {
    console.error(err.message);
  }
}
check();
