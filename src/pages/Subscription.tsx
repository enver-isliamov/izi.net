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
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export default function Subscription() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [vpnKeys, setVpnKeys] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [wizardMode, setWizardMode] = useState<'extend' | 'new'>('extend');
  const [targetDevice, setTargetDevice] = useState<string | undefined>(undefined);
  const [targetDeviceName, setTargetDeviceName] = useState<string | undefined>(undefined);

  const fetchSubscriptionData = async () => {
    if (!user) return;
    
    try {
      // 1. Fetch active main subscription
      const { data: mainSubData, error: subError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (subError) {
        console.error('Error fetching subscription:', subError);
        toast.error('Ошибка при загрузке данных подписки');
        return;
      }

      setSubscriptions(mainSubData ? [mainSubData] : []);

      if (mainSubData && mainSubData.v2ray_config) {
        // Parse devices from v2ray_config either JSON or legacy
        let parsedDevices: any[] = [];
        if (mainSubData.v2ray_config.trim().startsWith('[')) {
          try {
            parsedDevices = JSON.parse(mainSubData.v2ray_config);
          } catch (e) {
            console.warn('Failed to parse JSON config');
          }
        } else {
          const configs = mainSubData.v2ray_config.split('\n---KEY_SEP---\n').filter(Boolean);
          parsedDevices = configs.map((cfg: string, i: number) => ({
             id: i === 0 ? 'primary' : `device_${i}`,
             label: i === 0 ? 'Основное устройство' : `Доп. устройство ${i}`,
             config: cfg,
             serverType: mainSubData.server_type?.toUpperCase() || 'WI-FI',
             expiresAt: mainSubData.expires_at,
             trafficUsedBytes: 0
          }));
        }
        
        // Keep all devices in vpnKeys array to easily render the full list
        setVpnKeys(parsedDevices);
      }
    } catch (error) {
      console.error('Subscription data fetch error:', error);
      toast.error('Проблема с подключением к бэкенду');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscriptionData();
  }, [user]);

  useEffect(() => {
    // Check URL params for auto-open wizard
    const action = searchParams.get('action');
    const target = searchParams.get('targetDeviceId');
    
    if (action === 'new-device') {
      openWizard('new');
      setSearchParams({}); // Clear params after open
    } else if (target) {
      // Ищем устройство в vpnKeys (массив уже загрузился)
      const dev = vpnKeys.find((d: any) => d.id === target);
      if (dev) {
        setTargetDeviceName(dev.label);
      }
      setTargetDevice(target);
      openWizard('extend');
      setSearchParams({}); // Clear params after open
    }
  }, [searchParams, setSearchParams, vpnKeys]);

  const openWizard = (mode: 'extend' | 'new') => {
    setWizardMode(mode);
    if (mode === 'new') setTargetDevice(undefined);
    setIsWizardOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const mainSub = subscriptions[0] || null;
  const planName = mainSub ? (mainSub.plan_type === 'trial' ? 'Пробный' : (mainSub.server_type?.toUpperCase() === 'LTE' ? 'LTE Премиум' : 'Wi-Fi Стандарт')) : 'Нет активной подписки';
  
  // Sum aggregate traffic for the status card
  const trafficUsedGB = subscriptions.reduce((acc, sub) => acc + (sub.traffic_used_mb || 0), 0) / 1024;
  const trafficLimitGB = (mainSub?.traffic_limit_mb || 102400) / 1024; 
  const trafficPercent = Math.min(100, Math.round((trafficUsedGB / trafficLimitGB) * 100)) || 0;
  
  const deviceCount = vpnKeys.length;
  const deviceLimit = mainSub?.device_limit || 2;
  const devicePercent = Math.min(100, Math.round((deviceCount / deviceLimit) * 100)) || 0;

  let daysLeft = 0;
  let endDateStr = 'Неизвестно';
  if (mainSub?.expires_at) {
    const end = new Date(mainSub.expires_at);
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
          <DialogTrigger asChild>
            <Button className="bg-primary text-black hover:bg-primary/90 rounded-xl px-6 neon-glow" onClick={() => openWizard('extend')}>
              <Plus className="mr-2 w-4 h-4" /> Купить / Продлить
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] bg-card border-border p-6 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold">
                {wizardMode === 'new' ? 'Добавление устройства' : 'Оформление подписки'}
              </DialogTitle>
            </DialogHeader>
            <SubscriptionWizard 
              onClose={() => {
                setIsWizardOpen(false);
                fetchSubscriptionData();
              }} 
              forceNew={wizardMode === 'new'}
              targetDeviceId={targetDevice}
              targetDeviceName={targetDeviceName}
            />
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
                  {mainSub ? `Активен до ${endDateStr}` : 'Подписка не оформлена'}
                </CardDescription>
              </div>
              <Badge className={mainSub ? "bg-primary/20 text-primary border-primary/50 uppercase" : "bg-muted text-muted-foreground uppercase"}>
                {mainSub ? `● ${mainSub.server_type?.toUpperCase()}` : 'ОТКЛЮЧЕНО'}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Использование трафика (Всего)</span>
                    <span className="font-medium">{trafficUsedGB.toFixed(1)} GB / {trafficLimitGB.toFixed(1)} GB</span>
                  </div>
                  <Progress value={trafficPercent} className="h-2 bg-muted" />
                  <p className="text-[10px] text-muted-foreground">На основе основного лимита</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Активных ключей</span>
                    <span className="font-medium">{deviceCount} / {deviceLimit} шт.</span>
                  </div>
                  <Progress value={devicePercent} className="h-2 bg-muted" />
                  <p className="text-[10px] text-muted-foreground">Вы можете добавить больше устройств</p>
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
                  <div className="text-sm font-bold uppercase">{mainSub?.server_type || 'N/A'}</div>
                </div>
                <div className="p-4 rounded-2xl bg-muted/30 border border-border text-center space-y-1">
                  <Clock className="w-4 h-4 text-primary mx-auto" />
                  <div className="text-[10px] text-muted-foreground uppercase">Период</div>
                  <div className="text-sm font-bold">{mainSub?.period_months || 0} мес.</div>
                </div>
                <div className="p-4 rounded-2xl bg-muted/30 border border-border text-center space-y-1">
                  <RefreshCw className="w-4 h-4 text-primary mx-auto" />
                  <div className="text-[10px] text-muted-foreground uppercase">Автопродление</div>
                  <div className="text-sm font-bold">Выкл</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* My Devices / Keys */}
          <Card className="glass-card border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-xl">Мои устройства</CardTitle>
                <CardDescription>Управление VPN-ключами</CardDescription>
              </div>
              {deviceCount < deviceLimit && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="border-primary/50 hover:bg-primary/10 rounded-xl"
                  onClick={() => openWizard('new')}
                >
                  <Plus className="mr-2 w-4 h-4" /> Добавить устройство
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {vpnKeys.map((device, i) => {
                  const devExpiry = new Date(device.expiresAt || device.expires_at || mainSub?.expires_at);
                  const devDaysLeft = Math.max(0, Math.ceil((devExpiry.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)));
                  const devLabel = device.label || (i === 0 ? 'Основное устройство' : `Доп. устройство ${i + 1}`);
                  
                  return (
                    <div key={device.id || i} className="flex flex-col sm:flex-row items-center justify-between p-4 rounded-2xl bg-muted/20 border border-border gap-4">
                      <div className="flex items-center gap-4 w-full sm:w-auto">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", i === 0 ? "bg-primary/10 text-primary" : "bg-blue-500/10 text-blue-400")}>
                          <Smartphone className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-bold text-sm">{devLabel}</div>
                          <div className="text-[10px] text-muted-foreground flex gap-2">
                             <span>До {devExpiry.toLocaleDateString()}</span>
                             <span className={devDaysLeft > 0 ? "text-primary" : "text-destructive"}>
                               {devDaysLeft > 0 ? `(${devDaysLeft} дн.)` : '(Истек)'}
                             </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2 w-full sm:w-auto">
                        <Button 
                          size="sm" 
                          variant="secondary" 
                          className="flex-1 sm:flex-none rounded-lg text-xs" 
                          onClick={() => {
                            navigator.clipboard.writeText(device.config || device.v2ray_config);
                            toast.success(`Ключ скопирован (${devLabel})`);
                          }}
                        >
                          Копировать
                        </Button>
                        <Button 
                          size="sm" 
                          className="flex-1 sm:flex-none bg-primary text-black hover:bg-primary/90 rounded-lg text-xs" 
                          onClick={() => {
                            setTargetDevice(device.id);
                            setTargetDeviceName(devLabel);
                            navigate(`/subscription?targetDeviceId=${device.id}`);
                          }}
                        >
                          Продлить
                        </Button>
                      </div>
                    </div>
                  );
                })}
                
                {vpnKeys.length === 0 && (
                  <div className="text-center p-6 text-muted-foreground text-sm border border-dashed border-border rounded-2xl">
                    У вас пока нет активных ключей
                  </div>
                )}
              </div>
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
