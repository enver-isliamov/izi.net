import React, { useEffect, useState } from 'react';
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
  Plus
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [userData, setUserData] = useState<any>(null);
  const [balance, setBalance] = useState<any>(null);
  const [subscription, setSubscription] = useState<any>(null);
  const [activeServer, setActiveServer] = useState<any>(null);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isFetching = React.useRef(false);

  const fetchDashboardData = async (forceLoading = false) => {
    if (!user || isFetching.current) return;
    
    if (forceLoading || !userData) {
      setIsLoading(true);
    }
    
    isFetching.current = true;
    
    try {
      const [
        { data: userRes },
        balanceResult,
        { data: subRes },
        { data: refRes }
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
        supabase.from('referrals').select('commission_earned').eq('referrer_id', user.id)
      ]);

      const balanceRes = balanceResult.data;
      const balanceErr = balanceResult.error;

      if (userRes) {
        setUserData(userRes);
      }
      
      if (balanceRes) {
        setBalance(balanceRes);
      } else if (balanceErr) {
        console.error('Error fetching balance:', balanceErr);
      }

      setSubscription(subRes);
      setReferrals(refRes || []);

       if (subRes?.server_id) {
         const { data: serverData } = await supabase
           .from('vpn_servers')
           .select('*')
           .eq('id', subRes.server_id)
           .single();
         setActiveServer(serverData);
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
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
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
  const deviceLimit = subscription?.device_limit || 2; // Hardcode to 2 as per requirement or use DB

  let daysLeft = 0;
  if (subscription?.expires_at) {
    const end = new Date(subscription.expires_at);
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    daysLeft = diffTime > 0 ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : 0;
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Welcome Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Добро пожаловать, {userData?.name || user?.email?.split('@')?.[0] || 'User'}!
          </h1>
          <p className="text-muted-foreground mt-1">
            Аккаунт: <span className="text-primary">{user?.email}</span>
            <Badge variant="outline" className="ml-2 border-primary text-primary neon-text">
              {subscription ? '★ Активна' : 'Неактивна'}
            </Badge>
          </p>
        </div>
        <Button onClick={() => navigate('/subscription')} className="bg-primary text-black hover:bg-primary/90 rounded-xl px-6 neon-glow">
          {subscription ? 'Продлить подписку' : 'Купить подписку'} <ArrowRight className="ml-2 w-4 h-4" />
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="glass-card border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Баланс</CardTitle>
            <Wallet className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Number(currentBalance).toFixed(2)} {currency === 'RUB' ? '₽' : currency}</div>
            <p className="text-xs text-muted-foreground mt-1">Доступно для оплаты</p>
            <Button 
              variant="secondary" 
              className="w-full mt-4 rounded-xl bg-muted/50 hover:bg-muted"
              onClick={() => navigate('/wallet')}
            >
              Пополнить баланс
            </Button>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Рефералы</CardTitle>
            <Users className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{refCount}</div>
            <p className="text-xs text-muted-foreground mt-1">+{refEarned.toFixed(2)} ₽ заработано</p>
            <Button onClick={() => navigate('/referrals')} variant="secondary" className="w-full mt-4 rounded-xl bg-muted/50 hover:bg-muted">
              Пригласить друзей
            </Button>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">Трафик</CardTitle>
            <Zap className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{trafficUsedGB.toFixed(1)} GB / {trafficLimitGB.toFixed(1)} GB</div>
            <Progress value={trafficPercent} className="h-2 mt-3 bg-muted" />
            <p className="text-xs text-muted-foreground mt-2">
              {subscription ? `Обновится через ${daysLeft} дней` : 'Нет активной подписки'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Subscription Card */}
      <Card className="glass-card overflow-hidden border-primary/30 relative">
        <div className="absolute top-0 right-0 p-4 z-10">
          <Badge className={subscription ? "bg-primary/20 text-primary border-primary/50 uppercase" : "bg-muted text-muted-foreground uppercase"}>
            {subscription ? `● ${subscription.server_type?.toUpperCase()}` : 'ОТКЛЮЧЕНО'}
          </Badge>
        </div>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            Текущая подписка
          </CardTitle>
          <CardDescription>Управление вашим активным тарифом</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
            {/* Left Column: Plan & Usage */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" /> Тариф и Лимиты
                </h3>
              </div>

              <div className="p-6 rounded-3xl bg-muted/40 border border-border/50 space-y-6 shadow-inner">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Активный тариф</div>
                    <div className="text-3xl font-black mt-1 text-foreground flex items-center gap-2">
                       {planName}
                    </div>
                  </div>
                  {subscription && (
                    <div className="text-right">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Осталось</div>
                      <div className="text-2xl font-black text-primary flex items-center justify-end gap-1">
                        <Clock className="w-5 h-5" /> {daysLeft}д.
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-border/30 space-y-3">
                  <div className="flex justify-between items-end">
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Трафик использовано</div>
                    <div className="text-sm font-bold">{trafficUsedGB.toFixed(1)} GB / {trafficLimitGB.toFixed(1)} GB</div>
                  </div>
                  <Progress value={trafficPercent} className="h-2.5 bg-muted rounded-full" />
                  <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                    <span>0%</span>
                    <span>50%</span>
                    <span>100%</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                   <div className="bg-background/40 p-3 rounded-2xl border border-border/30">
                      <div className="text-[9px] text-muted-foreground uppercase font-bold">Локация</div>
                      <div className="text-sm font-bold flex items-center gap-1 mt-0.5">
                        <Globe className="w-3.5 h-3.5 text-primary" /> {activeServer?.name || 'Загрузка...'}
                      </div>
                   </div>
                   <div className="bg-background/40 p-3 rounded-2xl border border-border/30">
                      <div className="text-[9px] text-muted-foreground uppercase font-bold">Протокол</div>
                      <div className="text-sm font-bold flex items-center gap-1 mt-0.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-primary" /> VLESS
                      </div>
                   </div>
                </div>
              </div>
            </div>

            {/* Right Column: Connected Devices */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-primary" /> Ваши Устройства
                </h3>
                {activeDeviceCount < deviceLimit && (
                  <Button 
                    size="sm" 
                    variant="ghost"
                    className="h-8 px-3 text-[10px] rounded-xl text-primary hover:text-primary hover:bg-primary/10 transition-all"
                    onClick={() => navigate('/subscription?action=new-device')}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Добавить еще
                  </Button>
                )}
              </div>

              <div className="space-y-3 overflow-y-auto max-h-[400px] pr-1 custom-scrollbar">
                {vpnDevices.length > 0 ? vpnDevices.map((device, i) => {
                  const devExpiry = new Date(device.expiresAt);
                  const devDaysLeft = Math.max(0, Math.ceil((devExpiry.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)));
                  const devTrafficGB = (device.trafficUsedBytes || 0) / (1024 * 1024 * 1024);

                  return (
                    <div key={i} className="group p-4 bg-muted/20 hover:bg-muted/30 rounded-2xl border border-border/40 transition-all duration-300">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                           <div className="w-10 h-10 rounded-xl bg-background flex items-center justify-center border border-border/30 shadow-sm group-hover:scale-105 transition-transform">
                              <Smartphone className="w-5 h-5 text-primary" />
                           </div>
                           <div>
                              <div className="font-bold text-sm tracking-tight">{device.label || `Device ${i + 1}`}</div>
                              <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                                <span className="flex items-center gap-1">🌐 {device.serverType || 'Wi-Fi'}</span>
                                <span className="flex items-center gap-1">↓ {devTrafficGB.toFixed(2)} GB</span>
                              </div>
                           </div>
                        </div>
                        <div className="text-right">
                           <Badge variant="outline" className={`text-[10px] h-6 px-3 rounded-full ${devDaysLeft > 0 ? 'border-primary/30 text-primary bg-primary/5' : 'border-destructive/30 text-destructive bg-destructive/5'}`}>
                              {devDaysLeft > 0 ? `${devDaysLeft}д` : 'Истек'}
                           </Badge>
                        </div>
                      </div>
                      
                      <div className="flex gap-2 mt-4 opacity-70 group-hover:opacity-100 transition-opacity">
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          className="flex-1 text-[11px] h-9 rounded-xl font-medium"
                          onClick={() => {
                            navigator.clipboard.writeText(device.config);
                            toast.success(`Ключ скопирован (${device.label})`);
                          }}
                        >
                          Копировать
                        </Button>
                        <Button 
                          size="sm"
                          className="flex-none text-[11px] h-9 px-4 rounded-xl bg-primary text-black hover:bg-primary/90 font-bold"
                          onClick={() => navigate(`/subscription?targetDeviceId=${device.id}`)}
                        >
                          Продлить
                        </Button>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="flex flex-col items-center justify-center p-10 border-2 border-dashed border-border/20 rounded-3xl bg-muted/10 opacity-60">
                    <Smartphone className="w-8 h-8 text-muted-foreground mb-2" />
                    <p className="text-xs font-medium">Устройства не найдены</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-8 border-t border-border/30 flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-3">
              <Button onClick={() => navigate('/subscription')} className="bg-primary text-black hover:bg-primary/90 rounded-2xl px-6 font-bold shadow-lg shadow-primary/20">
                Подробнее о подписке
              </Button>
              <Button onClick={() => navigate('/installation')} variant="outline" className="rounded-2xl border-border hover:bg-muted/50 px-6">
                Инструкции
              </Button>
            </div>
            <div className="text-[10px] text-muted-foreground italic font-medium">
              * Синхронизация данных происходит автоматически каждые 15 минут
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card onClick={() => navigate('/installation')} className="glass-card hover:border-primary/50 transition-all cursor-pointer group hover:scale-[1.01] active:scale-[0.99]">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Smartphone className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-bold">Инструкции по установке</h3>
              <p className="text-sm text-muted-foreground">Как подключить VPN на ваш девайс</p>
            </div>
            <ArrowRight className="ml-auto w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </CardContent>
        </Card>
        
        <Card onClick={() => navigate('/support')} className="glass-card hover:border-primary/50 transition-all cursor-pointer group hover:scale-[1.01] active:scale-[0.99]">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <LifeBuoy className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-bold">Нужна помощь?</h3>
              <p className="text-sm text-muted-foreground">Свяжитесь с нашей поддержкой</p>
            </div>
            <ArrowRight className="ml-auto w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
