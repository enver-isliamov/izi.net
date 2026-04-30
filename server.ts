// Force bypass for expired certificates (Environment has future date: 2026)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { Telegraf, Context } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import crypto from 'crypto';
import axios from 'axios';
import https from 'https';
import http from 'http';

dotenv.config();

// --- Types for Advanced Device Management ---
export interface VpnDevice {
  id: string;
  label: string;
  config: string;
  email: string;
  uuid: string;
  expiresAt: string;
  serverType: string;
  trafficUsedBytes: number;
}

// Support function to migrate legacy v2ray_config text to JSON
function parseVpnDevices(configStr: string | null, rootExpiresAt?: string, rootServerType?: string): VpnDevice[] {
  if (!configStr) return [];
  
  if (configStr.trim().startsWith('[')) {
    try {
      return JSON.parse(configStr);
    } catch (e) {
      console.warn("Failed to parse JSON config, falling back to legacy", e);
    }
  }

  // Legacy parsing
  const configs = configStr.split('\n---KEY_SEP---\n').filter(Boolean);
  return configs.map((cfg, index) => {
    const uuidMatch = cfg.match(/vless:\/\/([^@]+)@/);
    const emailMatch = cfg.match(/#izinet_([^&?#\s]+)/);
    return {
      id: index === 0 ? 'primary' : `device_${index}`,
      label: index === 0 ? 'Основное устройство' : `Доп. устройство ${index}`,
      config: cfg,
      email: emailMatch ? emailMatch[1] : 'unknown',
      uuid: uuidMatch ? uuidMatch[1] : 'unknown',
      expiresAt: rootExpiresAt || new Date().toISOString(),
      serverType: rootServerType || 'Wi-Fi',
      trafficUsedBytes: 0
    };
  });
}

// Supabase Setup (Initialize early to avoid reference errors)
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; 
if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ SUPABASE credentials missing in environment variables!');
}
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Create a global HTTPS agent that ignores self-signed certificate errors (common in VPN panels)
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  checkServerIdentity: () => undefined // Ignore hostname/cert mismatch (future date fix)
});

const httpAgent = new http.Agent({
  keepAlive: true
});

/**
 * Utility to get correct axios config with agents
 */
function getRequestConfig(url: string, currentHeaders: any = {}) {
  const isHttps = url.startsWith('https://');
  return {
    headers: currentHeaders,
    httpsAgent: isHttps ? httpsAgent : undefined,
    httpAgent: !isHttps ? httpAgent : undefined,
    timeout: 15000,
  };
}

//@ts-ignore
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
const PORT = 3000;

// --- XUI Service ---
class XUIService {
  private host: string;
  private basePath: string = "";
  private username: string;
  private password: string;
  private sessionCookie: string | null = null;

  constructor(serverConfigs?: { host?: string, username?: string, password?: string }) {
    let host = (serverConfigs?.host || process.env.XUI_HOST || '').trim();
    
    if (host && !host.startsWith('http://') && !host.startsWith('https://')) {
      host = 'http://' + host;
    }

    // Handle secret path (e.g. https://ip:port/secret_path)
    try {
      if (host) {
        const url = new URL(host);
        this.host = `${url.protocol}//${url.host}`;
        this.basePath = url.pathname.replace(/\/+$/, "");
      } else {
        this.host = "";
      }
    } catch (e) {
      // Fallback for non-standard or partial URLs
      this.host = host.replace(/\/+$/, "").replace(/\/panel$/, "");
      this.basePath = "";
    }
    
    this.username = serverConfigs?.username || process.env.XUI_USERNAME || '';
    this.password = serverConfigs?.password || process.env.XUI_PASSWORD || '';
  }

  async checkConfig() {
    if (!this.host || !this.username || !this.password) {
      console.warn(`⚠️ 3x-ui credentials missing for host: ${this.host}`);
      return false;
    }
    try {
      await this.login();
      return true;
    } catch (e: any) {
      console.error(`❌ 3x-ui connection failed [${this.host}${this.basePath}]:`, e.message);
      return false;
    }
  }

  async login(): Promise<string> {
    if (!this.host) {
      throw new Error('XUI_HOST is empty. Please set it in Settings -> Secrets.');
    }
    
    const tryLogin = async (path: string) => {
      const url = `${this.host}${this.basePath}${path}`;
      try {
        const response = await axios.post(
          url,
          `username=${this.username}&password=${this.password}`,
          getRequestConfig(url, { 'Content-Type': 'application/x-www-form-urlencoded' })
        );
        return response;
      } catch (err: any) {
        if (err.response?.status === 404) {
          return null; // Try next path
        }
        throw err;
      }
    };

    try {
      // Try root path first (common for secret paths), then /login, then /panel/login
      let response = await tryLogin('');
      if (!response) {
        response = await tryLogin('/');
      }
      if (!response) {
        response = await tryLogin('/login');
      }
      if (!response) {
        response = await tryLogin('/panel/login');
      }
      
      if (!response) {
        throw new Error(`404: Could not find login endpoint at ${this.host}${this.basePath}. Please check your XUI host URL and secret path.`);
      }
      
      if (response.data && response.data.success === false) {
        throw new Error(response.data.msg || 'Login failed');
      }

      const cookie = response.headers['set-cookie']?.[0];
      if (!cookie) throw new Error('No cookie received from 3x-ui. Check if host URL is correct and starts with http/https.');
      this.sessionCookie = cookie;
      return cookie;
    } catch (error: any) {
      console.error(`❌ 3x-ui login error [${this.host}${this.basePath}]:`, error.message);
      if (error.response?.status === 404) {
        console.warn(`💡 Check if your 3x-ui panel uses a non-standard base path. Current host: ${this.host}${this.basePath}`);
      }
      throw error;
    }
  }

  async getInbounds() {
    if (!this.sessionCookie) await this.login();
    const url = `${this.host}${this.basePath}/panel/api/inbounds/list`;
    const response = await axios.get(url, getRequestConfig(url, { 'Cookie': this.sessionCookie }));
    return response.data.obj || [];
  }

