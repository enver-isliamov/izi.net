export interface VpnDevice {
  id: string;
  label: string;
  config: string;
  email: string;
  uuid: string;
  expiresAt: string;
  serverType: string;
  trafficUsedBytes: number;
  serverId?: string;
}

// Support function to migrate legacy v2ray_config text to JSON
export function parseVpnDevices(configStr: string | null, rootExpiresAt?: string, rootServerType?: string): VpnDevice[] {
  if (!configStr) return [];
  
  if (configStr.trim().startsWith('[')) {
    try {
      return JSON.parse(configStr);
    } catch (e) {
      console.warn("Failed to parse JSON config, falling back to legacy", e);
    }
  }

  // Legacy parsing
  const configs = configStr.split('\n---KEY_SEP---\n').filter(Boolean);
  return configs.map((cfg, index) => {
    const uuidMatch = cfg.match(/vless:\/\/([^@]+)@/);
    const emailMatch = cfg.match(/#(?:izinet_)?([^&?#\s]+)/);
    const rawEmail = emailMatch ? decodeURIComponent(emailMatch[1].replace(/^izinet_/, '')) : 'unknown';
    
    return {
      id: index === 0 ? 'primary' : `device_${index}`,
      label: index === 0 ? 'Основное устройство' : `Доп. устройство ${index}`,
      config: cfg,
      email: rawEmail,
      uuid: uuidMatch ? uuidMatch[1] : 'unknown',
      expiresAt: rootExpiresAt || new Date().toISOString(),
      serverType: rootServerType || 'Wi-Fi',
      trafficUsedBytes: 0
    };
  });
}


// --- VLESS: фильтр портов, опубликованных наружу (docker-compose/ufw) ---
// Настройка PUBLIC_VLESS_PORTS: '443,2088' (CSV). Нет настройки -> все порты (прежнее поведение).
export async function getPublishedVlessPorts(): Promise<number[] | null> {
  try {
    const { supabase } = await import('../services/supabase');
    const { data } = await supabase.from('settings').select('value').eq('key', 'PUBLIC_VLESS_PORTS').maybeSingle();
    const csv = data?.value?.trim();
    if (!csv) return null;
    const ports = csv.split(',').map((x: string) => parseInt(x.trim(), 10)).filter((n: number) => Number.isFinite(n) && n > 0);
    return ports.length ? ports : null;
  } catch { return null; }
}


/** Адрес заведомо не может быть внешним VPN-сервером: docker-сеть или локальный диапазон. */
export function isUnroutableHost(host?: string | null): boolean {
  if (!host) return true;
  const value = String(host).trim();
  if (/^(localhost|x3-ui|izinet-app)$/i.test(value)) return true;
  const m = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // доменное имя — считаем пригодным
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}
