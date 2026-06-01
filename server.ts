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
import { exec } from 'child_process';
import fs from 'fs';
import dns from 'node:dns/promises';
import net from 'node:net';
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
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      ...headers
    },
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
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false
  }
});

// 🔍 Startup health check for Database
async function checkDatabase() {
  try {
    const { count, error } = await supabase.from('vpn_servers').select('*', { count: 'exact', head: true });
    if (error) {
      console.error('❌ Database connection error on startup:', error.message);
    } else {
      console.log('✅ Database connected successfully. Active servers in table:', count || 0);
    }
  } catch (err) {
    console.error('❌ Failed to connect to database:', err);
  }
}
checkDatabase();

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

// 🔍 Diagnostic logging for API and Page requests
app.use((req, res, next) => {
  const isExcluded = req.path.includes('health') || req.path.includes('.ico') || req.path.includes('.png');
  if (!isExcluded) {
    console.log(`[REQ] ${new Date().toISOString()} | ${req.method} ${req.path} 
      | Host: ${req.get('host')} 
      | SNI/OriginalHost: ${req.get('x-forwarded-host') || 'N/A'}
      | X-Forwarded-Proto: ${req.get('x-forwarded-proto') || 'http'}
      | Real-IP: ${req.get('x-real-ip') || req.ip}
      | CF-IP: ${req.get('cf-connecting-ip') || 'N/A'}`);
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
  private csrfToken: string | null = null;
  private readonly SESSION_TTL = 2 * 60 * 1000; // 2 minutes cache for session cookie (VPN-04: Fresher sessions)

  constructor(serverConfigs?: { host?: string, username?: string, password?: string }) {
    // Priority: 1. Passed configs, 2. Database (handled by caller), 3. Environment (fallback for legacy/default)
    let host = (serverConfigs?.host || process.env.XUI_HOST || '').trim();

    if (host && !host.startsWith('http://') && !host.startsWith('https://')) {
      host = 'http://' + host;
    }

    // Set a default display domain based on the host before we potentially rewrite it for internal Docker net
    try {
      if (host) {
        const url = new URL(host);
        this.displayDomain = url.hostname;
      }
    } catch (_) {}

    // Internal routing optimization:
    // If the server connects to the LOCAL server, we talk directly to '127.0.0.1' on the host network.
    // This solves loopback blocks (NAT loopback), port blockage, and UFW issues perfectly.
    if (host) {
      try {
        const parsedUrl = new URL(host);
        const hn = parsedUrl.hostname;
        // Strict exact match to avoid breaking secondary servers (e.g. one.izinet.online)
        if (hn === '194.50.94.28' || hn === 'izinet.online' || hn === 'vpn.izinet.online' || hn === 'localhost' || hn === '127.0.0.1') {
          const originalHost = host;
          const port = parsedUrl.port || '2053';
          const isDocker = fs.existsSync('/.dockerenv');
          if (isDocker) {
            host = `http://x3-ui:2053${parsedUrl.pathname}`;
            console.log(`[XUI Router] Optimized local routing: rewritten ${originalHost} -> to internal docker path: ${host}`);
          } else {
            host = `http://127.0.0.1:${port}${parsedUrl.pathname}`;
            console.log(`[XUI Router] Optimized local routing: rewritten ${originalHost} -> to internal host path: ${host}`);
          }
        }
      } catch (e) {
        console.error(`[XUI Router] Error parsing URL for local routing optimization:`, e);
      }
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
    
    let lastError: any = null;

    const tryLogin = async (path: string, csrfData?: { token: string, cookieStr: string }) => {
      const url = `${this.host}${this.basePath}${path}`;
      const payload = `username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
      const jsonPayload = { username: this.username, password: this.password };

      let customHeaders: any = {};
      if (csrfData) {
         customHeaders['X-CSRF-Token'] = csrfData.token;
         if (csrfData.cookieStr) customHeaders['Cookie'] = csrfData.cookieStr;
      }

      try {
        // Try form-urlencoded first (default for most 3x-ui)
        const response = await axios.post(url, payload, getRequestConfig(url, { 'Content-Type': 'application/x-www-form-urlencoded', ...customHeaders }));
        if (csrfData && csrfData.cookieStr) {
           response.headers['x-passed-cookie'] = csrfData.cookieStr;
        }
        return response;
      } catch (err: any) {
        lastError = err;
        
        // Return null to continue trying other paths unless we know for sure we should stop
        // We will no longer throw on 403 immediately because a wrong path might return 403
        
        // Try JSON if not successful
        try {
          const response = await axios.post(url, jsonPayload, getRequestConfig(url, customHeaders));
          if (csrfData && csrfData.cookieStr) {
             response.headers['x-passed-cookie'] = csrfData.cookieStr;
          }
          return response;
        } catch (innerErr: any) {
          lastError = innerErr;
          return null; // Return null so the next path can be tried
        }
      }
    };

    try {
      // Step 1: Pre-flight to get potential Session Cookies & CSRF Token
      let csrfToken = '';
      let cookies: string[] = [];
      try {
        const rootUrl = `${this.host}${this.basePath}/`;
        const rootRes = await axios.get(rootUrl, getRequestConfig(rootUrl, {}, 5000));
        if (rootRes.headers['set-cookie']) {
          cookies = cookies.concat(rootRes.headers['set-cookie']);
        }
        const csrfUrl = `${this.host}${this.basePath}/csrf-token`;
        const csrfRes = await axios.get(csrfUrl, getRequestConfig(csrfUrl, { Cookie: cookies.join(';') }, 5000));
        if (csrfRes.data && csrfRes.data.success && csrfRes.data.obj) {
           csrfToken = csrfRes.data.obj;
        }
        if (csrfRes.headers['set-cookie']) {
           cookies = cookies.concat(csrfRes.headers['set-cookie']);
        }
      } catch (e) {
        // CSRF endpoint might not exist on older versions, just ignore
      }

      const csrfData = csrfToken ? { token: csrfToken, cookieStr: cookies.join(';') } : undefined;

      // 3x-ui almost universally uses /login. Trying others blindly triggers rate limits.
      let response = await tryLogin('/login', csrfData);
      if (!response) response = await tryLogin('', csrfData); // Some custom setups might proxy right to root
      if (!response) response = await tryLogin('/panel/login', csrfData);

      
      if (!response) {
        let msg = `Could not find login endpoint at ${this.host}${this.basePath}.`;
        if (lastError?.response?.status === 403) {
           msg = `Login blocked (403 Forbidden). Rate limit/Fail2Ban active, or WAF blocking. Wait 5-15 mins or check IP whitelist.`;
        } else if (lastError?.message) {
           msg = `Login failed. HTTP ${lastError.response?.status || 'Error'} - ${lastError.message}`;
        }
        throw new Error(msg);
      }
      
      if (response.data && response.data.success === false) {
        throw new Error(response.data.msg || 'Login failed');
      }

      const cookie = response.headers['set-cookie']?.[0] || response.headers['x-passed-cookie'];
      if (!cookie) throw new Error('No cookie received from 3x-ui. Check if host URL is correct and starts with http/https.');
      this.sessionCookie = cookie;
      if (csrfData && csrfData.token) {
         this.csrfToken = csrfData.token;
      }
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

  authHeaders(extra: any = {}) {
    const headers: any = { ...extra };
    if (this.sessionCookie) headers['Cookie'] = this.sessionCookie;
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    return headers;
  }

  async checkHealth(): Promise<boolean> {
    if (!this.host) throw new Error('Host is not configured');
    
    // Utilize getInbounds which already handles session caching and 401 retries
    await this.getInbounds();
    return true;
  }

  // Routing and settings
  async getSettings() {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/setting/all`;
      const resp = await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
      return resp.data.obj;
    } catch (e: any) {
      if (e.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.getSettings();
      }
      throw e;
    }
  }

  async updateSettings(settingsData: any) {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/setting/update`;
      const encodedData = new URLSearchParams();
      for (const key in settingsData) {
        if (typeof settingsData[key] === 'object') {
          encodedData.append(key, JSON.stringify(settingsData[key]));
        } else {
          encodedData.append(key, settingsData[key]);
        }
      }
      const resp = await axios.post(url, encodedData.toString(), {
        ...getRequestConfig(url, this.authHeaders()),
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        }
      });
      return resp.data;
    } catch (e: any) {
      if (e.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.updateSettings(settingsData);
      }
      throw e;
    }
  }

  async restartPanel() {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/setting/restartPanel`;
      const resp = await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
      return resp.data;
    } catch (e) {
      // 3x-ui drops connection on restart, handle gracefully
      return { success: true };
    }
  }

  async getInbounds() {
    if (!this.sessionCookie) await this.login();
    try {
      const listUrl = `${this.host}${this.basePath}/panel/api/inbounds/list`;
      const resp = await axios.get(listUrl, getRequestConfig(listUrl, this.authHeaders()));
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
      const listResp = await axios.get(`${this.host}${this.basePath}/panel/api/inbounds/list`, getRequestConfig(`${this.host}${this.basePath}/panel/api/inbounds/list`, this.authHeaders()));
      if (listResp.data.success && listResp.data.obj?.length > 0) {
        // Find vless inbound or fallback to provided ID
        inbound = listResp.data.obj.find((i: any) => i.protocol === 'vless') || listResp.data.obj.find((i: any) => i.id === inboundId) || listResp.data.obj[0];
        inboundId = inbound.id; // Correct the inboundId dynamically
        const streamSettings = JSON.parse(inbound.streamSettings || '{}');
        if (streamSettings.security === 'reality') {
          flow = "xtls-rprx-vision";
        }
      }
    } catch (e: any) {
      console.warn(`Could not fetch dynamic inbound from ${this.host}${this.basePath}, using fallback ID ${inboundId}.`);
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
        getRequestConfig(addClientUrl, this.authHeaders({ 
          'Content-Type': 'application/json'
        }))
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
    let inbound = null;

    try {
      const getInboundUrl = `${this.host}${this.basePath}/panel/api/inbounds/get/${effectiveInboundId}`;
      const resp = await axios.get(getInboundUrl, getRequestConfig(getInboundUrl, this.authHeaders(), 10000));
      if (resp.data.success && resp.data.obj) {
        inbound = resp.data.obj;
      }
    } catch (e) {}

    if (!inbound) {
      // Fallback: fetch all and find vless
      try {
        const listResp = await axios.get(`${this.host}${this.basePath}/panel/api/inbounds/list`, getRequestConfig(`${this.host}${this.basePath}/panel/api/inbounds/list`, this.authHeaders(), 10000));
        if (listResp.data.success && listResp.data.obj?.length > 0) {
           inbound = listResp.data.obj.find((i: any) => i.protocol === 'vless') || listResp.data.obj[0];
           effectiveInboundId = inbound.id;
        }
      } catch (e) {}
    }

    if (!inbound) {
      throw new Error(`[XUI] Не удалось получить настройки входящего соединения (даже динамически) с сервера ${this.host}.`);
    }
    
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
      const resp = await axios.get(getInboundUrl, getRequestConfig(getInboundUrl, this.authHeaders()));
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
      const resp = await axios.get(getInboundUrl, getRequestConfig(getInboundUrl, this.authHeaders()));
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
        getRequestConfig(updateClientUrl, this.authHeaders({ 
          'Content-Type': 'application/json'
        }))
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
      const response = await axios.get(url, getRequestConfig(url, this.authHeaders()));

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
      const response = await axios.post(deleteUrl, {}, getRequestConfig(deleteUrl, this.authHeaders()));
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
      const response = await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
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
  let domainOrPath = (server.domain || '').trim();
  let host = "";

  if (rawIp.includes('://')) {
    host = rawIp;
    // If rawIp is just http://ip:port without path, and domain is a secret path, append it
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
    // If rawIp contains a path (e.g. 1.2.3.4/secret), split it
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
        // Likely a secret path provided without a leading slash (e.g. "LZ6dkLpY4gzESk")
        pathPart = '/' + domainOrPath;
      } else {
        // It's a domain (e.g. vpn.example.com), use it as the base host to connect
        ipPart = domainOrPath;
      }
    }

    // If ipPart contains a port (e.g. 1.2.3.4:443), use it
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
      expire: 3600
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

  async checkEnotStatus(invoiceId: string) {
    const { merchantId, secretKey } = await this.getEnotConfig();

    const payload = {
      invoice_id: invoiceId,
      shop_id: merchantId
    };

    console.log(`[Enot.io] Checking status for invoice: ${invoiceId} in shop: ${merchantId}`);

    const response = await axios.post('https://api.enot.io/invoice/info', payload, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': secretKey
      },
      timeout: 10000,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true
    });

    console.log('[Enot.io] Status check response:', JSON.stringify(response.data));

    if (response.data && response.data.status_check) {
      const info = response.data.data;
      return {
        enotStatus: info?.status || 'unknown',
        amount: info?.amount,
        enotResponse: response.data
      };
    } else {
      const errorMsg = response.data?.error || response.data?.message || 'Enot.io API error';
      return {
        enotStatus: 'error',
        message: typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg),
        enotResponse: response.data
      };
    }
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
  console.log(`[AdminAuth][${requestId}] Verifying token: ${token.substring(0, 15)}...`);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);

  if (authErr || !user) {
    console.warn(`[AdminAuth][${requestId}] ❌ Invalid token:`, authErr?.message, authErr?.status);
    return res.status(401).json({ 
      error: 'Invalid Session', 
      message: 'Сессия истекла. Пожалуйста, войдите снова.' 
    });
  }

  // Safeguard: Hardcoded bypass to guarantee the master administrator has immediate superadmin panel access
  if (user.email === 'enverphoto@gmail.com') {
    console.log(`[AdminAuth][${requestId}] 🛡️ Safeguard: Master admin email detected, bypassing role DB checks`);
    req.user = { ...user, role: 'superadmin' };
    return next();
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
  if (error || !user) {
    console.error('[AuthError]', error?.message || 'No user', 'Token prefix:', token.substring(0, 10));
    return res.status(401).json({ error: 'Unauthorized', message: error?.message });
  }
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
      } catch (e: any) {
        return { id: s.id, online: false, error: e.message };
      }
    }));
    
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function syncAllRoutingToAllPanels() {
  console.log('🔄 [System] Synchronizing vpn_routing_rules and Xray Config to all XUI servers...');
  try {
    // 1. Ensure default rules exist by name check and clean legacy unstable geosite entries
    const { data: geminiRule, error: checkErr1 } = await supabase.from('vpn_routing_rules').select('*').eq('name', 'Gemini / Google Services').maybeSingle();
    const safeGeminiDomains = [
      'geosite:google',
      'geosite:openai',
      'domain:ai.com',
      'domain:anthropic.com',
      'domain:claude.ai',
      'domain:aistudio.google.com',
      'domain:gemini.google.com',
      'domain:makersuite.google.com',
      'domain:openai.com'
    ];

    if (!checkErr1) {
       if (!geminiRule) {
          console.log('📦 Setup default Gemini / Google Services routing rule...');
          await supabase.from('vpn_routing_rules').insert([
            { name: 'Gemini / Google Services', domains: safeGeminiDomains, outbound_tag: 'ipv6-out', is_active: true }
          ]);
       } else if (geminiRule.domains && (geminiRule.domains.includes('geosite:gemini') || geminiRule.domains.includes('geosite:anthropic'))) {
          console.log('🔄 Cleaning up Gemini / Google Services rule in DB (removing unstable geosite markers)...');
          await supabase.from('vpn_routing_rules').update({
            domains: safeGeminiDomains
          }).eq('id', geminiRule.id);
       }
    }

    const safeRuDomains = [
      'domain:ru',
      'domain:su',
      'domain:xn--p1ai',
      'domain:vk.com',
      'domain:vk.ru',
      'domain:yandex.ru',
      'domain:mail.ru',
      'domain:gosuslugi.ru',
      'domain:sberbank.ru',
      'domain:tbank.ru',
      'domain:tinkoff.ru'
    ];

    const { data: ruRule, error: checkErr2 } = await supabase.from('vpn_routing_rules').select('*').eq('name', 'Russia Bypass (GeoIP + GeoSite)').maybeSingle();
    if (!checkErr2) {
       if (!ruRule) {
          console.log('📦 Setup default Russia Bypass routing rule...');
          await supabase.from('vpn_routing_rules').insert([
            { name: 'Russia Bypass (GeoIP + GeoSite)', domains: safeRuDomains, ips: ['geoip:ru'], outbound_tag: 'direct', is_active: true }
          ]);
       } else if (ruRule.domains && ruRule.domains.includes('geosite:ru')) {
          console.log('🔄 Cleaning up Russia Bypass rule in DB (replacing geosite:ru with safe domain matchers)...');
          await supabase.from('vpn_routing_rules').update({
            domains: safeRuDomains
          }).eq('id', ruRule.id);
       }
    }

    const { data: rules, error: rulesErr } = await supabase.from('vpn_routing_rules').select('*').eq('is_active', true);
    if (rulesErr) throw rulesErr;

    const newRules = (rules || []).map(r => {
      const xrayRule: any = { type: "field", outboundTag: r.outbound_tag };
      if (r.domains && r.domains.length > 0) {
        const resolvedDomains: string[] = [];
        for (const d of r.domains) {
          if (d === 'geosite:gemini' || d === 'geosite:anthropic') {
            continue; // Skip unstable domains already covered
          }
          if (d === 'geosite:ru') {
            // Unpack geosite:ru to safe string matchers
            resolvedDomains.push('domain:ru', 'domain:su', 'domain:xn--p1ai');
          } else {
            resolvedDomains.push(d);
          }
        }
        if (resolvedDomains.length > 0) {
          xrayRule.domain = resolvedDomains;
        }
      }
      if (r.ips && r.ips.length > 0) xrayRule.ip = r.ips;
      return xrayRule; 
    });

    const { data: activeServers, error: serverErr } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    if (serverErr) throw serverErr;

    const results = [];
    for (const server of (activeServers || [])) {
      try {
        if (server.xui_config_state && typeof server.xui_config_state === 'object' && server.xui_config_state.routing_sync_disabled) {
          console.log(`[Sync Routing] Server ${server.name} has routing sync disabled. Skipping.`);
          results.push({ server: server.name, success: true, skipped: true, message: 'Синхронизация отключена в настройках' });
          continue;
        }
        console.log(`Syncing routing and Xray Config to ${server.name}...`);
        const { instance: xuiInstance } = await getXuiForServer(server.id);
        const headers = { headers: { ...xuiInstance.authHeaders(), Cookie: xuiInstance['sessionCookie'] } };
        
        // 1. GET Current Xray Settings
        const xrayR = await import('axios').then(a => a.default.post(`${xuiInstance['host']}${xuiInstance['basePath']}/panel/xray/`, {}, headers));
        if (!xrayR.data?.success) throw new Error("Failed to fetch Xray config");
        const parsedObj = JSON.parse(xrayR.data.obj);
        let xrayConfig = parsedObj.xraySetting;
        
        // Ensure ipv6-out exists or update it for Gemini/aistudio bypass with safe dual-stack fallback
        if (!xrayConfig.outbounds) xrayConfig.outbounds = [];
        const ipv6OutIndex = xrayConfig.outbounds.findIndex((o: any) => o.tag === 'ipv6-out');
        if (ipv6OutIndex === -1) {
          xrayConfig.outbounds.push({
            tag: "ipv6-out",
            protocol: "freedom",
            settings: { domainStrategy: "UseIP" }
          });
        } else {
          // For existing servers, upgrade from UseIPv6/Direct to UseIP so it falls back gracefully
          xrayConfig.outbounds[ipv6OutIndex].settings = {
            ...(xrayConfig.outbounds[ipv6OutIndex].settings || {}),
            domainStrategy: "UseIP"
          };
        }
        
        // 2. Modify Routing
        if (!xrayConfig.routing) xrayConfig.routing = {};
        if (!xrayConfig.routing.rules) xrayConfig.routing.rules = [];
        xrayConfig.routing.rules = xrayConfig.routing.rules.filter((r: any) => !r.izinet_managed);
        
        const finalRules = newRules.map(r => ({ ...r, izinet_managed: true }));
        xrayConfig.routing.rules = [...finalRules, ...xrayConfig.routing.rules];
        
        // 3. POST Back to Xray Update
        const updatePayload = new URLSearchParams();
        updatePayload.append("xraySetting", JSON.stringify(xrayConfig));
        if (parsedObj.outboundTestUrl) updatePayload.append("outboundTestUrl", parsedObj.outboundTestUrl);
        
        const updateR = await import('axios').then(a => a.default.post(`${xuiInstance['host']}${xuiInstance['basePath']}/panel/xray/update`, updatePayload.toString(), headers));
        if (!updateR.data?.success) throw new Error(updateR.data?.msg || "Update failed");

        await xuiInstance.restartPanel();
        
        results.push({ server: server.name, success: true });
      } catch (e: any) {
        console.error(`Failed to sync routing to ${server.name}:`, e.message || e);
        results.push({ server: server.name, success: false, error: e.message });
      }
    }
    return results;
  } catch (error: any) {
    console.error('Failed to sync system routing:', error);
    return [];
  }
}

