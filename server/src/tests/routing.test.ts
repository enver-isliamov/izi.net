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
  mapDomainToHysteria,
  mapIpToHysteria,
  buildHysteriaAcl,
  ensureXrayOutbounds,
} from '../utils/routing';

const root = process.cwd();
const routingPageSrc = fs.readFileSync(path.join(root, 'src/pages/Admin/Routing.tsx'), 'utf8');
const routingServiceSrc = fs.readFileSync(path.join(root, 'server/src/services/routing.service.ts'), 'utf8');
const maintenanceSrc = fs.readFileSync(path.join(root, 'server/src/services/maintenance.service.ts'), 'utf8');

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
  assert.ok(routingServiceSrc.includes('syncHysteriaAcl'), 'RoutingService не синхронизирует Hysteria2');
  assert.ok(routingServiceSrc.includes('/etc/hysteria/acl.txt'), 'нет пути ACL-файла Hysteria2');
  assert.ok(routingServiceSrc.includes('ensureXrayOutbounds'), 'нет защиты от ссылок на несуществующие outbounds');
  assert.ok(routingServiceSrc.includes('без изменений — пропускаю'), 'нет пропуска рестарта при отсутствии изменений');
  assert.ok(routingServiceSrc.includes('is-active hysteria2 2>/dev/null || true'), 'проверка статуса Hysteria2 может бросать исключение и ломать откат');
  assert.ok(routingServiceSrc.includes('const rollback ='), 'нет функции отката Hysteria2');
  assert.ok(routingServiceSrc.includes('izinet-hysteria-check'), 'нет preflight-проверки конфига Hysteria2 перед применением');
  assert.ok(routingServiceSrc.includes("hasOutbound: () => false"), 'Hysteria ACL не должен ссылаться на кастомные outbounds (2.6.1 не поддерживает)');
  assert.ok(maintenanceSrc.includes('routingInitialSyncDone'), 'routing-синк в maintenance должен быть один раз за запуск');
  assert.ok(maintenanceSrc.includes('Routing sync пропущен'), 'нет пропуска hourly-синка routing');
});

test('Hysteria2 ACL: маппинг доменов и IP из форматов Xray', () => {
  assert.equal(mapDomainToHysteria('domain:yandex.ru'), 'suffix:yandex.ru');
  assert.equal(mapDomainToHysteria('full:example.com'), 'example.com');
  // geosite без geo-баз в конфиге Hysteria2 валит сервис — пропускаем
  assert.equal(mapDomainToHysteria('geosite:google'), null);
  assert.equal(mapDomainToHysteria('regexp:.*\\.ru$'), null);
  assert.equal(mapDomainToHysteria('keyword:foo'), null);
  assert.equal(mapDomainToHysteria('8.8.8.8'), null);
  assert.equal(mapIpToHysteria('geoip:ru'), null);
  assert.equal(mapIpToHysteria('10.0.0.0/8'), '10.0.0.0/8');
  assert.equal(mapIpToHysteria('domain:foo'), null);
});

test('Hysteria2 ACL: сборка правил как у Xray (direct/reject, без geo-записей, пропуск proxy без outbound)', () => {
  const rules = [
    { name: 'RU', domains: ['domain:ru', 'geosite:ru'], ips: ['geoip:ru'], outbound_tag: 'direct' },
    { name: 'Block', domains: ['domain:torrent'], ips: [], outbound_tag: 'blocked' },
    { name: 'Gemini', domains: ['geosite:google'], ips: [], outbound_tag: 'ipv6-out' },
    { name: 'Proxy правило', domains: ['domain:example.com'], ips: [], outbound_tag: 'proxy' },
    { name: 'Regexp', domains: ['regexp:.*'], ips: [], outbound_tag: 'direct' },
  ];
  const { lines, skipped } = buildHysteriaAcl(rules as any, { hasOutbound: (t) => t === 'ipv6-out' });

  assert.ok(lines.includes('direct(suffix:ru)'));
  assert.ok(!lines.some((l) => l.includes('geosite') || l.includes('geoip')), 'geosite/geoip не должны попадать в ACL');
  assert.ok(lines.includes('reject(suffix:torrent)'));
  assert.ok(!lines.some((l) => l.startsWith('ipv6-out')));
  assert.ok(!lines.some((l) => l.startsWith('proxy')));
  assert.ok(skipped.some((s) => s.includes('geosite/geoip')));
  assert.ok(skipped.some((s) => s.includes('Gemini')));
  assert.ok(skipped.some((s) => s.includes('Proxy правило')));
  assert.ok(skipped.some((s) => s.includes('Regexp')));
});

test('Xray: несуществующие outbounds не попадают в конфиг (ipv6-out добавляется, proxy пропускается)', () => {
  const rules = [
    { name: 'RU', domains: ['domain:ru'], ips: [], outbound_tag: 'direct' },
    { name: 'Gemini', domains: ['geosite:google'], ips: [], outbound_tag: 'ipv6-out' },
    { name: 'Proxy правило', domains: ['domain:x.com'], ips: [], outbound_tag: 'proxy' },
  ];
  const outbounds = [
    { protocol: 'freedom', tag: 'direct' },
    { protocol: 'blackhole', tag: 'blocked' },
  ];
  const res = ensureXrayOutbounds(outbounds as any, rules as any);

  assert.ok(res.outbounds.some((o: any) => o.tag === 'ipv6-out'), 'ipv6-out должен быть добавлен');
  assert.equal(res.rules.length, 2, 'proxy-правило без outbound должно быть пропущено');
  assert.ok(!res.rules.some((r: any) => r.outbound_tag === 'proxy'));
  assert.ok(res.skipped.some((s: string) => s.includes('Proxy правило')));
});
