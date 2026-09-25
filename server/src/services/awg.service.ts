import { execSync } from 'child_process';
import crypto from 'crypto';
import { supabase } from './supabase';

/**
 * AmneziaWG — обфусцированный WireGuard на ХОСТЕ (вне Docker).
 * Приложение живёт в контейнере, но имеет доступ к docker-сокету, поэтому команды
 * выполняются на хосте через nsenter (тот же паттерн, что и для Hysteria2).
 * Файлы сервера: /etc/amnezia/amneziawg/izinet-server.json и izinet-peers.json.
 */
const AWG_DIR = '/etc/amnezia/amneziawg';
// Имя интерфейса: можно переопределить через AWG_IFACE, иначе берётся из izinet-server.json,
// иначе awg0. На сервере может уже работать интерфейс AmneziaWG с другим именем (например wg0).
let IFACE = process.env.AWG_IFACE || 'awg0';
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
  private_key?: string;
  port: number;
  subnet: string;
  jc: number; jmin: number; jmax: number;
  s1: number; s2: number;
  h1: number; h2: number; h3: number; h4: number;
}

export interface AwgPeer {
  name: string;
  public_key: string;
  private_key?: string;
  address: string;
  created_at?: string;
}

const AWG_CONTAINER = process.env.AWG_CONTAINER || "izinet-awg";

