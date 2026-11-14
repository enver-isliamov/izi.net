import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Wallet, 
  Users, 
  Zap, 
  Clock, 
  ArrowRight,
  ShieldCheck,
  Globe,
  Smartphone,
  Laptop,
  LifeBuoy,
  Loader2,
  Plus,
  Copy,
  Trash2,
  QrCode,
  RefreshCw,
  Gift,
  Download,
  Router,
  Wifi,
  ExternalLink
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn, copyToClipboard } from '@/lib/utils';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import axios from 'axios';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { SubscriptionWizard } from '@/components/subscription/SubscriptionWizard';
import { QRCodeSVG } from 'qrcode.react';

import { WelcomeWizard } from '@/components/WelcomeWizard';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [userData, setUserData] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [activeServer, setActiveServer] = useState<any>(null);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [subUrl, setSubUrl] = useState<string>('');
  const [globalDeviceLimit, setGlobalDeviceLimit] = useState(2);
  const [isLoading, setIsLoading] = useState(true);
  const isFetching = React.useRef(false);
  
  // Wizard States
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<'extend' | 'new'>('extend');
  const [targetDevice, setTargetDevice] = useState<string | undefined>(undefined);
  const [targetDeviceName, setTargetDeviceName] = useState<string | undefined>(undefined);

  // QR States
  const [qrData, setQrData] = useState<{
    value: string;
    key?: string;
    sub?: string;
    awg?: string;
    wireguardUrl?: string;
    awgUrl?: string;
    conf?: string;
    title: string;
    subtitle: string;
  } | null>(null);
  const [qrMode, setQrMode] = useState<'key' | 'sub' | 'awg'>('sub');
  const [awgTab, setAwgTab] = useState<'wg' | 'awg'>('wg');
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [showUniversalLink, setShowUniversalLink] = useState(false);
  const [awgConfig, setAwgConfig] = useState<string>('');
  const [awgUrl, setAwgUrl] = useState<string>('');

  const handleDownloadAwg = async () => {
    try {
      const toastId = toast.loading('Подготовка AmneziaWG конфига...');
      const { data: { session } } = await supabase.auth.getSession();
      const res = await axios.get('/api/user/awg-download', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'izinet-amneziawg.conf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Конфигурация AmneziaWG (.conf) скачана!', { id: toastId });
    } catch (e: any) {
      toast.error('Не удалось скачать файл AmneziaWG');
    }
  };

  const handleOpenAwgModal = async () => {
    try {
      const toastId = toast.loading('Загрузка AmneziaWG...');
      const { data: { session } } = await supabase.auth.getSession();
      const res = await axios.get('/api/user/awg-subscription', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (res.data?.ok) {
        setAwgConfig(res.data.conf || '');
        setAwgUrl(res.data.wireguardUrl || res.data.awgUrl || '');
        setAwgTab('wg');
        setQrData({
          value: res.data.wireguardUrl || res.data.awgUrl || res.data.conf,
          sub: subUrl,
          key: res.data.wireguardUrl || res.data.conf,
          awg: res.data.wireguardUrl || res.data.awgUrl || res.data.conf,
          wireguardUrl: res.data.wireguardUrl,
          awgUrl: res.data.awgUrl,
          conf: res.data.conf,
          title: 'AmneziaWG (WireGuard)',
          subtitle: 'Анти-DPI WireGuard для AmneziaVPN, Hiddify, NekoBox'
        });
        setQrMode('awg');
        setIsQrOpen(true);
        toast.dismiss(toastId);
      } else {
        toast.error('Не удалось получить данные AmneziaWG', { id: toastId });
      }
    } catch (e: any) {
      toast.error('Ошибка загрузки данных AmneziaWG');
    }
  };

  // Promo code states
  const [promoCode, setPromoCode] = useState('');
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);

  const handleApplyPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCode.trim()) {
      toast.error('Введите промокод');
      return;
    }

    setIsApplyingPromo(true);
    const toastId = toast.loading('Активация промокода...');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/promocode/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ code: promoCode })
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Не удалось активировать промокод');
      }

      toast.success(result.message || 'Промокод успешно активирован!', { id: toastId });
      setPromoCode('');
      fetchDashboardData(true);
    } catch (err: any) {
      console.error('Promo error:', err);
      toast.error(err.message || 'Ошибка при активации промокода', { id: toastId });
    } finally {
      setIsApplyingPromo(false);
    }
  };

  const fetchDashboardData = async (forceLoading = false) => {
    if (!user || isFetching.current) return;
    
    if (forceLoading) {
      setIsLoading(true);
    }
    
    isFetching.current = true;
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const [
        { data: userRes },
        balanceResult,
        { data: subRes },
        { data: refRes },
        plansData,
        universalLinkRes
      ] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).single(),
        supabase.from('balances').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .in('status', ['active', 'trial', 'limited'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('referrals').select('commission_earned').eq('referrer_id', user.id),
        fetch('/api/subscription/plans').then(res => res.json()).catch(() => ({ deviceLimit: 2 })),
        fetch('/api/subscription/universal-link-visible', {
          headers: {
            'Authorization': `Bearer ${session?.access_token}`
          }
        }).then(res => res.json()).catch(() => ({ visible: true }))
      ]);

      const balanceRes = balanceResult.data;

      let serverData = null;
      if (subRes?.server_id) {
        // B1: после REVOKE SELECT (password, username) в миграции 002 select('*') падает с 42501.
        // Явный список колонок — только то, что рендерит дашборд (location_code).
        const { data } = await supabase
          .from('vpn_servers')
          .select('id,name,location_code,is_active,ip')
          .eq('id', subRes.server_id)
          .single();
        serverData = data;
      }

      setUserData(userRes);
      setBalance(balanceRes);
      setSubscription(subRes);
      setReferrals(refRes || []);
      setActiveServer(serverData);
      setGlobalDeviceLimit(plansData?.deviceLimit || 2);
      setShowUniversalLink(universalLinkRes?.visible !== false);
      
      if (subRes?.id) {
        setSubUrl(`${window.location.origin}/api/sub/${subRes.id}`);
      }
      
    } catch (error) {
      console.error('Dashboard data fetch error:', error);
    } finally {
      setIsLoading(false);
      isFetching.current = false;
    }
  };

  useEffect(() => {
    if (user?.id) {
      fetchDashboardData(true);

      // Привязка реферального кода, если пользователь перешёл по реферальной ссылке
      const pendingRef = sessionStorage.getItem('referral_code') || localStorage.getItem('izinet_referral_code');
      if (pendingRef) {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session?.access_token) {
            axios.post('/api/user/referral/claim', { referralCode: pendingRef }, {
              headers: { Authorization: `Bearer ${session.access_token}` }
            }).then(() => {
              sessionStorage.removeItem('referral_code');
              localStorage.removeItem('izinet_referral_code');
            }).catch(() => {});
          }
        });
      }
    }
  }, [user?.id]);

  // CACHE-002: Poll traffic data every 30 seconds
  useEffect(() => {
    if (!user?.id) return;
    
    const pollInterval = setInterval(() => {
      if (!isFetching.current) {
        fetchDashboardData(false);
      }
    }, 30000);

    return () => clearInterval(pollInterval);
  }, [user?.id]);

  useEffect(() => {
    // Check URL params for auto-open wizard
    const action = searchParams.get('action');
    const target = searchParams.get('targetDeviceId');
    
    if (action === 'new-device') {
      openWizard('new');
      setSearchParams({}, { replace: true });
    } else if (target) {
      setTargetDevice(target);
      openWizard('extend');
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const openWizard = (mode: 'extend' | 'new') => {
    setWizardMode(mode);
    if (mode === 'new') setTargetDevice(undefined);
    setIsWizardOpen(true);
  };

  const handleDeleteDevice = async (deviceId: string, isPrimary: boolean) => {
    if (isPrimary) {
      toast.error('Невозможно удалить основное устройство.');
      return;
    }
    if (!window.confirm('Удалить это устройство?')) return;
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch('/api/subscription/device/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ userId: user?.id, deviceId })
      });

      if (!response.ok) throw new Error('Не удалось удалить устройство');

      toast.success('Устройство удалено');
      fetchDashboardData();
    } catch (err: any) {
      toast.error(err.message || 'Ошибка удаления');
    }
  };

  const handleRegenerateDevice = async (deviceId: string) => {
    if (!window.confirm('Вы уверены, что хотите перегенерировать ключ? Старый ключ перестанет работать.')) return;
    
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/user/devices/${deviceId}/regenerate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token}`
        }
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ошибка регенерации');
      
      toast.success("Ключ успешно перегенерирован");
      await fetchDashboardData(true);
    } catch (err: any) {
      console.error('Regeneration error:', err);
      toast.error(err.message || 'Ошибка регенерации');
    } finally {
      setIsLoading(false);
    }
  };

  // Traffic and servers sync on mount
  useEffect(() => {
    if (!user?.id) return;
    
    const syncBackground = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        Promise.all([
          fetch('/api/subscription/sync-traffic', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`
            },
            body: JSON.stringify({ userId: user.id })
          }),
          fetch('/api/subscription/sync-servers', {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`
            }
          })
        ]).then(() => {
          fetchDashboardData(false);
        }).catch(err => console.debug('Background sync error:', err));
      } catch (err) {
        console.debug('Session retrieval error:', err);
      }
    };

    const timer = setTimeout(syncBackground, 1000);
    return () => clearTimeout(timer);
  }, [user?.id]);

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        {/* Header Stats Skeletons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="glass-card border-white/5">
              <CardContent className="p-6 space-y-3">
                <Skeleton className="h-4 w-24 bg-white/5" />
                <Skeleton className="h-8 w-32 bg-white/10" />
                <Skeleton className="h-3 w-full bg-white/5" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main Content Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <Card className="lg:col-span-2 glass-card border-white/5 h-64">
            <CardContent className="p-8 space-y-6">
              <div className="flex justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-6 w-48 bg-white/10" />
                  <Skeleton className="h-4 w-32 bg-white/5" />
                </div>
                <Skeleton className="h-10 w-32 bg-white/10 rounded-xl" />
              </div>
              <Skeleton className="h-4 w-full bg-white/5" />
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-16 w-full bg-white/5 rounded-xl" />
                <Skeleton className="h-16 w-full bg-white/5 rounded-xl" />
                <Skeleton className="h-16 w-full bg-white/5 rounded-xl" />
              </div>
            </CardContent>
          </Card>
          <Skeleton className="hidden lg:block h-64 w-full rounded-2xl bg-white/5" />
        </div>

        {/* Devices Section Skeleton */}
        <div className="space-y-4">
          <Skeleton className="h-6 w-48 bg-white/5 ml-2" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <Card key={i} className="glass-card border-white/5 h-48">
                <CardContent className="p-6 space-y-4">
                  <div className="flex justify-between">
                    <Skeleton className="h-10 w-10 rounded-full bg-white/10" />
                    <div className="flex gap-2">
                      <Skeleton className="h-8 w-8 rounded-lg bg-white/5" />
                      <Skeleton className="h-8 w-24 rounded-lg bg-white/5" />
                    </div>
                  </div>
                  <Skeleton className="h-4 w-32 bg-white/10" />
                  <Skeleton className="h-2 w-full bg-white/5" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const currentBalance = balance?.amount || 0;
  const currency = balance?.currency || 'RUB';
  
  // Convert MB to GB for display
  const trafficUsedGB = (subscription?.traffic_used_mb || 0) / 1024;
  const trafficLimitGB = (subscription?.traffic_limit_mb || 102400) / 1024; // Default 100GB
  const trafficPercent = Math.min(100, Math.round((trafficUsedGB / trafficLimitGB) * 100)) || 0;
  
  const refCount = referrals.length;
  const refEarned = referrals.reduce((sum, ref) => sum + (Number(ref.commission_earned) || 0), 0);
  
  // Parse devices from v2ray_config
  let vpnDevices: any[] = [];
  if (subscription?.v2ray_config) {
    if (subscription.v2ray_config.trim().startsWith('[')) {
      try {
        vpnDevices = JSON.parse(subscription.v2ray_config);
      } catch (e) {
        console.warn('Failed to parse JSON config');
      }
    } else {
      // Legacy fallback
      const configs = subscription.v2ray_config.split('\n---KEY_SEP---\n').filter(Boolean);
      vpnDevices = configs.map((cfg: string, i: number) => ({
        id: i === 0 ? 'primary' : `device_${i}`,
        label: i === 0 ? 'Основное устройство' : `Доп. устройство ${i}`,
        config: cfg,
        serverType: subscription.server_type?.toUpperCase() || 'WI-FI',
        expiresAt: subscription.expires_at,
        trafficUsedBytes: 0
      }));
    }
  }

  const activeDeviceCount = vpnDevices.length;
  const userDeviceLimit = subscription?.device_limit ? Math.max(subscription.device_limit, globalDeviceLimit) : (globalDeviceLimit || 2);

  let daysLeft = 0;
  if (subscription?.expires_at) {
    const end = new Date(subscription.expires_at);
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    daysLeft = diffTime > 0 ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : 0;
  }

  return (
    <div className="space-y-3 md:space-y-4 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <WelcomeWizard />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-white flex items-center gap-2">
             Привет, {userData?.name || user?.email?.split('@')?.[0]}!
             {userData?.is_pro && (
               <span className="inline-flex items-center gap-1 bg-cyan-950/40 text-[#7bdcff] border border-cyan-500/30 text-[10px] md:text-xs font-bold uppercase px-2 py-0.5 rounded-full select-none tracking-wider">PRO</span>
             )}
          </h1>
          <p className="text-xs text-[#8d959f] mt-1 flex items-center gap-1.5">
            {activeDeviceCount > 0 ? (
              <>
                <span className="w-2 h-2 rounded-full bg-[#8be5f0] shadow-[0_0_8px_#6ae6ff] animate-pulse shrink-0" />
                <span className="text-zinc-300">Защита активна · Устройств: {activeDeviceCount} из {userDeviceLimit}</span>
              </>
            ) : (
              'У вас пока нет активных подключений'
            )}
          </p>
        </div>
        <div className="flex gap-2">
            <Button 
               className="bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold hover:shadow-[0_0_20px_rgba(176,232,255,0.35)] hover:-translate-y-0.5 rounded-xl px-5 h-10 text-xs sm:text-sm transition-all shadow-[0_2px_8px_rgba(0,0,0,0.35)] w-full sm:w-auto"
               onClick={() => openWizard('extend')}
            >
               {subscription ? 'Продлить / Изменить тариф' : 'Активировать VPN'}
            </Button>
          <Dialog open={isWizardOpen} onOpenChange={setIsWizardOpen}>
            <DialogContent className="max-w-[95%] sm:max-w-[450px] bg-[#0c1016] border border-white/10 p-4 md:p-6 rounded-3xl shadow-2xl">
              <DialogHeader>
                <DialogTitle className="text-base md:text-lg font-medium text-white">
                  {wizardMode === 'new' ? 'Добавление устройства' : 'Оформление подписки'}
                </DialogTitle>
              </DialogHeader>
              <SubscriptionWizard 
                onClose={() => {
                  setIsWizardOpen(false);
                  fetchDashboardData();
                  setTimeout(() => fetchDashboardData(), 3000);
                }} 
                forceNew={wizardMode === 'new'}
                targetDeviceId={targetDevice}
                targetDeviceName={targetDeviceName}
                hasActiveSub={!!subscription}
                existingDeviceCount={vpnDevices.length}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {[
          { icon: Wallet, label: 'Баланс', value: `${Number(currentBalance).toFixed(0)}`, sub: '₽', onClick: () => navigate('/wallet') },
          { icon: Users, label: 'Рефералы', value: refCount, onClick: () => navigate('/referrals') },
          { icon: Clock, label: 'Осталось', value: subscription ? `${daysLeft}д.` : '—', color: daysLeft <= 3 ? "text-amber-400" : "text-white" },
          { icon: Smartphone, label: 'Устройства', value: String(activeDeviceCount), sub: `из ${userDeviceLimit}` }
        ].map((stat, i) => (
          <motion.div
            key={i}
            whileHover={stat.onClick ? { scale: 1.01 } : {}}
            whileTap={stat.onClick ? { scale: 0.99 } : {}}
          >
            <Card 
              className={cn(
                "rounded-2xl border border-white/10 bg-[#0c1016]/85 backdrop-blur-xl p-3 md:p-3.5 flex items-center justify-between gap-2.5 hover:border-cyan-500/30 transition-all h-16 shadow-[0_4px_20px_rgba(0,0,0,0.3)]",
                stat.onClick && "cursor-pointer"
              )} 
              onClick={stat.onClick}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-xl bg-cyan-950/30 border border-cyan-400/20 text-[#7bdcff] flex items-center justify-center shrink-0">
                  <stat.icon className="w-4 h-4 md:w-5 md:h-5" />
                </div>
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-[9px] uppercase font-semibold text-[#8d959f] tracking-wider truncate">
                    {stat.label}
                  </span>
                  <span className={cn("text-sm md:text-base font-bold leading-tight mt-0.5 truncate text-white", stat.color)}>
                    {stat.value} {stat.sub && <span className="text-xs font-medium text-[#8d959f] ml-0.5">{stat.sub}</span>}
                  </span>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Device Management Section (Main UI) */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm md:text-base font-medium text-white tracking-tight">
              Ваши устройства
            </h2>
            <span className="text-xs text-[#8d959f] font-mono">({activeDeviceCount})</span>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="rounded-xl border-white/10 bg-[#0e141b]/80 hover:bg-[#151c25] hover:border-cyan-400/30 text-[#7bdcff] h-8 gap-1.5 text-xs px-3 transition-all"
            onClick={() => {
              if (vpnDevices.length >= userDeviceLimit) {
                toast.error(`Достигнут лимит устройств (${userDeviceLimit}). Для увеличения обратитесь в поддержку.`);
              } else {
                openWizard('new');
              }
            }}
          >
            <Plus className="w-3.5 h-3.5" /> Добавить устройство
          </Button>
        </div>

        {/* Featured Universal Subscription Banner */}
        {subscription && showUniversalLink && (
           <div className="rounded-3xl border border-cyan-500/25 bg-gradient-to-r from-cyan-950/30 via-[#0e141b]/90 to-[#0c1016] p-4 sm:p-5 backdrop-blur-xl shadow-[0_10px_30px_rgba(0,0,0,0.4)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative overflow-hidden">
             <div className="flex items-center gap-3.5">
               <div className="w-11 h-11 rounded-2xl border border-cyan-400/30 bg-cyan-950/40 flex items-center justify-center text-[#7bdcff] shadow-[0_0_15px_rgba(123,220,255,0.2)] shrink-0">
                 <Globe className="w-6 h-6 animate-pulse" />
               </div>
               <div>
                 <div className="flex items-center gap-2 flex-wrap">
                   <span className="font-semibold text-sm sm:text-base text-white">Единая подписка на все устройства</span>
                   <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-[#7bdcff] border border-cyan-500/20">
                     VLESS + CDN + AmneziaWG
                   </span>
                 </div>
                 <p className="text-xs text-[#8d959f] mt-0.5">
                   Один универсальный профиль для Hiddify, Happ, v2rayN, AmneziaWG и роутеров Keenetic
                 </p>
               </div>
             </div>

             <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                <Button 
                  onClick={async () => {
                     const success = await copyToClipboard(subUrl);
                     if (success) toast.success("Единая ссылка подписки скопирована!");
                  }}
                  className="flex-1 sm:flex-none min-h-[38px] px-4 bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold text-xs rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.35)] hover:shadow-[0_0_20px_rgba(176,232,255,0.35)] transition-all flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Скопировать всё</span>
                </Button>

                <Button 
                  variant="outline"
                  onClick={() => {
                    const primaryVless = vpnDevices.find(d => String(d.serverType).toUpperCase() !== 'AWG')?.config || vpnDevices[0]?.config || '';
                    const cleanKey = primaryVless ? primaryVless.trim().split('\n')[0] : '';
                    setQrData({
                      value: cleanKey || subUrl,
                      key: cleanKey,
                      sub: subUrl,
                      title: 'Единая подписка',
                      subtitle: 'Отсканируйте камерой в Hiddify / Happ / v2rayNG'
                    });
                    setQrMode(cleanKey ? 'key' : 'sub');
                    setIsQrOpen(true);
                  }}
                  className="min-h-[38px] px-3 bg-[#0e141b]/80 border-white/10 hover:bg-[#19232c] text-[#f1f4f7] rounded-xl text-xs"
                  title="QR-код подписки"
                >
                  <QrCode className="w-3.5 h-3.5 text-[#7bdcff]" />
                </Button>

                <Button 
                  variant="outline"
                  onClick={handleOpenAwgModal}
                  className="min-h-[38px] px-3 bg-[#0e141b]/80 border-white/10 hover:bg-[#19232c] text-emerald-400 rounded-xl text-xs gap-1"
                  title="AmneziaWG настройки"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">AmneziaWG</span>
                </Button>
             </div>
           </div>
        )}

        {/* Device Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {vpnDevices.length > 0 ? vpnDevices.map((device, i) => {
            const devExpiry = new Date(device.expiresAt);
            const devDaysLeft = Math.max(0, Math.ceil((devExpiry.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)));
            const devTrafficMB = device.trafficUsedBytes ? device.trafficUsedBytes / (1024 * 1024) : 0;
            const devTrafficGB = devTrafficMB / 1024;
            const totalTrafficLimit = trafficLimitGB || 100;
            const devTrafficPercent = Math.min(100, Math.round((devTrafficGB / totalTrafficLimit) * 100));
            
            const isOnline = device.trafficUsedBytes > 0;
            const isExpired = devDaysLeft <= 0;
            const isRouter = device.serverType === 'AWG' || device.serverType === 'ROUTER';
            const isLaptop = /mac|pc|ноут|laptop|комп|win/i.test(device.label || '');
            const DeviceIcon = isRouter ? Router : (isLaptop ? Laptop : Smartphone);
            const deviceSubUrl = `${subUrl}${subUrl.includes('?') ? '&' : '?'}deviceId=${device.id}`;
            const cleanKey = device.config ? device.config.trim().split('\n')[0] : '';

            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
                whileHover={{ scale: 1.008 }}
                className="h-full"
              >
                <div className={cn(
                  "relative rounded-3xl border border-white/10 bg-gradient-to-b from-[#0f141c] to-[#090d13] p-5 sm:p-6 backdrop-blur-xl shadow-[0_15px_35px_rgba(0,0,0,0.4)] hover:border-cyan-500/35 transition-all flex flex-col justify-between group overflow-hidden h-full",
                  isExpired && "border-red-500/30"
                )}>
                  {/* Subtle ambient lighting on top-right */}
                  <div className="absolute top-0 right-0 w-36 h-36 bg-[radial-gradient(circle,rgba(123,220,255,0.05)_0%,transparent_70%)] pointer-events-none" />

                  {/* Top: Device Information */}
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 transition-all",
                          isExpired 
                            ? "border-red-500/30 bg-red-950/20 text-red-400" 
                            : "border-cyan-400/30 bg-cyan-950/25 text-[#7bdcff] shadow-[0_0_15px_rgba(123,220,255,0.15)]"
                        )}>
                          <DeviceIcon className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-semibold text-white text-base tracking-tight flex items-center gap-2">
                            <span>{device.label || `Устройство ${i + 1}`}</span>
                            {isExpired ? (
                              <span className="w-2 h-2 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)] shrink-0" />
                            ) : isOnline ? (
                              <span className="w-2 h-2 rounded-full bg-[#8be5f0] shadow-[0_0_8px_#6ae6ff] animate-pulse shrink-0" />
                            ) : (
                              <span className="w-2 h-2 rounded-full bg-cyan-400/50 shrink-0" />
                            )}
                          </div>
                          <div className="text-xs text-[#8d959f] flex items-center gap-1.5 mt-0.5">
                            <span>{isRouter ? 'AmneziaWG • Keenetic / OpenWrt' : (device.serverType || 'VLESS Reality + CDN')}</span>
                            <span>•</span>
                            <span className="text-zinc-400 font-mono">{activeServer?.location_code || 'NL'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Days Left Pill */}
                      <div className="shrink-0">
                        {isExpired ? (
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/10 border border-red-500/25 text-red-400">
                            Срок истёк
                          </span>
                        ) : devDaysLeft <= 3 ? (
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 border border-amber-500/25 text-amber-400">
                            Истекает ({devDaysLeft} дн.)
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-cyan-500/10 border border-cyan-500/25 text-[#7bdcff]">
                            Осталось {devDaysLeft} дн.
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Traffic Bar */}
                    <div className="my-4 py-3 border-y border-white/5 space-y-1.5">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-[#8d959f]">
                          Использовано: <strong className="text-white font-mono">{devTrafficGB.toFixed(1)} GB</strong> из {totalTrafficLimit} GB
                        </span>
                        <span className="text-[#7bdcff] font-mono font-medium">{devTrafficPercent}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full transition-all duration-700",
                            isExpired ? "bg-red-500" : "bg-gradient-to-r from-cyan-400 to-[#7bdcff] shadow-[0_0_8px_rgba(123,220,255,0.4)]"
                          )}
                          style={{ width: `${Math.max(3, devTrafficPercent)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Actions Area (Tier 1 & Tier 2) */}
                  <div className="space-y-3 pt-1">
                    {/* Tier 1: Main Action & QR button */}
                    <div className="flex items-center gap-2">
                      {isRouter ? (
                        <>
                          <Button 
                            onClick={handleDownloadAwg}
                            className="flex-1 min-h-[42px] bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold text-xs sm:text-sm rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.35)] hover:shadow-[0_0_20px_rgba(176,232,255,0.35)] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
                            title="Скачать конфигурационный файл .conf для роутеров и AmneziaVPN"
                          >
                            <Download className="w-4 h-4" />
                            <span>Скачать .conf</span>
                          </Button>

                          <Button 
                            variant="outline"
                            onClick={handleOpenAwgModal}
                            className="min-h-[42px] px-3.5 bg-[#0e141b]/80 border-white/10 hover:bg-[#19232c] hover:border-white/20 text-[#f1f4f7] rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center gap-1.5 shrink-0"
                            title="Показать QR-код AmneziaWG"
                          >
                            <QrCode className="w-4 h-4 text-[#7bdcff]" />
                            <span className="hidden sm:inline">QR</span>
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button 
                            onClick={async () => {
                              const success = await copyToClipboard(deviceSubUrl);
                              if (success) toast.success(`Ссылка для ${device.label || 'устройства'} скопирована! Вставьте в Hiddify или Happ`);
                            }}
                            className="flex-1 min-h-[42px] bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold text-xs sm:text-sm rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.35)] hover:shadow-[0_0_20px_rgba(176,232,255,0.35)] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
                            title="Скопировать персональную ссылку подписки"
                          >
                            <Copy className="w-4 h-4" />
                            <span>Скопировать ссылку</span>
                          </Button>

                          <Button 
                            variant="outline"
                            onClick={() => {
                              setQrData({
                                value: cleanKey || deviceSubUrl,
                                key: cleanKey,
                                sub: deviceSubUrl,
                                title: device.label || 'Подключение устройства',
                                subtitle: 'Отсканируйте камерой в Hiddify / Happ / v2rayNG'
                              });
                              setQrMode(cleanKey ? 'key' : 'sub');
                              setIsQrOpen(true);
                            }}
                            className="min-h-[42px] px-3.5 bg-[#0e141b]/80 border-white/10 hover:bg-[#19232c] hover:border-white/20 text-[#f1f4f7] rounded-xl text-xs sm:text-sm font-medium transition-all flex items-center gap-1.5 shrink-0"
                            title="Показать QR-код подключения"
                          >
                            <QrCode className="w-4 h-4 text-[#7bdcff]" />
                            <span className="hidden sm:inline">QR-код</span>
                          </Button>
                        </>
                      )}
                    </div>

                    {/* Tier 2: Secondary Quick Actions */}
                    <div className="flex items-center justify-between pt-1 text-xs text-[#8d959f]">
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => {
                            setTargetDevice(device.id);
                            setTargetDeviceName(device.label);
                            openWizard('extend');
                          }}
                          className="hover:text-[#7bdcff] transition-colors flex items-center gap-1 text-[11px] font-medium"
                        >
                          <Zap className="w-3.5 h-3.5 text-[#7bdcff]" />
                          <span>Продлить</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => navigate('/installation')}
                          className="hover:text-white transition-colors flex items-center gap-1 text-[11px]"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Инструкция</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2.5">
                        {!isRouter && (
                          <button
                            type="button"
                            onClick={() => handleRegenerateDevice(device.id)}
                            className="hover:text-emerald-400 transition-colors p-1 rounded-md text-[#59636f]"
                            title="Перегенерировать ключ (сменить параметры при сбоях)"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => handleDeleteDevice(device.id, i === 0)}
                          className="hover:text-red-400 transition-colors p-1 rounded-md text-[#59636f]"
                          title="Удалить устройство"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          }) : (
            <div className="md:col-span-2 flex flex-col items-center justify-center p-8 md:p-14 border border-dashed border-white/10 rounded-3xl bg-[#0c1016]/50 text-center">
              <div className="w-14 h-14 rounded-2xl bg-cyan-950/20 border border-cyan-400/20 flex items-center justify-center text-[#7bdcff] mb-4">
                <Smartphone className="w-7 h-7 opacity-60" />
              </div>
              <h3 className="font-semibold text-lg text-white">Нет активных устройств</h3>
              <p className="text-xs sm:text-sm text-[#8d959f] max-w-sm mt-1 mb-6 leading-relaxed">
                Активируйте подписку или активируйте бесплатный промокод, чтобы получить персональные ключи.
              </p>
              
              <Button 
                onClick={() => openWizard('extend')} 
                className="bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold rounded-xl px-8 h-11 text-sm shadow-[0_0_20px_rgba(176,232,255,0.35)] hover:-translate-y-0.5 transition-all w-full sm:w-auto"
              >
                Активировать прямо сейчас
              </Button>

              {/* Promo Code Input section for new users */}
              <div className="mt-8 pt-6 border-t border-white/5 w-full max-w-sm flex flex-col items-center">
                <div className="flex items-center gap-1.5 text-xs text-[#8d959f] mb-3 font-medium">
                  <Gift className="w-3.5 h-3.5 text-[#7bdcff]" />
                  <span>У вас есть промокод?</span>
                </div>
                <form onSubmit={handleApplyPromo} className="flex gap-2 w-full">
                  <input
                    type="text"
                    placeholder="ВВЕДИТЕ ПРОМОКОД..."
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value)}
                    className="flex-1 bg-[#080c12] border border-white/10 hover:border-white/15 focus:border-cyan-400 rounded-xl py-2 px-3 text-xs uppercase font-mono tracking-wider outline-none text-white transition-all text-center placeholder:text-[#59636f]"
                    disabled={isApplyingPromo}
                  />
                  <Button 
                    type="submit" 
                    disabled={isApplyingPromo}
                    className="bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] text-xs font-semibold rounded-xl px-5 h-9 shrink-0 transition-all"
                  >
                    {isApplyingPromo ? (
                      <Loader2 className="animate-spin w-3 h-3" />
                    ) : (
                      'Применить'
                    )}
                  </Button>
                </form>
                <span className="text-[11px] text-[#59636f] text-center mt-2 leading-tight">
                  Активирует бесплатный тестовый период. Доступно 1 раз на аккаунт.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2.5">
        <Button 
          variant="outline"
          className="flex-1 bg-white/[0.02] hover:bg-white/5 border-border rounded-xl text-xs font-bold h-9 gap-1.5"
          onClick={() => navigate('/installation')}
        >
          <Smartphone className="w-3.5 h-3.5 text-primary" /> Инструкции
        </Button>
        <Button 
          variant="outline"
          className="flex-1 bg-white/[0.02] hover:bg-white/5 border-border rounded-xl text-xs font-bold h-9 gap-1.5"
          onClick={() => navigate('/support')}
        >
          <LifeBuoy className="w-3.5 h-3.5 text-primary" /> Поддержка
        </Button>
      </div>
      {/* QR & Connection Dialog */}
      <Dialog open={isQrOpen} onOpenChange={setIsQrOpen}>
        <DialogContent className="w-[94vw] max-w-[380px] max-h-[85vh] overflow-y-auto bg-card/95 backdrop-blur-xl border-border flex flex-col items-center p-5 rounded-2xl sm:rounded-3xl shadow-2xl">
           <DialogHeader className="w-full text-center mb-3">
              <DialogTitle className="text-lg font-bold">{qrData?.title || 'QR-код подключения'}</DialogTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {qrMode === 'awg' 
                  ? 'Отсканируйте QR приложением AmneziaWG · для роутеров — файл .conf' 
                  : (qrData?.subtitle || 'Универсальная подписка (Hiddify / V2Box / Happ)')}
              </p>
           </DialogHeader>

           {qrMode === 'awg' && (
             <div className="flex p-1 bg-muted/40 rounded-lg mb-3 w-full max-w-[260px]">
               <button
                 onClick={() => setAwgTab('wg')}
                 className={cn(
                   "flex-1 py-1 text-[11px] font-bold rounded-md transition-all",
                   awgTab === 'wg' ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "text-muted-foreground hover:text-white"
                 )}
               >
                 Конфигурация
               </button>
               <button
                 onClick={() => setAwgTab('awg')}
                 className={cn(
                   "flex-1 py-1 text-[11px] font-bold rounded-md transition-all",
                   awgTab === 'awg' ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "text-muted-foreground hover:text-white"
                 )}
               >
                 Ссылка (URL)
               </button>
             </div>
           )}

           {qrMode !== 'awg' && qrData?.key && qrData?.sub && (
             <div className="flex p-1 bg-muted/40 rounded-lg mb-3 w-full max-w-[240px]">
               <button
                 onClick={() => setQrMode('sub')}
                 className={cn(
                   "flex-1 py-1 text-[11px] font-bold rounded-md transition-all",
                   qrMode === 'sub' ? "bg-primary text-black" : "text-muted-foreground hover:text-white"
                 )}
               >
                 Подписка
               </button>
               <button
                 onClick={() => setQrMode('key')}
                 className={cn(
                   "flex-1 py-1 text-[11px] font-bold rounded-md transition-all",
                   qrMode === 'key' ? "bg-primary text-black" : "text-muted-foreground hover:text-white"
                 )}
               >
                 Прямой ключ
               </button>
             </div>
           )}

           <div className="bg-white p-3.5 rounded-2xl shadow-lg shadow-primary/10">
              <QRCodeSVG 
                value={
                  qrMode === 'awg' 
                    ? (awgTab === 'wg' ? (qrData?.conf || awgConfig || qrData?.wireguardUrl || '') : (qrData?.awgUrl || awgUrl || qrData?.value || ''))
                    : qrMode === 'key' 
                    ? (qrData?.key || qrData?.value || '') 
                    : (qrData?.sub || qrData?.value || '')
                } 
                size={175}
                level="M"
                includeMargin={false}
                bgColor="#FFFFFF"
                fgColor="#000000"
              />
           </div>
           
           <div className="mt-3.5 w-full space-y-2.5">
              {qrMode === 'awg' ? (
                <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/20 text-center space-y-2">
                   <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-400">
                     <ShieldCheck className="w-3.5 h-3.5" /> Файл для Keenetic / OpenWrt / ТВ
                   </div>
                   <div className="text-[10px] leading-snug text-emerald-300/70">
                     Наведите камеру в приложении AmneziaWG — туннель добавится автоматически. Или возьмите файл/текст ниже.
                   </div>
                   <div className="grid grid-cols-2 gap-2 pt-0.5">
                     <Button 
                       variant="outline" 
                       size="sm" 
                       className="h-8.5 text-xs bg-emerald-500 text-black hover:bg-emerald-400 font-bold border-0 rounded-lg gap-1"
                       onClick={handleDownloadAwg}
                     >
                       <Download className="w-3.5 h-3.5" /> .conf файл
                     </Button>
                     <Button 
                       variant="outline" 
                       size="sm" 
                       className="h-8.5 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 rounded-lg gap-1"
                       onClick={async () => {
                         const val = awgConfig || qrData?.wireguardUrl || qrData?.value || '';
                         if (val) {
                           const success = await copyToClipboard(val);
                           if (success) toast.success("Текст конфигурации скопирован");
                         }
                       }}
                     >
                       <Copy className="w-3.5 h-3.5" /> Текст
                     </Button>
                   </div>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-muted/30 border border-border text-center space-y-1.5">
                   <div className="text-[9px] uppercase font-bold text-muted-foreground tracking-wider">
                     {qrMode === 'sub' ? 'Ссылка подписки (VLESS + Hysteria2)' : 'Прямой ключ VLESS Reality'}
                   </div>
                   <div className="font-mono text-[9px] break-all line-clamp-2 text-muted-foreground px-1">
                     {qrMode === 'sub' ? (qrData?.sub || qrData?.value) : (qrData?.key || qrData?.value)}
                   </div>
                   <div className="pt-0.5">
                     <Button 
                       variant="outline" 
                       size="sm" 
                       className="h-8.5 text-xs bg-primary text-black hover:bg-primary/90 font-bold border-0 rounded-lg w-full gap-1.5"
                       onClick={async () => {
                         const val = qrMode === 'sub' ? (qrData?.sub || qrData?.value) : (qrData?.key || qrData?.value);
                         if (val) {
                           const success = await copyToClipboard(val);
                           if (success) toast.success("Скопировано в буфер обмена");
                         }
                       }}
                     >
                       <Copy className="w-3.5 h-3.5" /> Скопировать в буфер
                     </Button>
                   </div>
                </div>
              )}

              <Button 
                variant="ghost"
                className="w-full h-8 text-xs text-muted-foreground hover:text-white rounded-xl"
                onClick={() => setIsQrOpen(false)}
              >
                Закрыть
              </Button>
           </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