  async addClient(email: string, uuid: string, inboundId: number, expiryTime: number = 0, limitBytes: number = 0) {
    if (!this.sessionCookie) await this.login();

    // First, let's try to get the inbound to see its settings (for link generation later)
    let inbound;
    try {
      const getInboundUrl = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
      const resp = await axios.get(getInboundUrl, getRequestConfig(getInboundUrl, { 'Cookie': this.sessionCookie }));
      if (resp.data.success) {
        inbound = resp.data.obj;
      }
    } catch (e: any) {
      console.warn(`Could not fetch inbound settings from ${this.host}${this.basePath}, will use defaults. Error: ${e.message}`);
    }

    const clientData = {
      id: inboundId,
      settings: JSON.stringify({
        clients: [
          {
            id: uuid,
            flow: "xtls-rprx-vision",
            email: email,
            limitIp: 1,
            totalGB: limitBytes,
            expiryTime: expiryTime,
            enable: true,
            tgId: "",
            subId: ""
          }
        ]
      })
    };

    try {
      const addClientUrl = `${this.host}${this.basePath}/panel/api/inbounds/addClient`;
      const response = await axios.post(
        addClientUrl,
        clientData,
        getRequestConfig(addClientUrl, { 
          'Cookie': this.sessionCookie,
          'Content-Type': 'application/json'
        })
      );

      if (response.data.success) {
        console.log(`✅ Client ${email} added to 3x-ui with expiry ${expiryTime}`);
        
        // Generate link
        let link = "";
        if (inbound) {
          try {
            const streamSettings = JSON.parse(inbound.streamSettings);
            const realitySettings = streamSettings.realitySettings;
            const port = inbound.port;
            
            // Safer host extraction
            let hostName = 'server.izinet.app'; // fallback
            try {
              const urlParts = new URL(this.host);
              hostName = urlParts.hostname;
            } catch (urlErr) {
              console.warn('URL parsing failed in addClient, using host from settings');
              hostName = this.host.split(':').pop()?.replace(/\//g, '') || hostName;
            }

            const sni = realitySettings.serverNames?.[0] || 'google.com';
            const pbk = realitySettings.settings?.publicKey || realitySettings.publicKey || '';
            const sid = realitySettings.shortIds?.[0] || '';
            
            if (!pbk) throw new Error("Public key not found in inbound");
            
            link = `vless://${uuid}@${hostName}:${port}?type=tcp&security=reality&sni=${sni}&pbk=${pbk}&fp=chrome&sid=${sid}&flow=xtls-rprx-vision#izinet_${email}`;
          } catch (e) {
            console.error('Error parsing inbound settings for link generation:', e);
            link = this.generateVlessLink(uuid, email);
          }
        } else {
          link = this.generateVlessLink(uuid, email);
        }
        
        return link;
      } else {
        throw new Error(response.data.msg || 'Failed to add client');
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        return this.addClient(email, uuid, inboundId, expiryTime);
      }
      console.error('❌ 3x-ui addClient error:', error.message);
      throw error;
    }
  }

  async updateClient(email: string, uuid: string, inboundId: number, expiryTime: number, limitBytes: number = 0) {
    if (!this.sessionCookie) await this.login();

    const clientData = {
      id: inboundId,
      settings: JSON.stringify({
        clients: [
          {
            id: uuid,
            flow: "xtls-rprx-vision",
            email: email,
            limitIp: 1,
            totalGB: limitBytes,
            expiryTime: expiryTime,
            enable: true,
            tgId: "",
            subId: ""
          }
        ]
      })
    };

    try {
      const updateClientUrl = `${this.host}${this.basePath}/panel/api/inbounds/updateClient/${uuid}`;
      const response = await axios.post(
        updateClientUrl,
        clientData,
        getRequestConfig(updateClientUrl, { 
          'Cookie': this.sessionCookie,
          'Content-Type': 'application/json'
        })
      );

      if (response.data.success) {
        console.log(`✅ Client ${email} updated in 3x-ui with expiry ${expiryTime}`);
        return true;
      } else {
        console.warn(`⚠️ Failed to update client in 3x-ui: ${response.data.msg}`);
        return false;
      }
    } catch (error: any) {
      console.error('❌ 3x-ui updateClient error:', error.message);
      return false;
    }
  }

  async getClientTraffic(email: string) {
    if (!this.sessionCookie) await this.login();

    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/getClientTraffics/${email}`;
      const response = await axios.get(url, getRequestConfig(url, { 'Cookie': this.sessionCookie }));

      if (response.data.success && response.data.obj) {
        const stats = response.data.obj;
        return {
          up: stats.up || 0,
          down: stats.down || 0,
          used: (stats.up || 0) + (stats.down || 0),
          limit: stats.total || 0
        };
      }
      return null;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        return this.getClientTraffic(email);
      }
      console.error(`❌ 3x-ui getClientTraffic error for ${email}:`, error.message);
      return null;
    }
  }

  async getOnlines() {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/onlines`;
      const response = await axios.post(url, {}, getRequestConfig(url, { 'Cookie': this.sessionCookie }));
      if (response.data.success) {
        return response.data.obj || [];
      }
      return [];
    } catch (error: any) {
      console.error(`❌ 3x-ui getOnlines error for ${this.host}${this.basePath}:`, error.message);
      return [];
    }
  }

  generateVlessLink(uuid: string, email: string, customDomain?: string) {
    let hostName = customDomain;
    if (!hostName) {
      try {
        hostName = new URL(this.host).hostname;
      } catch (e) {
        hostName = this.host.split(':').pop()?.replace(/\//g, '') || "server.izinet.app";
      }
    }
    return `vless://${uuid}@${hostName}:443?type=tcp&security=tls&sni=${hostName}#izinet_${email}`;
  }
}

// Multi-server registry
const xuiInstances = new Map<string, XUIService>();

async function getXuiForServer(serverId?: string | null) {
  if (!serverId) {
    // Default fallback to environment variables
    const defaultId = 'env_default';
    if (!xuiInstances.has(defaultId)) {
      xuiInstances.set(defaultId, new XUIService());
    }
    const instance = xuiInstances.get(defaultId)!;
    return { instance, server: null };
  }

  if (xuiInstances.has(serverId)) {
    // We still need the server object for domain etc, so fetch from DB
    const { data: server } = await supabase.from('vpn_servers').select('*').eq('id', serverId).single();
    return { instance: xuiInstances.get(serverId)!, server };
  }

  const { data: server } = await supabase.from('vpn_servers').select('*').eq('id', serverId).single();
  if (!server) {
    const defaultId = 'env_default';
    if (!xuiInstances.has(defaultId)) xuiInstances.set(defaultId, new XUIService());
    return { instance: xuiInstances.get(defaultId)!, server: null };
  }

  // Robust host construction
  let rawIp = (server.ip || '').trim();
  let host = "";
  
  if (rawIp.includes('://')) {
    // Full URL provided in IP field (e.g. https://1.2.3.4:567/path)
    host = rawIp;
  } else if (rawIp.includes('/')) {
    // Path but no protocol (e.g. 1.2.3.4/path)
    const [mainPart, ...pathParts] = rawIp.split('/');
    const path = pathParts.join('/');
    
    if (mainPart.includes(':')) {
      const port = mainPart.split(':').pop();
      // Assume https for common high ports or if user mentioned it
      const protocol = (port === '443' || parseInt(port || '0') > 10000) ? 'https' : 'http';
      host = `${protocol}://${mainPart}/${path}`;
    } else {
      const protocol = (server.api_port === 443 || server.api_port > 10000) ? 'https' : 'http';
      host = `${protocol}://${mainPart}:${server.api_port}/${path}`;
    }
  } else {
    // Standard IP or domain
    if (rawIp.includes(':')) {
      const port = rawIp.split(':').pop();
      const protocol = (port === '443' || parseInt(port || '0') > 10000) ? 'https' : 'http';
      host = `${protocol}://${rawIp}`;
    } else {
      const protocol = (server.api_port === 443 || server.api_port > 10000) ? 'https' : 'http';
      host = `${protocol}://${rawIp}:${server.api_port}`;
    }
  }

  const newInstance = new XUIService({
    host,
    username: server.username,
    password: server.password
  });

  xuiInstances.set(serverId, newInstance);
  return { instance: newInstance, server };
}

// --- Payment Service ---
class PaymentService {
  private enotMerchantId: string;
  private enotSecretKey: string;
  private enotSecretKey2: string;

