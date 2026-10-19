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
 * Защита Xray: оставляет только корректные правила с известными outbound-тегами.
 * Возвращает очищенный список и пояснения, что было пропущено.
 */
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
