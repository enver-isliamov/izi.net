import { execSync } from 'child_process';
import { supabase } from './supabase';

/**
 * AmneziaWG — обфусцированный WireGuard на ХОСТЕ (вне Docker).
 * Приложение живёт в контейнере, но имеет доступ к docker-сокету, поэтому команды
 * выполняются на хосте через nsenter (тот же паттерн, что и для Hysteria2).
 * Файлы сервера: /etc/amnezia/amneziawg/izinet-server.json и izinet-peers.json.
 */
const AWG_DIR = '/etc/amnezia/amneziawg';
const IFACE = 'awg0';
const PEERS_JSON = `${AWG_DIR}/izinet-peers.json`;
const SERVER_JSON = `${AWG_DIR}/izinet-server.json`;

const shq = (value: string) => "'" + String(value).replace(/'/g, "'\\''") + "'";

function hostExec(command: string, timeout = 25000): string {
  const wrapped = `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m -u -n -i sh -c ${shq(command)}`;
  try {
    return execSync(wrapped, { timeout, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch (e: any) {
    const stderr = e?.stderr ? String(e.stderr).trim() : '';
    throw new Error(stderr || e.message);
  }
}

export interface AwgServer {
  interface: string;
  public_key: string;
  port: number;
  subnet: string;
  jc: number; jmin: number; jmax: number;
  s1: number; s2: number;
  h1: number; h2: number; h3: number; h4: number;
}

export interface AwgPeer {
  name: string;
  public_key: string;
  address: string;
  created_at?: string;
}

export class AwgService {
  /** Доступен ли сервер AmneziaWG: установлены ли инструменты и поднят ли интерфейс. */
  static status(): { available: boolean; message: string; port?: number; peers?: number } {
    try {
      const out = hostExec(`command -v awg >/dev/null 2>&1 && awg show ${IFACE} >/dev/null 2>&1 && echo YES || echo NO`, 20000);
      if (out !== 'YES') {
        return {
          available: false,
          message: 'AmneziaWG не установлен на сервере: запустите bash scripts/amneziawg/setup_awg.sh по SSH'
        };
      }
      const server = this.readServer();
      const peers = this.readPeers().length;
      return { available: true, message: 'AmneziaWG работает', port: server?.port, peers };
    } catch (e: any) {
      return { available: false, message: 'Не удалось проверить AmneziaWG: ' + e.message };
    }
  }

  static readServer(): AwgServer | null {
    try {
      const raw = hostExec(`base64 -w0 ${SERVER_JSON}`);
      if (!raw) return null;
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch (e) {
      return null;
    }
  }

  static readPeers(): AwgPeer[] {
    try {
      const raw = hostExec(`base64 -w0 ${PEERS_JSON} 2>/dev/null || echo ""`);
      if (!raw) return [];
      const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      return Array.isArray(parsed?.peers) ? parsed.peers : [];
    } catch (e) {
      return [];
    }
  }

  private static writePeers(peers: AwgPeer[]): void {
    const payload = Buffer.from(JSON.stringify({ peers }, null, 2), 'utf8').toString('base64');
    hostExec(`printf %s ${shq(payload)} | base64 -d > ${PEERS_JSON} && chmod 600 ${PEERS_JSON}`);
  }

  private static genKeypair(): { priv: string; pub: string } {
    const priv = hostExec('awg genkey');
    const pub = hostExec(`printf %s ${shq(priv)} | awg pubkey`);
    return { priv, pub };
  }

  private static nextAddress(peers: AwgPeer[], subnet: string): string {
    const used = new Set(peers.map((p) => Number(String(p.address || '').split('.').pop())));
    for (let i = 2; i < 255; i++) {
      if (!used.has(i)) return `${subnet}.${i}`;
    }
    throw new Error('Свободные адреса в подсети закончились');
  }

  /** Публичный адрес сервера для клиентского конфига. */
  static async endpointHost(): Promise<string> {
    if (process.env.AWG_ENDPOINT) return process.env.AWG_ENDPOINT;
    try {
      const { data } = await supabase.from('vpn_servers').select('ip, public_host').eq('is_active', true).limit(1).maybeSingle();
      const host = data?.ip || data?.public_host;
      if (host && !/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(host))) return String(host);
      if (data?.public_host) return String(data.public_host);
    } catch (e) {}
    return '194.50.94.28';
  }

  static buildConf(peer: AwgPeer, server: AwgServer, endpoint: string): string {
    return [
      '[Interface]',
      `PrivateKey = ${(peer as any).private_key}`,
      `Address = ${peer.address}/32`,
      'DNS = 1.1.1.1, 8.8.8.8',
      'MTU = 1280',
      `Jc = ${server.jc}`,
      `Jmin = ${server.jmin}`,
      `Jmax = ${server.jmax}`,
      `S1 = ${server.s1}`,
      `S2 = ${server.s2}`,
      `H1 = ${server.h1}`,
      `H2 = ${server.h2}`,
      `H3 = ${server.h3}`,
      `H4 = ${server.h4}`,
      '',
      '[Peer]',
      `PublicKey = ${server.public_key}`,
      `Endpoint = ${endpoint}:${server.port}`,
      'AllowedIPs = 0.0.0.0/0',
      'PersistentKeepalive = 25',
      ''
    ].join('\n');
  }

  /** Создать нового клиента: ключи, peer на сервере, реестр и готовый .conf. */
  static async createPeer(name: string): Promise<{ peer: AwgPeer; conf: string }> {
    const server = this.readServer();
    if (!server) throw new Error('Параметры сервера AmneziaWG не найдены (izinet-server.json)');
    const peers = this.readPeers();
    const { priv, pub } = this.genKeypair();
    const address = this.nextAddress(peers, server.subnet);

    hostExec(`awg set ${IFACE} peer ${shq(pub)} allowed-ips ${shq(address + '/32')}`);
    hostExec(`awg-quick save ${IFACE}`);

    const peer: AwgPeer = { name, public_key: pub, address, created_at: new Date().toISOString() };
    peers.push(peer);
    this.writePeers(peers);

    const endpoint = await this.endpointHost();
    const conf = this.buildConf({ ...peer, private_key: priv } as any, server, endpoint);
    return { peer, conf };
  }

  /** Удалить клиента: снять peer с интерфейса и убрать из реестра. */
  static removePeer(publicKey: string): void {
    if (!publicKey) return;
    try {
      hostExec(`awg set ${IFACE} peer ${shq(publicKey)} remove`);
      hostExec(`awg-quick save ${IFACE}`);
    } catch (e: any) {
      console.warn(`[AWG] peer remove failed: ${e.message}`);
    }
    const peers = this.readPeers().filter((p) => p.public_key !== publicKey);
    try { this.writePeers(peers); } catch (e: any) { console.warn(`[AWG] peers save failed: ${e.message}`); }
  }
}
