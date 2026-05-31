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
  Info,
  Lock
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
      { name: 'Happ', url: 'https://apps.apple.com/us/app/happ-v2ray-client/id6477161741', recommended: true },
      { name: 'Hiddify', url: 'https://apps.apple.com/us/app/hiddify/id6473777532', recommended: true },
      { name: 'Streisand', url: 'https://apps.apple.com/us/app/streisand/id6450534064' }
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

  const subUrl = subscription ? `${window.location.origin}/api/sub/${subscription.id}` : '';

  const handleCopy = async () => {
    if (!subscription) {
      toast.error('У вас нет активной подписки');
      return;
    }
    const success = await copyToClipboard(subUrl);
    if (success) {
      setCopied(true);
      toast.success('Ссылка на подписку скопирована!');
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Не удалось скопировать ссылку. Скопируйте вручную.');
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
                  {app.name === 'Happ' && "Прекрасный современный дизайн для iOS с очень удобной нативной настройкой раздельного обхода блокировок РФ."}
                  {app.name === 'Hiddify' && "Самый универсальный мультиплатформенный клиент. Поддерживает автоматические профили обхода."}
                  {app.name === 'v2rayNG' && "Классический надежный клиент для Android с гибким ручным управлением маршрутизацией."}
                  {app.name !== 'Happ' && app.name !== 'Hiddify' && app.name !== 'v2rayNG' && (app.recommended 
                    ? "Удобный и быстрый клиент безопасности с поддержкой автоматического обновления конфигурации." 
                    : "Альтернативный клиент для продвинутых пользователей.")
                  }
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
                    value={subUrl} 
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
                <div className="flex flex-col items-center justify-center py-6 bg-black/50 rounded-2xl border border-white/5">
                  <Lock className="w-8 h-8 text-white/20 mb-3" />
                  <span className="text-sm font-medium text-white/50 text-center px-4">Секретный ключ подписки скрыт <br/> Для добавления просто скопируйте его</span>
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
                    window.location.href = `clash://install-config?url=${encodeURIComponent(subUrl)}`;
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

      {/* Шаг 4: Настройка раздельного обхода (Маршрутизации) */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">4</div>
          <div className="space-y-0.5">
            <h2 className="text-xl font-bold uppercase tracking-wider text-muted-foreground">Раздельный обход (Маршрутизация)</h2>
            <p className="text-xs text-muted-foreground">Настройка, чтобы Яндекс, Сбербанк, Т-Банк и Госуслуги работали без VPN напрямую, а заблокированные сайты (Instagram, X и т.д.) через VPN</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Happ iOS */}
          <div className="p-6 rounded-3xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.02] transition-colors space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-white/5">
              <span className="font-bold text-base text-primary">Happ</span>
              <span className="text-[10px] bg-white/5 border border-white/10 text-muted-foreground px-2 py-0.5 rounded font-bold uppercase">iOS</span>
            </div>
            <ol className="text-xs text-muted-foreground space-y-2.5 list-decimal pl-4 leading-relaxed">
              <li>Добавьте вашу ссылку подписки в приложение и обновите её.</li>
              <li>Перейдите во вкладку <b>«Rule»</b> (Правила) на нижнем навигационном баре или в правом верхнем углу.</li>
              <li>Выберите режим правил: <b>«Bypass LAN and Russia»</b> (Обход локальной сети и РФ).</li>
              <li>Теперь российские банки и другие сервисы будут открываться мгновенно напрямую через вашего провайдера.</li>
            </ol>
          </div>

          {/* Hiddify */}
          <div className="p-6 rounded-3xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.02] transition-colors space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-white/5">
              <span className="font-bold text-base text-primary">Hiddify</span>
              <span className="text-[10px] bg-white/5 border border-white/10 text-muted-foreground px-2 py-0.5 rounded font-bold uppercase">Все платформы</span>
            </div>
            <ol className="text-xs text-muted-foreground space-y-2.5 list-decimal pl-4 leading-relaxed">
              <li>Откройте боковое или нижнее меню и нажмите на <b>шестеренку (Параметры)</b>.</li>
              <li>Перейдите в раздел <b>«Маршрутизация»</b> (Routing).</li>
              <li>В строке «Режим маршрутизации» выберите <b>«Bypass» (Обход РФ / Китая / Локальной сети)</b>.</li>
              <li>Приложение автоматически скачивает GEO-базы и пускает весь локальный трафик в обход туннеля VPN.</li>
            </ol>
          </div>

          {/* v2rayNG */}
          <div className="p-6 rounded-3xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.02] transition-colors space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-white/5">
              <span className="font-bold text-base text-primary">v2rayNG</span>
              <span className="text-[10px] bg-white/5 border border-white/10 text-muted-foreground px-2 py-0.5 rounded font-bold uppercase">Android</span>
            </div>
            <ol className="text-xs text-muted-foreground space-y-2.5 list-decimal pl-4 leading-relaxed">
              <li>Откройте левое меню, выберите <b>«Настройки»</b> (Settings).</li>
              <li>Найдите пункт <b>«Раздельное туннелирование»</b> (Per-app proxy). По умолчанию VPN работает для всех приложений.</li>
              <li>Вы можете включить разделение и <b>снять галочки</b> с банковских приложений (Сбербанк, Т-Банк, ГосУслуги).</li>
              <li>Они будут полностью игнорировать VPN и работать через обычный интернет, сохраняя максимальную скорость.</li>
            </ol>
          </div>
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
