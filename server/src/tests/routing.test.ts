/**
 * Тесты нормализации и защиты правил маршрутизации.
 * Запуск: npm run test:server
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeDomainRule,
  normalizeIpRule,
  normalizeSiteEntries,
  sanitizeRoutingRules,
  autoRuleName,
} from '../utils/routing';

const root = process.cwd();
const routingPageSrc = fs.readFileSync(path.join(root, 'src/pages/Admin/Routing.tsx'), 'utf8');
const routingServiceSrc = fs.readFileSync(path.join(root, 'server/src/services/routing.service.ts'), 'utf8');

test('normalizeDomainRule: домены, ссылки и Xray-префиксы', () => {
  assert.equal(normalizeDomainRule('yandex.ru'), 'domain:yandex.ru');
  assert.equal(normalizeDomainRule('https://Mail.Yandex.ru/inbox?x=1'), 'domain:mail.yandex.ru');
  assert.equal(normalizeDomainRule('domain:example.com'), 'domain:example.com');
  assert.equal(normalizeDomainRule('full:example.com'), 'full:example.com');
  assert.equal(normalizeDomainRule('geosite:ru'), 'geosite:ru');
  assert.equal(normalizeDomainRule('regexp:.*\\.ru$'), 'regexp:.*\\.ru$');
  assert.equal(normalizeDomainRule('8.8.8.8'), null);
  assert.equal(normalizeDomainRule('bad domain'), null);
  assert.equal(normalizeDomainRule(''), null);
});

test('normalizeIpRule: IP, CIDR и geoip', () => {
  assert.equal(normalizeIpRule('8.8.8.8'), '8.8.8.8');
  assert.equal(normalizeIpRule('10.0.0.0/8'), '10.0.0.0/8');
  assert.equal(normalizeIpRule('geoip:ru'), 'geoip:ru');
  assert.equal(normalizeIpRule('999.1.1.1'), null);
  assert.equal(normalizeIpRule('yandex.ru'), null);
});

test('normalizeSiteEntries: смешанный ввод из админки', () => {
  const r = normalizeSiteEntries('yandex.ru, https://mail.ru/x, 8.8.8.8, 10.0.0.0/8, geoip:ru, geosite:google, мусор');
  assert.deepEqual(r.domains, ['domain:yandex.ru', 'domain:mail.ru', 'geosite:google']);
  assert.deepEqual(r.ips, ['8.8.8.8', '10.0.0.0/8', 'geoip:ru']);
  assert.deepEqual(r.invalid, ['мусор']);
});

test('autoRuleName: читаемое имя правила', () => {
  assert.equal(autoRuleName(['domain:yandex.ru'], []), 'yandex.ru');
  assert.equal(autoRuleName(['domain:yandex.ru', 'geosite:ru'], ['geoip:ru']), 'yandex.ru + ещё 2');
});

test('sanitizeRoutingRules: мусор и неизвестные теги не доходят до Xray', () => {
  const { rules, skipped } = sanitizeRoutingRules([
    { name: 'RU', domains: ['domain:ru', 'yandex.ru', 'geosite:ru'], ips: ['geoip:ru'], outbound_tag: 'direct' },
    { name: 'Bad tag', domains: ['domain:x.com'], ips: [], outbound_tag: 'hack' },
    { name: 'Legacy block', domains: ['domain:torrent'], ips: [], outbound_tag: 'block' },
    { name: 'Junk', domains: ['not a domain', ''], ips: ['999.0.0.1'], outbound_tag: 'proxy' },
    { name: 'IPv6', domains: [], ips: ['2001:db8::/32'], outbound_tag: 'ipv6-out' },
  ]);

  assert.equal(rules.length, 3);
  assert.deepEqual(rules[0].domains, ['domain:ru', 'domain:yandex.ru', 'geosite:ru']);
  assert.deepEqual(rules[0].ips, ['geoip:ru']);
  assert.equal(rules[1].outbound_tag, 'blocked');
  assert.equal(rules[2].outbound_tag, 'ipv6-out');
  assert.equal(skipped.length, 2);
  assert.ok(skipped.some(s => s.includes('Bad tag')));
  assert.ok(skipped.some(s => s.includes('Junk')));
});

test('контракты: админка даёт быстрое добавление, сервис использует защиту', () => {
  assert.ok(routingPageSrc.includes('Быстрое добавление'), 'нет блока быстрого добавления');
  assert.ok(routingPageSrc.includes('Мимо VPN') && routingPageSrc.includes('Через VPN'), 'нет выбора направления');
  assert.ok(routingPageSrc.includes('normalizeSiteEntries'), 'UI не нормализует ввод');
  assert.ok(routingServiceSrc.includes('sanitizeRoutingRules'), 'RoutingService не защищает Xray-конфиг');
});
