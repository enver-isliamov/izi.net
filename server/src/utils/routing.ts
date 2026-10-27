/**
 * Утилиты нормализации и защиты правил маршрутизации (vpn_routing_rules).
 * Используются и в админке (UI), и в серверном RoutingService:
 *  - админка превращает «yandex.ru» / «https://site.ru/x» / «8.8.8.8» в форматы Xray;
 *  - сервер перед отправкой в xrayTemplateConfig отбрасывает мусор,
 *    чтобы некорректное правило не могло сломать Xray на сервере.
 */

export interface RoutingRuleInput {
  name?: string | null;
  domains?: unknown;
  ips?: unknown;
  outbound_tag?: unknown;
}

export interface SanitizedRoutingRule {
  name: string;
  domains: string[];
  ips: string[];
  outbound_tag: string;
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/(3[0-2]|[12]?\d))?$/;
const IPV6_RE = /^[0-9a-f:]+(\/\d{1,3})?$/i;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const XRAY_DOMAIN_PREFIXES = /^(domain|full|regexp|geosite|keyword|ext|dotless):/i;
const GEOIP_PREFIX = /^geoip:/i;
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Outbound-теги, которые реально существуют в Xray-шаблоне серверов. */
export const ALLOWED_OUTBOUND_TAGS = new Set(['direct', 'proxy', 'blocked', 'ipv6-out']);

/** Совместимость со старым UI: 'block' → 'blocked' (реальный tag blackhole-выхода). */
const LEGACY_OUTBOUND_TAGS: Record<string, string> = { block: 'blocked' };

export function isIpOrCidr(value: string): boolean {
  const v = String(value || '').trim();
  return IPV4_RE.test(v) || (v.includes(':') && IPV6_RE.test(v));
}

export function isDomainName(value: string): boolean {
  return DOMAIN_RE.test(String(value || '').trim());
}

/** «yandex.ru» → «domain:yandex.ru»; «https://mail.ru/x» → «domain:mail.ru»; префиксы Xray сохраняются. */
export function normalizeDomainRule(value: unknown): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (XRAY_DOMAIN_PREFIXES.test(v)) return v;
  if (GEOIP_PREFIX.test(v)) return null;
  if (URL_RE.test(v)) {
    try {
      const host = new URL(v).hostname;
      return host && isDomainName(host) ? `domain:${host.toLowerCase()}` : null;
    } catch (e) {
      return null;
    }
  }
  if (isIpOrCidr(v)) return null;
  return isDomainName(v) ? `domain:${v.toLowerCase()}` : null;
}

/** «8.8.8.8» / «10.0.0.0/8» / «geoip:ru» проходят как есть; остальное — null. */
export function normalizeIpRule(value: unknown): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (GEOIP_PREFIX.test(v)) return v;
  return isIpOrCidr(v) ? v : null;
}

export function normalizeDomainEntries(raw: string): { values: string[]; invalid: string[] } {
  const values: string[] = [];
  const invalid: string[] = [];
  for (const part of String(raw || '').split(/[\s,;]+/).filter(Boolean)) {
    const normalized = normalizeDomainRule(part);
    if (normalized) values.push(normalized);
    else invalid.push(part.trim());
  }
  return { values: [...new Set(values)], invalid };
}

export function normalizeIpEntries(raw: string): { values: string[]; invalid: string[] } {
  const values: string[] = [];
  const invalid: string[] = [];
  for (const part of String(raw || '').split(/[\s,;]+/).filter(Boolean)) {
    const normalized = normalizeIpRule(part);
    if (normalized) values.push(normalized);
    else invalid.push(part.trim());
  }
  return { values: [...new Set(values)], invalid };
}

/**
 * Разбирает свободный список («yandex.ru, https://mail.ru/x, 8.8.8.8, 10.0.0.0/8, geoip:ru»)
 * на domains / ips / invalid. Пустые и некорректные значения попадают в invalid.
 */
export function normalizeSiteEntries(raw: string): { domains: string[]; ips: string[]; invalid: string[] } {
  const domains: string[] = [];
  const ips: string[] = [];
  const invalid: string[] = [];

  for (const part of String(raw || '').split(/[\s,;]+/).filter(Boolean)) {
    const v = part.trim();
    if (!v) continue;

    if (GEOIP_PREFIX.test(v)) { ips.push(v); continue; }
    if (XRAY_DOMAIN_PREFIXES.test(v)) { domains.push(v); continue; }
    if (URL_RE.test(v)) {
      try {
        const host = new URL(v).hostname;
        if (host && isDomainName(host)) domains.push(`domain:${host.toLowerCase()}`);
        else invalid.push(v);
      } catch (e) {
        invalid.push(v);
      }
      continue;
    }
    if (isIpOrCidr(v)) { ips.push(v); continue; }
    if (isDomainName(v)) { domains.push(`domain:${v.toLowerCase()}`); continue; }
    invalid.push(v);
  }

  return { domains: [...new Set(domains)], ips: [...new Set(ips)], invalid };
}

/** Человеческое имя правила по первому домену/IP. */
export function autoRuleName(domains: string[], ips: string[]): string {
  const first = [...domains, ...ips][0] || 'Правило';
  const clean = first.replace(/^(domain|full|regexp|geosite|geoip|keyword|ext|dotless):/i, '');
  const total = domains.length + ips.length;
  return total > 1 ? `${clean} + ещё ${total - 1}` : clean;
}

