import React, { useState, useEffect } from 'react';
import { 
  Smartphone, 
  Monitor, 
  Apple, 
  ArrowLeft,
  Globe,
  Copy,
  Info,
  QrCode,
  CheckCircle2,
  Settings,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';

export default function Instructions() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<any>(null);
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
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

  const vpnKey = subscription?.v2ray_config || 'Сначала активируйте подписку на главном экране';

  const handleCopy = async () => {
    if (!subscription) {
      toast.error('У вас нет активной подписки');
      return;
    }
    const success = await copyToClipboard(vpnKey);
    if (success) {
      setCopied(true);
      toast.success('Персональный VPN-ключ скопирован!');
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Не удалось скопировать. Вы можете скопировать текст вручную.');
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300 max-w-sm mx-auto pb-10">
      {/* Header */}
      <div className="flex items-center gap-2 pb-1">
        <Button 
          variant="ghost" 
          size="icon" 
          className="rounded-xl h-8 w-8 text-muted-foreground hover:text-primary shrink-0"
          onClick={() => navigate('/dashboard')}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Назад на главную</span>
      </div>

      <div className="text-center space-y-1 py-1">
        <h1 className="text-xl font-black tracking-tight text-white uppercase">Установка и настройка</h1>
        <p className="text-[11px] text-muted-foreground">Простые краткие шаги до безопасного интернета</p>
      </div>

      {/* Subscription Key section */}
      {subscription ? (
        <Card className="glass-card border-primary/20 p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-black uppercase tracking-widest text-primary flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Ваш личный VPN-ключ
            </span>
            <span className="text-[9px] text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
              Подписка активна
            </span>
          </div>
          
          <div className="p-2.5 rounded-lg bg-black/60 border border-white/5 space-y-2">
            <div className="font-mono text-[9px] break-all leading-normal text-muted-foreground line-clamp-2 select-all">
              {vpnKey}
            </div>
            <div className="flex gap-2.5 pt-1">
              <Button 
                onClick={handleCopy}
                className="flex-1 bg-primary text-black hover:bg-primary/90 rounded-xl h-8 text-[11px] font-bold gap-1.5"
              >
                <Copy className="w-3 h-3" />
                {copied ? 'Скопировано!' : 'Копировать ключ'}
              </Button>
              <Button 
                onClick={() => setShowQr(!showQr)}
                variant="outline"
                className="rounded-xl border-border hover:bg-white/5 h-8 w-11 shrink-0 p-0"
                title="Показать QR-код"
              >
                <QrCode className="w-4 h-4 text-primary" />
              </Button>
            </div>
          </div>

          {showQr && (
            <div className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl border border-white animate-in zoom-in-95 duration-200">
              <QRCodeSVG 
                value={vpnKey} 
                size={140}
                level="M"
                includeMargin={false}
                bgColor="#FFFFFF"
                fgColor="#000000"
              />
              <span className="text-[9px] text-black font-semibold mt-1.5 uppercase font-mono">Отсканируйте из приложения</span>
            </div>
          )}
        </Card>
      ) : (
        <Card className="glass-card border-white/5 p-4 text-center space-y-2">
          <p className="text-xs text-muted-foreground">У вас пока нет активной подписки VPN.</p>
          <Button 
            onClick={() => navigate('/dashboard')}
            className="w-full bg-primary text-black hover:bg-primary/90 text-xs font-bold rounded-xl h-9"
          >
            Купить подписку
          </Button>
        </Card>
      )}

      {/* Краткая инструкция */}
      <Card className="glass-card border-white/5 p-3.5 space-y-2.5">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-primary" /> Краткая инструкция
        </h3>
        <div className="space-y-2 text-[11px] text-muted-foreground leading-normal pl-1.5">
          <div className="flex gap-2">
            <span className="text-primary font-black">1.</span>
            <span>Скопируйте ваш **личный VPN-ключ** выше.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-primary font-black">2.</span>
            <span>Скачайте и установите одно из приложений ниже.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-primary font-black">3.</span>
            <span>Откройте приложение, нажмите **«Добавить»/«+»** и импортируйте ключ из буфера обмена. Нажмите **Подключить**!</span>
          </div>
        </div>
      </Card>

      {/* Card 1: INCY */}
      <Card className="glass-card border-primary/20 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-lg shrink-0">
              <span className="font-black text-black text-sm tracking-tighter">IN</span>
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-white flex items-center gap-1.5">
                INCY <Badge className="bg-primary/20 text-primary border-primary/20 text-[8px] font-black uppercase tracking-wider py-0 px-1 hover:bg-primary/20">Рекомендуем</Badge>
              </h3>
              <p className="text-[10px] text-muted-foreground leading-tight">Простое официальное приложение</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button 
            variant="outline" 
            onClick={() => window.open('https://apps.apple.com/us/app/incy/id6756943388', '_blank')} 
            className="rounded-xl border-border hover:bg-white/5 text-[11px] font-bold h-9 gap-1.5 w-full py-1 px-2"
          >
            <Apple className="w-3.5 h-3.5 text-primary shrink-0" /> App Store (iOS)
          </Button>
          <Button 
            variant="outline" 
            onClick={() => window.open('https://play.google.com/store/apps/details?id=llc.itdev.incy', '_blank')} 
            className="rounded-xl border-border hover:bg-white/5 text-[11px] font-bold h-9 gap-1.5 w-full py-1 px-2"
          >
            <Smartphone className="w-3.5 h-3.5 text-primary shrink-0" /> Google Play
          </Button>
        </div>
      </Card>

      {/* Card 2: Hiddify */}
      <Card className="glass-card border-white/10 p-3.5 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
            <Globe className="text-primary w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-extrabold text-white">Hiddify</h3>
            <p className="text-[10px] text-muted-foreground leading-tight">Универсальный клиент под все ОС</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button 
              variant="outline" 
              onClick={() => window.open('https://apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532', '_blank')} 
              className="rounded-xl border-border hover:bg-white/5 text-[11px] font-bold h-9 gap-1.5 w-full py-1 px-1.5"
            >
              <Apple className="w-3.5 h-3.5 text-primary shrink-0" /> App Store (iOS)
            </Button>
            <Button 
              variant="outline" 
              onClick={() => window.open('https://play.google.com/store/apps/details?id=app.hiddify.com', '_blank')} 
              className="rounded-xl border-border hover:bg-white/5 text-[11px] font-bold h-9 gap-1.5 w-full py-1 px-1.5"
            >
              <Smartphone className="w-3.5 h-3.5 text-primary shrink-0" /> Google Play
            </Button>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <Button 
              variant="outline" 
              onClick={() => window.open('https://github.com/hiddify/hiddify-next/releases', '_blank')} 
              className="rounded-xl border-border hover:bg-white/5 text-[11px] font-bold h-9 gap-1.5 w-full py-1 px-1.5"
            >
              <Monitor className="w-3.5 h-3.5 text-primary shrink-0" /> для Windows
            </Button>
            <Button 
              variant="outline" 
              onClick={() => window.open('https://github.com/hiddify/hiddify-next/releases', '_blank')} 
              className="rounded-xl border-border hover:bg-white/5 text-[11px] font-bold h-9 gap-1.5 w-full py-1 px-1.5"
            >
              <Apple className="w-3.5 h-3.5 text-primary shrink-0" /> для macOS
            </Button>
          </div>
        </div>
      </Card>

      {/* Раздельный обход / Маршрутизация */}
      <Card className="glass-card border-white/5 p-3.5 space-y-3">
        <div className="space-y-0.5">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5" /> Раздельная маршрутизация
          </h3>
          <p className="text-[10px] text-muted-foreground leading-normal">
            Используйте обход, чтобы Сбербанк, Т-Банк, Госуслуги, Кинопоиск и Яндекс работали на максимальной скорости напрямую, а заблокированные сайты автоматически шли через VPN.
          </p>
        </div>

        <div className="space-y-3 pt-1 border-t border-white/5 text-[11px]">
          {/* INCY */}
          <div className="space-y-1">
            <div className="flex justify-between items-center bg-white/[0.02] p-1.5 rounded border border-white/5">
              <span className="font-extrabold text-white text-[10px]">Приложение: INCY</span>
              <Badge className="bg-primary/10 text-primary border-primary/20 text-[8px] font-black uppercase">Умный режим</Badge>
            </div>
            <p className="text-muted-foreground pl-1.5 leading-normal">
              В INCY обход РФ **уже настроен по умолчанию**! Российские сайты и банки всегда работают напрямую без отключения VPN.
            </p>
          </div>

          {/* Hiddify */}
          <div className="space-y-1">
            <div className="flex justify-between items-center bg-white/[0.02] p-1.5 rounded border border-white/5">
              <span className="font-extrabold text-white text-[10px]">Приложение: Hiddify</span>
              <Badge className="bg-zinc-800 text-muted-foreground border-white/5 text-[8px] font-bold uppercase">Обход РФ</Badge>
            </div>
            <p className="text-muted-foreground pl-1.5 leading-normal">
              Перейдите в **«Параметры»** (шестеренка в меню) ➔ раздел **«Маршрутизация»** ➔ пункт **«Режим маршрутизации»** ➔ выберите **Bypass** (Обход локальной сети и РФ).
            </p>
          </div>

          {/* Happ */ }
          <div className="space-y-1">
            <div className="flex justify-between items-center bg-white/[0.02] p-1.5 rounded border border-white/5">
              <span className="font-extrabold text-white text-[10px]">Приложение: Happ (iOS)</span>
              <Badge className="bg-zinc-800 text-muted-foreground border-white/5 text-[8px] font-bold uppercase">Правила</Badge>
            </div>
            <p className="text-muted-foreground pl-1.5 leading-normal">
              Перейдите во вкладку **«Rule»** (Правила) на нижнем баре ➔ Выберите режим **«Bypass LAN and Russia»** (Обход локальной сети и РФ).
            </p>
          </div>

          {/* v2rayNG */}
          <div className="space-y-1">
            <div className="flex justify-between items-center bg-white/[0.02] p-1.5 rounded border border-white/5">
              <span className="font-extrabold text-white text-[10px]">Приложение: v2rayNG (Android)</span>
              <Badge className="bg-zinc-800 text-muted-foreground border-white/5 text-[8px] font-bold uppercase">Туннелирование</Badge>
            </div>
            <p className="text-muted-foreground pl-1.5 leading-normal">
              Левое меню ➔ **«Настройки»** ➔ найдите **«Раздельное туннелирование»** ➔ снимите галочки с Сбербанк, Т-Банк, Госуслуги.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