  constructor() {
    this.enotMerchantId = process.env.ENOT_MERCHANT_ID || '';
    this.enotSecretKey = process.env.ENOT_SECRET_KEY || '';
    this.enotSecretKey2 = process.env.ENOT_SECRET_KEY2 || process.env.ENOT_SECRET_KEY || '';
  }

  createEnotInvoice(amount: number, userId: string, orderId: string, origin: string) {
    if (!this.enotMerchantId || !this.enotSecretKey) {
      throw new Error('Enot.io credentials missing. Check ENOT_MERCHANT_ID and ENOT_SECRET_KEY in server environment.');
    }

    // Enot signature: merchant_id:amount:secret_word:order_id
    const sign = crypto
      .createHash('md5')
      .update(`${this.enotMerchantId}:${amount}:${this.enotSecretKey}:${orderId}`)
      .digest('hex');

    const params = new URLSearchParams({
      m: this.enotMerchantId,
      oa: amount.toString(),
      o: orderId,
      s: sign,
      cf: userId, // Custom field to pass userId
      curr: 'RUB',
      success_url: `${origin}/dashboard`,
      fail_url: `${origin}/wallet`
    });

    return `https://enot.io/checkout?${params.toString()}`;
  }
}

const payment = new PaymentService();

// --- API Routes ---

// --- Admin Middleware ---
async function adminOnly(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Authentication required' });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();

  if (!profile || (profile.role !== 'admin' && profile.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Access denied. Admin role required.' });
  }

  req.user = { ...user, role: profile.role };
  next();
}

// --- Admin API Routes ---

app.get('/api/admin/stats', adminOnly, async (req, res) => {
  try {
    const { count: usersCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: activeSubs } = await supabase.from('subscriptions').select('*', { count: 'exact', head: true }).gt('expires_at', new Date().toISOString());
    const { data: recentRevenue } = await supabase.from('transactions').select('amount').eq('status', 'completed');
    
    // Count admins
    const { count: adminsCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).in('role', ['admin', 'superadmin']);

    const totalRevenue = recentRevenue?.reduce((sum, tx) => sum + tx.amount, 0) || 0;

    res.json({
      totalUsers: usersCount,
      activeSubscriptions: activeSubs,
      totalRevenue,
      adminsCount
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/users', adminOnly, async (req, res) => {
  const { search } = req.query;
  // Select users joined with their active subscription and assigned server
  let query = supabase
    .from('users')
    .select(`
      *,
      subscriptions (
        id,
        status,
        expires_at,
        traffic_limit_mb,
        traffic_used_mb,
        server_id,
        v2ray_config,
        vpn_servers (
          name,
          location_code
        )
      )
    `)
    .order('created_at', { ascending: false });

  if (search) {
    query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%,telegram_id.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  
  if (!data || !Array.isArray(data)) {
    return res.json([]);
  }

  const now = new Date().toISOString();

  // Transform data to flatten active subscription info
  const transformed = data.map((u: any) => {
    const subscriptions = Array.isArray(u.subscriptions) ? u.subscriptions : (u.subscriptions ? [u.subscriptions] : []);
    
    // Find active subscription: must be 'active' and either not expired or expire_at is null
    const activeSub = subscriptions.find((s: any) => {
      if (s.status !== 'active') return false;
      if (!s.expires_at) return true;
      const expiry = new Date(s.expires_at).getTime();
      return expiry > Date.now();
    });
    
    return {
      ...u,
      active_subscription: activeSub ? {
        id: activeSub.id,
        expires_at: activeSub.expires_at,
        traffic_used_mb: activeSub.traffic_used_mb || 0,
        traffic_limit_mb: activeSub.traffic_limit_mb || 0,
        server_id: activeSub.server_id,
        server_name: activeSub.vpn_servers?.name || 'VPN Сервер'
      } : null
    };
  });

  res.json(transformed);
});

app.post('/api/admin/users/move-server', adminOnly, async (req, res) => {
  const { userId, newServerId } = req.body;
  if (!userId || !newServerId) return res.status(400).json({ error: 'Missing parameters' });

  console.log(`🔄 Moving user ${userId} to server ${newServerId}`);

  try {
    // 1. Find ANY active or recently expired subscription to move
    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subErr || !sub) return res.status(404).json({ error: 'Active subscription not found for this user' });
    
    // 2. Get old and new server instances
    const { instance: oldXui } = await getXuiForServer(sub.server_id);
    const { instance: newXui, server: newServer } = await getXuiForServer(newServerId);
    
    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const limitBytes = (sub.traffic_limit_mb || 102400) * 1024 * 1024;
    const expiryTime = new Date(sub.expires_at).getTime();

    // 3. Parse devices
    const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    
    // 4. Migrate each device
    const migratedDevices: VpnDevice[] = [];
    for (const device of devices) {
      // Delete from old server (best effort)
      if (sub.server_id) {
        try {
          const deleteUrl = `${(oldXui as any).host}${(oldXui as any).basePath}/panel/api/inbounds/deleteClient/${device.uuid}`;
          await axios.post(deleteUrl, {}, getRequestConfig(deleteUrl, { 'Cookie': (oldXui as any).sessionCookie }));
          console.log(`✅ Deleted client ${device.email} from old server`);
        } catch (e) {
          console.warn(`Could not delete client ${device.email} from old server during migration:`, (e as any).message);
        }
      }

      // Add to new server
      const newConfig = await newXui.addClient(device.email, device.uuid, inboundId, expiryTime, limitBytes);
      migratedDevices.push({
        ...device,
        config: newConfig || newXui.generateVlessLink(device.uuid, device.email, newServer?.domain)
      });
    }

    // 5. Update DB
    const { data: updatedSub, error: updateErr } = await supabase
      .from('subscriptions')
      .update({
        server_id: newServerId,
        v2ray_config: JSON.stringify(migratedDevices),
        updated_at: new Date().toISOString()
      })
      .eq('id', sub.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    console.log(`✅ User ${userId} successfully moved to server ${newServerId}`);
    res.json({ success: true, subscription: updatedSub });
  } catch (err: any) {
    console.error('❌ Server migration error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/users/:id', adminOnly, async (req, res) => {
  const { id } = req.params;
  const { role, balance } = req.body; // In a real app we'd have a balance field, assuming it exists or user wants it
  
  const { data, error } = await supabase.from('users').update({
    role
  }).eq('id', id).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/admin/servers/:id/check', adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    const { instance } = await getXuiForServer(id);
    const loginSuccess = await instance.login();
    if (loginSuccess) {
      // Try to get stats as a deeper check
      const stats = await instance.getInbounds();
      res.json({ success: true, name: 'XUI', version: 'Latest', stats_count: stats.length });
    } else {
      res.json({ success: false, error: 'Login failed' });
    }
  } catch (err: any) {
    console.error(`❌ Connection check error for server ${id}:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/servers', adminOnly, async (req, res) => {
  try {
    const { data: servers, error } = await supabase.from('vpn_servers').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    
    // Enrich with stats
    const enrichedServers = await Promise.all(servers.map(async (server) => {
      // 1. Total users on this server
      const { count } = await supabase
        .from('subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('server_id', server.id)
        .eq('status', 'active');

      // 2. Online users
      let onlineCount = 0;
      try {
        const { instance } = await getXuiForServer(server.id);
        const onlines = await instance.getOnlines();
        onlineCount = onlines.length;
      } catch (err) {
        console.warn(`Could not fetch online count for server ${server.id}:`, err);
      }

      return {
        ...server,
        total_users: count || 0,
        online_users: onlineCount
      };
    }));

    res.json(enrichedServers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/servers', adminOnly, async (req, res) => {
  const { name, ip, domain, api_port, username, password, location_code } = req.body;
  const { data, error } = await supabase.from('vpn_servers').insert([{
    name, ip, domain, api_port, username, password, location_code
  }]).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/admin/servers/:id', adminOnly, async (req, res) => {
  const { id } = req.params;
  const { name, ip, domain, api_port, username, password, location_code, is_active } = req.body;
  
  const { data, error } = await supabase.from('vpn_servers').update({
    name, ip, domain, api_port, username, password, location_code, is_active
  }).eq('id', id).select().single();

  if (error) return res.status(500).json({ error: error.message });
  
  // Clear instance cache to force re-creation with new creds/options
  xuiInstances.delete(id);
  
  res.json(data);
});

app.delete('/api/admin/servers/:id', adminOnly, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('vpn_servers').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  xuiInstances.delete(id);
  res.json({ success: true });
});

// 💰 Create Payment Link
app.post('/api/pay/create', async (req, res) => {
  const { userId, amount, method } = req.body;
  const authHeader = req.headers.authorization;
  
  if (!userId || !amount || !method) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  // Security check: Verify token
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user || user.id !== userId) {
      return res.status(401).json({ error: 'Unauthorized: ID mismatch' });
    }
  }

  const orderId = `order_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  try {
    // Save pending transaction to DB
    const { error: txErr } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        amount: amount,
        status: 'pending',
        provider: method,
        provider_order_id: orderId
      });

    if (txErr) console.warn('Could not log pending transaction:', txErr.message);

    const origin = req.headers.origin || `https://${req.headers.host}`;

    let url = '';
    if (method === 'enot') {
      // Assuming amount is in USD on frontend, converting to RUB for Enot if needed
      // For now, assume amount is already correct from UI
      url = payment.createEnotInvoice(amount, userId, orderId, origin);
    } else {
      throw new Error('Unsupported payment method');
    }

    res.json({ success: true, url });
  } catch (error: any) {
    console.error('Payment creation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 📊 Sync user traffic manually
app.post('/api/subscription/sync-traffic', async (req, res) => {
  const { userId } = req.body;
  const authHeader = req.headers.authorization;
  
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  // Security check: Verify token
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user || user.id !== userId) {
      return res.status(401).json({ error: 'Unauthorized: ID mismatch' });
    }
  }

  try {
    const updatedSub = await syncUserTraffic(userId);
    res.json({ success: true, subscription: updatedSub });
  } catch (error: any) {
    console.error('❌ Manual traffic sync error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ⚓ Enot Webhook
app.post('/api/pay/webhook/enot', async (req, res) => {
  console.log('🔗 Enot Webhook Received:', JSON.stringify(req.body));
  
  const { merchant_id, amount, intid, custom_field, sign } = req.body;
  const orderId = req.body.merchant_order_id;

  if (!merchant_id || !amount || !sign || !orderId) {
    console.warn('⚠️ Malformed Enot Webhook payload');
    return res.status(400).send('Malformed payload');
  }

  // Enot webhook sign: merchant_id:amount:secret_word2:merchant_order_id
  const secret2 = process.env.ENOT_SECRET_KEY2 || process.env.ENOT_SECRET_KEY || ''; 
  const calculatedSign = crypto
    .createHash('md5')
    .update(`${merchant_id}:${amount}:${secret2}:${orderId}`)
    .digest('hex');

  if (sign.toLowerCase() !== calculatedSign.toLowerCase()) {
    console.warn(`❌ Invalid Enot signature. Got ${sign}, expected ${calculatedSign}`);
    return res.status(400).send('Invalid signature');
  }

  try {
    await processSuccessfulPayment(custom_field, parseFloat(amount), orderId, 'enot');
    res.send('YES');
  } catch (err: any) {
    console.error('❌ Error processing Enot payment:', err.message);
    res.status(500).send('Internal Error');
  }
});

async function processSuccessfulPayment(userId: string, amount: number, orderId: string, provider: string) {
  console.log(`💰 Processing payment: ${amount} for user ${userId} via ${provider}`);
  
  // 1. Check if already processed to avoid double-spend
  const { data: existingTx } = await supabase
    .from('transactions')
    .select('status')
    .eq('provider_order_id', orderId)
    .single();

  if (existingTx?.status === 'completed') {
    console.log(`⚠️ Payment ${orderId} already processed.`);
    return;
  }

  // 2. Update balance
  const { data: balanceData } = await supabase
    .from('balances')
    .select('amount')
    .eq('user_id', userId)
    .single();

  const currentAmount = balanceData?.amount || 0;
  
  // Using Supabase Service Role to bypass RLS for balance update
  const { error: balErr } = await supabase
    .from('balances')
    .upsert({ 
      user_id: userId, 
      amount: currentAmount + amount,
      updated_at: new Date().toISOString()
    });

  if (balErr) {
    console.error('❌ Failed to update balance:', balErr.message);
    return;
  }

  // 3. Update transaction status
  await supabase
    .from('transactions')
    .update({ status: 'completed' })
    .eq('provider_order_id', orderId);

  console.log(`✅ Balance updated for user ${userId}. +${amount}`);
}

// Health check and configuration status
app.get('/api/config', (req, res) => {
  res.json({
    telegramBotName: process.env.VITE_TELEGRAM_BOT_NAME || process.env.TELEGRAM_BOT_NAME || 'izinet_bot'
  });
});

app.get('/api/locations', async (req, res) => {
  try {
    const { data: servers, error } = await supabase
      .from('vpn_servers')
      .select('id, name, location_code')
      .eq('is_active', true);
    
    if (error) throw error;
    res.json(servers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  const configStatus = {
    supabase: !!process.env.VITE_SUPABASE_URL,
    bot: !!process.env.TELEGRAM_BOT_TOKEN,
    botAdminId: !!process.env.TELEGRAM_ADMIN_ID,
    xui: !!process.env.XUI_HOST && !!process.env.XUI_USERNAME && !!process.env.XUI_PASSWORD,
    inboundId: process.env.XUI_INBOUND_ID || '1'
  };
  res.json({ status: 'ok', config: configStatus });
});

// --- Subscription Routes ---
app.post('/api/subscription/buy', async (req, res) => {
  const { userId, planId, planName, price, durationDays, periodMonths, serverType, deviceLimit, forceNew, targetDeviceId, deviceName, serverId: reqServerId } = req.body;
  const authHeader = req.headers.authorization;

  if (!userId || !planId || !price) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // 0. Security check: Verify token
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user || user.id !== userId) {
      return res.status(401).json({ error: 'Unauthorized: ID mismatch' });
    }
  }

  try {
    // 1. Get current balance
    const { data: balanceData, error: balanceErr } = await supabase
      .from('balances')
      .select('amount')
      .eq('user_id', userId)
      .single();

    if (balanceErr || !balanceData) throw new Error('Balance not found');
    if (balanceData.amount < price) return res.status(400).json({ error: 'Insufficient balance' });

    // 2. Fetch last subscription & Parse existing devices
    const { data: lastSub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const existingDevices: VpnDevice[] = parseVpnDevices(
      lastSub?.v2ray_config || null,
      lastSub?.expires_at,
      lastSub?.server_type
    );

    // Pick server: use user-selected server, existing server if renewing, otherwise find an active one
    let serverId = reqServerId || lastSub?.server_id;
    if (!serverId) {
      // 2B. Improved server selection: pick an active server with fewest active subscriptions
      // If we have many servers, this might be slow, but for now it's the best way to load balance
      const { data: servers, error: sErr } = await supabase
        .from('vpn_servers')
        .select(`
          id,
          subscriptions!server_id (count)
        `)
        .eq('is_active', true);
      
      if (sErr || !servers || servers.length === 0) {
        // Fallback to env default if no servers in DB
        console.warn('⚠️ No active servers found in DB, falling back to ENV defaults');
        serverId = null;
      } else {
        // Sort by subscription count
        const sorted = servers.sort((a: any, b: any) => {
          const countA = a.subscriptions?.[0]?.count || 0;
          const countB = b.subscriptions?.[0]?.count || 0;
          return countA - countB;
        });
        serverId = sorted[0].id;
      }
    }

    const { instance: xuiInstance, server } = await getXuiForServer(serverId);
    const domain = server?.domain;

    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const trafficLimitMb = 100 * 1024; // 100 GB default limit per device logic (you can tune this)
    const limitBytes = trafficLimitMb * 1024 * 1024;

    let targetDevice: VpnDevice | undefined;

    if (forceNew || existingDevices.length === 0) {
      // 3A. CREATE NEW DEVICE
      if (existingDevices.length >= 2) {
        return res.status(400).json({ error: 'Превышен лимит: можно добавить только 1 дополнительное устройство.' });
      }

      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const email = `user_${userId.slice(0, 8)}_${randomSuffix}`;
      const uuid = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + durationDays);

      console.log(`🆕 Creating VPN client ${email} on server ${serverId || 'default'}...`);
      const rawConfig = await xuiInstance.addClient(email, uuid, inboundId, expiresAt.getTime(), limitBytes);
      
      const newDevice: VpnDevice = {
        id: existingDevices.length === 0 ? 'primary' : `device_${uuid.slice(0,8)}`,
        label: deviceName || (existingDevices.length === 0 ? 'Основное' : 'Доп. устройство'),
        config: rawConfig || xuiInstance.generateVlessLink(uuid, email, domain),
        email: email,
        uuid: uuid,
        expiresAt: expiresAt.toISOString(),
        serverType: serverType || 'LTE',
        trafficUsedBytes: 0
      };
      existingDevices.push(newDevice);
      targetDevice = newDevice;

    } else {
      // 3B. RENEW SPECIFIC OR PRIMARY DEVICE
      const idToRenew = targetDeviceId || existingDevices[0].id;
      targetDevice = existingDevices.find(d => d.id === idToRenew);
      
      if (!targetDevice) {
        return res.status(404).json({ error: 'Устройство для продления не найдено.' });
      }

      const currentExpiry = new Date(targetDevice.expiresAt);
      const newExpiresAt = currentExpiry > new Date() ? new Date(currentExpiry) : new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + durationDays);
      
      targetDevice.expiresAt = newExpiresAt.toISOString();
      targetDevice.serverType = serverType || targetDevice.serverType;
      
      console.log(`♻️ Syncing expiration for specific device ${targetDevice.email} on server ${serverId || 'default'}`);
      await xuiInstance.updateClient(targetDevice.email, targetDevice.uuid, inboundId, newExpiresAt.getTime(), limitBytes);
      
      // Update config link in case domain/ip changed
      targetDevice.config = xuiInstance.generateVlessLink(targetDevice.uuid, targetDevice.email, domain);
    }

    // Determine absolute max expiry for the subscription row
    const maxExpiryDate = existingDevices.reduce((max, d) => {
      const dDate = new Date(d.expiresAt);
      return dDate > max ? dDate : max;
    }, new Date(0));

    const finalConfigJson = JSON.stringify(existingDevices);

    // 4. Update or Insert Database Record
    let subData, subErr;
    if (lastSub) {
      const { data: updatedSub, error: updateErr } = await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          expires_at: maxExpiryDate.toISOString(),
          plan_type: planName.toLowerCase(),
          period_months: periodMonths || 1,
          server_type: serverType || lastSub.server_type,
          device_limit: existingDevices.length,
          v2ray_config: finalConfigJson,
          server_id: serverId,
          updated_at: new Date().toISOString()
        })
        .eq('id', lastSub.id)
        .select()
        .single();
      subData = updatedSub; subErr = updateErr;
    } else {
      const { data: newSub, error: insertErr } = await supabase
        .from('subscriptions')
        .insert({
          user_id: userId,
          plan_type: planName.toLowerCase(),
          status: 'active',
          expires_at: maxExpiryDate.toISOString(),
          v2ray_config: finalConfigJson,
          server_type: serverType,
          period_months: periodMonths || 1,
          device_limit: existingDevices.length,
          traffic_limit_mb: trafficLimitMb,
          traffic_used_mb: 0,
          server_id: serverId
        })
        .select()
        .single();
      subData = newSub; subErr = insertErr;
    }

    if (subErr) {
      console.error('❌ Supabase sub operation error:', JSON.stringify(subErr, null, 2));
      throw subErr;
    }

    // 5. Deduct balance
    const { error: deductErr } = await supabase
      .from('balances')
      .update({ amount: balanceData.amount - price })
      .eq('user_id', userId);

    if (deductErr) console.error('CRITICAL: Subscription processed but balance deduction failed!', deductErr);

    res.json({ success: true, subscription: subData, updatedDevice: targetDevice });

  } catch (error: any) {
    console.error('❌ Subscription purchase error details:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: error.details || error.hint || null
    });
  }
});

// Supabase Setup
// Already initialized at the top

// Telegram Bot Setup
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const botName = process.env.VITE_TELEGRAM_BOT_NAME || 'izinet_bot';
const botAdminId = process.env.TELEGRAM_ADMIN_ID;
const bot = botToken ? new Telegraf(botToken) : null;

// Bot Session and State Management
const botSessions = new Map<number, { state: string }>();
const adminReplyMap = new Map<number, number>(); // Maps admin's message ID to user's chat ID


// --- Realtime DB Listener ---
// Use a set to prevent duplicate event processing within the same process
const processedEventIds = new Set<string>();

// Simple cleanup for the set
setInterval(() => processedEventIds.clear(), 30000);

function setupRealtimeListener() {
  console.log('🔄 Setting up Unified Realtime DB Listener...');
  
  // Create a single channel for all support-related changes
  const supportChannel = supabase
    .channel('support-realtime-unified')
    // 1. Support Tickets
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'support_tickets' },
      async (payload) => {
        const newTicket = payload.new;
        if (processedEventIds.has(newTicket.id)) return;
        processedEventIds.add(newTicket.id);

        console.log(`📨 [Realtime] New Ticket: ${newTicket.id}`);
        
        if (bot && botAdminId) {
          try {
            const { data: user } = await supabase.from('users').select('email').eq('id', newTicket.user_id).single();
            const msg = `📨 <b>Новый чат поддержки!</b>\n\n` +
                        `👤 <b>От:</b> ${user?.email || 'Пользователь'}\n` +
                        `💬 <b>Сообщение:</b> ${newTicket.message}\n\n` +
                        `<i>ID: ${newTicket.id}</i>\n` +
                        `----------\n` +
                        `ОТВЕТЬТЕ на это сообщение, чтобы отправить ответ в чат.`;
            await bot.telegram.sendMessage(botAdminId, msg, { parse_mode: 'HTML' });
          } catch (e) {
            console.error('Error sending ticket to admin TG', e);
          }
        }
      }
    )
    // 2. Support Messages
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'support_messages', filter: "sender=eq.user" },
      async (payload) => {
        const newMessage = payload.new;
        if (processedEventIds.has(newMessage.id)) return;
        processedEventIds.add(newMessage.id);

        console.log(`💬 [Realtime] New Message: ${newMessage.id}`);

        if (bot && botAdminId) {
          try {
             const {data: t} = await supabase.from('support_tickets').select('user_id').eq('id', newMessage.ticket_id).single();
             if (t) {
               const {data: u} = await supabase.from('users').select('email').eq('id', t.user_id).single();
               const msg = `💬 <b>Новое сообщение в чате</b>\n\n` +
                           `👤 <b>От:</b> ${u?.email || 'Пользователь'}\n` +
                           `📝 <b>Текст:</b> ${newMessage.content}\n\n` +
                           `<i>ID Тикета: ${newMessage.ticket_id}</i>\n` +
                           `----------\n` +
                           `ОТВЕТЬТЕ для ответа.`;
               await bot.telegram.sendMessage(botAdminId, msg, { parse_mode: 'HTML' });
             }
          } catch (e) {
             console.error('Error sending message to admin TG', e);
          }
        }
      }
    )
    // 3. Subscriptions (Manual Sync)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'subscriptions' },
      async (payload) => {
        const newData = payload.new;
        const oldData = payload.old;
        
        if (
          newData.expires_at !== oldData.expires_at || 
          newData.v2ray_config !== oldData.v2ray_config ||
          newData.traffic_limit_mb !== oldData.traffic_limit_mb
        ) {
          console.log(`🔔 Manual DB update detected for sub ${newData.id}. Syncing to 3x-ui...`);
          const { instance: xuiInstance } = await getXuiForServer(newData.server_id);
          
          const vpnEmail = `user_${newData.user_id.slice(0, 8)}`;
          const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
          const expiryTimestamp = new Date(newData.expires_at).getTime();
          const trafficLimitMb = newData.traffic_limit_mb || 102400;
          const limitBytes = trafficLimitMb * 1024 * 1024;
          const uuidMatch = newData.v2ray_config.match(/vless:\/\/([^@]+)@/);
          if (uuidMatch) {
            const uuid = uuidMatch[1];
            await xuiInstance.updateClient(vpnEmail, uuid, inboundId, expiryTimestamp, limitBytes);
          }
        }
      }
    )
    .subscribe((status) => {
      console.log(`📡 [Realtime] Unified Channel Status: ${status}`);
    });
}

// --- Traffic Synchronization Task ---
/**
 * Syncs traffic for a specific user.
 * @param userId - The ID of the user to sync
 * @returns The subscription data with updated traffic
 */
async function syncUserTraffic(userId: string) {
  // 1. Get current active subscription
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub) return null;

  // Get correct XUI instance
  const { instance: xuiInstance } = await getXuiForServer(sub.server_id);

  // 2. Identify all devices by parsing VpnDevice JSON
  const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);

  let totalUsedBytes = 0;
  let maxLimitBytes = 0;

  // 3. Fetch stats for all devices
  for (const device of devices) {
    try {
      const stats = await xuiInstance.getClientTraffic(device.email);
      if (stats) {
        device.trafficUsedBytes = stats.used;
        totalUsedBytes += stats.used;
        maxLimitBytes = Math.max(maxLimitBytes, stats.limit);
      }
    } catch (e) {
      console.warn(`Could not sync traffic for individual device ${device.email}`, e);
    }
  }

  const trafficUsedMb = Math.round(totalUsedBytes / (1024 * 1024));
  const trafficLimitMb = maxLimitBytes > 0 ? Math.round(maxLimitBytes / (1024 * 1024)) : sub.traffic_limit_mb || 102400;

  // 4. Update the subscription in DB, saving back the updated devices JSON
  const { data, error } = await supabase
    .from('subscriptions')
    .update({ 
      traffic_used_mb: trafficUsedMb,
      traffic_limit_mb: trafficLimitMb,
      v2ray_config: JSON.stringify(devices)
    })
    .eq('id', sub.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error(`❌ Error updating aggregate traffic for user ${userId}:`, error.message);
    return null;
  }
  return data;
}

async function syncTrafficStats() {
  try {
    // 1. Get all active subscriptions
    const { data: subs, error } = await supabase
      .from('subscriptions')
      .select('user_id')
      .gt('expires_at', new Date().toISOString()); // Only active ones

    if (error) throw error;
    if (!subs || subs.length === 0) return;

    // Use a Set to avoid duplicate syncs if a user somehow has multiple active subs
    const userIds = Array.from(new Set(subs.map(s => s.user_id)));

    for (const userId of userIds) {
      await syncUserTraffic(userId);
    }
    
  } catch (err) {
    console.error('❌ Global traffic sync error:', err);
  }
}

// --- Auth Utilities ---

function verifyTelegramWebAppData(data: any): boolean {
  const { hash, ...userData } = data;
  if (!hash) return false;

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const dataCheckString = Object.keys(userData)
    .sort()
    .map(key => `${key}=${userData[key]}`)
    .join('\n');

  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return hmac === hash;
}

// --- API Routes ---

app.post('/api/auth/telegram/verify', async (req, res) => {
  const telegramData = req.body;

  if (!verifyTelegramWebAppData(telegramData)) {
    return res.status(401).json({ error: 'Invalid telegram data hash' });
  }

  const { id: telegramId, first_name, username, photo_url } = telegramData;

  try {
    // 1. Check if user with this telegram_id exists
    let { data: userData, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId.toString())
      .single();

    let userId = userData?.id;

    if (!userData) {
      // 2. If not, maybe search by email if we can? (Telegram doesn't provide email)
      // Usually we create a NEW user if not found by telegram_id
      const email = `tg_${telegramId}@izinet.app`; // Placeholder email
      
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { 
          full_name: first_name,
          username: username,
          avatar_url: photo_url,
          telegram_id: telegramId.toString()
        }
      });

      if (createErr) throw createErr;
      userId = newUser.user.id;
      
      // Update public.users table as well (trigger might have handled it, but let's be sure)
      await supabase.from('users').update({
        telegram_id: telegramId.toString(),
        telegram_linked: true,
        name: first_name
      }).eq('id', userId);
    }

    // 3. Generate a magic link or a login token for the frontend
    // Since we need to log in the user on the frontend, we use signInWithOtp (email) for simplicity
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: userData?.email || `tg_${telegramId}@izinet.app`
    });

    if (linkErr) throw linkErr;

    res.json({ 
      success: true, 
      redirect_url: linkData.properties.action_link 
    });

  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(500).json({ error: 'Internal server error during auth' });
  }
});