/**
 * Hysteria2 ACL — маппинг из форматов Xray.
 * Hysteria ACL: outbound(address); адреса: IP/CIDR, domain (точное), *.wildcard,
 * suffix:example.com, geoip:xx, geosite:xx, all. regexp/keyword/ext/dotless не поддерживаются.
 */
export function mapDomainToHysteria(entry: unknown): string | null {
  const v = String(entry ?? '').trim();
  if (!v) return null;
  // Hysteria 2.13 ships v2geo and supports geosite/geoip in ACL.
  // Keep the original prefix; do not silently drop the rule.
  if (/^geosite:/i.test(v)) return v;
  if (/^domain:/i.test(v)) return `suffix:${v.slice(7)}`;
  if (/^full:/i.test(v)) return v.slice(5);
  if (/^(regexp|keyword|ext|dotless):/i.test(v)) return null;
  return isDomainName(v) ? `suffix:${v.toLowerCase()}` : null;
}

export function mapIpToHysteria(entry: unknown): string | null {
  const v = String(entry ?? '').trim();
  if (!v) return null;
  // Hysteria 2.13 ships v2geo and supports geosite/geoip in ACL.
  if (/^geoip:/i.test(v)) return v;
  return isIpOrCidr(v) ? v : null;
}

/**
 * Защита Xray: гарантирует outbounds для используемых тегов.
 * ipv6-out добавляется автоматически (freedom через IPv6-source), остальные
 * отсутствующие теги (например proxy без настроенного upstream) — правило пропускается.
 */
export function ensureXrayOutbounds(
  outbounds: any[],
  rules: Array<{ name: string; outbound_tag: string; domains: string[]; ips: string[] }>
): { outbounds: any[]; rules: typeof rules; skipped: string[] } {
  const result = Array.isArray(outbounds) ? [...outbounds] : [];
  const tags = new Set(result.map((o) => o && o.tag).filter(Boolean));
  const skipped: string[] = [];

  if (rules.some((r) => r.outbound_tag === 'ipv6-out') && !tags.has('ipv6-out')) {
    result.push({ protocol: 'freedom', tag: 'ipv6-out', sendThrough: '::', settings: { domainStrategy: 'UseIPv6' } });
    tags.add('ipv6-out');
  }

  const kept: typeof rules = [];
  for (const rule of rules) {
    if (!tags.has(rule.outbound_tag)) {
      skipped.push(`${rule.name}: outbound «${rule.outbound_tag}» отсутствует в шаблоне Xray`);
      continue;
    }
    kept.push(rule);
  }

  return { outbounds: result, rules: kept, skipped };
}

/**
 * Собирает строки ACL для Hysteria2 из тех же правил, что уходят в Xray.
 * hasOutbound(tag) — какие кастомные outbounds реально есть в конфиге Hysteria.
 */
export function buildHysteriaAcl(
  rules: SanitizedRoutingRule[],
  options: { hasOutbound?: (tag: string) => boolean } = {}
): { lines: string[]; skipped: string[] } {
  const lines: string[] = [];
  const skipped: string[] = [];
  const hasOutbound = options.hasOutbound || (() => false);

  for (const rule of rules || []) {
    let outbound: string | null = null;
    if (rule.outbound_tag === 'direct') outbound = 'direct';
    else if (rule.outbound_tag === 'blocked' || rule.outbound_tag === 'block') outbound = 'reject';
    else if (rule.outbound_tag === 'ipv6-out') outbound = hasOutbound('ipv6-out') ? 'ipv6-out' : null;
    else if (rule.outbound_tag === 'proxy') outbound = hasOutbound('proxy') ? 'proxy' : null;

    if (!outbound) {
      skipped.push(`${rule.name}: outbound «${rule.outbound_tag}» не настроен в Hysteria2`);
      continue;
    }

    let added = 0;
    for (const domain of rule.domains || []) {
      const mapped = mapDomainToHysteria(domain);
      if (mapped) { lines.push(`${outbound}(${mapped})`); added++; }
    }
    for (const ip of rule.ips || []) {
      const mapped = mapIpToHysteria(ip);
      if (mapped) { lines.push(`${outbound}(${mapped})`); added++; }
    }
    if (!added) skipped.push(`${rule.name}: нет записей, совместимых с ACL Hysteria2`);
  }

  return { lines, skipped };
}

export function sanitizeRoutingRules(rules: RoutingRuleInput[]): { rules: SanitizedRoutingRule[]; skipped: string[] } {
  const out: SanitizedRoutingRule[] = [];
  const skipped: string[] = [];

  for (const rule of rules || []) {
    const name = String(rule?.name || 'Правило');
    const rawTag = String(rule?.outbound_tag || '').trim();
    const tag = LEGACY_OUTBOUND_TAGS[rawTag] || rawTag;

    if (!ALLOWED_OUTBOUND_TAGS.has(tag)) {
      skipped.push(`${name}: неизвестный outbound_tag «${rawTag || '—'}»`);
      continue;
    }

    const domains = (Array.isArray(rule?.domains) ? rule.domains : [])
      .map(normalizeDomainRule)
      .filter((v): v is string => !!v);
    const ips = (Array.isArray(rule?.ips) ? rule.ips : [])
      .map(normalizeIpRule)
      .filter((v): v is string => !!v);

    if (!domains.length && !ips.length) {
      skipped.push(`${name}: нет корректных доменов или IP`);
      continue;
    }

    out.push({
      name,
      domains: [...new Set(domains)],
      ips: [...new Set(ips)],
      outbound_tag: tag,
    });
  }

  return { rules: out, skipped };
}
