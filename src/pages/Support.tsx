import React, { useState, useEffect } from 'react';
import { 
  MessageSquare, 
  Send, 
  Loader2
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useAppConfig } from '@/hooks/useAppConfig';
import { TicketChatView } from '@/components/TicketChatView';

export default function Support() {
  const { user } = useAuth();
  const { telegramBotName } = useAppConfig();
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState('');
  const [activeChatTicket, setActiveChatTicket] = useState<any>(null);

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
    <div className="flex-1 flex flex-col min-h-0 h-full w-full max-w-3xl mx-auto space-y-3 animate-in fade-in duration-500 pb-2">
      <div className="flex justify-end mb-1 shrink-0">
        <Button 
          className="bg-[#0088cc] text-white hover:bg-[#0088cc]/90 rounded-xl px-5 h-9 text-xs gap-2 shrink-0" 
          onClick={() => window.open(`https://t.me/${telegramBotName}`, '_blank')}
        >
          <Send className="w-3.5 h-3.5" /> Чат в Telegram
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="flex-1 min-h-0 flex flex-col">
          {isLoading ? (
            <Card className="glass-card flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </Card>
          ) : activeChatTicket ? (
            <div className="flex-1 min-h-0 flex flex-col h-full animate-in fade-in slide-in-from-bottom-4">
               <TicketChatView 
                ticket={activeChatTicket} 
                onClose={() => {}} 
               />
               <p className="text-[9px] text-center text-muted-foreground mt-1.5 opacity-50 uppercase tracking-widest shrink-0">
                  Поддержка обычно отвечает в течение 15-30 минут
               </p>
            </div>
          ) : (
            <Card className="glass-card flex-1 flex flex-col items-center justify-center p-6 text-center bg-card/40 backdrop-blur-md min-h-0 overflow-y-auto">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 shrink-0">
                <MessageSquare className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-bold mb-1 uppercase tracking-wide">Поддержка izinet</h3>
              <p className="text-xs text-muted-foreground max-w-xs mb-6 leading-normal">
                Опишите ваш вопрос, и наш специалист ответит вам в этом чате.
              </p>
              <div className="w-full max-w-md space-y-3">
                <textarea 
                  className="w-full min-h-[100px] bg-muted/30 border border-border rounded-2xl p-3.5 text-base md:text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50 resize-none outline-none font-sans"
                  placeholder="Ваше сообщение..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={isSending}
                />
                <Button 
                  onClick={handleStartNewChat}
                  disabled={isSending || !message.trim()}
                  className="w-full h-11 bg-primary text-black hover:bg-primary/90 font-bold rounded-xl text-xs uppercase"
                >
                  {isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Начать диалог'}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
