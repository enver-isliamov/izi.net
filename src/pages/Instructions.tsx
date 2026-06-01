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
  const [selectedApp, setSelectedApp] = useState<'incy' | 'hiddify' | 'happ' | 'v2rayng'>('incy');

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
        <p className="text-[11px] md:text-xs text-muted-foreground">Простые краткие шаги до безопасного интернета</p>
      </div>

      {/* Краткая инструкция (Оптимизированная по ширине) */}
      <Card className="glass-card border-white/5 p-3.5 space-y-2.5">
        <h3 className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-primary" /> Понятная инструкция за 30 секунд
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] md:text-xs text-muted-foreground leading-normal pl-0">
          <div className="flex gap-2 p-2 rounded-xl bg-white/[0.01] border border-white/5">
            <span className="text-primary font-black">1.</span>
            <span>Скопируйте VPN-ключ нужного устройства на главной странице приложения.</span>
          </div>
          <div className="flex gap-2 p-2 rounded-xl bg-white/[0.01] border border-white/5">
            <span className="text-primary font-black">2.</span>
            <span>Выберите и скачайте приложение ниже.</span>
          </div>
          <div className="flex gap-2 p-2 rounded-xl bg-white/[0.01] border border-white/5">
            <span className="text-primary font-black">3.</span>
            <span>Импортируйте ключ через **«Добавить» / «+»** и нажмите подключить.</span>
          </div>
        </div>
      </Card>

      {/* Выбор приложения */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-[10px] md:text-xs font-black uppercase tracking-widest text-muted-foreground">Шаг 2. Выберите приложение</h3>
          <Badge variant="outline" className="border-primary/20 text-primary text-[8px] md:text-[9px] uppercase font-bold">4 варианта</Badge>
        </div>

        {/* Элегантные табы-плитки выбора */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { id: 'incy', name: 'INCY', sub: 'Рекомендуем', icon: 'IN', labelIcon: true, platforms: 'iOS & Android' },
            { id: 'hiddify', name: 'Hiddify', sub: 'Мультиплатформа', icon: Globe, labelIcon: false, platforms: 'iOS, Android, PC, Mac' },
            { id: 'happ', name: 'Happ', sub: 'Красивый для iOS', icon: Apple, labelIcon: false, platforms: 'iOS Client' },
            { id: 'v2rayng', name: 'v2rayNG', sub: 'Легкий для Android', icon: Smartphone, labelIcon: false, platforms: 'Android Client' }
          ].map((app) => {
            const isSelected = selectedApp === app.id;
            return (
              <button
                key={app.id}
                onClick={() => setSelectedApp(app.id as any)}
                className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border transition-all text-center relative overflow-hidden ${
                  isSelected 
                    ? 'border-primary bg-primary/[0.02] shadow-[0_0_20px_-10px_rgba(0,255,136,0.15)]' 
                    : 'border-white/5 bg-white/[0.01] hover:border-white/10 hover:bg-white/[0.02]'
                }`}
              >
                {/* Icon wrapper */}
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 shadow ${
                  isSelected ? 'bg-primary text-black' : 'bg-white/5 text-muted-foreground'
                }`}>
                  {app.labelIcon ? (
                    <span className="font-black text-xs tracking-tighter">IN</span>
                  ) : (
                    React.createElement(app.icon as any, { className: "w-4.5 h-4.5" })
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

      {/* Карточка выбранного приложения с авто-кнопками для скачивания */}
      {(() => {
        const appDetails = {
          incy: {
            name: 'INCY',
            badge: 'Рекомендуем',
            desc: 'Наше флагманское официальное приложение. Идеально сбалансировано, не нагружает батарею, содержит автоматический умный обход блокировок и РФ сайтов.',
            downloads: [
              { name: 'App Store (iOS)', url: 'https://apps.apple.com/us/app/incy/id6756943388', icon: Apple },
              { name: 'Google Play (Android)', url: 'https://play.google.com/store/apps/details?id=llc.itdev.incy', icon: Smartphone }
            ],
            russiaRule: 'Обход РФ настроен автоматически с коробки! Российские государственные сервисы, банки (Сбер, Т-банк), Кинопоиск и локальные ресурсы всегда работают напрямую без выключения VPN.'
          },
          hiddify: {
            name: 'Hiddify',
            badge: 'Универсальный клиент',
            desc: 'Отличное мощное приложение с открытым исходным кодом. Имеет встроенные тесты пинга и прекрасно поддерживает раздельный обход трафика.',
            downloads: [
              { name: 'App Store (iOS)', url: 'https://apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532', icon: Apple },
              { name: 'Google Play (Android)', url: 'https://play.google.com/store/apps/details?id=app.hiddify.com', icon: Smartphone },
              { name: 'Скачать для Windows', url: 'https://github.com/hiddify/hiddify-next/releases/latest/download/Hiddify-Windows-Setup-x64.exe', icon: Monitor },
              { name: 'Скачать для macOS', url: 'https://github.com/hiddify/hiddify-next/releases', icon: Apple }
            ],
            russiaRule: 'Для обхода РФ: перейдите в «Параметры» (иконка шестерёнки) ➔ выберите раздел «Маршрутизация» ➔ в меню «Режим маршрутизации» переключите на Bypass (Обход локальной сети и РФ).'
          },
          happ: {
            name: 'Happ',
            badge: 'iOS Лучший выбор',
            desc: 'Прекрасный современный лаконичный дизайн для iOS с очень удобной нативной настройкой умной маршрутизации под Российскую Федерацию.',
            downloads: [
              { name: 'Скачать из App Store', url: 'https://apps.apple.com/us/app/happ-v2ray-client/id6477161741', icon: Apple }
            ],
            russiaRule: 'Для обхода РФ: перейдите в нижнюю вкладку «Rule» (Правила) на навигационном баре ➔ Выберите режим правил: «Bypass LAN and Russia».'
          },
          v2rayng: {
            name: 'v2rayNG',
            badge: 'Android Классика',
            desc: 'Самый популярный и стабильный V2Ray клиент общего пользования со встроенным анализом трафика и полной кастомизацией на Android.',
            downloads: [
              { name: 'Скачать из Google Play', url: 'https://play.google.com/store/apps/details?id=com.v2ray.ang', icon: Smartphone },
              { name: 'Скачать напрямую (APK)', url: 'https://github.com/2dust/v2rayNG/releases', icon: Smartphone }
            ],
            russiaRule: 'Для обхода РФ: откройте левое меню ➔ выберите «Настройки» ➔ включите галочку «Раздельное туннелирование» ➔ найдите системные приложения банков, госуслуг и снимите с них галки.'
          }
        }[selectedApp];

        return (
          <Card className="glass-card border-primary/20 p-4 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-white/5">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-black text-white uppercase tracking-wider">{appDetails.name}</h4>
                  <Badge className="bg-primary/10 text-primary border-primary/10 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0">
                    {appDetails.badge}
                  </Badge>
                </div>
                <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 leading-normal">{appDetails.desc}</p>
              </div>
            </div>

            {/* Ссылки для скачивания (Специально под выбранное приложение) */}
            <div className="space-y-2">
              <span className="text-[9px] font-black uppercase text-muted-foreground tracking-widest block px-0.5">Ссылки для скачивания:</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {appDetails.downloads.map((download, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    onClick={() => window.open(download.url, '_blank')}
                    className="rounded-xl border-border hover:bg-white/5 text-xs font-bold h-9.5 gap-2 w-full justify-start px-3.5"
                  >
                    {React.createElement(download.icon, { className: "w-4 h-4 text-primary shrink-0" })}
                    <span>{download.name}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Маршрутизация конкретно под выбранное приложение */}
            <div className="p-3 bg-white/[0.01] border border-white/5 rounded-xl space-y-1.5">
              <span className="text-[9px] font-black uppercase tracking-wider text-primary flex items-center gap-1.5">
                <Settings className="w-3.5 h-3.5" /> Настройка умного обхода РФ в {appDetails.name}
              </span>
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                {appDetails.russiaRule}
              </p>
            </div>
          </Card>
        );
      })()}

      {/* Траблшутинг для ПК и вылетов */}
      <Card id="troubleshooting-pc-card" className="glass-card border-white/5 p-4 md:p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2.5 border-b border-white/5">
          <div className="w-8 h-8 rounded-lg bg-yellow-500/10 text-yellow-400 flex items-center justify-center shrink-0">
            <Info className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-white leading-none">
              🔧 Решение проблем с вылетами и таймаутами на ПК
            </h3>
            <p className="text-[10px] text-muted-foreground mt-1">Что делать, если VPN периодически зависает или все сервера уходят в таймаут</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-xs text-muted-foreground">
          {/* Пункт 1 */}
          <div className="space-y-1.5 bg-white/[0.01] border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
            <div>
              <span className="font-extrabold text-white text-[11px] block uppercase tracking-wider text-primary">
                1. Отключение IPv6 в клиенте (90% всех сбоев)
              </span>
              <p className="text-[10.5px] leading-relaxed mt-1">
                Домашние провайдеры в РФ часто имеют кривую маршрутизацию IPv6. По умолчанию клиент на ПК пытается грузить сайты (Google, YouTube) по Dual-Stack IPv6. Поскольку трафик идет по IPv6, соединение в один момент "залипает" и уходит в вечный таймаут для всех серверов.
              </p>
            </div>
            <div className="text-[10px] bg-white/5 px-2.5 py-1.5 rounded-lg text-white mt-2 border border-white/5 leading-snug">
              👉 <span className="text-primary font-bold">Решение:</span> В клиенте <span className="font-bold">Hiddify на ПК</span> зайдите в <span className="text-primary font-bold">Настройки (шестерёнка) ➔ Конфигурация ➔ выключите "Включить IPv6" (Enable IPv6)</span> и перезапустите VPN.
            </div>
          </div>

          {/* Пункт 2 */}
          <div className="space-y-1.5 bg-white/[0.01] border border-white/5 rounded-xl p-3.5 flex flex-col justify-between">
            <div>
              <span className="font-extrabold text-white text-[11px] block uppercase tracking-wider text-primary">
                2. Фрагментация пакетов (Обход DPI провайдера)
              </span>
              <p className="text-[10.5px] leading-relaxed mt-1">
                Проводные домашние провайдеры используют системы глубокого анализа пакетов (DPI), которые вычисляют заголовок TLS ClientHello протокола VLESS и искусственно отбрасывают TCP-пакеты, вызывая сбой и зависание связи.
              </p>
            </div>
            <div className="text-[10px] bg-white/5 px-2.5 py-1.5 rounded-lg text-white mt-2 border border-white/5 leading-snug">
              👉 <span className="text-primary font-bold">Решение:</span> В <span className="font-bold">Hiddify на ПК</span> перейдите в <span className="text-primary font-bold">Параметры ➔ Конфигурация ➔ включите тумблер "Фрагмент" (Fragment)</span>. Это разбивает пакеты, полностью ослепляя DPI провайдера.
            </div>
          </div>

          {/* Пункт 3 */}
          <div className="space-y-1.5 bg-white/[0.01] border border-white/5 rounded-xl p-3.5">
            <span className="font-extrabold text-white text-[11px] block uppercase tracking-wider text-primary">
              3. Конфликты с антивирусами (Kaspersky, Defender, Avast)
            </span>
            <p className="text-[10.5px] leading-relaxed mt-1">
              Сторонние антивирусы часто пытаются прослушивать или сканировать зашифрованный SSL/TLS трафик (MITM). Протокол <span className="font-bold">VLESS Reality</span> мгновенно замечает подделку сертификата в целях безопасности и аварийно обрывает сессию, из-за чего все узлы в таблице уходят в таймаут.
            </p>
            <p className="text-[10.5px] leading-relaxed">
              👉 <span className="text-primary font-bold">Решение:</span> Добавьте <span className="font-bold">Hiddify.exe</span> и <span className="font-bold">xray.exe</span> в белый список исключений вашего файрвола, либо временно отключите "Сканирование защищенных соединений HTTPS".
            </p>
          </div>

          {/* Пункт 4 */}
          <div className="space-y-1.5 bg-white/[0.01] border border-white/5 rounded-xl p-3.5">
            <span className="font-extrabold text-white text-[11px] block uppercase tracking-wider text-primary">
              4. Застревание Системного Прокси или TUN-режима
            </span>
            <p className="text-[10.5px] leading-relaxed mt-1">
              При выходе ПК из спящего режима операционная система может заблокировать сетевой стек, из-за чего VPN перестает реагировать на пинги и ломает обычный интернет во всей системе.
            </p>
            <p className="text-[10.5px] leading-relaxed">
              👉 <span className="text-primary font-bold">Решение:</span> В Hiddify попробуйте сменить <span className="text-primary font-bold">"Режим работы"</span> с "Системный прокси" (System Proxy) на <span className="text-primary font-bold">"TUN"</span>. Режим TUN работает на уровне виртуальной сетевой карты, не сбивает прокси реестра Windows и работает в разы стабильнее.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