app.post('/api/admin/system/sync-routing', adminOnly, async (req, res) => {
  try {
    const results = await syncAllRoutingToAllPanels();
    res.json({ success: true, results });
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

// VPS Diagnostics and Repair endpoints
app.post('/api/admin/system/repair-vless', adminOnly, async (req, res) => {
  console.log('🛠️ [AdminAPI] Starting Repair VLESS/Reality Coexistence...');
  
  let scriptPath = './repair_xui.py';
  if (fs.existsSync('/opt/izinet/repair_xui.py')) {
    scriptPath = 'python3 /opt/izinet/repair_xui.py';
  } else if (fs.existsSync('./repair_xui.py')) {
    scriptPath = 'python3 ./repair_xui.py';
  } else {
    return res.status(404).json({ error: 'Скрипт repair_xui.py не найден на сервере' });
  }

  // Set 120 seconds timeout and 10MB buffer limit
  exec(scriptPath, { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    console.log('[AdminAPI] Repair completed.');
    res.json({
      success: !error,
      stdout: stdout || '',
      stderr: stderr || '',
      message: error ? 'Ремонт завершился с ошибками' : 'Автодиагностика и автонастройка Reality + Nginx выполнена успешно!'
    });
  });
});

app.post('/api/admin/system/diagnose-vps', adminOnly, async (req, res) => {
  console.log('🔍 [AdminAPI] Starting VPS diagnostics...');
  
  let scriptPath = './diagnose.sh';
  if (fs.existsSync('/opt/izinet/diagnose.sh')) {
    scriptPath = 'bash /opt/izinet/diagnose.sh';
  } else if (fs.existsSync('./diagnose.sh')) {
    scriptPath = 'bash ./diagnose.sh';
  } else {
    return res.status(404).json({ error: 'Скрипт diagnose.sh не найден на сервере' });
  }

  // Set 120 seconds timeout and 10MB buffer limit
  exec(scriptPath, { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    console.log('[AdminAPI] Diagnostics completed.');
    res.json({
      success: !error,
      stdout: stdout || '',
      stderr: stderr || '',
      message: error ? 'Диагностика завершилась с предупреждениями' : 'Диагностика сервера выполнена успешно!'
    });
  });
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

// Helper to get Cloudflare authentication headers from DB (with process.env fallbacks)
async function getCloudflareHeaders() {
  const { data: dbSettings } = await supabase.from('settings').select('*');
  const settingsMap: Record<string, string> = {};
  dbSettings?.forEach((s: any) => settingsMap[s.key] = s.value);

  const token = (settingsMap['CLOUDFLARE_API_TOKEN'] || process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const email = (settingsMap['CLOUDFLARE_EMAIL'] || process.env.CLOUDFLARE_EMAIL || '').trim();
  const apiKey = (settingsMap['CLOUDFLARE_API_KEY'] || process.env.CLOUDFLARE_API_KEY || '').trim();

  if (token) {
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  } else if (email && apiKey) {
    return {
      'X-Auth-Email': email,
      'X-Auth-Key': apiKey,
      'Content-Type': 'application/json'
    };
  } else {
    throw new Error('Учётные данные Cloudflare не настроены. Пожалуйста, укажите API Токен или Email + Global API Key в настройках.');
  }
}

// Cloudflare Integration Endpoints
app.get('/api/admin/cloudflare/zones', adminOnly, async (req, res) => {
  try {
    const headers = await getCloudflareHeaders();
    console.log('🌐 [Cloudflare] Fetching zones list...');
    const response = await axios.get('https://api.cloudflare.com/client/v4/zones?per_page=50', { headers, timeout: 10000 });
    
    if (!response.data || !response.data.success) {
      throw new Error(response.data?.errors?.[0]?.message || 'Ошибка интеграции Cloudflare API');
    }

    const zones = response.data.result.map((z: any) => ({
      id: z.id,
      name: z.name,
      status: z.status
    }));

    res.json(zones);
  } catch (err: any) {
    console.error('❌ [Cloudflare] Error getting zones:', err.response?.data || err.message);
    const apiError = err.response?.data?.errors?.[0]?.message || err.message;
    res.status(500).json({ error: apiError });
  }
});

app.post('/api/admin/cloudflare/bind', adminOnly, async (req, res) => {
  const { zoneId, domain, ip, proxied, serverId } = req.body;

  if (!zoneId || !domain || !ip) {
    return res.status(400).json({ error: 'Необходимы параметры: zoneId, domain, ip' });
  }

  try {
    const headers = await getCloudflareHeaders();
    const cleanDomain = domain.trim().toLowerCase();
    const cleanIp = ip.trim();

    console.log(`🌐 [Cloudflare] Checking existing DNS record for domain: ${cleanDomain}...`);

    // Check if there is an existing A record
    const listUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=A&name=${cleanDomain}`;
    const listResp = await axios.get(listUrl, { headers, timeout: 10000 });
    
    if (!listResp.data || !listResp.data.success) {
      throw new Error(listResp.data?.errors?.[0]?.message || 'Не удалось получить DNS записи с Cloudflare');
    }

    const records = listResp.data.result;
    let dnsResult;

    if (records.length > 0) {
      const recordId = records[0].id;
      console.log(`🌐 [Cloudflare] Updating existing DNS A record ${recordId} to ${cleanIp}...`);
      const updateResp = await axios.put(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`,
        {
          type: 'A',
          name: cleanDomain,
          content: cleanIp,
          ttl: 1, // Auto
          proxied: !!proxied
        },
        { headers, timeout: 10000 }
      );
      dnsResult = updateResp.data;
    } else {
      console.log(`🌐 [Cloudflare] Creating new DNS A record for ${cleanDomain} pointing to ${cleanIp}...`);
      const createResp = await axios.post(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
        {
          type: 'A',
          name: cleanDomain,
          content: cleanIp,
          ttl: 1, // Auto
          proxied: !!proxied
        },
        { headers, timeout: 10000 }
      );
      dnsResult = createResp.data;
    }

    if (!dnsResult || !dnsResult.success) {
      throw new Error(dnsResult?.errors?.[0]?.message || 'Не удалось сохранить запись в Cloudflare');
    }

    // If serverId is provided, automatically update the domain inside the database!
    if (serverId) {
      console.log(`🌐 [Cloudflare] Associating domain ${cleanDomain} with VPN Server ID ${serverId}...`);
      const { error: srvErr } = await supabase
        .from('vpn_servers')
        .update({ domain: cleanDomain })
        .eq('id', serverId);

      if (srvErr) {
        throw new Error(`DNS изменен, но не удалось обновить домен сервера в базе данных: ${srvErr.message}`);
      }
    }

    res.json({
      success: true,
      message: `Домен ${cleanDomain} успешно привязан к IP ${cleanIp}! DNS запись обновлена в Cloudflare${serverId ? ' и обновлена в настройках сервера.' : '.'}`,
      result: dnsResult.result
    });

  } catch (err: any) {
    console.error('❌ [Cloudflare Bind Error]:', err.response?.data || err.message);
    const apiError = err.response?.data?.errors?.[0]?.message || err.message;
    res.status(500).json({ error: apiError });
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
    const nowIso = new Date().toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // 1. Auto-fail expired pending payments where expires_at is past
    await supabase
      .from('payments')
      .update({ status: 'failed' })
      .eq('status', 'pending')
      .lt('expires_at', nowIso);

    // 2. Auto-fail stale pending payments with null expires_at or older than 1 hour
    await supabase
      .from('payments')
      .update({ status: 'failed' })
      .eq('status', 'pending')
      .lt('created_at', oneHourAgo);

    const { data, error } = await supabase
      .from('payments')
      .select('*, users(email)')
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

app.post('/api/admin/payments/check-enot', adminOnly, async (req, res) => {
  const { paymentId } = req.body;
  if (!paymentId) {
    return res.status(400).json({ error: 'Missing paymentId' });
  }

  try {
    const { data: payRow, error: fetchErr } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (fetchErr || !payRow) {
      return res.status(404).json({ error: 'Платеж не найден' });
    }

    if (!payRow.invoice_id) {
      return res.json({ 
        success: true, 
        internalStatus: payRow.status,
        enotStatus: 'none', 
        message: 'У платежа отсутствует ID счета в Enot.io (возможно, прямой или ручной)' 
      });
    }

    const checkResult = await payment.checkEnotStatus(payRow.invoice_id);
    res.json({ 
      success: true, 
      internalStatus: payRow.status,
      ...checkResult 
    });
  } catch (err: any) {
    console.error('❌ Admin check Enot status error:', err);
    res.status(500).json({ error: err.message });
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

    const [usersResult, proSettingsResult] = await Promise.all([
      query,
      supabase.from('settings').select('key, value').like('key', 'PRO_USER_%')
    ]);

    const { data, error } = usersResult;
    if (error) {
       console.error(`[AdminAPI][${requestId}] Supabase error:`, error.message);
       return res.status(500).json({ error: error.message });
    }

    if (!data) return res.json([]);

    const proUsersMap: Record<string, boolean> = {};
    if (proSettingsResult.data) {
      proSettingsResult.data.forEach((setting: any) => {
        const userId = setting.key.replace('PRO_USER_', '');
        proUsersMap[userId] = setting.value === 'true';
      });
    }

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
        is_pro: !!proUsersMap[u.id],
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

app.post('/api/admin/users/create', adminOnly, async (req, res) => {
  const { email, password, initialBalance, createSubscription, serverId, trafficLimitMb, periodMonths } = req.body;
  
  try {
    const authData: any = {
      email,
      email_confirm: true,
    };
    if (password) {
      authData.password = password;
    } else {
      authData.password = Math.random().toString(36).substring(2, 12);
    }
    
    // Create auth user
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser(authData);
    
    if (authError) {
      return res.status(400).json({ error: authError.message });
    }

    const userId = authUser.user.id;

    // Wait for the on_auth_user_created trigger to insert user & balance
    await new Promise(resolve => setTimeout(resolve, 500));

    // Update balance
    if (initialBalance && parseFloat(initialBalance) > 0) {
      await supabase.from('balances').update({ amount: parseFloat(initialBalance) }).eq('user_id', userId);
      // Log transaction
      await supabase.from('transactions').insert({
        user_id: userId,
        amount: parseFloat(initialBalance),
        type: 'deposit',
        status: 'completed',
        description: 'Initial balance transfer (Admin)'
      });
    }

    // Create Subscription if checked
    if (createSubscription && serverId) {
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + parseInt(periodMonths || '1'));
      
      const subRes = await supabase.from('subscriptions').insert({
        user_id: userId,
        server_id: serverId,
        plan_type: 'premium',
        status: 'active',
        traffic_limit_mb: parseInt(trafficLimitMb || '0'),
        period_months: parseInt(periodMonths || '1'),
        expires_at: expiresAt.toISOString(),
      }).select().single();
      
      if (subRes.error) {
        console.error('Sub creation array:', subRes.error);
        return res.status(500).json({ error: 'Пользователь создан, но ошибка создания подписки' });
      }
      const subscriptionId = subRes.data.id;
      const sub = subRes.data;
      
      const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
      let devices: any[] = [];
      if (activeServers && activeServers.length > 0) {
        const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
        const limitBytes = parseInt(trafficLimitMb || '0') * 1024 * 1024;
        const randomSuffix = Math.random().toString(36).substring(2, 6);
        const email = `user_${userId.slice(0, 8)}_${randomSuffix}_0`;
        const uuid = crypto.randomUUID();
        const expiresAtMs = expiresAt.getTime();
        let configLines: string[] = [];

        for (const server of activeServers) {
          try {
            const { instance: xuiInstance } = await getXuiForServer(server.id);
            const rawConfig = await xuiInstance.addClient(email, uuid, inboundId, expiresAtMs, limitBytes);
            if (rawConfig && !rawConfig.includes('security=none') && rawConfig.trim() !== '') {
              configLines.push(rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`));
            }
          } catch (e) {
            console.error(`[AdminCreateSub] Error creating on server ${server.name}`, e);
          }
        }
        
        if (configLines.length > 0) {
          const newDevice = {
            id: `device_${uuid.slice(0,8)}`,
            label: 'Устройство 1',
            config: configLines.join('\n'),
            email: email,
            uuid: uuid,
            expiresAt: expiresAt.toISOString(),
            serverType: 'wifi',
            trafficUsedBytes: 0,
            serverId: activeServers[0].id
          };
          devices.push(newDevice);
        }
      }
      
      await supabase.from('subscriptions').update({ 
        v2ray_config: JSON.stringify(devices)
      }).eq('id', subscriptionId);
    }

    res.json({ success: true, userId, password: authData.password });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
      updated_at: new Date().toISOString()
    }).eq('id', sub.id);

    res.json({ success: true, message: 'Устройство добавлено', device: newDevice });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/:userId/subscription', adminOnly, async (req, res) => {
  const { userId } = req.params;
  const { serverId, periodMonths, trafficLimitMb } = req.body;
  try {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + parseInt(periodMonths || '1'));
    
    // Deactivate existing
    await supabase.from('subscriptions').update({ status: 'expired' }).eq('user_id', userId).eq('status', 'active');
    
    const subRes = await supabase.from('subscriptions').insert({
      user_id: userId,
      server_id: serverId,
      plan_type: 'premium',
      status: 'active',
      traffic_limit_mb: parseInt(trafficLimitMb || '0'),
      period_months: parseInt(periodMonths || '1'),
      expires_at: expiresAt.toISOString(),
    }).select().single();
    
    if (subRes.error) throw subRes.error;
    const subscriptionId = subRes.data.id;
    const sub = subRes.data;
    
    // Auto-create default device across active servers
    const { data: activeServers } = await supabase.from('vpn_servers').select('*').eq('is_active', true);
    let devices: any[] = [];
    
    if (activeServers && activeServers.length > 0) {
      const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
      const limitBytes = parseInt(trafficLimitMb || '0') * 1024 * 1024;
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const email = `user_${userId.slice(0, 8)}_${randomSuffix}_0`;
      const uuid = crypto.randomUUID();
      const expiresAtMs = expiresAt.getTime();
      let configLines: string[] = [];

      for (const server of activeServers) {
        try {
          const { instance: xuiInstance } = await getXuiForServer(server.id);
          const rawConfig = await xuiInstance.addClient(email, uuid, inboundId, expiresAtMs, limitBytes);
          if (rawConfig && !rawConfig.includes('security=none') && rawConfig.trim() !== '') {
            configLines.push(rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`));
          }
        } catch (e) {
          console.error(`[AdminCreateSub] Error creating on server ${server.name}`, e);
        }
      }
      
      if (configLines.length > 0) {
        const newDevice = {
          id: `device_${uuid.slice(0,8)}`,
          label: 'Устройство 1',
          config: configLines.join('\n'),
          email: email,
          uuid: uuid,
          expiresAt: expiresAt.toISOString(),
          serverType: 'wifi',
          trafficUsedBytes: 0,
          serverId: activeServers[0].id
        };
        devices.push(newDevice);
      }
    }
    
    await supabase.from('subscriptions').update({ 
      v2ray_config: JSON.stringify(devices)
    }).eq('id', subscriptionId);
    
    res.json({ success: true, subscriptionId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/users/:id', adminOnly, async (req, res) => {
  const { id } = req.params;
  const { role, balance, is_pro } = req.body;
  
  try {
    let updatedUser: any = null;
    
    // 1. Update role if defined to avoid 'Cannot coerce' error when empty
    if (role !== undefined) {
      const { data: u, error: uErr } = await supabase
        .from('users')
        .update({ role })
        .eq('id', id)
        .select()
        .maybeSingle();
      if (uErr) throw uErr;
      updatedUser = u;
    } else {
      const { data: u, error: uErr } = await supabase
        .from('users')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (uErr) throw uErr;
      updatedUser = u;
    }

    if (!updatedUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    // Update Pro Status in settings if defined
    if (is_pro !== undefined) {
      const { error: proErr } = await supabase
        .from('settings')
        .upsert({
          key: `PRO_USER_${id}`,
          value: is_pro ? 'true' : 'false',
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
      
      if (proErr) {
        console.error('⚠️ Failed to save user Pro status in settings:', proErr.message);
      }
      updatedUser.is_pro = !!is_pro;
    }

    // 2. Update balance & log transaction if balance is defined
    if (balance !== undefined) {
      const val = parseFloat(balance);
      if (isNaN(val)) {
        return res.status(400).json({ error: 'Некорректное значение баланса' });
      }

      // Fetch current balance to calculate diff
      const { data: balData, error: balFetchErr } = await supabase
        .from('balances')
        .select('amount')
        .eq('user_id', id)
        .maybeSingle();

      if (balFetchErr) throw balFetchErr;
      
      const oldBalance = balData?.amount ? parseFloat(balData.amount) : 0;
      const difference = val - oldBalance;

      // Update balance
      const { error: balErr } = await supabase
        .from('balances')
        .upsert({
          user_id: id,
          amount: val,
          currency: 'RUB',
          updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' });

      if (balErr) throw balErr;

      // Log transaction if balance was actually changed
      if (Math.abs(difference) > 0.001) {
        const type = difference >= 0 ? 'deposit' : 'withdrawal';
        const absDiff = Math.abs(difference);
        
        const { error: txErr } = await supabase
          .from('transactions')
          .insert({
            user_id: id,
            amount: absDiff,
            currency: 'RUB',
            type: type,
            status: 'completed',
            description: `Корректировка баланса администратором: c ${oldBalance.toFixed(2)} ₽ до ${val.toFixed(2)} ₽`
          });
          
        if (txErr) {
          console.error('⚠️ Failed to insert adjustment transaction log:', txErr.message);
        }
      }
    }

    res.json(updatedUser);
  } catch (err: any) {
    console.error('❌ Error in PUT /api/admin/users/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/servers/:id/check', adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    const { instance } = await getXuiForServer(id);
    const loginSuccess = await instance.login();
    if (loginSuccess) {
      // Try to get stats as a deeper check
      const stats = await instance.getInbounds();
      if (stats.length === 0) {
        console.log(`[AdminAPI] Server ${id} has 0 inbounds. Auto-configuring IZINET VLESS REALITY...`);
        const payload = {
          up: 0, down: 0, total: 0, remark: "IZINET VLESS REALITY", enable: true, expiryTime: 0,
          listen: "", port: 443, protocol: "vless",
          settings: JSON.stringify({clients:[], decryption:"none", fallbacks:[{name:"izinet.online",alpn:"",path:"",dest:"host.docker.internal:3443",xver:0},{name:"www.izinet.online",alpn:"",path:"",dest:"host.docker.internal:3443",xver:0},{dest:"host.docker.internal:3443",xver:0}]}),
          streamSettings: JSON.stringify({network:"tcp", security:"reality", realitySettings:{show:false, target:"host.docker.internal:3443", dest:"host.docker.internal:3443", xver:0, serverNames:["www.microsoft.com","microsoft.com"], privateKey:"ABiVSJTP0fEMzgsHghSAsQJp-bYAJAAt0jErpzaGtEo", publicKey:"CXL0o8BEC7wz-TluA7w-QBbJladSsb9xL7G6UB410Xw", shortIds:["","0123456789abcdef"]}, tcpSettings:{acceptProxyProtocol:false, header:{type:"none"}}}),
          sniffing: JSON.stringify({enabled:true, destOverride:["http","tls"], routeOnly:false})
        };
        await axios.post(`${instance['host']}${instance['basePath']}/panel/api/inbounds/add`, payload, {
           headers: { ...instance.authHeaders(), Cookie: instance['sessionCookie'], 'Content-Type': 'application/json' }
        });
        
        await syncAllRoutingToAllPanels();
        
        const newStats = await instance.getInbounds();
        return res.json({ success: true, name: 'XUI', version: 'Latest', stats_count: newStats.length, status: 'ok', configured: true });
      }

      res.json({ success: true, name: 'XUI', version: 'Latest', stats_count: stats.length, status: 'ok' });
    } else {
      res.json({ success: false, error: 'Login failed', status: 'error' });
    }
  } catch (err: any) {
    console.error(`❌ Connection check error for server ${id}:`, err.message);
    res.status(500).json({ success: false, error: err.message, status: 'error' });
  }
});

app.post('/api/admin/servers/:id/diagnose', adminOnly, async (req, res) => {
  const { id } = req.params;
  const logs: string[] = [];
  const results = {
    dns_resolved: false,
    dns_ip: '',
    port_open: false,
    vless_port_open: false,
    ping_status: 'unknown',
    latency_ms: -1,
    login_successful: false,
    xray_status: 'unknown',
    advice: [] as string[]
  };

  logs.push(`[Диагностика] Запуск комплексной диагностики для сервера ID: ${id}`);
  
  try {
    const { instance, server } = await getXuiForServer(id);
    if (!server) {
      logs.push(`❌ Ошибка: Сервер не найден в базе данных.`);
      return res.status(404).json({ success: false, logs, results });
    }

    logs.push(`[Сервер] Название: "${server.name}", IP: ${server.ip || 'не указан'}, Домен: ${server.domain || 'не указан'}`);
    logs.push(`[Параметры] Порт панели API: ${server.api_port || 2053}, Пользователь: ${server.username || 'не указан'}`);

    // Шаг 1: Разрешение DNS
    const targetDomain = (server.domain || '').trim();
    const targetIp = (server.ip || '').trim().split('/')[0].split(':')[0]; // Очистка от путей и портов
    const dnsHost = targetDomain || targetIp;

    if (!dnsHost) {
      logs.push(`❌ Не указан ни IP, ни домен сервера.`);
    } else {
      logs.push(`[DNS] Разрешение сетевого адреса "${dnsHost}"...`);
      try {
        const startDns = Date.now();
        const addresses = await dns.resolve4(dnsHost).catch(async () => {
          const lookup = await dns.lookup(dnsHost);
          return [lookup.address];
        });
        const elapsed = Date.now() - startDns;
        results.dns_resolved = true;
        results.dns_ip = addresses[0];
        logs.push(`✅ [DNS] Адрес успешно разрешен за ${elapsed}мс. IP: ${addresses.join(', ')}`);
      } catch (err: any) {
        logs.push(`❌ [DNS] Не удалось разрешить адрес "${dnsHost}": ${err.message}`);
        results.advice.push(`Проверьте правильность домена "${dnsHost}". Если домен куплен недавно, сетевые изменения у провайдеров могут вступать в силу до 24 часов.`);
      }
    }

    // Шаг 2: Проверка TCP-порт панели API (3x-ui)
    let apiPort = server.api_port || 2053;
    try {
      if (instance && instance.host) {
        const urlOb = new URL(instance.host);
        if (urlOb.port) {
          apiPort = parseInt(urlOb.port);
        } else if (urlOb.protocol === 'https:') {
          apiPort = 443;
        } else {
          apiPort = 80;
        }
      }
    } catch (_) {}
    const testIp = results.dns_ip || targetIp;

    if (!testIp) {
      logs.push(`❌ Пропуск проверки портов: IP-адрес сервера не определен.`);
    } else {
      logs.push(`[Port API] Тестирование доступности API-порта ${apiPort} на IP ${testIp}...`);
      const startPortConn = Date.now();
      
      const checkPort = (port: number, host: string, timeoutMs = 4000): Promise<{open: boolean, elapsed: number, err?: string}> => {
        return new Promise((resolve) => {
          const socket = new net.Socket();
          let resolved = false;
          
          socket.setTimeout(timeoutMs);
          
          socket.connect(port, host, () => {
            const elapsed = Date.now() - startPortConn;
            resolved = true;
            socket.destroy();
            resolve({ open: true, elapsed });
          });
          
          socket.on('error', (err: any) => {
            if (!resolved) {
              resolved = true;
              socket.destroy();
              resolve({ open: false, elapsed: Date.now() - startPortConn, err: err.message });
            }
          });
          
          socket.on('timeout', () => {
            if (!resolved) {
              resolved = true;
              socket.destroy();
              resolve({ open: false, elapsed: timeoutMs, err: 'Превышено время ожидания (Connection Timeout)' });
            }
          });
        });
      };

      const portCheck = await checkPort(apiPort, testIp);
      if (portCheck.open) {
        results.port_open = true;
        results.latency_ms = portCheck.elapsed;
        logs.push(`✅ [Port API] Порт управления ${apiPort} успешно СВЯЗАН! Пинг до панели: ${portCheck.elapsed}мс.`);
      } else {
        logs.push(`❌ [Port API] Порт ${apiPort} ЗАКРЫТ или недоступен за ${portCheck.elapsed}мс. Ошибка: ${portCheck.err}`);
        results.advice.push(`Управляющий порт API ${apiPort} недоступен. Возможные причины и решения:
1. На VPS работает фаервол (UFW/iptables), фильтрующий новые входящие подключения. Решение: выполните на VPS консольную команду "sudo ufw allow ${apiPort}/tcp" или полностью выключите фаервол "sudo ufw disable".
2. Сама служба 3x-ui упала или зависла. Решение: попробуйте перезапустить контейнер docker или службу 3x-ui прямо на сервере ("x-ui restart" или "systemctl restart x-ui").
3. Окружение Docker: Если сервер внутри одной локальной сети с приложением, убедитесь, что имя хоста указано корректно (для локального Docker см. 'x3-ui:2053').`);
      }

      // Проверим также порт VLESS (обычно 443)
      logs.push(`[Port VLESS] Тестирование доступности пользовательского VLESS Reality порта 443...`);
      const vlessCheck = await checkPort(443, testIp);
      if (vlessCheck.open) {
        results.vless_port_open = true;
        logs.push(`✅ [Port VLESS] Главный порт 443 для VPN-туннеля ОТКРЫТ! Доступ со стороны VPN-клиентов открыт.`);
      } else {
        logs.push(`⚠️ [Port VLESS] Порт туннеля VLESS 443 ЗАКРЫТ или недоступен за ${vlessCheck.elapsed}мс. Причина: ${vlessCheck.err}`);
        results.advice.push(`Пользовательский порт туннелей VLESS (443) закрыт. Покупатели не смогут подключить интернет, даже если API панель отвечает. Проверьте:
1. Запущен ли Xray Core внутри веб-интерфейса панели.
2. Не занят ли порт 443 другими локальными веб-серверами (например, предустановленным Apache или Nginx, мешающим биндингу Xray).
3. Разрешен ли в фаерволе порт 443: "sudo ufw allow 443/tcp" и "sudo ufw allow 443/udp".`);
      }
    }

    // Шаг 3: Тест авторизации (Handshake)
    if (instance.host) {
      logs.push(`[API Handshake] Проверка логина и парсинг инбаундов на адресе: ${instance.host}${instance.basePath}...`);
      try {
        const loginToken = await instance.login(true);
        if (loginToken) {
          results.login_successful = true;
          logs.push(`✅ [API Handshake] Авторизация на сервере пройдена! Сессия успешно создана.`);
          
          logs.push(`[API Inbounds] Запрос активных подключений...`);
          const inbounds = await instance.getInbounds();
          logs.push(`✅ [API Inbounds] Найдено инбаундов: ${inbounds?.length || 0}.`);
          
          if (!inbounds || inbounds.length === 0) {
            logs.push(`⚠️ [API Inbounds] На сервере НЕТ настроенных входящих портов! Клиенты не смогут получить доступ к VPN.`);
            results.advice.push(`На панели 3x-ui нет ни одного инбаунда. Решение: Нажмите обычную кнопку "Проверить" (check connection) на странице управления серверами — IZINET автоматически создаст и пропишет на панели стандартный Reality VLESS инбаунд.`);
          } else {
            const hasVless = inbounds.some((i: any) => i.protocol === 'vless');
            if (!hasVless) {
              logs.push(`⚠️ [API Inbounds] Отсутствует критический протокол VLESS! (Обнаружены: ${inbounds.map((i: any) => i.protocol).join(', ')})`);
              results.advice.push(`В панели серверов нет протоколов VLESS Reality, необходимых для клиентов izinet. Добавьте его вручную или воспользуйтесь кнопкой "Проверить" для автоматической конфигурации.`);
            } else {
              const vlessInb = inbounds.find((i: any) => i.protocol === 'vless');
              logs.push(`✅ [API Inbounds] Обнаружен VLESS инбаунд (ID: ${vlessInb.id}, Remark: "${vlessInb.remark || 'нет'}", Port: ${vlessInb.port})`);
            }
          }
        } else {
          logs.push(`❌ [API Handshake] Ошибка сессии: неправильные учетные данные для веб-панели 3x-ui.`);
          results.advice.push(`Панель 3x-ui отклонила логин/пароль. Пожалуйста, отредактируйте параметры сервера в списке, сверив Имя пользователя и Пароль с учетными данными администратора.`);
        }
      } catch (loginErr: any) {
        logs.push(`❌ [API Handshake] Исключение при выполнении запроса: ${loginErr.message}`);
        results.advice.push(`Сбой отправки данных. Проверьте правильность секретного пути в поле IP/домен (например, "/LZ6dkLp"). Если панель работает по HTTP, убедитесь, что не указан протокол HTTPS.`);
      }
    } else {
      logs.push(`❌ Сбой: Хост панели не определен.`);
    }

    // Траблшутинг для ПК vs Телефона
    results.advice.push(`💡 ПОЧЕМУ VPN ИДЕАЛЬНО РАБОТАЕТ НА ТЕЛЕФОНЕ, НО ТАЙМАУТИТ НА ПК?
1. Включенный IPv6 на Windows/MacOS: Домашние провайдеры в РФ часто криво маршрутизируют IPv6 пакеты. Если в клиенте Hiddify на ПК включен "Предпочитать IPv6" (Preferred IPv6), программа пытается слать пакеты Dual-Stack ресурсов (Google, YouTube) по IPv6. Если у сервера нет IPv6 или он настроен без VPN-выхода, пакеты пропадают, вызывая таймаут.
   👉 РЕШЕНИЕ: Зайдите в Клиент Hiddify на ПК -> Настройки -> Конфигурация -> Выключите переключатель "Включить IPv6" (Enable IPv6). Это раз и навсегда убирает 90% "зависаний" сайтов и серверов на ПК!
2. Антивирусы Windows (Kaspersky, Windows Defender): Антивирусы со своим файрволом пытаются расшифровывать SSL/TLS трафик (MITM). Это ломает Reality VLESS, поскольку Reality сверяет контрольные суммы оригинального TLS-сертификата (например, microsoft.com). Добавьте исполняемые файлы Hiddify/Xray в белый список исключений антивируса.
3. DPI фильтры: Мобильные операторы (МТС, Теле2, Билайн) фильтруют протоколы мягче проводных домашних сетей. Если ПК-подключение режется, попробуйте сменить SNI домен в инбаунде на локальный или неблокируемый (например, www.microsoft.com или dl.google.com).`);

    res.json({ success: true, logs, results });
  } catch (globalErr: any) {
    console.error('[Diagnose Exception Raw]:', globalErr);
    logs.push(`❌ Критическая ошибка выполнения диагностики: ${globalErr.message}`);
    res.json({ success: true, logs, results });
  }
});

app.post('/api/admin/servers/:id/backup', adminOnly, async (req, res) => {
  const { id } = req.params;
  try {
    const { instance: xuiInstance, server } = await getXuiForServer(id);
    if (!server) return res.status(404).json({ error: 'Server not found' });

    console.log(`[Backup] Starting cloud backup for server: ${server.name} (${id})`);
    
    const inbounds = await xuiInstance.getInbounds();
    if (!inbounds || inbounds.length === 0) {
      return res.status(400).json({ error: 'На сервере не найдено инбаундов для бэкапа. Убедитесь, что сервер онлайн.' });
    }

    const { error } = await supabase
      .from('vpn_servers')
      .update({ 
        xui_config_state: { 
          inbounds: inbounds, 
          backup_at: new Date().toISOString(),
          server_name: server.name,
          ip: server.ip
        } 
      })
      .eq('id', id);

    if (error) throw error;

    res.json({ 
      success: true, 
      message: 'Конфигурация сервера успешно сохранена в Supabase',
      inbounds_count: inbounds.length
    });
  } catch (err: any) {
    console.error(`[AdminBackup] Error for server ${id}:`, err.message);
    res.status(500).json({ error: 'Ошибка при создании бэкапа: ' + err.message });
  }
});

app.post('/api/admin/servers/:id/restore', adminOnly, async (req, res) => {
  const { id } = req.params;
  const { sourceId } = req.body || {};
  try {
    const { instance: xuiInstance, server } = await getXuiForServer(id);
    if (!server) return res.status(404).json({ error: 'Server not found' });

    console.log(`[Restore] Starting cloud restore for server: ${server.name} (${id}) ${sourceId ? `from source server ID: ${sourceId}` : ''}`);
    
    let configState;
    if (sourceId) {
      const { data: sourceServer, error: sErr } = await supabase
        .from('vpn_servers')
        .select('xui_config_state, name')
        .eq('id', sourceId)
        .maybeSingle();
      
      if (sErr) throw sErr;
      if (!sourceServer || !sourceServer.xui_config_state || !sourceServer.xui_config_state.inbounds) {
        return res.status(400).json({ error: `В базе нет инбаундов для сервера-источника ${sourceServer?.name || sourceId}. Сделайте бэкап с него сначала.` });
      }
      configState = sourceServer.xui_config_state;
    } else {
      if (!server.xui_config_state || !server.xui_config_state.inbounds) {
        return res.status(400).json({ error: 'В базе нет инбаундов для этого сервера. Сделайте бэкап сначала.' });
      }
      configState = server.xui_config_state;
    }
    
    const inbounds = configState.inbounds;
    
    // Connect to 3x-ui and force clean fresh login session to avoid 403 session expiration
    await xuiInstance.login(true);

    const existingInbounds = await xuiInstance.getInbounds();
    
    for (const inbound of inbounds) {
      const exists = existingInbounds.find((ei: any) => ei.port === inbound.port && ei.protocol === inbound.protocol);
      if (exists) {
        console.log(`[Restore] Deleting existing inbound on port ${inbound.port}`);
        await axios.post(`${xuiInstance['host']}${xuiInstance['basePath']}/panel/api/inbounds/del/${exists.id}`, {}, getRequestConfig(`${xuiInstance['host']}${xuiInstance['basePath']}/panel/api/inbounds/del`, xuiInstance.authHeaders()));
      }
      
      const newInbound = { ...inbound };
      delete newInbound.id;
      newInbound.up = 0;
      newInbound.down = 0;
      
      console.log(`[Restore] Creating inbound: ${inbound.remark} on port ${inbound.port}`);
      await axios.post(`${xuiInstance['host']}${xuiInstance['basePath']}/panel/api/inbounds/add`, newInbound, getRequestConfig(`${xuiInstance['host']}${xuiInstance['basePath']}/panel/api/inbounds/add`, xuiInstance.authHeaders({ 'Content-Type': 'application/json' })));
    }

    res.json({ 
      success: true, 
      message: 'Конфигурация (инбаунды и клиенты) успешно восстановлена на сервер',
      restored_inbounds: inbounds.length
    });
  } catch (err: any) {
    console.error(`[AdminRestore] Error for server ${id}:`, err.message);
    res.status(500).json({ error: 'Ошибка при восстановлении бэкапа: ' + err.message });
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
            const listResp = await axios.get(`${instance['host']}${instance['basePath']}/panel/api/inbounds/list`, getRequestConfig(`${instance['host']}${instance['basePath']}/panel/api/inbounds/list`, instance.authHeaders()));
            
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
                }, getRequestConfig(`${instance['host']}${instance['basePath']}/panel/api/inbounds/update/${inbound.id}`, instance.authHeaders()));
                inboundsUpdated++;
              }
            }
            console.log(`✅ Fixed limitIp on ${inboundsUpdated} inbounds for ${server.name}`);
        } catch (e: any) {
            console.error(`Error fixing limitIp on ${server.name}:`, e.message);
        }
    }

    const force = req.body?.force === true;
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

        // If force is true, OR the number of links doesn't match, OR we're missing an active server suffix, we need to sync!
        if (force || links.length !== activeServers.length || !hasAllActiveServers) {
          console.log(`[SyncServers] Syncing/regenerating device ${device.label} for user ${sub.user_id} (force: ${force})`);
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
  const { name, ip, domain, api_port, username, password, location_code, is_default, xui_config_state } = req.body;
  
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
      is_active: true,
      xui_config_state: xui_config_state || {}
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

    const publicUrlSetting = await getSystemSetting('PUBLIC_URL', process.env.PUBLIC_URL || process.env.VITE_API_URL || '');
    const origin = publicUrlSetting.replace(/\/$/, '') || req.headers.origin || `https://${req.headers.host}`;

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
    const parsedCf = parseEnotCustomFields(custom_field);
    const userId = parsedCf.user_id || parsedCf.userId || custom_field;
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
    let isValidSignature = await payment.verifyEnotWebhook(req.body, headerSignature);
    
    // If HMAC fails (Express json parser destroys raw whitespace), fallback to secure API validation:
    if (!isValidSignature && invoice_id) {
       console.warn(`[EnotWebhook] HMAC invalid, fallback to direct API validation for ${invoice_id}`);
       try {
         const enotCheck = await payment.checkEnotStatus(invoice_id);
         console.log(`[EnotWebhook] API check result:`, JSON.stringify(enotCheck));
         // Enot checkEnotStatus returns 'success' when it's fully verified
         if (enotCheck && (enotCheck.enotStatus === 'success' || enotCheck.enotStatus === 'paid' || enotCheck.enotStatus === 'finish' || enotCheck.enotStatus === 'finished')) {
            console.log(`[EnotWebhook] Fallback validation successful via API! Status: ${enotCheck.enotStatus}`);
            isValidSignature = true;
         }
       } catch (apiErr) {
         console.error(`[EnotWebhook] Fallback API validation threw error:`, apiErr);
       }
    }

    if (!isValidSignature) {
      console.warn('Invalid Enot webhook signature and API validation failed');
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

    if (paymentRow?.amount && Math.abs(Number(paymentRow.amount) - paidAmount) > 5) {
      console.warn(`Enot amount mismatch for ${orderId}: expected ${paymentRow.amount}, got ${amount}. Proceeding anyway.`);
    }

    if (paymentRow?.status === 'completed') {
      console.log(`Payment ${orderId} already processed.`);
      return res.send('YES');
    }

    const isSuccessStatus = ['success', 'paid', 'finish', 'finished'].includes(status.toLowerCase());
    if (!isSuccessStatus) {
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

// 🌐 Supabase API Bypassing Proxy for Russian clients
app.all('/api/supabase-proxy/*', async (req, res) => {
  if (!supabaseUrl) {
    console.error('❌ [Supabase Proxy] Supabase URL is not configured in process.env!');
    return res.status(500).json({ error: 'Supabase URL is not configured' });
  }

  // Gracefully handle trailing slash in supabaseUrl
  const cleanSupabaseUrl = supabaseUrl.endsWith('/') ? supabaseUrl.slice(0, -1) : supabaseUrl;
  
  // Extract resource path and query string from proxy request URL
  const pathWithQuery = req.url.startsWith('/api/supabase-proxy/')
    ? req.url.slice('/api/supabase-proxy/'.length)
    : req.url.replace(/^\/?api\/supabase-proxy\//, '');
    
  const targetUrl = `${cleanSupabaseUrl}/${pathWithQuery}`;

  console.log(`🌐 [Supabase Proxy] Proxying ${req.method} request to: ${targetUrl}`);

  // Mirror headers, strictly omitting original Content-Length, Host, Accept-Encoding and other protocol headers 
  // to avoid payload mismatch hangs/failures (502 Gateway errors)
  const headers: Record<string, string> = {};
  const forbiddenHeaders = [
    'host',
    'content-length',
    'connection',
    'accept-encoding',
    'content-encoding',
    'transfer-encoding',
    'keep-alive'
  ];
  
  for (const [key, value] of Object.entries(req.headers)) {
    if (value && !forbiddenHeaders.includes(key.toLowerCase())) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }

  let requestBody: any = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body && Object.keys(req.body).length > 0) {
      requestBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: requestBody
    });

    const responseData = await response.text();

    console.log(`🌐 [Supabase Proxy] Received response with status ${response.status} from ${targetUrl}`);

    // Mirror back Supabase's response headers, bypassing connection, compression and length ones
    const avoidHeaders = ['content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'content-length', 'access-control-allow-origin'];
    response.headers.forEach((value, key) => {
      if (!avoidHeaders.includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    res.status(response.status).send(responseData);
  } catch (err: any) {
    console.error('⚠️ [Supabase Proxy Error]:', err);
    res.status(502).json({ error: 'Supabase Proxy Error', details: err.message, stack: err.stack });
  }
});

// Health check and configuration status
app.get('/api/test-xui', async (req, res) => {
  try {
    const results = await syncAllRoutingToAllPanels();
    res.json({ results });
  } catch (e: any) { res.status(500).json({error: e.message}) }
});

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
    const monthlyPriceStr = await getSystemSetting('MONTHLY_PRICE', '100');
    const basePrice = parseInt(monthlyPriceStr, 10) || 100;
    const deviceLimitStr = await getSystemSetting('DEVICE_LIMIT', '2');
    
    // Always use dynamically generated linear pricing structure
    const plans = {
      periods: [
        { id: '1m', label: '1 месяц', price: basePrice * 1, days: 30 },
        { id: '2m', label: '2 месяца', price: basePrice * 2, days: 60 },
        { id: '6m', label: '6 месяцев', price: basePrice * 6, days: 180 },
        { id: '12m', label: '12 месяцев', price: basePrice * 12, days: 365 },
      ],
      serverTypes: [
        { id: 'wifi', label: 'Wi-Fi', price: 0 }
      ],
      deviceLimit: parseInt(deviceLimitStr)
    };
    
    return res.json(plans);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/subscription/universal-link-visible', authenticateUser, async (req: any, res) => {
  try {
    const userId = req.user.id;
    const universalLinkStatus = await getSystemSetting('UNIVERSAL_LINK_STATUS', 'all'); // 'all' | 'pro' | 'none'
    
    if (universalLinkStatus === 'none') {
      return res.json({ visible: false });
    }
    
    if (universalLinkStatus === 'pro') {
      // Check if user is Pro
      const { data: proSetting } = await supabase
        .from('settings')
        .select('value')
        .eq('key', `PRO_USER_${userId}`)
        .maybeSingle();
      
      const isPro = proSetting?.value === 'true';
      return res.json({ visible: isPro });
    }
    
    // Status is 'all' (default)
    res.json({ visible: true });
  } catch (err: any) {
    console.error('Error fetching universal-link-visible:', err);
    res.json({ visible: false });
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
    const monthlyPriceStr = await getSystemSetting('MONTHLY_PRICE', '100');
    const basePrice = parseInt(monthlyPriceStr, 10) || 100;
    const globalDeviceLimitStr = await getSystemSetting('DEVICE_LIMIT', '2');
    const globalDeviceLimit = parseInt(globalDeviceLimitStr);
    
    // dynamically determine the price based on planId ('1m', '2m', '6m', '12m')
    let months = 1;
    if (planId === '2m') months = 2;
    if (planId === '6m') months = 6;
    if (planId === '12m') months = 12;
    
    // Wi-Fi server cost is standard (0 additive cost)
    const expectedPrice = (basePrice * months) * (forceNew || targetDeviceId ? 1 : (deviceLimit || 1));
    if (Math.abs(price - expectedPrice) > 1) { // Allow small rounding diffs
      console.warn(`[BUY] Price mismatch for user ${userId}: client sent ${price}, DB calculated ${expectedPrice}`);
      return res.status(400).json({ error: 'Mismatched price. Please refresh the page.' });
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
    
    // Honor the last sub limit if it's higher than the current global settings, or if it was unset, use global
    const userDeviceLimit = lastSub?.device_limit ? Math.max(lastSub.device_limit, globalDeviceLimit) : globalDeviceLimit;

    if (existingDevices.length + devicesToCreate > userDeviceLimit) {
      return res.status(400).json({ error: `Превышен лимит: можно иметь не более ${userDeviceLimit}-х устройств.` });
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
        serverType: serverType || 'WIFI',
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
          device_limit: lastSub.device_limit ? Math.max(lastSub.device_limit, globalDeviceLimit) : globalDeviceLimit,
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
          device_limit: globalDeviceLimit,
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

// Apply Promo Code for 24-hour Trial Subscription
app.post('/api/promocode/apply', authenticateUser, async (req: any, res) => {
  const { code } = req.body;
  
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'Пожалуйста, введите промокод.' });
  }

  const inputCode = code.trim().toUpperCase();
  const userId = req.user.id;

  try {
    // 1. Check if promo codes are enabled globally
    const promoCodesEnabled = await getSystemSetting('PROMO_CODES_ENABLED', 'true');
    if (promoCodesEnabled === 'false') {
      return res.status(400).json({ error: 'Функция промокодов временно отключена администратором.' });
    }

    // 2. Fetch list of allowed promo codes
    const promoCodesListStr = await getSystemSetting('PROMO_CODES_LIST', '');
    const validCodes = promoCodesListStr
      .split(/[\n,;]/)
      .map((c: string) => c.trim().toUpperCase())
      .filter((c: string) => c.length > 0);

    if (!validCodes.includes(inputCode)) {
      return res.status(400).json({ error: 'Неверный или несуществующий промокод.' });
    }

    // 3. Check if user already used promo code before
    const { data: alreadyUsedSetting, error: usedFetchErr } = await supabase
      .from('settings')
      .select('value')
      .eq('key', `USED_PROMO_${userId}`)
      .maybeSingle();

    if (alreadyUsedSetting) {
      return res.status(400).json({ error: 'Вы уже использовали пробный период через промокод ранее.' });
    }

    // 4. Check if user currently has an active subscription
    const { data: activeSub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeSub) {
      return res.status(400).json({ error: 'Промокод на пробный период доступен только пользователям без активной подписки.' });
    }

    const deviceLimitStr = await getSystemSetting('DEVICE_LIMIT', '2');
    const globalDeviceLimit = parseInt(deviceLimitStr);

    // 5. Fetch all active servers for client provisioning
    const { data: activeServers, error: serversErr } = await supabase
      .from('vpn_servers')
      .select('*')
      .eq('is_active', true);

    if (serversErr || !activeServers || activeServers.length === 0) {
      return res.status(500).json({ error: 'Нет доступных активных VPN серверов для настройки.' });
    }

    // 6. Provision trial client on all servers with 24 hours expiry
    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const trafficLimitMb = 10 * 1024; // 10 GB
    const limitBytes = trafficLimitMb * 1024 * 1024;

    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const email = `user_${userId.slice(0, 8)}_trial_${randomSuffix}_0`;
    const uuid = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // exactly 24 hours

    let configLines: string[] = [];
    let isFirstNodeValid = false;

    for (const server of activeServers) {
      try {
        console.log(`🆕 Creating VPN client ${email} on server [${server.name}] (PROMO)...`);
        const { instance: xuiInstance } = await getXuiForServer(server.id);
        const rawConfig = await xuiInstance.addClient(email, uuid, inboundId, expiresAt.getTime(), limitBytes);
        
        if (!rawConfig || rawConfig.includes('security=none') || rawConfig.trim() === '') {
          console.error(`[VPN-PROMO] Invalid config received for ${email} on ${server.name}`);
          continue;
        }
        
        const configWithSuffix = rawConfig.replace(/(#.*)?$/, `#${server.name.replace(/\s+/g,'_')}`);
        configLines.push(configWithSuffix);
        isFirstNodeValid = true;
      } catch (e: any) {
        console.error(`❌ Failed to propagate ${email} to server ${server.name} (PROMO):`, e.message);
      }
    }

    if (!isFirstNodeValid) {
      return res.status(500).json({ error: 'Не удалось сгенерировать VPN-конфигурации на серверах. Обратитесь к администратору.' });
    }

    const existingDevices: VpnDevice[] = [{
      id: 'primary',
      label: 'Пробный VPN (24ч)',
      config: configLines.join('\n'),
      email: email,
      uuid: uuid,
      expiresAt: expiresAt.toISOString(),
      serverType: 'WIFI',
      trafficUsedBytes: 0,
      serverId: activeServers[0].id
    }];

    const finalConfigJson = JSON.stringify(existingDevices);

    // 7. Insert or update the subscription row to 'trial'
    const { data: lastSub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let subData, subErr;
    if (lastSub) {
      const { data: updatedSub, error: updateErr } = await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          expires_at: expiresAt.toISOString(),
          plan_type: 'trial',
          period_months: 1,
          device_limit: globalDeviceLimit,
          v2ray_config: finalConfigJson,
          server_id: activeServers[0].id,
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
          plan_type: 'trial',
          status: 'active',
          expires_at: expiresAt.toISOString(),
          v2ray_config: finalConfigJson,
          server_type: 'WIFI',
          period_months: 1,
          device_limit: globalDeviceLimit,
          traffic_limit_mb: trafficLimitMb,
          traffic_used_mb: 0,
          server_id: activeServers[0].id
        })
        .select()
        .single();
      subData = newSub; subErr = insertErr;
    }

    if (subErr) {
      console.error('❌ Supabase sub operation error (PROMO):', subErr);
      throw subErr;
    }

    // 8. Log the custom setting representing this user having used a promocode
    const { error: logErr } = await supabase
      .from('settings')
      .insert({
        key: `USED_PROMO_${userId}`,
        value: JSON.stringify({
          code: inputCode,
          applied_at: new Date().toISOString()
        })
      });

    if (logErr) {
      console.error('⚠️ Failed to save promo code usage log:', logErr);
    }

    // 9. Log zero-amount transaction
    await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        amount: 0.00,
        currency: 'RUB',
        type: 'withdrawal',
        status: 'completed',
        description: `Активация пробного периода 24ч по промокоду: ${inputCode}`
      });

    res.json({ success: true, message: 'Промокод успешно активирован! Вам предоставлена пробная подписка на 24 часа.', subscription: subData });

  } catch (error: any) {
    console.error('❌ Promo code activation error:', error);
    res.status(500).json({ error: error.message || 'Ошибка сервера при активации промокода.' });
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

  // Ensure routing and out-of-the-box system config is booted and synced
  syncAllRoutingToAllPanels().catch(err => console.error("System Boot Sync Error:", err));

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
      res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) {
          res.status(404).send('izinet Full-Stack Node.js App is running. Frontend build (dist/index.html) not found. Please run "npm run build".');
        }
      });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`
🚀 SERVER STARTED SUCCESSFULLY
🌍 URL: http://0.0.0.0:${PORT}
🔧 Mode: ${process.env.NODE_ENV}
📅 Date: ${new Date().toLocaleString()}
    `);
  });
}

startServer();

if (bot) {
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
