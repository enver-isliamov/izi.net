import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2, Send, Clock, User, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface Message {
  id: string;
  sender: 'user' | 'admin';
  content: string;
  created_at: string;
}

interface TicketChatViewProps {
  ticket: any;
  onClose: () => void;
}

export function TicketChatView({ ticket, onClose }: TicketChatViewProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Initialize with ticket.message as first message
  const initialMessage: Message | null = ticket.message ? {
    id: 'initial',
    sender: 'user',
    content: ticket.message,
    created_at: ticket.created_at,
  } : null;

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', ticket.id)
        .order('created_at', { ascending: true });
        
      if (error && error.code !== 'PGRST205') { // Ignore if table missing temporarily
        console.error(error);
      }
      setMessages(data || []);
    } catch(e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();

    // Subscribe to new messages
    const subscription = supabase
      .channel(`chat_${ticket.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'support_messages',
        filter: `ticket_id=eq.${ticket.id}`
      }, (payload) => {
        setMessages((prev) => [...prev, payload.new as Message]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [ticket.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    
    setSending(true);
    try {
      const { data, error } = await supabase.from('support_messages').insert({
        ticket_id: ticket.id,
        sender: 'user',
        content: inputText.trim()
      }).select().single();

      if (error) {
        if (error.code === 'PGRST205') {
            toast.error('Администратор еще не обновил базу данных для чата. Сообщение не отправлено.');
        } else {
            throw error;
        }
      } else {
        setInputText('');
      }
    } catch(e) {
      console.error(e);
      toast.error('Ошибка отправки сообщения');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[70vh] md:h-[600px] border border-border rounded-2xl overflow-hidden bg-card/30 backdrop-blur-sm">
      <div className="bg-background/40 backdrop-blur-md p-4 border-b border-border flex justify-between items-center">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shadow-inner">
                <MessageCircle className="w-5 h-5" />
            </div>
            <div>
                <h3 className="font-bold text-sm leading-tight">Поддержка izinet</h3>
                <div className="flex items-center gap-2">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Онлайн</span>
                </div>
            </div>
        </div>
        <Badge variant="outline" className={`text-[9px] h-5 px-2 bg-background/50 ${ticket.status === 'open' ? 'text-primary border-primary/30' : ''}`}>
          {ticket.status === 'open' ? 'Активен' : 'Архив'}
        </Badge>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">

        {initialMessage && (
          <div className="flex justify-end">
            <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-tr-sm p-3 text-sm shadow-sm">
                <p className="whitespace-pre-wrap">{initialMessage.content}</p>
                <div className="text-[10px] text-right mt-1 opacity-70">
                    {new Date(initialMessage.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>
            </div>
          </div>
        )}
        
        {loading ? (
             <div className="flex justify-center p-8">
                 <Loader2 className="w-6 h-6 animate-spin text-primary" />
             </div>
        ) : (
            messages.map((m) => {
                const isUser = m.sender === 'user';
                return (
                    <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2 duration-300`}>
                        {!isUser && (
                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center mr-2 flex-shrink-0 mt-auto mb-1">
                                <User className="w-4 h-4 text-primary" />
                            </div>
                        )}
                        <div className={`max-w-[85%] shadow-sm rounded-2xl p-3 text-sm ${isUser ? 'bg-primary text-primary-foreground rounded-tr-sm' : 'bg-muted rounded-tl-sm text-foreground'}`}>
                            <p className="whitespace-pre-wrap">{m.content}</p>
                            <div className={`text-[10px] mt-1 opacity-70 ${isUser ? 'text-right' : 'text-left'}`}>
                                {new Date(m.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            </div>
                        </div>
                    </div>
                )
            })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 bg-muted/40 border-t border-border backdrop-blur-md">
        {ticket.status === 'closed' ? (
          <div className="text-center text-xs text-muted-foreground p-2">
             Это обращение закрыто. Новые сообщения не принимаются.
          </div>
        ) : (
          <div className="flex gap-2 items-center">
            <Input 
              placeholder="Введите сообщение..." 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                  }
              }}
              disabled={sending}
              className="bg-background border-border/50 rounded-2xl h-10 px-4 focus-visible:ring-primary/30"
            />
            <Button 
                onClick={handleSend} 
                disabled={sending || !inputText.trim()} 
                size="icon" 
                className="rounded-xl h-10 w-10 bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 shrink-0"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 shrink-0" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
