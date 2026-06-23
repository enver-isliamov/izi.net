import axios from 'axios';
import { getRequestConfig } from '../utils/axios';
import { supabase } from './supabase';
import fs from 'fs';

interface XuiInbound {
  id: number;
  port?: number;
  protocol?: string;
  settings?: string;
  streamSettings?: string;
  [key: string]: unknown;
}

interface XuiSettings {
  xrayTemplateConfig?: string;
  [key: string]: unknown;
}

export class XUIService {
  public host: string;
  public basePath: string = '';
  public displayDomain: string = '';
  private username: string;
  private password: string;
  private sessionCookie: string | null = null;
  private csrfToken: string | null = null;
  private lastLoginTime: number = 0;
  private readonly SESSION_TTL = 10 * 60 * 1000;

  constructor(serverConfigs?: { host?: string, username?: string, password?: string }) {
    let host = (serverConfigs?.host || process.env.XUI_HOST || '').trim();
    this.username = (serverConfigs?.username || process.env.XUI_USERNAME || '').trim();
    this.password = (serverConfigs?.password || process.env.XUI_PASSWORD || '').trim();

    if (host && !host.startsWith('http://') && !host.startsWith('https://')) {
      host = 'http://' + host;
    }

    // Устанавливаем displayDomain ДО перезаписи
    try {
      if (host) {
        const url = new URL(host);
        this.displayDomain = url.hostname;
      }
    } catch (_) {}

    // Local routing: rewrite local IPs to Docker internal
    if (host) {
      try {
        const parsedUrl = new URL(host);
        const hn = parsedUrl.hostname;
        const isDocker = fs.existsSync('/.dockerenv');
        if (hn === '194.50.94.28' || hn === 'izinet.online' || hn === 'vpn.izinet.online' || hn === 'localhost' || hn === '127.0.0.1') {
          if (isDocker) {
            host = `http://x3-ui:2053${parsedUrl.pathname}`;
          } else {
            const port = parsedUrl.port || '2053';
            host = `http://127.0.0.1:${port}${parsedUrl.pathname}`;
          }
        }
      } catch (e) {}
    }

    // Парсим host в this.host + this.basePath
    try {
      if (host) {
        const url = new URL(host);
        this.host = `${url.protocol}//${url.host}`;
        let path = url.pathname.replace(/\/+$/, '');
        this.basePath = path && !path.startsWith('/') ? '/' + path : path;
      } else {
        this.host = '';
        this.basePath = '';
      }
    } catch (e) {
      this.host = host.replace(/\/+$/, '').replace(/\/panel$/, '');
      this.basePath = '';
    }
  }

