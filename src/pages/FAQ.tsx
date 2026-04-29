import React from 'react';
import { 
  HelpCircle, 
  Search, 
  MessageCircle, 
  BookOpen, 
  Shield, 
  CreditCard, 
  Zap, 
  Smartphone 
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const categories = [
  { icon: Shield, name: 'Безопасность', count: 12 },
  { icon: CreditCard, name: 'Оплата', count: 8 },
  { icon: Zap, name: 'Скорость', count: 5 },
  { icon: Smartphone, name: 'Устройства', count: 10 },
];

const faqs = [
  {
    category: 'Оплата',
    q: "Какие способы оплаты вы принимаете?",
    a: "Мы принимаем оплату банковскими картами (МИР, Visa, Mastercard, любых банков РФ), через Систему Быстрых Платежей (СБП) через надежный шлюз Enot.io, а также популярными криптовалютами (через Cryptomus) и Telegram Stars."
  },
  {
    category: 'Рефералы',
    q: "Как работает реферальная программа?",
    a: "Поделитесь своей реферальной ссылкой! Ваш друг моментально получит подарочные 50 ₽ на свой баланс при регистрации, а вы будете бессрочно получать 10% от суммы каждого его пополнения баланса."
  },
  {
    category: 'Безопасность',
    q: "Храните ли вы логи посещений?",
    a: "Нет, у нас строгая политика No-Logs. Мы не отслеживаем ваш интернет-трафик, DNS-запросы и не храним информацию о вашей активности в сети. Мы собираем только минимальные данные (почту) для доступа к аккаунту."
  },
  {
    category: 'Скорость',
    q: "Ограничиваете ли вы скорость или трафик?",
    a: "Мы не ограничиваем скорость соединения на наших серверах (пропускная способность канала до 1 Gbps). По умолчанию предоставляется лимит в 100 ГБ на устройство, что достаточно для 99% задач, включая просмотр видео."
  },
  {
    category: 'Устройства',
    q: "На скольких устройствах я могу использовать VPN?",
    a: "По умолчанию ваша подписка поддерживает 2 устройства на один аккаунт одновременно. Вы также можете сгенерировать дополнительные ключи для других устройств в личном кабинете на каждую новую сессию."
  },
  {
    category: 'Технологии',
    q: "Что такое VLESS + Reality?",
    a: "VLESS + Reality — это современный VPN протокол, который маскирует ваш трафик под обычное посещение популярных сайтов (например, Microsoft), что позволяет стабильно работать даже в условиях самых строгих блокировок провайдера."
  }
];

export default function FAQ() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="text-center max-w-2xl mx-auto space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">База знаний</h1>
        <p className="text-muted-foreground">Найдите ответы на популярные вопросы или свяжитесь с нами напрямую</p>
        <div className="relative max-w-md mx-auto mt-6">
          <Search className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
          <Input placeholder="Поиск по вопросам..." className="pl-10 h-12 bg-card border-border rounded-2xl focus:ring-primary/50" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {categories.map((cat, i) => (
          <Card key={i} className="glass-card hover:border-primary/50 transition-colors cursor-pointer group">
            <CardContent className="p-6 flex flex-col items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <cat.icon className="w-6 h-6 text-primary" />
              </div>
              <div className="text-center">
                <div className="font-bold text-sm">{cat.name}</div>
                <div className="text-[10px] text-muted-foreground">{cat.count} статей</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="max-w-3xl mx-auto">
        <Card className="glass-card">
          <CardContent className="p-6">
            <Accordion type="single" className="w-full">
              {faqs.map((faq, i) => (
                <AccordionItem key={i} value={`item-${i}`} className="border-border py-2">
                  <AccordionTrigger className="text-base font-medium hover:text-primary text-left">
                    <div className="flex flex-col gap-1">
                      <Badge variant="outline" className="w-fit text-[10px] h-4 px-1 border-primary/30 text-primary/70 uppercase tracking-widest">{faq.category}</Badge>
                      {faq.q}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground leading-relaxed pt-2">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
        <Card className="glass-card bg-primary/5 border-primary/20">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
              <MessageCircle className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold">Чат поддержки</h3>
              <p className="text-xs text-muted-foreground">Отвечаем в течение 15 минут</p>
            </div>
            <Button size="sm" className="bg-primary text-black hover:bg-primary/90 rounded-xl" onClick={() => window.location.href='/support'}>Написать</Button>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold">Документация</h3>
              <p className="text-xs text-muted-foreground">Гайды по установке и настройке</p>
            </div>
            <Button size="sm" variant="outline" className="rounded-xl border-border" onClick={() => window.location.href='/installation'}>Открыть</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
