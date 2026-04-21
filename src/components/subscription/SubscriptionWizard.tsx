import React, { useState, useEffect } from 'react';
import { 
  Check, 
  ChevronRight, 
  ChevronLeft, 
  CreditCard, 
  Server, 
  Smartphone, 
  ShieldCheck,
  AlertCircle,
  Clock,
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const steps = [
  { id: 1, title: 'Период', icon: Clock },
  { id: 2, title: 'Серверы', icon: Server },
  { id: 3, title: 'Устройства', icon: Smartphone },
  { id: 4, title: 'Оплата', icon: CreditCard },
];

const periods = [
  { id: '1m', label: '1 месяц', price: 149, originalPrice: 149, days: 30 },
  { id: '2m', label: '2 месяца', price: 289, originalPrice: 298, discount: '3%', days: 60 },
  { id: '6m', label: '6 месяцев', price: 799, originalPrice: 894, discount: '10%', days: 180 },
  { id: '12m', label: '12 месяцев', price: 1490, originalPrice: 1788, discount: '17%', days: 365 },
];

const serverTypes = [
  { id: 'lte', label: 'LTE', description: 'Высокая скорость', price: 100 },
  { id: 'wifi', label: 'Wi-Fi', description: 'Стандартный доступ', price: 0 },
];

export function SubscriptionWizard({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [selectedPeriod, setSelectedPeriod] = useState(periods[0]);
  const [selectedServer, setSelectedServer] = useState(serverTypes[0]);
  const [deviceCount, setDeviceCount] = useState(1);
  const [balance, setBalance] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!user) return;
      const { data } = await supabase.from('balances').select('amount').eq('user_id', user.id).maybeSingle();
      if (data) setBalance(Number(data.amount));
    };
    fetchBalance();
  }, [user]);

  const totalPrice = selectedPeriod.price + selectedServer.price + (deviceCount > 1 ? (deviceCount - 1) * 25 : 0);
  const hasEnoughFunds = balance !== null && balance >= totalPrice;

  const nextStep = () => setStep(s => Math.min(s + 1, 4));
  const prevStep = () => setStep(s => Math.max(s - 1, 1));

  const handlePayment = async () => {
    if (!user || !hasEnoughFunds || isProcessing) return;

    setIsProcessing(true);
    const toastId = toast.loading('Обработка платежа...');

    try {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiUrl}/api/subscription/buy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          planId: selectedPeriod.id,
          planName: `${selectedPeriod.label} (${selectedServer.label})`,
          price: totalPrice,
          durationDays: selectedPeriod.days,
          periodMonths: Math.round(selectedPeriod.days / 30),
          serverType: selectedServer.label,
          deviceLimit: deviceCount
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Ошибка при покупке');
      }

      toast.success('Подписка успешно активирована!', { id: toastId });
      onClose();
      // Use a smoother way to refresh data if possible, but reload works for now
      window.location.reload(); 
    } catch (error: any) {
      console.error('Payment error:', error);
      toast.error(error.message || 'Ошибка при оплате. Попробуйте позже.', { id: toastId });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8 p-1">
      {/* Progress */}
      <div className="space-y-4">
        <div className="flex justify-between text-xs font-medium text-muted-foreground uppercase tracking-wider">
          <span>Шаг {step} из 4</span>
          <span>{steps[step - 1].title}</span>
        </div>
        <Progress value={(step / 4) * 100} className="h-1.5 bg-muted" />
      </div>

      <div className="min-h-[300px]">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <h3 className="text-lg font-bold">Выберите период подписки</h3>
              <div className="grid grid-cols-2 gap-4">
                {periods.map((p) => (
                  <Card 
                    key={p.id}
                    className={cn(
                      "cursor-pointer transition-all border-2",
                      selectedPeriod.id === p.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
                    )}
                    onClick={() => setSelectedPeriod(p)}
                  >
                    <CardContent className="p-4 space-y-2">
                      <div className="flex justify-between items-start">
                        <span className="font-bold">{p.label}</span>
                        {p.discount && <Badge className="bg-primary text-black text-[10px] h-4 px-1">{p.discount}</Badge>}
                      </div>
                      <div className="text-xl font-bold">{p.price} ₽</div>
                      {p.originalPrice > p.price && (
                        <div className="text-xs text-muted-foreground line-through">{p.originalPrice} ₽</div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <h3 className="text-lg font-bold">Тип сервера</h3>
              <div className="space-y-3">
                {serverTypes.map((s) => (
                  <Card 
                    key={s.id}
                    className={cn(
                      "cursor-pointer transition-all border-2",
                      selectedServer.id === s.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"
                    )}
                    onClick={() => setSelectedServer(s)}
                  >
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", selectedServer.id === s.id ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground")}>
                          <Server className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-bold">{s.label}</div>
                          <div className="text-xs text-muted-foreground">{s.description}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{s.price > 0 ? `+${s.price} ₽` : 'Бесплатно'}</div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6 text-center"
            >
              <h3 className="text-lg font-bold">Количество устройств</h3>
              <div className="flex items-center justify-center gap-8">
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="rounded-full w-12 h-12 border-primary/50 text-primary"
                  onClick={() => setDeviceCount(Math.max(1, deviceCount - 1))}
                >
                  -
                </Button>
                <div className="text-5xl font-bold">{deviceCount}</div>
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="rounded-full w-12 h-12 border-primary/50 text-primary"
                  onClick={() => setDeviceCount(Math.min(10, deviceCount + 1))}
                >
                  +
                </Button>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">1 устройство включено в тариф</p>
                <p className="text-xs text-primary font-medium">+25.00 ₽ за каждое доп. устройство</p>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <h3 className="text-lg font-bold">Подтверждение заказа</h3>
              <div className="space-y-3 p-4 rounded-2xl bg-muted/30 border border-border">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Тариф ({selectedPeriod.label})</span>
                  <span>{selectedPeriod.price} ₽</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Серверы ({selectedServer.label})</span>
                  <span>{selectedServer.price} ₽</span>
                </div>
                {deviceCount > 1 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Доп. устройства ({deviceCount - 1})</span>
                    <span>{(deviceCount - 1) * 25} ₽</span>
                  </div>
                )}
                <div className="pt-3 border-t border-border flex justify-between font-bold text-lg">
                  <span>Итого к оплате</span>
                  <span className="text-primary neon-text">{totalPrice} ₽</span>
                </div>
              </div>

              <div className="flex justify-between items-center text-sm p-2">
                <span className="text-muted-foreground">Ваш баланс:</span>
                <span className={cn("font-bold", hasEnoughFunds ? "text-primary" : "text-destructive")}>
                  {balance !== null ? `${balance.toFixed(2)} ₽` : '...'}
                </span>
              </div>

              {!hasEnoughFunds && balance !== null && (
                <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/20 flex gap-3 items-center">
                  <AlertCircle className="w-5 h-5 text-destructive" />
                  <div className="flex-1 text-sm">
                    Недостаточно средств на балансе. Нужно еще {(totalPrice - balance).toFixed(2)} ₽
                  </div>
                  <Button size="sm" variant="destructive" className="rounded-lg h-8" onClick={() => window.location.reload()}>
                    Пополнить
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex gap-3 pt-4 border-t border-border">
        {step > 1 && (
          <Button variant="outline" className="flex-1 rounded-xl" onClick={prevStep} disabled={isProcessing}>
            <ChevronLeft className="mr-2 w-4 h-4" /> Назад
          </Button>
        )}
        <Button 
          className="flex-1 bg-primary text-black hover:bg-primary/90 rounded-xl neon-glow"
          onClick={step === 4 ? handlePayment : nextStep}
          disabled={(step === 4 && (!hasEnoughFunds || isProcessing)) || isProcessing}
        >
          {isProcessing ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : step === 4 ? (
            'Оплатить'
          ) : (
            'Далее'
          )} 
          {step < 4 && <ChevronRight className="ml-2 w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