function runLocal(command: string, timeout = 20000): string {
  return execSync(command, { timeout, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

/** Команды awg: в контейнере (userspace, без модуля ядра) или на хосте (модуль ядра). */
function awgExec(command: string, timeout = 20000): string {
  try {
    const running = runLocal(`docker inspect -f "{{.State.Running}}" ${AWG_CONTAINER} 2>/dev/null || echo false`);
    if (running === "true") {
      return runLocal(`docker exec ${AWG_CONTAINER} sh -c ${shq(command)}`, timeout);
    }
  } catch (e) {}
  return hostExec(command, timeout);
}

/** Полная конфигурация интерфейса: [Interface] + пиры из нашего реестра. */
function buildInterfaceConf(server: AwgServer, peers: AwgPeer[], privateKey?: string): string {
  const lines = [
    "[Interface]",
    `Address = ${server.subnet}.1/24`,
    `ListenPort = ${server.port}`,
  ];
  if (privateKey) lines.push(`PrivateKey = ${privateKey}`);
  lines.push(
    "MTU = 1280",
    `Jc = ${server.jc}`,
    `Jmin = ${server.jmin}`,
    `Jmax = ${server.jmax}`,
    `S1 = ${server.s1}`,
    `S2 = ${server.s2}`,
    `H1 = ${server.h1}`,
    `H2 = ${server.h2}`,
    `H3 = ${server.h3}`,
    `H4 = ${server.h4}`,
    ""
  );
  for (const peer of peers) {
    lines.push("[Peer]", `PublicKey = ${peer.public_key}`, `AllowedIPs = ${peer.address}/32`, "");
  }
  return lines.join("\n");
}

function writeInterfaceConf(conf: string): void {
  const b64 = Buffer.from(conf, "utf8").toString("base64");
  hostExec(`printf %s ${shq(b64)} | base64 -d > ${AWG_DIR}/${IFACE}.conf && chmod 600 ${AWG_DIR}/${IFACE}.conf`);
}
export class AwgService {
  /** Доступен ли сервер AmneziaWG: установлены ли инструменты и поднят ли интерфейс. */
  static status(): { available: boolean; message: string; port?: number; peers?: number; subnet?: string } {
    try {
      const out = awgExec(`awg show ${IFACE} >/dev/null 2>&1 && echo YES || echo NO`, 20000);
      const server = this.readServer();
      const peers = this.readPeers().length;
      if (out !== 'YES') {
        return {
          available: false,
          message: 'Интерфейс AmneziaWG не активен на хосте. Запустите bash scripts/amneziawg/setup_awg.sh по SSH',
          port: server?.port || 51820,
          peers,
          subnet: server?.subnet || '10.88.0'
        };
      }
      return { available: true, message: 'AmneziaWG работает', port: server?.port || 51820, peers, subnet: server?.subnet || '10.88.0' };
    } catch (e: any) {
      const server = this.readServer();
      return { available: false, message: 'Проверка AmneziaWG: ' + e.message, port: server?.port || 51820, subnet: server?.subnet || '10.88.0' };
    }
  }

  static readServer(): AwgServer | null {
    try {
      const raw = hostExec(`base64 -w0 ${SERVER_JSON} 2>/dev/null || echo ""`);
      if (raw) {
        const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
        if (parsed?.interface && !process.env.AWG_IFACE) IFACE = String(parsed.interface);
        if (parsed?.public_key) return parsed;
      }
    } catch (e) {}

    // Fallback: дефолтные параметры AmneziaWG
    return {
      interface: IFACE,
      public_key: process.env.AWG_PUBLIC_KEY || 'izinetAwgServerPublicKeyMock1234567890=',
      port: Number(process.env.AWG_PORT) || 51820,
      subnet: '10.88.0',
      jc: 4, jmin: 50, jmax: 1000,
      s1: 64, s2: 128,
      h1: 1, h2: 2, h3: 3, h4: 4
    };
  }

  static async readServerAsync(): Promise<AwgServer> {
    try {
      const raw = hostExec(`base64 -w0 ${SERVER_JSON} 2>/dev/null || echo ""`);
      if (raw) {
        const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
        if (parsed?.public_key) {
          if (parsed?.interface && !process.env.AWG_IFACE) IFACE = String(parsed.interface);
          return parsed;
        }
      }
    } catch (e) {}

    // Чтение из базы настроек
    try {
      const { data } = await supabase.from('settings').select('value').eq('key', 'AWG_SERVER_CONFIG').maybeSingle();
      if (data?.value) {
        const parsed = JSON.parse(data.value);
        if (parsed?.public_key) return parsed;
      }
    } catch (e) {}

    // Авто-генерация параметров AmneziaWG сервера
    const keypair = this.genKeypair();
    const serverConfig: AwgServer = {
      interface: IFACE,
      public_key: keypair.pub,
      private_key: keypair.priv,
      port: Number(process.env.AWG_PORT) || 51820,
      subnet: '10.88.0',
      jc: 4,
      jmin: 50,
      jmax: 1000,
      s1: 64,
      s2: 128,
      h1: 1,
      h2: 2,
      h3: 3,
      h4: 4
    };

    try {
      await supabase.from('settings').upsert({
        key: 'AWG_SERVER_CONFIG',
        value: JSON.stringify(serverConfig),
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });
    } catch (e) {}

    return serverConfig;
  }

  private static cachedPeers: AwgPeer[] | null = null;

  static readPeers(): AwgPeer[] {
    try {
      const raw = hostExec(`base64 -w0 ${PEERS_JSON} 2>/dev/null || echo ""`);
      if (raw) {
        const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
        if (Array.isArray(parsed?.peers) && parsed.peers.length > 0) {
          this.cachedPeers = parsed.peers;
          return parsed.peers;
        }
      }
    } catch (e) {}

    if (this.cachedPeers && this.cachedPeers.length > 0) {
      return this.cachedPeers;
    }

    return [];
  }

  static async readPeersAsync(): Promise<AwgPeer[]> {
    const peers = this.readPeers();
    if (peers.length > 0) return peers;

    try {
      const { data } = await supabase.from('settings').select('value').eq('key', 'AWG_PEERS_REGISTRY').maybeSingle();
      if (data?.value) {
        const parsed = JSON.parse(data.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.cachedPeers = parsed;
          return parsed;
        }
      }
    } catch (e) {}

    return [];
  }

  private static writePeers(peers: AwgPeer[]): void {
    this.cachedPeers = peers;
    const payload = Buffer.from(JSON.stringify({ peers }, null, 2), 'utf8').toString('base64');
    try {
      hostExec(`printf %s ${shq(payload)} | base64 -d > ${PEERS_JSON} && chmod 600 ${PEERS_JSON}`);
    } catch (e: any) {
      console.warn(`[AWG] writePeers warning: ${e.message}`);
    }

    // Резервное сохранение реестра пиров в Supabase
    try {
      Promise.resolve(
        supabase.from('settings').upsert({
          key: 'AWG_PEERS_REGISTRY',
          value: JSON.stringify(peers),
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' })
      ).catch(() => {});
    } catch (_) {}
  }

  static genKeypair(): { priv: string; pub: string } {
    try {
      const priv = awgExec('awg genkey', 5000);
      const pub = awgExec(`printf %s ${shq(priv)} | awg pubkey`, 5000);
      if (priv && pub && priv.length >= 40 && pub.length >= 40) {
        return { priv: priv.trim(), pub: pub.trim() };
      }
    } catch (e) {}

    // Fallback: генерация через Node.js crypto x25519
    try {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
      const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
      const pubDer = publicKey.export({ type: 'spki', format: 'der' });
      const priv = privDer.subarray(privDer.length - 32).toString('base64');
      const pub = pubDer.subarray(pubDer.length - 32).toString('base64');
      return { priv, pub };
    } catch {
      const priv = crypto.randomBytes(32).toString('base64');
      return { priv, pub: priv };
    }
  }

  private static nextAddress(peers: AwgPeer[], subnet: string): string {
    const used = new Set(peers.map((p) => Number(String(p.address || '').split('.').pop())));
    for (let i = 2; i < 255; i++) {
      if (!used.has(i)) return `${subnet}.${i}`;
    }
    return `${subnet}.${Math.floor(Math.random() * 200) + 10}`;
  }

  /** Публичный адрес сервера для клиентского конфига. */
  static async endpointHost(): Promise<string> {
    if (process.env.AWG_ENDPOINT) return process.env.AWG_ENDPOINT;
    try {
      const { data } = await supabase.from('vpn_servers').select('ip, domain').eq('is_active', true).limit(1).maybeSingle();
      const host = data?.ip || data?.domain;
      if (host && !/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(String(host))) return String(host);
    } catch (e) {}
    return '194.50.94.28';
  }

  /** Статистика по клиентам из `awg show <iface> dump`: трафик и время рукопожатия. */
  static listPeerStats(): Record<string, { rx: number; tx: number; lastHandshake: number }> {
    const stats: Record<string, { rx: number; tx: number; lastHandshake: number }> = {};
    try {
      const dump = awgExec(`awg show ${IFACE} dump`, 15000);
      const lines = dump.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of lines.slice(1)) {
        const p = line.split('\t');
        if (p.length < 9) continue;
        stats[p[0]] = {
          lastHandshake: Number(p[6]) || 0,
          rx: Number(p[7]) || 0,
          tx: Number(p[8]) || 0
        };
      }
    } catch (e: any) {
      console.warn(`[AWG] dump failed: ${e.message}`);
    }
    return stats;
  }

  /** Полный статус для админки: доступность, порт, подсеть и клиенты с трафиком. */
  static fullStatus(): {
    available: boolean;
    message: string;
    port?: number;
    subnet?: string;
    serverPublicKey?: string;
    peers: Array<{ name: string; address: string; created_at?: string; rx: number; tx: number; totalBytes: number; online: boolean }>;
  } {
    const base = this.status();
    const server = this.readServer();
    const stats = this.listPeerStats();
    const nowSec = Math.floor(Date.now() / 1000);
    const peers = this.readPeers().map((peer) => {
      const s = stats[peer.public_key] || { rx: 0, tx: 0, lastHandshake: 0 };
      return {
        name: peer.name,
        address: peer.address,
        created_at: peer.created_at,
        rx: s.rx,
        tx: s.tx,
        totalBytes: s.rx + s.tx,
        online: s.lastHandshake > 0 && nowSec - s.lastHandshake < 180
      };
    });
    return { 
      available: base.available, 
      message: base.message, 
      port: server?.port, 
      subnet: server?.subnet, 
      serverPublicKey: server?.public_key,
      peers 
    };
  }

  static buildConf(peer: AwgPeer, server: AwgServer, endpoint: string): string {
    const privKey = peer.private_key || (peer as any).priv || 'CLIENT_PRIVATE_KEY_HERE';
    return [
      '[Interface]',
      `PrivateKey = ${privKey}`,
      `Address = ${peer.address}/32`,
      'DNS = 1.1.1.1, 8.8.8.8',
      'MTU = 1280',
      `Jc = ${server.jc || 4}`,
      `Jmin = ${server.jmin || 50}`,
      `Jmax = ${server.jmax || 1000}`,
      `S1 = ${server.s1 || 64}`,
      `S2 = ${server.s2 || 128}`,
      `H1 = ${server.h1 || 1}`,
      `H2 = ${server.h2 || 2}`,
      `H3 = ${server.h3 || 3}`,
      `H4 = ${server.h4 || 4}`,
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
    const server = await this.readServerAsync();
    const peers = await this.readPeersAsync();
    const { priv, pub } = this.genKeypair();
    const address = this.nextAddress(peers, server.subnet);

    try { awgExec(`awg set ${IFACE} peer ${shq(pub)} allowed-ips ${shq(address + '/32')}`); } catch (e: any) { console.warn(`[AWG] peer set: ${e.message}`); }

    const peer: AwgPeer = { name, public_key: pub, private_key: priv, address, created_at: new Date().toISOString() };
    const filteredPeers = peers.filter(p => p.name !== name);
    filteredPeers.push(peer);
    this.writePeers(filteredPeers);
    try { writeInterfaceConf(buildInterfaceConf(server, filteredPeers, server.private_key)); } catch (e: any) { console.warn(`[AWG] conf write: ${e.message}`); }

    const endpoint = await this.endpointHost();
    const conf = this.buildConf(peer, server, endpoint);
    return { peer, conf };
  }

  /** Получить существующий или создать новый стабильный AmneziaWG пир для пользователя. */
  static async getOrCreatePeerForUser(userIdentifier: string, label: string = 'izinet'): Promise<{
    peer: AwgPeer;
    conf: string;
    wireguardUrl: string;
    awgUrl: string;
  } | null> {
    try {
      const server = await this.readServerAsync();
      const peers = await this.readPeersAsync();
      let peer = peers.find(p => p.name === userIdentifier);

      if (!peer || !peer.private_key) {
        const created = await this.createPeer(userIdentifier);
        peer = created.peer;
      }

      const endpoint = await this.endpointHost();
      const conf = this.buildConf(peer, server, endpoint);

      const privKey = peer.private_key || '';
      const params = new URLSearchParams({
        public_key: server.public_key,
        address: `${peer.address}/32`,
        dns: '1.1.1.1,8.8.8.8',
        mtu: '1280',
        jc: String(server.jc || 4),
        jmin: String(server.jmin || 50),
        jmax: String(server.jmax || 1000),
        s1: String(server.s1 || 64),
        s2: String(server.s2 || 128),
        h1: String(server.h1 || 1),
        h2: String(server.h2 || 2),
        h3: String(server.h3 || 3),
        h4: String(server.h4 || 4)
      });

      const wireguardUrl = `wireguard://${privKey}@${endpoint}:${server.port}?${params.toString()}#${encodeURIComponent(label)}`;
      const awgUrl = `awg://${privKey}@${endpoint}:${server.port}?${params.toString()}#${encodeURIComponent(label)}`;

      return { peer, conf, wireguardUrl, awgUrl };
    } catch (e: any) {
      console.error(`[AWG] getOrCreatePeerForUser error: ${e.message}`);
      return null;
    }
  }

  /** Удалить клиента: снять peer с интерфейса и убрать из реестра. */
  static removePeer(publicKey: string): void {
    if (!publicKey) return;
    try {
      awgExec(`awg set ${IFACE} peer ${shq(publicKey)} remove`);
    } catch (e: any) {
      console.warn(`[AWG] peer remove failed: ${e.message}`);
    }
    const peers = this.readPeers().filter((p) => p.public_key !== publicKey);
    try { this.writePeers(peers); } catch (e: any) { console.warn(`[AWG] peers save failed: ${e.message}`); }
    try {
      const server = this.readServer();
      if (server) writeInterfaceConf(buildInterfaceConf(server, peers, (server as any).private_key));
    } catch (e: any) { console.warn(`[AWG] conf rebuild: ${e.message}`); }
  }
}

