import React, { useEffect, useState } from 'react';
import { 
  CreditCard, 
  ArrowLeft,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  History
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetTrigger 
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import axios from 'axios';

const PRESET_AMOUNTS = [100, 500, 1000, 2500, 5000];

export default function Wallet() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [amount, setAmount] = useState<string>('500');
  const [method] = useState<'enot'>('enot');
  const [isProcessing, setIsProcessing] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, [user]);

  const fetchHistory = async () => {
    try {
      setLoadingHistory(true);
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await axios.get('/api/transactions', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      setTransactions(res.data);
    } catch (err) {
      console.error('Failed to fetch transactions history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handlePayment = async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount < 10) {
      toast.error('Минимальная сумма пополнения — 10 ₽');
      return;
    }

    setIsProcessing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch('/api/pay/create', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          userId: user?.id,
          amount: numAmount,
          method: method
        })
      });

      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.error('Non-JSON API response:', responseText);
        if (responseText.includes('Please wait while your application starts')) {
          throw new Error('Сервер обновляется. Пожалуйста, подождите пару секунд и попробуйте снова.');
        }
        throw new Error(`Неизвестная ошибка сервера (Код: ${response.status}). Пожалуйста, обратитесь в поддержку.`);
      }
      
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error(data.error || 'Ошибка при создании платежа');
      }
    } catch (error: any) {
      console.error('Payment error:', error);
      toast.error(error.message || 'Не удалось создать платеж');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-500 max-w-md mx-auto">
      {/* Compact Header */}
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-1.5">
          <Button 
            variant="ghost" 
            size="icon" 
            className="rounded-xl h-8 w-8 text-muted-foreground hover:text-primary"
            onClick={() => navigate('/dashboard')}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-sm font-bold tracking-tight">Пополнение баланса</h1>
        </div>

        <Sheet>
          <SheetTrigger render={
            <Button variant="ghost" size="sm" className="rounded-xl h-8 px-2.5 border border-white/5 hover:bg-white/5 gap-1.5 text-[11px] text-muted-foreground">
              <History className="w-3.5 h-3.5" />
              <span>История</span>
            </Button>
          } />
          <SheetContent className="w-full sm:max-w-md bg-card border-l border-white/5 p-0">
            <SheetHeader className="p-4 border-b border-white/5">
              <SheetTitle className="text-base font-bold">История операций</SheetTitle>
            </SheetHeader>
            <div className="overflow-y-auto h-[calc(100vh-60px)] p-4">
              {loadingHistory ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-xl bg-white/5" />
                  ))}
                </div>
              ) : transactions.length > 0 ? (
                <div className="space-y-2">
                  {transactions.map((tx) => (
                    <div key={tx.id} className="group p-3 bg-white/[0.02] border border-white/5 rounded-xl transition-all duration-300">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`p-1.5 rounded-lg ${
                            tx.type === 'deposit' 
                              ? "bg-green-500/10 text-green-500" 
                              : "bg-blue-500/10 text-blue-500"
                          }`}>
                            {tx.type === 'deposit' ? <ArrowDownLeft className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                          </div>
                          <div>
                            <div className="font-bold text-xs">{tx.description || (tx.type === 'deposit' ? 'Пополнение' : 'Списание')}</div>
                            <div className="text-[9px] text-muted-foreground flex items-center gap-1 mt-0.5 font-mono">
                              <Clock className="w-3 h-3" />
                              {new Date(tx.created_at).toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <div className={`text-xs font-mono font-bold ${
                          tx.type === 'deposit' ? "text-green-400" : "text-blue-400"
                        }`}>
                          {tx.type === 'deposit' ? '+' : '-'}{Number(tx.amount).toFixed(0)} ₽
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-muted-foreground italic text-xs">
                  История операций пуста
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <Card className="glass-card border-primary/20 p-4 space-y-4">
        {/* Sum Header */}
        <div className="space-y-0.5">
          <CardTitle className="text-xs font-black uppercase text-primary tracking-widest">1. Сумма пополнения</CardTitle>
          <CardDescription className="text-[10px] text-muted-foreground leading-tight">
            Выберите готовый пресет или введите вручную
          </CardDescription>
        </div>

        {/* Preset grid */}
        <div className="grid grid-cols-5 gap-1.5">
          {PRESET_AMOUNTS.map((val) => (
            <Button
              key={val}
              variant={amount === val.toString() ? "default" : "outline"}
              className={`rounded-xl h-9 text-xs transition-all ${
                amount === val.toString() 
                  ? "bg-primary text-black font-black neon-glow" 
                  : "border-border hover:border-primary/50 text-muted-foreground font-semibold"
              }`}
              onClick={() => setAmount(val.toString())}
            >
              {val}₽
            </Button>
          ))}
        </div>

        {/* Custom Input */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">₽</span>
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="pl-7 h-10 bg-muted/20 border-border text-xs font-bold rounded-xl focus-visible:ring-primary/50"
            placeholder="Другая сумма"
          />
        </div>

        {/* Payment info block */}
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
              <CreditCard className="w-4 h-4" />
            </div>
            <div className="space-y-0.5">
              <div className="text-xs font-bold text-white flex items-center gap-1">
                Карты / СБП <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
              </div>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Оплата через Enot.io (Мир, Visa, MC, СБП). Быстрое зачисление.
              </p>
            </div>
          </div>
        </div>

        {/* Core Pay block */}
        <div className="space-y-2.5 pt-1">
          <Button 
            className="w-full h-11 text-sm font-bold bg-primary text-black hover:bg-primary/90 rounded-xl shadow-lg shadow-primary/20 neon-glow"
            onClick={handlePayment}
            disabled={isProcessing || !amount}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                Создание платежа...
              </>
            ) : (
              `Пополнить на ${parseFloat(amount) || 0} ₽`
            )}
          </Button>

          <p className="flex items-center justify-center gap-1.5 text-[9px] text-muted-foreground text-center">
            <AlertCircle className="w-3.5 h-3.5 text-primary shrink-0" />
            Нажимая «Пополнить», вы принимаете условия оферты
          </p>
        </div>
      </Card>
    </div>
  );
}
