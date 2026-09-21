/**
 * Контрактные автотесты: ловят именно те классы регрессий, которые уже случались
 * (переименование API панели 3x-ui, неопубликованные порты, жёсткий интервал цикла).
 *
 * Запуск:  npm run test:server
 * Тесты читают исходники из корня репозитория — правки, ломающие контракт, падают здесь.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const xuiSrc = fs.readFileSync(path.join(root, 'server/src/services/xui.service.ts'), 'utf8');
const maintSrc = fs.readFileSync(path.join(root, 'server/src/services/maintenance.service.ts'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');

const isComment = (line: string) => line.trim().startsWith('//');
const hostLines = (src: string) => src.split('\n').filter((l) => l.includes('${this.host}') && !isComment(l));

test('нет вызовов устаревших (переименованных) маршрутов панели', () => {
  const legacy = [
    '/panel/api/inbounds/addClient',
    '/panel/api/inbounds/updateClient/',
    '/panel/api/inbounds/getClientTraffics',
    '/panel/api/inbounds/deleteClient',
    '/panel/api/inbounds/onlines',
    'inbounds/${inboundId}/resetClientTraffic',
  ];
  for (const bad of legacy) {
    const found = hostLines(xuiSrc).filter((l) => l.includes(bad));
    assert.equal(found.length, 0, `найден устаревший вызов ${bad}: ${found.join(' | ')}`);
  }
});

test('все панельные URL идут под /panel/api', () => {
  const urls = [...xuiSrc.matchAll(/\$\{this\.basePath\}\/panel[^`'"\s]*/g)].map((m) => m[0]);
  const bad = urls.filter((u) => !u.includes('/panel/api'));
  assert.deepEqual(bad, [], `URL без /panel/api: ${bad.join(', ')}`);
});

test('клиентские операции используют новый клиентский API', () => {
  const required = [
    'clients/update/',
    'clients/del/',
    'clients/traffic/',
    'clients/onlines',
    'clients/resetTraffic/',
  ];
  for (const part of required) {
    assert.ok(xuiSrc.includes(part), `не найден вызов нового API: ${part}`);
  }
});

test('настройки панели читаются через /panel/api/setting', () => {
  assert.ok(xuiSrc.includes('/panel/api/setting/all'), 'нет вызова /panel/api/setting/all');
  assert.ok(xuiSrc.includes('/panel/api/setting/update'), 'нет вызова /panel/api/setting/update');
});

test('compose публикует порты всех инбаундов', () => {
  for (const port of ['443', '2088', '2443', '22053', '2087']) {
    assert.ok(
      compose.includes(`"${port}:${port}"`),
      `docker-compose.yml не публикует порт ${port} — инбаунд будет недоступен снаружи`
    );
  }
});

test('интервал цикла обслуживания настраивается через env', () => {
  assert.ok(maintSrc.includes('MAINTENANCE_INTERVAL_MIN'), 'интервал цикла не настраивается через MAINTENANCE_INTERVAL_MIN');
  assert.ok(!maintSrc.includes('30 * 60 * 1000'), 'остался жёсткий интервал 30 минут');
});
