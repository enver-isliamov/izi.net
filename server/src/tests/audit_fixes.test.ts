import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

test('must-fix 1: глобальный TLS-off убран, небезопасный агент только для панели', () => {
  const index = read('server/src/index.ts');
  const axios = read('server/src/utils/axios.ts');
  const payment = read('server/src/services/payment.service.ts');
  assert.ok(!index.includes("NODE_TLS_REJECT_UNAUTHORIZED = '0'"), 'глобальный TLS-off вернулся');
  assert.ok(axios.includes('panelHttpsAgent'), 'нет отдельного агента панели');
  assert.ok(/panelHttpsAgent[\s\S]{0,200}rejectUnauthorized:\s*false/.test(axios), 'панельный агент не настроен');
  assert.ok(!payment.includes('sharedHttpsAgent'), 'платежи снова используют небезопасный агент');
  assert.ok(!fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8').includes('NODE_TLS_REJECT_UNAUTHORIZED'), 'Dockerfile снова отключает TLS глобально');
});

test('must-fix 2: sync-эндпоинты требуют авторизации', () => {
  const cfg = read('server/src/routes/config.ts');
  assert.ok(/router\.post\('\/sync-servers',\s*authenticateUser/.test(cfg), 'sync-servers без auth');
  assert.ok(/router\.post\('\/sync-traffic',\s*authenticateUser/.test(cfg), 'sync-traffic без auth');
});

test('must-fix 3: платёж сначала атомарно забирается в processing', () => {
  const pay = read('server/src/services/payment.service.ts');
  assert.ok(pay.includes("status: 'processing'"), 'нет claim в processing');
  assert.ok(/\.eq\('status',\s*'pending'\)/.test(pay), 'claim не привязан к pending');
  assert.ok(/if \(!claimed\)/.test(pay), 'нет обработки проигравшего гонку webhook');
});

test('must-fix 4: regenerate не удаляет старый ключ до создания нового на всех серверах', () => {
  const user = read('server/src/routes/user.ts');
  assert.ok(user.includes('provisioned.length !== activeServers.length'), 'нет атомарной проверки всех серверов');
  assert.ok(user.includes('deleteClient(newUuid, newEmail)'), 'нет откката новых клиентов');
  const start = user.indexOf('const provisioned');
  const end = user.indexOf('devices[targetIdx]', start);
  const block = user.slice(start, end);
  assert.ok(block.indexOf('addClient') < block.indexOf('deleteClient(target.uuid'), 'старый ключ удаляется до создания нового');
});

test('must-fix 5: лишние уязвимые зависимости удалены', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!pkg.dependencies['crypto-js'], 'crypto-js всё ещё в dependencies');
  assert.ok(!pkg.dependencies['@google/genai'], '@google/genai всё ещё в dependencies');
  assert.ok(!pkg.dependencies['vite'], 'vite дублируется в dependencies');
  assert.ok(pkg.devDependencies['vite'], 'vite пропал из devDependencies');
});

test('must-fix 6: в коде нет жёстко прописанного email суперадмина', () => {
  const auth = read('server/src/utils/auth.ts');
  assert.ok(!auth.includes('enverphoto@gmail.com'), 'hardcoded email вернулся');
  assert.ok(auth.includes('SUPERADMIN_EMAILS'), 'нет env-allowlist для bootstrap');
});

test('AWG: общий sync не трогает AmneziaWG-инбаунды и AWG-устройства', () => {
  const xui = read('server/src/services/xui.service.ts');
  const maintenance = read('server/src/services/maintenance.service.ts');
  assert.ok(xui.includes("['vless', 'vmess', 'trojan', 'shadowsocks']"), 'нет allowlist клиентских протоколов');
  assert.ok(/if \(!supportsClients\) continue;/.test(xui), 'AWG/WireGuard снова попадает в ensureClientInAllInbounds');
  assert.ok(maintenance.includes("String(d.serverType).toUpperCase() !== 'AWG'"), 'AWG-устройства снова идут в общий sync');
});
test('safe update: не делает compose down, не трогает x3-ui по умолчанию, восстанавливает AWG NAT', () => {
  const update = read('update.sh');
  assert.ok(!/^\\s*docker compose down/m.test(update), 'update.sh снова останавливает весь compose');
  assert.ok(update.includes('docker compose build "$APP_SERVICE"'), 'нет сборки только приложения');
  assert.ok(update.includes('--no-deps --no-build'), 'нет запуска только app');
  assert.ok(update.includes('ensure_awg_nat.sh'), 'update.sh не восстанавливает NAT после reboot');
  const nat = read('scripts/amneziawg/ensure_awg_nat.sh');
  assert.ok(nat.includes('MASQUERADE'), 'NAT-скрипт не добавляет MASQUERADE');
  assert.ok(nat.includes('net.ipv4.ip_forward=1'), 'NAT-скрипт не включает forwarding');
  const setup = read('scripts/amneziawg/setup_awg.sh');
  assert.ok(setup.includes('ensure_awg_nat.sh'), 'setup_awg.sh не вызывает NAT persistence');
});
