import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Check, 
  ChevronRight, 
  ChevronLeft, 
  CreditCard, 
  Smartphone, 
  ShieldCheck,
  AlertCircle,
  Loader2,
  Zap
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
  { id: 1, title: 'Тариф', icon: ShieldCheck },
  { id: 2, title: 'Устройства', icon: Smartphone },
  { id: 3, title: 'Оплата', icon: CreditCard },
];

export function SubscriptionWizard({ onClose, forceNew = false, targetDeviceId, targetDeviceName, hasActiveSub = false, existingDeviceCount = 0 }: { onClose: () => void, forceNew?: boolean, targetDeviceId?: string, targetDeviceName?: string, hasActiveSub?: boolean, existingDeviceCount?: number }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [periods, setPeriods] = useState<any[]>([]);
  const [serverTypes, setServerTypes] = useState<any[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<any>(null);
  const [selectedServer, setSelectedServer] = useState<any>(null);
  const [maxDeviceLimit, setMaxDeviceLimit] = useState(2);
  const [deviceCount, setDeviceCount] = useState(existingDeviceCount > 0 && !targetDeviceId && !forceNew ? existingDeviceCount : 1);
  const [deviceName, setDeviceName] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);

  useEffect(() => {
    if (existingDeviceCount > 0 && !targetDeviceId && !forceNew) {
      setDeviceCount(existingDeviceCount);
    }
  }, [existingDeviceCount, targetDeviceId, forceNew]);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!user) return;
      const { data } = await supabase.from('balances').select('amount').eq('user_id', user.id).maybeSingle();
      if (data) setBalance(Number(data.amount));
    };

    const fetchPlans = async () => {
      try {
        const response = await fetch('/api/subscription/plans');
        const data = await response.json();
        setPeriods(data.periods || []);
        setServerTypes(data.serverTypes || []);
        setMaxDeviceLimit(data.deviceLimit || 2);
        
        if (data.periods?.length > 0) setSelectedPeriod(data.periods[0]);
        if (data.serverTypes?.length > 0) setSelectedServer(data.serverTypes[0]);
      } catch (e) {
        console.error('Failed to fetch plans');
      } finally {
        setIsLoadingPlans(false);
      }
    };

    fetchBalance();
    fetchPlans();
  }, [user]);

  // If forceNew is true or targetDeviceId is present, we enforce count = 1 for the transaction
  const effectiveDeviceCount = (forceNew || targetDeviceId) ? 1 : deviceCount;

  // Price calculation
  const totalPrice = (selectedPeriod && selectedServer) ? (selectedPeriod.price + selectedServer.price) * effectiveDeviceCount : 0;
  const hasEnoughFunds = balance !== null && balance >= totalPrice;

  const nextStep = () => {
    // Skip to payment (step 3) skipping device selection (step 2) if renewing specific or all devices
    if (step === 1 && (targetDeviceId || (!forceNew && existingDeviceCount > 0 && hasActiveSub))) {
      setStep(3);
      return;
    }
    setStep(s => Math.min(s + 1, 3));
  };
  
  const prevStep = () => {
    // If we are on step 3, and we skipped step 2, go straight back to 1
    if (step === 3 && (targetDeviceId || (!forceNew && existingDeviceCount > 0 && hasActiveSub))) {
      setStep(1);
      return;
    }
    setStep(s => Math.max(s - 1, 1));
  };

  const handlePayment = async () => {
    if (!user || !hasEnoughFunds || isProcessing) return;

    setIsProcessing(true);
    const toastId = toast.loading('Обработка платежа...');

    try {
      const envUrl = import.meta.env.VITE_API_URL;
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const apiUrl = (isLocal && envUrl && envUrl.startsWith('http')) ? envUrl.replace(/\/$/, '') : '';
      const displayPlanName = selectedServer?.label || 'Wi-Fi';
      
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
    <div className="space-y-4 md:space-y-5 p-0.5">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
          <span>Шаг {step} из 3</span>
          <span>{steps[step - 1].title}</span>
        </div>
        <Progress value={(step / 3) * 100} className="h-1 bg-muted" />
      </div>

      <div className="min-h-[220px]">
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
                <h3 className="text-base font-bold tracking-tight">Выберите тарифный план</h3>
                {targetDeviceId && (
                   <Badge variant="outline" className="border-primary/50 text-primary text-[9px] uppercase px-1.5 h-5">
                     Продление: {targetDeviceName}
                   </Badge>
                )}
              </div>

              {/* Class Selection - only show if multiple styles exist */}
              {serverTypes.length > 1 && (
                <div className="flex p-1 bg-muted/30 rounded-xl border border-white/5">
                  {isLoadingPlans ? (
                    <div className="w-full py-2 flex justify-center">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    </div>
                  ) : (
                    serverTypes.map((s) => (
                      <button
                        key={s.id}
                        className={cn(
                          "flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all relative overflow-hidden",
                          selectedServer?.id === s.id ? "bg-primary text-black shadow-md shadow-primary/10" : "text-muted-foreground hover:text-foreground"
                        )}
                        onClick={() => setSelectedServer(s)}
                      >
                        {s.label}
                      </button>
                    ))
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                {isLoadingPlans ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-20 bg-white/5 animate-pulse rounded-xl" />
                  ))
                ) : (
                  periods.map((p) => (
                    <Card 
                      key={p.id}
                      className={cn(
                        "cursor-pointer transition-all border relative group",
                        selectedPeriod?.id === p.id ? "border-primary bg-primary/5 shadow-inner" : "border-white/5 bg-white/[0.01] hover:border-primary/30"
                      )}
                      onClick={() => setSelectedPeriod(p)}
                    >
                      <CardContent className="p-3 space-y-1.5">
                         <div className="flex justify-between items-start">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{p.label}</span>
                          {p.discount && <Badge className="bg-primary text-black text-[8px] h-3.5 px-1 font-black">{p.discount}</Badge>}
                        </div>
                        <div className="text-lg font-black tracking-tight flex items-baseline gap-0.5">
                          {(p.price || 0) + (selectedServer?.price || 0)} <span className="text-xs font-medium">₽</span>
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {p.days} дней доступа
                        </div>
                      </CardContent>
                      {selectedPeriod?.id === p.id && (
                        <div className="absolute -top-1.5 -right-1.5 bg-primary text-black rounded-full p-0.5 shadow-md">
                          <Check size={10} />
                        </div>
                      )}
                    </Card>
                  ))
                )}
              </div>

              {!isLoadingPlans && selectedServer && (
                <div className="p-2.5 rounded-xl bg-primary/5 border border-primary/20 flex gap-2.5 items-center">
                  <Zap className="w-4 h-4 text-primary shrink-0 animate-pulse" />
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Стабильное Wi-Fi/LTE подключение для любых ваших устройств без ограничений по трафику и скорости.
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4 text-center py-2"
            >
              {forceNew ? (
                <>
                  <h3 className="text-base font-bold">Название устройства</h3>
                  <div className="flex flex-col items-center justify-center gap-3 text-left">
                    <p className="text-xs text-muted-foreground w-full">
                      Задайте понятное имя для вашего нового устройства (например: Ноутбук, Телефон Жены).
                    </p>
                    <Input 
                      placeholder="Например: Мой ПК"
                      value={deviceName}
                      onChange={(e) => setDeviceName(e.target.value)}
                      className="h-10 w-full text-sm border-primary/30 focus-visible:ring-primary/50 rounded-xl"
                    />
                  </div>
                  <p className="text-[9px] italic text-muted-foreground">Это поможет вам отличать устройства в списке</p>
                </>
              ) : (
                <>
                  <h3 className="text-base font-bold">Количество устройств</h3>
                  <div className="flex items-center justify-center gap-6 py-1">
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="rounded-full w-10 h-10 border-primary/40 text-primary hover:bg-primary/20"
                      onClick={() => setDeviceCount(Math.max(1, deviceCount - 1))}
                    >
                      <ChevronLeft size={16} />
                    </Button>
                    <div className="text-4xl font-black tracking-tight">{deviceCount}</div>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="rounded-full w-10 h-10 border-primary/40 text-primary hover:bg-primary/20"
                      onClick={() => setDeviceCount(Math.min(maxDeviceLimit, deviceCount + 1))}
                    >
                      <ChevronRight size={16} />
                    </Button>
                  </div>
                  <div className="space-y-1 text-muted-foreground text-xs">
                    <p>Вы заказываете {deviceCount} {deviceCount === 1 ? 'ключ' : 'ключа'}</p>
                    <p className="text-[9px] italic text-primary/70">Согласно правилам izinet, доступно не более {maxDeviceLimit}-х устройств на один аккаунт</p>
                  </div>
                </>
              )}
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <h3 className="text-base font-bold">Подтверждение заказа</h3>
              <div className="space-y-2 p-3.5 rounded-2xl bg-white/[0.02] border border-white/5">
                <div className="flex justify-between text-xs py-0.5">
                  <span className="text-muted-foreground italic">Срок подписки</span>
                  <span className="font-bold">{selectedPeriod.label}</span>
                </div>
                {deviceCount > 1 && !forceNew && !targetDeviceId && (
                  <div className="flex justify-between text-xs py-0.5 border-t border-white/5 pt-1.5">
                    <span className="text-muted-foreground italic">Количество устройств</span>
                    <span className="font-bold text-primary">x{deviceCount}</span>
                  </div>
                )}
                {forceNew && deviceName && (
                  <div className="flex justify-between text-xs py-0.5 border-t border-white/5 pt-1.5">
                    <span className="text-muted-foreground italic">Доп. устройство</span>
                    <span className="font-medium text-foreground">{deviceName}</span>
                  </div>
                )}
                {targetDeviceId && (
                  <div className="flex justify-between text-xs py-0.5 border-t border-white/5 pt-1.5">
                    <span className="text-muted-foreground italic">Операция</span>
                    <span className="font-medium text-primary">Продление устройства</span>
                  </div>
                )}
                {!targetDeviceId && !forceNew && existingDeviceCount > 0 && hasActiveSub && (
                  <div className="flex justify-between text-xs py-0.5 border-t border-white/5 pt-1.5">
                    <span className="text-muted-foreground italic">Операция</span>
                    <span className="font-medium text-primary">Продление подписки ({deviceCount} шт.)</span>
                  </div>
                )}
                <div className="pt-3 border-t border-primary/20 flex justify-between items-center">
                  <span className="font-black text-xs uppercase tracking-wider">К оплате</span>
                  <div className="text-right">
                    <span className="text-2xl font-black text-primary neon-text tracking-tight">{totalPrice} ₽</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center text-xs px-1">
                <span className="text-muted-foreground">Ваш баланс:</span>
                <span className={cn("font-bold", hasEnoughFunds ? "text-primary" : "text-destructive")}>
                  {balance !== null ? `${Number(balance).toFixed(0)} ₽` : '...'}
                </span>
              </div>

              {!hasEnoughFunds && balance !== null && (
                <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 flex gap-2.5 items-center">
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
                  <div className="flex-1 text-xs leading-snug">
                    Недостаточно средств. Нужно еще {(totalPrice - balance).toFixed(0)} ₽
                  </div>
                  <Button size="sm" variant="destructive" className="rounded-lg h-7 text-xs px-2.5" onClick={() => { onClose(); navigate('/wallet'); }}>
                    Пополнить
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex gap-2.5 pt-3 border-t border-border">
        {step > 1 && (
          <Button variant="outline" className="flex-1 rounded-xl h-10 text-xs" onClick={prevStep} disabled={isProcessing}>
            <ChevronLeft className="mr-1.5 w-3.5 h-3.5" /> Назад
          </Button>
        )}
        <Button 
          className="flex-1 bg-primary text-black hover:bg-primary/95 rounded-xl h-10 text-xs neon-glow font-bold"
          onClick={step === 3 ? handlePayment : nextStep}
          disabled={(step === 3 && (!hasEnoughFunds || isProcessing)) || isProcessing}
        >
          {isProcessing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
          ) : step === 3 ? (
            'Оплатить'
          ) : (
            'Далее'
          )} 
          {step < 3 && <ChevronRight className="ml-1.5 w-3.5 h-3.5" />}
        </Button>
      </div>
    </div>
  );
}

