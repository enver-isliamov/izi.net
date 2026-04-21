import React, { useState } from 'react';
import { 
  Smartphone, 
  Monitor, 
  Apple, 
  ChevronRight, 
  Download, 
  Copy, 
  Check, 
  Info,
  Shield,
  Zap,
  Globe
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

export default function Instructions() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [subscription, setSubscription] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    async function fetchSub() {
      if (!user) return;
      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single();
      
      setSubscription(data);
      setLoading(false);
    }
    fetchSub();
  }, [user]);

  const vpnKey = subscription?.v2ray_config 
    ? subscription.v2ray_config
    : subscription 
      ? `v2ray://subscription?link=https://api.izinet.app/sub/${subscription.id}` 
      : 'Сначала активируйте подписку';

  const handleCopy = () => {
    if (!subscription) {
      toast.error('У вас нет активной подписки');
      return;
    }
    navigator.clipboard.writeText(vpnKey);
    setCopied(true);
    toast.success('Ключ скопирован!');
    setTimeout(() => setCopied(false), 2000);
  };

  const Step = ({ number, title, description, badge }: { number: number, title: string, description: string, badge?: string }) => (
    <div className="flex gap-4 items-start py-4 border-b border-border/40 last:border-0 relative">
      <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary shrink-0">
        {number}
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold">{title}</h4>
          {badge && <Badge variant="secondary" className="text-[10px] uppercase h-4 px-1.5">{badge}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight neon-text">Как подключиться?</h1>
        <p className="text-muted-foreground">Настройка VPN займет меньше минуты. Выберите ваше устройство:</p>
      </div>

      {/* Subscription Key Widget */}
      <Card className="glass-card border-primary/20 overflow-hidden relative group">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-2 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-2">
                <Shield className="w-5 h-5 text-primary" />
                <span className="font-bold text-lg">Ваш персональный ключ</span>
              </div>
              <p className="text-sm text-muted-foreground">Используйте этот ключ для автоматической настройки в любом приложении</p>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                <input 
                  readOnly 
                  value={vpnKey}
                  className="w-full bg-background/50 border border-border rounded-xl px-4 py-2.5 text-xs font-mono pr-10 focus:outline-none"
                />
                <div className="absolute right-2 top-2">
                  <div className={`w-2 h-2 rounded-full ${subscription ? 'bg-primary' : 'bg-destructive'} animate-pulse`} />
                </div>
              </div>
              <Button onClick={handleCopy} className="rounded-xl h-10 px-4 bg-primary text-black hover:bg-primary/90">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="ios" className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-muted/30 p-1 rounded-2xl mb-8">
          <TabsTrigger value="ios" className="rounded-xl gap-2 data-[state=active]:bg-primary data-[state=active]:text-black">
            <Apple className="w-4 h-4" /> <span className="hidden sm:inline">iOS / Apple</span>
          </TabsTrigger>
          <TabsTrigger value="android" className="rounded-xl gap-2 data-[state=active]:bg-primary data-[state=active]:text-black">
            <Smartphone className="w-4 h-4" /> <span className="hidden sm:inline">Android</span>
          </TabsTrigger>
          <TabsTrigger value="pc" className="rounded-xl gap-2 data-[state=active]:bg-primary data-[state=active]:text-black">
            <Monitor className="w-4 h-4" /> <span className="hidden sm:inline">PC / Desktop</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ios" className="space-y-6 outline-none">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="bg-card/50 border-border/40">
              <CardHeader>
                <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center mb-2 shadow-lg">
                  <img src="https://picsum.photos/seed/shadow/100/100" className="rounded-lg" alt="Shadowrocket" />
                </div>
                <CardTitle>Shadowrocket</CardTitle>
                <CardDescription>Лучшее решение для iOS. Платное (~3$), но самое стабильное.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <Step number={1} title="Скачайте приложение" description="Установите Shadowrocket из App Store." />
                  <Step number={2} title="Скопируйте ключ" description="Нажмите кнопку копирования выше." />
                  <Step number={3} title="Настройка" description="Откройте приложение, оно само предложит добавить конфиг из буфера." />
                </div>
                <Button variant="outline" className="w-full mt-6 rounded-xl border-border hover:bg-muted font-bold group">
                  <Download className="mr-2 h-4 w-4 text-primary group-hover:scale-110 transition-transform" /> В App Store
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/40">
              <CardHeader>
                <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center mb-2">
                  <Zap className="text-primary w-6 h-6" />
                </div>
                <CardTitle>Streisand (Бесплатно)</CardTitle>
                <CardDescription>Отличный бесплатный аналог для iPhone и iPad.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <Step number={1} title="Установите Streisand" description="Найдите в App Store и скачайте." />
                  <Step number={2} title="Добавьте подписку" description="Нажмите '+', выберите 'Subscription' и вставьте ссылку." />
                  <Step number={3} title="Подключитесь" description="Выберите ближайший сервер и нажмите кнопку 'Connect'." />
                </div>
                <Button variant="outline" className="w-full mt-6 rounded-xl border-border hover:bg-muted font-bold">
                  <Globe className="mr-2 h-4 w-4 text-primary" /> Скачать бесплатно
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="android" className="outline-none">
          <Card className="bg-card/50 border-border/40">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-2xl">v2rayNG</CardTitle>
                <CardDescription>Стандарт индустрии для Android</CardDescription>
              </div>
              <Badge className="bg-primary/10 text-primary border-primary/20">Рекомендуем</Badge>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <Step number={1} title="Скачайте APK или с Play Market" description="Установите приложение v2rayNG." />
                <Step number={2} title="Импорт подписки" description="Нажмите 'Меню' -> 'Группы подписок' -> '+' -> Вставьте ссылку." />
                <Step number={3} title="Обновите сервера" description="Нажмите 'Обновить подписку' и выберите сервер." />
                <Button className="w-full mt-4 rounded-xl bg-primary text-black font-bold h-12">
                  <Download className="mr-2 h-5 w-5" /> Скачать v2rayNG
                </Button>
              </div>
              <div className="bg-black/40 rounded-2xl p-6 border border-border/50 flex flex-col justify-center">
                <div className="flex items-center gap-3 mb-4">
                  <Info className="w-5 h-5 text-primary" />
                  <span className="font-semibold uppercase text-xs tracking-wider">Полезный совет</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Если приложение не подключается, попробуйте изменить тип DNS в настройках или включите режим "Разрешить только выбранные приложения".
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pc" className="outline-none">
          <div className="flex flex-col gap-6">
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="bg-card/50 border-border/40">
                <CardHeader>
                  <CardTitle>Windows (v2rayN)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Step number={1} title="Скачайте архив" description="Распакуйте и запустите v2rayN.exe." />
                  <Step number={2} title="Настройте прокси" description="Установите системный прокси-сервер в настройках приложения." />
                  <Button variant="outline" className="w-full rounded-xl border-border">Скачать для Windows</Button>
                </CardContent>
              </Card>
              <Card className="bg-card/50 border-border/40">
                <CardHeader>
                  <CardTitle>macOS (Nekoray)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Step number={1} title="Установка" description="Скачайте .dmg файл и перенесите в Applications." />
                  <Step number={2} title="Разрешения" description="Разрешите приложению использовать VPN в настройках системы." />
                  <Button variant="outline" className="w-full rounded-xl border-border">Скачать для macOS</Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="rounded-3xl bg-muted/10 border border-border/50 p-8 flex flex-col md:flex-row items-center gap-6">
        <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
          <Globe className="w-8 h-8 text-primary" />
        </div>
        <div className="space-y-1 flex-1 text-center md:text-left">
          <h3 className="text-xl font-bold">Нужна помощь с настройкой?</h3>
          <p className="text-muted-foreground text-sm">Наши специалисты поддержки помогут вам установить VPN на любое устройство 24/7.</p>
        </div>
        <Button variant="secondary" className="rounded-xl px-8 h-12">Написать в поддержку</Button>
      </div>
    </div>
  );
}
