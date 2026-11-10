import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Shield,
  Zap,
  Globe,
  Lock,
  ArrowRight,
  Check,
  Server,
  Smartphone,
  Laptop,
  Tv,
  Router,
  Play,
  ChevronDown,
  Sparkles,
  ExternalLink,
  Activity,
  Layers,
  HeartHandshake
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAppConfig } from '@/hooks/useAppConfig';

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { telegramBotName } = useAppConfig();

  // Pricing device tab: '1' | '2' | 'unlimited'
  const [deviceTab, setDeviceTab] = useState<'1' | '2' | 'unlimited'>('1');
  // FAQ accordion open index
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const botUsername = telegramBotName || 'izinet_bot';
  const botLink = `https://t.me/${botUsername}`;

  const handleCTA = (mode: 'login' | 'register' = 'register') => {
    if (user) {
      navigate('/dashboard');
    } else {
      navigate(`/login?mode=${mode}`);
    }
  };

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  // Pricing tiers based on selected device tab
  const plansData = {
    '1': [
      {
        id: '1m',
        name: '1 месяц',
        period: 'за весь срок · 30 дней',
        price: '99',
        monthly: '≈ 99 ₽ в месяц',
        badge: null,
        featured: false,
        note: 'Идеально для теста'
      },
      {
        id: '3m',
        name: '3 месяца',
        period: 'за весь срок · 90 дней',
        price: '269',
        monthly: '≈ 89 ₽ в месяц',
        badge: 'Выгодно',
        featured: false,
        note: 'Скидка 10%'
      },
      {
        id: '6m',
        name: '6 месяцев',
        period: 'за весь срок · 180 дней',
        price: '499',
        monthly: '≈ 83 ₽ в месяц',
        badge: 'Хит продаж',
        featured: true,
        note: 'Оптимальный выбор'
      },
      {
        id: '12m',
        name: '1 год',
        period: 'за весь срок · 365 дней',
        price: '899',
        monthly: '≈ 74 ₽ в месяц',
        badge: '–40% выгода',
        featured: false,
        note: 'Максимальная экономия'
      }
    ],
    '2': [
      {
        id: '1m',
        name: '1 месяц',
        period: 'за весь срок · 30 дней',
        price: '169',
        monthly: '≈ 169 ₽ в месяц',
        badge: null,
        featured: false,
        note: 'Для смартфона и ноутбука'
      },
      {
        id: '3m',
        name: '3 месяца',
        period: 'за весь срок · 90 дней',
        price: '449',
        monthly: '≈ 149 ₽ в месяц',
        badge: 'Выгодно',
        featured: false,
        note: 'Скидка 12%'
      },
      {
        id: '6m',
        name: '6 месяцев',
        period: 'за весь срок · 180 дней',
        price: '799',
        monthly: '≈ 133 ₽ в месяц',
        badge: 'Хит продаж',
        featured: true,
        note: 'Два устройства всегда онлайн'
      },
      {
        id: '12m',
        name: '1 год',
        period: 'за весь срок · 365 дней',
        price: '1 490',
        monthly: '≈ 124 ₽ в месяц',
        badge: '–40% выгода',
        featured: false,
        note: 'Годовой доступ на 2 гаджета'
      }
    ],
    'unlimited': [
      {
        id: '1m',
        name: '1 месяц',
        period: 'за весь срок · 30 дней',
        price: '299',
        monthly: '≈ 299 ₽ в месяц',
        badge: null,
        featured: false,
        note: 'Для всей семьи или роутера'
      },
      {
        id: '3m',
        name: '3 месяца',
        period: 'за весь срок · 90 дней',
        price: '799',
        monthly: '≈ 266 ₽ в месяц',
        badge: 'Выгодно',
        featured: false,
        note: 'Скидка 15%'
      },
      {
        id: '6m',
        name: '6 месяцев',
        period: 'за весь срок · 180 дней',
        price: '1 490',
        monthly: '≈ 248 ₽ в месяц',
        badge: 'Хит продаж',
        featured: true,
        note: 'Сеть без ограничений'
      },
      {
        id: '12m',
        name: '1 год',
        period: 'за весь срок · 365 дней',
        price: '2 690',
        monthly: '≈ 224 ₽ в месяц',
        badge: '–45% выгода',
        featured: false,
        note: 'Полный безлимит на 12 месяцев'
      }
    ]
  };

  const faqItems = [
    {
      q: 'Как начать пользоваться VPN?',
      a: 'Нажмите «Попробовать бесплатно» или запустите нашего Telegram-бота. После быстрой регистрации вы мгновенно получите персональную ссылку подписки. Скопируйте её и вставьте в любое поддерживаемое приложение (Hiddify, Happ, v2rayN).'
    },
    {
      q: 'Как работает пробный доступ?',
      a: 'Каждому новому пользователю автоматически начисляется 3 дня бесплатного доступа с полной скоростью и всеми локациями. Привязывать банковскую карту не требуется. По окончании пробного периода вы сами решите, продлевать ли доступ.'
    },
    {
      q: 'Какие приложения и платформы поддерживаются?',
      a: 'Мы поддерживаем все популярные клиенты: Hiddify, Happ, v2rayN/v2rayNG, Streisand, Sing-box, а также AmneziaWG для роутеров Keenetic, OpenWrt и Android TV. В личном кабинете доступны пошаговые инструкции в картинках для каждой системы.'
    },
    {
      q: 'Будут ли работать российские сайты (банки, Госуслуги)?',
      a: 'Да! В наши конфигурации встроена умная маршрутизация: сайты банков (Сбер, Т-Банк, ВТБ), Госуслуги, доставка и маркетплейсы открываются напрямую на полной скорости вашего провайдера. Выключать VPN больше не нужно.'
    },
    {
      q: 'Как оплатить подписку из России?',
      a: 'Мы принимаем карты любых российских банков (Мир, Visa, Mastercard), СБП (Система быстрых платежей), а также криптовалюту. Оплата проходит через защищённый платёжный шлюз без комиссии и зачисляется моментально.'
    },
    {
      q: 'Что делать, если возникнут трудности с подключением?',
      a: 'Наша служба заботы работает каждый день. Напишите напрямую в Telegram-поддержку или создайте тикет в личном кабинете — мы подскажем, какое приложение лучше выбрать, и поможем настроить всё за 2 минуты.'
    }
  ];

  return (
    <div className="min-h-screen bg-[#06080c] text-[#f1f4f7] font-sans selection:bg-[#7bdcff]/30 selection:text-white flex flex-col relative overflow-x-hidden">
      {/* Ambient background glow */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] bg-[radial-gradient(ellipse_at_top,rgba(13,23,34,0.7)_0%,transparent_65%)]" />
        <div className="absolute top-[30%] right-[-10%] w-[500px] h-[500px] bg-[radial-gradient(circle,rgba(123,220,255,0.04)_0%,transparent_70%)] blur-[90px]" />
        <div className="absolute top-[60%] left-[-10%] w-[500px] h-[500px] bg-[radial-gradient(circle,rgba(80,180,255,0.03)_0%,transparent_70%)] blur-[90px]" />
      </div>

      {/* 1. Header (Floating glass pill like OxyVPN) */}
      <header className="relative z-30 max-w-6xl mx-auto w-[calc(100%-32px)] my-4 px-4 sm:px-6 py-3 border border-white/10 rounded-full bg-[#10151b]/85 backdrop-blur-xl shadow-[0_10px_36px_rgba(0,0,0,0.5)] flex items-center justify-between gap-4">
        {/* Brand */}
        <a href="/" className="inline-flex items-center gap-2.5 group">
          <div className="relative w-7 h-7 rounded-full border border-cyan-400/60 shadow-[0_0_12px_rgba(123,220,255,0.35)] flex items-center justify-center bg-cyan-950/30 group-hover:border-cyan-300 transition-colors">
            <span className="w-2 h-2 rounded-full bg-[#8be5f0] shadow-[0_0_8px_#6ae6ff]" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">
            izi<span className="text-[#7bdcff]">net</span>
          </span>
        </a>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-7 text-[13px] font-medium text-[#8d959f]">
          <a href="#how" className="hover:text-white transition-colors">Как подключиться</a>
          <a href="#plans" className="hover:text-white transition-colors">Тарифы</a>
          <a href="#features" className="hover:text-white transition-colors">Преимущества</a>
          <a href="#partners" className="hover:text-white transition-colors">Партнёрам</a>
          <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
        </nav>

        {/* Header Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href={botLink}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 text-[13px] font-medium text-[#8d959f] hover:text-[#7bdcff] transition-colors px-3 py-1.5"
          >
            Telegram-бот <ExternalLink className="w-3.5 h-3.5 opacity-70" />
          </a>

          {user ? (
            <Button
              onClick={() => navigate('/dashboard')}
              className="bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold text-xs sm:text-[13px] h-9 px-4 sm:px-5 rounded-full shadow-[0_0_20px_rgba(123,220,255,0.25)] hover:shadow-[0_0_30px_rgba(123,220,255,0.4)] transition-all"
            >
              В кабинет
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => handleCTA('login')}
                className="text-xs sm:text-[13px] text-[#8d959f] hover:text-white h-9 px-3 rounded-full hidden sm:flex"
              >
                Вход
              </Button>
              <Button
                onClick={() => handleCTA('register')}
                className="bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold text-xs sm:text-[13px] h-9 px-4 sm:px-5 rounded-full shadow-[0_2px_1px_rgba(255,255,255,0.2)_inset,0_2px_10px_rgba(0,0,0,0.4)] hover:shadow-[0_0_25px_rgba(123,220,255,0.35)] hover:-translate-y-0.5 transition-all"
              >
                Попробовать
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 relative z-10">
        {/* 2. Hero Section */}
        <section className="relative pt-12 pb-20 sm:pt-20 sm:pb-32 px-4 text-center max-w-5xl mx-auto">
          {/* Top Pill */}
          <div className="inline-flex items-center mb-8">
            <a
              href="#plans"
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-cyan-500/25 bg-gradient-to-r from-cyan-950/40 via-[#101823]/80 to-slate-900/60 text-xs text-[#c2dce6] shadow-[inset_0_1px_rgba(255,255,255,0.08)] hover:border-cyan-400/50 hover:shadow-[0_0_20px_rgba(123,220,255,0.2)] transition-all"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#8be5f0] shadow-[0_0_8px_#6ae6ff] animate-pulse" />
              <span>3 дня бесплатно для новых пользователей</span>
              <ArrowRight className="w-3.5 h-3.5 text-cyan-300 ml-0.5" />
            </a>
          </div>

          {/* Kicker */}
          <p className="text-[11px] font-semibold tracking-[0.22em] text-[#8d959f] uppercase mb-4">
            VPN ДЛЯ ТЕЛЕФОНА И КОМПЬЮТЕРА
          </p>

          {/* Title with sleek silver-to-cyan gradient */}
          <h1 className="text-4xl sm:text-6xl md:text-7xl font-semibold tracking-[-0.04em] text-[#f1f4f7] leading-[1.08] mb-6 max-w-4xl mx-auto">
            Больше свободы.<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#b4bcca] via-[#e0f3fa] to-[#7bdcff]">
              Меньше настроек.
            </span>
          </h1>

          {/* Description */}
          <p className="text-base sm:text-lg text-[#8d959f] max-w-xl mx-auto leading-relaxed mb-9">
            Быстрый и защищённый VPN для привычных дел. Подключайтесь в 2 клика без сложных инструкций и оставайтесь на связи при любых блокировках.
          </p>

          {/* Hero Actions */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 max-w-md mx-auto mb-4">
            <Button
              onClick={() => handleCTA('register')}
              className="w-full sm:w-auto min-h-[50px] px-8 rounded-xl bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold text-[15px] shadow-[0_2px_1px_rgba(255,255,255,0.3)_inset,0_4px_16px_rgba(0,0,0,0.5)] hover:shadow-[0_0_30px_rgba(176,232,255,0.4)] hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2"
            >
              Попробовать бесплатно
              <ArrowRight className="w-4 h-4" />
            </Button>
            <a
              href="#plans"
              className="w-full sm:w-auto min-h-[50px] px-7 rounded-xl bg-[#0e141b]/70 border border-white/10 text-[#d6dce4] font-medium text-[15px] hover:bg-[#19232c] hover:border-white/20 transition-all flex items-center justify-center"
            >
              Посмотреть тарифы
            </a>
          </div>

          <p className="text-[12px] text-[#59636f]">
            3 дня бесплатно для новых пользователей · Без привязки карты
          </p>

          {/* Floating Badges (Desktop & Tablet) */}
          <div className="relative mt-12 max-w-4xl mx-auto hidden md:block h-20 pointer-events-none">
            <div className="absolute left-4 top-2 flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#0c1016]/80 border border-white/10 text-xs text-[#a5adb8] backdrop-blur-md shadow-[0_10px_30px_rgba(0,0,0,0.5)] animate-in fade-in duration-700">
              <Shield className="w-3.5 h-3.5 text-[#7bdcff]" />
              Защищённое соединение
            </div>
            <div className="absolute right-4 top-2 flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#0c1016]/80 border border-white/10 text-xs text-[#a5adb8] backdrop-blur-md shadow-[0_10px_30px_rgba(0,0,0,0.5)] animate-in fade-in duration-700">
              <Laptop className="w-3.5 h-3.5 text-[#7bdcff]" />
              Ваши любимые устройства
            </div>
            <div className="absolute left-1/4 bottom-0 flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#0c1016]/80 border border-white/10 text-xs text-[#a5adb8] backdrop-blur-md shadow-[0_10px_30px_rgba(0,0,0,0.5)] animate-in fade-in duration-700">
              <Zap className="w-3.5 h-3.5 text-[#7bdcff]" />
              Без блокировок и сбоев
            </div>
            <div className="absolute right-1/4 bottom-0 flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#0c1016]/80 border border-white/10 text-xs text-[#a5adb8] backdrop-blur-md shadow-[0_10px_30px_rgba(0,0,0,0.5)] animate-in fade-in duration-700">
              <Play className="w-3.5 h-3.5 text-[#7bdcff]" />
              YouTube 4K & Соцсети
            </div>
          </div>
        </section>

        {/* 3. Platform Strip */}
        <section className="border-y border-white/[0.07] bg-[#090d13]/60 py-6 px-4">
          <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
            <span className="text-xs uppercase tracking-wider text-[#8d959f] font-semibold">
              Подходит для ваших устройств:
            </span>
            <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-8 text-sm font-medium text-[#c2dce6]">
              <div className="flex items-center gap-2 hover:text-white transition-colors">
                <Smartphone className="w-4 h-4 text-[#7bdcff]" /> iOS & iPhone
              </div>
              <div className="flex items-center gap-2 hover:text-white transition-colors">
                <Smartphone className="w-4 h-4 text-[#7bdcff]" /> Android
              </div>
              <div className="flex items-center gap-2 hover:text-white transition-colors">
                <Laptop className="w-4 h-4 text-[#7bdcff]" /> Windows & macOS
              </div>
              <div className="flex items-center gap-2 hover:text-white transition-colors">
                <Tv className="w-4 h-4 text-[#7bdcff]" /> Android TV
              </div>
              <div className="flex items-center gap-2 hover:text-white transition-colors">
                <Router className="w-4 h-4 text-[#7bdcff]" /> Роутеры
              </div>
            </div>
          </div>
        </section>

        {/* 4. Features Bento Grid ("Всё нужное. Ничего сложного.") */}
        <section id="features" className="py-24 px-4 max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-[#7bdcff] uppercase mb-3">
              УМНЫЕ ТЕХНОЛОГИИ
            </p>
            <h2 className="text-3xl sm:text-5xl font-medium tracking-tight text-white mb-4">
              Всё нужное.<br />
              <span className="text-[#87909c]">Ничего сложного.</span>
            </h2>
            <p className="text-[#8d959f] text-sm sm:text-base max-w-lg mx-auto">
              Сетевая архитектура, созданная специально для бесперебойной работы в условиях жестких интернет-блокировок.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Bento Card 1: Wide Card with visual route map */}
            <div className="md:col-span-2 rounded-3xl border border-white/10 bg-gradient-to-b from-[#0f141c] to-[#0a0e14] p-7 sm:p-9 relative overflow-hidden flex flex-col justify-between group hover:border-cyan-500/30 transition-all">
              <div className="relative z-10">
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-[#7bdcff] mb-6">
                  <Activity className="w-5 h-5" />
                </div>
                <h3 className="text-xl sm:text-2xl font-medium text-white mb-3 tracking-tight">
                  Стабильное соединение даже в сложных условиях
                </h3>
                <p className="text-[#8d959f] text-sm leading-relaxed max-w-lg">
                  Передовые протоколы VLESS с маскировкой под обычный веб-трафик и резервные европейские Anycast CDN-узлы. Если провайдер пытается замедлить связь — система сохраняет скорость без разрывов.
                </p>
              </div>

              {/* Visual route indicator badge */}
              <div className="mt-8 pt-6 border-t border-white/5 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-zinc-300 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Москва
                  </span>
                  <span className="text-zinc-600">➔</span>
                  <span className="flex items-center gap-1.5 text-cyan-300 bg-cyan-950/40 px-2.5 py-1 rounded-lg border border-cyan-500/20">
                    <Shield className="w-3 h-3" />
                    Защищённый туннель
                  </span>
                  <span className="text-zinc-600">➔</span>
                  <span className="flex items-center gap-1.5 text-zinc-300 bg-white/5 px-2.5 py-1 rounded-lg border border-white/10">
                    <Globe className="w-3 h-3" />
                    Амстердам
                  </span>
                </div>
                <span className="text-[#7bdcff] bg-[#7bdcff]/10 px-2.5 py-1 rounded-lg border border-[#7bdcff]/20">
                  Пинг: 34 мс · Без потерь
                </span>
              </div>
            </div>

            {/* Bento Card 2: Privacy */}
            <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-[#0f141c] to-[#0a0e14] p-7 sm:p-9 flex flex-col justify-between group hover:border-cyan-500/30 transition-all">
              <div>
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-[#7bdcff] mb-6">
                  <Lock className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-medium text-white mb-3 tracking-tight">
                  Без логов и слежки
                </h3>
                <p className="text-[#8d959f] text-sm leading-relaxed">
                  Мы принципиально не ведём журналы посещений, не сохраняем DNS-запросы и не продаем данные. Ваша онлайн-жизнь остаётся исключительно вашей.
                </p>
              </div>
              <div className="mt-8 text-xs text-emerald-400 flex items-center gap-1.5 font-medium">
                <Check className="w-4 h-4" /> 100% анонимность гарантирована
              </div>
            </div>

            {/* Bento Card 3: 4K YouTube & Streaming */}
            <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-[#0f141c] to-[#0a0e14] p-7 sm:p-9 flex flex-col justify-between group hover:border-cyan-500/30 transition-all">
              <div>
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-[#7bdcff] mb-6">
                  <Play className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-medium text-white mb-3 tracking-tight">
                  YouTube в 4K и любимые сервисы
                </h3>
                <p className="text-[#8d959f] text-sm leading-relaxed">
                  Забудьте про вечное колесо загрузки. Instagram, YouTube в высоком качестве, ChatGPT, Discord, TikTok и Spotify работают плавно и на полной скорости.
                </p>
              </div>
              <div className="mt-8 text-xs text-zinc-400 flex items-center gap-1.5">
                <Server className="w-4 h-4 text-[#7bdcff]" /> Каналы 10 Гбит/с в Нидерландах и Германии
              </div>
            </div>

            {/* Bento Card 4: Smart Routing (Wide Card) */}
            <div className="md:col-span-2 rounded-3xl border border-white/10 bg-gradient-to-b from-[#0f141c] to-[#0a0e14] p-7 sm:p-9 flex flex-col justify-between group hover:border-cyan-500/30 transition-all">
              <div>
                <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-[#7bdcff] mb-6">
                  <Layers className="w-5 h-5" />
                </div>
                <h3 className="text-xl sm:text-2xl font-medium text-white mb-3 tracking-tight">
                  Умное разделение трафика для российских сервисов
                </h3>
                <p className="text-[#8d959f] text-sm leading-relaxed max-w-xl">
                  Больше не нужно постоянно включать и выключать VPN. Российские банки (Сбер, Т-Банк, ВТБ), Госуслуги, маркетплейсы (Ozon, Wildberries) и доставка открываются напрямую на максимальной скорости вашего домашнего или мобильного провайдера.
                </p>
              </div>
              <div className="mt-8 pt-6 border-t border-white/5 flex flex-wrap items-center gap-3 text-xs text-[#8d959f]">
                <span className="px-2.5 py-1 rounded bg-white/5 border border-white/10 text-zinc-300">Госуслуги</span>
                <span className="px-2.5 py-1 rounded bg-white/5 border border-white/10 text-zinc-300">Банки РФ</span>
                <span className="px-2.5 py-1 rounded bg-white/5 border border-white/10 text-zinc-300">Кинопоиск</span>
                <span className="px-2.5 py-1 rounded bg-white/5 border border-white/10 text-zinc-300">Доставка</span>
                <span className="text-emerald-400 ml-auto font-medium">✓ Работают без выключения VPN</span>
              </div>
            </div>
          </div>
        </section>

        {/* 5. How it works ("Начать проще, чем кажется") */}
        <section id="how" className="py-24 px-4 border-t border-white/5 bg-[#080c12]/50">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-[#7bdcff] uppercase mb-3">
                БЫСТРЫЙ СТАРТ
              </p>
              <h2 className="text-3xl sm:text-5xl font-medium tracking-tight text-white mb-4">
                Начать проще,<br />
                <span className="text-[#87909c]">чем кажется.</span>
              </h2>
              <p className="text-[#8d959f] text-sm sm:text-base max-w-lg mx-auto">
                Всего три шага отделяют вас от быстрого и свободного интернета.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
              {/* Steps list */}
              <div className="space-y-8">
                <div className="flex items-start gap-5">
                  <div className="w-11 h-11 rounded-2xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center font-bold text-lg text-[#7bdcff] shrink-0">
                    1
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-white mb-1.5">
                      Запустите бота или зарегистрируйтесь
                    </h3>
                    <p className="text-sm text-[#8d959f] leading-relaxed">
                      Откройте нашего Telegram-бота или создайте аккаунт на сайте в один клик. 3 дня пробного периода активируются сразу.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-5">
                  <div className="w-11 h-11 rounded-2xl bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center font-bold text-lg text-[#7bdcff] shrink-0">
                    2
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-white mb-1.5">
                      Скопируйте персональный ключ
                    </h3>
                    <p className="text-sm text-[#8d959f] leading-relaxed">
                      Нажмите одну кнопку — ссылка подписки скопируется в буфер обмена. Она содержит актуальные рабочие серверы.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-5">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-400 to-cyan-600 shadow-[0_0_20px_rgba(123,220,255,0.4)] flex items-center justify-center font-bold text-lg text-[#06080c] shrink-0">
                    3
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-white mb-1.5">
                      Вставьте в приложение и подключитесь
                    </h3>
                    <p className="text-sm text-[#8d959f] leading-relaxed">
                      Откройте Hiddify, Happ или v2rayN, добавьте ключ из буфера и нажмите кнопку «Подключить». Готово!
                    </p>
                  </div>
                </div>

                <div className="pt-4">
                  <Button
                    onClick={() => handleCTA('register')}
                    className="bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold h-12 px-7 rounded-xl hover:shadow-[0_0_25px_rgba(176,232,255,0.35)] hover:-translate-y-0.5 transition-all"
                  >
                    Подключиться за 2 минуты <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>

              {/* Interactive Mock Window (Hiddify/Oxy-style demo card) */}
              <div className="relative mx-auto w-full max-w-md">
                <div className="rounded-3xl border border-white/10 bg-[#0d1218]/90 p-6 sm:p-8 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] relative overflow-hidden">
                  {/* Glowing header badge */}
                  <div className="flex items-center justify-between pb-6 border-b border-white/5 mb-6">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
                      <span className="text-xs font-mono font-medium text-emerald-400 tracking-wider">
                        ПОДКЛЮЧЕНО
                      </span>
                    </div>
                    <span className="text-xs text-[#8d959f] font-mono">izinet v2.4</span>
                  </div>

                  {/* Big Connection Button */}
                  <div className="py-6 flex flex-col items-center justify-center text-center">
                    <div className="relative w-28 h-28 rounded-full border border-cyan-400/30 bg-gradient-to-b from-cyan-950/40 to-slate-900/60 flex items-center justify-center shadow-[0_0_40px_rgba(123,220,255,0.25)] mb-5">
                      <div className="w-20 h-20 rounded-full bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] flex items-center justify-center shadow-lg">
                        <Shield className="w-9 h-9 text-[#0c1117]" />
                      </div>
                    </div>
                    <h4 className="text-lg font-medium text-white mb-1">Нидерланды (Амстердам)</h4>
                    <p className="text-xs text-[#8d959f]">VLESS TLS • Cloudflare Anycast</p>
                  </div>

                  {/* Metrics bar */}
                  <div className="grid grid-cols-2 gap-3 pt-6 border-t border-white/5 text-left">
                    <div className="bg-white/[0.03] p-3 rounded-xl border border-white/5">
                      <span className="text-[11px] text-[#59636f] block mb-1">Скорость загрузки</span>
                      <span className="text-sm font-mono font-semibold text-white">124.8 Мбит/с</span>
                    </div>
                    <div className="bg-white/[0.03] p-3 rounded-xl border border-white/5">
                      <span className="text-[11px] text-[#59636f] block mb-1">Задержка (пинг)</span>
                      <span className="text-sm font-mono font-semibold text-[#7bdcff]">32 мс</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 6. Pricing Section ("Подписка, которая подходит именно вам.") */}
        <section id="plans" className="py-24 px-4 max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-[#7bdcff] uppercase mb-3">
              ВАШИ УСТРОЙСТВА. ВАШ ВЫБОР.
            </p>
            <h2 className="text-3xl sm:text-5xl font-medium tracking-tight text-white mb-4">
              Подписка, которая<br />
              <span className="text-[#87909c]">подходит именно вам.</span>
            </h2>
            <p className="text-[#8d959f] text-sm sm:text-base max-w-lg mx-auto">
              Выберите количество устройств и период. Цена в карточке — за весь срок.
            </p>
          </div>

          {/* Device Tabs */}
          <div className="flex justify-center mb-12">
            <div className="inline-flex p-1.5 rounded-full border border-white/10 bg-[#0e141b]/80 backdrop-blur-md">
              <button
                type="button"
                onClick={() => setDeviceTab('1')}
                className={`px-5 py-2 rounded-full text-xs sm:text-sm font-medium transition-all ${
                  deviceTab === '1'
                    ? 'bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] shadow-md font-semibold'
                    : 'text-[#8d959f] hover:text-white'
                }`}
              >
                1 устройство
              </button>
              <button
                type="button"
                onClick={() => setDeviceTab('2')}
                className={`px-5 py-2 rounded-full text-xs sm:text-sm font-medium transition-all ${
                  deviceTab === '2'
                    ? 'bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] shadow-md font-semibold'
                    : 'text-[#8d959f] hover:text-white'
                }`}
              >
                2 устройства
              </button>
              <button
                type="button"
                onClick={() => setDeviceTab('unlimited')}
                className={`px-5 py-2 rounded-full text-xs sm:text-sm font-medium transition-all ${
                  deviceTab === 'unlimited'
                    ? 'bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] shadow-md font-semibold'
                    : 'text-[#8d959f] hover:text-white'
                }`}
              >
                Безлимит устройств
              </button>
            </div>
          </div>

          {/* Plan Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {plansData[deviceTab].map((plan) => (
              <div
                key={plan.id}
                className={`rounded-3xl p-6 sm:p-7 flex flex-col justify-between transition-all relative ${
                  plan.featured
                    ? 'border-2 border-cyan-400/50 bg-gradient-to-b from-[#111924] to-[#0a0f16] shadow-[0_0_35px_rgba(123,220,255,0.18)] -translate-y-1'
                    : 'border border-white/10 bg-gradient-to-b from-[#0f141c] to-[#090d13] hover:border-white/20'
                }`}
              >
                {/* Header & Badge */}
                <div>
                  <div className="flex items-center justify-between min-h-[28px] mb-4">
                    <h3 className="text-lg font-semibold text-white tracking-tight">{plan.name}</h3>
                    {plan.badge && (
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-cyan-400/15 text-[#7bdcff] border border-cyan-400/30">
                        {plan.badge}
                      </span>
                    )}
                  </div>

                  {/* Price */}
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-4xl sm:text-5xl font-bold tracking-tight text-white">{plan.price}</span>
                    <span className="text-xl font-medium text-[#8d959f]">₽</span>
                  </div>
                  <p className="text-xs text-[#59636f] mb-3">{plan.period}</p>
                  <p className="text-xs text-[#7bdcff] font-medium min-h-[18px] mb-6">{plan.monthly}</p>

                  {/* CTA button inside card */}
                  <Button
                    onClick={() => handleCTA('register')}
                    className={`w-full h-11 rounded-xl text-sm font-semibold transition-all mb-6 ${
                      plan.featured
                        ? 'bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] shadow-[0_2px_10px_rgba(0,0,0,0.4)] hover:shadow-[0_0_25px_rgba(176,232,255,0.4)]'
                        : 'bg-[#151c25] hover:bg-[#1d2733] text-white border border-white/10'
                    }`}
                  >
                    Выбрать тариф
                  </Button>

                  {/* Features list */}
                  <ul className="space-y-3 pt-6 border-t border-white/5 text-xs text-[#8d959f]">
                    <li className="flex items-center gap-2.5">
                      <Check className="w-3.5 h-3.5 text-[#7bdcff] shrink-0" />
                      <span>Безлимитный трафик и скорость</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Check className="w-3.5 h-3.5 text-[#7bdcff] shrink-0" />
                      <span>Все серверы и протоколы (VLESS, AmneziaWG)</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Check className="w-3.5 h-3.5 text-[#7bdcff] shrink-0" />
                      <span>Умная маршрутизация РФ-сервисов</span>
                    </li>
                    <li className="flex items-center gap-2.5">
                      <Check className="w-3.5 h-3.5 text-[#7bdcff] shrink-0" />
                      <span>Поддержка в Telegram 24/7</span>
                    </li>
                  </ul>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-[#59636f] mt-8">
            Оплата картами РФ (Мир, Visa, Mastercard), СБП или криптовалютой. Моментальная активация.
          </p>
        </section>

        {/* 7. Partner / Affiliate Section ("Рекомендуйте izinet. Получайте вознаграждение.") */}
        <section id="partners" className="py-20 px-4 border-y border-white/5 bg-[#090d13]/70">
          <div className="max-w-5xl mx-auto rounded-3xl border border-white/10 bg-gradient-to-b from-[#101722] to-[#0b0f16] p-8 sm:p-12 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="max-w-xl text-center md:text-left">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-[#7bdcff] uppercase mb-2">
                ПАРТНЁРСКАЯ ПРОГРАММА
              </p>
              <h2 className="text-2xl sm:text-4xl font-medium tracking-tight text-white mb-3">
                Рекомендуйте izinet.<br />
                <span className="text-[#87909c]">Получайте вознаграждение.</span>
              </h2>
              <p className="text-sm text-[#8d959f] leading-relaxed mb-6">
                Делитесь персональной ссылкой с друзьями, подписчиками или коллегами. Получайте до 25% от каждой оплаты приглашённого пользователя на баланс или вывод на карту.
              </p>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <Button
                  onClick={() => (user ? navigate('/referrals') : handleCTA('register'))}
                  className="bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold h-11 px-6 rounded-xl hover:shadow-[0_0_25px_rgba(176,232,255,0.35)] transition-all"
                >
                  Зарабатывать с izinet <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <a
                  href={botLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[#8d959f] hover:text-white transition-colors py-2 px-3"
                >
                  Условия в боте →
                </a>
              </div>
            </div>

            {/* Visual Icon */}
            <div className="shrink-0 w-36 h-36 rounded-full border border-cyan-400/20 bg-cyan-950/20 flex items-center justify-center shadow-[0_0_40px_rgba(123,220,255,0.15)]">
              <HeartHandshake className="w-16 h-16 text-[#7bdcff]" />
            </div>
          </div>
        </section>

        {/* 8. FAQ Section */}
        <section id="faq" className="py-24 px-4 max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-[#7bdcff] uppercase mb-3">
              ВСЁ ПО ПОЛОЧКАМ
            </p>
            <h2 className="text-3xl sm:text-5xl font-medium tracking-tight text-white mb-4">
              Остались<br />
              <span className="text-[#87909c]">вопросы?</span>
            </h2>
            <p className="text-[#8d959f] text-sm sm:text-base max-w-lg mx-auto">
              Собрали ответы на самые частые вопросы. Если вашего нет — наша поддержка всегда рядом.
            </p>
          </div>

          <div className="space-y-3">
            {faqItems.map((item, index) => {
              const isOpen = openFaq === index;
              return (
                <div
                  key={index}
                  className="rounded-2xl border border-white/10 bg-[#0c1016]/80 overflow-hidden transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => toggleFaq(index)}
                    className="w-full p-5 sm:p-6 text-left flex items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="text-base font-medium text-white">{item.q}</span>
                    <ChevronDown
                      className={`w-4 h-4 text-[#8d959f] shrink-0 transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-[#7bdcff]' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-6 sm:px-6 text-sm text-[#8d959f] leading-relaxed border-t border-white/5 pt-4">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-10 text-center">
            <a
              href={botLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[#7bdcff] hover:underline"
            >
              Задать свой вопрос поддержке в Telegram <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </section>

        {/* 9. Closing Section */}
        <section className="py-24 px-4 text-center max-w-4xl mx-auto border-t border-white/5 relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-[radial-gradient(ellipse,rgba(123,220,255,0.08)_0%,transparent_70%)] pointer-events-none" />

          <p className="text-[11px] font-semibold tracking-[0.2em] text-[#7bdcff] uppercase mb-3">
            ПОПРОБУЙТЕ IZINET
          </p>
          <h2 className="text-3xl sm:text-5xl font-medium tracking-tight text-white mb-6">
            Легко подключиться.<br />
            <span className="text-[#87909c]">Удобно каждый день.</span>
          </h2>
          <Button
            onClick={() => handleCTA('register')}
            className="min-h-[50px] px-9 rounded-xl bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold text-[15px] shadow-[0_2px_1px_rgba(255,255,255,0.3)_inset,0_4px_16px_rgba(0,0,0,0.5)] hover:shadow-[0_0_30px_rgba(176,232,255,0.4)] hover:-translate-y-0.5 transition-all inline-flex items-center gap-2 mb-3"
          >
            Попробовать бесплатно <ArrowRight className="w-4 h-4" />
          </Button>
          <p className="text-xs text-[#59636f]">
            3 дня бесплатно для новых пользователей · Без привязки карты
          </p>
        </section>
      </main>

      {/* 10. Footer */}
      <footer className="border-t border-white/10 bg-[#05070a] py-12 px-4 text-xs text-[#8d959f]">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-full border border-cyan-400/60 flex items-center justify-center bg-cyan-950/30">
                <span className="w-1.5 h-1.5 rounded-full bg-[#8be5f0]" />
              </div>
              <span className="text-lg font-bold text-white tracking-tight">
                izi<span className="text-[#7bdcff]">net</span>
              </span>
            </div>
            <p className="text-[#59636f] text-xs">Больше возможностей для вашего интернета.</p>
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <a href="#plans" className="hover:text-white transition-colors">Тарифы</a>
            <a href="#how" className="hover:text-white transition-colors">Как подключиться</a>
            <a href="/terms" className="hover:text-white transition-colors">Пользовательское соглашение</a>
            <a href="/privacy" className="hover:text-white transition-colors">Конфиденциальность</a>
            <a href="/refund" className="hover:text-white transition-colors">Возврат средств</a>
            <a href={botLink} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Поддержка</a>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-8 pt-6 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-2 text-[#59636f] text-[11px]">
          <span>© {new Date().getFullYear()} izinet · iOS / Android / Windows / macOS</span>
          <span>Скорость и доступность зависят от вашей локальной сети и приложения.</span>
        </div>
      </footer>
    </div>
  );
}