// --- Bot Logic ---

const showMainMenu = (ctx: any) => {
  const username = ctx.from.username || ctx.from.first_name;
  return ctx.reply(`Привет, ${username}! 🌐\n\nЯ бот ${botName}. Здесь ты можешь:\n• Проверить статус подписки\n• Узнать остаток трафика\n• Изменить пароль\n• Обратиться в поддержку`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Моя подписка и баланс', callback_data: 'action_status' }],
        [{ text: '🎧 Связаться с поддержкой', callback_data: 'action_support' }],
        [{ text: '🔑 Сменить пароль', callback_data: 'action_password' }],
        [{ text: 'ℹ️ Справка', callback_data: 'action_help' }]
      ]
    }
  });
};

let isBotLaunching = false;

async function launchBot(retries = 10) {
  if (!bot || isBotLaunching) return;
  isBotLaunching = true;

  try {
    console.log('🤖 Telegram Bot: Starting launch sequence...');
    
    // 1. Try to stop any existing polling in this instance
    try {
      await bot.stop();
    } catch (e) {
      // Ignore errors during stop
    }
    
    // 2. Always clear webhook and drop pending updates to avoid 409 and spam
    console.log('🤖 Telegram Bot: Clearing webhook and dropping pending updates...');
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    
    // 3. Small delay after clearing to let Telegram settle
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 4. Launch polling
    await bot.launch({
      allowedUpdates: ['message', 'callback_query'],
    });
    
    console.log('✅ Telegram Bot: Started successfully');
    isBotLaunching = false;
  } catch (err: any) {
    isBotLaunching = false;
    
    if (err.response?.error_code === 409) {
      if (retries > 0) {
        const delay = 7000; // 7 seconds
        console.warn(`⚠️ Telegram Bot: Conflict (409). Another instance is active. Retrying in ${delay/1000}s... (${retries} attempts left)`);
        setTimeout(() => launchBot(retries - 1), delay);
      } else {
        console.error('❌ Telegram Bot: Launch failed after multiple retries due to 409 Conflict.');
        console.error('💡 TIP: Check if you have another instance (local dev or staging) using this token.');
      }
    } else {
      console.error('❌ Telegram Bot: Launch failed with unexpected error:', err.message || err);
      // For non-409 errors, we might still want to retry a few times
      if (retries > 0) {
        setTimeout(() => launchBot(retries - 1), 5000);
      }
    }
  }
}

