// Force bypass for expired certificates (Environment has future date: 2026)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Global error handlers to prevent app from crashing and restarting
process.on('uncaughtException', (err) => {
  console.error('🔥 CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { Telegraf, Context } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import axios from 'axios';
import https from 'https';
import http from 'http';

dotenv.config();

// Fix MaxListenersExceededWarning - set EARLY
EventEmitter.defaultMaxListeners = 200;
process.setMaxListeners(200);

// Global agents to reuse sockets and prevent listener leaks
const sharedHttpsAgent = new https.Agent({ 
  rejectUnauthorized: false,
  keepAlive: true,
  maxSockets: 50,
  checkServerIdentity: () => undefined // Ignore hostname/cert mismatch (future date fix)
});
const sharedHttpAgent = new http.Agent({ 
  keepAlive: true,
  maxSockets: 50 
});

// Helper for axios requests to 3x-ui
function getRequestConfig(url: string, headers: any = {}, customTimeout?: number) {
  const isHttps = url.startsWith('https');
  const timeout = customTimeout || 7000; // Increased default timeout to 7s
  return {
    headers,
    httpsAgent: isHttps ? sharedHttpsAgent : undefined,
    httpAgent: !isHttps ? sharedHttpAgent : undefined,
    timeout: timeout
  };
}

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
  serverId?: string;
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
    const emailMatch = cfg.match(/#(?:izinet_)?([^&?#\s]+)/);
    const rawEmail = emailMatch ? decodeURIComponent(emailMatch[1].replace(/^izinet_/, '')) : 'unknown';
    
    return {
      id: index === 0 ? 'primary' : `device_${index}`,
      label: index === 0 ? 'Основное устройство' : `Доп. устройство ${index}`,
      config: cfg,
      email: rawEmail,
      uuid: uuidMatch ? uuidMatch[1] : 'unknown',
      expiresAt: rootExpiresAt || new Date().toISOString(),
      serverType: rootServerType || 'Wi-Fi',
      trafficUsedBytes: 0
    };
  });
}

// Supabase Setup (Initialize early to avoid reference errors)
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY || ''; 
if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ SUPABASE credentials missing in environment variables!');
}
const supabase = createClient(supabaseUrl, supabaseServiceKey);

//@ts-ignore
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const allowedOrigins = [
  'https://izinet.vercel.app',
  'http://localhost:3000',
  'http://localhost:41758',
  process.env.PUBLIC_URL,
  process.env.VITE_API_URL
].filter(Boolean).map(url => url?.replace(/\/$/, ''));

app.use(cors({
  origin: (origin, callback) => {
    // Разрешаем запросы без origin (например, от мобильных приложений или системных инструментов)
    if (!origin) return callback(null, true);
    
    const isAllowed = !origin || 
                     allowedOrigins.some(allowed => origin.startsWith(allowed)) || 
                     origin.includes('vercel.app') || 
                     origin.includes('run.app') || 
                     origin.includes('localhost') ||
                     origin.includes('127.0.0.1') ||
                     origin.includes('izinet.online') ||
                     process.env.NODE_ENV !== 'production';

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`[CORS WARNING] Rejected request from origin: ${origin}. If this is legitimate, add it to allowedOrigins.`);
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Subscription-Userinfo'],
  credentials: true
}));

