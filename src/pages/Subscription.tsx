import React, { useEffect, useState } from 'react';
import { 
  ShieldCheck, 
  Zap, 
  Clock, 
  Globe, 
  Smartphone, 
  Plus, 
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { SubscriptionWizard } from '@/components/subscription/SubscriptionWizard';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export default function Subscription() {
  const { user } = useAuth();
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [subscription, setSubscription] = useState<any>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSubscriptionData = async () => {
      if (!user) return;
      
      try {
        // Fetch active subscription
        const { data: subData, error: subError } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (subError && subError.code !== 'PGRST116') {
          console.error('Error fetching subscription:', subError);
          toast.error('Ошибка при загрузке данных подписки');
        } else {
          setSubscription(subData);
          
          // Fetch devices for this subscription
          if (subData) {
            const { data: devData, error: devError } = await supabase
              .from('devices')
              .select('*')
              .eq('subscription_id', subData.id);
              
            if (devError) {
              console.error('Error fetching devices:', devError);
              toast.error('Ошибка при загрузке списка устройств');
            } else {
              setDevices(devData || []);
            }
          }
        }
      } catch (error) {
        console.error('Subscription data fetch error:', error);
        toast.error('Проблема с подключением к бэкенду');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSubscriptionData();
  }, [user]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const planName = subscription?.plan_type || 'Нет активной подписки';
  
  // Convert MB to GB for display
  const trafficUsedGB = (subscription?.traffic_used_mb || 0) / 1024;
  const trafficLimitGB = (subscription?.traffic_limit_mb || 10240) / 1024; // Default 10GB
  const trafficPercent = Math.min(100, Math.round((trafficUsedGB / trafficLimitGB) * 100)) || 0;
  
  const deviceCount = devices.length;
  const deviceLimit = subscription?.device_limit || 2;
  const devicePercent = Math.min(100, Math.round((deviceCount / deviceLimit) * 100)) || 0;

  let daysLeft = 0;
  let endDateStr = 'Неизвестно';
  if (subscription?.expires_at) {
    const end = new Date(subscription.expires_at);
    const now = new Date();
    const diffTime = end.getTime() - now.getTime();
    daysLeft = diffTime > 0 ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : 0;
    
    endDateStr = end.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Управление подпиской</h1>
          <p className="text-muted-foreground mt-1">Информация о вашем тарифе и лимитах</p>
        </div>
        
        <Dialog open={isWizardOpen} onOpenChange={setIsWizardOpen}>
          <DialogTrigger render={<Button className="bg-primary text-black hover:bg-primary/90 rounded-xl px-6 neon-glow" />}>
            <Plus className="mr-2 w-4 h-4" /> Купить / Продлить
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] bg-card border-border p-6">
            <DialogHeader>
              <DialogTitle>Оформление подписки</DialogTitle>
            </DialogHeader>
            <SubscriptionWizard onClose={() => setIsWizardOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Current Plan Details */}
          <Card className="glass-card border-primary/30">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 capitalize">
                  <ShieldCheck className="w-5 h-5 text-primary" />
                  {planName}
                </CardTitle>
                <CardDescription>
                  {subscription ? `Активен до ${endDateStr}` : 'Подписка не оформлена'}
                </CardDescription>
              </div>
              <Badge className={subscription ? "bg-primary/20 text-primary border-primary/50 uppercase" : "bg-muted text-muted-foreground uppercase"}>
                {subscription ? `● ${subscription.server_type}` : 'ОТКЛЮЧЕНО'}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Использование трафика</span>
                    <span className="font-medium">{trafficUsedGB.toFixed(1)} GB / {trafficLimitGB.toFixed(1)} GB</span>
                  </div>
                  <Progress value={trafficPercent} className="h-2 bg-muted" />
                  <p className="text-[10px] text-muted-foreground">Обнуление через {daysLeft} дней</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Подключено устройств</span>
                    <span className="font-medium">{deviceCount} / {deviceLimit}</span>
                  </div>
                  <Progress value={devicePercent} className="h-2 bg-muted" />
                  <p className="text-[10px] text-muted-foreground">{deviceLimit - deviceCount} свободный слот</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-2xl bg-muted/30 border border-border text-center space-y-1">
                  <Globe className="w-4 h-4 text-primary mx-auto" />
                  <div className="text-[10px] text-muted-foreground uppercase">Локация</div>
                  <div className="text-sm font-bold">Russia</div>
                </div>
                <div className="p-4 rounded-2xl bg-muted/30 border border-border text-center space-y-1">
                  <Zap className="w-4 h-4 text-primary mx-auto" />
                  <div className="text-[10px] text-muted-foreground uppercase">Тип</div>
                  <div className="text-sm font-bold uppercase">{subscription?.server_type || 'N/A'}</div>
                </div>
                <div className="p-4 rounded-2xl bg-muted/30 border border-border text-center space-y-1">
                  <Clock className="w-4 h-4 text-primary mx-auto" />
                  <div className="text-[10px] text-muted-foreground uppercase">Период</div>
                  <div className="text-sm font-bold">{subscription?.period_months || 0} мес.</div>
                </div>
                <div className="p-4 rounded-2xl bg-muted/30 border border-border text-center space-y-1">
                  <RefreshCw className="w-4 h-4 text-primary mx-auto" />
                  <div className="text-[10px] text-muted-foreground uppercase">Автопродление</div>
                  <div className="text-sm font-bold">Выкл</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Devices List */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Мои устройства</CardTitle>
              <CardDescription>Управление подключенными девайсами</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {devices.length > 0 ? devices.map((device, i) => (
                  <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-muted/20 border border-border">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10 text-primary">
                        <Smartphone className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-bold text-sm">{device.name || 'Неизвестное устройство'}</div>
                        <div className="text-[10px] text-muted-foreground">
                          Последняя активность: {device.last_connected ? new Date(device.last_connected).toLocaleString('ru-RU') : 'Никогда'}
                        </div>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg">
                      Отключить
                    </Button>
                  </div>
                )) : (
                  <div className="text-center p-6 text-muted-foreground text-sm border border-dashed border-border rounded-2xl">
                    У вас пока нет подключенных устройств
                  </div>
                )}
              </div>
              
              <Button 
                variant="outline" 
                className="w-full rounded-xl border-dashed border-border hover:border-primary/50 hover:bg-primary/5 h-12"
                disabled={!subscription || deviceCount >= deviceLimit}
              >
                <Plus className="mr-2 w-4 h-4" /> Добавить новое устройство
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Quick Info */}
          <Card className="glass-card bg-primary/5 border-primary/20">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-bold">Ускорьте свой VPN</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Перейдите на тариф <span className="text-primary font-bold">Premium</span> и получите неограниченный трафик и доступ ко всем локациям мира.
              </p>
              <Button className="w-full bg-primary text-black hover:bg-primary/90 rounded-xl">
                Улучшить тариф
              </Button>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-sm">Важные уведомления</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {daysLeft <= 14 && daysLeft > 0 && (
                <div className="flex gap-3 items-start">
                  <AlertTriangle className="w-4 h-4 text-warning mt-1" />
                  <div className="text-xs text-muted-foreground">
                    Ваша подписка истекает через {daysLeft} дней. Пополните баланс заранее, чтобы избежать отключения.
                  </div>
                </div>
              )}
              <div className="flex gap-3 items-start">
                <CheckCircle2 className="w-4 h-4 text-primary mt-1" />
                <div className="text-xs text-muted-foreground">
                  Все серверы работают в штатном режиме. Средняя задержка: 45ms.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
