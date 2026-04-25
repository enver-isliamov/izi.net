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
      const { error } = await supabase.from('support_messages').insert({
        ticket_id: ticket.id,
        sender: 'user',
        content: inputText.trim() // <-- Using exactly the inputText.trim()
      });
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
    <div className="flex flex-col h-full h-[600px] border border-border rounded-xl overflow-hidden bg-card/30">
      <div className="bg-muted/30 p-4 border-b border-border flex justify-between items-center">
        <div>
          <h3 className="font-bold">{ticket.subject}</h3>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="w-3 h-3" /> {new Date(ticket.created_at).toLocaleDateString()}
          </span>
        </div>
        <Badge variant="outline" className={ticket.status === 'open' ? 'text-primary border-primary/30' : ''}>
          {ticket.status === 'open' ? 'Открыт' : ticket.status === 'in_progress' ? 'В работе' : 'Закрыт'}
        </Badge>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {initialMessage && (
          <div className="flex justify-end">
            <div className="bg-primary/20 text-primary-foreground max-w-[80%] rounded-2xl rounded-tr-sm p-3 text-sm">
                <p className="whitespace-pre-wrap text-foreground">{initialMessage.content}</p>
                <div className="text-[10px] text-right mt-1 opacity-70">
                    {new Date(initialMessage.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </div>
            </div>
          </div>
        )}
        
        {loading ? (
             <div className="flex justify-center p-4">
                 <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
             </div>
        ) : (
            messages.map((m) => {
                const isUser = m.sender === 'user';
                return (
                    <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                        {!isUser && (
                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center mr-2 flex-shrink-0">
                                <MessageCircle className="w-4 h-4 text-primary" />
                            </div>
                        )}
                        <div className={`max-w-[80%] rounded-2xl p-3 text-sm ${isUser ? 'bg-primary/20 text-primary-foreground rounded-tr-sm' : 'bg-muted/50 rounded-tl-sm'}`}>
                            <p className="whitespace-pre-wrap text-foreground">{m.content}</p>
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

      <div className="p-4 bg-muted/20 border-t border-border">
        {ticket.status === 'closed' ? (
          <div className="text-center text-sm text-muted-foreground p-2">
             Тикет закрыт. Вы не можете отправлять сообщения.
          </div>
        ) : (
          <div className="flex gap-2">
            <Input 
              placeholder="Напишите сообщение..." 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                  }
              }}
              disabled={sending}
              className="bg-background rounded-full"
            />
            <Button onClick={handleSend} disabled={sending || !inputText.trim()} size="icon" className="rounded-full bg-primary flex-shrink-0">
              {sending ? <Loader2 className="w-4 h-4 animate-spin text-primary-foreground" /> : <Send className="w-4 h-4 text-primary-foreground" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
