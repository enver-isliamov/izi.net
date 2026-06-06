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
