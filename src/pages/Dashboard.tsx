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
  LifeBuoy,
  Loader2,
  Plus,
  Copy,
  Trash2,
  QrCode,
  RefreshCw
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
  const [qrData, setQrData] = useState<{ value: string; key?: string; sub?: string; title: string; subtitle: string } | null>(null);
  const [qrMode, setQrMode] = useState<'key' | 'sub'>('sub');
  const [isQrOpen, setIsQrOpen] = useState(false);

  const fetchDashboardData = async (forceLoading = false) => {
    if (!user || isFetching.current) return;
    
    if (forceLoading) {
      setIsLoading(true);
    }
    
    isFetching.current = true;
    
    try {
      const [
        { data: userRes },
        balanceResult,
        { data: subRes },
        { data: refRes },
        plansData
      ] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).single(),
        supabase.from('balances').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('referrals').select('commission_earned').eq('referrer_id', user.id),
        fetch('/api/subscription/plans').then(res => res.json()).catch(() => ({ deviceLimit: 2 }))
      ]);

      const balanceRes = balanceResult.data;

      let serverData = null;
      if (subRes?.server_id) {
        const { data } = await supabase
          .from('vpn_servers')
          .select('*')
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
      
      // BUG-04: Fetch stable sub URL from backend
      if (subRes?.id) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          
          const subUrlRes = await fetch(`/api/sub-url/${subRes.id}`, {
            headers: { 'Authorization': `Bearer ${session?.access_token}` }
          });
          
          if (subUrlRes.ok) {
            const { url } = await subUrlRes.json();
            setSubUrl(url);
          } else {
            setSubUrl(`/api/sub/${subRes.id}`);
          }
        } catch (err) {
          console.debug('Failed to fetch stable sub URL, using fallback:', err);
          setSubUrl(`/api/sub/${subRes.id}`);
        }
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
    }
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

  // Traffic sync on mount
  useEffect(() => {
    if (!user?.id) return;
    
    const syncTraffic = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        fetch('/api/subscription/sync-traffic', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`
          },
          body: JSON.stringify({ userId: user.id })
        }).then(() => {
          // After sync, silently refresh data to show updated traffic
          fetchDashboardData(false);
        }).catch(err => console.debug('Traffic sync silent error:', err));
      } catch (err) {
        console.debug('Session retrieval error:', err);
      }
    };

    const timer = setTimeout(syncTraffic, 1000);
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
  const planName = subscription ? 
    (subscription.plan_type === 'trial' ? 'Пробный' : 
    (subscription.server_type?.toUpperCase() === 'LTE' ? 'LTE Премиум' : 'Wi-Fi Стандарт')) 
    : 'Нет активной подписки';
  
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
  // deviceLimit is now fetched from globalDeviceLimit directly

  let daysLeft = 0;
  if (subscription?.expires_at) {
    const end = new Date(subscription.expires_at);
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    daysLeft = diffTime > 0 ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : 0;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Simplified Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
             Привет, {userData?.name || user?.email?.split('@')?.[0]}!
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {subscription ? (
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3 text-primary" />
                Активный план: <span className="text-foreground font-bold">{planName}</span>
              </span>
            ) : (
              'У вас пока нет активной подписки'
            )}
          </p>
        </div>
        <div className="flex gap-2">
            <Button 
               className="bg-primary text-black hover:bg-primary/90 rounded-xl px-6 neon-glow font-bold shadow-lg shadow-primary/20"
               onClick={() => openWizard('extend')}
            >
               {subscription ? 'Продлить / Улучшить' : 'Активировать VPN'}
            </Button>
          <Dialog open={isWizardOpen} onOpenChange={setIsWizardOpen}>
            <DialogContent className="sm:max-w-[500px] bg-card border-border p-6 shadow-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">
                  {wizardMode === 'new' ? 'Добавление устройства' : 'Оформление подписки'}
                </DialogTitle>
              </DialogHeader>
              <SubscriptionWizard 
                onClose={() => {
                  setIsWizardOpen(false);
                  fetchDashboardData();
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Wallet, label: 'Баланс', value: `${Number(currentBalance).toFixed(0)}`, sub: '₽', onClick: () => navigate('/wallet') },
          { icon: Users, label: 'Рефералы', value: refCount, onClick: () => navigate('/referrals') },
          { icon: Clock, label: 'Осталось', value: subscription ? `${daysLeft}д.` : '—', color: daysLeft <= 3 ? "text-red-400" : "text-foreground" },
          { icon: Zap, label: 'Трафик', value: trafficUsedGB.toFixed(1), sub: `/ ${trafficLimitGB} GB` }
        ].map((stat, i) => (
          <motion.div
            key={i}
            whileHover={stat.onClick ? { scale: 1.02 } : {}}
            whileTap={stat.onClick ? { scale: 0.98 } : {}}
          >
            <Card 
              className={cn(
                "glass-card p-4 flex flex-col justify-between h-24 hover:border-primary/30 transition-colors",
                stat.onClick && "cursor-pointer"
              )} 
              onClick={stat.onClick}
            >
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest flex items-center gap-2">
                <stat.icon className="w-3 h-3 text-primary" /> {stat.label}
              </div>
              <div className={cn("text-xl font-black mt-auto flex items-baseline gap-1", stat.color)}>
                {stat.value} {stat.sub && <span className="text-xs font-bold text-muted-foreground">{stat.sub}</span>}
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Device Management Section (Main UI) */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black uppercase tracking-tighter flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-primary" /> Ваши Устройства
          </h2>
          {vpnDevices.length < globalDeviceLimit && (
            <Button 
              variant="outline" 
              size="sm" 
              className="rounded-xl border-primary/30 text-primary hover:bg-primary/5 h-8 gap-1.5"
              onClick={() => openWizard('new')}
            >
              <Plus className="w-4 h-4" /> Добавить
            </Button>
          )}
        </div>

        {subscription && (
           <div className="mb-6 bg-primary/5 border border-primary/20 rounded-2xl p-4 overflow-hidden relative group">
             <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Globe className="w-12 h-12 text-primary" />
             </div>
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
               <div className="space-y-1">
                 <h3 className="text-[10px] font-bold uppercase tracking-widest text-primary">Универсальная подписка (v2ray)</h3>
                 <p className="text-xs text-muted-foreground max-w-sm">
                   Используйте одну ссылку для всех ваших устройств в Hiddify или V2Box.
                 </p>
               </div>
                <div className="flex items-center gap-2 w-full md:w-auto text-xs">
                  <div className="flex-1 md:w-64 bg-black/40 border border-white/10 rounded-xl px-3 py-2 font-mono truncate">
                    {subUrl}
                  </div>
                  <Button 
                    size="icon" 
                    variant="secondary" 
                    className="rounded-xl bg-primary/10 text-primary hover:bg-primary/20 shrink-0"
                    onClick={() => {
                      setQrData({
                        value: subUrl,
                        sub: subUrl,
                        title: 'Универсальная подписка',
                        subtitle: 'Автоматическое обновление серверов'
                      });
                      setQrMode('sub');
                      setIsQrOpen(true);
                    }}
                  >
                    <QrCode className="w-4 h-4" />
                  </Button>
                  <Button 
                   size="icon" 
                   variant="secondary" 
                   className="rounded-xl bg-primary/10 text-primary hover:bg-primary/20 shrink-0"
                   onClick={async () => {
                      const success = await copyToClipboard(subUrl);
                      if (success) toast.success("Ссылка скопирована");
                   }}
                 >
                   <Copy className="w-4 h-4" />
                 </Button>
               </div>
             </div>
           </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
          {vpnDevices.length > 0 ? vpnDevices.map((device, i) => {
            const devExpiry = new Date(device.expiresAt);
            const devDaysLeft = Math.max(0, Math.ceil((devExpiry.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)));
            const devTrafficMB = device.trafficUsedBytes ? device.trafficUsedBytes / (1024 * 1024) : 0;
            const devTrafficGB = devTrafficMB / 1024;
            const totalTrafficLimit = trafficLimitGB || 100;
            const devTrafficPercent = Math.min(100, Math.round((devTrafficGB / totalTrafficLimit) * 100));
            
            // Online status: heuristic based on record update time or existence of bytes
            const isOnline = device.trafficUsedBytes > 0;
            const isExpired = devDaysLeft <= 0;

            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                whileHover={{ scale: 1.01 }}
                className="h-full"
              >
                <Card className={cn(
                  "glass-card overflow-hidden group hover:border-primary/40 transition-all duration-300 h-full",
                  isExpired && "border-red-500/30"
                )}>
                <CardContent className="p-0">
                  <div className="p-5 flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center transition-all",
                        isExpired 
                          ? "bg-red-500/10 text-red-500" 
                          : isOnline 
                            ? "bg-primary/10 text-primary shadow-[0_0_15px_rgba(0,255,136,0.2)]" 
                            : "bg-blue-500/10 text-blue-400"
                      )}>
                        <Smartphone className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-bold flex items-center gap-2">
                          {device.label || `Device ${i + 1}`}
                          {isOnline && !isExpired && <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />}
                          {!isOnline && !isExpired && <span className="w-2 h-2 rounded-full bg-blue-400 opacity-50" />}
                          {isExpired && <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_5px_red]" />}
                        </div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">
                          {device.serverType || 'WI-FI СТАНДАРТ'} • {activeServer?.location_code || 'WW'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                       <div className={cn("text-xs font-black", devDaysLeft <= 3 ? "text-red-400" : "text-primary")}>
                         {isExpired ? 'ИСТЕКЛА' : `${devDaysLeft}д.`}
                       </div>
                    </div>
                  </div>

                  <div className="px-5 pb-5 space-y-4">
                    <div className="space-y-1.5">
                       <div className="flex justify-between text-[10px] font-mono">
                          <span className="text-muted-foreground">ИСПОЛЬЗОВАНО ТРАФИКА</span>
                          <span className="text-foreground">{devTrafficGB.toFixed(2)} / {totalTrafficLimit} GB</span>
                       </div>
                       <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full transition-all duration-1000",
                              isExpired ? "bg-red-500" : "bg-primary shadow-[0_0_8px_rgba(0,255,136,0.5)]"
                            )}
                            style={{ width: `${devTrafficPercent}%` }}
                          />
                       </div>
                    </div>

                    <div className="flex gap-2">
                       <Button 
                        size="icon" 
                        variant="secondary" 
                        className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl h-9 w-9 shrink-0"
                        onClick={() => {
                          const deviceSubUrl = `${subUrl}${subUrl.includes('?') ? '&' : '?'}deviceId=${device.id}`;
                          setQrData({
                            value: deviceSubUrl,
                            key: device.config,
                            sub: deviceSubUrl,
                            title: 'Подключение устройства',
                            subtitle: device.label || 'Устройство'
                          });
                          setQrMode('sub');
                          setIsQrOpen(true);
                        }}
                      >
                        <QrCode className="w-4 h-4 text-primary" />
                      </Button>

                      <Button 
                        size="icon" 
                        variant="secondary" 
                        className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl h-9 w-9 shrink-0"
                        title="Перегенерировать ключ"
                        onClick={() => handleRegenerateDevice(device.id)}
                      >
                        <RefreshCw className="w-4 h-4 text-green-400" />
                      </Button>

                      <Button 
                        size="sm" 
                        variant="secondary" 
                        className="flex-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-[11px] h-9"
                        onClick={async () => {
                          const success = await copyToClipboard(device.config);
                          if (success) toast.success(`Ключ скопирован (${device.label})`);
                        }}
                      >
                        <Copy className="w-3.5 h-3.5 mr-2 opacity-50" /> Ключ
                      </Button>
                      <Button 
                        size="sm" 
                        variant="secondary" 
                        className="flex-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-[11px] h-9 text-blue-400"
                        onClick={() => {
                           setTargetDevice(device.id);
                           setTargetDeviceName(device.label);
                           openWizard('extend');
                        }}
                      >
                         Продлить
                      </Button>
                      <Button 
                        size="icon" 
                        className="shrink-0 w-9 bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/10 rounded-xl h-9"
                        onClick={() => handleDeleteDevice(device.id, i === 0)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        }) : (
            <div className="md:col-span-2 flex flex-col items-center justify-center p-12 border-2 border-dashed border-white/5 rounded-3xl bg-white/[0.02]">
              <Smartphone className="w-12 h-12 text-muted-foreground mb-4 opacity-20" />
              <h3 className="font-bold text-lg">Нет активных устройств</h3>
              <p className="text-sm text-muted-foreground text-center max-w-xs mt-2">
                Активируйте подписку, чтобы получить доступ к безопасному интернету.
              </p>
              <Button onClick={() => openWizard('extend')} className="mt-6 bg-primary text-black hover:bg-primary/90 font-bold rounded-xl px-8 neon-glow">
                Активировать прямо сейчас
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card onClick={() => navigate('/installation')} className="glass-card p-4 hover:border-primary/50 transition-all cursor-pointer group flex items-center gap-4 h-20">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors shrink-0">
            <Smartphone className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-sm">Инструкции</h3>
            <p className="text-[10px] text-muted-foreground">Настройка VPN на вашем устройстве</p>
          </div>
          <ArrowRight className="ml-auto w-4 h-4 text-muted-foreground group-hover:text-primary transition-all group-hover:translate-x-1" />
        </Card>
        
        <Card onClick={() => navigate('/support')} className="glass-card p-4 hover:border-primary/50 transition-all cursor-pointer group flex items-center gap-4 h-20">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors shrink-0">
            <LifeBuoy className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-sm">Поддержка</h3>
            <p className="text-[10px] text-muted-foreground">Свяжитесь с нами в любое время</p>
          </div>
          <ArrowRight className="ml-auto w-4 h-4 text-muted-foreground group-hover:text-primary transition-all group-hover:translate-x-1" />
        </Card>
      </div>
      {/* QR Code Dialog */}
      <Dialog open={isQrOpen} onOpenChange={setIsQrOpen}>
        <DialogContent className="sm:max-w-[400px] bg-card border-border flex flex-col items-center p-8">
           <DialogHeader className="w-full text-center mb-4">
              <DialogTitle className="text-xl font-bold">{qrData?.title || 'QR-код подключения'}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {qrMode === 'sub' 
                  ? 'Универсальная ссылка (Hiddify / V2Box)' 
                  : 'Прямой ключ VLESS (Shadowrocket / Nekobox)'}
              </p>
           </DialogHeader>

           {qrData?.key && qrData?.sub && (
             <div className="flex p-1 bg-muted/50 rounded-xl mb-6 w-full max-w-[280px]">
               <button
                 onClick={() => setQrMode('sub')}
                 className={cn(
                   "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                   qrMode === 'sub' ? "bg-primary text-black" : "text-muted-foreground hover:text-white"
                 )}
               >
                 Подписка
               </button>
               <button
                 onClick={() => setQrMode('key')}
                 className={cn(
                   "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                   qrMode === 'key' ? "bg-primary text-black" : "text-muted-foreground hover:text-white"
                 )}
               >
                 Ключ
               </button>
             </div>
           )}
           
           <div className="bg-white p-6 rounded-3xl shadow-2xl shadow-primary/20">
              <QRCodeSVG 
                value={qrMode === 'sub' ? (qrData?.sub || qrData?.value || '') : (qrData?.key || qrData?.value || '')} 
                size={240}
                level="M"
                includeMargin={false}
                bgColor="#FFFFFF"
                fgColor="#000000"
              />
           </div>
           
           <div className="mt-8 w-full space-y-3">
              <div className="p-4 rounded-2xl bg-muted/30 border border-border text-center group relative overflow-hidden">
                 <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest mb-1">
                   {qrMode === 'sub' ? 'Universal Link' : 'VLESS Config'}
                 </div>
                 <div className="font-mono text-[10px] break-all line-clamp-2 opacity-60 group-hover:opacity-100 transition-opacity">
                   {qrMode === 'sub' ? (qrData?.sub || qrData?.value) : (qrData?.key || qrData?.value)}
                 </div>
                 <Button 
                   variant="ghost" 
                   size="sm" 
                   className="mt-2 h-7 text-[10px] text-primary"
                   onClick={async () => {
                     const val = qrMode === 'sub' ? (qrData?.sub || qrData?.value) : (qrData?.key || qrData?.value);
                     if (val) {
                       const success = await copyToClipboard(val);
                       if (success) toast.success("Скопировано");
                     }
                   }}
                 >
                   <Copy className="w-3 h-3 mr-1" /> Копировать
                 </Button>
              </div>
              <Button 
                className="w-full h-12 bg-primary text-black hover:bg-primary/90 font-bold rounded-xl shadow-lg shadow-primary/20"
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
