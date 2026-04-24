import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  Plus, 
  Send, 
  Paperclip, 
  HelpCircle, 
  ChevronDown,
  ExternalLink,
  Loader2,
  Clock,
  ArrowLeft
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useAppConfig } from '@/hooks/useAppConfig';
import { TicketChatView } from '@/components/TicketChatView';

const faqs = [
  {
    q: "Как оплатить подписку и какие способы оплаты есть?",
    a: "Пополнить баланс можно в разделе 'Кошелек' через СБП, любые банковские карты (Platega), через Telegram Stars или криптовалютой. После зачисления средств, перейдите в 'Подписку' и выберите план."
  },
  {
    q: "Чем отличается INCY от Hiddify?",
    a: "INCY — это наше рекомендуемое легковесное приложение, поддерживающее быстрое подключение. Hiddify — это мощный комбайн для продвинутых юзеров. Оба приложения отлично работают с нашими ключами VLESS."
  },
  {
    q: "Сколько устройств можно подключить?",
    a: "По умолчанию в подписку включены ключи для 2-х устройств. Вы можете докупить ключи для дополнительных устройств прямо в разделе 'Подписка'."
  },
  {
    q: "Как получить бонус за друга?",
    a: "Перейдите в раздел 'Рефералы' и скопируйте свою ссылку. Каждый, кто по ней зарегистрируется, моментально получит 50₽ на счет, а вы будете получать 10% со всех его пополнений."
  }
];

