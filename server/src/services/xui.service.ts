import axios from 'axios';
import { getRequestConfig } from '../utils/axios';
import { supabase } from './supabase';

export interface ServerConfig {
  host?: string;
  username?: string;
  password?: string;
}

export class XUIService {
  public host: string;
  public basePath: string = "";
  public displayDomain: string = "";
  private username: string;
  private password: string;
  private sessionCookie: string | null = null;
  private lastLoginTime: number = 0;
  private csrfToken: string | null = null;
  private readonly SESSION_TTL = 2 * 60 * 1000; // 2 minutes cache for session cookie

  constructor(serverConfigs?: ServerConfig) {
    let host = (serverConfigs?.host || process.env.XUI_HOST || '').trim();

    if (host && !host.startsWith('http://') && !host.startsWith('https://')) {
      host = 'http://' + host;
    }

    try {
      if (host) {
        const url = new URL(host);
        this.displayDomain = url.hostname;
      }
    } catch (_) {}

    if (host) {
      try {
        const parsedUrl = new URL(host);
        const hn = parsedUrl.hostname;
        if (hn === '194.50.94.28' || hn === 'izinet.online' || hn === 'vpn.izinet.online' || hn === 'localhost' || hn === '127.0.0.1') {
          const originalHost = host;
          const port = parsedUrl.port || '2053';
          // Using a safer way to check for docker environment
          const isDocker = process.env.IS_DOCKER === 'true' || 
                           process.env.NODE_ENV === 'production_docker' || 
                           process.env.NODE_ENV === 'production'; 
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

    try {
      if (host) {
        const url = new URL(host);
        this.host = `${url.protocol}//${url.host}`;
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

  private static offlineServers = new Set<string>();
  private static lastCheck = new Map<string, number>();

  async checkConfig() {
    if (!this.host || !this.username || !this.password) return false;
    
    // Fast fail for known offline servers (cache for 5 minutes)
    if (XUIService.offlineServers.has(this.host)) {
      const last = XUIService.lastCheck.get(this.host) || 0;
      if (Date.now() - last < 5 * 60 * 1000) return false;
    }

    try {
      await this.login();
      XUIService.offlineServers.delete(this.host);
      return true;
    } catch (e: any) {
      XUIService.offlineServers.add(this.host);
      XUIService.lastCheck.set(this.host, Date.now());
      return false;
    }
  }

  async login(force: boolean = false): Promise<string> {
    if (!this.host) throw new Error('XUI_HOST is empty');
    
    // If we know it's offline, don't even try unless forced
    if (!force && XUIService.offlineServers.has(this.host)) {
       throw new Error('Server is currently offline (cached)');
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
        const response = await axios.post(url, payload, getRequestConfig(url, { 'Content-Type': 'application/x-www-form-urlencoded', ...customHeaders }));
        if (csrfData && csrfData.cookieStr) {
           response.headers['x-passed-cookie'] = csrfData.cookieStr;
        }
        return response;
      } catch (err: any) {
        lastError = err;
        try {
          const response = await axios.post(url, jsonPayload, getRequestConfig(url, customHeaders));
          if (csrfData && csrfData.cookieStr) {
             response.headers['x-passed-cookie'] = csrfData.cookieStr;
          }
          return response;
        } catch (innerErr: any) {
          lastError = innerErr;
          return null;
        }
      }
    };

    try {
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
      } catch (e) {}

      const csrfData = csrfToken ? { token: csrfToken, cookieStr: cookies.join(';') } : undefined;

      let response = await tryLogin('/login', csrfData);
      if (!response) response = await tryLogin('', csrfData);
      if (!response) response = await tryLogin('/panel/login', csrfData);

      if (!response) {
        let msg = `Could not find login endpoint at ${this.host}${this.basePath}.`;
        if (lastError?.response?.status === 403) {
           msg = `Login blocked (403 Forbidden). Rate limit/Fail2Ban active, or WAF blocking.`;
        } else if (lastError?.message) {
           msg = `Login failed. HTTP ${lastError.response?.status || 'Error'} - ${lastError.message}`;
        }
        throw new Error(msg);
      }
      
      if (response.data && response.data.success === false) {
        throw new Error(response.data.msg || 'Login failed');
      }

      const cookie = response.headers['set-cookie']?.[0] || response.headers['x-passed-cookie'];
      if (!cookie) throw new Error('No cookie received from 3x-ui.');
      this.sessionCookie = cookie;
      if (csrfData && csrfData.token) {
         this.csrfToken = csrfData.token;
      }
      this.lastLoginTime = Date.now();
      return cookie;
    } catch (error: any) {
      console.error(`❌ 3x-ui login error [${this.host}${this.basePath}]:`, error.message);
      throw error;
    }
  }

  authHeaders(extra: any = {}) {
    const headers: any = { ...extra };
    if (this.sessionCookie) headers['Cookie'] = this.sessionCookie;
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    return headers;
  }

  async getInbounds() {
    if (!this.sessionCookie) await this.login();
    try {
      const listUrl = `${this.host}${this.basePath}/panel/api/inbounds/list`;
      const resp = await axios.get(listUrl, getRequestConfig(listUrl, this.authHeaders()));
      return resp.data.obj || [];
    } catch (e: any) {
      if (e.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.getInbounds();
      }
      return [];
    }
  }

  async addClient(email: string, uuid: string, inboundId: number, expiryTime: number = 0, limitBytes: number = 0) {
    if (!this.sessionCookie) await this.login();

    let flow = "";
    try {
      const getInboundUrl = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
      const resp = await axios.get(getInboundUrl, getRequestConfig(getInboundUrl, this.authHeaders()));
      if (resp.data.success) {
        const streamSettings = JSON.parse(resp.data.obj.streamSettings || '{}');
        if (streamSettings.security === 'reality') {
          flow = "xtls-rprx-vision";
        }
      }
    } catch (e) {}

    const clientData = {
      id: inboundId,
      settings: JSON.stringify({
        clients: [
          {
            id: uuid,
            flow: flow,
            email: email,
            limitIp: 0,
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
      const response = await axios.post(addClientUrl, clientData, getRequestConfig(addClientUrl, this.authHeaders({ 'Content-Type': 'application/json' })));

      if (response.data.success) {
        return this.getInboundLink(inboundId, uuid, email);
      } else {
        const msg = response.data.msg || '';
        if (msg.includes('Duplicate email')) {
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
      throw error;
    }
  }

  async getInboundLink(inboundId: number, uuid: string, email: string): Promise<string> {
    if (!this.sessionCookie) await this.login();
    
    const getInboundUrl = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
    const resp = await axios.get(getInboundUrl, getRequestConfig(getInboundUrl, this.authHeaders(), 10000));
    
    if (!resp.data.success || !resp.data.obj) {
      throw new Error(`[XUI] Не удалось получить настройки входящего соединения ${inboundId}.`);
    }
    
    const inbound = resp.data.obj;
    let streamSettings: any = {};
    try {
      if (typeof inbound.streamSettings === 'string') {
        streamSettings = JSON.parse(inbound.streamSettings || '{}');
      } else if (inbound.streamSettings && typeof inbound.streamSettings === 'object') {
        streamSettings = inbound.streamSettings;
      }
    } catch (e) {}

    const security = streamSettings.security || 'none';
    const port = inbound.port;
    let hostName = this.displayDomain || 'server.izinet.app';
    const encodedEmail = encodeURIComponent(`izinet_${email}`);
    const isIPOrEmpty = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostName) || hostName === '';

    if (security === 'reality') {
      const rs = streamSettings.realitySettings?.settings || streamSettings.realitySettings || {};
      const sni = (rs.serverNames?.[0]) || (isIPOrEmpty ? 'google.com' : hostName);
      const pbk = rs.publicKey || '';
      const sid = (rs.shortIds?.[0]) || '';
      const fp = rs.fingerprint || 'chrome';
      const spiderX = rs.spiderX || '/';
      
      let link = `vless://${uuid}@${hostName}:${port}?type=tcp&encryption=none&security=reality&sni=${sni}&pbk=${pbk}&fp=${fp}&sid=${sid}&spx=${encodeURIComponent(spiderX)}&flow=xtls-rprx-vision`;
      return `${link}#${encodedEmail}`;
    } else if (security === 'tls') {
      const tlsSettings = streamSettings.tlsSettings || {};
      const sni = tlsSettings.serverName || (isIPOrEmpty ? "" : hostName); 
      let sniPart = sni ? `&sni=${sni}` : "";
      return `vless://${uuid}@${hostName}:${port}?type=tcp&security=tls${sniPart}#${encodedEmail}`;
    } else {
      return `vless://${uuid}@${hostName}:${port}?type=tcp&security=${security}#${encodedEmail}`;
    }
  }

  async getClientByEmail(inboundId: number, email: string) {
    if (!this.sessionCookie) await this.login();
    try {
      const getInboundUrl = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
      const resp = await axios.get(getInboundUrl, getRequestConfig(getInboundUrl, this.authHeaders()));
      if (resp.data.success && resp.data.obj) {
        const settings = JSON.parse(resp.data.obj.settings || '{}');
        const found = (settings.clients || []).find((c: any) => c.email === email);
        if (found) return { ...found, id: found.id || found.uuid, inboundId };
      }
      
      const inbounds = await this.getInbounds();
      for (const inbound of inbounds) {
        if (inbound.id === inboundId) continue;
        const settings = JSON.parse(inbound.settings || '{}');
        const found = (settings.clients || []).find((c: any) => c.email === email);
        if (found) return { ...found, id: found.id || found.uuid, inboundId: inbound.id };
      }
    } catch (e) {}
    return null;
  }

  async updateClient(email: string, uuid: string, inboundId: number, expiryTime: number, limitBytes: number = 0) {
    if (!this.sessionCookie) await this.login();

    let effectiveUuid = uuid;
    let effectiveInboundId = inboundId;
    
    const serverClient = await this.getClientByEmail(inboundId, email);
    if (serverClient) {
      if (serverClient.id) effectiveUuid = serverClient.id;
      if (serverClient.inboundId) effectiveInboundId = serverClient.inboundId;
    }

    if (!effectiveUuid) return false;

    let flow = "xtls-rprx-vision";
    const clientData = {
      id: effectiveInboundId,
      settings: JSON.stringify({
        clients: [{ id: effectiveUuid, flow, email, limitIp: 0, totalGB: limitBytes, expiryTime, enable: true, tgId: "", subId: "" }]
      })
    };

    try {
      const updateClientUrl = `${this.host}${this.basePath}/panel/api/inbounds/updateClient/${effectiveUuid}`;
      const response = await axios.post(updateClientUrl, clientData, getRequestConfig(updateClientUrl, this.authHeaders({ 'Content-Type': 'application/json' })));
      return !!response.data.success;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.updateClient(email, uuid, inboundId, expiryTime, limitBytes);
      }
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
        return { up: stats.up || 0, down: stats.down || 0, used: (stats.up || 0) + (stats.down || 0), limit: stats.total || 0 };
      }
    } catch (e) {}
    return null;
  }

  async deleteClient(uuid: string, email?: string) {
    if (!this.sessionCookie) await this.login();
    let effectiveUuid = uuid;
    if (email) {
      const inbounds = await this.getInbounds();
      for (const inbound of inbounds) {
        const serverClient = await this.getClientByEmail(inbound.id, email);
        if (serverClient?.id) { effectiveUuid = serverClient.id; break; }
      }
    }

    try {
      const deleteUrl = `${this.host}${this.basePath}/panel/api/inbounds/deleteClient/${effectiveUuid}`;
      const response = await axios.post(deleteUrl, {}, getRequestConfig(deleteUrl, this.authHeaders()));
      return !!response.data.success;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.deleteClient(uuid, email);
      }
      return error.response?.status === 404;
    }
  }

  async getOnlines() {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/onlines`;
      const response = await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
      if (response.data.success && Array.isArray(response.data.obj)) {
        return [...new Set(response.data.obj.map((item: any) => typeof item === 'string' ? item : item.email).filter(Boolean))];
      }
    } catch (e) {}
    return [];
  }
}

const xuiInstances = new Map<string, XUIService>();

export async function getXuiForServer(serverId?: string | null) {
  if (!serverId) {
    const defaultId = 'env_default';
    if (!xuiInstances.has(defaultId)) xuiInstances.set(defaultId, new XUIService());
    return { instance: xuiInstances.get(defaultId)!, server: null };
  }

  if (xuiInstances.has(serverId)) {
    const { data: server } = await supabase.from('vpn_servers').select('*').eq('id', serverId).maybeSingle();
    return { instance: xuiInstances.get(serverId)!, server };
  }

  const { data: server } = await supabase.from('vpn_servers').select('*').eq('id', serverId).maybeSingle();
  if (!server) {
    const defaultId = 'env_default';
    if (!xuiInstances.has(defaultId)) xuiInstances.set(defaultId, new XUIService());
    return { instance: xuiInstances.get(defaultId)!, server: null };
  }

  let host = "";
  let rawIp = (server.ip || '').trim();
  let domainOrPath = (server.domain || '').trim();

  if (rawIp.includes('://')) {
    host = rawIp;
    if (domainOrPath && (domainOrPath.startsWith('/') || !domainOrPath.includes('.'))) {
      const path = domainOrPath.startsWith('/') ? domainOrPath : '/' + domainOrPath;
      host = host.replace(/\/$/, '') + path;
    }
  } else {
    let ipPart = rawIp.split('/')[0];
    let pathPart = rawIp.includes('/') ? '/' + rawIp.split('/').slice(1).join('/') : "";
    if (domainOrPath) {
      if (domainOrPath.startsWith('/')) pathPart = domainOrPath;
      else if (!domainOrPath.includes('.')) pathPart = '/' + domainOrPath;
      else ipPart = domainOrPath;
    }
    const port = server.api_port || 2053;
    const protocol = [443, 8443, 2053].includes(port) ? 'https' : 'http';
    host = `${protocol}://${ipPart}:${port}${pathPart}`;
  }

  const instance = new XUIService({ host, username: server.username, password: server.password });
  if (server.domain && !server.domain.startsWith('/')) instance.displayDomain = server.domain;
  xuiInstances.set(serverId, instance);
  return { instance, server };
}
