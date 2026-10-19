import { supabase } from './supabase';
import { isUnroutableHost } from '../utils/vpn';
import { getXuiForServer } from './xui.service';
import { restartContainer } from '../utils/docker';
import { sanitizeRoutingRules, buildHysteriaAcl, ensureXrayOutbounds, SanitizedRoutingRule } from '../utils/routing';
import { execSync } from 'child_process';

const HYSTERIA_CONF = '/etc/hysteria/config.yaml';
const HYSTERIA_ACL = '/etc/hysteria/acl.txt';

const shq = (value: string) => "'" + String(value).replace(/'/g, "'\\''") + "'";

/** Выполнение команды на ХОСТЕ из контейнера приложения (тот же паттерн, что в AWG/Hysteria-скриптах). */
function hostExec(command: string, timeout = 30000): string {
  const wrapped = `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m -u -n -i sh -c ${shq(command)}`;
  try {
    return execSync(wrapped, { timeout, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch (e: any) {
    const stderr = e?.stderr ? String(e.stderr).trim() : '';
    throw new Error(stderr || e.message);
  }
}

export class RoutingService {
  /**
   * Pushes routing rules from DB to all active VPN servers.
   * Also initializes Xray API inbound, stats, and policy in xrayTemplateConfig.
   */
  static async syncAll() {
    console.log('🔄 [Routing] Synchronizing rules to all panels...');
    try {
      // 1. Ensure basic rules exist in DB
      const { data: existing } = await supabase.from('vpn_routing_rules').select('*').limit(1);
      if (!existing || existing.length === 0) {
        await supabase.from('vpn_routing_rules').insert([
          { name: 'Gemini / Google Services', domains: ['geosite:google', 'geosite:openai', 'geosite:gemini', 'domain:ai.com', 'geosite:anthropic'], outbound_tag: 'direct', is_active: true },
          { name: 'Russia Bypass (GeoIP + GeoSite)', domains: ['geosite:ru'], ips: ['geoip:ru'], outbound_tag: 'direct', is_active: true }
        ]);
      }

      const { data: rules } = await supabase.from('vpn_routing_rules').select('*').eq('is_active', true);
      const { data: servers } = await supabase.from('vpn_servers').select('*').eq('is_active', true)
        .then((r: any) => ({ ...r, data: (r.data || []).filter((s: any) => !isUnroutableHost(s.ip || s.public_host || s.domain)) }));

      if (!rules || !servers) return;

      // Защита Xray: пропускаем только корректные правила и известные outbound-теги,
      // чтобы ошибочная запись из админки не могла сломать xrayTemplateConfig.
      const { rules: safeRules, skipped } = sanitizeRoutingRules(rules);
      if (skipped.length) {
        console.warn(`⚠️ [Routing] Пропущены некорректные правила (${skipped.length}): ${skipped.join('; ')}`);
      }

      for (const server of servers) {
        try {
          const { instance } = await getXuiForServer(server.id);
          const settings = await instance.getSettings();

          let xrayConfig = JSON.parse(settings.xrayTemplateConfig || '{}');
          const beforeConfig = JSON.stringify(xrayConfig);

          // DEBUG: Log current state
          console.log(`🔍 [Routing] ${server.name} template BEFORE: api=${!!xrayConfig.api} stats=${!!xrayConfig.stats} policy=${!!xrayConfig.policy} inbounds=${(xrayConfig.inbounds || []).length} rules=${(xrayConfig.routing?.rules || []).length}`);

          // --- Xray API Initialization (API ядра Xray) ---
          if (!xrayConfig.api) {
            xrayConfig.api = { tag: 'api', services: ['HandlerService', 'LoggerService', 'StatsService'] };
          }
          if (!xrayConfig.stats) xrayConfig.stats = {};
          if (!xrayConfig.policy) {
            xrayConfig.policy = {
              levels: { '0': { statsUserUplink: true, statsUserDownlink: true } },
              system: { statsInboundUplink: true, statsInboundDownlink: true, statsOutboundUplink: true, statsOutboundDownlink: true }
            };
          }

          // --- DNS Configuration (only set if empty, don't overwrite bootstrap DNS) ---
          if (!xrayConfig.dns || !xrayConfig.dns.servers || xrayConfig.dns.servers.length === 0) {
            xrayConfig.dns = {
              servers: ['1.1.1.1', '8.8.8.8', '9.9.9.9'],
          queryStrategy: 'UseIPv4',
          disableFallback: true
            };
          }

          // --- Outbounds (required for routing to work) ---
          if (!xrayConfig.outbounds || xrayConfig.outbounds.length === 0) {
            xrayConfig.outbounds = [
              { protocol: 'freedom', tag: 'direct' },
              { protocol: 'blackhole', tag: 'blocked' }
            ];
          }

          // Гарантируем outbounds для всех используемых тегов: ipv6-out добавим сами,
          // а правила с несуществующими тегами (например proxy без upstream) пропустим —
          // иначе Xray не запустится и у всех пользователей пропадёт VPN.
          const ensured = ensureXrayOutbounds(xrayConfig.outbounds || [], safeRules);
          if (ensured.outbounds.length !== (xrayConfig.outbounds || []).length) {
            xrayConfig.outbounds = ensured.outbounds;
            console.log('➕ [Routing] Добавлен outbound ipv6-out (freedom, IPv6-source)');
          }
          if (ensured.skipped.length) {
            console.warn(`⚠️ [Routing] ${server.name}: пропущены правила без outbound: ${ensured.skipped.join('; ')}`);
          }
          const xrayRules = ensured.rules.map(r => {
            const rule: any = { type: 'field', outboundTag: r.outbound_tag, izinet_managed: true };
            if (r.domains?.length) rule.domain = r.domains;
            if (r.ips?.length) rule.ip = r.ips;
            return rule;
          });

          // Ensure API inbound exists (dokodemo-door on 127.0.0.1:62789)
          if (!xrayConfig.inbounds) xrayConfig.inbounds = [];
          if (!xrayConfig.inbounds.find((i: any) => i.tag === 'api')) {
            xrayConfig.inbounds.unshift({
              listen: '127.0.0.1',
              port: 62789,
              protocol: 'dokodemo-door',
              settings: { address: '127.0.0.1' },
              tag: 'api'
            });
          }

          // Remove any vless-reality inbound from template (Reality lives in SQLite, not template)
          // Previous buggy code injected a dummy inbound with empty keys that broke Xray.
          const beforeLen = xrayConfig.inbounds.length;
          xrayConfig.inbounds = xrayConfig.inbounds.filter((i: any) => i.tag !== 'vless-reality');
          if (xrayConfig.inbounds.length < beforeLen) {
            console.log(`🧹 [Routing] Removed ${beforeLen - xrayConfig.inbounds.length} stale vless-reality from template`);
          }

          // --- Routing Initialization ---
          if (!xrayConfig.routing) xrayConfig.routing = {};
          if (!xrayConfig.routing.rules) xrayConfig.routing.rules = [];

          // Add api routing if missing
          if (!xrayConfig.routing.rules.find((r: any) => r.outboundTag === 'api')) {
            xrayConfig.routing.rules.unshift({
              inboundTag: ['api'],
              outboundTag: 'api',
              type: 'field',
              izinet_managed: true
            });
          }

          // Remove old managed rules (excluding api)
          xrayConfig.routing.rules = xrayConfig.routing.rules.filter((r: any) => !r.izinet_managed || r.outboundTag === 'api');

          // Prepend current rules from DB
          const finalRules = xrayRules.map(r => ({ ...r, izinet_managed: true }));
          xrayConfig.routing.rules = [...finalRules, ...xrayConfig.routing.rules];

          // Если ничего не изменилось — НЕ трогаем панель и Xray (иначе каждый час рвём всем VPN)
          const afterConfig = JSON.stringify(xrayConfig);
          if (afterConfig === beforeConfig) {
            console.log(`⏭️ [Routing] ${server.name}: без изменений — пропускаю updateSettings/перезапуск панели`);
            continue;
          }

          settings.xrayTemplateConfig = JSON.stringify(xrayConfig, null, 2);

          // Ensure API port is set
          if (settings.apiPort === 0 || !settings.apiPort) settings.apiPort = 62789;

          // DEBUG: Log what we're about to save
          console.log(`🔍 [Routing] ${server.name} template AFTER: api=${!!xrayConfig.api} stats=${!!xrayConfig.stats} policy=${!!xrayConfig.policy} inbounds=${(xrayConfig.inbounds || []).length} rules=${(xrayConfig.routing?.rules || []).length}`);

          // 1. Update via HTTP API (form-urlencoded — 3x-ui requires this format)
          // NOTE: updateSettings() may not persist xrayTemplateConfig in X-UI v26.4.25
          // SQLite patching is handled by update.sh on the host
          try {
            await instance.updateSettings(settings);
          } catch (e: any) {
            console.warn(`⚠️ [Routing] updateSettings failed (non-critical, host script handles SQLite): ${e.message}`);
          }

          // 2. Restart panel to apply changes to xray core
          await instance.restartPanel();

          console.log(`✅ [Routing] Rules synced to ${server.name}`);
        } catch (e: any) {
          console.error(`❌ [Routing] Failed on ${server.name}:`, e.message);
        }
      }

      // 3. Hysteria2: те же правила → серверный ACL. Ссылки пользователей не меняются.
      const hysteria = this.syncHysteriaAcl(safeRules);

      return { success: true, servers: servers.length, xrayRules: safeRules.length, skipped, hysteria };
    } catch (err: any) {
      console.error('❌ [Routing] Sync failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Применяет те же правила к Hysteria2 через серверный ACL (file: /etc/hysteria/acl.txt).
   * При неудачном рестарте — автоматический откат конфига. Ссылки клиентов не меняются.
   */
  private static syncHysteriaAcl(rules: SanitizedRoutingRule[]): { applied: boolean; rules: number; reason?: string; skipped: string[] } {
    try {
      if (hostExec('command -v hysteria2 >/dev/null 2>&1 && echo YES || echo NO', 15000) !== 'YES') {
        return { applied: false, rules: 0, reason: 'hysteria2 не установлен на этом хосте', skipped: [] };
      }

      const cfgB64 = hostExec(`base64 -w0 ${HYSTERIA_CONF} 2>/dev/null || echo ''`, 15000);
      if (!cfgB64) {
        return { applied: false, rules: 0, reason: 'конфиг Hysteria2 не найден', skipped: [] };
      }
      let cfg = Buffer.from(cfgB64, 'base64').toString('utf8');

      // ACL: если уже настроен вручную (inline или другой файл) — не перезаписываем
      let cfgChanged = false;
      const cfgLines = cfg.split('\n');
      const aclIdx = cfgLines.findIndex((l) => /^acl:[ \t]*$/.test(l));
      if (aclIdx >= 0) {
        const block: string[] = [];
        for (let i = aclIdx + 1; i < cfgLines.length; i++) {
          if (/^\s/.test(cfgLines[i]) || cfgLines[i].trim() === '') block.push(cfgLines[i]);
          else break;
        }
        if (!block.join('\n').includes(`file: ${HYSTERIA_ACL}`)) {
          return { applied: false, rules: 0, reason: 'в конфиге уже задан другой ACL (inline/иной файл) — не перезаписываю', skipped: [] };
        }
      } else {
        cfg = cfg.replace(/\s*$/, '') + `\n\nacl:\n  file: ${HYSTERIA_ACL}\n`;
        cfgChanged = true;
      }

      // В Hysteria 2.6.1 серверный ACL знает только built-in outbounds (direct/reject).
      // Кастомные ipv6-out/proxy без объявленных outbounds валят старт сервиса
      // («invalid syntax»), поэтому разрешаем только direct/reject — остальное пропускаем.
      const { lines, skipped } = buildHysteriaAcl(rules, { hasOutbound: () => false });

      const aclContent = `# izinet managed ACL (izinet)\n` + (lines.length ? lines.join('\n') + '\n' : '');

      // Если ACL и конфиг уже совпадают — ничего не перезаписываем и НЕ рестартим сервис
      const existingAclB64 = hostExec(`base64 -w0 ${HYSTERIA_ACL} 2>/dev/null || echo ''`, 15000);
      const existingAcl = existingAclB64 ? Buffer.from(existingAclB64, 'base64').toString('utf8') : '';
      if (!cfgChanged && existingAcl === aclContent) {
        console.log('⏭️ [Routing] Hysteria2 ACL без изменений — рестарт не требуется');
        return { applied: true, rules: lines.length, reason: 'без изменений', skipped };
      }
      const toB64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

      // PRE-FLIGHT: проверяем новый конфиг на временной копии (listen :0), не трогая боевой сервис.
      // Это ловит ошибки ACL/конфига ДО перезапуска — чтобы Hysteria не падала в crash-loop.
      try {
        const escapedAcl = HYSTERIA_ACL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let checkCfg = cfg.replace(/^listen:[ \t].*$/m, 'listen: 127.0.0.1:0');
        checkCfg = checkCfg.replace(new RegExp(`file:\\s*${escapedAcl}`), 'file: /tmp/izinet-acl-check.txt');
        hostExec(`printf %s '${toB64(aclContent)}' | base64 -d > /tmp/izinet-acl-check.txt`, 15000);
        hostExec(`printf %s '${toB64(checkCfg)}' | base64 -d > /tmp/izinet-hysteria-check.yaml`, 15000);
        const checkOut = hostExec('timeout 5 hysteria2 server -c /tmp/izinet-hysteria-check.yaml 2>&1 || true', 20000);
        hostExec('rm -f /tmp/izinet-acl-check.txt /tmp/izinet-hysteria-check.yaml', 10000);
        if (/FATAL|failed to load server config|invalid config/i.test(checkOut)) {
          const short = checkOut.split('\n').filter((l) => /FATAL|invalid config|failed/i.test(l)).slice(0, 2).join(' | ').slice(0, 350);
          console.error('❌ [Routing] Hysteria2 preflight failed:', short);
          return { applied: false, rules: 0, reason: 'preflight-проверка конфига Hysteria2 не прошла: ' + short, skipped };
        }
      } catch (e: any) {
        console.error('❌ [Routing] Hysteria2 preflight error:', e.message);
        return { applied: false, rules: 0, reason: 'preflight-проверка Hysteria2 не выполнена: ' + e.message, skipped };
      }

      // Бэкап текущих файлов (только если сервис был жив — чтобы не затереть хороший бэкап битым конфигом)
      const wasActive = hostExec('systemctl is-active hysteria2 2>/dev/null || true', 15000).trim() === 'active';
      if (wasActive) {
        hostExec(`cp -a ${HYSTERIA_CONF} ${HYSTERIA_CONF}.izinet.bak 2>/dev/null || true`, 15000);
      }
      hostExec(`cp -a ${HYSTERIA_ACL} ${HYSTERIA_ACL}.izinet.bak 2>/dev/null || true`, 15000);

      hostExec(`mkdir -p /etc/hysteria && printf %s '${toB64(aclContent)}' | base64 -d > ${HYSTERIA_ACL} && chmod 644 ${HYSTERIA_ACL}`, 15000);
      hostExec(`printf %s '${toB64(cfg)}' | base64 -d > ${HYSTERIA_CONF} && chmod 644 ${HYSTERIA_CONF}`, 15000);

      /** Откат к предыдущим файлам Hysteria2 при любой ошибке применения. */
      const rollback = () => {
        try {
          hostExec(`cp -a ${HYSTERIA_CONF}.izinet.bak ${HYSTERIA_CONF} 2>/dev/null || true; cp -a ${HYSTERIA_ACL}.izinet.bak ${HYSTERIA_ACL} 2>/dev/null || true; systemctl restart hysteria2 || true`, 45000);
          console.error('↩️ [Routing] Hysteria2: выполнен откат конфига и ACL');
        } catch (e2: any) {
          console.error('❌ [Routing] Hysteria2 rollback failed:', e2.message);
        }
      };

      try {
        hostExec('systemctl restart hysteria2', 45000);

        // Проверка статуса без выброса исключения: systemctl is-active возвращает non-zero,
        // если сервис не активен — раньше это ломало авто-откат.
        let active = '';
        for (let i = 0; i < 8; i++) {
          active = hostExec('systemctl is-active hysteria2 2>/dev/null || true', 15000).trim();
          if (active === 'active') break;
          hostExec('sleep 1', 5000);
        }
        if (active !== 'active') {
          console.error('❌ [Routing] Hysteria2 не поднялся после применения ACL — откатываю');
          rollback();
          return { applied: false, rules: 0, reason: 'hysteria2 не запустился с новым ACL — выполнен откат', skipped };
        }
      } catch (e: any) {
        console.error('❌ [Routing] Hysteria2 restart failed:', e.message);
        rollback();
        return { applied: false, rules: 0, reason: 'ошибка применения ACL — выполнен откат: ' + e.message, skipped };
      }

      console.log(`✅ [Routing] Hysteria2 ACL применён: ${lines.length} правил, пропущено ${skipped.length}`);
      return { applied: true, rules: lines.length, skipped };
    } catch (e: any) {
      console.error('❌ [Routing] Hysteria2 ACL sync failed:', e.message);
      return { applied: false, rules: 0, reason: e.message, skipped: [] };
    }
  }

  /**
   * Restores inbound configs from Supabase backup to X-UI panels.
   * Called at server startup to restore configs after fresh deploy or reinstall.
   * Compares backup inbounds with current panel inbounds by port+protocol.
   */
  static async restoreAllPanelsFromBackup() {
    console.log('🔄 [Routing] Checking for panels that need config restoration...');
    try {
      const { data: servers } = await supabase
        .from('vpn_servers')
        .select('*')
        .eq('is_active', true);

      if (!servers) return;

      for (const server of servers) {
        const configState = server.xui_config_state;
        if (!configState?.inbounds?.length) continue;

        try {
          const { instance } = await getXuiForServer(server.id);
          const currentInbounds = await instance.getInbounds();

          // Отключаем inbound-8443 если он включён (требует несуществующий сертификат)
          for (const ib of currentInbounds) {
            if (ib.port === 8443 && ib.enable) {
              console.log(`⚠️ [Routing] Disabling inbound-8443 (${ib.remark}) on ${server.name} — requires missing TLS cert`);
              try {
                await instance.deleteInbound(ib.id);
              } catch (e: any) {
                console.warn(`⚠️ [Routing] Could not disable inbound-8443: ${e.message}`);
              }
            }
          }

          // Определяем какие inbound'ы из backup отсутствуют в панели
          const missingInbounds = configState.inbounds.filter((backupInbound: any) => {
            if (backupInbound.port === 8443) {
              try {
                const ss = JSON.parse(backupInbound.streamSettings || '{}');
                if (ss.security === 'tls') return false;
              } catch {}
            }
            const exists = currentInbounds.find((ci: any) =>
              ci.port === backupInbound.port && ci.protocol === backupInbound.protocol
            );
            return !exists;
          });

          if (missingInbounds.length > 0) {
            console.log(`🔄 [Routing] Restoring ${missingInbounds.length} missing inbounds for ${server.name}...`);
            for (const inbound of missingInbounds) {
              const newInbound = { ...inbound };
              delete (newInbound as any).id;
              delete (newInbound as any).up;
              delete (newInbound as any).down;
              delete (newInbound as any).total;
              try {
                await instance.addInbound(newInbound);
                console.log(`  ✅ Restored inbound: ${inbound.remark || inbound.port}/${inbound.protocol}`);
              } catch (e: any) {
                console.warn(`  ⚠️ Failed to restore inbound ${inbound.remark || inbound.port}: ${e.message}`);
              }
            }
          }

          // Восстанавливаем xrayTemplateConfig из backup
          if (configState.xrayTemplateConfig) {
            const settings = await instance.getSettings();
            if (settings.xrayTemplateConfig !== configState.xrayTemplateConfig) {
              console.log(`🔄 [Routing] Restoring xrayTemplateConfig for ${server.name}...`);
              settings.xrayTemplateConfig = configState.xrayTemplateConfig;
              await instance.updateSettings(settings);
              console.log(`✅ [Routing] xrayTemplateConfig restored for ${server.name}`);
            }
          }

          if (missingInbounds.length === 0 && !configState.xrayTemplateConfig) {
            console.log(`✅ [Routing] ${server.name} — backup matches current state, no restore needed`);
          }
        } catch (e: any) {
          console.warn(`⚠️ [Routing] Could not check/restore ${server.name}: ${e.message}`);
        }
      }
    } catch (err: any) {
      console.error('❌ [Routing] Restore failed:', err.message);
    }
  }
}
