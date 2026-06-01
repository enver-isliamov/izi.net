import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import dns from 'node:dns/promises';
import net from 'node:net';
import axios from 'axios';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Define XUIService classes structure manually or import it
// Since we have server.ts, we can run a direct diagnostics mimic
async function getXuiForServer(serverId: string) {
  const { data: server } = await supabase.from('vpn_servers').select('*').eq('id', serverId).maybeSingle();
  if (!server) {
    throw new Error('Server not found');
  }

  let rawIp = (server.ip || '').trim();
  let domainOrPath = (server.domain || '').trim();
  let host = "";

  if (rawIp.includes('://')) {
    host = rawIp;
    if (domainOrPath) {
      if (!domainOrPath.includes('.') && !domainOrPath.startsWith('/')) {
        domainOrPath = '/' + domainOrPath;
      }
      if (domainOrPath.startsWith('/')) {
        try {
          const url = new URL(host);
          if (url.pathname === '/' || url.pathname === '') {
            host = host.replace(/\/$/, '') + domainOrPath;
          }
        } catch (e) {}
      }
    }
  } else {
    let ipPart = rawIp;
    let pathPart = "";
    if (rawIp.includes('/')) {
      const parts = rawIp.split('/');
      ipPart = parts[0];
      pathPart = '/' + parts.slice(1).join('/');
    }
    if (domainOrPath) {
      if (domainOrPath.startsWith('/')) {
        pathPart = domainOrPath;
      } else if (!domainOrPath.includes('.')) {
        pathPart = '/' + domainOrPath;
      } else {
        ipPart = domainOrPath;
      }
    }
    if (ipPart.includes(':')) {
       const [ip, port] = ipPart.split(':');
       const protocol = (port === '443' || port === '8443' || port === '2053') ? 'https' : 'http';
       host = `${protocol}://${ip}:${port}${pathPart}`;
    } else {
       const port = server.api_port || 2053;
       const protocol = (port === 443 || port === 8443 || port === 2053) ? 'https' : 'http';
       host = `${protocol}://${ipPart}:${port}${pathPart}`;
    }
  }
  
  // Apply the same rewrite rule as XUIService constructor
  try {
    if (host) {
      const parsedUrl = new URL(host);
      const hn = parsedUrl.hostname;
      if (hn === '194.50.94.28' || hn === 'izinet.online' || hn === 'vpn.izinet.online' || hn === 'localhost' || hn === '127.0.0.1') {
        const originalHost = host;
        const port = parsedUrl.port || '2053';
        const isDocker = fs.existsSync('/.dockerenv');
        if (isDocker) {
          host = `http://x3-ui:2053${parsedUrl.pathname}`;
          console.log(`[Mimic XUI] Optimized local routing: rewritten ${originalHost} -> ${host}`);
        } else {
          host = `http://127.0.0.1:${port}${parsedUrl.pathname}`;
          console.log(`[Mimic XUI] Optimized local routing: rewritten ${originalHost} -> ${host}`);
        }
      }
    }
  } catch (e) {}

  return { server, host };
}

async function checkPort(port: number, host: string, timeoutMs = 4000): Promise<{open: boolean, elapsed: number, err?: string}> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    const start = Date.now();
    socket.setTimeout(timeoutMs);
    socket.connect(port, host, () => {
      resolved = true;
      socket.destroy();
      resolve({ open: true, elapsed: Date.now() - start });
    });
    socket.on('error', (err: any) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ open: false, elapsed: Date.now() - start, err: err.message });
      }
    });
    socket.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ open: false, elapsed: timeoutMs, err: 'Connection Timeout' });
      }
    });
  });
}

async function diagnoseServer(id: string) {
  try {
    console.log(`\n=================== Diagnosing server id: ${id} ===================`);
    const { server, host } = await getXuiForServer(id);
    console.log(`Server Row: Name="${server.name}", IP="${server.ip}", Domain="${server.domain}", Port=${server.api_port}`);
    console.log(`Target connection host constructed: ${host}`);

    const targetDomain = (server.domain || '').trim();
    const targetIp = (server.ip || '').trim().split('/')[0].split(':')[0].replace(/^(https?:\/\/)/, '');
    const dnsHost = targetDomain || targetIp;
    
    console.log(`1. Resolving DNS of: ${dnsHost}`);
    let resolvedIp = '';
    try {
      const addresses = await dns.resolve4(dnsHost).catch(async () => {
        const lookup = await dns.lookup(dnsHost);
        return [lookup.address];
      });
      resolvedIp = addresses[0];
      console.log(`   DNS resolve outcome: OK (IP: ${resolvedIp})`);
    } catch (e: any) {
      console.log(`   DNS resolve failed: ${e.message}`);
    }

    const testIp = resolvedIp || targetIp;
    console.log(`2. Connecting to port of XUI panel. Parsing port from constructed host...`);
    let apiPort = server.api_port || 2053;
    try {
      const urlOb = new URL(host);
      if (urlOb.port) {
        apiPort = parseInt(urlOb.port);
      } else if (urlOb.protocol === 'https:') {
        apiPort = 443;
      } else if (urlOb.protocol === 'http:') {
        apiPort = 80;
      }
    } catch (e) {}

    console.log(`   Testing TCP connection to IP=${testIp}, Port=${apiPort}...`);
    const portCheck = await checkPort(apiPort, testIp);
    console.log(`   Port ${apiPort} outcome: ${portCheck.open ? 'OPEN' : 'CLOSED'} (elapsed ${portCheck.elapsed}ms, err: ${portCheck.err})`);

    console.log(`3. Testing VLESS port (443)...`);
    const vlessCheck = await checkPort(443, testIp);
    console.log(`   Port 443 outcome: ${vlessCheck.open ? 'OPEN' : 'CLOSED'} (elapsed ${vlessCheck.elapsed}ms, err: ${vlessCheck.err})`);

    console.log(`4. Attempting to log into XUI Panel at: ${host}`);
    // We can execute axios request to test login
    try {
      // get login cookie
      // We will mimic XUIService login method
      const loginUrl = `${host}/login`;
      const loginData = {
        username: server.username,
        password: server.password
      };
      console.log(`   Post data payload to ${loginUrl}: username="${server.username}"`);
      const resp = await axios.post(loginUrl, new URLSearchParams(loginData).toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 4000
      });
      const cookieHeader = resp.headers['set-cookie'] || [];
      console.log(`   Login Response status: ${resp.status}`);
      console.log(`   Login Success payload:`, resp.data);
      console.log(`   Cookie Header received:`, cookieHeader);
    } catch (e: any) {
      console.log(`   Login request failed: ${e.message}`);
      if (e.response) {
        console.log(`   Response status: ${e.response.status}, Data:`, e.response.data);
      }
    }

  } catch (err: any) {
    console.error('Error in diagnosing:', err.message);
  }
}

async function main() {
  const { data: servers } = await supabase.from('vpn_servers').select('id, name');
  if (servers) {
    for (const server of servers) {
      await diagnoseServer(server.id);
    }
  }
}

main();
