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
  /** Старый адрес пира после миграции подсети (остаётся в allowed-ips, чтобы выданные ранее конфиги работали). */
  alias?: string;
  created_at?: string;
}

const AWG_CONTAINER = process.env.AWG_CONTAINER || "izinet-awg";

function runLocal(command: string, timeout = 20000): string {
  return execSync(command, { timeout, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

/** Приводит значение подсети к виду x.y.z (убирает хвосты .0/.1 и /маску). */
export function subnetBase(subnet?: string | null): string {
  const parts = String(subnet || '10.9.0').trim().split(/[./]/).filter(Boolean).slice(0, 3);
  while (parts.length < 3) parts.push('0');
  return parts.join('.');
}

/** Валидный клиентский ключ WireGuard/AmneziaWG: base64, 44 символа, 32 байта. */
export function isValidClientKey(key?: string | null): boolean {
  const k = String(key || '').trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(k)) return false;
  try {
    return Buffer.from(k, 'base64').length === 32;
  } catch (e) {
    return false;
  }
}

/** Режим AmneziaWG из izinet-server.json: ядро (команды на хосте) или контейнер (userspace amneziawg-go). */
let modeCache: { value: 'kernel' | 'container'; ts: number } | null = null;
function readAwgMode(): 'kernel' | 'container' {
  if (modeCache && Date.now() - modeCache.ts < 30000) return modeCache.value;
  let value: 'kernel' | 'container' = 'kernel';
  try {
    const raw = hostExec(`base64 -w0 ${SERVER_JSON} 2>/dev/null || echo ""`, 10000);
    if (raw) {
      const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      if (parsed?.mode === 'container') value = 'container';
    }
  } catch (e) {}
  modeCache = { value, ts: Date.now() };
  return value;
}

function containerRunning(): boolean {
  try {
    return runLocal(`docker inspect -f "{{.State.Running}}" ${AWG_CONTAINER} 2>/dev/null || echo false`) === 'true';
  } catch (e) { return false; }
}

function inContainer(command: string, timeout: number): string {
  return runLocal(`docker exec ${AWG_CONTAINER} sh -c ${shq(command)}`, timeout);
}

/**
 * Команды awg: контейнер (userspace) или хост (модуль ядра) — по режиму из izinet-server.json.
 * Если устаревший контейнер остался запущен, но режим «ядро», команды всё равно идут на хост —
 * контейнер не должен перехватывать управление живым интерфейсом.
 */
function awgExec(command: string, timeout = 20000): string {
  if (readAwgMode() === 'container') {
    if (containerRunning()) {
      try { return inContainer(command, timeout); } catch (e) {}
    }
    return hostExec(command, timeout);
  }
  try {
    return hostExec(command, timeout);
  } catch (e) {
    if (containerRunning()) {
      try { return inContainer(command, timeout); } catch (e2) {}
    }
    throw e;
  }
}

/** Прочитать PrivateKey интерфейса из текущего файла конфигурации (чтобы не потерять его при перезаписи). */
function readExistingPrivateKey(): string {
  try {
    const raw = hostExec(`awk -F' = ' '/^PrivateKey/{print $2; exit}' ${AWG_DIR}/${IFACE}.conf 2>/dev/null || echo ""`, 10000);
    return raw ? raw.trim() : '';
  } catch (e) { return ''; }
}

/** Полная конфигурация интерфейса: [Interface] + пиры из нашего реестра. */
export function buildInterfaceConf(server: AwgServer, peers: AwgPeer[], privateKey?: string): string {
  const base = subnetBase(server.subnet);
  // Маршруты для текущей подсети и подсетей старых адресов (алиасов)
  const routeNets = new Set<string>([base]);
  for (const peer of peers) {
    if (peer.alias) routeNets.add(subnetBase(peer.alias));
  }
  const up = [...routeNets].map((n) => `ip -4 route add ${n}.0/24 dev %i || true`).join('; ');
  const down = [...routeNets].map((n) => `ip -4 route del ${n}.0/24 dev %i || true`).join('; ');
  const lines = [
    "[Interface]",
    // /32 + маршрут: не конфликтует с уже занятыми адресами на хосте (как в setup_awg.sh)
    `Address = ${base}.1/32`,
    `PostUp = ${up}`,
    `PostDown = ${down}`,
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
    const ips = peer.alias ? `${peer.address}/32, ${peer.alias}/32` : `${peer.address}/32`;
    lines.push("[Peer]", `PublicKey = ${peer.public_key}`, `AllowedIPs = ${ips}`, "");
  }
  return lines.join("\n");
}

function writeInterfaceConf(conf: string): void {
  const b64 = Buffer.from(conf, "utf8").toString("base64");
  hostExec(`printf %s ${shq(b64)} | base64 -d > ${AWG_DIR}/${IFACE}.conf && chmod 600 ${AWG_DIR}/${IFACE}.conf`);
}

/** Перезаписать файл конфигурации интерфейса, обязательно сохранив PrivateKey. */
function persistInterfaceConf(server: AwgServer, peers: AwgPeer[]): void {
  const priv = server.private_key || readExistingPrivateKey();
  if (!priv) {
    console.warn('[AWG] PrivateKey не найден — файл конфигурации интерфейса не перезаписываю (иначе интерфейс не поднимется после перезагрузки)');
    return;
  }
  writeInterfaceConf(buildInterfaceConf(server, peers, priv));
}

/** Считать параметры сервера из файла конфигурации интерфейса (когда JSON утерян/неполный). */
function readServerFromConfFile(): AwgServer | null {
  try {
    const conf = hostExec(`cat ${AWG_DIR}/${IFACE}.conf 2>/dev/null || echo ""`, 10000);
    if (!conf) return null;
    const get = (key: string): string => {
      const m = conf.match(new RegExp('^' + key + '\\s*=\\s*(.+)$', 'm'));
      return m ? m[1].trim() : '';
    };
    const priv = get('PrivateKey');
    let pub = '';
    try { pub = hostExec(`cat ${AWG_DIR}/server.pub 2>/dev/null || echo ""`, 8000).trim(); } catch (e) {}
    if (!pub && priv) {
      try { pub = hostExec(`printf %s ${shq(priv)} | awg pubkey`, 8000).trim(); } catch (e) {}
    }
    if (!pub) return null;
    return {
      interface: IFACE,
      public_key: pub,
      private_key: priv || undefined,
      port: Number(get('ListenPort')) || 51820,
      subnet: subnetBase(get('Address').replace(/\/.*$/, '')),
      jc: Number(get('Jc')) || 4,
      jmin: Number(get('Jmin')) || 50,
      jmax: Number(get('Jmax')) || 1000,
      s1: Number(get('S1')) || 64,
      s2: Number(get('S2')) || 128,
      h1: Number(get('H1')) || 1,
      h2: Number(get('H2')) || 2,
      h3: Number(get('H3')) || 3,
      h4: Number(get('H4')) || 4,
    };
  } catch (e) {
    return null;
  }
}

/** Нормализует endpoint: убирает схему/путь/порт панели. «http://194.50.94.28:2053» → «194.50.94.28». */
export function normalizeEndpoint(raw?: string | null): string {
  let h = String(raw || '').trim();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  h = h.split('/')[0].split('?')[0].split('#')[0];
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end > 0) return h.slice(1, end);
  }
  if ((h.match(/:/g) || []).length === 1) h = h.split(':')[0];
  return h;
}

