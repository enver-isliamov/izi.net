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
  private readonly SESSION_TTL = 10 * 60 * 1000; 

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
        
        if (hn === 'localhost' || hn === '127.0.0.1' || (configDomain && hn.includes(configDomain))) {
          if (process.env.IS_DOCKER === 'true' || process.env.NODE_ENV?.includes('production')) {
            host = `http://x3-ui:2053${parsedUrl.pathname}`;
          }
        }
        this.displayDomain = hn;
      } catch (e) {}
    }
    this.host = host;
  }

  private async login() {
    const now = Date.now();
    if (this.sessionCookie && (now - this.lastLoginTime < this.SESSION_TTL)) return;

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
    } else {
      throw new Error('XUI Login Failed');
    }
  }

  private authHeaders(extra: any = {}) {
    return { 'Cookie': this.sessionCookie || '', ...extra };
  }

  async addClient(email: string, uuid: string, inboundId: number, expiryTime: number = 0, limitBytes: number = 0) {
    if (!this.sessionCookie) await this.login();
    
    // Пытаемся найти 443 порт
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
        clients: [{
          id: uuid,
          flow: "xtls-rprx-vision",
          email: email,
          limitIp: 0,
          totalGB: limitBytes,
          expiryTime: expiryTime,
          enable: true
        }]
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

    // --- ФИКС ТАЙМАУТА: Очистка адреса ---
    const { data: server } = await supabase.from('vpn_servers').select('ip, domain').or(`ip.ilike.%${this.displayDomain}%,domain.eq.${this.displayDomain}`).maybeSingle();
    
    let connectAddress = server?.ip || server?.domain || this.displayDomain;
    
    // Если в поле IP записан URL (как у вас в логах), вырезаем только Host
    if (connectAddress.includes('://')) {
      try {
        const u = new URL(connectAddress);
        connectAddress = u.hostname;
      } catch(e) {}
    }
    // Убираем порт если он остался
    connectAddress = connectAddress.split(':')[0];

    console.log(`📡 [XUI] Генерация ссылки: адрес=${connectAddress}, порт=${port}`);

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
}

const xuiInstances = new Map<string, XUIService>();

export async function getXuiForServer(serverId: string) {
  if (xuiInstances.has(serverId)) return { instance: xuiInstances.get(serverId)!, server: {} };

  const { data: server, error } = await supabase.from('vpn_servers').select('*').eq('id', serverId).single();
  if (error || !server) throw new Error('Server not found in DB');

  const instance = new XUIService({ host: server.ip || server.domain, username: server.username, password: server.password });
  xuiInstances.set(serverId, instance);
  return { instance, server };
}
