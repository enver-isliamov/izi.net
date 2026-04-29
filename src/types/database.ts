export type SubscriptionStatus = 'trial' | 'active' | 'expired' | 'cancelled';
export type PlanType = 'trial' | 'basic' | 'premium';
export type ServerType = 'lte' | 'wifi';

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  telegram_id?: string;
  telegram_linked: boolean;
  referral_code: string;
  referred_by?: string;
  created_at: string;
}

export interface VpnServer {
  id: string;
  name: string;
  ip: string;
  domain?: string;
  api_port: number;
  location_code: string;
  is_active: boolean;
  created_at: string;
}

export interface Balance {
  user_id: string;
  amount: number;
  currency: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_type: PlanType;
  status: SubscriptionStatus;
  traffic_limit_mb: number;
  traffic_used_mb: number;
  device_limit: number;
  devices_connected: number;
  server_type: ServerType;
  period_months: number;
  expires_at: string;
  created_at: string;
  server_id?: string;
  vpn_servers?: VpnServer;
}

export interface Device {
  id: string;
  user_id: string;
  subscription_id: string;
  name: string;
  config_link: string;
  last_connected?: string;
  created_at: string;
}