// 🔍 Diagnostic logging for API requests
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[REQ] ${req.method} ${req.path} 
      | Host: ${req.get('host')} 
      | X-Forwarded-Host: ${req.get('x-forwarded-host') || 'N/A'}
      | CF-IP: ${req.get('cf-connecting-ip') || 'N/A'} 
      | CF-Visitor: ${req.get('cf-visitor') || 'N/A'}
      | Origin: ${req.get('origin') || 'N/A'}`);
  }
  next();
});

app.set('trust proxy', 1); // Trust first proxy (Cloudflare/Nginx)
app.use(express.json());
const PORT = parseInt(process.env.PORT || '3005');

// --- XUI Service ---
class XUIService {
  public host: string;
  public basePath: string = "";
  public displayDomain: string = "";
  private username: string;
  private password: string;
  private sessionCookie: string | null = null;
  private lastLoginTime: number = 0;
  private readonly SESSION_TTL = 2 * 60 * 1000; // 2 minutes cache for session cookie (VPN-04: Fresher sessions)

  constructor(serverConfigs?: { host?: string, username?: string, password?: string }) {
    // Priority: 1. Passed configs, 2. Database (handled by caller), 3. Environment (fallback for legacy/default)
    let host = (serverConfigs?.host || process.env.XUI_HOST || '').trim();
    
    if (host && !host.startsWith('http://') && !host.startsWith('https://')) {
      host = 'http://' + host;
    }

    // Handle secret path (e.g. https://ip:port/secret_path)
    try {
      if (host) {
        const url = new URL(host);
        this.host = `${url.protocol}//${url.host}`;
        // Extract base path, and ensure it starts with / if not empty
        let path = url.pathname.replace(/\/+$/, "");
        this.basePath = path && !path.startsWith('/') ? '/' + path : path;
      } else {
        this.host = "";
        this.basePath = "";
      }
    } catch (e) {
      this.host = host.replace(/\/+$/, "").replace(/\/panel$/, "");
      this.basePath = "";
    }
    
    this.username = (serverConfigs?.username || process.env.XUI_USERNAME || '').trim();
    this.password = (serverConfigs?.password || process.env.XUI_PASSWORD || '').trim();
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

  async login(force: boolean = false): Promise<string> {
    if (!this.host) {
      throw new Error('XUI_HOST is empty. Please set it in Settings -> Secrets.');
    }

    if (!force && this.sessionCookie && (Date.now() - this.lastLoginTime < this.SESSION_TTL)) {
      return this.sessionCookie;
    }
    
    const tryLogin = async (path: string) => {
      const url = `${this.host}${this.basePath}${path}`;
      const payload = `username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
      const jsonPayload = { username: this.username, password: this.password };

      try {
        // Try form-urlencoded first (default for most 3x-ui)
        const response = await axios.post(
          url,
          payload,
          getRequestConfig(url, { 'Content-Type': 'application/x-www-form-urlencoded' })
        );
        return response;
      } catch (err: any) {
        if (err.response?.status === 404) return null;

        // Try JSON if not 404
        try {
          const response = await axios.post(url, jsonPayload, getRequestConfig(url));
          return response;
        } catch (innerErr: any) {
          if (innerErr.response?.data) {
            console.error(`❌ 3x-ui login detail [${url}]:`, typeof innerErr.response.data === 'string' ? innerErr.response.data.substring(0, 200) : JSON.stringify(innerErr.response.data));
          }
          throw innerErr;
        }
      }
    };

    try {
      // Try root path first (common for secret paths), then /login, then /panel/login
      // VPN-04: Increased login timeout to 10s
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
      this.lastLoginTime = Date.now();
      return cookie;
    } catch (error: any) {
      console.error(`❌ 3x-ui login error [${this.host}${this.basePath}]:`, error.message);
      if (error.response?.status === 404) {
        console.warn(`💡 Check if your 3x-ui panel uses a non-standard base path. Current host: ${this.host}${this.basePath}`);
      }
      throw error;
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      if (!this.host) return false;
      await this.login(true);
      const url = `${this.host}${this.basePath}/panel/api/inbounds/list`;
      await axios.get(url, getRequestConfig(url, { 'Cookie': this.sessionCookie }, 4000));
      return true;
    } catch (e) {
      return false;
    }
  }

  async getInbounds() {
    if (!this.sessionCookie) await this.login();
    try {
      const listUrl = `${this.host}${this.basePath}/panel/api/inbounds/list`;
      const resp = await axios.get(listUrl, getRequestConfig(listUrl, { 'Cookie': this.sessionCookie }));
      return resp.data.obj || [];
    } catch (e: any) {
      if (e.response?.status === 401) {
        console.log(`[XUI] Session expired for ${this.host}, re-logging in...`);
        this.sessionCookie = null;
        await this.login(true);
        return this.getInbounds(); // Retry
      }
      console.error('❌ 3x-ui getInbounds error:', e.message);
      return [];
    }
  }

  async addClient(email: string, uuid: string, inboundId: number, expiryTime: number = 0, limitBytes: number = 0) {
    if (!this.sessionCookie) await this.login();

    // First, let's try to get the inbound to see its settings
    let inbound;
    let flow = "";
    try {
      const getInboundUrl = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
      const resp = await axios.get(getInboundUrl, getRequestConfig(getInboundUrl, { 'Cookie': this.sessionCookie }));
      if (resp.data.success) {
        inbound = resp.data.obj;
        const streamSettings = JSON.parse(inbound.streamSettings);
        if (streamSettings.security === 'reality') {
          flow = "xtls-rprx-vision";
        }
      }
    } catch (e: any) {
      console.warn(`Could not fetch inbound settings from ${this.host}${this.basePath}.`);
    }

    const clientData = {
      id: inboundId,
      settings: JSON.stringify({
        clients: [
          {
            id: uuid,
            flow: flow,
            email: email,
            limitIp: 0, // VPN-01: Allow unlimited IPs to prevent timeouts on mobile switching (WiFi <> 4G). Limits enforced by traffic quotas.
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
        return this.getInboundLink(inboundId, uuid, email);
      } else {
        const msg = response.data.msg || '';
        if (msg.includes('Duplicate email')) {
          console.log(`ℹ️ Client ${email} already exists on ${this.host}, reaching out to find its server-side ID...`);
          // Try to find the real server-side UUID for this email to update it correctly
          const serverClient = await this.getClientByEmail(inboundId, email);
          const effectiveUuid = serverClient?.id || uuid;
          const effectiveInboundId = serverClient?.inboundId || inboundId;
          
          await this.updateClient(email, effectiveUuid, effectiveInboundId, expiryTime, limitBytes);
          return this.getInboundLink(effectiveInboundId, effectiveUuid, email);
        }
        throw new Error(msg || 'Failed to add client');
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        return this.addClient(email, uuid, inboundId, expiryTime, limitBytes);
      }
      console.error('❌ 3x-ui addClient error:', error.message);
      throw error;
    }
  }

  async getInboundLink(inboundId: number, uuid: string, email: string): Promise<string> {
    if (!this.sessionCookie) await this.login();
    
    // VPN-03: Optimizing getInboundLink - removed redundant getClientByEmail call. 
    // UUID is already known from DB or creation.
    let effectiveUuid = uuid;
    let effectiveInboundId = inboundId;

    const getInboundUrl = `${this.host}${this.basePath}/panel/api/inbounds/get/${effectiveInboundId}`;
    const resp = await axios.get(getInboundUrl, getRequestConfig(getInboundUrl, { 'Cookie': this.sessionCookie }, 10000));
    
    if (!resp.data.success || !resp.data.obj) {
      throw new Error(`[XUI] Не удалось получить настройки входящего соединения ${effectiveInboundId} с сервера ${this.host}. Проверьте ID инбаунда в настройках сервера.`);
    }
    
    const inbound = resp.data.obj;
    
    // Safety check for streamSettings: it can be a string or an object depending on XUI version
    let streamSettings: any = {};
    try {
      if (typeof inbound.streamSettings === 'string') {
        streamSettings = JSON.parse(inbound.streamSettings || '{}');
      } else if (inbound.streamSettings && typeof inbound.streamSettings === 'object') {
        streamSettings = inbound.streamSettings;
      }
    } catch (parseErr) {
      console.error(`[XUI] Error parsing streamSettings for inbound ${effectiveInboundId}:`, parseErr);
    }

    const security = streamSettings.security || 'none';
    const port = inbound.port;
    
    let hostName = this.displayDomain || 'server.izinet.app';
    const encodedEmail = encodeURIComponent(`izinet_${email}`);

    const isIPOrEmpty = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostName) || hostName === '';

    if (security === 'reality') {
      const realitySettings = streamSettings.realitySettings || {};
      // 3x-ui can store reality settings in realitySettings directly or under realitySettings.settings
      const rs = realitySettings.settings || realitySettings;
      
      const sni = (rs.serverNames?.[0] || realitySettings.serverNames?.[0]) || (isIPOrEmpty ? 'google.com' : hostName);
      const pbk = rs.publicKey || realitySettings.publicKey || '';
      
      if (!pbk || pbk.includes('m_G-oZ_9a6')) {
        throw new Error(`[XUI] Сервер ${hostName} вернул некорректный или пустой Reality publicKey. Пожалуйста, проверьте настройки Reality в панели XUI.`);
      }

      const sid = (rs.shortIds?.[0] || realitySettings.shortIds?.[0]) || '';
      const fp = rs.fingerprint || realitySettings.fingerprint || 'chrome';
      const spiderX = rs.spiderX || realitySettings.spiderX || '/';
      
      console.log(`[XUI] Generating Reality link for ${email} on ${hostName}:${port}. SNI: ${sni}, SID: ${sid}, SPX: ${spiderX}`);

      let link = `vless://${effectiveUuid}@${hostName}:${port}?type=tcp&encryption=none&security=reality&sni=${sni}&pbk=${pbk}&fp=${fp}&sid=${sid}&spx=${encodeURIComponent(spiderX)}&flow=xtls-rprx-vision`;
      return `${link}#${encodedEmail}`;
    } else if (security === 'tls') {
      const tlsSettings = streamSettings.tlsSettings || {};
      const isIP = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostName);
      const sni = tlsSettings.serverName || (isIP ? "" : hostName); 
      let sniPart = sni ? `&sni=${sni}` : "";
      return `vless://${effectiveUuid}@${hostName}:${port}?type=tcp&security=tls${sniPart}#${encodedEmail}`;
    } else {
      return `vless://${effectiveUuid}@${hostName}:${port}?type=tcp&security=${security}#${encodedEmail}`;
    }
  }

  async getClientByEmail(inboundId: number, email: string) {
    if (!this.sessionCookie) await this.login();
    try {
      const getInboundUrl = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
      const resp = await axios.get(getInboundUrl, getRequestConfig(getInboundUrl, { 'Cookie': this.sessionCookie }));
      if (resp.data.success && resp.data.obj) {
        const settings = JSON.parse(resp.data.obj.settings || '{}');
        const clients = settings.clients || [];
        const found = clients.find((c: any) => c.email === email);
        if (found) {
          return {
            ...found,
            id: found.id || found.uuid,
            inboundId: inboundId
          };
        }
      }
      
      // Fallback: Search all inbounds if not found in the specific one
      // This helps if the client was somehow added to a different inbound
      const inbounds = await this.getInbounds();
      for (const inbound of inbounds) {
        if (inbound.id === inboundId) continue;
        const settings = JSON.parse(inbound.settings || '{}');
        const clients = settings.clients || [];
        const found = clients.find((c: any) => c.email === email);
        if (found) {
          return { 
            ...found, 
            id: found.id || found.uuid, // Handle both id and uuid field names
            inboundId: inbound.id 
          };
        }
      }
    } catch (e: any) {
      console.warn(`⚠️ Error getting client by email ${email} on ${this.host}: ${e.message}`);
    }
    return null;
  }


  async updateClient(email: string, uuid: string, inboundId: number, expiryTime: number, limitBytes: number = 0) {
    if (!this.sessionCookie) await this.login();

    let effectiveUuid = uuid;
    let effectiveInboundId = inboundId;
    
    // Crucial: check if client exists and what is its REAL server-side UUID and Inbound
    const serverClient = await this.getClientByEmail(inboundId, email);
    if (serverClient) {
      if (serverClient.id) effectiveUuid = serverClient.id;
      if (serverClient.inboundId) effectiveInboundId = serverClient.inboundId;
      console.log(`ℹ️ Found existing client ${email} with UUID ${effectiveUuid} in inbound ${effectiveInboundId}`);
    }

    if (!effectiveUuid) {
      console.error(`❌ Cannot update client ${email}: No UUID available.`);
      return false;
    }

    let flow = "";
    try {
      const getInboundUrl = `${this.host}${this.basePath}/panel/api/inbounds/get/${effectiveInboundId}`;
      const resp = await axios.get(getInboundUrl, getRequestConfig(getInboundUrl, { 'Cookie': this.sessionCookie }));
      if (resp.data.success && resp.data.obj) {
        const streamSettings = JSON.parse(resp.data.obj.streamSettings || '{}');
        if (streamSettings.security === 'reality') {
          flow = "xtls-rprx-vision";
        }
      } else {
        // VPN-06: Fallback for Reality flow
        flow = "xtls-rprx-vision";
      }
    } catch (e) {
      // VPN-06: Fallback for Reality flow on error
      flow = "xtls-rprx-vision";
    }

    // 3x-ui API for updateClient requires the client data inside a JSON string 'settings'
    const clientData = {
      id: effectiveInboundId,
      settings: JSON.stringify({
        clients: [
          {
            id: effectiveUuid,
            flow: flow,
            email: email,
            limitIp: 0, // VPN-01: Sync limitIp to 0
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
      console.log(`📤 Sending updateClient request for ${email} (${effectiveUuid}) to ${this.host}...`);
      const updateClientUrl = `${this.host}${this.basePath}/panel/api/inbounds/updateClient/${effectiveUuid}`;
      const response = await axios.post(
        updateClientUrl,
        clientData,
        getRequestConfig(updateClientUrl, { 
          'Cookie': this.sessionCookie,
          'Content-Type': 'application/json'
        })
      );

      if (response.data.success) {
        console.log(`✅ Client ${email} updated in 3x-ui [${this.host}] with expiry ${expiryTime}`);
        return true;
      } else {
        const errorMsg = response.data.msg || 'Unknown error';
        console.warn(`⚠️ Failed to update client ${email} in 3x-ui: ${errorMsg}`);
        // If it failed with "empty client ID" it might be because the ID should be in a different field or structure
        // but given our investigation, usually it means the UUID didn't match anything.
        return false;
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.updateClient(email, uuid, inboundId, expiryTime, limitBytes);
      }
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.updateClient(email, uuid, inboundId, expiryTime, limitBytes);
      }
      console.error(`❌ 3x-ui updateClient total failure for ${email}:`, error.message);
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

  async deleteClient(uuid: string, email?: string) {
    if (!this.sessionCookie) await this.login();
    
    let effectiveUuid = uuid;

    // If we have an email, try to find the actual client UUID on the server to be sure
    if (email) {
      try {
        const inbounds = await this.getInbounds();
        for (const inbound of inbounds) {
          const serverClient = await this.getClientByEmail(inbound.id, email);
          if (serverClient && serverClient.id) {
            effectiveUuid = serverClient.id;
            break;
          }
        }
      } catch (e) {
        console.warn(`⚠️ Error during deep search for client ${email} to delete:`, e.message);
      }
    }

    try {
      const deleteUrl = `${this.host}${this.basePath}/panel/api/inbounds/deleteClient/${effectiveUuid}`;
      const response = await axios.post(deleteUrl, {}, getRequestConfig(deleteUrl, { 'Cookie': this.sessionCookie }));
      if (response.data.success) {
        console.log(`✅ Deleted client ${email || effectiveUuid} from 3x-ui [${this.host}]`);
        return true;
      }
      
      console.warn(`⚠️ 3x-ui deleteClient response was success: false for ${email || effectiveUuid} on ${this.host}`);
      return false;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.deleteClient(uuid, email);
      }
      if (error.response?.status === 404) {
        console.log(`ℹ️ Client ${email || effectiveUuid} not found on ${this.host}, skipping delete.`);
        return true;
      }
      console.error(`❌ 3x-ui deleteClient error for ${email || effectiveUuid}:`, error.message);
      return false;
    }
  }

  async getOnlines() {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/onlines`;
      const response = await axios.post(url, {}, getRequestConfig(url, { 'Cookie': this.sessionCookie }));
      if (response.data.success && Array.isArray(response.data.obj)) {
        // Return unique emails to avoid overcounting multiple connections from same user
        const uniqueOnlines = [...new Set(response.data.obj.map((item: any) => typeof item === 'string' ? item : item.email).filter(Boolean))];
        return uniqueOnlines;
      }
      return [];
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.getOnlines();
      }
      console.error(`❌ 3x-ui getOnlines error for ${this.host}${this.basePath}:`, error.message);
      return [];
    }
  }

  async listClients() {
    if (!this.sessionCookie) await this.login();
    try {
      const inbounds = await this.getInbounds();
      let allClients: any[] = [];
      for (const inbound of inbounds) {
        const settings = JSON.parse(inbound.settings || '{}');
        const clients = settings.clients || [];
        allClients = allClients.concat(clients);
      }
      return allClients;
    } catch (e: any) {
      if (e.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.listClients();
      }
      if (e.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.listClients();
      }
      console.error(`❌ 3x-ui listClients error for ${this.host}:`, e.message);
      return [];
    }
  }

  generateVlessLink(uuid: string, email: string, customDomain?: string, port: number = 443) {
    // BUG-09: Do not generate broken links. Throw error to force using getInboundLink which has Reality params.
    throw new Error(`[XUI] Не удалось получить реальный конфиг с Reality для ${email}. Проверьте соединение с сервером.`);
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
    const { data: server } = await supabase.from('vpn_servers').select('*').eq('id', serverId).maybeSingle();
    return { instance: xuiInstances.get(serverId)!, server };
  }

  const { data: server } = await supabase.from('vpn_servers').select('*').eq('id', serverId).maybeSingle();
  if (!server) {
    const defaultId = 'env_default';
    if (!xuiInstances.has(defaultId)) xuiInstances.set(defaultId, new XUIService());
    return { instance: xuiInstances.get(defaultId)!, server: null };
  }

  // Robust host construction
  let rawIp = (server.ip || '').trim();
  let host = "";
  let panelPath = (server.domain || '').trim();
  if (!panelPath.startsWith('/')) panelPath = '';

  if (rawIp.includes('://')) {
    host = rawIp;
  } else {
    // If rawIp contains a path (e.g. 1.2.3.4/secret), split it
    let ipPart = rawIp;
    if (rawIp.includes('/')) {
      const parts = rawIp.split('/');
      ipPart = parts[0];
      if (!panelPath) panelPath = '/' + parts.slice(1).join('/');
    }

    // If ipPart contains a port (e.g. 1.2.3.4:443), use it
    if (ipPart.includes(':')) {
       const [ip, port] = ipPart.split(':');
       const protocol = (port === '443' || parseInt(port) > 10000) ? 'https' : 'http';
       host = `${protocol}://${ip}:${port}${panelPath}`;
    } else {
       const port = server.api_port || 2053;
       const protocol = (port === 443 || port > 10000) ? 'https' : 'http';
       host = `${protocol}://${ipPart}:${port}${panelPath}`;
    }
  }

  const newInstance = new XUIService({
    host,
    username: server.username,
    password: server.password
  });

  if (server.domain && !server.domain.startsWith('/')) {
    newInstance.displayDomain = server.domain;
  }

  xuiInstances.set(serverId, newInstance);
  console.log(`[XUI] Initialized instance for server "${server.name}" using database credentials (Host: ${host}, User: ${server.username})`);
  return { instance: newInstance, server };
}

// --- Payment Service ---
class PaymentService {
  constructor() {}

  private async getEnotConfig() {
    // 1. Try to get from Database first
    try {
      const { data: dbSettings, error: dbError } = await supabase
        .from('settings')
        .select('*')
        .in('key', ['ENOT_MERCHANT_ID', 'ENOT_SECRET_KEY', 'ENOT_SECRET_KEY2']);
      
      if (dbError) {
        console.warn('⚠️ [PaymentService] Settings table fetch failed (might be missing):', dbError.message);
        return this.getEnvFallback();
      }

      const settingsMap: Record<string, string> = {};
      dbSettings?.forEach(s => settingsMap[s.key] = s.value);

      const merchantId = (settingsMap['ENOT_MERCHANT_ID'] || process.env.ENOT_MERCHANT_ID || '').trim();
      const secretKey = (settingsMap['ENOT_SECRET_KEY'] || process.env.ENOT_SECRET_KEY || '').trim();
      const secretKey2 = (settingsMap['ENOT_SECRET_KEY2'] || process.env.ENOT_SECRET_KEY2 || secretKey).trim();

      if (!merchantId || !secretKey) {
        console.error('❌ Enot.io credentials missing! MerchantID or SecretKey is empty.');
        throw new Error('Enot.io credentials missing. Please set them in Admin Panel -> Settings.');
      }

      return { merchantId, secretKey, secretKey2 };
    } catch (err: any) {
      console.warn('⚠️ [PaymentService] DB fetch error, falling back to ENV:', err.message);
      return this.getEnvFallback();
    }
  }

  private getEnvFallback() {
    const merchantId = (process.env.ENOT_MERCHANT_ID || '').trim();
    const secretKey = (process.env.ENOT_SECRET_KEY || '').trim();
    const secretKey2 = (process.env.ENOT_SECRET_KEY2 || secretKey).trim();

    if (!merchantId || !secretKey) {
      throw new Error(`Enot.io credentials missing. Check Admin Panel -> Settings.`);
    }
    return { merchantId, secretKey, secretKey2 };
  }

  async createEnotInvoice(amount: number, userId: string, orderId: string, origin: string, email?: string) {
    const { merchantId, secretKey } = await this.getEnotConfig();

    const payload: Record<string, any> = {
      amount,
      order_id: orderId,
      currency: 'RUB',
      shop_id: merchantId,
      custom_fields: JSON.stringify({ user_id: userId }),
      comment: 'izinet balance top-up',
      success_url: `${origin}/dashboard`,
      fail_url: `${origin}/wallet`,
      hook_url: `${origin}/api/pay/webhook/enot`,
      expire: 300
    };

    if (email) {
      payload.email = email;
    }

    const response = await axios.post('https://api.enot.io/invoice/create', payload, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': secretKey
      },
      timeout: 15000,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true
    });

    if (!response.data?.status_check || !response.data?.data?.url) {
      const enotError = response.data?.error || response.data?.message || response.data;
      throw new Error(`Enot.io invoice creation failed: ${typeof enotError === 'string' ? enotError : JSON.stringify(enotError)}`);
    }

    return {
      url: response.data.data.url,
      invoiceId: response.data.data.id,
      expired: response.data.data.expired
    };
  }

  async verifyEnotWebhook(body: any, headerSignature: string | undefined) {
    const { secretKey2 } = await this.getEnotConfig();
    if (!secretKey2) {
      throw new Error('Enot.io webhook secret is missing');
    }
    if (!headerSignature) {
      return false;
    }

    const calculatedSign = crypto
      .createHmac('sha256', secretKey2)
      .update(stableJsonStringify(body))
      .digest('hex');

    const received = headerSignature.toLowerCase();
    
    // Попробуем также вариант без пробелов (стандартный JSON.stringify)
    const calculatedSignCompact = crypto
      .createHmac('sha256', secretKey2)
      .update(JSON.stringify(body))
      .digest('hex');

    console.log(`[EnotDebug] Signature Check:
      - Received: ${received}
      - Calc (Stable): ${calculatedSign}
      - Calc (Compact): ${calculatedSignCompact}
      - Order ID: ${body.order_id}
      - Status: ${body.status}`);

    if (!/^[a-f0-9]{64}$/.test(received)) {
      return false;
    }

    const matchesStable = crypto.timingSafeEqual(
      Buffer.from(received, 'hex'),
      Buffer.from(calculatedSign, 'hex')
    );

    const matchesCompact = crypto.timingSafeEqual(
      Buffer.from(received, 'hex'),
      Buffer.from(calculatedSignCompact, 'hex')
    );

    return matchesStable || matchesCompact;
  }
}