export default function Support() {
  const { user } = useAuth();
  const { telegramBotName } = useAppConfig();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [tickets, setTickets] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'list' | 'new' | 'chat'>('list');
  const [selectedTicket, setSelectedTicket] = useState<any>(null);

  const fetchTickets = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setTickets(data || []);
    } catch (error) {
      console.error('Error fetching tickets:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [user]);

  const handleSubmit = async () => {
    if (!user || !subject || !message) {
      toast.error('Заполните тему и сообщение');
      return;
    }

    setIsSending(true);
    try {
      const { error } = await supabase.from('support_tickets').insert({
        user_id: user.id,
        subject,
        message,
        status: 'open',
        priority: 'medium'
      });

      if (error) throw error;
      
      toast.success('Обращение отправлено! Мы ответим вам в ближайшее время.');
      setSubject('');
      setMessage('');
      fetchTickets();
      setActiveTab('list');
    } catch (error) {
      console.error('Error sending ticket:', error);
      toast.error('Ошибка при отправке обращения');
    } finally {
      setIsSending(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open': return <Badge className="bg-primary/20 text-primary border-primary/30 uppercase text-[10px]">Открыт</Badge>;
      case 'in_progress': return <Badge className="bg-yellow-500/20 text-yellow-500 border-yellow-500/30 uppercase text-[10px]">В работе</Badge>;
      case 'closed': return <Badge className="bg-muted text-muted-foreground uppercase text-[10px]">Закрыт</Badge>;
      default: return null;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Поддержка</h1>
          <p className="text-muted-foreground mt-1">Остались вопросы? Мы всегда на связи</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
            {activeTab !== 'new' && (
              <Button className="rounded-xl px-6" onClick={() => setActiveTab('new')}>
                 <Plus className="w-4 h-4 mr-2" /> Новое обращение
              </Button>
            )}
            <Button className="bg-[#0088cc] text-white hover:bg-[#0088cc]/90 rounded-xl px-6 gap-2" onClick={() => window.open(`https://t.me/${telegramBotName}`, '_blank')}>
            <Send className="w-4 h-4" /> Перейти в Telegram
            </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {activeTab === 'list' && (
              <Card className="glass-card">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Ваши обращения</CardTitle>
                    <CardDescription>История ваших тикетов</CardDescription>
                  </div>
                  <Badge variant="outline" className="border-primary text-primary">
                    {tickets.filter(t => t.status !== 'closed').length} активных
                  </Badge>
                </CardHeader>
                <CardContent className="min-h-[200px]">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                  ) : tickets.length > 0 ? (
                    <div className="space-y-4">
                      {tickets.map((ticket) => (
                        <div 
                          key={ticket.id} 
                          className="p-4 rounded-xl border border-border bg-muted/20 space-y-2 cursor-pointer hover:bg-muted/40 transition-colors"
                          onClick={() => {
                              setSelectedTicket(ticket);
                              setActiveTab('chat');
                          }}
                        >
                          <div className="flex justify-between items-start">
                            <div className="font-bold">{ticket.subject}</div>
                            {getStatusBadge(ticket.status)}
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-2">{ticket.message}</p>
                          <div className="flex items-center gap-4 pt-2 text-[10px] text-muted-foreground">
                            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(ticket.created_at).toLocaleDateString()}</span>
                            <span>ID: {ticket.id.substring(0, 8)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center p-8">
                      <div className="w-16 h-16 rounded-full bg-muted/30 flex items-center justify-center mb-4">
                        <MessageSquare className="w-8 h-8 text-muted-foreground" />
                      </div>
                      <h3 className="font-bold">У вас пока нет обращений</h3>
                      <p className="text-sm text-muted-foreground max-w-xs mt-2 mb-6">
                        Если у вас возникла проблема, создайте новый тикет, и мы вам поможем.
                      </p>
                      <Button onClick={() => setActiveTab('new')} className="rounded-xl px-8">Создать тикет</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
          )}

          {activeTab === 'new' && (
              <Card className="glass-card animate-in fade-in slide-in-from-bottom-4">
                <CardHeader>
                  <div className="flex items-center gap-4">
                      <Button variant="ghost" size="icon" className="rounded-full shrink-0" onClick={() => setActiveTab('list')}>
                          <ArrowLeft className="w-5 h-5" />
                      </Button>
                      <div>
                          <CardTitle>Создать обращение</CardTitle>
                          <CardDescription>Опишите вашу проблему максимально подробно</CardDescription>
                      </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Тема обращения</label>
                    <Input 
                      placeholder="Например: Проблема с оплатой" 
                      className="bg-muted/30 border-border rounded-xl"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      disabled={isSending}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Сообщение</label>
                    <textarea 
                      className="w-full min-h-[150px] bg-muted/30 border border-border rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                      placeholder="Опишите детали..."
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      disabled={isSending}
                    />
                  </div>
                  <div className="flex items-center justify-end pt-2">
                    <Button 
                      onClick={handleSubmit}
                      className="bg-primary text-black hover:bg-primary/90 rounded-xl px-8"
                      disabled={isSending || !subject || !message}
                    >
                      {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Отправить'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
          )}

          {activeTab === 'chat' && selectedTicket && (
              <div className="animate-in fade-in slide-in-from-bottom-4 h-full">
                  <div className="mb-4">
                    <Button variant="ghost" size="sm" className="rounded-full gap-2" onClick={() => setActiveTab('list')}>
                        <ArrowLeft className="w-4 h-4" /> Назад к списку
                    </Button>
                  </div>
                  <TicketChatView ticket={selectedTicket} onClose={() => setActiveTab('list')} />
              </div>
          )}
        </div>

        <div className={`space-y-6 ${activeTab === 'chat' ? 'hidden lg:block' : 'block'}`}>
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-primary" />
                Частые вопросы
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" className="w-full">
                {faqs.map((faq, i) => (
                  <AccordionItem key={i} value={`item-${i}`} className="border-border">
                    <AccordionTrigger className="text-sm font-medium hover:text-primary text-left">
                      {faq.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-xs text-muted-foreground leading-relaxed">
                      {faq.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>

          <Card className="glass-card bg-primary/5 border-primary/20">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-bold">Нужна инструкция по установке?</h3>
              <p className="text-sm text-muted-foreground">
                Мы подготовили подробные пошаговые инструкции со скриншотами для настройки на вашей платформе.
              </p>
              <Button variant="outline" className="w-full rounded-xl border-primary/30 text-primary hover:bg-primary/10" onClick={() => window.location.href='/instructions'}>
                Открыть Инструкции
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