  async login(force: boolean = false): Promise<string> {
    if (!this.host) throw new Error('XUI_HOST is empty');
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
        if (csrfData && csrfData.cookieStr) response.headers['x-passed-cookie'] = csrfData.cookieStr;
        return response;
      } catch (err: any) {
        lastError = err;
        try {
          const response = await axios.post(url, jsonPayload, getRequestConfig(url, customHeaders));
          if (csrfData && csrfData.cookieStr) response.headers['x-passed-cookie'] = csrfData.cookieStr;
          return response;
        } catch (innerErr: any) {
          lastError = innerErr;
          return null;
        }
      }
    };

    try {
      // Step 1: Pre-flight — cookies + CSRF token
      let csrfToken = '';
      let cookies: string[] = [];
      try {
        const rootUrl = `${this.host}${this.basePath}/`;
        const rootRes = await axios.get(rootUrl, getRequestConfig(rootUrl, {}, 5000));
        if (rootRes.headers['set-cookie']) cookies = cookies.concat(rootRes.headers['set-cookie']);
      } catch (e) {}

      try {
        const csrfUrl = `${this.host}${this.basePath}/csrf-token`;
        const csrfRes = await axios.get(csrfUrl, getRequestConfig(csrfUrl, { Cookie: cookies.join(';') }, 5000));
        if (csrfRes.data?.success && csrfRes.data?.obj) csrfToken = csrfRes.data.obj;
        if (csrfRes.headers['set-cookie']) cookies = cookies.concat(csrfRes.headers['set-cookie']);
      } catch (e) {}

      const csrfData = csrfToken ? { token: csrfToken, cookieStr: cookies.join(';') } : undefined;

      // Step 2: Try login endpoints
      let response = await tryLogin('/login', csrfData);
      if (!response) response = await tryLogin('', csrfData);
      if (!response) response = await tryLogin('/panel/login', csrfData);

      if (!response) {
        let msg = `Could not find login endpoint at ${this.host}${this.basePath}.`;
        if (lastError?.response?.status === 403) {
          msg = `Login blocked (403 Forbidden). Rate limit/Fail2Ban active, or WAF blocking.`;
        }
        throw new Error(msg);
      }

      if (response.data?.success === false) throw new Error(response.data.msg || 'Login failed');

      const cookie = response.headers['set-cookie']?.[0] || response.headers['x-passed-cookie'];
      if (!cookie) throw new Error('No cookie received from 3x-ui');

      this.sessionCookie = cookie;
      if (csrfData?.token) this.csrfToken = csrfData.token;
      this.lastLoginTime = Date.now();
      console.log(`✅ [XUI] Login success: ${this.host}${this.basePath}`);
      return cookie;
    } catch (error: any) {
      console.error(`❌ [XUI] Login failed at ${this.host}${this.basePath}:`, error.message);
      throw error;
    }
  }

  authHeaders(extra: any = {}) {
    const headers: any = { ...extra };
    if (this.sessionCookie) headers['Cookie'] = this.sessionCookie;
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    return headers;
  }

  private parseJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string' || value.trim() === '') return fallback;
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }

  async checkHealth(): Promise<boolean> {
    if (!this.host) throw new Error('Host is not configured');
    try {
      await this.getInbounds();
      return true;
    } catch (e: any) {
      console.error(`❌ [XUI] Connection failed [${this.host}${this.basePath}]:`, e.message);
      return false;
    }
  }

  async checkConfig(): Promise<boolean> {
    return this.checkHealth();
  }

  async getInbounds(): Promise<XuiInbound[]> {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/list`;
      const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
      return Array.isArray(resp.data?.obj) ? resp.data.obj : [];
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.getInbounds();
      }
      console.warn(`⚠️ [XUI] getInbounds error: ${error.message}`);
      return [];
    }
  }

  async addInbound(inboundData: any): Promise<any> {
    await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/add`;
      const response = await axios.post(url, inboundData, getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/json' })));
      if (response.data?.success) {
        console.log(`✅ [XUI] Inbound added: ${inboundData.remark || inboundData.tag}`);
        return response.data.obj;
      }
      throw new Error(response.data?.msg || 'Failed to add inbound');
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        return this.addInbound(inboundData);
      }
      console.error(`❌ [XUI] addInbound error: ${error.message}`);
      throw error;
    }
  }

  async addClient(email: string, uuid: string, inboundId: number, expiryTime: number = 0, limitBytes: number = 0) {
    await this.login();

    let flow = '';
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
      const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
      if (resp.data?.success) {
        const streamSettings = this.parseJson<Record<string, any>>(resp.data.obj?.streamSettings, {});
        if (streamSettings.security === 'reality') flow = 'xtls-rprx-vision';
      }
    } catch (e) {
      console.warn(`⚠️ [XUI] Could not fetch inbound settings for ${inboundId}`);
    }

    // Check if client already exists in this inbound
    try {
      const existingClient = await this.getClientByEmail(inboundId, email);
      if (existingClient?.id) {
        console.log(`🔄 [XUI] Client ${email} already exists in inbound ${inboundId} (uuid=${existingClient.id}) — updating instead`);
        await this.updateClient(email, existingClient.id, existingClient.inboundId || inboundId, expiryTime, limitBytes);
        return this.getInboundLink(existingClient.inboundId || inboundId, existingClient.id, email);
      }
    } catch (e) {}

    const clientData = {
      id: inboundId,
      settings: JSON.stringify({
        clients: [{ id: uuid, flow, email, limitIp: 0, totalGB: limitBytes, expiryTime, enable: true, tgId: '', subId: '' }]
      })
    };

    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/addClient`;
      const response = await axios.post(url, clientData, getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/json' })));

      if (response.data?.success) {
        console.log(`✅ [XUI] Client ${email} added to ${this.host} (inbound ${inboundId})`);
        return this.getInboundLink(inboundId, uuid, email);
      } else {
        const msg = response.data?.msg || JSON.stringify(response.data);
        console.error(`❌ [XUI] addClient failed for ${email}: ${msg}`);
        // If "Duplicate email" — client exists somewhere, use updateClient fallback
        if (msg.includes('Duplicate email')) {
          console.log(`🔄 [XUI] Duplicate email detected — searching all inbounds for ${email}`);
          const allInbounds = await this.getInbounds();
          for (const ib of allInbounds) {
            try {
              const settings = this.parseJson<any>(ib.settings, {});
              const found = (settings.clients || []).find((c: any) => c.email === email);
              if (found) {
                console.log(`🔄 [XUI] Found ${email} in inbound ${ib.id} — updating`);
                await this.updateClient(email, found.id || found.uuid, ib.id, expiryTime, limitBytes);
                return this.getInboundLink(ib.id, found.id || found.uuid, email);
              }
            } catch (e) {}
          }
        }
        throw new Error(msg || 'Failed to add client');
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        this.csrfToken = null;
        return this.addClient(email, uuid, inboundId, expiryTime, limitBytes);
      }
      console.error(`❌ [XUI] addClient error for ${email}: ${error.message}`);
      throw error;
    }
  }

  async getInboundLink(inboundId: number, uuid: string, email: string): Promise<string> {
    if (!this.sessionCookie) await this.login();

    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
      const resp = await axios.get(url, getRequestConfig(url, this.authHeaders(), 10000));
      if (!resp.data?.success || !resp.data?.obj) throw new Error('Inbound not found');

      const inbound = resp.data.obj;
      const inboundSettings = this.parseJson<any>(inbound.settings, {});
      const streamSettings = this.parseJson<any>(inbound.streamSettings, {});
      const port = inbound.port;
      const encodedEmail = encodeURIComponent(`izinet_${email}`);
      const hostName = this.displayDomain || 'server.izinet.app';

      const security = streamSettings.security || 'none';

      if (security === 'reality') {
        const realitySettings = streamSettings.realitySettings || {};
        const rs = realitySettings.settings || realitySettings;
        const sni = rs.serverNames?.[0] || realitySettings.serverNames?.[0] || (hostName && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostName) ? hostName : 'www.microsoft.com');
        const pbk = (rs.publicKey || realitySettings.publicKey || '').trim();
        const sid = (rs.shortIds?.[0] || realitySettings.shortIds?.[0]) || '';
        const fp = rs.fingerprint || realitySettings.fingerprint || 'chrome';
        const spiderX = rs.spiderX || realitySettings.spiderX || '/';

        // Валидация Reality параметров
        const issues: string[] = [];
        if (!pbk || pbk.includes('m_G-oZ_9a6')) issues.push('Public Key пуст или некорректен');
        if (!sid) issues.push('Short IDs пуст');
        if (!sni || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(sni)) issues.push('SNI пуст или является IP');

        if (issues.length > 0) {
          console.error(`❌ [XUI] Reality validation failed for ${email}: ${issues.join(', ')}`);
          throw new Error(`Reality настройки некорректны: ${issues.join(', ')}. Проверьте панель X-UI.`);
        }

        console.log(`✅ [XUI] Reality link for ${email}: SNI=${sni}, SID=${sid.substring(0, 10)}...`);
        let link = `vless://${uuid}@${hostName}:${port}?type=tcp&encryption=none&security=reality&sni=${encodeURIComponent(sni)}&pbk=${encodeURIComponent(pbk)}&fp=${fp}&sid=${encodeURIComponent(sid)}&spx=${encodeURIComponent(spiderX)}&flow=xtls-rprx-vision`;
        return `${link}#${encodedEmail}`;
      }

      if (security === 'tls') {
        const tlsSettings = streamSettings.tlsSettings || {};
        const sni = tlsSettings.serverNames?.[0] || hostName;
        return `vless://${uuid}@${hostName}:${port}?type=tcp&security=tls&sni=${encodeURIComponent(sni)}&fp=${streamSettings.fingerprint || 'chrome'}#${encodedEmail}`;
      }

      return `vless://${uuid}@${hostName}:${port}?type=tcp&encryption=none#${encodedEmail}`;
    } catch (err: any) {
      console.error(`❌ [XUI] getInboundLink failed for ${this.host}, inbound ${inboundId}:`, err.message);
      throw err;
    }
  }

  async getClientByEmail(inboundId: number, email: string) {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
      const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
      if (resp.data?.success && resp.data?.obj) {
        const settings = this.parseJson<any>(resp.data.obj.settings, {});
        const found = (settings.clients || []).find((c: any) => c.email === email);
        if (found) return { ...found, id: found.id || found.uuid, inboundId };
      }
      const inbounds = await this.getInbounds();
      for (const ib of inbounds) {
        if (ib.id === inboundId) continue;
        const settings = this.parseJson<any>(ib.settings, {});
        const found = (settings.clients || []).find((c: any) => c.email === email);
        if (found) return { ...found, id: found.id || found.uuid, inboundId: ib.id };
      }
    } catch (e: any) {
      console.warn(`⚠️ [XUI] Error getting client by email ${email}: ${e.message}`);
    }
    return null;
  }

  async updateClient(email: string, uuid: string, inboundId: number, expiryTime: number, limitBytes: number = 0): Promise<boolean> {
    await this.login();

    let effectiveUuid = uuid;
    let effectiveInboundId = inboundId;

    const serverClient = await this.getClientByEmail(inboundId, email);
    if (serverClient) {
      if (serverClient.id) effectiveUuid = serverClient.id;
      if (serverClient.inboundId) effectiveInboundId = serverClient.inboundId;
    }

    if (!effectiveUuid) return false;

    let flow = 'xtls-rprx-vision';
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/get/${effectiveInboundId}`;
      const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
      if (resp.data?.success) {
        const streamSettings = this.parseJson<any>(resp.data.obj?.streamSettings, {});
        if (streamSettings.security === 'reality') flow = 'xtls-rprx-vision';
      }
    } catch (e) {}

    const clientData = {
      id: effectiveInboundId,
      settings: JSON.stringify({
        clients: [{ id: effectiveUuid, flow, email, limitIp: 0, totalGB: limitBytes, expiryTime, enable: true, tgId: '', subId: '' }]
      })
    };

    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/updateClient/${effectiveUuid}`;
      const response = await axios.post(url, clientData, getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/json' })));
      if (response.data?.success) {
        console.log(`✅ [XUI] Client ${email} updated on ${this.host}`);
        return true;
      }
      return false;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.updateClient(email, uuid, inboundId, expiryTime, limitBytes);
      }
      console.error(`❌ [XUI] updateClient error: ${error.message}`);
      return false;
    }
  }

  async deleteInbound(inboundId: number): Promise<void> {
    await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/del/${inboundId}`;
      await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
      console.log(`✅ [XUI] Inbound ${inboundId} deleted from ${this.host}`);
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.deleteInbound(inboundId);
      }
      console.warn(`⚠️ [XUI] deleteInbound error: ${error.message}`);
    }
  }

  async deleteClient(uuid: string, email?: string) {
    if (!this.sessionCookie) await this.login();

    let effectiveUuid = uuid;

    if (email) {
      try {
        const inbounds = await this.getInbounds();
        for (const inbound of inbounds) {
          const serverClient = await this.getClientByEmail(inbound.id, email);
          if (serverClient?.id) {
            effectiveUuid = serverClient.id;
            break;
          }
        }
      } catch (e) {}
    }

    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/deleteClient/${effectiveUuid}`;
      await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
      console.log(`✅ [XUI] Client ${email || effectiveUuid} deleted from ${this.host}`);
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.deleteClient(uuid, email);
      }
      if (error.response?.status === 404) return;
      console.warn(`⚠️ [XUI] deleteClient error: ${error.message}`);
    }
  }

  async getClientTraffic(email: string) {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/getClientTraffics/${email}`;
      const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
      if (resp.data?.success && resp.data?.obj) {
        const stats = resp.data.obj;
        return { up: stats.up || 0, down: stats.down || 0, used: (stats.up || 0) + (stats.down || 0), limit: stats.total || 0 };
      }
      return null;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        return this.getClientTraffic(email);
      }
      console.warn(`⚠️ [XUI] Could not read traffic for ${email}: ${error.message}`);
      return null;
    }
  }

  async getSettings(): Promise<XuiSettings> {
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

  async updateSettings(settings: XuiSettings): Promise<void> {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/setting/update`;
      await axios.post(url, settings, getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/json' })));
    } catch (e: any) {
      if (e.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.updateSettings(settings);
      }
      throw e;
    }
  }

  async restartPanel(): Promise<void> {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/setting/restartPanel`;
      await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
    } catch (e) {}
  }

  async syncRealityKeys(privateKey: string, publicKey: string): Promise<void> {
    // DEPRECATED: Reality keys should be managed by xui_bootstrap.py in SQLite.
    // This method is kept only for manual admin override via /api/admin/system/sync-reality-keys.
    if (!privateKey || !publicKey) return;
    console.warn(`⚠️ [XUI] syncRealityKeys called manually for ${this.host}. Consider using xui_bootstrap.py instead.`);
    try {
      const inbounds = await this.getInbounds();
      const realityInbounds = inbounds.filter((ib) => this.parseJson<Record<string, any>>(ib.streamSettings, {}).security === 'reality');
      for (const inbound of realityInbounds) {
        const streamSettings = this.parseJson<Record<string, any>>(inbound.streamSettings, {});
        const realitySettings = streamSettings.realitySettings || {};
        if (realitySettings.privateKey === privateKey && realitySettings.publicKey === publicKey) continue;
        streamSettings.realitySettings = { ...realitySettings, privateKey, publicKey };
        const payload = { ...inbound, streamSettings: JSON.stringify(streamSettings) };
        const url = `${this.host}${this.basePath}/panel/api/inbounds/update/${inbound.id}`;
        await axios.post(url, payload, getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/json' })));
        console.log(`✅ [XUI] Reality keys updated on ${this.host}`);
      }
    } catch (err: any) {
      console.warn(`⚠️ [XUI] Reality key sync failed for ${this.host}: ${err.message}`);
    }
  }

  async checkRealityInbound(): Promise<{ exists: boolean; hasValidKeys: boolean; sni?: string; details?: string }> {
    try {
      const inbounds = await this.getInbounds();
      const realityInbound = inbounds.find((ib) => {
        const ss = this.parseJson<Record<string, any>>(ib.streamSettings, {});
        return ss.security === 'reality' && ib.port === 443;
      });

      if (!realityInbound) {
        return { exists: false, hasValidKeys: false, details: 'Reality inbound on port 443 not found. Run: python3 xui_bootstrap.py' };
      }

      const ss = this.parseJson<Record<string, any>>(realityInbound.streamSettings, {});
      const rs = ss.realitySettings || {};
      const settings = rs.settings || rs;
      const pbk = settings.publicKey || rs.publicKey || '';
      const sid = (settings.shortIds || rs.shortIds || [])[0] || '';
      const sni = (settings.serverName || (settings.serverNames || rs.serverNames || [])[0] || '');
      const fp = settings.fingerprint || rs.fingerprint || '';
      const spiderX = settings.spiderX || rs.spiderX || '';

      const issues: string[] = [];
      if (!pbk || pbk.includes('m_G-oZ_9a6')) issues.push('publicKey is empty or invalid');
      if (!sid) issues.push('shortIds is empty');
      if (!sni || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(sni)) issues.push('SNI is empty or an IP address');
      if (fp && fp !== 'chrome') issues.push(`fingerprint is "${fp}" (should be "chrome")`);
      if (spiderX && spiderX !== '/') issues.push(`spiderX is "${spiderX}" (should be "/")`);

      return {
        exists: true,
        hasValidKeys: issues.length === 0,
        sni,
        details: issues.length > 0 ? `Issues: ${issues.join('; ')}` : 'OK'
      };
    } catch (err: any) {
      return { exists: false, hasValidKeys: false, details: `Error: ${err.message}` };
    }
  }

  async resetClientTraffic(inboundId: number, email: string): Promise<void> {
    try {
      await this.login();
      const url = `${this.host}${this.basePath}/panel/api/inbounds/${inboundId}/resetClientTraffic/${encodeURIComponent(email)}`;
      await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
      console.log(`✅ [XUI] Traffic reset for ${email}`);
    } catch (err: any) {
      console.warn(`⚠️ [XUI] Could not reset traffic for ${email}: ${err.message}`);
    }
  }

  async getOnlines(): Promise<string[]> {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/onlines`;
      const response = await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
      if (response.data?.success && Array.isArray(response.data.obj)) {
        const uniqueOnlines = [...new Set((response.data.obj as any[]).map((item: any) => typeof item === 'string' ? item : item.email).filter(Boolean))];
        return uniqueOnlines;
      }
      return [];
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.getOnlines();
      }
      console.warn(`⚠️ [XUI] getOnlines error: ${error.message}`);
      return [];
    }
  }

  async listClients(): Promise<any[]> {
    if (!this.sessionCookie) await this.login();
    try {
      const inbounds = await this.getInbounds();
      let allClients: any[] = [];
      for (const inbound of inbounds) {
        const settings = this.parseJson<any>(inbound.settings, {});
        allClients = allClients.concat(settings.clients || []);
      }
      return allClients;
    } catch (e: any) {
      if (e.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.listClients();
      }
      console.warn(`⚠️ [XUI] listClients error: ${e.message}`);
      return [];
    }
  }

  generateVlessLink(uuid: string, email: string, customDomain?: string, port: number = 443) {
    throw new Error(`[XUI] Используйте getInboundLink() вместо generateVlessLink()`);
  }
}

// Кэш экземпляров XUIService
const xuiInstances = new Map<string, XUIService>();

export async function getXuiForServer(serverId: string) {
  const { data: server, error } = await supabase.from('vpn_servers').select('*').eq('id', serverId).single();
  if (error || !server) throw new Error('Server not found');

  const cacheKey = `${server.ip || server.domain}_${server.username}`;
  let instance = xuiInstances.get(cacheKey);

  if (!instance) {
    instance = new XUIService({ host: server.ip || server.domain, username: server.username, password: server.password });
    if (server.domain && !server.domain.startsWith('/')) {
      instance.displayDomain = server.domain;
    }
    xuiInstances.set(cacheKey, instance);
  }

  return { instance, server };
}