const payment = new PaymentService();

function stableJsonStringify(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(', ')}]`;
  }

  const sortedKeys = Object.keys(value).sort();
  const entries = sortedKeys.map((key) => `${JSON.stringify(key)}: ${stableJsonStringify(value[key])}`);
  return `{${entries.join(', ')}}`;
}

// --- API Routes ---

// --- Admin Middleware ---
async function adminOnly(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  const requestId = Math.random().toString(36).substring(7);

  if (!authHeader) {
    console.warn(`[AdminAuth][${requestId}] ⚠️ No auth header provided`);
    return res.status(401).json({ 
      error: 'Authentication Required', 
      message: 'Зайдите в аккаунт заново.' 
    });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

  if (authErr || !user) {
    console.warn(`[AdminAuth][${requestId}] ❌ Invalid token:`, authErr?.message);
    return res.status(401).json({ 
      error: 'Invalid Session', 
      message: 'Сессия истекла. Пожалуйста, войдите снова.' 
    });
  }

  // Fetch fresh role from DB to ensure it's not stale
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('role, email')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    console.error(`[AdminAuth][${requestId}] ❌ Profile fetch error for ${user.email}:`, profileError?.message);
    return res.status(403).json({ 
      error: 'Profile Error', 
      message: 'Не удалось получить профиль пользователя.' 
    });
  }

  if (profile.role !== 'admin' && profile.role !== 'superadmin') {
    console.warn(`[AdminAuth][${requestId}] 🚫 Access denied for ${profile.email}. Role: ${profile.role}`);
    return res.status(403).json({ 
      error: 'Insufficient Permissions', 
      message: 'Доступ запрещен: требуются права администратора.' 
    });
  }

  console.log(`[AdminAuth][${requestId}] ✅ Admin verified: ${profile.email} (${profile.role})`);
  req.user = { ...user, role: profile.role };
  next();
}

async function authenticateUser(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth required' });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });
  (req as any).user = user;
  next();
}

// User Device Regeneration
app.post('/api/user/devices/:deviceId/regenerate', authenticateUser, async (req, res) => {
  const { deviceId } = req.params;
  const userId = (req as any).user.id;
  
  try {
    const { data: sub, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const targetIdx = devices.findIndex(d => d.id === deviceId);
    
    if (targetIdx === -1) return res.status(404).json({ error: 'Device not found' });

    const target = devices[targetIdx];

    const { data: activeServers, error: sErr } = await supabase
      .from('vpn_servers')
      .select('*')
      .eq('is_active', true);

    if (sErr || !activeServers || activeServers.length === 0) {
      return res.status(400).json({ error: 'No active servers available for regeneration' });
    }

    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const limitBytes = sub.traffic_limit_mb * 1024 * 1024;

    // New unified credentials
    const randomSuffix = Math.random().toString(36).substring(2, 4);
    const newEmail = `user_${userId.slice(0, 5)}_${randomSuffix}_reg`;
    const newUuid = crypto.randomUUID();
    let maxExpiresAt = new Date(target.expiresAt);
    if(maxExpiresAt < new Date()) maxExpiresAt = new Date(sub.expires_at); // fallback
    const expiresAtMs = maxExpiresAt.getTime();

    let configLines: string[] = [];
    let isReplacedOnAtLeastOne = false;

    for (const server of activeServers) {
      try {
        const { instance: xuiInstance } = await getXuiForServer(server.id);
        
        // 1. Delete old client
        try {
          if (target.uuid && target.email) {
            await xuiInstance.deleteClient(target.uuid, target.email);
          }
        } catch (e) {
          console.warn(`[UserRegen] Old client delete fail on ${server.name}:`, e);
        }

        // 3. Add new client to XUI
        const rawConfig = await xuiInstance.addClient(newEmail, newUuid, inboundId, expiresAtMs, limitBytes);
        if (rawConfig && !rawConfig.includes('security=none') && rawConfig.trim() !== '') {
          const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`);
          configLines.push(configWithSuffix);
          isReplacedOnAtLeastOne = true;
        }
      } catch(err: any) {
        console.error(`[UserRegen] Error on server ${server.name}:`, err.message);
      }
    }

    if (!isReplacedOnAtLeastOne) throw new Error(`Failed to regenerate config on any server`);

    // 4. DB update
    devices[targetIdx] = {
      ...target,
      config: configLines.join('\n'), // combined configs
      email: newEmail,
      uuid: newUuid
    };

    await supabase.from('subscriptions').update({ 
      v2ray_config: JSON.stringify(devices),
      updated_at: new Date().toISOString()
    }).eq('id', sub.id);

    res.json({ success: true, message: 'Ключ успешно перегенерирован', device: devices[targetIdx] });
  } catch (err: any) {
    console.error(`[UserRegen] Error:`, err);
    res.status(500).json({ error: err.message });
  }
});

// Helper to get settings from DB with ENV fallback
async function getSystemSetting(key: string, fallback: string = ''): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', key)
      .single();
    if (error) {
      // Just fallback silently to ENV if key or table missing
      return (process.env[key] || fallback).trim();
    }
    return (data?.value || process.env[key] || fallback).trim();
  } catch (e) {
    return (process.env[key] || fallback).trim();
  }
}

