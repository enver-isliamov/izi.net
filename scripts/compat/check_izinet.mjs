#!/usr/bin/env node
/**
 * izinet · проверка совместимости и живости (только Node.js, без зависимостей).
 *
 *   node scripts/compat/check_izinet.mjs --conf <файл.conf>   # проверить скачанный AmneziaWG-конфиг
 *   node scripts/compat/check_izinet.mjs --sub  <url|файл>    # проверить подписку (ссылка из кабинета или izinet.txt)
 *   node scripts/compat/check_izinet.mjs --live [--host IP]   # проверить доступность сервера снаружи (TCP/TLS)
 *
 * Запускать можно на своём компьютере (Windows/Linux/macOS) или на сервере:
 *   node check_izinet.mjs --live --host 194.50.94.28
 */
import fs from 'node:fs';
import tls from 'node:tls';

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

let failures = 0;
const ok = (s) => console.log(`  ✓ ${s}`);
const warn = (s) => console.log(`  ⚠ ${s}`);
const fail = (s) => { failures++; console.log(`  ✗ ${s}`); };
const info = (s) => console.log(`  ℹ ${s}`);

const isB64Key = (v) => typeof v === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(v.trim());

// ---------------------------------------------------------------------------
// 1) Проверка клиентского AmneziaWG-конфига (.conf)
// ---------------------------------------------------------------------------
function checkConf(file) {
  console.log(`\n== AmneziaWG-конфиг: ${file} ==`);
  const text = fs.readFileSync(file, 'utf8');

  if (text.includes('\r')) warn('в файле CRLF — большинство клиентов принимает, но часть роутеров требует LF');
  if (!text.startsWith('[Interface]')) fail('файл не начинается с [Interface] — нестандартный конфиг');

  const sections = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^\[(.+)\]$/);
    if (m) { current = m[1]; sections[current] = sections[current] || {}; continue; }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (kv && current) sections[current][kv[1]] = kv[2].trim();
  }

  const iface = sections['Interface'] || {};
  const peer = sections['Peer'] || {};

  // Ключи
  if (iface.PrivateKey) {
    isB64Key(iface.PrivateKey) ? ok('PrivateKey: валидный ключ (base64, 44 символа)')
      : fail('PrivateKey не похож на ключ WireGuard (base64, 44 символа)');
  } else fail('нет PrivateKey в [Interface] — клиент не сможет подключиться');

  if (peer.PublicKey) {
    isB64Key(peer.PublicKey) ? ok('PublicKey сервера: валидный ключ') : fail('PublicKey сервера не похож на ключ');
  } else fail('нет PublicKey сервера в [Peer]');

  // Адрес и маршрутизация
  if (/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(iface.Address || '')) ok(`Address: ${iface.Address}`);
  else fail(`Address: «${iface.Address || 'отсутствует'}» — ожидается вид 10.x.x.x/32`);

  if (/^0\.0\.0\.0\/0$/.test((peer.AllowedIPs || '').split(',')[0].trim())) ok('AllowedIPs: весь трафик через туннель (0.0.0.0/0)');
  else warn(`AllowedIPs: ${peer.AllowedIPs || 'отсутствует'} — трафик может идти мимо туннеля`);

  if (/^[a-zA-Z0-9.\-]+:\d{1,5}$/.test(peer.Endpoint || '')) ok(`Endpoint: ${peer.Endpoint}`);
  else fail(`Endpoint: «${peer.Endpoint || 'отсутствует'}» — ожидается host:port`);

  // DNS и MTU
  if ((iface.DNS || '').split(',').every((d) => /^\s*\d{1,3}(\.\d{1,3}){3}\s*$/.test(d) || !d)) ok(`DNS: ${iface.DNS}`);
  else warn(`DNS: «${iface.DNS || 'нет'}» — проверьте, что это IP-адреса`);
  const mtu = Number(iface.MTU || 1280);
  mtu > 1420 ? warn(`MTU=${mtu} может фрагментироваться (обычно 1280)`) : ok(`MTU: ${mtu}`);

  // Параметры обфускации AmneziaWG: Jc/Jmin/Jmax/S1/S2 — uint16, H1-H4 — uint32 (диапазоны парсеров amneziawg-tools)
  for (const k of ['Jc', 'Jmin', 'Jmax', 'S1', 'S2']) {
    const v = Number(iface[k]);
    if (!Number.isFinite(v)) fail(`${k}: отсутствует (обфускация неполная)`);
    else if (v < 0 || v > 65535) fail(`${k}=${v}: вне диапазона 0..65535 — клиент не примет файл`);
    else ok(`${k} = ${v}`);
  }
  for (const k of ['H1', 'H2', 'H3', 'H4']) {
    const v = Number(iface[k]);
    if (!Number.isFinite(v)) fail(`${k}: отсутствует (обфускация неполная)`);
    else if (!(v > 4 && v <= 4294967295)) fail(`${k}=${v}: вне допустимого диапазона — клиент не примет файл`);
    else ok(`${k} = ${v}`);
  }
  if (Number(iface.Jmin) > Number(iface.Jmax)) fail('Jmin больше Jmax — часть сборок такой конфиг не принимает');

  // Неизвестные поля в [Interface]
  const known = new Set(['PrivateKey', 'Address', 'DNS', 'MTU', 'ListenPort', 'FwMark', 'Table', 'SaveConfig',
    'PreUp', 'PostUp', 'PreDown', 'PostDown', 'Jc', 'Jmin', 'Jmax', 'S1', 'S2', 'S3', 'S4',
    'H1', 'H2', 'H3', 'H4', 'I1', 'I2', 'I3', 'I4', 'I5', 'Itime']);
  for (const k of Object.keys(iface)) if (!known.has(k)) warn(`неизвестное поле «${k}» — часть клиентов может его игнорировать`);

  console.log('');
  console.log('  ── Куда пойдёт файл ──');
  console.log('  ✓ AmneziaVPN / AmneziaWG-приложения (Windows, macOS, iOS, Android, Android TV) — импорт файла поддерживается');
  console.log('  ℹ Роутеры Keenetic (KeeneticOS с поддержкой AmneziaWG) — «Другие подключения» → импорт из файла');
  console.log('  ℹ OpenWrt / GL.iNet — нужны пакеты amneziawg-tools + kmod-amneziawg (ставятся скриптом Amnezia)');
  console.log('  ⛔ Обычному WireGuard-клиенту без поддержки AmneziaWG не подойдёт (в файле обфускация Jc/Jmin/S1/H1-H4)');
}

