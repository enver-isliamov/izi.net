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

import { useNavigate } from 'react-router-dom';
import { copyToClipboard } from '@/lib/utils';

export default function Instructions() {
  const navigate = useNavigate();
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

  const vpnKey = subscription 
    ? `${window.location.origin}/api/sub/${subscription.id}`
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
                  onClick={handleCopy}
                  className="w-full bg-background/50 border border-border rounded-xl px-4 py-2.5 text-xs font-mono pr-10 focus:outline-none cursor-pointer hover:bg-background/80 transition-colors"
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
            <Card className="bg-card/50 border-primary/20 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4">
                <Badge className="bg-primary/20 text-primary">Рекомендуем</Badge>
              </div>
              <CardHeader>
                <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center mb-2 shadow-lg">
                  <div className="font-black text-black">IN</div>
                </div>
                <CardTitle>INCY</CardTitle>
                <CardDescription>Официальное приложение. Быстрое, простое и надежное.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button variant="outline" onClick={() => window.open('https://apps.apple.com/us/app/incy/id6756943388', '_blank')} className="w-full rounded-xl border-border hover:bg-muted font-bold group">
                  <Download className="mr-2 h-4 w-4 text-primary group-hover:scale-110 transition-transform" /> Скачать в App Store
                </Button>

                <div className="pt-2 border-t border-border/30">
                  <p className="text-xs font-bold text-primary mb-2 uppercase tracking-wider">Инструкция по подключению:</p>
                  <div className="space-y-1">
                    <Step number={1} title="Скачайте INCY" description="Установите официальное приложение из App Store." />
                    <Step number={2} title="Импорт ключа" description="Скопируйте ключ и добавьте его в приложении." />
                    <Step number={3} title="Подключение" description="Включите VPN одним нажатием." />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/40">
              <CardHeader>
                <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center mb-2">
                  <Zap className="text-primary w-6 h-6" />
                </div>
                <CardTitle>Hiddify (Бесплатно)</CardTitle>
                <CardDescription>Ультимативное решение для обхода любых блокировок.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button variant="outline" onClick={() => window.open('https://apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532', '_blank')} className="w-full rounded-xl border-border hover:bg-muted font-bold">
                  <Globe className="mr-2 h-4 w-4 text-primary" /> Скачать Hiddify
                </Button>

                <div className="pt-2 border-t border-border/30">
                  <p className="text-xs font-bold text-primary mb-2 uppercase tracking-wider">Инструкция по подключению:</p>
                  <div className="space-y-1">
                    <Step number={1} title="Установите Hiddify" description="Найдите в App Store и скачайте." />
                    <Step number={2} title="Добавьте профиль" description="Нажмите '+' и выберите 'Добавить из буфера'." />
                    <Step number={3} title="Подключитесь" description="Нажмите центральную кнопку подключения." />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="android" className="outline-none">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="bg-card/50 border-primary/20 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4">
                <Badge className="bg-primary/20 text-primary">Рекомендуем</Badge>
              </div>
              <CardHeader>
                <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center mb-2 shadow-lg">
                  <div className="font-black text-black">IN</div>
                </div>
                <CardTitle>INCY</CardTitle>
                <CardDescription>Официальное приложение. Быстрое, простое и надежное.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button onClick={() => window.open('https://play.google.com/store/apps/details?id=llc.itdev.incy', '_blank')} className="w-full rounded-xl bg-primary text-black font-bold group">
                  <Download className="mr-2 h-4 w-4 text-black group-hover:scale-110 transition-transform" /> Скачать в Google Play
                </Button>

                <div className="pt-2 border-t border-border/30">
                  <p className="text-xs font-bold text-primary mb-2 uppercase tracking-wider">Инструкция по подключению:</p>
                  <div className="space-y-1">
                    <Step number={1} title="Скачайте INCY" description="Установите официальное приложение из Google Play." />
                    <Step number={2} title="Импорт ключа" description="Скопируйте ключ и добавьте его в приложении." />
                    <Step number={3} title="Подключение" description="Включите VPN одним нажатием." />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/40">
              <CardHeader>
                <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center mb-2">
                  <Zap className="text-primary w-6 h-6" />
                </div>
                <CardTitle>Hiddify</CardTitle>
                <CardDescription>Ультимативное решение для обхода любых блокировок.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button variant="outline" onClick={() => window.open('https://play.google.com/store/apps/details?id=app.hiddify.com', '_blank')} className="w-full rounded-xl border-border hover:bg-muted font-bold">
                  <Globe className="mr-2 h-4 w-4 text-primary" /> Скачать Hiddify
                </Button>

                <div className="pt-2 border-t border-border/30">
                  <p className="text-xs font-bold text-primary mb-2 uppercase tracking-wider">Инструкция по подключению:</p>
                  <div className="space-y-1">
                    <Step number={1} title="Установите Hiddify" description="Найдите в Google Play и скачайте." />
                    <Step number={2} title="Добавьте профиль" description="Нажмите '+ Новая конфигурация' -> 'Из буфера'." />
                    <Step number={3} title="Подключитесь" description="Нажмите центральную кнопку подключения." />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pc" className="outline-none">
          <div className="flex flex-col gap-6">
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="bg-card/50 border-border/40">
                <CardHeader>
                  <CardTitle>Windows (Hiddify)</CardTitle>
                  <CardDescription>Приложение Hiddify для персональных компьютеров.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button variant="outline" onClick={() => window.open('https://github.com/hiddify/hiddify-next/releases', '_blank')} className="w-full rounded-xl border-border">Скачать Hiddify для Windows</Button>
                  
                  <div className="pt-2 border-t border-border/30">
                    <p className="text-xs font-bold text-primary mb-2 uppercase tracking-wider">Инструкция по подключению:</p>
                    <div className="space-y-1">
                      <Step number={1} title="Установка для ПК" description="Перейдите на GitHub и скачайте Hiddify-Windows-Setup." />
                      <Step number={2} title="Импорт" description="Ткните на плюс справа вверху и выберите 'Добавить из буфера'." />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-card/50 border-border/40">
                <CardHeader>
                  <CardTitle>macOS (Hiddify)</CardTitle>
                  <CardDescription>Приложение Hiddify для устройств на macOS.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button variant="outline" onClick={() => window.open('https://github.com/hiddify/hiddify-next/releases', '_blank')} className="w-full rounded-xl border-border">Скачать Hiddify для macOS</Button>
                  
                  <div className="pt-2 border-t border-border/30">
                    <p className="text-xs font-bold text-primary mb-2 uppercase tracking-wider">Инструкция по подключению:</p>
                    <div className="space-y-1">
                      <Step number={1} title="Установка для Mac" description="Скачайте .dmg с GitHub или установите из App Store." />
                      <Step number={2} title="Настройка" description="Разрешите VPN в настройках системы и добавьте конфиг." />
                    </div>
                  </div>
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
        <Button 
          variant="secondary" 
          className="rounded-xl px-8 h-12"
          onClick={() => navigate('/support')}
        >
          Написать в поддержку
        </Button>
      </div>
    </div>
  );
}
