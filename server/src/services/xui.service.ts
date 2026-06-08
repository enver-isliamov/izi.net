import axios from 'axios';
import { getRequestConfig } from '../utils/axios';
import { supabase } from './supabase';

export class XUIService {
  public host: string;
  public basePath: string = "";
  public displayDomain: string = "";
  private username: string;
  private password: string;
  private sessionCookie: string | null = null;
  private lastLoginTime: number = 0;
  private readonly SESSION_TTL = 10 * 60 * 1000; 

  constructor(serverConfigs?: { host?: string, username?: string, password?: string }) {
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
        
        // Оптимизация для работы внутри Docker
        const isInternal = hn === 'localhost' || hn === '127.0.0.1' || (configDomain && hn.includes(configDomain));
        const isDockerEnv = process.env.IS_DOCKER === 'true' || process.env.NODE_ENV === 'production' || !!process.env.XUI_HOST;

        if (isInternal || isDockerEnv) {
          // Если мы в Docker, всегда пробуем достучаться по внутреннему имени
          host = `http://x3-ui:2053${parsedUrl.pathname}`;
          console.log(`🔌 [XUI] Docker-режим: принудительный переход на ${host}`);
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

    const loginUrl = `${this.host}${this.basePath}/login`;
    const loginData = {
      username: this.username,
      password: this.password
    };

    const response = await axios.post(loginUrl, loginData, getRequestConfig(loginUrl, {
      'Content-Type': 'application/json'
    }));

    const cookie = response.headers['set-cookie'];
    if (cookie) {
      this.sessionCookie = Array.isArray(cookie) ? cookie[0] : cookie;
      this.lastLoginTime = now;
    } else {
      throw new Error('XUI Login Failed');
    }
  }

  private authHeaders(extra: any = {}) {
    return { 'Cookie': this.sessionCookie || '', ...extra };
  }

  async addClient(email: string, uuid: string, inboundId: number, expiryTime: number = 0, limitBytes: number = 0) {
    if (!this.sessionCookie) await this.login();
    
    let targetInboundId = inboundId;
    try {
      const url = `${this.host}${this.basePath}/panel/api/inbounds/list`;
      const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
      const realityInbound = (resp.data.obj || []).find((ib: any) => ib.port === 443);
      if (realityInbound) targetInboundId = realityInbound.id;
    } catch (e) {}

    const clientData = {
      id: targetInboundId,
      settings: JSON.stringify({
        clients: [{ id: uuid, flow: "xtls-rprx-vision", email: email, limitIp: 0, totalGB: limitBytes, expiryTime: expiryTime, enable: true }]
      })
    };

    const url = `${this.host}${this.basePath}/panel/api/inbounds/addClient`;
    await axios.post(url, clientData, getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/json' })));
    return this.getInboundLink(targetInboundId, uuid, email);
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

    // --- УЛЬТРА-ОЧИСТКА ХОСТА (Fix Таймаутов) ---
    // Ищем IP сервера в базе данных для перепроверки
    const { data: server } = await supabase.from('vpn_servers')
      .select('ip, domain')
      .or(`ip.ilike.%${this.displayDomain}%,domain.eq.${this.displayDomain}`)
      .maybeSingle();
    
    let connectAddress = server?.ip || server?.domain || this.displayDomain;
    
    // Вырезаем ТОЛЬКО чистый IP/Домен из любой строки (даже из https://ip:port/path/)
    const cleanHost = (str: string) => {
      if (!str) return str;
      let cleaned = str.trim();
      if (cleaned.includes('://')) {
        try {
          const u = new URL(cleaned);
          cleaned = u.hostname;
        } catch(e) {
          cleaned = cleaned.split('://')[1].split('/')[0].split(':')[0];
        }
      } else {
        cleaned = cleaned.split('/')[0].split(':')[0];
      }
      return cleaned.replace(/[^a-zA-Z0-9\.\-]/g, ''); // Удаляем любые спецсимволы
    };

    connectAddress = cleanHost(connectAddress);

    console.log(`📡 [XUI] Ссылка для ${email}: соединение через ${connectAddress}:${port}`);

    if (streamSettings.security === 'reality') {
      const rs = streamSettings.realitySettings || {};
      const sni = rs.serverNames?.[0] || 'www.microsoft.com';
      const pbk = process.env.XUI_REALITY_PUB_KEY || rs.publicKey || '';
      const sid = rs.shortIds?.[0] || '79b27cf7799d5b4c';

      return `vless://${uuid}@${connectAddress}:${port}?type=tcp&encryption=none&security=reality&sni=${sni}&pbk=${pbk}&fp=chrome&sid=${sid}&flow=xtls-rprx-vision#${encodedEmail}`;
    }
    
    return `vless://${uuid}@${connectAddress}:${port}?security=none#${encodedEmail}`;
  }

  async checkHealth(): Promise<boolean> {
    try { await this.login(); return true; } catch (e) { return false; }
  }

  async getSettings() {
    if (!this.sessionCookie) await this.login();
    const url = `${this.host}${this.basePath}/panel/api/settings/get`;
    const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
    if (!resp.data.success) throw new Error('Failed to get settings');
    return resp.data.obj;
  }

  async updateSettings(settings: any) {
    if (!this.sessionCookie) await this.login();
    const url = `${this.host}${this.basePath}/panel/api/settings/update`;
    await axios.post(url, settings, getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/json' })));
  }

  async restartPanel() {
    if (!this.sessionCookie) await this.login();
    const url = `${this.host}${this.basePath}/panel/api/settings/restartPanel`;
    await axios.post(url, {}, getRequestConfig(url, this.authHeaders()));
  }

  async checkConfig(): Promise<boolean> {
    return this.checkHealth();
  }

  async getClientTraffic(email: string) {
    if (!this.sessionCookie) await this.login();
    const url = `${this.host}${this.basePath}/panel/api/inbounds/getClientTraffics/${encodeURIComponent(email)}`;
    const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
    if (resp.data.success && resp.data.obj) {
      const stats = resp.data.obj;
      return { used: (stats.up || 0) + (stats.down || 0) };
    }
    return null;
  }

  async syncRealityKeys(privKey: string, pubKey: string) {
    if (!this.sessionCookie) await this.login();
    
    // 1. Get inbounds
    const listUrl = `${this.host}${this.basePath}/panel/api/inbounds/list`;
    const listResp = await axios.get(listUrl, getRequestConfig(listUrl, this.authHeaders()));
    const inbounds = listResp.data.obj || [];
    
    // 2. Find reality inbound (usually port 443)
    const realityInbound = inbounds.find((ib: any) => {
      const ss = JSON.parse(ib.streamSettings || '{}');
      return ss.security === 'reality';
    });

    if (!realityInbound) {
      console.warn(`⚠️ [XUI] Reality inbound not found on ${this.host}`);
      return;
    }

    // 3. Update keys
    const ss = JSON.parse(realityInbound.streamSettings);
    ss.realitySettings.privateKey = privKey;
    ss.realitySettings.publicKey = pubKey;
    if (ss.realitySettings.settings) {
      ss.realitySettings.settings.publicKey = pubKey;
    }

    const updateUrl = `${this.host}${this.basePath}/panel/api/inbounds/update/${realityInbound.id}`;
    const updateData = {
      ...realityInbound,
      streamSettings: JSON.stringify(ss)
    };
    
    await axios.post(updateUrl, updateData, getRequestConfig(updateUrl, this.authHeaders({ 'Content-Type': 'application/json' })));
    console.log(`✅ [XUI] Reality keys synced on ${this.host}`);
  }
}

const xuiInstances = new Map<string, XUIService>();

export async function getXuiForServer(serverId: string) {
  if (xuiInstances.has(serverId)) return { instance: xuiInstances.get(serverId)!, server: {} };

  const { data: server, error } = await supabase.from('vpn_servers').select('*').eq('id', serverId).single();
  if (error || !server) throw new Error('Server not found');

  const instance = new XUIService({ host: server.ip || server.domain, username: server.username, password: server.password });
  xuiInstances.set(serverId, instance);
  return { instance, server };
}