// ---------------------------------------------------------------------------
// 2) Проверка подписки (универсальная ссылка или izinet.txt)
// ---------------------------------------------------------------------------
function decodeMaybeBase64(text) {
  const compact = text.replace(/\s+/g, '');
  if (compact.length > 16 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
    try {
      const d = Buffer.from(compact, 'base64').toString('utf8');
      if (d.includes('://')) return d;
    } catch {}
  }
  return text;
}

async function checkSub(source) {
  console.log(`\n== Подписка: ${source} ==`);
  let text;
  try {
    if (/^https?:\/\//.test(source)) {
      const r = await fetch(source, { redirect: 'follow' });
      if (!r.ok) { fail(`HTTP ${r.status} — ссылка не выдаёт подписку`); return; }
      ok(`HTTP ${r.status}, тип: ${r.headers.get('content-type') || 'н/д'}`);
      text = await r.text();
    } else {
      text = fs.readFileSync(source, 'utf8');
      ok('файл прочитан');
    }
  } catch (e) {
    fail(`не удалось получить подписку: ${e.message}`);
    return;
  }

  const decoded = decodeMaybeBase64(text);
  if (decoded !== text) ok('содержимое — base64 (стандартный формат подписок v2ray-клиентов)');

  const lines = decoded.split('\n').map((l) => l.trim()).filter(Boolean);
  const counts = { vless: 0, hysteria2: 0, wireguard: 0, awg: 0, other: 0 };
  const problems = [];

  for (const line of lines) {
    try {
      if (line.startsWith('vless://')) {
        counts.vless++;
        const u = new URL(line);
        if (!u.username) problems.push('vless без UUID');
        if (!u.hostname) problems.push('vless без адреса сервера');
        if (u.searchParams.get('security') === 'reality') {
          for (const p of ['pbk', 'fp', 'sni']) if (!u.searchParams.get(p)) problems.push(`vless(reality) без ${p}`);
        }
      } else if (line.startsWith('hysteria2://') || line.startsWith('hy2://')) {
        counts.hysteria2++;
        new URL(line);
      } else if (line.startsWith('wireguard://')) {
        counts.wireguard++;
        const u = new URL(line);
        const key = decodeURIComponent(u.username || '');
        if (!isB64Key(key)) problems.push('wireguard:// — ключ в ссылке повреждён (ранее ломался при символе «/»)');
        if (!u.hostname || !u.port) problems.push('wireguard:// — не разбирается адрес сервера');
      } else if (line.startsWith('awg://')) {
        counts.awg++;
        const u = new URL(line);
        const key = decodeURIComponent(u.username || '');
        if (!isB64Key(key)) problems.push('awg:// — ключ в ссылке повреждён');
      } else counts.other++;
    } catch (e) {
      problems.push(`строка не разобралась: ${line.slice(0, 60)}…`);
    }
  }

  ok(`строк всего: ${lines.length}`);
  for (const [k, v] of Object.entries(counts)) if (v) console.log(`    ${k}: ${v}`);
  problems.length ? problems.forEach((p) => fail(p)) : ok('все строки структурно корректны');

  console.log('');
  console.log('  ── Кто что поймёт ──');
  console.log('  ✓ Hiddify, Happ, INCY, v2rayNG и другие v2ray-клиенты — строки vless:// и hysteria2://');
  console.log('  ℹ wireguard:// и awg:// — понимают немногие приложения; для роутеров и AmneziaVPN используйте .conf-файл');
}

