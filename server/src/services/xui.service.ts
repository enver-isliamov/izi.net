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
    // Приоритет: переданный конфиг -> переменная окружения -> значение по умолчанию
    let host = (serverConfigs?.host || process.env.XUI_HOST || '').trim();
    this.username = (serverConfigs?.username || process.env.XUI_USERNAME || 'admin').trim();
    this.password = (serverConfigs?.password || process.env.XUI_PASSWORD || 'admin').trim();

    // Добавление протокола, если он отсутствует
    if (host && !host.startsWith('http')) {
      host = 'http://' + host;
    }

    if (host) {
      try {
        const parsedUrl = new URL(host);
        const hn = parsedUrl.hostname;
        const configDomain = (process.env.DOMAIN || '').trim();

        // FIX: Оптимизация для работы внутри Docker (только если хост локальный)
        const isLocalHost = hn === 'localhost' || hn === '127.0.0.1' || (configDomain && hn === configDomain);
        const isDockerEnv = process.env.IS_DOCKER === 'true' || process.env.NODE_ENV === 'production';

        if (isLocalHost && isDockerEnv) {
          // Использование внутреннего хоста позволяет обходить блокировки внешнего IP внутри сервера
          host = `http://x3-ui:2053${parsedUrl.pathname}`;
          console.log(`🔌 [XUI] Docker-режим (Local): принудительный переход на ${host}`);
        }
        this.displayDomain = hn;
        this.basePath = parsedUrl.pathname.replace(/\/$/, '');
      } catch (e) {}
    }
    this.host = host;
  }

  /**
   * FIX: Современные панели (Sanaei) требуют передачи данных в формате JSON.
   */
  private async login() {
    const now = Date.now();
    // Проверка актуальности сессии (TTL 10 минут)
    if (this.sessionCookie && (now - this.lastLoginTime < this.SESSION_TTL)) return;

    const loginUrl = `${this.host}${this.basePath}/login`;
    const loginData = {
      username: this.username,
      password: this.password
    };

    console.log(`📡 [XUI] Попытка входа: ${loginUrl} (User: ${this.username})`);

    // Отправка JSON данных для входа
    const response = await axios.post(loginUrl, loginData, getRequestConfig(loginUrl, {
      'Content-Type': 'application/json'
    }));

    const cookie = response.headers['set-cookie'];
    if (cookie) {
      this.sessionCookie = Array.isArray(cookie) ? cookie[0] : cookie;
      this.lastLoginTime = now;
      console.log(`✅ [XUI] Вход успешен: ${this.host}`);
    } else {
      throw new Error('XUI Login Failed - No cookie received');
    }
  }

  private authHeaders(extra: any = {}) {
    return { 'Cookie': this.sessionCookie || '', ...extra };
  }

  /**
   * FIX: Автоматический поиск Reality-инбаунда на порту 443
   */
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
    // Создание клиента через JSON API
    await axios.post(url, clientData, getRequestConfig(url, this.authHeaders({ 'Content-Type': 'application/json' })));
    return this.getInboundLink(targetInboundId, uuid, email);
  }

  /**
   * FIX: Добавлен обязательный параметр spx=%2F для стабильности Hiddify/NekoBox
   */
  async getInboundLink(inboundId: number, uuid: string, email: string): Promise<string> {
    if (!this.sessionCookie) await this.login();

    const url = `${this.host}${this.basePath}/panel/api/inbounds/get/${inboundId}`;
    const resp = await axios.get(url, getRequestConfig(url, this.authHeaders()));
    if (!resp.data.success) throw new Error('Inbound not found');

    const inbound = resp.data.obj;
    const streamSettings = JSON.parse(inbound.streamSettings || '{}');
    const port = inbound.port;
    const encodedEmail = encodeURIComponent(`izinet_${email}`);

    const { data: server } = await supabase.from('vpn_servers')
      .select('ip, domain')
      .or(`ip.ilike.%${this.displayDomain}%,domain.eq.${this.displayDomain}`)
      .maybeSingle();

    let connectAddress = server?.ip || server?.domain || this.displayDomain;

    // Очистка адреса для ссылки
    const cleanHost = (str: string) => {
      if (!str) return str;
      let cleaned = str.trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
      return cleaned.replace(/[^a-zA-Z0-9\.\-]/g, '');
    };

    connectAddress = cleanHost(connectAddress);

    if (streamSettings.security === 'reality') {
      const rs = streamSettings.realitySettings || {};
      const sni = rs.serverNames?.[0] || 'www.microsoft.com';
      const pbk = (process.env.XUI_REALITY_PUB_KEY || rs.publicKey || rs.settings?.publicKey || '').trim();
      const sid = rs.shortIds?.[0] || '79b27cf7799d5b4c';

      return `vless://${uuid}@${connectAddress}:${port}?type=tcp&encryption=none&security=reality&sni=${sni}&pbk=${pbk}&fp=chrome&sid=${sid}&spx=%2F&flow=xtls-rprx-vision#${encodedEmail}`;
    }

    return `vless://${uuid}@${connectAddress}:${port}?security=none#${encodedEmail}`;
  }

  async checkHealth(): Promise<boolean> {
    try { await this.login(); return true; } catch (e) { return false; }
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

  /**
   * FIX: Авто-синхронизация Reality ключей из .env в базу панели
   */
  async syncRealityKeys(privKey: string, pubKey: string) {
    if (!this.sessionCookie) await this.login();

    try {
      const listUrl = `${this.host}${this.basePath}/panel/api/inbounds/list`;
      const listResp = await axios.get(listUrl, getRequestConfig(listUrl, this.authHeaders()));
      const realityInbound = (listResp.data.obj || []).find((ib: any) => {
        const ss = JSON.parse(ib.streamSettings || '{}');
        return ss.security === 'reality';
      });

      if (!realityInbound) return;

      const ss = JSON.parse(realityInbound.streamSettings);
      if (ss.realitySettings.privateKey !== privKey || ss.realitySettings.publicKey !== pubKey) {
        ss.realitySettings.privateKey = privKey;
        ss.realitySettings.publicKey = pubKey;
        if (ss.realitySettings.settings) ss.realitySettings.settings.publicKey = pubKey;

        const updateUrl = `${this.host}${this.basePath}/panel/api/inbounds/update/${realityInbound.id}`;
        await axios.post(updateUrl, { ...realityInbound, streamSettings: JSON.stringify(ss) }, getRequestConfig(updateUrl, this.authHeaders({ 'Content-Type': 'application/json' })));
        console.log(`✅ [XUI] Reality ключи синхронизированы на ${this.host}`);
      }
    } catch (e: any) {
      console.error(`❌ [XUI] Ошибка синхронизации ключей на ${this.host}:`, e.message);
    }
  }

  async deleteClient(uuid: string, email: string) {
    if (!this.sessionCookie) await this.login();
    try {
      // Ищем инбаунд на 443 порту
      const listResp = await axios.get(`${this.host}${this.basePath}/panel/api/inbounds/list`, getRequestConfig('', this.authHeaders()));
      const realityInbound = (listResp.data.obj || []).find((ib: any) => ib.port === 443);
      if (realityInbound) {
        await axios.post(`${this.host}${this.basePath}/panel/api/inbounds/${realityInbound.id}/delClient/${uuid}`, {}, getRequestConfig('', this.authHeaders()));
      }
    } catch (e) {}
  }
}

const xuiInstances = new Map<string, XUIService>();

export async function getXuiForServer(serverId: string) {
  const { data: server, error } = await supabase.from('vpn_servers').select('*').eq('id', serverId).single();
  if (error || !server) throw new Error('Server not found');

  const instance = new XUIService({ host: server.ip || server.domain, username: server.username, password: server.password });
  return { instance, server };
}