if (bot) {
  // Use session-based state management
  bot.start(async (ctx) => {
  const startPayload = (ctx as any).startPayload;
  const chatId = ctx.chat.id;
  const username = ctx.from.username || ctx.from.first_name;

  if (startPayload && startPayload.startsWith('link_')) {
    const token = startPayload.replace('link_', '');
    
    try {
      // 1. Find linking token in DB
      const { data: linkData, error: linkErr } = await supabase
        .from('telegram_linking_tokens')
        .select('*')
        .eq('token', token)
        .single();

      if (linkErr || !linkData) {
        return ctx.reply('❌ Ссылка для привязки недействительна или срок её действия истёк. Пожалуйста, создайте новую в Личном кабинете.');
      }

      // 2. Update user profile
      const { data: updateData, error: updateErr } = await supabase
        .from('users')
        .update({
          telegram_id: chatId.toString(),
          telegram_linked: true,
          name: username
        })
        .eq('id', linkData.user_id)
        .select();

      if (updateErr) {
        console.error('Bot update database error:', updateErr);
        throw updateErr;
      }

      if (!updateData || updateData.length === 0) {
        console.error('Bot linking: User record not found for ID:', linkData.user_id);
        return ctx.reply('❌ Ошибка: Пользователь не найден в системе. Попробуйте создать новую ссылку для привязки.');
      }

      // 3. Delete the temporary token
      await supabase.from('telegram_linking_tokens').delete().eq('token', token);

      console.log(`Successfully linked Telegram ${chatId} to user ${linkData.user_id}`);
      await ctx.reply('✅ Аккаунт izinet успешно привязан!\n\nТеперь вы можете получать уведомления и управлять подпиской прямо здесь.');
      return showMainMenu(ctx);
    } catch (error) {
      console.error('Bot linking error:', error);
      return ctx.reply('❌ Произошла ошибка при привязке аккаунта. Попробуйте позже.');
    }
  }

  // Handle Auth (Login)
  if (startPayload && startPayload.startsWith('auth_')) {
    try {
      // 1. Find the user by chatId
      const { data: userData, error: userErr } = await supabase
        .from('users')
        .select('email')
        .eq('telegram_id', chatId.toString())
        .single();

      if (userErr || !userData) {
        return ctx.reply('⚠️ Ваш Telegram не привязан к аккаунту izinet. Сначала привяжите его в личном кабинете на сайте или войдите через Email.');
      }

      // 2. Generate Magic Link
      const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: userData.email,
        options: {
          redirectTo: `${process.env.APP_URL || 'https://izinet.app'}/dashboard`
        }
      });

      if (linkErr) throw linkErr;

      return ctx.reply('🔑 Нажмите на кнопку ниже, чтобы войти в свой аккаунт izinet:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Войти в личный кабинет', url: linkData.properties.action_link }]
          ]
        }
      });
    } catch (error) {
      console.error('Bot auth error:', error);
      return ctx.reply('❌ Ошибка при генерации ссылки для входа.');
    }
  }

  // Generic welcome
  return showMainMenu(ctx);
  });

  bot.action('action_status', async (ctx) => {
    ctx.answerCbQuery();
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;
    
    try {
      const { data: userData, error: userErr } = await supabase
        .from('users')
        .select('id, email, balances(amount), subscriptions(*)')
        .eq('telegram_id', chatId)
        .single();

      if (userErr || !userData) {
        return ctx.reply('⚠️ Ваш аккаунт не привязан. Сделайте это в личном кабинете на сайте.');
      }

      const balance = userData.balances?.[0]?.amount || 0;
      const sub = userData.subscriptions?.[0];
      
      let statusText = `👤 Аккаунт: ${userData.email}\n💰 Баланс: ${balance} ₽\n\n`;
      
      if (sub) {
        const expiryDate = new Date(sub.expires_at).toLocaleDateString();
        const trafficUsed = (sub.traffic_used_mb / 1024).toFixed(2);
        const trafficLimit = (sub.traffic_limit_mb / 1024).toFixed(2);
        
        statusText += `💎 Подписка: ${sub.plan_type.toUpperCase()}\n`;
        statusText += `📅 Истекает: ${expiryDate}\n`;
        statusText += `📊 Трафик: ${trafficUsed} / ${trafficLimit} ГБ`;
      } else {
        statusText += `❌ Активной подписки нет.`;
      }

      ctx.reply(statusText);
    } catch (error) {
      console.error('Bot status error:', error);
      ctx.reply('❌ Ошибка при получении данных.');
    }
  });

  bot.action('action_support', (ctx) => {
    ctx.answerCbQuery();
    if (!ctx.chat) return;
    botSessions.set(ctx.chat.id, { state: 'support' });
    ctx.reply('🎧 Вы перешли в режим поддержки.\nНапишите ваш вопрос следующим сообщением, и наш специалист ответит вам.\n\nДля выхода из режима поддержки нажмите кнопку ниже.', {
      reply_markup: {
        inline_keyboard: [[{ text: '❌ Выйти из режима поддержки', callback_data: 'action_exit_mode' }]]
      }
    });
  });

  bot.action('action_password', (ctx) => {
    ctx.answerCbQuery();
    if (!ctx.chat) return;
    botSessions.set(ctx.chat.id, { state: 'password' });
    ctx.reply('🔑 Введите новый пароль для вашего аккаунта (минимум 8 символов):\n\nДля отмены нажмите кнопку ниже.', {
      reply_markup: {
        inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'action_exit_mode' }]]
      }
    });
  });

  bot.action('action_help', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply(`Доступные команды:\n• Моя подписка и баланс\n• Связаться с поддержкой\n• Сменить пароль\n\nВсё это доступно в главном меню командой /start`);
  });

  bot.action('action_exit_mode', (ctx) => {
    ctx.answerCbQuery();
    if (!ctx.chat) return;
    botSessions.delete(ctx.chat.id);
    ctx.reply('✅ Вы вернулись в обычный режим.', {
      reply_markup: {
        inline_keyboard: [[{ text: '◀️ В главное меню', callback_data: 'action_menu' }]]
      }
    });
  });

  bot.action('action_menu', (ctx) => {
    ctx.answerCbQuery();
    return showMainMenu(ctx);
  });

  // Handle all other text messages
  bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    // Check if admin is replying to a forwarded user message
    if (botAdminId && chatId.toString() === botAdminId.toString()) {
      const replyToMsg = ctx.message.reply_to_message;
      if (replyToMsg) {
        // Fallback or explicit mapping check for live-chat TG-TG
        const originalChatId = adminReplyMap.get(replyToMsg.message_id);
        if (originalChatId) {
          try {
            await ctx.telegram.sendMessage(originalChatId, `💬 Сообщение от поддержки:\n\n${text}`);
            return;
          } catch(e) {
            console.error('Failed to send reply to user', e);
            return ctx.reply('❌ Ошибка отправки ответа пользователю.');
          }
        }
        
        // --- NEW: Handle replies to UI Tickets ---
        if ('text' in replyToMsg && replyToMsg.text) {
          const match = replyToMsg.text.match(/ID Тикета:\s*([a-f0-9\-]+)/i);
          if (match && match[1]) {
            const ticketId = match[1];
            try {
              // Check if ticket exists first? Just insert message.
              await supabase.from('support_messages').insert({
                ticket_id: ticketId,
                sender: 'admin',
                content: text
              });
              
              // Also update ticket status to in_progress or somewhat
              // await supabase.from('support_tickets').update({status: 'in_progress'}).eq('id', ticketId);
              
              ctx.reply('✅ Ответ доставлен пользователю в интерфейс приложения.');
              return;
            } catch(e) {
              console.error('Failed to save admin reply to db', e);
              return ctx.reply('❌ Ошибка сохранения ответа в базу данных.');
            }
          }
        }
      }
    }

    // Check user sessions
    const session = botSessions.get(chatId);
    
    if (session?.state === 'support') {
      if (!botAdminId) {
         return ctx.reply('К сожалению, поддержка сейчас недоступна.');
      }
      try {
        const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
        // Send to admin
        const sentMsg = await ctx.telegram.sendMessage(botAdminId, `🆘 Вопрос от пользователя ${username} (ID: ${chatId}):\n\n${text}`);
        // Save mapping so admin can reply
        adminReplyMap.set(sentMsg.message_id, chatId);
        ctx.reply('✅ Ваше сообщение отправлено в поддержку. Ожидайте ответа (можно писать ещё сообщения, мы их получим).');
      } catch (error) {
         console.error('Failed to forward to admin', error);
         ctx.reply('❌ Ошибка связи с сервером поддержки.');
      }
      return;
    }

    if (session?.state === 'password') {
      if (text.length < 8) {
        return ctx.reply('⚠️ Пароль должен содержать минимум 8 символов. Попробуйте еще раз:');
      }

      // Reset password logic
      try {
        // Find user
        const { data: userData, error: userErr } = await supabase
          .from('users')
          .select('id')
          .eq('telegram_id', chatId.toString())
          .single();

        if (userErr || !userData) {
          botSessions.delete(chatId);
          return ctx.reply('⚠️ Ваш Telegram не привязан к аккаунту izinet. Невозможно сменить пароль.');
        }

        const { error: updateErr } = await supabase.auth.admin.updateUserById(userData.id, {
          password: text
        });

        if (updateErr) throw updateErr;

        botSessions.delete(chatId);
        ctx.reply('✅ Пароль успешно изменен! Вы можете использовать его для входа.', {
          reply_markup: {
            inline_keyboard: [[{ text: '◀️ В главное меню', callback_data: 'action_menu' }]]
          }
        });
      } catch (error) {
        console.error('Password change error', error);
        ctx.reply('❌ Ошибка при смене пароля. Попробуйте позже.');
      }
      return;
    }

    // Default reply if no session and not a command
    ctx.reply('Я не понимаю эту команду. Воспользуйтесь меню.', {
      reply_markup: {
        inline_keyboard: [[{ text: '◀️ В главное меню', callback_data: 'action_menu' }]]
      }
    });
  });

}

