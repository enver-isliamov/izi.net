import axios from 'axios';
import { getRequestConfig } from '../utils/axios';
import { supabase } from './supabase';

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
    this.username = (serverConfigs?.username || process.env.XUI_USERNAME || 'admin').trim();
    this.password = (serverConfigs?.password || process.env.XUI_PASSWORD || 'admin').trim();

    if (host && !host.startsWith('http')) {
      host = 'http://' + host;
    }

    if (host) {
      try {
        const parsedUrl = new URL(host);
        const hn = parsedUrl.hostname;
        const configDomain = (process.env.DOMAIN || '').trim();

        const isLocalHost = hn === 'localhost' || hn === '127.0.0.1' || (configDomain && hn === configDomain);
        const isDockerEnv = process.env.IS_DOCKER === 'true' || process.env.NODE_ENV === 'production';

        if (isLocalHost && isDockerEnv) {
          host = `http://x3-ui:2053${parsedUrl.pathname}`;
        }
        this.displayDomain = hn;
        this.basePath = parsedUrl.pathname.replace(/\/$/, '');
      } catch (e) {}
    }
    this.host = host;
  }

  private async login() {
    const now = Date.now();
    if (this.sessionCookie && (now - this.lastLoginTime < this.SESSION_TTL)) return;

    const baseUrl = `${this.host}${this.basePath}`.replace(/\/$/, '');
    let lastError: any = null;

    try {
      // Шаг 1: GET корневую страницу — получаем cookies (включая lang)
      let cookies: string[] = ['lang=ru-RU'];
      try {
        const rootRes = await axios.get(baseUrl, getRequestConfig(baseUrl, {}, 5000));
        if (rootRes.headers['set-cookie']) {
          cookies = cookies.concat(rootRes.headers['set-cookie']);
        }
      } catch (e) { /* ignore */ }

      // Шаг 2: GET /csrf-token — получаем CSRF token
      let csrfToken = '';
      try {
        const csrfUrl = `${baseUrl}/csrf-token`;
        const csrfRes = await axios.get(csrfUrl, getRequestConfig(csrfUrl, { Cookie: cookies.join(';') }, 5000));
        if (csrfRes.data?.success && csrfRes.data?.obj) {
          csrfToken = csrfRes.data.obj;
        }
        if (csrfRes.headers['set-cookie']) {
          cookies = cookies.concat(csrfRes.headers['set-cookie']);
        }
      } catch (e) { /* CSRF endpoint might not exist */ }

      const allCookies = cookies.join('; ');

      // Шаг 3: Пробуем POST /login с form-urlencoded (стандарт 3x-ui)
      const tryLogin = async (path: string, useForm = false): Promise<any> => {
        const url = `${baseUrl}${path}`;
        const headers: any = {
          'Cookie': allCookies,
          'x-requested-with': 'XMLHttpRequest'
        };
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

        if (useForm) {
          const payload = `username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
          return await axios.post(url, payload, getRequestConfig(url, {
            'Content-Type': 'application/x-www-form-urlencoded',
            ...headers
          }));
        }

        return await axios.post(url, { username: this.username, password: this.password }, getRequestConfig(url, headers));
      };

      // Пробуем разные пути
      let response = null;
      for (const path of ['/login', '', '/panel/login']) {
        if (response) break;
        try { response = await tryLogin(path, true); } catch (e) { lastError = e; }
        if (!response) try { response = await tryLogin(path, false); } catch (e) { lastError = e; }
      }

      if (!response) throw lastError || new Error('Could not find login endpoint');
      if (response.data?.success === false) throw new Error(response.data.msg || 'Login failed');

      // Шаг 4: Сохраняем session cookie
      const cookie = response.headers['set-cookie']?.[0] || response.headers['x-passed-cookie'];
      if (!cookie) throw new Error('No cookie received');

      this.sessionCookie = cookie;
      if (csrfToken) this.csrfToken = csrfToken;
      this.lastLoginTime = now;
      console.log(`✅ [XUI] Login success: ${this.host}`);
    } catch (err: any) {
      console.error(`❌ [XUI] Login failed at ${this.host}: ${err.response?.data?.message || err.message}`);
      throw err;
    }
  }

  private authHeaders(extra: Record<string, string> = {}) {
    const headers: any = { ...extra };
    if (this.sessionCookie) headers['Cookie'] = this.sessionCookie;
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    return headers;
  }

  private parseJson<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string' || value.trim() === '') return fallback;
    try {
      return JSON.parse(value) as T;
    } catch (err) {
      console.warn(`⚠️ [XUI] Invalid JSON detected, using fallback:`, (err as Error).message);
      return fallback;
    }
  }

  private validateJsonOrThrow(value: string, fieldName: string): void {
    if (!value || value.trim() === '') return;
    try {
      JSON.parse(value);
    } catch (err) {
      throw new Error(`INFRA-003: Invalid JSON in ${fieldName}: ${(err as Error).message}`);
    }
  }

  private async getInbounds(): Promise<XuiInbound[]> {
    await this.login();
    const listUrl = `${this.host}${this.basePath}/panel/api/inbounds/list`;
    const resp = await axios.get(listUrl, getRequestConfig(listUrl, this.authHeaders()));
    return Array.isArray(resp.data?.obj) ? resp.data.obj : [];
  }

  private findRealityInbound(inbounds: XuiInbound[], fallbackId: number): XuiInbound | undefined {
    return inbounds.find((ib) => {
      const streamSettings = this.parseJson<Record<string, any>>(ib.streamSettings, {});
      return ib.port === 443 || streamSettings.security === 'reality';
    }) || inbounds.find((ib) => ib.id === fallbackId);
  }

  async addClient(email: string, uuid: string, inboundId: number, expiryTime: number = 0, limitBytes: number = 0) {
    await this.login();

    let targetInboundId = inboundId;
    try {
      const realityInbound = this.findRealityInbound(await this.getInbounds(), inboundId);
      if (realityInbound) targetInboundId = realityInbound.id;
    } catch (e) {
      console.warn(`⚠️ [XUI] Could not fetch inbound list, using default ID: ${inboundId}`);
    }

    const clientData = {
      id: targetInboundId,
      settings: JSON.stringify({
        clients: [{ id: uuid, flow: 'xtls-rprx-vision', email: email, limitIp: 1, // CORE-007: Limit simultaneous sessions
        totalGB: limitBytes, expiryTime: expiryTime, enable: true }]
      })
    };

    const url = `${this.host}${this.basePath}/panel/api/inbounds/addClient`;
    await axios.post(url, clientData, getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/json' })));
    return this.getInboundLink(targetInboundId, uuid, email);
  }

  async getInboundLink(inboundId: number, uuid: string, email: string): Promise<string> {
    try {
      await this.login();
      const url = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
      const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
      if (!resp.data?.success || !resp.data?.obj) throw new Error('Inbound not found');

      const inbound = resp.data.obj;
      const streamSettings = this.parseJson<Record<string, any>>(inbound.streamSettings, {});
      const port = inbound.port;
      const encodedEmail = encodeURIComponent(`izinet_${email}`);

      const { data: server } = await supabase.from('vpn_servers')
        .select('ip, domain')
        .or(`ip.ilike.%${this.displayDomain}%,domain.eq.${this.displayDomain}`)
        .maybeSingle();

      let connectAddress = server?.ip || server?.domain || this.displayDomain;
      const cleanHost = (str: string) => {
        if (!str) return str;
        return str.trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0].replace(/[^a-zA-Z0-9.\-]/g, '');
      };
      connectAddress = cleanHost(connectAddress);

      if (streamSettings.security === 'reality') {
        const rs = streamSettings.realitySettings || {};
        const sni = rs.serverNames?.[0] || 'www.microsoft.com';
        const pbk = (process.env.XUI_REALITY_PUB_KEY || rs.publicKey || '').trim();
        const sid = rs.shortIds?.[0] || '79b27cf7799d5b4c';

        return `vless://${uuid}@${connectAddress}:${port}?type=tcp&encryption=none&security=reality&sni=${encodeURIComponent(sni)}&pbk=${encodeURIComponent(pbk)}&fp=chrome&sid=${encodeURIComponent(sid)}&spx=%2F&flow=xtls-rprx-vision#${encodedEmail}`;
      }
      return `vless://${uuid}@${connectAddress}:${port}?type=tcp&encryption=none&security=none#${encodedEmail}`;
    } catch (err: any) {
      // CORE-002: Ошибка генерации ссылки должна логироваться с контекстом и возвращаться вызывающему коду, а не ронять Node.js необработанным исключением.
      console.error(`❌ [XUI] getInboundLink failed for inbound ${inboundId}, email ${email}:`, err.message);
      throw err;
    }
  }

  async checkHealth(): Promise<boolean> {
    try { await this.login(); return true; } catch (e) { return false; }
  }

  async checkConfig(): Promise<boolean> {
    // CORE-003: maintenance исторически вызывает checkConfig(); оставляем совместимую обертку над реальной проверкой здоровья панели.
    return this.checkHealth();
  }

  async getClientTraffic(email: string): Promise<{ up: number; down: number; used: number } | null> {
    try {
      await this.login();
      const url = `${this.host}${this.basePath}/panel/api/inbounds/getClientTraffics/${encodeURIComponent(email)}`;
      const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
      const obj = resp.data?.obj;
      if (!resp.data?.success || !obj) return null;
      const up = Number(obj.up || 0);
      const down = Number(obj.down || 0);
      return { up, down, used: up + down };
    } catch (err: any) {
      console.warn(`⚠️ [XUI] Could not read traffic for ${email}: ${err.message}`);
      return null;
    }
  }

  async getSettings(): Promise<XuiSettings> {
    await this.login();
    const candidates = [
      `${this.host}${this.basePath}/panel/api/server/getConfig`,
      `${this.host}${this.basePath}/panel/api/server/getXrayConfig`
    ];

    let lastError: unknown;
    for (const url of candidates) {
      try {
        const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
        if (resp.data?.success && resp.data?.obj) return resp.data.obj;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('XUI settings endpoint unavailable');
  }

  async updateSettings(settings: XuiSettings): Promise<void> {
    await this.login();

    // INFRA-003: Validate xrayTemplateConfig before saving
    if (settings.xrayTemplateConfig) {
      this.validateJsonOrThrow(settings.xrayTemplateConfig, 'xrayTemplateConfig');
    }

    const candidates = [
      `${this.host}${this.basePath}/panel/api/server/updateConfig`,
      `${this.host}${this.basePath}/panel/api/server/updateXrayConfig`
    ];

    let lastError: unknown;
    for (const url of candidates) {
      try {
        const resp = await axios.post(url, settings, getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/json' })));
        if (resp.data?.success !== false) return;
        lastError = new Error(resp.data?.msg || resp.data?.message || 'XUI settings update rejected');
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('XUI settings update endpoint unavailable');
  }

  async restartPanel(): Promise<void> {
    await this.login();
    const candidates = [
      `${this.host}${this.basePath}/panel/api/server/restartXrayService`,
      `${this.host}${this.basePath}/panel/api/server/restartXray`
    ];

    for (const url of candidates) {
      try {
        const resp = await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
        if (resp.data?.success !== false) return;
      } catch (err) {}
    }
    console.warn(`⚠️ [XUI] Xray restart endpoint unavailable for ${this.host}; settings were saved but restart must be checked manually.`);
  }

  async syncRealityKeys(privateKey: string, publicKey: string): Promise<void> {
    if (!privateKey || !publicKey) return;
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
      }
    } catch (err: any) {
      console.warn(`⚠️ [XUI] Reality key sync skipped for ${this.host}: ${err.message}`);
    }
  }

  
  async resetClientTraffic(inboundId: number, email: string): Promise<void> {
    try {
      await this.login();
      const url = `${this.host}${this.basePath}/panel/api/inbounds/${inboundId}/resetClientTraffic/${encodeURIComponent(email)}`;
      await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
      console.log(`✅ [XUI] Traffic reset for ${email} on inbound ${inboundId}`);
    } catch (err: any) {
      console.warn(`⚠️ [XUI] Could not reset traffic for ${email} on inbound ${inboundId}: ${err.message}`);
    }
  }

  async deleteClient(uuid: string, email: string) {
    try {
      await this.login();
      const realityInbound = this.findRealityInbound(await this.getInbounds(), parseInt(process.env.XUI_INBOUND_ID || '1'));
      if (realityInbound) {
        await axios.post(`${this.host}${this.basePath}/panel/api/inbounds/${realityInbound.id}/delClient/${uuid}`, {}, getRequestConfig('', this.authHeaders()));
      }
    } catch (e) {}
  }
}

export async function getXuiForServer(serverId: string) {
  const { data: server, error } = await supabase.from('vpn_servers').select('*').eq('id', serverId).single();
  if (error || !server) throw new Error('Server not found');
  const instance = new XUIService({ host: server.ip || server.domain, username: server.username, password: server.password });
  return { instance, server };
}
