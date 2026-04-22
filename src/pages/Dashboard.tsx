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
  Loader2
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
  const [referrals, setReferrals] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDashboardData = async () => {
    if (!user) return;
    setIsLoading(true);
    
    try {
      // Trigger traffic sync on load to get real-time data
      fetch('/api/subscription/sync-traffic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      }).catch(err => console.warn('Traffic sync failed:', err));

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
    } catch (error) {
      console.error('Dashboard data fetch error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [user]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const currentBalance = balance?.amount || 0;
  const currency = balance?.currency || 'RUB';
  const planName = subscription?.plan_type || 'Нет активной подписки';
  
  // Convert MB to GB for display
  const trafficUsedGB = (subscription?.traffic_used_mb || 0) / 1024;
  const trafficLimitGB = (subscription?.traffic_limit_mb || 102400) / 1024; // Default 100GB
  const trafficPercent = Math.min(100, Math.round((trafficUsedGB / trafficLimitGB) * 100)) || 0;
  
  const refCount = referrals.length;
  const refEarned = referrals.reduce((sum, ref) => sum + (Number(ref.commission_earned) || 0), 0);

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
            {subscription ? `● ${subscription.server_type}` : 'ОТКЛЮЧЕНО'}
          </Badge>
        </div>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            Текущая подписка
          </CardTitle>
          <CardDescription>Управление вашим активным тарифом</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-muted/30 border border-border">
                <div className="text-sm text-muted-foreground">Тариф</div>
                <div className="text-xl font-bold mt-1 capitalize">{planName}</div>
                {subscription && (
                  <div className="flex items-center gap-2 mt-3 text-sm">
                    <Clock className="w-4 h-4 text-primary" />
                    <span>{daysLeft} дней осталось</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Использование трафика</span>
                  <span className="font-medium">{trafficPercent}%</span>
                </div>
                <Progress value={trafficPercent} className="h-2 bg-muted" />
                <div className="flex justify-between text-[10px] text-muted-foreground uppercase tracking-wider">
                  <span>0 GB</span>
                  <span>{(trafficLimitGB / 2).toFixed(1)} GB</span>
                  <span>{trafficLimitGB.toFixed(1)} GB</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-muted/30 border border-border">
                <div className="text-sm text-muted-foreground">Подключить устройство</div>
                <div className="flex items-center gap-2 mt-2">
                  <code className="flex-1 bg-black/50 p-2 rounded-lg text-xs truncate border border-border">
                    {subscription?.v2ray_config || 'Нет конфигурации'}
                  </code>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="rounded-lg border-primary/50 text-primary hover:bg-primary/10"
                    onClick={() => {
                      if (subscription?.v2ray_config) {
                        navigator.clipboard.writeText(subscription.v2ray_config);
                        toast.success('Скопировано в буфер обмена');
                      } else {
                        toast.error('Нет активной подписки или конфигурации');
                      }
                    }}
                  >
                    Копировать
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-xl bg-muted/20 border border-border text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Устройства</div>
                  <div className="text-lg font-bold">
                    {subscription?.devices_connected || 0} / {subscription?.device_limit || 2}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-muted/20 border border-border text-center">
                  <div className="text-[10px] text-muted-foreground uppercase">Локация</div>
                  <div className="text-lg font-bold flex items-center justify-center gap-1">
                    <Globe className="w-4 h-4 text-primary" /> RU
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border flex flex-wrap gap-3">
            <Button onClick={() => navigate('/subscription')} className="flex-1 md:flex-none bg-primary text-black hover:bg-primary/90 rounded-xl">
              Управление подпиской
            </Button>
            <Button onClick={() => navigate('/installation')} variant="outline" className="flex-1 md:flex-none rounded-xl border-border hover:bg-muted">
              Инструкции
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card onClick={() => navigate('/installation')} className="glass-card hover:border-primary/50 transition-colors cursor-pointer group">
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
        
        <Card onClick={() => navigate('/support')} className="glass-card hover:border-primary/50 transition-colors cursor-pointer group">
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
