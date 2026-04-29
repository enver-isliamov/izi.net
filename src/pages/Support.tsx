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
    a: "Пополнить баланс можно в разделе 'Кошелек' через СБП, любые банковские карты (Enot.io), через Telegram Stars или криптовалютой. После зачисления средств, перейдите в 'Подписку' и выберите план."
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
  const [tickets, setTickets] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState('');
  const [activeChatTicket, setActiveChatTicket] = useState<any>(null);
  const [showHistory, setShowHistory] = useState(false);

  const fetchSupportData = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      
      if (error) throw error;
      setTickets(data || []);
      
      // Select the first non-closed ticket as active, or the most recent one
      if (data && data.length > 0) {
        const active = data.find(t => t.status !== 'closed') || data[0];
        setActiveChatTicket(active);
      }
    } catch (error) {
      console.error('Error fetching support data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSupportData();
  }, [user]);

  const handleStartNewChat = async () => {
    if (!user || !message.trim()) return;

    setIsSending(true);
    try {
      const { data, error } = await supabase.from('support_tickets').insert({
        user_id: user.id,
        subject: 'Поддержка izinet',
        message: message.trim(),
        status: 'open',
        priority: 'medium'
      }).select().single();

      if (error) throw error;
      
      setMessage('');
      fetchSupportData();
    } catch (error) {
      console.error('Error creating chat:', error);
      toast.error('Ошибка при начале чата');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Поддержка</h1>
          <p className="text-muted-foreground mt-1">Чат с командой izinet</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
            <Button 
              variant="outline" 
              className="rounded-xl px-6 gap-2"
              onClick={() => setShowHistory(!showHistory)}
            >
               <Clock className="w-4 h-4" /> {showHistory ? "Вернуться в чат" : "История обращений"}
            </Button>
            <Button 
              className="bg-[#0088cc] text-white hover:bg-[#0088cc]/90 rounded-xl px-6 gap-2" 
              onClick={() => window.open(`https://t.me/${telegramBotName}`, '_blank')}
            >
              <Send className="w-4 h-4" /> Чат в Telegram
            </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-10">
        <div className="lg:col-span-2">
          {isLoading ? (
            <Card className="glass-card h-[500px] flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </Card>
          ) : showHistory ? (
            <Card className="glass-card min-h-[500px]">
              <CardHeader>
                <CardTitle>История обращений</CardTitle>
                <CardDescription>Все ваши предыдущие диалоги с поддержкой</CardDescription>
              </CardHeader>
              <CardContent>
                {tickets.length > 0 ? (
                  <div className="space-y-3">
                    {tickets.map((ticket) => (
                      <div 
                        key={ticket.id} 
                        className={`p-4 rounded-xl border border-border bg-muted/20 cursor-pointer hover:bg-muted/40 transition-all ${activeChatTicket?.id === ticket.id ? 'ring-1 ring-primary border-primary/50 bg-primary/5' : ''}`}
                        onClick={() => {
                          setActiveChatTicket(ticket);
                          setShowHistory(false);
                        }}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold text-sm">{ticket.subject}</span>
                          <Badge variant="outline" className={`text-[9px] uppercase ${ticket.status === 'open' ? 'text-primary border-primary/30' : ''}`}>
                            {ticket.status === 'open' ? 'Активен' : ticket.status === 'closed' ? 'Закрыт' : 'В работе'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1">{ticket.message}</p>
                        <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground opacity-60">
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(ticket.created_at).toLocaleDateString()}</span>
                          <span>ID: {ticket.id.substring(0, 8)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-20 grayscale opacity-50">
                    <MessageSquare className="w-12 h-12 mx-auto mb-4" />
                    <p>История пуста</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : activeChatTicket ? (
            <div className="animate-in fade-in slide-in-from-bottom-4">
               <TicketChatView 
                ticket={activeChatTicket} 
                onClose={() => {}} 
               />
               <p className="text-[10px] text-center text-muted-foreground mt-2 opacity-50 uppercase tracking-widest">
                  Поддержка обычно отвечает в течение 15-30 минут
               </p>
            </div>
          ) : (
            <Card className="glass-card h-[500px] flex flex-col items-center justify-center p-8 text-center bg-card/40 backdrop-blur-md">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
                <MessageSquare className="w-10 h-10 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-2">Добро пожаловать в поддержку izinet</h3>
              <p className="text-muted-foreground max-w-sm mb-8">
                Опишите ваш вопрос, и наш специалист ответит вам в этом чате.
              </p>
              <div className="w-full max-w-md space-y-4">
                <textarea 
                  className="w-full min-h-[120px] bg-muted/30 border border-border rounded-2xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50"
                  placeholder="Ваше сообщение..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={isSending}
                />
                <Button 
                  onClick={handleStartNewChat}
                  disabled={isSending || !message.trim()}
                  className="w-full h-12 bg-primary text-black hover:bg-primary/90 font-bold rounded-xl"
                >
                  {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Начать диалог'}
                </Button>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <HelpCircle className="w-5 h-5 text-primary" />
                База знаний
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                {faqs.map((faq, i) => (
                  <AccordionItem key={i} value={`item-${i}`} className="border-border px-0">
                    <AccordionTrigger className="text-sm font-medium hover:text-primary text-left py-3">
                      {faq.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-xs text-muted-foreground leading-relaxed pb-4">
                      {faq.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>

          <Card className="glass-card border-primary/20 overflow-hidden relative group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-150 duration-500" />
            <CardContent className="p-6 space-y-4 relative">
              <h3 className="font-bold">Нужна инструкция?</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Мы подготовили пошаговые гайды для настройки VPN на Android, iOS и Windows.
              </p>
              <Button 
                variant="outline" 
                className="w-full rounded-xl border-primary/30 text-primary hover:bg-primary/5 group"
                onClick={() => window.location.href='/instructions'}
              >
                Открыть Инструкции
                <ExternalLink className="w-3 h-3 ml-2 opacity-0 group-hover:opacity-100 transition-all" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
