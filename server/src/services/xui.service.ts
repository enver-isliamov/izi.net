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
    let host = (serverConfigs?.host || '').trim();
    this.username = (serverConfigs?.username || '').trim();
    this.password = (serverConfigs?.password || '').trim();

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
    if (value == null) return fallback;
    if (typeof value === 'object') return value as T;
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

    // Auto-resolve inboundId if 0 or invalid by finding reality inbound on port 443
    let effectiveInboundId = inboundId;
    if (!effectiveInboundId || effectiveInboundId <= 0) {
      try {
        const inbounds = await this.getInbounds();
        const realityInbound = inbounds.find((ib: any) => {
          try {
            const ss = typeof ib.streamSettings === 'string' ? JSON.parse(ib.streamSettings) : (ib.streamSettings || {});
            return ss.security === 'reality' && ib.port === 443;
          } catch { return false; }
        });
        if (realityInbound?.id) {
          effectiveInboundId = realityInbound.id;
          console.log(`[XUI] Auto-resolved reality inboundId=${effectiveInboundId} for ${email}`);
        }
      } catch (e: any) {
        console.warn(`⚠️ [XUI] Failed to auto-resolve inboundId: ${e.message}`);
      }
    }

    let flow = '';
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/get/${effectiveInboundId}`;
      const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
      if (resp.data?.success) {
        const streamSettings = this.parseJson<Record<string, any>>(resp.data.obj?.streamSettings, {});
        if (streamSettings.security === 'reality' && streamSettings.network === 'tcp') flow = 'xtls-rprx-vision';
      }
    } catch (e) {
      console.warn(`⚠️ [XUI] Could not fetch inbound settings for ${effectiveInboundId}`);
    }

    // Check if client already exists in this inbound
    try {
      const existingClient = await this.getClientByEmail(effectiveInboundId, email);
      if (existingClient?.id) {
        console.log(`🔄 [XUI] Client ${email} already exists in inbound ${effectiveInboundId} (uuid=${existingClient.id}) — updating instead`);
        const updated = await this.updateClient(email, existingClient.id, existingClient.inboundId || effectiveInboundId, expiryTime, limitBytes);
        if (updated) {
          return this.getInboundLink(existingClient.inboundId || effectiveInboundId, existingClient.id, email);
        }
        console.warn(`⚠️ [XUI] updateClient returned false for ${email} — trying to delete and re-add`);
        await this.deleteClient(existingClient.id, email).catch(() => {});
      }
    } catch (e) {}

    // New 3x-ui removed /panel/api/inbounds/addClient; the proven path is the full inbound update.
    return await this.addClientViaFullUpdate(email, uuid, effectiveInboundId, expiryTime, limitBytes);
  }

  private async addClientViaFullUpdate(email: string, uuid: string, inboundId: number, expiryTime: number = 0, limitBytes: number = 0): Promise<string> {
    await this.login();
    const getUrl = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
    const resp = await axios.get(getUrl, getRequestConfig(getUrl, this.authHeaders()));
    if (!resp.data?.success || !resp.data?.obj) throw new Error('Inbound not found for full update');
    const inbound = resp.data.obj;
    const settings = this.parseJson<Record<string, any>>(inbound.settings, {});
    if (!settings || typeof settings !== 'object') throw new Error('Inbound settings not parseable');
    const clients = Array.isArray(settings.clients) ? settings.clients : (settings.clients = []);
    if (!clients.some((c: any) => c.id === uuid)) {
      let flow = '';
      const streamSettings = this.parseJson<Record<string, any>>(inbound.streamSettings, {});
      if (streamSettings.security === 'reality' && streamSettings.network === 'tcp') flow = 'xtls-rprx-vision';
      clients.push({ id: uuid, flow, email, limitIp: 0, totalGB: limitBytes, expiryTime, enable: true, tgId: 0, subId: '' });
    }
    const payload = { ...inbound, settings };
    const updUrl = `${this.host}${this.basePath}/panel/api/inbounds/update/${inboundId}`;
    const updResp = await axios.post(updUrl, payload, getRequestConfig(updUrl, this.authHeaders({ 'Content-Type': 'application/json' })));
    if (!updResp.data?.success) throw new Error(updResp.data?.msg || 'Full inbound update failed');
    console.log(`[XUI] Client ${email} added via full inbound update (inbound ${inboundId})`);
    return this.getInboundLink(inboundId, uuid, email);
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
        const pbk = (realitySettings.publicKey || rs.publicKey || '').trim();
        const sid = (rs.shortIds?.[0] || realitySettings.shortIds?.[0]) || '';
        const fp = rs.fingerprint || realitySettings.fingerprint || 'chrome';
        const spiderX = rs.spiderX || realitySettings.spiderX || '/';
        const network = streamSettings.network || 'tcp';

        const issues: string[] = [];
        if (!pbk || pbk.includes('m_G-oZ_9a6')) issues.push('Public Key пуст или некорректен');
        if (!sid) issues.push('Short IDs пуст');
        if (!sni || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(sni)) issues.push('SNI пуст или является IP');

        if (issues.length > 0) {
          console.error(`❌ [XUI] Reality validation failed for ${email}: ${issues.join(', ')}`);
          throw new Error(`Reality настройки некорректны: ${issues.join(', ')}. Проверьте панель X-UI.`);
        }

        let transportParams = 'type=tcp';
        if (network === 'ws') {
          const wsPath = streamSettings.wsSettings?.path || '/ws';
          const wsHost = streamSettings.wsSettings?.headers?.Host || sni;
          transportParams = `type=ws&path=${encodeURIComponent(wsPath)}&host=${encodeURIComponent(wsHost)}`;
        } else if (network === 'xhttp') {
          const xhttpPath = streamSettings.xhttpSettings?.path || '/xhttp';
          const xhttpHost = streamSettings.xhttpSettings?.host || sni || 'www.cloudflare.com';
          transportParams = `type=xhttp&path=${encodeURIComponent(xhttpPath)}&host=${encodeURIComponent(xhttpHost)}`;
        } else if (network === 'grpc') {
          const grpcService = streamSettings.grpcSettings?.serviceName || '';
          transportParams = `type=grpc&serviceName=${encodeURIComponent(grpcService)}`;
        }

        console.log(`✅ [XUI] Reality link for ${email}: transport=${network}, SNI=${sni}, SID=${sid.substring(0, 10)}...`);
        const flowParam = network === 'tcp' ? '&flow=xtls-rprx-vision' : '';
        let link = `vless://${uuid}@${hostName}:${port}?${transportParams}&encryption=none&security=reality&sni=${encodeURIComponent(sni)}&pbk=${encodeURIComponent(pbk)}&fp=${fp}&sid=${encodeURIComponent(sid)}&spx=${encodeURIComponent(spiderX)}${flowParam}`;
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
        clients: [{ id: effectiveUuid, flow, email, limitIp: 0, totalGB: limitBytes, expiryTime, enable: true, tgId: 0, subId: '' }]
      })
    };

    try {
      // New 3x-ui client API: POST /panel/api/clients/update/:email
      const client = {
        id: effectiveUuid,
        flow,
        email,
        limitIp: 0,
        totalGB: limitBytes,
        expiryTime,
        enable: true,
        tgId: 0,
        subId: ''
      };
      const updUrl = `${this.host}${this.basePath}/panel/api/clients/update/${encodeURIComponent(email)}?inboundIds=${effectiveInboundId}`;
      const response = await axios.post(updUrl, client, getRequestConfig(updUrl, this.authHeaders({ 'Content-Type': 'application/json' })));
      if (response.data?.success) {
        console.log(`вњ… [XUI] Client ${email} updated on ${this.host}`);
        return true;
      }
      console.warn(`вљ пёЏ [XUI] updateClient failed for ${email}: ${response.data?.msg}`);
      return false;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.updateClient(email, uuid, inboundId, expiryTime, limitBytes);
      }
      console.error(`вќЊ [XUI] updateClient error: ${error.message}`);
      // Fallback: full inbound update (proven path for older panels)
      try {
        const getUrl = `${this.host}${this.basePath}/panel/api/inbounds/get/${effectiveInboundId}`;
        const getResp = await axios.get(getUrl, getRequestConfig(getUrl, this.authHeaders()));
        const inbound = getResp.data?.obj;
        const settings = this.parseJson<Record<string, any>>(inbound?.settings, {});
        const clients = Array.isArray(settings.clients) ? settings.clients : [];
        const idx = clients.findIndex((cl: any) => cl.id === effectiveUuid || cl.email === email);
        if (idx < 0) return false;
        clients[idx] = { ...clients[idx], totalGB: limitBytes, expiryTime, enable: true };
        const payload = { ...inbound, settings: JSON.stringify(settings) };
        const putUrl = `${this.host}${this.basePath}/panel/api/inbounds/update/${effectiveInboundId}`;
        const putResp = await axios.post(putUrl, payload, getRequestConfig(putUrl, this.authHeaders({ 'Content-Type': 'application/json' })));
        return !!putResp.data?.success;
      } catch (fallbackErr: any) {
        console.error(`вќЊ [XUI] updateClient fallback failed: ${fallbackErr.message}`);
        return false;
      }
    }
  }
  /** Инбаунды, в которые можно добавлять клиентов (кроме служебного api и dokodemo-door). */
  async getClientInbounds(): Promise<Array<{ id: number; port: number; protocol: string; network: string }>> {
    const inbounds = (await this.getInbounds()) as any[];
    const result: Array<{ id: number; port: number; protocol: string; network: string }> = [];
    for (const ib of inbounds || []) {
      if (ib.enable === false) continue;
      const protocol = String(ib.protocol || '').toLowerCase();
      if (!protocol || protocol === 'dokodemo-door' || protocol === 'tunnel') continue;
      if (ib.tag === 'api') continue;
      const settings = this.parseJson<any>(ib.settings, {});
      const hasClients = Array.isArray(settings?.clients);
      const supportsClients = ['vless', 'vmess', 'trojan', 'shadowsocks'].includes(protocol);
      if (!hasClients && !supportsClients) continue;
      const stream = this.parseJson<any>(ib.streamSettings, {});
      result.push({ id: ib.id, port: Number(ib.port || 0), protocol, network: String(stream?.network || 'tcp') });
    }
    return result;
  }

  /**
   * Гарантирует, что клиент есть во ВСЕХ инбаундах сервера, чтобы работали все транспорты.
   * Существующих клиентов не перезаписывает (это предотвращает разрыв активных соединений).
   */
  async ensureClientInAllInbounds(email: string, uuid: string, expiryTime: number, limitBytes: number) {
    const added: number[] = [];
    const existing: number[] = [];
    const failed: Array<{ inboundId: number; error: string }> = [];
    const targets = await this.getClientInbounds();
    for (const target of targets) {
      try {
        const current = await this.getClientByEmail(target.id, email);
        if (current?.id) { existing.push(target.id); continue; }
        await this.addClient(email, uuid, target.id, expiryTime, limitBytes);
        added.push(target.id);
      } catch (e: any) {
        failed.push({ inboundId: target.id, error: e.message });
      }
    }
    return {
      added,
      existing,
      failed,
      targets: targets.map((t) => ({ id: t.id, port: t.port, network: t.network }))
    };
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

    // New 3x-ui client API: POST /panel/api/clients/del/:email (deletes across inbounds)
    try {
      const delUrl = `${this.host}${this.basePath}/panel/api/clients/del/${encodeURIComponent(email || uuid)}`;
      const delResp = await axios.post(delUrl, {}, getRequestConfig(delUrl, this.authHeaders()));
      if (delResp.data?.success) {
        console.log(`вњ… [XUI] Client ${email || uuid} deleted from ${this.host}`);
        return;
      }
      console.warn(`вљ пёЏ [XUI] clients/del failed for ${email || uuid}: ${delResp.data?.msg} - falling back to full inbound update`);
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        await this.login(true);
        return this.deleteClient(uuid, email);
      }
      console.warn(`вљ пёЏ [XUI] clients/del error for ${email || uuid}: ${error.message} - falling back to full inbound update`);
    }
    // Fallback: delete via full inbound update
    const inbounds = await this.getInbounds();
    for (const inbound of inbounds) {
      const settings = this.parseJson<Record<string, any>>(inbound.settings, {});
      const clients = Array.isArray(settings.clients) ? settings.clients : [];
      const target = clients.find((c: any) => c.id === uuid || (email && c.email === email));
      if (!target) continue;

      const updatedClients = clients.filter((c: any) => c !== target);
      const newSettings = { ...settings, clients: updatedClients };
      const payload = { ...inbound, settings: JSON.stringify(newSettings) };
      const url = `${this.host}${this.basePath}/panel/api/inbounds/update/${inbound.id}`;
      const resp = await axios.post(url, payload, getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/json' })));
      if (resp.data?.success) {
        console.log(`✅ [XUI] Client ${email || uuid} deleted from ${this.host} (inbound ${inbound.id})`);
      } else {
        console.warn(`⚠️ [XUI] deleteClient failed for ${email || uuid}: ${resp.data?.msg}`);
      }
    }
  }

  async getClientTraffic(email: string) {
    if (!this.sessionCookie) await this.login();
    // New 3x-ui client API: GET /panel/api/clients/traffic/:email
    try {
      const url = `${this.host}${this.basePath}/panel/api/clients/traffic/${encodeURIComponent(email)}`;
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
      // Fallback: stats embedded in the /list payload (clientStats per inbound)
      const inbounds = await this.getInbounds();
      for (const inbound of inbounds) {
        const clientStats = Array.isArray(inbound.clientStats) ? inbound.clientStats : [];
        const stats = clientStats.find((s: any) => s.email === email || s.email === `izinet_${email}`);
        if (stats) {
          return { up: stats.up || 0, down: stats.down || 0, used: (stats.up || 0) + (stats.down || 0), limit: stats.total || 0 };
        }
      }
      return null;
    }
  }

  async getSettings(): Promise<XuiSettings> {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/api/setting/all`;
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
      const url = `${this.host}${this.basePath}/panel/api/setting/update`;
      const encodedData = new URLSearchParams();
      for (const key in settings) {
        const value = (settings as any)[key];
        if (typeof value === 'object') {
          encodedData.append(key, JSON.stringify(value));
        } else {
          encodedData.append(key, String(value));
        }
      }
      await axios.post(url, encodedData.toString(), getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' })));
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
      const url = `${this.host}${this.basePath}/panel/api/setting/restartPanel`;
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
      const url = `${this.host}${this.basePath}/panel/api/clients/resetTraffic/${encodeURIComponent(email)}`;
      await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
      console.log(`✅ [XUI] Traffic reset for ${email}`);
    } catch (err: any) {
      console.warn(`⚠️ [XUI] Could not reset traffic for ${email}: ${err.message}`);
    }
  }

  async getOnlines(): Promise<string[]> {
    if (!this.sessionCookie) await this.login();
    try {
      const url = `${this.host}${this.basePath}/panel/api/clients/onlines`;
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

  const panelHost = server.ip || server.domain || '';
  const displayHost = server.public_host || server.domain || '';
  const inboundId = server.inbound_id || 0;

  const cacheKey = `${panelHost}_${server.username}`;
  let instance = xuiInstances.get(cacheKey);

  if (!instance) {
    instance = new XUIService({ host: panelHost, username: server.username, password: server.password });
    if (displayHost && !displayHost.startsWith('/')) {
      instance.displayDomain = displayHost;
    }
    xuiInstances.set(cacheKey, instance);
  }

  return { instance, server: { ...server, inbound_id: inboundId, public_host: displayHost } };
}