/** Share-ссылки wireguard:// и awg:// для клиента. Приватный ключ — только percent-encoded. */
export function buildShareLinks(peer: AwgPeer, server: AwgServer, endpoint: string, label: string): { wireguardUrl: string; awgUrl: string } {
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
  const key = encodeURIComponent(peer.private_key || '');
  const target = `${normalizeEndpoint(endpoint)}:${server.port}`;
  const tag = encodeURIComponent(label);
  return {
    wireguardUrl: `wireguard://${key}@${target}?${params.toString()}#${tag}`,
    awgUrl: `awg://${key}@${target}?${params.toString()}#${tag}`
  };
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
          subnet: server?.subnet || '10.9.0'
        };
      }
      return { available: true, message: 'AmneziaWG работает', port: server?.port || 51820, peers, subnet: server?.subnet || '10.9.0' };
    } catch (e: any) {
      const server = this.readServer();
      return { available: false, message: 'Проверка AmneziaWG: ' + e.message, port: server?.port || 51820, subnet: server?.subnet || '10.9.0' };
    }
  }

  static readServer(): AwgServer | null {
    try {
      const raw = hostExec(`base64 -w0 ${SERVER_JSON} 2>/dev/null || echo ""`);
      if (raw) {
        const parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
        if (parsed?.interface && !process.env.AWG_IFACE) IFACE = String(parsed.interface);
        if (parsed?.public_key) {
          if (!parsed.private_key) parsed.private_key = readExistingPrivateKey() || undefined;
          return parsed;
        }
      }
    } catch (e) {}

    // Fallback 1: параметры из файла конфигурации интерфейса (JSON мог потеряться)
    const fromConf = readServerFromConfFile();
    if (fromConf) return fromConf;

    // Fallback 2: дефолтные параметры AmneziaWG
    return {
      interface: IFACE,
      public_key: process.env.AWG_PUBLIC_KEY || 'izinetAwgServerPublicKeyMock1234567890=',
      port: Number(process.env.AWG_PORT) || 51820,
      subnet: '10.9.0',
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
          if (!parsed.private_key) parsed.private_key = readExistingPrivateKey() || undefined;
          return parsed;
        }
      }
    } catch (e) {}

    // Fallback 1: параметры из файла конфигурации интерфейса (JSON мог потеряться)
    const fromConf = readServerFromConfFile();
    if (fromConf) return fromConf;

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
      subnet: '10.9.0',
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
    const base = subnetBase(subnet);
    const used = new Set(peers.map((p) => Number(String(p.address || '').split('.').pop())));
    for (let i = 2; i < 255; i++) {
      if (!used.has(i)) return `${base}.${i}`;
    }
    return `${base}.${Math.floor(Math.random() * 200) + 10}`;
  }

  /** Публичный адрес сервера для клиентского конфига. */
  static async endpointHost(): Promise<string> {
    if (process.env.AWG_ENDPOINT) return normalizeEndpoint(process.env.AWG_ENDPOINT);
    try {
      const { data } = await supabase.from('vpn_servers').select('ip, domain').eq('is_active', true).limit(1).maybeSingle();
      const host = normalizeEndpoint(data?.ip) || normalizeEndpoint(data?.domain);
      if (host && !/^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return host;
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
    const privKey = String(peer.private_key || (peer as any).priv || '').trim();
    // Никогда не отдаём пользователю конфиг с повреждённым/отсутствующим ключом:
    // приложение AmneziaWG отклоняет такой файл («не содержит корректной конфигурации»).
    if (!isValidClientKey(privKey)) {
      throw new Error('Клиентский ключ отсутствует или повреждён — пересоздайте устройство AmneziaWG');
    }
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
      `Endpoint = ${normalizeEndpoint(endpoint)}:${server.port}`,
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
    try { persistInterfaceConf(server, filteredPeers); } catch (e: any) { console.warn(`[AWG] conf write: ${e.message}`); }

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

      // Если ключ отсутствует или повреждён — пересоздаём пир с новыми ключами (автолечение)
      if (!peer || !isValidClientKey(peer.private_key)) {
        const created = await this.createPeer(userIdentifier);
        peer = created.peer;
      }

      const endpoint = await this.endpointHost();
      const conf = this.buildConf(peer, server, endpoint);

      const { wireguardUrl, awgUrl } = buildShareLinks(peer, server, endpoint, label);

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
      if (server) persistInterfaceConf(server, peers);
    } catch (e: any) { console.warn(`[AWG] conf rebuild: ${e.message}`); }
  }
}