// --- Vite Middleware ---

async function startServer() {
  console.log('🚀 Starting izinet server...');
  
  // Check all active VPN servers on startup
  try {
    const { data: servers } = await supabase.from('vpn_servers').select('id, name').eq('is_active', true);
    if (servers) {
      console.log(`📡 Found ${servers.length} active VPN servers in DB. Checking connections...`);
      for (const server of servers) {
        const { instance } = await getXuiForServer(server.id);
        const ok = await instance.checkConfig();
        console.log(`${ok ? '✅' : '❌'} Connection to server "${server.name}" (${server.id}): ${ok ? 'OK' : 'FAILED'}`);
      }
    }
  } catch (err) {
    console.error('❌ Failed to check VPN servers on startup:', err);
  }
  
  // Setup Realtime DB Listener for manual syncing
  try {
    setupRealtimeListener();
  } catch (e) {
    console.error('❌ Failed to setup realtime listener:', e);
  }

  // Initial traffic sync and schedule every 15 minutes
  syncTrafficStats();
  setInterval(syncTrafficStats, 15 * 60 * 1000);

  // Launch Telegram Bot with retry logic
  if (bot) {
    launchBot();
  } else {
    console.log('⚠️ TELEGRAM_BOT_TOKEN is not set. Bot is inactive.');
  }

  console.log('🛠️ Configuring Vite middleware...');
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    // Catch-all for dev mode if Vite middleware didn't handle it
    app.get('*', async (req, res, next) => {
      if (req.url.startsWith('/api')) return next();
      try {
        const template = await vite.transformIndexHtml(req.url, '<html>...</html>'); // Minimal template
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

// Enable graceful stop
if (bot) {
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
