import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Monitor, 
  Smartphone, 
  Apple, 
  Download, 
  ExternalLink, 
  QrCode,
  CheckCircle2,
  Copy,
  Info
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { cn, copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';

const platforms = [
  { 
    id: 'ios', 
    name: 'iOS', 
    icon: Apple, 
    color: 'text-white',
    apps: [
      { name: 'Hiddify', url: 'https://apps.apple.com/us/app/hiddify/id6473777532', recommended: true },
      { name: 'Streisand', url: 'https://apps.apple.com/us/app/streisand/id6450534064' },
      { name: 'V2Box', url: 'https://apps.apple.com/us/app/v2box-v2ray-client/id1640151303' }
    ]
  },
  { 
    id: 'android', 
    name: 'Android', 
    icon: Smartphone, 
    color: 'text-green-500',
    apps: [
      { name: 'Hiddify', url: 'https://play.google.com/store/apps/details?id=app.hiddify.com', recommended: true },
      { name: 'v2rayNG', url: 'https://play.google.com/store/apps/details?id=com.v2ray.ang' }
    ]
  },
  { 
    id: 'windows', 
    name: 'Windows', 
    icon: Monitor, 
    color: 'text-blue-500',
    apps: [
      { name: 'Hiddify-Next', url: 'https://github.com/hiddify/hiddify-next/releases/latest/download/Hiddify-Windows-Setup-x64.exe', recommended: true }
    ]
  },
  { 
    id: 'macos', 
    name: 'macOS', 
    icon: Apple, 
    color: 'text-gray-400',
    apps: [
      { name: 'Hiddify-Next', url: 'https://apps.apple.com/us/app/hiddify/id6473777532', recommended: true }
    ]
  },
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

  const platformData = platforms.find(p => p.id === selectedPlatform);

  return (
    <div className="max-w-4xl mx-auto space-y-12 animate-in fade-in duration-700 pb-20">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-black tracking-tight">Настройка izinet</h1>
        <p className="text-muted-foreground">Три простых шага до безопасного интернета</p>
      </div>

      {/* Шаг 1: Платформа */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">1</div>
          <h2 className="text-xl font-bold uppercase tracking-wider text-muted-foreground">Выберите устройство</h2>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {platforms.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedPlatform(p.id)}
              className={cn(
                "group relative p-6 rounded-3xl border-2 transition-all duration-300 overflow-hidden",
                selectedPlatform === p.id 
                  ? "border-primary bg-primary/[0.03] shadow-[0_0_40px_-20px_rgba(0,255,136,0.2)]" 
                  : "border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]"
              )}
            >
              <div className="flex flex-col items-center gap-3 relative z-10">
                <p.icon className={cn(
                  "w-8 h-8 transition-transform group-hover:scale-110",
                  selectedPlatform === p.id ? "text-primary" : "text-muted-foreground"
                )} />
                <span className={cn(
                  "font-bold text-sm",
                  selectedPlatform === p.id ? "text-white" : "text-muted-foreground"
                )}>{p.name}</span>
              </div>
              {selectedPlatform === p.id && (
                <div className="absolute inset-0 bg-primary/5 blur-xl animate-pulse" />
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Шаг 2: Приложение */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">2</div>
          <h2 className="text-xl font-bold uppercase tracking-wider text-muted-foreground">Установите клиент</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {platformData?.apps.map((app) => (
            <div 
              key={app.name} 
              className={cn(
                "p-5 rounded-3xl border border-white/5 bg-white/[0.02] flex flex-col justify-between gap-6",
                app.recommended && "border-primary/20 bg-primary/[0.02]"
              )}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-lg">{app.name}</span>
                  {app.recommended && (
                    <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] uppercase font-black">Рекомендуем</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {app.recommended 
                    ? "Самый простой и надежный способ подключения. Поддерживает автоматическое обновление." 
                    : "Альтернативный клиент для продвинутых пользователей."}
                </p>
              </div>
              
              <Button 
                asChild
                className={cn(
                  "w-full rounded-2xl h-12 font-bold",
                  app.recommended ? "bg-primary text-black hover:bg-primary/90" : "bg-white/5 text-white hover:bg-white/10"
                )}
              >
                <a href={app.url} target="_blank" rel="noopener noreferrer">
                  {app.recommended ? 'Скачать сейчас' : 'Установить'}
                  <ExternalLink className="ml-2 w-4 h-4" />
                </a>
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Шаг 3: Подключение */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">3</div>
          <h2 className="text-xl font-bold uppercase tracking-wider text-muted-foreground">Импорт ключа</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card className="rounded-[40px] border-white/5 bg-white/[0.02] overflow-hidden">
            <CardHeader className="p-8 pb-4">
              <CardTitle className="text-2xl font-bold">Способ А: QR-код</CardTitle>
              <CardDescription>Отсканируйте камерой приложения</CardDescription>
            </CardHeader>
            <CardContent className="p-8 pt-4 flex flex-col items-center gap-6">
              <div className="p-6 bg-white rounded-[32px] shadow-2xl shadow-primary/10 transition-transform hover:scale-105 duration-500">
                {subscription ? (
                  <QRCodeSVG 
                    value={subscription.v2ray_config} 
                    size={200}
                    level="H"
                    includeMargin={false}
                    bgColor="#FFFFFF"
                    fgColor="#000000"
                  />
                ) : (
                  <div className="w-[200px] h-[200px] flex items-center justify-center text-black/20 font-bold border-2 border-dashed border-black/10 rounded-2xl">
                    Нет подписки
                  </div>
                )}
              </div>
              <div className="flex items-start gap-3 p-4 bg-primary/5 rounded-2xl border border-primary/10">
                <Info className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <p className="text-[11px] leading-snug">Просто откройте приложение и выберите "Import from QR" или "Scan". Код содержит все настройки.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[40px] border-white/5 bg-white/[0.02] overflow-hidden">
            <CardHeader className="p-8 pb-4">
              <CardTitle className="text-2xl font-bold">Способ Б: Ссылка</CardTitle>
              <CardDescription>Скопируйте и вставьте в приложение</CardDescription>
            </CardHeader>
            <CardContent className="p-8 pt-4 space-y-6">
              <div className="p-6 rounded-[32px] bg-black/40 border border-white/5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Universal Config</span>
                  <CheckCircle2 className={cn("w-4 h-4 transition-colors", copied ? "text-primary" : "text-white/5")} />
                </div>
                <div className="font-mono text-[10px] break-all leading-relaxed text-muted-foreground line-clamp-4">
                  {vpnKey}
                </div>
                <Button 
                  onClick={handleCopy}
                  className="w-full bg-white/10 hover:bg-white/20 text-white rounded-2xl h-12 font-bold gap-2"
                >
                  <Copy className="w-4 h-4" />
                  {copied ? 'Скопировано!' : 'Копировать ключ'}
                </Button>
              </div>

              <div className="space-y-3">
                <div className="text-center text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Или в 1 клик</div>
                <Button 
                  className="w-full bg-primary text-black hover:bg-primary/90 rounded-2xl h-14 font-black text-lg neon-glow"
                  onClick={() => {
                    if (!subscription) {
                      toast.error('У вас нет активной подписки');
                      return;
                    }
                    window.location.href = `clash://install-config?url=${encodeURIComponent(vpnKey)}`;
                    toast.info('Пытаемся открыть приложение...');
                  }}
                >
                  АВТОМАТИЧЕСКИ
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <div className="p-8 rounded-[40px] bg-gradient-to-br from-primary/20 to-transparent border border-primary/20 text-center space-y-4 relative overflow-hidden">
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-primary/20 blur-[100px] rounded-full" />
        <h3 className="text-2xl font-black">Готово к работе?</h3>
        <p className="text-muted-foreground flex items-center justify-center gap-2">
           <CheckCircle2 className="text-primary" /> После импорта нажмите Connect. Приятного пользования!
        </p>
      </div>
    </div>
  );
}