// ---------------------------------------------------------------------------
// 3) Живые проверки сервера: TCP/TLS до инбаундов и сайт
// ---------------------------------------------------------------------------
function tlsProbe(host, port, sni, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const socket = tls.connect({ host, port, servername: sni, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const ms = Date.now() - t0;
      const cert = (() => { try { return socket.getPeerCertificate(); } catch { return null; } })();
      socket.destroy();
      resolve({ ok: true, ms, cn: cert && cert.subject ? cert.subject.CN : 'н/д' });
    });
    socket.on('error', (e) => resolve({ ok: false, error: e.message }));
    socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, error: 'таймаут' }); });
  });
}

async function checkLive(host) {
  console.log(`\n== Живая проверка: ${host} ==`);
  const targets = [
    { port: 443, sni: 'www.cloudflare.com', label: 'VLESS Reality TCP' },
    { port: 2443, sni: 'www.microsoft.com', label: 'VLESS Reality TCP' },
    { port: 22053, sni: 'www.microsoft.com', label: 'VLESS Reality TCP' },
    { port: 2022, sni: 'www.cloudflare.com', label: 'VLESS Reality gRPC' },
    { port: 2087, sni: 'www.cloudflare.com', label: 'VLESS Reality xhttp' },
    { port: 2088, sni: 'www.cloudflare.com', label: 'VLESS Reality xhttp' },
  ];
  for (const t of targets) {
    const r = await tlsProbe(host, t.port, t.sni);
    if (r.ok) ok(`${t.port} · ${t.label} — TLS отвечает за ${r.ms} мс (сертификат ${r.cn})`);
    else fail(`${t.port} · ${t.label} — ${r.error}`);
  }

  try {
    const r = await fetch('https://izinet.online/', { redirect: 'follow' });
    r.ok ? ok(`сайт izinet.online — HTTP ${r.status}`) : fail(`сайт izinet.online — HTTP ${r.status}`);
    const cfg = await fetch('https://izinet.online/api/config', { redirect: 'follow' }).catch(() => null);
    if (cfg && cfg.ok) {
      const j = await cfg.json().catch(() => null);
      j ? ok(`API /api/config отвечает (publicUrl: ${j.publicUrl || 'н/д'})`) : warn('API /api/config вернул не-JSON');
    } else warn('API /api/config недоступен извне (для работы VPN это не критично)');
  } catch (e) {
    fail(`сайт izinet.online недоступен: ${e.message}`);
  }

  info('UDP-сервисы (AmneziaWG 51820/udp, Hysteria2 443/udp) этой утилитой не проверяются — их подтверждает подключение реального клиента или статус в админке.');
}

// ---------------------------------------------------------------------------
const conf = getArg('--conf');
const sub = getArg('--sub');
const live = args.includes('--live');
const host = getArg('--host') || '194.50.94.28';

if (!conf && !sub && !live) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n').replace(/^ \* ?/gm, ''));
  process.exit(0);
}

if (conf) checkConf(conf);
if (sub) await checkSub(sub);
if (live) await checkLive(host);

console.log('');
if (failures > 0) {
  console.log(`Итог: найдено проблем — ${failures}. Смотрите строки «✗».`);
  process.exit(1);
} else {
  console.log('Итог: OK — проверка пройдена.');
}
