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
  Zap,
  Download,
  Router as RouterIcon,
  Layers,
  Sparkles,
  ExternalLink
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
import axios from 'axios';

export default function Instructions() {
  const navigate = useNavigate();
  const { user, session } = useAuth();
  const [subscription, setSubscription] = useState<any>(null);
  const [showQr, setShowQr] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSub, setCopiedSub] = useState(false);
  const [subUrl, setSubUrl] = useState<string>('');
  const [cleanVlessKey, setCleanVlessKey] = useState<string>('');
  const [selectedApp, setSelectedApp] = useState<'incy' | 'hiddify' | 'happ' | 'v2rayng' | 'amnezia'>('incy');

  useEffect(() => {
    async function fetchSub() {
      if (!user) return;
      try {
        const { data } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        
        setSubscription(data);

        if (data) {
          // Universal subscription link
          const baseUrl = window.location.origin;
          const directSubUrl = `${baseUrl}/api/user/subscription/universal/${data.id}`;
          setSubUrl(directSubUrl);

          // Extract clean VLESS key
          if (data.v2ray_config) {
            try {
              if (data.v2ray_config.trim().startsWith('[')) {
                const devices = JSON.parse(data.v2ray_config);
                const vlessDev = devices.find((d: any) => String(d.serverType).toUpperCase() !== 'AWG') || devices[0];
                setCleanVlessKey(vlessDev?.config || '');
              } else {
                setCleanVlessKey(data.v2ray_config);
              }
            } catch {
              setCleanVlessKey(data.v2ray_config);
            }
          }
        }
      } catch (e) {
        console.warn('Failed to fetch subscription for instructions:', e);
      }
    }
    fetchSub();
  }, [user]);

  const handleCopyKey = async () => {
    if (!subscription || !cleanVlessKey) {
      toast.error('Сначала оформите подписку в личном кабинете');
      return;
    }
    const success = await copyToClipboard(cleanVlessKey);
    if (success) {
      setCopiedKey(true);
      toast.success('VPN-ключ скопирован в буфер обмена!');
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      toast.error('Не удалось скопировать автоматически');
    }
  };

  const handleCopySub = async () => {
    if (!subUrl) {
      toast.error('Подписка не найдена');
      return;
    }
    const success = await copyToClipboard(subUrl);
    if (success) {
      setCopiedSub(true);
      toast.success('Универсальная ссылка подписки скопирована!');
      setTimeout(() => setCopiedSub(false), 2000);
    } else {
      toast.error('Не удалось скопировать');
    }
  };

  const handleDownloadAwg = async () => {
    try {
      toast.loading('Подготовка файла AmneziaWG (.conf)...', { id: 'awg-dl' });
      const res = await axios.get('/api/user/awg-download', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'izinet-router-amneziawg.conf');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Файл конфигурации (.conf) скачан!', { id: 'awg-dl' });
    } catch (e: any) {
      toast.error('Сначала оформите подписку или добавьте роутер', { id: 'awg-dl' });
    }
  };

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in duration-300 max-w-4xl mx-auto pb-10">
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
        <h1 className="text-xl md:text-3xl font-black tracking-tight text-white uppercase">Установка и настройка</h1>
        <p className="text-[11px] md:text-xs text-muted-foreground">Простые краткие шаги до безопасного и свободного интернета</p>
      </div>

      {/* Быстрый доступ к VPN-ключу и QR-коду */}
      <Card className="glass-card border-primary/20 p-4 sm:p-5 space-y-4 bg-gradient-to-r from-primary/5 via-secondary/20 to-primary/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-primary/10 rounded-xl text-primary border border-primary/20 shrink-0">
              <Zap size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Шаг 1. Ваш персональный VPN-доступ</h3>
              <p className="text-[11px] text-muted-foreground">Скопируйте ключ или ссылку для автоматического импорта в приложение</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowQr(!showQr)}
              className="rounded-xl border-white/10 hover:bg-white/5 text-xs font-bold gap-1.5 h-8.5"
            >
              <QrCode size={14} className="text-primary" />
              <span>{showQr ? 'Скрыть QR' : 'QR-код'}</span>
            </Button>
            <Button
              size="sm"
              onClick={handleCopyKey}
              className="rounded-xl bg-primary hover:bg-primary/90 text-black text-xs font-bold gap-1.5 h-8.5 shadow-md shadow-primary/20"
            >
              <Copy size={14} />
              <span>{copiedKey ? 'Скопировано ✓' : 'Скопировать VPN-ключ'}</span>
            </Button>
          </div>
        </div>

        {/* QR Code Container (if toggled) */}
        {showQr && (
          <div className="p-4 bg-black/60 rounded-2xl border border-primary/20 flex flex-col items-center justify-center space-y-3 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-3 bg-white rounded-xl shadow-lg">
              <QRCodeSVG
                value={cleanVlessKey || subUrl || 'https://izinet.online'}
                size={160}
                level="M"
                includeMargin={false}
              />
            </div>
            <p className="text-[11px] text-zinc-400 font-mono text-center max-w-sm">
              Откройте камеру в приложении (INCY / Hiddify / Happ / v2rayNG) и наведите на этот QR-код для мгновенного подключения.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px] text-muted-foreground">
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-black/30 border border-white/5">
            <span className="text-primary font-black shrink-0">1.</span>
            <span>Нажмите <b>«Скопировать VPN-ключ»</b> выше.</span>
          </div>
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-black/30 border border-white/5">
            <span className="text-primary font-black shrink-0">2.</span>
            <span>Скачайте подходящее приложение для вашего устройства ниже.</span>
          </div>
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-black/30 border border-white/5">
            <span className="text-primary font-black shrink-0">3.</span>
            <span>В приложении нажмите <b>«+» / «Импорт из буфера»</b> и включите туннель.</span>
          </div>
        </div>
      </Card>

      {/* Выбор приложения */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">Шаг 2. Выберите приложение</h3>
          <Badge variant="outline" className="border-primary/20 text-primary text-[9px] uppercase font-bold">5 вариантов</Badge>
        </div>

        {/* Табы выбора */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { id: 'incy', name: 'INCY', sub: 'Рекомендуем', icon: 'IN', labelIcon: true, platforms: 'iOS & Android' },
            { id: 'hiddify', name: 'Hiddify', sub: 'Мультиплатформа', icon: Globe, labelIcon: false, platforms: 'Все платформы' },
            { id: 'happ', name: 'Happ', sub: 'Красивый для iOS', icon: Apple, labelIcon: false, platforms: 'iOS' },
            { id: 'v2rayng', name: 'v2rayNG', sub: 'Классика Android', icon: Smartphone, labelIcon: false, platforms: 'Android' },
            { id: 'amnezia', name: 'Роутеры / ТВ', sub: 'AmneziaWG', icon: RouterIcon, labelIcon: false, platforms: 'Keenetic, OpenWrt, TV' }
          ].map((app) => {
            const isSelected = selectedApp === app.id;
            return (
              <button
                key={app.id}
                onClick={() => setSelectedApp(app.id as any)}
                className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all text-center relative overflow-hidden ${
                  isSelected 
                    ? 'border-primary bg-primary/[0.04] shadow-[0_0_20px_-10px_rgba(0,255,136,0.25)]' 
                    : 'border-white/5 bg-white/[0.01] hover:border-white/10 hover:bg-white/[0.02]'
                }`}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 shadow ${
                  isSelected ? 'bg-primary text-black' : 'bg-white/5 text-muted-foreground'
                }`}>
                  {app.labelIcon ? (
                    <span className="font-black text-xs tracking-tighter">IN</span>
                  ) : (
                    React.createElement(app.icon as any, { className: "w-4 h-4" })
                  )}
                </div>

                <span className="text-xs font-extrabold text-white uppercase">{app.name}</span>
                <span className="text-[9px] text-muted-foreground line-clamp-1 mt-0.5">{app.sub}</span>
                
                {app.id === 'incy' && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-primary rounded-full animate-ping" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Карточка выбранного приложения */}
      {(() => {
        const appDetails = {
          incy: {
            name: 'INCY',
            badge: 'Официальный клиент • Рекомендуем',
            desc: 'Флагманское современное приложение с поддержкой VLESS Reality. Идеально оптимизировано под батарею, быстро подключается и содержит автоматический умный обход российских ресурсов.',
            downloads: [
              { name: 'App Store (iOS / iPad)', url: 'https://apps.apple.com/us/app/incy/id6756943388', icon: Apple },
              { name: 'Google Play (Android)', url: 'https://play.google.com/store/apps/details?id=llc.itdev.incy', icon: Smartphone }
            ],
            russiaRule: 'Обход российских сервисов настроен автоматически из коробки! Банки (Сбер, Т-Банк, ВТБ), Госуслуги, Кинопоиск, Авито и Яндекс работают напрямую на максимальной скорости без выключения VPN.',
            quickImportUrl: cleanVlessKey ? `vless://${cleanVlessKey.replace(/^vless:\/\//, '')}` : ''
          },
          hiddify: {
            name: 'Hiddify',
            badge: 'Универсальный клиент (Все ОС)',
            desc: 'Мощное кроссплатформенное приложение с открытым исходным кодом. Поддерживает протоколы VLESS-Reality, Hysteria 2 и подписки. Имеет встроенные тесты пинга и удобные режимы маршрутизации.',
            downloads: [
              { name: 'App Store (iOS)', url: 'https://apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532', icon: Apple },
              { name: 'Google Play (Android)', url: 'https://play.google.com/store/apps/details?id=app.hiddify.com', icon: Smartphone },
              { name: 'Скачать для Windows (.exe)', url: 'https://github.com/hiddify/hiddify-next/releases/latest/download/Hiddify-Windows-Setup-x64.exe', icon: Monitor },
              { name: 'Скачать для macOS (.dmg)', url: 'https://github.com/hiddify/hiddify-next/releases', icon: Apple }
            ],
            russiaRule: 'Для раздельного обхода РФ: перейдите в «Параметры» (иконка шестерёнки) ➔ выберите «Маршрутизация» ➔ в меню «Режим маршрутизации» переключите на Bypass (Обход локальной сети и РФ).',
            quickImportUrl: subUrl ? `hiddify://import/${subUrl}#izinet` : ''
          },
          happ: {
            name: 'Happ',
            badge: 'iOS Лучший выбор',
            desc: 'Прекрасный лаконичный дизайн специально для Apple iOS с ультра-быстрым переключением узлов и поддержкой VLESS Reality.',
            downloads: [
              { name: 'Скачать из App Store', url: 'https://apps.apple.com/us/app/happ-v2ray-client/id6477161741', icon: Apple }
            ],
            russiaRule: 'Для обхода РФ: перейдите в нижнюю вкладку «Rule» (Правила) на навигационном баре ➔ Выберите режим правил: «Bypass LAN and Russia».',
            quickImportUrl: subUrl ? `happ://import?url=${encodeURIComponent(subUrl)}` : ''
          },
          v2rayng: {
            name: 'v2rayNG',
            badge: 'Android Классика',
            desc: 'Самый популярный и стабильный V2Ray/Xray клиент для Android с поддержкой всех современных транспортов Reality и Vision.',
            downloads: [
              { name: 'Скачать из Google Play', url: 'https://play.google.com/store/apps/details?id=com.v2ray.ang', icon: Smartphone },
              { name: 'Скачать APK напрямую', url: 'https://github.com/2dust/v2rayNG/releases', icon: Smartphone }
            ],
            russiaRule: 'Для обхода РФ: откройте левое меню ➔ выберите «Настройки» ➔ включите «Раздельное туннелирование» ➔ исключите приложения банков, госуслуг и маркетплейсов.',
            quickImportUrl: ''
          },
          amnezia: {
            name: 'AmneziaWG (Роутеры, ТВ & ПК)',
            badge: 'DPI-Bypass • .conf файл',
            desc: 'Обфусцированный протокол на базе WireGuard с маскировкой заголовков (Jc, Jmin, S1, S2, H1-H4). Идеально подходит для роутеров Keenetic, OpenWrt, Mikrotik, Android TV и приложения AmneziaVPN.',
            downloads: [
              { name: 'Скачать для Windows / Mac / Linux', url: 'https://amnezia.org/ru/downloads', icon: Monitor },
              { name: 'Google Play (Android / TV)', url: 'https://play.google.com/store/apps/details?id=org.amnezia.vpn', icon: Smartphone },
              { name: 'App Store (iOS / Mac)', url: 'https://apps.apple.com/app/amnezia-vpn/id1600529900', icon: Apple }
            ],
            russiaRule: 'В роутерах Keenetic/OpenWrt импортируйте скачанный .conf файл в разделе «Другие подключения» (WireGuard / Amnezia) и включите приоритет подключения.',
            quickImportUrl: ''
          }
        }[selectedApp];

        return (
          <Card className="glass-card border-primary/20 p-4 sm:p-5 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-white/5">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-black text-white uppercase tracking-wider">{appDetails.name}</h4>
                  <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0">
                    {appDetails.badge}
                  </Badge>
                </div>
                <p className="text-[11px] md:text-xs text-muted-foreground mt-0.5 leading-normal">{appDetails.desc}</p>
              </div>

              {selectedApp === 'amnezia' && (
                <Button
                  onClick={handleDownloadAwg}
                  className="bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-black font-bold text-xs rounded-xl h-9 gap-1.5 shadow-lg shadow-emerald-500/20 shrink-0"
                >
                  <Download size={14} />
                  <span>Скачать .conf файл</span>
                </Button>
              )}
            </div>

            {/* Ссылки для скачивания */}
            <div className="space-y-2">
              <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest block px-0.5">Ссылки для установки:</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {appDetails.downloads.map((download, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    onClick={() => window.open(download.url, '_blank')}
                    className="rounded-xl border-white/10 hover:bg-white/5 text-xs font-bold h-9.5 gap-2 w-full justify-start px-3.5"
                  >
                    {React.createElement(download.icon, { className: "w-4 h-4 text-primary shrink-0" })}
                    <span className="truncate">{download.name}</span>
                    <ExternalLink size={12} className="ml-auto text-muted-foreground" />
                  </Button>
                ))}
              </div>
            </div>

            {/* Маршрутизация конкретно под выбранное приложение */}
            <div className="p-3.5 bg-black/40 border border-white/5 rounded-xl space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-primary flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5" /> Правило умного обхода блокировок в {appDetails.name}
              </span>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {appDetails.russiaRule}
              </p>
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
