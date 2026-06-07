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
  private readonly SESSION_TTL = 10 * 60 * 1000; // 10 минут (Fix 6)

  constructor(serverConfigs?: ServerConfig) {
    let host = (serverConfigs?.host || process.env.XUI_HOST || '').trim();
    this.username = (serverConfigs?.username || process.env.XUI_USERNAME || 'admin').trim();
    this.password = (serverConfigs?.password || process.env.XUI_PASSWORD || 'admin').trim();

    if (host && !host.startsWith('http://') && !host.startsWith('https://')) {
      host = 'http://' + host;
    }

    if (host) {
      try {
        const parsedUrl = new URL(host);
        const hn = parsedUrl.hostname;
        const configDomain = (process.env.DOMAIN || '').trim();
        
        // Оптимизация маршрутов Docker
        const isLocalHost = hn === 'localhost' || hn === '127.0.0.1';
        const isMainDomain = configDomain && (hn === configDomain || hn.endsWith('.' + configDomain));

        if (isLocalHost || isMainDomain) {
          if (process.env.IS_DOCKER === 'true' || process.env.NODE_ENV?.includes('production')) {
            host = `http://x3-ui:2053${parsedUrl.pathname}`;
          }
        }
        this.displayDomain = hn;
      } catch (e) {}
    }
    this.host = host;
  }

  // --- Основные методы ---

  private async login() {
    const now = Date.now();
    if (this.sessionCookie && (now - this.lastLoginTime < this.SESSION_TTL)) return;

    console.log(`🔐 [XUI] Авторизация в панели: ${this.host}...`);
    const loginUrl = `${this.host}${this.basePath}/login`;
    const params = new URLSearchParams();
    params.append('username', this.username);
    params.append('password', this.password);

    const response = await axios.post(loginUrl, params, getRequestConfig(loginUrl, {
      'Content-Type': 'application/x-www-form-urlencoded'
    }));

    const cookie = response.headers['set-cookie'];
    if (cookie) {
      this.sessionCookie = Array.isArray(cookie) ? cookie[0] : cookie;
      this.lastLoginTime = now;
      console.log('✅ [XUI] Сессия получена.');
    } else {
      throw new Error('Failed to get session cookie from XUI');
    }
  }

  private authHeaders(extra: any = {}) {
    return {
      'Cookie': this.sessionCookie || '',
      ...extra
    };
  }

  async getInbounds() {
    if (!this.sessionCookie) await this.login();
    const url = `${this.host}${this.basePath}/panel/api/inbounds/list`;
    const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
    return resp.data.obj || [];
  }

  async addClient(email: string, uuid: string, inboundId: number, expiryTime: number = 0, limitBytes: number = 0) {
    if (!this.sessionCookie) await this.login();

    // Автопоиск порта 443
    let targetInboundId = inboundId;
    try {
      const inbounds = await this.getInbounds();
      const realityInbound = inbounds.find((ib: any) => ib.port === 443);
      if (realityInbound) targetInboundId = realityInbound.id;
    } catch (e) {}

    const clientData = {
      id: targetInboundId,
      settings: JSON.stringify({
        clients: [{
          id: uuid,
          flow: "xtls-rprx-vision",
          email: email,
          limitIp: 0,
          totalGB: limitBytes,
          expiryTime: expiryTime,
          enable: true,
          tgId: "",
          subId: ""
        }]
      })
    };

    const url = `${this.host}${this.basePath}/panel/api/inbounds/addClient`;
    const response = await axios.post(url, clientData, getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/json' })));
    
    if (response.data.success) {
      return this.getInboundLink(targetInboundId, uuid, email);
    }
    throw new Error(response.data.msg || 'Failed to add client');
  }

  async getInboundLink(inboundId: number, uuid: string, email: string): Promise<string> {
    if (!this.sessionCookie) await this.login();

    const url = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
    const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
    
    if (!resp.data.success) throw new Error('Inbound not found');
    
    const inbound = resp.data.obj;
    const streamSettings = JSON.parse(inbound.streamSettings || '{}');
    const port = inbound.port;
    const encodedEmail = encodeURIComponent(`izinet_${email}`);

    // ОПРЕДЕЛЕНИЕ АДРЕСА (Fix Таймаутов)
    // Пытаемся найти IP сервера в базе данных, чтобы Hiddify стучался напрямую
    const { data: server } = await supabase.from('vpn_servers').select('ip, domain').or(`host.eq.${this.displayDomain},domain.eq.${this.displayDomain}`).maybeSingle();
    
    // Используем IP если он есть, иначе домен
    const connectAddress = server?.ip || server?.domain || this.displayDomain;

    if (streamSettings.security === 'reality') {
      const rs = streamSettings.realitySettings || {};
      const sni = rs.serverNames?.[0] || 'www.microsoft.com';
      const pbk = process.env.XUI_REALITY_PUB_KEY || rs.publicKey || '';
      const sid = rs.shortIds?.[0] || '79b27cf7799d5b4c';

      console.log(`[XUI] Линк для ${email}: адрес=${connectAddress}, SNI=${sni}`);
      
      return `vless://${uuid}@${connectAddress}:${port}?type=tcp&encryption=none&security=reality&sni=${sni}&pbk=${pbk}&fp=chrome&sid=${sid}&flow=xtls-rprx-vision#${encodedEmail}`;
    }
    
    return `vless://${uuid}@${connectAddress}:${port}?security=none#${encodedEmail}`;
  }

  async deleteClient(uuid: string, email: string) {
    if (!this.sessionCookie) await this.login();
    const url = `${this.host}${this.basePath}/panel/api/inbounds/client/${uuid}`;
    await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.login();
      return true;
    } catch (e) {
      return false;
    }
  }
}

const xuiInstances = new Map<string, XUIService>();

export async function getXuiForServer(serverId: string) {
  if (xuiInstances.has(serverId)) return { instance: xuiInstances.get(serverId)!, server: {} };

  const { data: server, error } = await supabase.from('vpn_servers').select('*').eq('id', serverId).single();
  if (error || !server) throw new Error('Server not found in DB');

  const host = server.domain || server.ip || server.host;
  const instance = new XUIService({ host, username: server.username, password: server.password });
  xuiInstances.set(serverId, instance);
  return { instance, server };
}