// Admin Settings Endpoints
// --- Admin Settings Endpoints
app.get('/api/admin/servers/health', adminOnly, async (req, res) => {
  try {
    const { data: servers, error } = await supabase.from('vpn_servers').select('id, name');
    if (error) throw error;
    
    // Check all servers in parallel with timeout
    const results = await Promise.all((servers || []).map(async (s) => {
      try {
        const { instance } = await getXuiForServer(s.id);
        const isOnline = await instance.checkHealth();
        return { id: s.id, online: isOnline };
      } catch (e) {
        return { id: s.id, online: false };
      }
    }));
    
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/system/sync-all', adminOnly, async (req, res) => {
  console.log('🚀 [Sync] Starting global background synchronization...');
  res.json({ success: true, message: 'Синхронизация запущена в фоновом режиме.' });

  // Run heavy sync in background
  (async () => {
    try {
      const { data: activeSubs } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('status', 'active');
      
      const { data: servers } = await supabase
        .from('vpn_servers')
        .select('*')
        .eq('is_active', true);

      if (!activeSubs || !servers) return;

      const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');

      for (const sub of activeSubs) {
        const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
        const expiresAtMs = sub.expires_at ? new Date(sub.expires_at).getTime() : 0;
        const limitBytes = (sub.traffic_limit_mb || 0) * 1024 * 1024;

        for (const device of devices) {
          for (const server of servers) {
            try {
              const { instance: xui } = await getXuiForServer(server.id);
              await xui.addClient(device.email, device.uuid, inboundId, expiresAtMs, limitBytes);
            } catch (e) {
              // Silently continue if one server fails
            }
          }
        }
      }
      console.log('✅ [Sync] Global sync completed successfully.');
    } catch (e) {
      console.error('❌ [Sync] Background sync failed:', e);
    }
  })();
});

// --- Traffic Webhook for 3x-ui ---
// Usage: http://your-site.app/api/webhooks/traffic-limit?token=YOUR_SECRET
app.post('/api/webhooks/traffic-limit', async (req, res) => {
  const { email, traffic_used, traffic_limit, server_name } = req.body;
  const token = req.query.token;
  
  // Basic security check if token set
  const secret = process.env.WEBHOOK_SECRET || 'izinet_secret';
  if (token !== secret) {
    return res.status(403).json({ error: 'Invalid webhook token' });
  }

  if (!email) return res.status(400).json({ error: 'Email required' });

  console.log(`[Webhook] Traffic limit alert for ${email} on server ${server_name || 'unknown'}`);

  try {
    // 1. Find subscription(s) containing this client email
    // Note: email in 3x-ui is usually stored in v2ray_config JSON
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('status', 'active');

    const affectedSub = subs?.find(s => {
      const devices = parseVpnDevices(s.v2ray_config);
      return devices.some(d => d.email === email);
    });

    if (affectedSub) {
      // 2. Mark as limited if usage is near limit
      await supabase
        .from('subscriptions')
        .update({ status: 'limited', updated_at: new Date().toISOString() })
        .eq('id', affectedSub.id);
      
      console.log(`[Webhook] Subscription ${affectedSub.id} for user ${affectedSub.user_id} marked as LIMITED.`);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[Webhook] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/settings', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) {
      if (error.message?.includes('not found')) {
        return res.status(404).json({ error: 'table_not_found', message: "Таблица 'settings' не найдена в базе данных." });
      }
      throw error;
    }
    res.json(data || []);
  } catch (err: any) {
    console.error('Settings Fetch Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/settings', adminOnly, async (req, res) => {
  const { settings } = req.body; 
  if (!Array.isArray(settings)) return res.status(400).send('Invalid data');

  try {
    const updates = settings.map(s => ({
      key: s.key,
      value: s.value,
      updated_at: new Date().toISOString()
    }));

    console.log('📝 [Settings] Saving updates to Supabase:', updates.map(u => ({ key: u.key, valLen: u.value?.length })));

    const { error } = await supabase
      .from('settings')
      .upsert(updates, { onConflict: 'key' });

    if (error) {
       console.error('❌ [Settings] Supabase Upsert Error:', error);
       if (error.message?.includes('not found')) {
         return res.status(400).json({ error: "Таблица 'settings' не найдена в БД. Пожалуйста, выполните SQL скрипт в панели Supabase." });
       }
       throw error;
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Admin API Routes ---

app.get('/api/admin/stats', adminOnly, async (req, res) => {
  try {
    const { count: usersCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { count: activeSubs } = await supabase.from('subscriptions').select('*', { count: 'exact', head: true }).gt('expires_at', new Date().toISOString());
    const { data: recentRevenue } = await supabase.from('transactions').select('amount').eq('status', 'completed');
    
    // Live stats from all servers
    const { data: servers } = await supabase.from('vpn_servers').select('id, name').eq('is_active', true);
    let totalOnline = 0;
    let serverStats: any[] = [];

    if (servers) {
      const liveData = await Promise.all(servers.map(async (s) => {
        try {
          const { instance } = await getXuiForServer(s.id);
          const onlines = await instance.getOnlines();
          return { id: s.id, name: s.name, online: onlines.length, status: 'online' };
        } catch (e) {
          return { id: s.id, name: s.name, online: 0, status: 'offline' };
        }
      }));
      totalOnline = liveData.reduce((acc, curr) => acc + curr.online, 0);
      serverStats = liveData;
    }

    // Count admins
    const { count: adminsCount } = await supabase.from('users').select('*', { count: 'exact', head: true }).in('role', ['admin', 'superadmin']);

    const totalRevenue = recentRevenue?.reduce((sum, tx) => sum + tx.amount, 0) || 0;

    res.json({
      totalUsers: usersCount,
      activeSubscriptions: activeSubs,
      totalRevenue,
      adminsCount,
      totalOnline,
      serverStats
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/diag', adminOnly, async (req, res) => {
  // Check if settings table exists by doing a small query
  const { data: dbSettings, error: tableError } = await supabase.from('settings').select('*');
  const tableExists = !tableError || !tableError.message.includes('not found');

  const settingsMap: Record<string, string> = {};
  if (dbSettings) {
    dbSettings.forEach((s: any) => settingsMap[s.key] = s.value);
  }

  const merchantId = (settingsMap['ENOT_MERCHANT_ID'] || process.env.ENOT_MERCHANT_ID || '').trim();
  const secretKey = (settingsMap['ENOT_SECRET_KEY'] || process.env.ENOT_SECRET_KEY || '').trim();
  const rawSecretKey2 = (settingsMap['ENOT_SECRET_KEY2'] || process.env.ENOT_SECRET_KEY2 || '').trim();
  const secretKey2 = rawSecretKey2 || secretKey;

  res.json({
    enot: {
      merchantId: {
        len: merchantId.length,
        source: settingsMap['ENOT_MERCHANT_ID'] ? 'DB' : (process.env.ENOT_MERCHANT_ID ? 'ENV' : 'MISSING'),
        preview: merchantId ? `${merchantId.substring(0, 3)}...` : null
      },
      secretKey: {
        len: secretKey.length,
        source: settingsMap['ENOT_SECRET_KEY'] ? 'DB' : (process.env.ENOT_SECRET_KEY ? 'ENV' : 'MISSING'),
        preview: secretKey ? `${secretKey.substring(0, 3)}...` : null
      },
      secretKey2: {
        len: secretKey2.length,
        source: rawSecretKey2 ? (settingsMap['ENOT_SECRET_KEY2'] ? 'DB' : 'ENV') : (secretKey ? 'FALLBACK_KEY_1' : 'MISSING'),
        preview: secretKey2 ? `${secretKey2.substring(0, 3)}...` : null
      }
    },
    database: {
      settingsTableOk: tableExists,
      error: tableError?.message
    },
    env: process.env.NODE_ENV,
    user: (req as any).user?.email,
    role: (req as any).user?.role
  });
});


app.get('/api/admin/payments', adminOnly, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    console.error('❌ Admin payments fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/payments/confirm', adminOnly, async (req, res) => {
  const { paymentId } = req.body;
  
  if (!paymentId) {
    return res.status(400).json({ error: 'Missing paymentId' });
  }

  try {
    // 1. Fetch payment info
    const { data: payRow, error: fetchErr } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (fetchErr || !payRow) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payRow.status === 'completed') {
      return res.status(400).json({ error: 'Payment already completed' });
    }

    console.log(`👤 Admin ${(req as any).user?.email} is manually confirming payment ${paymentId} for user ${payRow.user_id}`);

    // 2. Process using the same logic as webhook
    await processSuccessfulPayment(payRow.user_id, parseFloat(payRow.amount), payRow.id, payRow.provider || 'admin_manual');
    
    res.json({ success: true, message: 'Payment confirmed manually and balance updated' });
  } catch (error: any) {
    console.error('❌ Admin payment confirm error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/users', adminOnly, async (req, res) => {
  const { search } = req.query;
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();
  console.log(`[AdminAPI][${requestId}] GET /api/admin/users start. Search: ${search || 'none'}`);

  try {
    let query = supabase
      .from('users')
      .select(`
        *,
        balances (
          amount
        ),
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
    if (error) {
       console.error(`[AdminAPI][${requestId}] Supabase error:`, error.message);
       return res.status(500).json({ error: error.message });
    }

    if (!data) return res.json([]);

    const transformed = data.map((u: any) => {
      let subscriptions = Array.isArray(u.subscriptions) ? u.subscriptions : (u.subscriptions ? [u.subscriptions] : []);
      const activeSub = subscriptions.find((s: any) => s.status === 'active') || subscriptions[0];
      
      const balanceObj = Array.isArray(u.balances) ? u.balances[0] : u.balances;
      const balance = balanceObj ? balanceObj.amount : 0;

      let serverName = 'Не назначен';
      if (activeSub?.vpn_servers) {
        let vpnServer = activeSub.vpn_servers;
        if (Array.isArray(vpnServer)) vpnServer = vpnServer[0];
        if (vpnServer?.name) serverName = vpnServer.name;
      }

      return {
        ...u,
        balance: balance,
        active_subscription: activeSub ? {
          ...activeSub,
          server_name: serverName
        } : null
      };
    });

    console.log(`[AdminAPI][${requestId}] GET /api/admin/users finished in ${Date.now() - startTime}ms. Count: ${transformed.length}`);
    res.json(transformed);
  } catch (err: any) {
    console.error(`[AdminAPI][${requestId}] Critical error:`, err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/admin/users/:userId/transactions', adminOnly, async (req, res) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  const { userId } = req.params;

  try {
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Calculate totals
    const deposits = transactions
      .filter(t => t.type === 'deposit' && t.status === 'completed')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    
    const withdrawals = transactions
      .filter(t => t.type === 'withdrawal' && t.status === 'completed')
      .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    res.json({
      transactions,
      summary: {
        totalDeposits: deposits,
        totalWithdrawals: withdrawals,
        netProfit: withdrawals
      }
    });
  } catch (err: any) {
    console.error(`[AdminAPI][${requestId}] Error fetching transactions:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/servers/diag', adminOnly, async (req, res) => {
  const { data: servers, error } = await supabase.from('vpn_servers').select('*');
  if (error) return res.status(500).json({ error: error.message });

  const results = [];
  for (const server of servers) {
    try {
      const { instance: xui } = await getXuiForServer(server.id);
      const inbounds = await xui.getInbounds();
      const realityInbound = inbounds.find((i: any) => {
        let ss = i.streamSettings;
        if (typeof ss === 'string') ss = JSON.parse(ss);
        return ss.security === 'reality';
      });

      if (!realityInbound) {
        results.push({ id: server.id, name: server.name, status: 'warning', message: 'Reality inbound не найден' });
        continue;
      }

      let ss = realityInbound.streamSettings;
      if (typeof ss === 'string') ss = JSON.parse(ss);
      
      const realitySettings = ss.realitySettings || {};
      const rs = realitySettings.settings || realitySettings;
      
      const sni = (rs.serverNames?.[0] || realitySettings.serverNames?.[0]) || '';
      const pbk = rs.publicKey || realitySettings.publicKey || '';
      const sid = (rs.shortIds?.[0] || realitySettings.shortIds?.[0]) || '';

      const issues = [];
      if (!sni) issues.push('SNI (Server Names) пуст');
      if (!pbk) issues.push('Public Key пуст');
      if (!sid) issues.push('Short IDs пуст');
      
      // Check if SNI is valid (not an IP)
      if (sni && /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(sni)) issues.push('SNI не может быть IP-адресом');

      results.push({
        id: server.id,
        name: server.name,
        status: issues.length > 0 ? 'error' : 'ok',
        details: { sni, pbk, sid, port: realityInbound.port },
        issues
      });
    } catch (err: any) {
      results.push({ id: server.id, name: server.name, status: 'offline', message: err.message });
    }
  }
  res.json(results);
});

app.post('/api/admin/users/move-server', adminOnly, async (req, res) => {
  return res.status(400).json({ error: 'Функция перенос сервера отключена: используется единая бесшовная сеть.' });
});

app.put('/api/admin/users/:userId/devices/:deviceId/move', adminOnly, async (req, res) => {
  return res.status(400).json({ error: 'Функция перенос сервера отключена: используется единая бесшовная сеть.' });
});

app.delete('/api/admin/users/:userId/devices/:deviceId', adminOnly, async (req, res) => {
  const { userId, deviceId } = req.params;
  try {
    const { data: sub, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    
    const targetIdx = devices.findIndex(d => d.id === deviceId);
    if (targetIdx === -1) return res.status(404).json({ error: 'Device not found' });

    const target = devices[targetIdx];
    
    // Fetch all active servers to ensure we delete from everywhere
    const { data: activeServers } = await supabase
      .from('vpn_servers')
      .select('*')
      .eq('is_active', true);

    try {
      if (activeServers && activeServers.length > 0) {
        for (const server of activeServers) {
          try {
            const { instance } = await getXuiForServer(server.id);
            await instance.deleteClient(target.uuid, target.email);
          } catch (e: any) {
            console.warn(`[AdminAPI] Failed to delete client ${target.email} from XUI on ${server.name}:`, e.message);
          }
        }
      }
    } catch (err: any) {
      console.error(`[AdminAPI] Outer error while deleting client ${target.email}:`, err.message);
    }

    devices.splice(targetIdx, 1);
    
    await supabase.from('subscriptions').update({ 
      v2ray_config: JSON.stringify(devices),
      device_limit: Math.max(1, devices.length),
      updated_at: new Date().toISOString()
    }).eq('id', sub.id);

    res.json({ success: true, message: 'Устройство удалено' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Device Regeneration (Admin)
app.post('/api/admin/users/:userId/devices/:deviceId/regenerate', adminOnly, async (req, res) => {
  const { userId, deviceId } = req.params;
  try {
    const { data: sub, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const targetIdx = devices.findIndex(d => d.id === deviceId);
    
    if (targetIdx === -1) return res.status(404).json({ error: 'Device not found' });

    const target = devices[targetIdx];

    const { data: activeServers, error: sErr } = await supabase
      .from('vpn_servers')
      .select('*')
      .eq('is_active', true);

    if (sErr || !activeServers || activeServers.length === 0) {
      return res.status(400).json({ error: 'No active servers available for regeneration' });
    }

    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const limitBytes = sub.traffic_limit_mb * 1024 * 1024;

    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const newEmail = `user_${userId.slice(0, 8)}_${randomSuffix}_reg`;
    const newUuid = crypto.randomUUID();
    let maxExpiresAt = new Date(target.expiresAt);
    if(maxExpiresAt < new Date()) maxExpiresAt = new Date(sub.expires_at);
    const expiresAtMs = maxExpiresAt.getTime();

    let configLines: string[] = [];
    let isReplacedOnAtLeastOne = false;

    for (const server of activeServers) {
      try {
        const { instance: xuiInstance } = await getXuiForServer(server.id);
        
        try {
          if (target.uuid && target.email) {
            await xuiInstance.deleteClient(target.uuid, target.email);
          }
        } catch (e) {
          console.warn(`[Regen] Failed to delete old client on ${server.name}:`, e);
        }

        const rawConfig = await xuiInstance.addClient(newEmail, newUuid, inboundId, expiresAtMs, limitBytes);
        if (rawConfig && !rawConfig.includes('security=none') && rawConfig.trim() !== '') {
          const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`);
          configLines.push(configWithSuffix);
          isReplacedOnAtLeastOne = true;
        }
      } catch(err: any) {
        console.error(`[Regen] Error on server ${server.name}:`, err.message);
      }
    }

    if (!isReplacedOnAtLeastOne) throw new Error(`Failed to regenerate config on any server`);

    // 4. Update device in array
    devices[targetIdx] = {
      ...target,
      config: configLines.join('\n'),
      email: newEmail,
      uuid: newUuid
    };

    await supabase.from('subscriptions').update({ 
      v2ray_config: JSON.stringify(devices),
      updated_at: new Date().toISOString()
    }).eq('id', sub.id);

    res.json({ success: true, message: 'Ключ успешно обновлен', device: devices[targetIdx] });
  } catch (err: any) {
    console.error(`[AdminRegen] Error:`, err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/:userId/devices', adminOnly, async (req, res) => {
  const { userId } = req.params;
  const { label } = req.body;
  try {
    const { data: sub, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!sub) return res.status(404).json({ error: 'Активная подписка не найдена' });
    // if (!sub.server_id) return res.status(400).json({ error: 'Сервер для подписки не назначен' });

    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    
    if (devices.length >= 5) {
      return res.status(400).json({ error: 'Достигнут лимит устройств (5) для пользователя' });
    }

    const { data: activeServers, error: sErr } = await supabase
      .from('vpn_servers')
      .select('*')
      .eq('is_active', true);

    if (sErr || !activeServers || activeServers.length === 0) {
      return res.status(400).json({ error: 'No active servers available for addClient' });
    }

    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const limitBytes = sub.traffic_limit_mb * 1024 * 1024;

    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const email = `user_${userId.slice(0, 8)}_${randomSuffix}_${devices.length}`;
    const uuid = crypto.randomUUID();
    const expiresAtMs = new Date(sub.expires_at).getTime();

    let configLines: string[] = [];
    let isCreatedOnAtLeastOne = false;

    for (const server of activeServers) {
      try {
        const { instance: xuiInstance } = await getXuiForServer(server.id);
        const rawConfig = await xuiInstance.addClient(email, uuid, inboundId, expiresAtMs, limitBytes);
        if (rawConfig && !rawConfig.includes('security=none') && rawConfig.trim() !== '') {
          const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`);
          configLines.push(configWithSuffix);
          isCreatedOnAtLeastOne = true;
        }
      } catch (err: any) {
        console.error(`[AdminAddClient] Error on server ${server.name}:`, err.message);
      }
    }

    if (!isCreatedOnAtLeastOne) {
       throw new Error(`Не удалось сгенерировать конфиг на сервере XUI`);
    }

    const newDevice: VpnDevice = {
      id: `device_${uuid.slice(0,8)}`,
      label: label || `Доп. устройство ${devices.length + 1}`,
      config: configLines.join('\n'),
      email: email,
      uuid: uuid,
      expiresAt: sub.expires_at,
      serverType: sub.server_type,
      trafficUsedBytes: 0,
      serverId: activeServers[0].id
    };

    devices.push(newDevice);
    
    await supabase.from('subscriptions').update({ 
      v2ray_config: JSON.stringify(devices),
      device_limit: devices.length,
      updated_at: new Date().toISOString()
    }).eq('id', sub.id);

    res.json({ success: true, message: 'Устройство добавлено', device: newDevice });
  } catch (err: any) {
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
      res.json({ success: true, name: 'XUI', version: 'Latest', stats_count: stats.length, status: 'ok' });
    } else {
      res.json({ success: false, error: 'Login failed', status: 'error' });
    }
  } catch (err: any) {
    console.error(`❌ Connection check error for server ${id}:`, err.message);
    res.status(500).json({ success: false, error: err.message, status: 'error' });
  }
});

app.post('/api/admin/system/sync-servers', adminOnly, async (req, res) => {
  try {
    console.log(`[SyncServers] Manual synchronization of users to active servers triggered`);
    const { data: activeServers, error: srvErr } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (srvErr) throw srvErr;
    if (!activeServers || activeServers.length === 0) return res.json({ status: 'ok', msg: 'No active servers' });

    // Fix limitIp to 0 for all inbound clients directly on XUI to prevent timeouts
    for (const server of activeServers) {
        try {
            console.log(`Fixing limitIp=0 on server ${server.name}...`);
            const { instance } = await getXuiForServer(server.id);
            if (!instance['sessionCookie']) await instance.login();
            const listResp = await axios.get(`${instance['host']}${instance['basePath']}/panel/api/inbounds/list`, getRequestConfig(`${instance['host']}${instance['basePath']}/panel/api/inbounds/list`, { 'Cookie': instance['sessionCookie'] }));
            
            const inbounds = listResp.data.obj || [];
            let inboundsUpdated = 0;
            for (const inbound of inbounds) {
              const settings = JSON.parse(inbound.settings || '{}');
              if (!settings.clients || settings.clients.length === 0) continue;
              
              let changed = false;
              settings.clients = settings.clients.map((c: any) => {
                if (c.limitIp !== 0) {
                   changed = true;
                   return { ...c, limitIp: 0 };
                }
                return c;
              });

              if (changed) {
                console.log(`Updating limitIp: 0 for inbound ${inbound.id} on ${server.name}`);
                await axios.post(`${instance['host']}${instance['basePath']}/panel/api/inbounds/update/${inbound.id}`, {
                  ...inbound,
                  settings: JSON.stringify(settings)
                }, getRequestConfig(`${instance['host']}${instance['basePath']}/panel/api/inbounds/update/${inbound.id}`, { 'Cookie': instance['sessionCookie'] }));
                inboundsUpdated++;
              }
            }
            console.log(`✅ Fixed limitIp on ${inboundsUpdated} inbounds for ${server.name}`);
        } catch (e: any) {
            console.error(`Error fixing limitIp on ${server.name}:`, e.message);
        }
    }

    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const { data: subs, error: subErr } = await supabase.from('subscriptions').select('*').eq('status', 'active');
    if (subErr) throw subErr;

    let updatedUsers = 0;
    
    for (const sub of subs || []) {
      const limitBytes = sub.traffic_limit_mb * 1024 * 1024;
      let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
      let subModified = false;

      for (let i = 0; i < devices.length; i++) {
        const device = devices[i];
        const links = device.config.split('\n').filter(l => l.startsWith('v'));
        
        // Check if all current active suffixes are present
        const hasAllActiveServers = activeServers.every((s: any) => 
          links.some(l => l.endsWith(`#${s.name.replace(/\s+/g,'_')}`))
        );

        // If the number of links doesn't match the number of active servers, OR we're missing an active server suffix, we need to sync!
        if (links.length !== activeServers.length || !hasAllActiveServers) {
          console.log(`[SyncServers] Syncing device ${device.label} for user ${sub.user_id}`);
          let newConfigLines: string[] = [];
          const expiresAtMs = new Date(device.expiresAt).getTime();

          for (const server of activeServers) {
            try {
              const { instance: xuiInstance } = await getXuiForServer(server.id);
              // addClient falls back to updateClient if email already exists, and always returns the link
              const rawConfig = await xuiInstance.addClient(device.email, device.uuid, inboundId, expiresAtMs, limitBytes);
              if (rawConfig && !rawConfig.includes('security=none') && rawConfig.trim() !== '') {
                const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`);
                newConfigLines.push(configWithSuffix);
              }
            } catch (err: any) {
              console.error(`[SyncServers] Error on server ${server.name} for ${device.email}:`, err.message);
            }
          }

          if (newConfigLines.length > 0) {
            device.config = newConfigLines.join('\n');
            subModified = true;
          }
        }
      }

      if (subModified) {
        await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices), updated_at: new Date().toISOString() }).eq('id', sub.id);
        updatedUsers++;
      }
    }

    res.json({ status: 'ok', updatedUsers });
  } catch (err: any) {
    console.error('❌ Global server sync error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/admin/sync-all', adminOnly, async (req, res) => {
  try {
    console.log(`[API] Manual traffic sync triggered`);
    await syncTrafficStats();
    res.json({ status: 'ok', message: 'Synchronization completed' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/servers', adminOnly, async (req, res) => {
  console.log('[AdminAPI] Fetching servers list...');
  const startTime = Date.now();
  try {
    const { data: servers, error } = await supabase.from('vpn_servers').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('[AdminAPI] Supabase error fetching servers:', error.message);
      return res.status(500).json({ error: error.message });
    }
    
    console.log(`[AdminAPI] Found ${servers.length} servers in DB. Enriching with stats...`);
    
    const enrichedServers = await Promise.all(servers.map(async (server) => {
      try {
        const statsPromise = (async () => {
             const { instance } = await getXuiForServer(server.id);
             // Use very short timeout for "live" stats to prevent hanging admin UI
             const shortConfig = (url: string) => getRequestConfig(url, { 'Cookie': instance['sessionCookie'] }, 3000);
             
             // Check if we can even login first if needed
             if (!instance['sessionCookie']) {
               await instance.login();
             }

             const onlines = await instance.getOnlines();
             const clients = await instance.listClients();
             return { 
               onlineCount: (onlines || []).length,
               clientCount: (clients || []).length 
             };
        })();

        // Race against a 15-second timeout per server (increased from 5s) - BUG-12
        const timeoutPromise = new Promise<{onlineCount: number, clientCount: number}>((resolve) => 
          setTimeout(() => resolve({ onlineCount: 0, clientCount: 0 }), 15000)
        );

        const [subCount, xuiStats] = await Promise.all([
          supabase
            .from('subscriptions')
            .select('*', { count: 'exact', head: true })
            .eq('server_id', server.id)
            .eq('status', 'active'),
          Promise.race([statsPromise, timeoutPromise]).catch(err => {
            console.warn(`[AdminAPI] Could not fetch stats for server ${server.id}:`, err.message);
            return { onlineCount: 0, clientCount: 0 };
          })
        ]);

        return {
          ...server,
          total_users: subCount.count || 0,
          online_users: xuiStats.onlineCount,
          xui_total_clients: xuiStats.clientCount
        };
      } catch (err: any) {
        console.error(`[AdminAPI] Error enriching server ${server.id}:`, err.message);
        return {
          ...server,
          total_users: 0,
          online_users: 0,
          error: true,
          errorMessage: err.message
        };
      }
    }));

    console.log(`[AdminAPI] Successfully enriched all servers in ${Date.now() - startTime}ms.`);
    res.json(enrichedServers);
  } catch (err: any) {
    console.error('[AdminAPI] Critical error in GET /api/admin/servers:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/servers', adminOnly, async (req, res) => {
  const { name, ip, domain, api_port, username, password, location_code, is_default } = req.body;
  
  try {
    const isDefault = !!is_default;
    
    if (isDefault) {
      try {
        await supabase.from('vpn_servers').update({ is_default: false });
      } catch (e) {
        console.warn('⚠️ Could not clear is_default, column might be missing');
      }
    }

    const payload: any = {
      name, 
      ip, 
      domain, 
      api_port: api_port ? parseInt(api_port as any) : 2053, 
      username, 
      password, 
      location_code: location_code || 'DE',
      is_active: true
    };

    // Try adding is_default if available
    try {
      const { data, error } = await supabase.from('vpn_servers').insert([{
        ...payload,
        is_default: isDefault
      }]).select().single();

      if (error) {
        if (error.message?.includes('is_default')) {
           // Retry without is_default
           const { data: retryData, error: retryError } = await supabase.from('vpn_servers').insert([payload]).select().single();
           if (retryError) throw retryError;
           return res.json(retryData);
        }
        throw error;
      }
      return res.json(data);
    } catch (innerErr: any) {
      if (innerErr.message?.includes('is_default')) {
         const { data, error } = await supabase.from('vpn_servers').insert([payload]).select().single();
         if (error) throw error;
         return res.json(data);
      }
      throw innerErr;
    }
  } catch (err: any) {
    console.error('Error adding server:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/servers/:id', adminOnly, async (req, res) => {
  const { id } = req.params;
  const updates = { ...req.body };
  
  try {
    if (updates.is_default === true) {
      try {
        await supabase.from('vpn_servers').update({ is_default: false }).neq('id', id);
      } catch (e) {
        console.warn('⚠️ Could not clear is_default, column might be missing');
      }
    }

    const { data, error } = await supabase.from('vpn_servers').update(updates).eq('id', id).select().single();

    if (error) {
      if (error.message?.includes('is_default')) {
        delete updates.is_default;
        const { data: retryData, error: retryError } = await supabase.from('vpn_servers').update(updates).eq('id', id).select().single();
        if (retryError) throw retryError;
        xuiInstances.delete(id);
        return res.json(retryData);
      }
      throw error;
    }
    
    // Clear instance cache to force re-creation with new creds
    xuiInstances.delete(id);
    res.json(data);
  } catch (err: any) {
    console.error('Error updating server:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/servers/:id', adminOnly, async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('vpn_servers').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  xuiInstances.delete(id);
  res.json({ success: true });
});

// 💰 Subscription config endpoint for apps (V2Ray/Hiddify)
app.get('/api/sub-url/:id', async (req, res) => {
  // Priority: 1. PUBLIC_URL, 2. VITE_API_URL, 3. Host detection
  const publicUrl = process.env.PUBLIC_URL || process.env.VITE_API_URL || '';
  let base = publicUrl.replace(/\/$/, '');
  
  if (!base) {
    base = `${req.protocol}://${req.get('host')}`;
  }
  
  console.log(`[SubURL] Request from ${req.get('origin') || 'Unknown'}, returning: ${base}/api/sub/${req.params.id}`);
  res.json({ url: `${base}/api/sub/${req.params.id}` });
});

app.get('/api/sub/:id', async (req, res) => {
  const { id } = req.params;
  const { deviceId } = req.query;
  const userAgent = req.headers['user-agent'] || '';
  
  const requestId = Math.random().toString(36).substring(7);
  console.log(`[SubAPI][${requestId}] Request for ID: ${id}, Device: ${deviceId}, UA: ${userAgent}`);
  
  const { data: sub, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !sub) {
    console.warn(`[SubAPI][${requestId}] Subscription not found: ${id}`);
    return res.status(404).send('Subscription not found');
  }

  const now = new Date();
  const expires = new Date(sub.expires_at);
  if (sub.status !== 'active' || expires < now) {
    console.warn(`[SubAPI][${requestId}] Inactive or expired: ${id}. Status: ${sub.status}, Expires: ${sub.expires_at}`);
    return res.status(403).send('Subscription expired or inactive');
  }

  // Retrieve all servers to distinguish between active, inactive, and legacy links
  const { data: allServers, error: sErr } = await supabase.from('vpn_servers').select('name, is_active');
  if (sErr) throw sErr;
  
  const activeSuffices = (allServers || []).filter(s => s.is_active).map((s: any) => `#${s.name.replace(/\s+/g,'_')}`);
  const inactiveSuffices = (allServers || []).filter(s => !s.is_active).map((s: any) => `#${s.name.replace(/\s+/g,'_')}`);

  let configText = "";
  try {
    if (sub.v2ray_config) {
      if (sub.v2ray_config.trim().startsWith('[')) {
        let devices = JSON.parse(sub.v2ray_config);
        
        // Filter by deviceId if provided
        if (deviceId && Array.isArray(devices)) {
          devices = devices.filter((d: any) => d.id === deviceId);
        }
        
        configText = devices.map((d: any) => d.config).join('\n');
      } else {
        configText = sub.v2ray_config;
      }
    }
  } catch (e) {
    configText = sub.v2ray_config || "";
  }

  // V2Ray apps expect Base64 encoded list of links
  const configLines = configText.split('\n')
    .map(l => l.trim())
    .filter(line => line.startsWith('vless://') || line.startsWith('vmess://') || line.startsWith('trojan://'))
    .filter(line => {
      // Check if it belongs to an explicitly inactive server
      const isExplicitlyInactive = inactiveSuffices.some((suffix: string) => line.endsWith(suffix));
      if (isExplicitlyInactive) return false; // Drop dead links

      // If it belongs to an active server, absolutely keep it
      const isActive = activeSuffices.some((suffix: string) => line.endsWith(suffix));
      if (isActive) return true;

      // If it matches neither (meaning it has no #Server_Name suffix), it's a legacy link! Keep it so users don't lose internet.
      return true;
    })
    .join('\n');
  
  if (!configLines) {
    console.warn(`⚠️ No valid links found for subscription: ${id}`);
    return res.status(200).send(''); 
  }

  const base64Config = Buffer.from(configLines).toString('base64');
  
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60');
  
  // Standard headers for V2Ray/Hiddify
  res.setHeader('profile-title', 'izinet-vpn');
  res.setHeader('profile-update-interval', '6'); // update every 6 hours
  
  const used = Math.floor((sub.traffic_used_mb || 0) * 1024 * 1024);
  const total = Math.floor((sub.traffic_limit_mb || 0) * 1024 * 1024);
  const expireAt = Math.floor(new Date(sub.expires_at).getTime() / 1000);
  res.setHeader('Subscription-Userinfo', `upload=0; download=${used}; total=${total}; expire=${expireAt}`);
  
  console.log(`[SubAPI][${requestId}] ✅ Delivered nodes: ${configLines.split('\n').filter(Boolean).length}`);
  console.log(`[SubAPI][${requestId}] 📋 Config sample: ${configLines.substring(0, 100)}...`);
  res.send(base64Config);
});

// 💰 Create Payment Link
app.post('/api/pay/create', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { userId, amount, method } = req.body;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!userId || !amount || !method) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user || user.id !== userId) {
    return res.status(401).json({ error: 'Unauthorized: ID mismatch' });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount < 10) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const paymentId = crypto.randomUUID();

  try {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const { error: paymentErr } = await supabase
      .from('payments')
      .insert({
        id: paymentId,
        user_id: userId,
        amount: numericAmount,
        currency: 'RUB',
        payment_method: method,
        status: 'pending',
        expires_at: expiresAt
      });

    if (paymentErr) {
      throw new Error(`Could not create pending payment: ${paymentErr.message}`);
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    let url = '';
    let invoiceId = '';
    if (method === 'enot') {
      const invoice = await payment.createEnotInvoice(numericAmount, userId, paymentId, origin, user.email);
      url = invoice.url;
      invoiceId = invoice.invoiceId;
    } else {
      throw new Error('Unsupported payment method');
    }

    await supabase
      .from('payments')
      .update({
        payment_link: url,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      })
      .eq('id', paymentId);

    res.json({ success: true, url, orderId: paymentId, invoiceId });
  } catch (error: any) {
    await supabase
      .from('payments')
      .update({ status: 'failed' })
      .eq('id', paymentId);
    console.error('Payment creation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 📊 Sync user traffic manually with throttling
const lastSyncMap = new Map<string, number>();

// BUG-10: Memory leak fix - clean up old sync timestamps every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [userId, ts] of lastSyncMap.entries()) {
    if (ts < cutoff) lastSyncMap.delete(userId);
  }
}, 10 * 60 * 1000);

app.post('/api/subscription/sync-servers', authenticateUser, async (req, res) => {
  const userId = (req as any).user.id;
  try {
    const { data: activeServers, error: srvErr } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (srvErr) throw srvErr;
    if (!activeServers || activeServers.length === 0) return res.json({ status: 'ok' });

    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subErr || !sub) return res.json({ status: 'ok' });

    const limitBytes = sub.traffic_limit_mb * 1024 * 1024;
    let devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    let subModified = false;

    for (let i = 0; i < devices.length; i++) {
        const device = devices[i];
        const links = device.config.split('\n').filter(l => l.startsWith('v'));

        const hasAllActiveServers = activeServers.every((s: any) => 
          links.some(l => l.endsWith(`#${s.name.replace(/\s+/g,'_')}`))
        );

        if (links.length !== activeServers.length || !hasAllActiveServers) {
          console.log(`[AutoSync] Healing device ${device.label} for user ${userId}`);
          let newConfigLines: string[] = [];
          const expiresAtMs = new Date(device.expiresAt).getTime();

          for (const server of activeServers) {
            try {
              const { instance: xuiInstance } = await getXuiForServer(server.id);
              const rawConfig = await xuiInstance.addClient(device.email, device.uuid, inboundId, expiresAtMs, limitBytes);
              if (rawConfig && !rawConfig.includes('security=none') && rawConfig.trim() !== '') {
                const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`);
                newConfigLines.push(configWithSuffix);
              }
            } catch (err: any) {
              console.error(`[AutoSync] Error on server ${server.name}:`, err.message);
            }
          }

          if (newConfigLines.length > 0) {
            device.config = newConfigLines.join('\n');
            subModified = true;
          }
        }
    }

    if (subModified) {
      await supabase.from('subscriptions').update({ v2ray_config: JSON.stringify(devices) }).eq('id', sub.id);
      return res.json({ status: 'synced' });
    }

    res.json({ status: 'ok' });
  } catch (err: any) {
    console.error('❌ Auto server sync error:', err);
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/subscription/sync-traffic', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { userId } = req.body;
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  // Throttle: Max once per 30 seconds to keep UI snappy
  const now = Date.now();
  if (lastSyncMap.has(userId) && (now - lastSyncMap.get(userId)!) < 30000) {
    return res.json({ success: true, message: 'Already synced recently' });
  }
  lastSyncMap.set(userId, now);

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user || user.id !== userId) {
    return res.status(401).json({ error: 'Unauthorized: ID mismatch' });
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
app.post('/api/pay/webhook/enot-v2', async (req, res) => {
  return handleEnotWebhook(req, res);
});

app.post('/api/pay/webhook/enot', async (req, res, next) => {
  if (req.headers['x-api-sha256-signature']) {
    return handleEnotWebhook(req, res);
  }

  next();
});

app.post('/api/pay/webhook/enot-legacy', async (req, res) => {
  console.log('🔗 Enot Webhook Received:', JSON.stringify(req.body));
  
  const { merchant_id, amount, intid, custom_field, sign } = req.body;
  const orderId = req.body.merchant_order_id;

  if (!merchant_id || !amount || !sign || !orderId) {
    console.warn('⚠️ Malformed Enot Webhook payload');
    return res.status(400).send('Malformed payload');
  }

  // Enot webhook sign: merchant_id:amount:secret_word2:merchant_order_id
  const secret2 = await getSystemSetting('ENOT_SECRET_KEY2', process.env.ENOT_SECRET_KEY || ''); 
  
  if (!secret2) {
    console.error('❌ ENOT_SECRET_KEY2 is not defined in DB or environment!');
    return res.status(500).send('Configuration Error');
  }

  const calculatedSign = crypto
    .createHash('md5')
    .update(`${merchant_id}:${amount}:${secret2}:${orderId}`)
    .digest('hex');

  if (sign.toLowerCase() !== calculatedSign.toLowerCase()) {
    console.warn(`❌ Invalid Enot signature. Got ${sign}, expected ${calculatedSign}`);
    // Log context for debugging
    console.log(`[DEBUG] Sign data: ${merchant_id}:${amount}:[SECRET_HIDDEN]:${orderId}`);
    return res.status(400).send('Invalid signature');
  }

  try {
    const userId = custom_field; // Enot passes userId back in custom_field (cf)
    if (!userId) {
      console.error('❌ No custom_field (userId) found in Enot webhook');
      return res.status(400).send('Missing userId in custom_field');
    }
    
    await processSuccessfulPayment(userId, parseFloat(amount), orderId, 'enot');
    res.send('YES');
  } catch (err: any) {
    console.error('❌ Error processing Enot payment:', err.message);
    res.status(500).send('Internal Error');
  }
});

async function handleEnotWebhook(req: any, res: any) {
  console.log('Enot Webhook Received:', JSON.stringify(req.body));

  const signature = req.headers['x-api-sha256-signature'];
  const headerSignature = Array.isArray(signature) ? signature[0] : signature;
  const { amount, status, invoice_id, custom_fields } = req.body;
  const orderId = req.body.order_id;

  if (!amount || !status || !invoice_id || !orderId) {
    console.warn('Malformed Enot webhook payload');
    return res.status(400).send('Malformed payload');
  }

  try {
    const isValidSignature = await payment.verifyEnotWebhook(req.body, headerSignature);
    if (!isValidSignature) {
      console.warn('Invalid Enot webhook signature');
      return res.status(400).send('Invalid signature');
    }
  } catch (err: any) {
    console.error('Enot webhook signature verification failed:', err.message);
    return res.status(500).send('Configuration Error');
  }

  try {
    const { data: paymentRow, error: paymentErr } = await supabase
      .from('payments')
      .select('user_id, amount, status')
      .eq('id', orderId)
      .maybeSingle();

    if (paymentErr) {
      throw new Error(`Payment lookup failed: ${paymentErr.message}`);
    }

    const userId = paymentRow?.user_id || parseEnotCustomFields(custom_fields).user_id || parseEnotCustomFields(custom_fields).userId;
    if (!userId) {
      console.error('❌ [EnotWebhook] No user_id found for order:', orderId, 'Body:', JSON.stringify(req.body));
      return res.status(400).send('Missing user_id');
    }

    const paidAmount = parseFloat(amount);
    if (!Number.isFinite(paidAmount)) {
      return res.status(400).send('Invalid amount');
    }

    if (paymentRow?.amount && Math.abs(Number(paymentRow.amount) - paidAmount) > 0.01) {
      console.warn(`Enot amount mismatch for ${orderId}: expected ${paymentRow.amount}, got ${amount}`);
      return res.status(400).send('Amount mismatch');
    }

    if (paymentRow?.status === 'completed') {
      console.log(`Payment ${orderId} already processed.`);
      return res.send('YES');
    }

    if (status !== 'success') {
      await markPaymentStatus(orderId, status === 'refund' ? 'refunded' : 'failed');
      return res.send('YES');
    }

    await processSuccessfulPaymentForCurrentSchema(userId, paidAmount, orderId, 'enot');
    return res.send('YES');
  } catch (err: any) {
    console.error('Error processing Enot payment:', err.message);
    return res.status(500).send('Internal Error');
  }
}

function parseEnotCustomFields(customFields: any): Record<string, any> {
  if (!customFields) return {};
  if (typeof customFields === 'object') return customFields;
  if (typeof customFields === 'string') {
    try {
      return JSON.parse(customFields);
    } catch {
      return {};
    }
  }
  return {};
}

async function markPaymentStatus(orderId: string, status: string) {
  const { error } = await supabase
    .from('payments')
    .update({ status })
    .eq('id', orderId)
    .eq('status', 'pending');

  if (error) {
    throw new Error(`Payment status update failed: ${error.message}`);
  }
}

async function processSuccessfulPaymentForCurrentSchema(userId: string, amount: number, orderId: string, provider: string) {
  console.log(`Processing payment: ${amount} for user ${userId} via ${provider}`);

  const { data: existingPayment, error: paymentReadErr } = await supabase
    .from('payments')
    .select('status')
    .eq('id', orderId)
    .maybeSingle();

  if (paymentReadErr) {
    throw new Error(`Payment read failed: ${paymentReadErr.message}`);
  }

  if (existingPayment?.status === 'completed') {
    console.log(`Payment ${orderId} already processed.`);
    return;
  }

  const { data: balanceData } = await supabase
    .from('balances')
    .select('amount')
    .eq('user_id', userId)
    .maybeSingle();

  const currentAmount = Number(balanceData?.amount || 0);
  const { error: balErr } = await supabase
    .from('balances')
    .upsert({
      user_id: userId,
      amount: currentAmount + amount,
      currency: 'RUB',
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  if (balErr) {
    throw new Error(`Balance update failed: ${balErr.message}`);
  }

  const { error: paymentStatusErr } = await supabase
    .from('payments')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', orderId);

  if (paymentStatusErr) {
    console.error('Failed to update payment status:', paymentStatusErr.message);
  }

  const { error: txInsertErr } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      amount,
      currency: 'RUB',
      type: 'deposit',
      status: 'completed',
      description: `Balance top-up via ${provider}. Payment ID: ${orderId}`
    });

  if (txInsertErr) {
    console.error('Failed to insert transaction journal row:', txInsertErr.message);
  }

  console.log(`Balance successfully updated for user ${userId}. New total: ${currentAmount + amount}`);
}

async function processSuccessfulPayment(userId: string, amount: number, orderId: string, provider: string) {
  return processSuccessfulPaymentForCurrentSchema(userId, amount, orderId, provider);
  console.log(`💰 Processing payment: ${amount} for user ${userId} via ${provider}`);
  
  // Legacy wrapper retained for old webhook compatibility.
  // Current payment flow is handled by processSuccessfulPaymentForCurrentSchema().
  const tableName = 'payments';
  
  const { data: existingTx } = await supabase
    .from(tableName)
    .select('status')
    .eq('id', orderId)
    .maybeSingle(); // BUG-11: use maybeSingle to avoid 406/PGRST116 log spam

  if (existingTx?.status === 'completed') {
    console.log(`⚠️ Payment ${orderId} already processed in table ${tableName}.`);
    return;
  }

  // 2. Update balance
  // Ensure we have a row in balances
  const { data: balanceData } = await supabase
    .from('balances')
    .select('amount')
    .eq('user_id', userId)
    .maybeSingle();

  const currentAmount = balanceData?.amount || 0;
  
  console.log(`💼 Current balance for ${userId}: ${currentAmount}. Adding ${amount}`);

  // Using Supabase Service Role to bypass RLS for balance update
  const { error: balErr } = await supabase
    .from('balances')
    .upsert({ 
      user_id: userId, 
      amount: currentAmount + amount,
      currency: 'RUB',
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  if (balErr) {
    console.error(`❌ Failed to update balance for user ${userId}:`, balErr.message);
    throw new Error(`Balance update failed: ${balErr.message}`);
  }

  // 3. Update payment status
  const { error: statusErr } = await supabase
    .from(tableName)
    .update({ status: 'completed' })
    .eq('id', orderId);

  if (statusErr) {
    console.error(`❌ Failed to update status in ${tableName}:`, statusErr.message);
  }

  console.log(`✅ Balance successfully updated for user ${userId}. New total: ${currentAmount + amount}`);
}

// Health check and configuration status
app.get('/api/config', (req, res) => {
  res.json({
    telegramBotName: process.env.VITE_TELEGRAM_BOT_NAME || process.env.TELEGRAM_BOT_NAME || 'izinet_bot'
  });
});

app.get('/api/servers/status', async (req, res) => {
  try {
    const { data: servers, error } = await supabase
      .from('vpn_servers')
      .select('id, name, location_code, domain, ip, is_active')
      .eq('is_active', true);
    
    if (error) throw error;

    const statuses = await Promise.all(servers.map(async (server) => {
      const start = Date.now();
      let load = 0;
      let ping = 0;
      let status = 'offline';
      
      try {
        const { instance } = await getXuiForServer(server.id);
        const onlines = await instance.getOnlines().catch(() => []);
        const activeCount = onlines?.length || 0;
        load = Math.min(Math.round((activeCount / 250) * 100), 100);
        ping = Date.now() - start;
        status = 'online';
      } catch (e) {
        ping = 999;
      }

      return {
        id: server.id,
        name: server.name,
        location_code: server.location_code,
        domain: server.domain,
        ip: server.ip,
        ping,
        load,
        status,
        is_active: server.is_active
      };
    }));

    res.json(statuses);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
app.get('/api/subscription/plans', async (req, res) => {
  try {
    const plansJson = await getSystemSetting('SUBSCRIPTION_PLANS', '');
    if (!plansJson) {
      // Return default hardcoded if not set in DB
      return res.json({
        periods: [
          { id: '1m', label: '1 месяц', price: 100, days: 30 },
          { id: '2m', label: '2 месяца', price: 190, days: 60, discount: '5%' },
          { id: '6m', label: '6 месяцев', price: 500, days: 180, discount: '17%' },
          { id: '12m', label: '12 месяцев', price: 900, days: 365, discount: '25%' },
        ],
        serverTypes: [
          { id: 'wifi', label: 'Wi-Fi', price: 0 },
          { id: 'lte', label: 'LTE', price: 50 },
        ],
        deviceLimit: 2
      });
    }
    const plans = JSON.parse(plansJson);
    const deviceLimit = await getSystemSetting('DEVICE_LIMIT', '2');
    res.json({ ...plans, deviceLimit: parseInt(deviceLimit) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/subscription/device/delete', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { userId, deviceId } = req.body;

  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!userId || !deviceId) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user || user.id !== userId) {
    return res.status(401).json({ error: 'Unauthorized: ID mismatch' });
  }

  try {
    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subErr) throw subErr;
    if (!sub) return res.status(404).json({ error: 'Active subscription not found' });

    const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);
    const target = devices.find((device) => device.id === deviceId);
    if (!target) return res.status(404).json({ error: 'Device not found' });
    if (target.id === 'primary') {
      return res.status(400).json({ error: 'Primary device cannot be deleted' });
    }

    const { data: activeServers } = await supabase
      .from('vpn_servers')
      .select('*')
      .eq('is_active', true);

    if (activeServers && activeServers.length > 0) {
      for (const server of activeServers) {
        try {
          const { instance } = await getXuiForServer(server.id);
          await instance.deleteClient(target.uuid, target.email);
        } catch (e: any) {
          console.warn(`[UserAPI] Failed to delete client ${target.email} from XUI on ${server.name}:`, e.message);
        }
      }
    }

    const nextDevices = devices.filter((device) => device.id !== deviceId);
    const maxExpiryDate = nextDevices.reduce((max, device) => {
      const expiresAt = new Date(device.expiresAt);
      return expiresAt > max ? expiresAt : max;
    }, new Date(sub.expires_at || Date.now()));

    const { data: updatedSub, error: updateErr } = await supabase
      .from('subscriptions')
      .update({
        v2ray_config: JSON.stringify(nextDevices),
        device_limit: Math.max(1, nextDevices.length),
        expires_at: maxExpiryDate.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', sub.id)
      .select()
      .maybeSingle();

    if (updateErr) throw updateErr;
    res.json({ success: true, subscription: updatedSub, devices: nextDevices });
  } catch (error: any) {
    console.error('Device delete error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.post('/api/subscription/buy', async (req, res) => {
  const authHeader = req.headers.authorization;
  const { userId, planId, planName, price, durationDays, periodMonths, serverType, deviceLimit, forceNew, targetDeviceId, deviceName, serverId: reqServerId } = req.body;

  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  console.log(`[BUY] Request received: user=${userId}, plan=${planName}, reqServer=${reqServerId}, targetDevice=${targetDeviceId}`);

  if (!userId || !planId || !price) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // 0. Security check: Verify token
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user || user.id !== userId) {
    return res.status(401).json({ error: 'Unauthorized: ID mismatch' });
  }

  try {
    // 0.5. Validate price and device limit against DB
    const plansJson = await getSystemSetting('SUBSCRIPTION_PLANS', '');
    const globalDeviceLimitStr = await getSystemSetting('DEVICE_LIMIT', '2');
    const globalDeviceLimit = parseInt(globalDeviceLimitStr);
    
    if (plansJson) {
      try {
        const dbPlans = JSON.parse(plansJson);
        const period = dbPlans.periods.find((p: any) => p.id === planId);
        const sType = dbPlans.serverTypes.find((s: any) => s.id === (serverType?.toLowerCase() || 'wifi'));
        
        if (period && sType) {
          const expectedPrice = (period.price + sType.price) * (forceNew || targetDeviceId ? 1 : (deviceLimit || 1));
          if (Math.abs(price - expectedPrice) > 1) { // Allow small rounding diffs
            console.warn(`[BUY] Price mismatch for user ${userId}: client sent ${price}, DB calculated ${expectedPrice}`);
            return res.status(400).json({ error: 'Mismatched price. Please refresh the page.' });
          }
        }
      } catch (e) {
        console.error('[BUY] Failed to parse subscription plans from DB:', e);
      }
    }

    // 1. Get current balance
    const { data: balanceData, error: balanceErr } = await supabase
      .from('balances')
      .select('amount')
      .eq('user_id', userId)
      .maybeSingle();

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

  // Instead of picking a single server, we fetch ALL active servers to mirror clients
  const { data: activeServers, error: serversErr } = await supabase
    .from('vpn_servers')
    .select('*')
    .eq('is_active', true);

  if (serversErr || !activeServers || activeServers.length === 0) {
    throw new Error('No active VPN servers available for provisioning.');
  }

  const serverId = reqServerId || lastSub?.server_id || activeServers[0].id;

  // We still need an inboundId, assuming same across servers for now
  const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
  const trafficLimitMb = 100 * 1024; // 100 GB default limit per device
  const limitBytes = trafficLimitMb * 1024 * 1024;

  let targetDevice: VpnDevice | undefined;

  if (forceNew || existingDevices.length === 0) {
    // 3A. CREATE NEW DEVICE(S)
    const devicesToCreate = forceNew ? 1 : (deviceLimit || 1);
    
    if (existingDevices.length + devicesToCreate > globalDeviceLimit) {
      return res.status(400).json({ error: `Превышен лимит: можно иметь не более ${globalDeviceLimit}-х устройств.` });
    }

    for (let i = 0; i < devicesToCreate; i++) {
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const email = `user_${userId.slice(0, 8)}_${randomSuffix}_${i}`;
      const uuid = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + durationDays);

      let configLines: string[] = [];
      let isFirstNodeValid = false;

      // Mirror client creation across ALL active servers
      for (const server of activeServers) {
        try {
          console.log(`🆕 Creating VPN client ${email} on server [${server.name}]...`);
          const { instance: xuiInstance } = await getXuiForServer(server.id);
          const rawConfig = await xuiInstance.addClient(email, uuid, inboundId, expiresAt.getTime(), limitBytes);
          
          if (!rawConfig || rawConfig.includes('security=none') || rawConfig.trim() === '') {
            console.error(`[VPN-02] Invalid config received for ${email} on ${server.name}`);
            continue;
          }
          
          // Append server name to remarks
          const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`);
          configLines.push(configWithSuffix);
          isFirstNodeValid = true;
        } catch (e: any) {
          console.error(`❌ Failed to propagate ${email} to server ${server.name}:`, e.message);
        }
      }

      if (!isFirstNodeValid) {
        throw new Error(`Не удалось получить валидный VPN конфиг ни с одного сервера. Обратитесь в поддержку.`);
      }

      const devLabelBase = deviceName || (existingDevices.length === 0 && i === 0 ? 'Основное' : 'Доп. устройство');
      const finalLabel = devicesToCreate > 1 ? `${devLabelBase} ${i + 1}` : devLabelBase;

      const newDevice: VpnDevice = {
        id: existingDevices.length === 0 ? 'primary' : `device_${uuid.slice(0,8)}`,
        label: finalLabel,
        config: configLines.join('\n'), // Combined Multi-Server config
        email: email,
        uuid: uuid,
        expiresAt: expiresAt.toISOString(),
        serverType: serverType || 'LTE',
        trafficUsedBytes: 0,
        serverId: activeServers[0].id // Keep first ID just for backward compatibility
      };
      existingDevices.push(newDevice);
      targetDevice = newDevice;
    }

  } else {
    // 3B. RENEW SPECIFIC OR MULTIPLE DEVICES
    const devicesToRenew = targetDeviceId 
      ? existingDevices.filter(d => d.id === targetDeviceId)
      : existingDevices.slice(0, deviceLimit || 1);
    
    if (devicesToRenew.length === 0) {
      return res.status(404).json({ error: 'Устройство для продления не найдено.' });
    }

    for (const tDevice of devicesToRenew) {
      const currentExpiry = new Date(tDevice.expiresAt);
      const newExpiresAt = currentExpiry > new Date() ? new Date(currentExpiry) : new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + durationDays);
      
      tDevice.expiresAt = newExpiresAt.toISOString();
      tDevice.serverType = serverType || tDevice.serverType;
      
      let configLines: string[] = [];

      // Mirror renewal across ALL active servers
      for (const server of activeServers) {
        try {
          console.log(`♻️ Syncing expiration for device ${tDevice.email} on server [${server.name}]`);
          const { instance: xuiInstance } = await getXuiForServer(server.id);
          const rawConfig = await xuiInstance.updateClient(tDevice.email, tDevice.uuid, inboundId, newExpiresAt.getTime(), limitBytes);
          
          if (rawConfig && !rawConfig.includes('security=none') && rawConfig.trim() !== '') {
            const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`);
            configLines.push(configWithSuffix);
          }
        } catch (e: any) {
          console.error(`❌ Failed to sync expiration for ${tDevice.email} on server ${server.name}:`, e.message);
        }
      }

      if (configLines.length > 0) {
        tDevice.config = configLines.join('\n'); // Update to latest unified config
      }
    }
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
      .update({
        amount: balanceData.amount - price,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (deductErr) {
      console.error('CRITICAL: Subscription processed but balance deduction failed!', deductErr);
    } else {
      // 6. Log withdrawal transaction
      const { error: txErr } = await supabase
        .from('transactions')
        .insert({
          user_id: userId,
          amount: price,
          currency: 'RUB',
          type: 'withdrawal',
          status: 'completed',
          description: `Продление/покупка подписки: ${planName}`
        });
      if (txErr) console.error('Failed to log withdrawal transaction:', txErr);
    }

    res.json({ success: true, subscription: subData, updatedDevice: targetDevice });

  } catch (error: any) {
    console.error('❌ Subscription purchase error details:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: error.details || error.hint || null
    });
  }
});

// Get user's own transaction history
app.get('/api/transactions', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth required' });

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(transactions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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
  
  const supportChannel = supabase
    .channel('support-realtime-unified')
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
            const { data: user } = await supabase.from('users').select('email').eq('id', newTicket.user_id).maybeSingle();
            const msg = `📨 <b>Новый чат поддержки!</b>\n\n` +
                        `👤 <b>От:</b> ${user?.email || 'Пользователь'}\n` +
                        `💬 <b>Сообщение:</b> ${newTicket.message}\n\n` +
                        `<i>ID Тикета: ${newTicket.id}</i>\n` + // BUG-04: unified format for regex
                        `----------\n` +
                        `ОТВЕТЬТЕ на это сообщение, чтобы отправить ответ в чат.`;
            await bot.telegram.sendMessage(botAdminId, msg, { parse_mode: 'HTML' });
          } catch (e) {
            console.error('Error sending ticket to admin TG', e);
          }
        }
      }
    )
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
             const {data: t} = await supabase.from('support_tickets').select('user_id').eq('id', newMessage.ticket_id).maybeSingle();
             if (t) {
               const {data: u} = await supabase.from('users').select('email').eq('id', t.user_id).maybeSingle();
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
          const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
          if (activeServers && activeServers.length > 0) {
            let devices = parseVpnDevices(newData.v2ray_config, newData.expires_at, newData.server_type);
            const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
            const expiryTimestamp = new Date(newData.expires_at).getTime();
            const trafficLimitMb = newData.traffic_limit_mb || 102400;
            const limitBytes = trafficLimitMb * 1024 * 1024;
            
            for (const server of activeServers) {
              try {
                const { instance: xuiInstance } = await getXuiForServer(server.id);
                for (const device of devices) {
                  if (device.uuid && device.email) {
                    await xuiInstance.updateClient(device.email, device.uuid, inboundId, expiryTimestamp, limitBytes);
                  }
                }
              } catch (e: any) {
                console.error(`❌ Failed to sync DB manual update to ${server.name}:`, e.message);
              }
            }
          }
        }
      }
    )
    .subscribe((status) => {
      console.log(`📡 [Realtime] Unified Channel Status: ${status}`);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('📡 Realtime connection lost. Reconnecting in 5s...');
        setTimeout(() => {
          supabase.removeChannel(supportChannel);
          setupRealtimeListener();
        }, 5000);
      }
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

  // Fetch all active servers
  const { data: activeServers } = await supabase
    .from('vpn_servers')
    .select('*')
    .eq('is_active', true);

  if (!activeServers || activeServers.length === 0) return sub;

  // 2. Identify all devices by parsing VpnDevice JSON
  const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);

  let totalUsedBytes = 0;
  let maxLimitBytes = 0;

  // 3. Fetch stats for all devices across all servers
  for (const device of devices) {
    let deviceUsedBytes = 0;
    
    for (const server of activeServers) {
      try {
        const { instance } = await getXuiForServer(server.id);
        const stats = await instance.getClientTraffic(device.email);
        if (stats) {
          deviceUsedBytes += stats.used;
          maxLimitBytes = Math.max(maxLimitBytes, stats.limit);
        }
      } catch (e) {
        // Skip errors silently to not bloat logs
      }
    }
    
    device.trafficUsedBytes = deviceUsedBytes;
    totalUsedBytes += deviceUsedBytes;
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
    // 1. Get all potentially active subscriptions (status matches)
    const { data: subs, error } = await supabase
      .from('subscriptions')
      .select('user_id')
      .eq('status', 'active'); 

    if (error) throw error;
    if (!subs || subs.length === 0) return;

    // Use a Set to avoid duplicate syncs if a user somehow has multiple active subs
    const userIds = Array.from(new Set(subs.map(s => s.user_id)));

    // BUG-06: Batch processing (concurrency control) to avoid event loop blockage
    const BATCH_SIZE = 5;
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(uid => syncUserTraffic(uid)));
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
      .maybeSingle(); // BUG-11: avoiding PGRST116 noise

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

let botLaunchPromise: Promise<void> | null = null;

async function launchBot(retries = 10): Promise<void> {
  if (botLaunchPromise) return botLaunchPromise;
  
  botLaunchPromise = (async () => {
    try {
      console.log('🤖 Telegram Bot: Starting launch sequence...');
      
      // Always clear webhook and drop pending updates to prevent 409 and spam
      console.log('🤖 Telegram Bot: Clearing webhook and dropping pending updates...');
      try {
        await bot!.telegram.deleteWebhook({ drop_pending_updates: true });
      } catch (e: any) {
        console.warn('⚠️ Telegram Bot: Failed to delete webhook during launch:', e.message);
      }
      
      // Small delay to let Telegram settle
      const settlementDelay = 5000; 
      console.log(`🤖 Telegram Bot: Waiting ${settlementDelay/1000}s for settlement...`);
      await new Promise(resolve => setTimeout(resolve, settlementDelay));
      
      await bot!.launch({
        allowedUpdates: ['message', 'callback_query'],
        dropPendingUpdates: true
      });
      
      console.log('✅ Telegram Bot: Started successfully');
    } catch (err: any) {
      if (err.response?.error_code === 409) {
        if (retries > 0) {
          const delay = 30000; 
          console.warn(`⚠️ Telegram Bot: Conflict (409). Another instance is active. Retrying in ${delay/1000}s... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, delay));
          botLaunchPromise = null; 
          botLaunchPromise = launchBot(retries - 1); // BUG-08: fixed race by assigning new promise
          return botLaunchPromise;
        } else {
          console.error('❌ Telegram Bot: Launch failed. Conflict 409 persists.');
        }
      } else {
        console.error('❌ Telegram Bot: Launch failed with unexpected error:', err.message || err);
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 10000));
          botLaunchPromise = null;
          botLaunchPromise = launchBot(retries - 1);
          return botLaunchPromise;
        }
      }
      botLaunchPromise = null;
    }
  })();

  return botLaunchPromise;
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

      const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: userData.email,
        options: { redirectTo: `${process.env.APP_URL || 'https://izinet.app'}/dashboard` }
      });

      if (linkErr) throw linkErr;

      return ctx.reply('🔑 Нажмите для входа:', {
        reply_markup: { inline_keyboard: [[{ text: '🚀 Войти', url: linkData.properties.action_link }]] }
      });
    } catch (e) {
      return ctx.reply('❌ Ошибка входа.');
    }
  }
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
    ctx.reply('🎧 Вы перешли в режим поддержки.\nНапишите ваш вопрос следующим сообщением, и наш администратор ответит вам здесь же.');
  });

  bot.action('action_password', async (ctx) => {
    ctx.answerCbQuery();
    if (!ctx.chat) return;
    botSessions.set(ctx.chat.id, { state: 'password' });
    ctx.reply('🔑 Введите новый пароль для вашего аккаунта (минимум 8 символов):');
  });

  bot.action('action_help', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply('❓ Инструкция:\n1. Скачайте приложение Hiddify или V2Ray.\n2. В личном кабинете на сайте скопируйте ссылку подписки.\n3. Вставьте ссылку в приложение.\n\nЕсли возникли сложности — напишите в поддержку.');
  });

  bot.action('action_menu', (ctx) => {
    ctx.answerCbQuery();
    return showMainMenu(ctx);
  });

  bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    if (botAdminId && chatId.toString() === botAdminId.toString()) {
      const replyToMsg = ctx.message.reply_to_message;
      if (replyToMsg) {
        const originalChatId = adminReplyMap.get(replyToMsg.message_id);
        if (originalChatId) {
          try {
            await ctx.telegram.sendMessage(originalChatId, `💬 Сообщение от поддержки:\n\n${text}`);
            return ctx.reply('✅ Ответ отправлен.');
          } catch(e) {
            return ctx.reply('❌ Ошибка отправки.');
          }
        }
        if ('text' in replyToMsg && replyToMsg.text) {
          const match = replyToMsg.text.match(/ID Тикета:\s*([a-f0-9\-]+)/i);
          if (match && match[1]) {
            try {
              await supabase.from('support_messages').insert({
                ticket_id: match[1],
                sender: 'admin',
                content: text
              });
              return ctx.reply('✅ Ответ в тикет доставлен.');
            } catch(e) {
              return ctx.reply('❌ Ошибка БД.');
            }
          }
        }
      }
    }

    const session = botSessions.get(chatId);
    if (session?.state === 'support') {
      if (!botAdminId) return ctx.reply('Поддержка недоступна.');
      try {
        const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
        const sentMsg = await ctx.telegram.sendMessage(botAdminId, `🆘 Вопрос от ${username} (${chatId}):\n\n${text}`);
        adminReplyMap.set(sentMsg.message_id, chatId);
        ctx.reply('✅ Сообщение отправлено.');
      } catch (e) {
         ctx.reply('❌ Ошибка отправки.');
      }
      return;
    }

    if (session?.state === 'password') {
      if (text.length < 8) return ctx.reply('⚠️ Пароль короткий.');
      try {
        const { data: user } = await supabase.from('users').select('id').eq('telegram_id', chatId.toString()).maybeSingle();
        if (!user) return ctx.reply('❌ Аккаунт не привязан к вашему Telegram.');
        if (!user) return ctx.reply('Аккаунт не найден.');
        await supabase.auth.admin.updateUserById(user.id, { password: text });
        botSessions.delete(chatId);
        ctx.reply('✅ Пароль изменен!', { reply_markup: { inline_keyboard: [[{ text: '◀️ В меню', callback_data: 'action_menu' }]] } });
      } catch (e) {
        ctx.reply('❌ Ошибка.');
      }
      return;
    }

    ctx.reply('Используйте меню.', { reply_markup: { inline_keyboard: [[{ text: '◀️ В меню', callback_data: 'action_menu' }]] } });
  });
}

// --- Lifecycle ---

async function startServer() {
  const isProd = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "production_docker";
  console.log(`🚀 Starting izinet server... (Mode: ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'})`);
  
  // DNS Diagnostics
  try {
    const dns = await import('node:dns/promises');
    const result = await dns.resolve('google.com');
    console.log('🌐 DNS Check: OK (google.com resolved)');
  } catch (dnsErr) {
    console.error('❌ DNS Check: FAILED. Containers might not have internet access or DNS is blocked.');
  }

  try {
    const { data: servers, error: dbErr } = await supabase.from('vpn_servers').select('id, name').eq('is_active', true);
    if (dbErr) {
      console.error('❌ Supabase connection error:', dbErr.message);
    } else if (servers) {
      console.log(`📡 Connected to Supabase. Found ${servers.length} active servers.`);
      for (const s of servers) {
        getXuiForServer(s.id).then(({instance}) => instance.checkConfig());
      }
    }
  } catch (err) {
    console.error('❌ Startup error:', err);
  }
  
  // BUG-07: Ensure PUBLIC_URL is set for stable sub links
  if (!process.env.PUBLIC_URL && isProd) {
    console.warn('⚠️ WARNING: PUBLIC_URL environment variable is not set! Subscription links may be unstable or broken.');
  }

  setupRealtimeListener();
  syncTrafficStats();
  setInterval(syncTrafficStats, 15 * 60 * 1000);

  if (bot) launchBot();

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.url.startsWith('/api')) return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server started on port ${PORT}`);
    console.log(`🌍 Public URL: ${process.env.PUBLIC_URL || 'Not Set'}`);
  });
}

startServer();

if (bot) {
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
