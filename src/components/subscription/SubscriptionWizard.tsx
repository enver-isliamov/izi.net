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
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const steps = [
  { id: 1, title: 'Период', icon: Clock },
  { id: 2, title: 'Класс', icon: Server },
  { id: 3, title: 'Устройства', icon: Smartphone },
  { id: 4, title: 'Оплата', icon: CreditCard },
];

const periods = [
  { id: '1m', label: '1 месяц', price: 100, originalPrice: 100, days: 30 },
  { id: '2m', label: '2 месяца', price: 190, originalPrice: 200, discount: '5%', days: 60 },
  { id: '6m', label: '6 месяцев', price: 500, originalPrice: 600, discount: '17%', days: 180 },
  { id: '12m', label: '12 месяцев', price: 900, originalPrice: 1200, discount: '25%', days: 365 },
];

const serverTypes = [
  { id: 'wifi', label: 'Wi-Fi', description: 'Стандартный доступ (100 ₽/мес)', price: 0 },
  { id: 'lte', label: 'LTE', description: 'Премиум скорость (150 ₽/мес)', price: 50 },
];

export function SubscriptionWizard({ onClose, forceNew = false, targetDeviceId, targetDeviceName }: { onClose: () => void, forceNew?: boolean, targetDeviceId?: string, targetDeviceName?: string }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [selectedPeriod, setSelectedPeriod] = useState(periods[0]);
  const [selectedServer, setSelectedServer] = useState(serverTypes[0]);
  const [deviceCount, setDeviceCount] = useState(1);
  const [deviceName, setDeviceName] = useState('');
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

  // If forceNew is true or targetDeviceId is present, we enforce count = 1 for the transaction
  const effectiveDeviceCount = (forceNew || targetDeviceId) ? 1 : deviceCount;

  // Price calculation
  const totalPrice = (selectedPeriod.price + selectedServer.price) * effectiveDeviceCount;
  const hasEnoughFunds = balance !== null && balance >= totalPrice;

  const nextStep = () => {
    // Skip device selection step if we are targetting a specific device to renew
    if (targetDeviceId && step === 2) {
      setStep(4);
    } else {
      setStep(s => Math.min(s + 1, 4));
    }
  };
  
  const prevStep = () => {
    // If we skipped step 3, go back from 4 straight to 2
    if (targetDeviceId && step === 4) {
      setStep(2);
    } else {
      setStep(s => Math.max(s - 1, 1));
    }
  };

  const handlePayment = async () => {
    if (!user || !hasEnoughFunds || isProcessing) return;

    setIsProcessing(true);
    const toastId = toast.loading('Обработка платежа...');

    try {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      const displayPlanName = selectedServer.id === 'lte' ? 'LTE' : 'Wi-Fi';
      
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(`${apiUrl}/api/subscription/buy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          userId: user.id,
          planId: selectedPeriod.id,
          planName: displayPlanName,
          price: totalPrice,
          durationDays: selectedPeriod.days,
          periodMonths: Math.round(selectedPeriod.days / 30),
          serverType: selectedServer.id.toUpperCase(),
          deviceLimit: effectiveDeviceCount,
          forceNew: forceNew,
          targetDeviceId: targetDeviceId,
          deviceName: deviceName
        }),
      });

      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        console.error('Non-JSON API response:', responseText);
        if (responseText.includes('Please wait while your application starts')) {
          throw new Error('Сервер обновляется. Пожалуйста, подождите пару секунд и попробуйте снова.');
        }
        throw new Error(`Неизвестная ошибка сервера (Код: ${response.status}). Пожалуйста, обратитесь в поддержку.`);
      }

      if (!response.ok) {
        throw new Error(result.error || 'Ошибка при покупке');
      }

      toast.success('Подписка успешно активирована!', { id: toastId });
      onClose();
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
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">Выберите период подписки</h3>
                {targetDeviceId && targetDeviceName && (
                  <Badge variant="outline" className="border-primary/50 text-primary text-xs">
                    Продление: {targetDeviceName}
                  </Badge>
                )}
              </div>
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
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">Класс подключения</h3>
                {targetDeviceId && targetDeviceName && (
                  <Badge variant="outline" className="border-primary/50 text-primary text-xs">
                    Продление: {targetDeviceName}
                  </Badge>
                )}
              </div>
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
              {forceNew ? (
                <>
                  <h3 className="text-lg font-bold">Название устройства</h3>
                  <div className="flex flex-col items-center justify-center gap-4 text-left">
                    <p className="text-sm text-muted-foreground w-full">
                      Задайте понятное имя для вашего нового устройства (например: Ноутбук, Телефон Жены).
                    </p>
                    <Input 
                      placeholder="Например: Мой ПК"
                      value={deviceName}
                      onChange={(e) => setDeviceName(e.target.value)}
                      className="h-12 w-full text-lg border-primary/30 focus-visible:ring-primary/50"
                    />
                  </div>
                  <div className="space-y-2 text-muted-foreground text-sm">
                    <p className="text-xs italic">Это поможет вам отличать устройства в списке</p>
                  </div>
                </>
              ) : (
                <>
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
                      onClick={() => setDeviceCount(Math.min(2, deviceCount + 1))}
                    >
                      +
                    </Button>
                  </div>
                  <div className="space-y-2 text-muted-foreground text-sm">
                    <p>Вы заказываете {deviceCount} {deviceCount === 1 ? 'ключ' : 'ключа'}</p>
                    <p className="text-xs italic text-primary/70">Согласно правилам izinet, доступно не более 2-х устройств на один аккаунт</p>
                  </div>
                </>
              )}
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
                <div className="flex justify-between text-sm py-1">
                  <span className="text-muted-foreground italic">Выбранный тариф</span>
                  <span className="font-bold text-primary uppercase">{selectedServer.id === 'lte' ? 'LTE' : 'Wi-Fi'}</span>
                </div>
                <div className="flex justify-between text-sm py-1 border-t border-border/50">
                  <span className="text-muted-foreground italic">Срок подписки</span>
                  <span>{selectedPeriod.label}</span>
                </div>
                {deviceCount > 1 && !forceNew && !targetDeviceId && (
                  <div className="flex justify-between text-sm py-1 border-t border-border/50">
                    <span className="text-muted-foreground italic">Количество устройств</span>
                    <span>x{deviceCount}</span>
                  </div>
                )}
                {forceNew && deviceName && (
                  <div className="flex justify-between text-sm py-1 border-t border-border/50">
                    <span className="text-muted-foreground italic">Доп. устройство</span>
                    <span className="font-medium text-foreground">{deviceName}</span>
                  </div>
                )}
                {targetDeviceId && (
                  <div className="flex justify-between text-sm py-1 border-t border-border/50">
                    <span className="text-muted-foreground italic">Операция</span>
                    <span className="font-medium text-primary">Продление устройства</span>
                  </div>
                )}
                <div className="pt-3 border-t border-primary/20 flex justify-between items-center">
                  <span className="font-bold">Итого к оплате</span>
                  <div className="text-right">
                    <span className="text-2xl font-black text-primary neon-text">{totalPrice} ₽</span>
                  </div>
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
