import React, { useState } from 'react';
import { 
  Monitor, 
  Smartphone, 
  Apple, 
  Download, 
  ExternalLink, 
  QrCode,
  CheckCircle2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';

const platforms = [
  { id: 'ios', name: 'iOS', icon: Apple, color: 'text-white' },
  { id: 'android', name: 'Android', icon: Smartphone, color: 'text-green-500' },
  { id: 'windows', name: 'Windows', icon: Monitor, color: 'text-blue-500' },
  { id: 'macos', name: 'macOS', icon: Apple, color: 'text-gray-400' },
];

const clients = [
  { id: 'happ', name: 'Happ', status: 'stable', version: '1.2.4', link: '#' },
  { id: 'v2rayng', name: 'v2rayNG', status: 'stable', version: '1.8.5', link: '#' },
  { id: 'shadowrocket', name: 'Shadowrocket', status: 'stable', version: '2.2.31', link: '#' },
];

export default function Installation() {
  const { user } = useAuth();
  const [selectedPlatform, setSelectedPlatform] = useState('ios');
  const [copied, setCopied] = useState(false);
  const [subscription, setSubscription] = useState<any>(null);

  React.useEffect(() => {
    async function fetchSub() {
      if (!user) return;
      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();
      
      setSubscription(data);
    }
    fetchSub();
  }, [user]);

  const vpnKey = subscription?.v2ray_config 
    ? subscription.v2ray_config
    : 'Сначала активируйте подписку';

  const handleCopy = async () => {
    if (!subscription) {
      toast.error('У вас нет активной подписки');
      return;
    }
    const success = await copyToClipboard(vpnKey);
    if (success) {
      setCopied(true);
      toast.success('Ключ скопирован!');
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Не удалось скопировать ключ. Скопируйте вручную.');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Установка и настройка</h1>
        <p className="text-muted-foreground mt-1">Выберите вашу платформу для получения инструкций</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {platforms.map((p) => (
          <Card 
            key={p.id}
            className={`cursor-pointer transition-all border-2 ${selectedPlatform === p.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}
            onClick={() => setSelectedPlatform(p.id)}
          >
            <CardContent className="p-6 flex flex-col items-center gap-3">
              <p.icon className={`w-8 h-8 ${p.color}`} />
              <span className="font-bold">{p.name}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Шаг 1: Установите приложение</CardTitle>
              <CardDescription>Мы рекомендуем использовать следующие клиенты</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {clients.map((c) => (
                  <div key={c.id} className="p-4 rounded-2xl bg-muted/30 border border-border flex items-center justify-between">
                    <div>
                      <div className="font-bold">{c.name}</div>
                      <div className="text-xs text-muted-foreground">v{c.version}</div>
                    </div>
                    <Badge className="bg-primary/20 text-primary border-primary/30">Работает</Badge>
                    <Button size="sm" variant="ghost" className="rounded-lg">
                      <Download className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Шаг 2: Добавьте подписку</CardTitle>
              <CardDescription>Скопируйте ссылку и импортируйте её в приложение</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 rounded-2xl bg-black/50 border border-border space-y-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Ваша персональная ссылка</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs truncate text-primary">
                    {vpnKey}
                  </code>
                  <Button size="sm" onClick={handleCopy} className="bg-primary text-black hover:bg-primary/90 rounded-lg">
                    {copied ? 'Скопировано!' : 'Копировать'}
                  </Button>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 rounded-2xl bg-primary/5 border border-primary/20">
                <CheckCircle2 className="w-5 h-5 text-primary mt-0.5" />
                <div className="text-sm">
                  <span className="font-bold">Совет:</span> Вы можете просто нажать кнопку ниже, если приложение уже установлено.
                </div>
              </div>
              
              <Button className="w-full bg-primary text-black hover:bg-primary/90 rounded-xl h-12 neon-glow">
                Импортировать автоматически <ExternalLink className="ml-2 w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-primary" />
                QR-код
              </CardTitle>
              <CardDescription>Отсканируйте камерой телефона</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-6">
              <div className="w-48 h-48 bg-white p-4 rounded-2xl">
                {/* Placeholder for QR Code */}
                <div className="w-full h-full bg-black flex items-center justify-center text-white text-[10px] text-center p-4">
                  [QR CODE GENERATOR]
                </div>
              </div>
              <p className="text-xs text-center text-muted-foreground">
                Этот код содержит вашу персональную конфигурацию. Не передавайте его третьим лицам.
              </p>
            </CardContent>
          </Card>

          <Card className="glass-card bg-primary/5 border-primary/20">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                Готово к работе
              </h3>
              <p className="text-sm text-muted-foreground">
                После импорта выберите сервер и нажмите кнопку подключения. Ваш трафик теперь защищен!
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
