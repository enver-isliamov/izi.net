import React, { useEffect, useState } from 'react';
import { 
  CreditCard, 
  Bitcoin, 
  Wallet as WalletIcon, 
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
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const [amount, setAmount] = useState<string>('500');
  const [method, setMethod] = useState<'enot'>('enot');
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
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-end mb-4">
        <Sheet>
          <SheetTrigger render={
            <Button variant="ghost" size="sm" className="rounded-xl border border-white/5 hover:bg-white/5 gap-2 text-muted-foreground">
              <History className="w-4 h-4" />
              <span>История</span>
            </Button>
          } />
          <SheetContent className="w-full sm:max-w-md bg-card border-l border-white/5 p-0">
            <SheetHeader className="p-6 border-b border-white/5">
              <SheetTitle className="text-xl font-bold">История операций</SheetTitle>
            </SheetHeader>
            <div className="overflow-y-auto h-[full-100px] p-6">
              {loadingHistory ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-2xl bg-white/5" />
                  ))}
                </div>
              ) : transactions.length > 0 ? (
                <div className="space-y-3">
                  {transactions.map((tx) => (
                    <div key={tx.id} className="group p-4 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 rounded-2xl transition-all duration-300">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={`p-2 rounded-xl ${
                            tx.type === 'deposit' 
                              ? "bg-green-500/10 text-green-500" 
                              : "bg-blue-500/10 text-blue-500"
                          }`}>
                            {tx.type === 'deposit' ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                          </div>
                          <div>
                            <div className="font-bold text-sm">{tx.description || (tx.type === 'deposit' ? 'Пополнение' : 'Списание')}</div>
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5 font-mono">
                              <Clock className="w-3 h-3" />
                              {new Date(tx.created_at).toLocaleString()}
                            </div>
                          </div>
                        </div>
                        <div className={`text-sm font-mono font-bold ${
                          tx.type === 'deposit' ? "text-green-400" : "text-blue-400"
                        }`}>
                          {tx.type === 'deposit' ? '+' : '-'}{Number(tx.amount).toFixed(0)} ₽
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20 text-muted-foreground italic text-sm">
                  История операций пуста
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 glass-card border-primary/20">
          <CardHeader>
            <CardTitle className="text-xl">1. Сумма пополнения</CardTitle>
            <CardDescription>Выберите готовую сумму или введите свою</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {PRESET_AMOUNTS.map((val) => (
                <Button
                  key={val}
                  variant={amount === val.toString() ? "default" : "outline"}
                  className={`rounded-xl h-12 ${amount === val.toString() ? "bg-primary text-black neon-glow" : "border-border hover:border-primary/50"}`}
                  onClick={() => setAmount(val.toString())}
                >
                  {val} ₽
                </Button>
              ))}
            </div>

            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">₽</span>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-8 h-14 bg-muted/30 border-border text-lg font-bold rounded-xl focus-visible:ring-primary/50"
                placeholder="Другая сумма"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card flex flex-col items-center justify-center p-6 text-center border-dashed border-primary/30">
          <WalletIcon className="w-12 h-12 text-primary/50 mb-4" />
          <div className="text-sm text-muted-foreground uppercase tracking-widest font-bold">Будет на счету</div>
          <div className="text-4xl font-black text-primary neon-text mt-2">{parseFloat(amount) || 0} ₽</div>
        </Card>
      </div>

      <Card className="glass-card border-primary/20">
        <CardHeader>
          <CardTitle className="text-xl">2. Способ оплаты</CardTitle>
          <CardDescription>Выберите удобную для вас платежную систему</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4">
            <button
              onClick={() => setMethod('enot')}
              className={`flex items-center gap-4 p-5 rounded-2xl border-2 transition-all text-left ${
                method === 'enot' 
                  ? "border-primary bg-primary/5 shadow-[0_0_20px_-10px_rgba(0,255,136,0.5)]" 
                  : "border-border hover:border-muted-foreground/30 bg-muted/10"
              }`}
            >
              <div className={`p-3 rounded-xl ${method === 'enot' ? "bg-primary text-black" : "bg-muted text-muted-foreground"}`}>
                <CreditCard className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <div className="font-bold flex items-center justify-between">
                  Карты / СБП
                  {method === 'enot' && <CheckCircle2 className="w-4 h-4" />}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Enot.io — Мир, Visa, MC, СБП</div>
              </div>
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Button 
          className="w-full h-16 text-xl font-bold bg-primary text-black hover:bg-primary/90 rounded-2xl shadow-lg shadow-primary/20 neon-glow"
          onClick={handlePayment}
          disabled={isProcessing || !amount}
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Создание счета...
            </>
          ) : (
            `Пополнить на ${parseFloat(amount) || 0} ₽`
          )}
        </Button>
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground text-center">
          <AlertCircle className="w-4 h-4 text-primary" />
          Нажимая кнопку, вы подтверждаете условия оферты
        </p>
      </div>
    </div>
  );
}
