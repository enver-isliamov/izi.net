import React, { useMemo, useState } from 'react';
import {
  Search,
  MessageCircle,
  BookOpen,
  Shield,
  CreditCard,
  Zap,
  Smartphone,
  Send,
  Activity,
  Bell
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';

const categories = [
  { icon: Shield, name: 'Безопасность' },
  { icon: CreditCard, name: 'Оплата' },
  { icon: Activity, name: 'Подключение' },
  { icon: Smartphone, name: 'Устройства' },
  { icon: Bell, name: 'Подписка' },
  { icon: Zap, name: 'Скорость' },
  { icon: Send, name: 'Telegram' },
];

const faqs = [
  {
    category: 'Подключение',
    q: 'Как подключиться к VPN?',
    a: 'Откройте личный кабинет, раздел «Подписка», и скопируйте ссылку подписки. Установите приложение Hiddify (iOS, Android, Windows, macOS) или v2rayNG, вставьте ссылку как подписку — профиль появится автоматически. В приложении выберите сервер и нажмите «Подключиться».'
  },
  {
    category: 'Подключение',
    q: 'Какие протоколы вы используете?',
    a: 'Два рабочих протокола: VLESS + Reality (TCP, маскируется под обычный HTTPS-трафик — стабилен там, где режут TCP) и Hysteria2 (UDP, быстрее на плохих каналах и там, где TCP замедляют). Оба протокола всегда приходят в одной подписке — можно переключаться между ними в приложении, если один перестал работать.'
  },
  {
    category: 'Подключение',
    q: 'Что делать, если VPN не подключается?',
    a: '1) Обновите подписку в приложении (кнопка «Обновить подписку»). 2) Переключитесь на второй протокол из той же подписки (Hysteria2 ↔ VLESS Reality). 3) Проверьте, что мобильный интернет или Wi-Fi не блокирует VPN — попробуйте другую сеть. 4) Перезагрузите приложение. Если не помогло — напишите в поддержку из личного кабинета.'
  },
  {
    category: 'Подключение',
    q: 'Что такое файл AmneziaWG и когда его выбирать?',
    a: 'AmneziaWG — обфусцированный WireGuard: быстрый и устойчивый к DPI. Файл нужен там, где неудобно вставлять ссылку: роутер, ТВ-приставка, второй компьютер. В кабинете нажмите «Файл AmneziaWG (роутер)», затем «Скачать файл» — и импортируйте его в приложение AmneziaWG или в роутер с поддержкой AWG. Файл привязан к вашему аккаунту: удалите устройство в кабинете — доступ перестанет работать.'
  },
  {
    category: 'Подключение',
    q: 'Ссылка-подписка или AmneziaWG-файл — что выбрать?',
    a: 'Для телефона и компьютера — «Ключ-ссылка»: одно нажатие, профиль появляется в Hiddify автоматически. Для роутера, ТВ-приставки и любых устройств без поддержки ссылок — «Файл AmneziaWG». Оба варианта идут в один лимит устройств, и оба можно удалить или пересоздать в любой момент.'
  },
  {
    category: 'Подписка',
    q: 'Где посмотреть расход трафика и остаток срока?',
    a: 'На главной странице и в разделе «Подписка»: прогресс-бар трафика показывает, сколько из лимита израсходовано, а рядом — сколько дней осталось до окончания. Данные обновляются автоматически из панели сервера. Если цифры не меняются — откройте раздел и обновите страницу.'
  },
  {
    category: 'Подписка',
    q: 'Как продлить подписку?',
    a: 'Пополните баланс в разделе «Кошелёк» и оформите продление в «Подписке», либо напишите в поддержку — администратор может продлить подписку вручную, сохранив ваши ключи и устройства.'
  },
  {
    category: 'Telegram',
    q: 'Как привязать Telegram и зачем это нужно?',
    a: 'В профиле нажмите «Привязать Telegram» — откроется бот, привязка подтверждается автоматически. После привязки к боту приходят уведомления об окончании подписки и статусе сервиса, а поддержка отвечает быстрее.'
  },
  {
    category: 'Telegram',
    q: 'Почему не приходят уведомления?',
    a: 'Проверьте два условия: Telegram привязан в профиле, и в разделе «Уведомления» включены нужные переключатели (окончание подписки, платежи, новости). Если Telegram не привязан — уведомления приходить не будут: они доставляются в чат с ботом.'
  },
  {
    category: 'Оплата',
    q: 'Какие способы оплаты вы принимаете?',
    a: 'Банковские карты (МИР, Visa, Mastercard любых банков РФ) и Система быстрых платежей (СБП) через шлюз Enot.io. Оплата зачисляется на баланс личного кабинета, из которого оформляется подписка.'
  },
  {
    category: 'Оплата',
    q: 'Как работает реферальная программа?',
    a: 'Скопируйте свою реферальную ссылку в профиле или в разделе «Рефералы»: друг получит подарочные 50 ₽ на баланс при регистрации, а вы — 10% от каждого его пополнения бессрочно. Начисления видны в разделе «Рефералы».'
  },
  {
    category: 'Безопасность',
    q: 'Храните ли вы логи посещений?',
    a: 'Нет. Политика No-Logs: мы не отслеживаем трафик, DNS-запросы и историю посещений. В базе хранится минимум — email для входа и технические параметры подписки.'
  },
  {
    category: 'Безопасность',
    q: 'Почему сайты не должны видеть, что я в России?',
    a: 'При включённом VPN сайты видят IP-адрес сервера (сейчас — Нидерланды), а не ваш домашний адрес. Важно, чтобы в приложении был включён DNS через туннель и выключен IPv6 — иначе часть запросов может уйти напрямую. Проверить можно на ipinfo.io и dnsleaktest.com.'
  },
  {
    category: 'Устройства',
    q: 'На скольких устройствах можно использовать VPN?',
    a: 'По умолчанию 2 устройства на подписку. Дополнительные ключи можно добавить в личном кабинете (раздел «Подписка» → «Добавить устройство»), а лимит устройств администратор может увеличить по запросу в поддержку.'
  },
  {
    category: 'Скорость',
    q: 'Ограничиваете ли вы скорость?',
    a: 'Искусственных ограничений скорости нет — доступна полоса канала сервера. Лимит трафика по умолчанию 100 ГБ на подписку, чего достаточно для повседневного использования, включая видео. Расход виден в личном кабинете.'
  }
];

export default function FAQ() {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return faqs.filter((faq) => {
      const matchCategory = !activeCategory || faq.category === activeCategory;
      const matchQuery = !q || faq.q.toLowerCase().includes(q) || faq.a.toLowerCase().includes(q) || faq.category.toLowerCase().includes(q);
      return matchCategory && matchQuery;
    });
  }, [query, activeCategory]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-6">
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">База знаний</h1>
        <p className="text-sm text-muted-foreground">
          Ответы на частые вопросы: подключение, подписка, оплата, уведомления и безопасность.
        </p>
      </div>

      <div className="max-w-3xl mx-auto space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по вопросам и ответам..."
            className="pl-10 h-11 bg-muted/30 border-border rounded-xl"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveCategory(null)}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors',
              !activeCategory ? 'bg-primary/15 text-primary border-primary/30' : 'bg-muted/20 text-muted-foreground border-border hover:text-foreground'
            )}
          >
            Все темы
          </button>
          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => setActiveCategory(activeCategory === cat.name ? null : cat.name)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors',
                activeCategory === cat.name ? 'bg-primary/15 text-primary border-primary/30' : 'bg-muted/20 text-muted-foreground border-border hover:text-foreground'
              )}
            >
              <cat.icon size={12} />
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto">
        <Card className="glass-card">
          <CardContent className="p-4 sm:p-6">
            {filtered.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Ничего не найдено. Попробуйте другой запрос или напишите в поддержку.
              </div>
            ) : (
              <Accordion type="single" className="w-full">
                {filtered.map((faq, i) => (
                  <AccordionItem key={`${faq.q}-${i}`} value={`item-${i}`} className="border-border py-2">
                    <AccordionTrigger className="text-sm sm:text-base font-medium hover:text-primary text-left">
                      <div className="flex flex-col gap-1">
                        <Badge variant="outline" className="w-fit text-[10px] h-4 px-1 border-primary/30 text-primary/70 uppercase tracking-widest">
                          {faq.category}
                        </Badge>
                        {faq.q}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground leading-relaxed pt-2">
                      {faq.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl mx-auto">
        <Card className="glass-card bg-primary/5 border-primary/20">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
              <MessageCircle className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-sm">Чат поддержки</h3>
              <p className="text-xs text-muted-foreground">Отвечаем в течение 15–30 минут</p>
            </div>
            <Button size="sm" className="bg-primary text-black hover:bg-primary/90 rounded-xl shrink-0" onClick={() => (window.location.href = '/support')}>
              Написать
            </Button>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-sm">Инструкции по установке</h3>
              <p className="text-xs text-muted-foreground">Гайды для телефона и компьютера</p>
            </div>
            <Button size="sm" variant="outline" className="rounded-xl border-border shrink-0" onClick={() => (window.location.href = '/installation')}>
              Открыть
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
