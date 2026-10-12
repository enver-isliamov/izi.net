/**
 * Совместимость генерируемых файлов для VPN-клиентов и роутеров.
 * Ловит регрессии, из-за которых .conf или ссылки перестают приниматься
 * (AmneziaWG/AmneziaVPN/Keenetic/OpenWrt/GL.iNet): кодирование ключей, потеря PrivateKey,
 * диапазоны Jc/Jmin/Jmax/S1/S2 (uint16) и H1-H4 (uint32), маршрутизация awg-команд ядро/контейнер.
 *
 * Запуск:  npm run test:server
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AwgService, buildInterfaceConf, buildShareLinks, subnetBase } from '../services/awg.service';
import type { AwgPeer, AwgServer } from '../services/awg.service';

const root = process.cwd();
const awgSrc = fs.readFileSync(path.join(root, 'server/src/services/awg.service.ts'), 'utf8');
const configSrc = fs.readFileSync(path.join(root, 'server/src/routes/config.ts'), 'utf8');
const userSrc = fs.readFileSync(path.join(root, 'server/src/routes/user.ts'), 'utf8');

// Реальные параметры боевого сервера (12.10.2026): подсеть 10.9.0, UDP 51820
const server: AwgServer = {
  interface: 'awg0',
  public_key: 'ekHoldNoVmQbcLOMAYizGHOZnt/Og3KLk2t4cglgfng=',
  port: 51820,
  subnet: '10.9.0',
  jc: 7, jmin: 60, jmax: 769,
  s1: 73, s2: 63,
  h1: 100026847, h2: 200054388, h3: 300062129, h4: 400083345,
};
const peer: AwgPeer = {
  name: 'test@example.com',
  public_key: 'h447KbHEFqJ6vKnHk4P7bSQtQEG2LkXH2oPe/XfB3nU=',
  private_key: 'QFv7gH2yWkJn1sD8x/z9+abCDeFgHiJkLmNoPqRsTuV=',
  address: '10.9.0.8',
};

const isB64Key = (s: string) => /^[A-Za-z0-9+/]{43}=$/.test(s);

test('клиентский .conf: обязательные секции и поля, знакомые AmneziaWG-парсерам', () => {
  const conf = AwgService.buildConf(peer, server, '194.50.94.28');
  assert.ok(conf.startsWith('[Interface]'), 'конфиг должен начинаться с [Interface]');
  assert.ok(conf.includes('[Peer]'), 'нет секции [Peer]');
  assert.ok(!conf.includes('\r'), 'в конфиге CRLF — некоторые роутеры/парсеры его не принимают');

  for (const line of [
    `PrivateKey = ${peer.private_key}`,
    `Address = ${peer.address}/32`,
    'DNS = 1.1.1.1, 8.8.8.8',
    'MTU = 1280',
    'Jc = 7', 'Jmin = 60', 'Jmax = 769', 'S1 = 73', 'S2 = 63',
    'H1 = 100026847', 'H2 = 200054388', 'H3 = 300062129', 'H4 = 400083345',
    `PublicKey = ${server.public_key}`,
    'Endpoint = 194.50.94.28:51820',
    'AllowedIPs = 0.0.0.0/0',
    'PersistentKeepalive = 25',
  ]) {
    assert.ok(conf.includes(line), `нет строки «${line}»`);
  }
});

test('диапазоны обфускации в пределах парсеров AmneziaWG (uint16 для Jc/Jmin/Jmax/S1/S2, uint32 для H1-H4)', () => {
  const conf = AwgService.buildConf(peer, server, '194.50.94.28');
  const val = (k: string) => Number(conf.match(new RegExp(`^${k} = (\\d+)$`, 'm'))![1]);
  for (const k of ['Jc', 'Jmin', 'Jmax', 'S1', 'S2']) {
    const v = val(k);
    assert.ok(v >= 0 && v <= 65535, `${k}=${v} вне uint16 — инструменты AmneziaWG не примут конфиг`);
  }
  for (const k of ['H1', 'H2', 'H3', 'H4']) {
    const v = val(k);
    assert.ok(v > 4 && v <= 4294967295, `${k}=${v} вне uint32-диапазона — клиенты не примут конфиг`);
  }
  assert.ok(val('Jmin') <= val('Jmax'), 'Jmin больше Jmax — часть сборок такое не принимает');
});

test('ключи в конфиге — валидный base64 (32 байта, 44 символа)', () => {
  assert.ok(isB64Key(peer.private_key!), 'приватный ключ не база64');
  assert.ok(isB64Key(server.public_key), 'публичный ключ не база64');
  assert.ok(isB64Key(peer.public_key), 'публичный ключ пира не база64');
});

test('wireguard:// и awg:// ссылки: ключ percent-encoded, стандартный парсер их разбирает', () => {
  const links = buildShareLinks(peer, server, '194.50.94.28', 'izinet_тест');
  for (const url of [links.wireguardUrl, links.awgUrl]) {
    const u = new URL(url);
    assert.equal(decodeURIComponent(u.username), peer.private_key, 'ключ в ссылке не совпадает с исходным (кодирование сломано)');
    assert.equal(u.hostname, '194.50.94.28');
    assert.equal(u.port, '51820');
    assert.equal(u.searchParams.get('public_key'), server.public_key);
    assert.equal(u.searchParams.get('address'), `${peer.address}/32`);
    assert.equal(u.searchParams.get('jc'), '7');
  }
  // ключ с «/» — раньше ломал разбор: host становился частью ключа
  const tricky = { ...peer, private_key: 'AAAA/BBB+CCC=DDD' };
  const trickyUrl = new URL(buildShareLinks(tricky as AwgPeer, server, '194.50.94.28', 'x').wireguardUrl);
  assert.equal(trickyUrl.hostname, '194.50.94.28', 'ключ с «/» ломает разбор ссылки');
  assert.equal(decodeURIComponent(trickyUrl.username), tricky.private_key);
});

test('подсеть нормализуется: «10.9.0», «10.9.0.0» и «10.9.0.1/24» дают один конфиг интерфейса', () => {
  assert.equal(subnetBase('10.9.0'), '10.9.0');
  assert.equal(subnetBase('10.9.0.0'), '10.9.0');
  assert.equal(subnetBase('10.9.0.1/24'), '10.9.0');
  const a = buildInterfaceConf(server, [peer], 'PRIV=');
  const b = buildInterfaceConf({ ...server, subnet: '10.9.0.0' }, [peer], 'PRIV=');
  assert.equal(a, b);
  assert.ok(a.includes('Address = 10.9.0.1/32'));
  assert.ok(a.includes('PostUp = ip -4 route add 10.9.0.0/24 dev %i || true'), 'нет PostUp-маршрута подсети');
  assert.ok(a.includes('PrivateKey = PRIV='), 'потерян PrivateKey интерфейса');
  assert.ok(a.includes('ListenPort = 51820'));
});

test('алиас старого адреса остаётся в allowed-ips и маршрутах (миграция подсети не рвёт выданные конфиги)', () => {
  const migrated: AwgPeer = { ...peer, address: '10.9.0.2', alias: '10.88.0.2' };
  const conf = buildInterfaceConf(server, [migrated], 'PRIV=');
  assert.ok(conf.includes('AllowedIPs = 10.9.0.2/32, 10.88.0.2/32'), 'потерян алиас старого адреса');
  assert.ok(conf.includes('ip -4 route add 10.88.0.0/24 dev %i || true'), 'нет маршрута для старой подсети');
});

test('контракт сервиса: awg-команды маршрутизируются по режиму (ядро/контейнер), PrivateKey не теряется', () => {
  const modeUses = (awgSrc.match(/readAwgMode\(\)/g) || []).length;
  assert.ok(modeUses >= 2, 'awgExec не учитывает режим — вернулся риск перехвата команд старым контейнером');
  assert.ok(awgSrc.includes('persistInterfaceConf'), 'нет безопасной перезаписи конфига интерфейса');
  assert.ok(awgSrc.includes('readExistingPrivateKey'), 'нет чтения PrivateKey из существующего конфига');
  assert.ok(!awgSrc.includes('wireguard://${privKey}'), 'в ссылке снова сырой (некодированный) приватный ключ');
});

test('контракт подписки: base64-строка из строк-ссылок, известные клиентам схемы', () => {
  const sample = ['vless://uuid@host:443?type=tcp#izinet_Reality', 'hysteria2://pass@host:443?insecure=1#izinet_Hysteria2'].join('\n');
  const encoded = Buffer.from(sample).toString('base64');
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), sample);
  for (const scheme of ['vless://', 'hysteria2://']) {
    assert.ok(configSrc.includes(scheme), `подписка больше не содержит ${scheme}`);
  }
  assert.ok(configSrc.includes('wireguardUrl') && configSrc.includes('awgUrl'), 'подписка не добавляет AWG-ссылки');
  assert.ok(awgSrc.includes('wireguard://') && awgSrc.includes('awg://'), 'не собираются wireguard:// и awg:// ссылки');
  assert.ok(configSrc.includes("Buffer.from(outputText).toString('base64')"), 'подписка не в base64');
});

test('выдача .conf пользователю пересобирает файл из реестра (а не отдаёт устаревшую копию из БД)', () => {
  assert.ok(userSrc.includes('rebuild conf on download'), 'нет пересборки .conf при скачивании');
  assert.ok(userSrc.includes('AwgService.readPeersAsync'), 'пересборка не читает реестр пиров');
});
