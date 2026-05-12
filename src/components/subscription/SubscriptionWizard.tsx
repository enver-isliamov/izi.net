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
  Loader2,
  Globe,
  Zap,
  CheckCircle2
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
  { id: 2, title: 'Локация', icon: Globe },
  { id: 3, title: 'Устройства', icon: Smartphone },
  { id: 4, title: 'Оплата', icon: CreditCard },
];

export function SubscriptionWizard({ onClose, forceNew = false, targetDeviceId, targetDeviceName, hasActiveSub = false, existingDeviceCount = 0 }: { onClose: () => void, forceNew?: boolean, targetDeviceId?: string, targetDeviceName?: string, hasActiveSub?: boolean, existingDeviceCount?: number }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [periods, setPeriods] = useState<any[]>([]);
  const [serverTypes, setServerTypes] = useState<any[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<any>(null);
  const [selectedServer, setSelectedServer] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<any>(null);
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

    const fetchLocations = async () => {
      try {
        const response = await fetch('/api/locations');
        const data = await response.json();
        setLocations(data);
        if (data.length > 0) setSelectedLocation(data[0]);
      } catch (e) {
        console.error('Failed to fetch locations');
      }
    };

    fetchBalance();
    fetchPlans();
    fetchLocations();
  }, [user]);

  // If forceNew is true or targetDeviceId is present, we enforce count = 1 for the transaction
  const effectiveDeviceCount = (forceNew || targetDeviceId) ? 1 : deviceCount;

  // Price calculation
  const totalPrice = (selectedPeriod && selectedServer) ? (selectedPeriod.price + selectedServer.price) * effectiveDeviceCount : 0;
  const hasEnoughFunds = balance !== null && balance >= totalPrice;

  const nextStep = () => {
    // If targetDeviceId is present, or if extending all existing devices, skip to payment
    if (targetDeviceId || (!forceNew && existingDeviceCount > 0 && hasActiveSub)) {
      if (step === 1) { // After combined Plan step
        setStep(4); // Go straight to payment
        return;
      }
    }
    setStep(s => {
      let next = Math.min(s + 1, 4);
      // Skip Location step ONLY if we are renewing a specific device, or extending whole sub
      if (next === 2 && (targetDeviceId || (!forceNew && existingDeviceCount > 0 && hasActiveSub))) {
        next = 3;
      }
      // If we are on step 2 (via normal flow), and we need to skip step 3 (devices) because we are renewing all
      if (next === 3 && !forceNew && existingDeviceCount > 0 && hasActiveSub) {
        next = 4;
      }
      return next;
    });
  };
  
  const prevStep = () => {
    if ((targetDeviceId || (!forceNew && existingDeviceCount > 0 && hasActiveSub)) && step === 4) {
      setStep(1);
      return;
    }
    setStep(s => {
      let prev = Math.max(s - 1, 1);
      // Skip Location step back ONLY if we are renewing a specific device or extending whole sub
      if (prev === 2 && (targetDeviceId || (!forceNew && existingDeviceCount > 0 && hasActiveSub))) {
        prev = 1;
      }
      // If we are on step 4, and need to skip step 3 back to 2
      if (prev === 3 && !forceNew && existingDeviceCount > 0 && hasActiveSub) {
        prev = 2;
      }
      return prev;
    });
  };

  const handlePayment = async () => {
    if (!user || !hasEnoughFunds || isProcessing) return;

    setIsProcessing(true);
    const toastId = toast.loading('Обработка платежа...');

    try {
      const envUrl = import.meta.env.VITE_API_URL;
      const apiUrl = (envUrl && envUrl.startsWith('http')) ? envUrl.replace(/\/$/, '') : window.location.origin;
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
          deviceName: deviceName,
          serverId: targetDeviceId ? undefined : selectedLocation?.id
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
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">Выберите тарифный план</h3>
                {targetDeviceId && (
                   <Badge variant="outline" className="border-primary/50 text-primary text-[10px] uppercase">
                     Продление: {targetDeviceName}
                   </Badge>
                )}
              </div>

              {/* Class Selection */}
              <div className="flex p-1 bg-muted/30 rounded-2xl border border-white/5">
                {isLoadingPlans ? (
                  <div className="w-full py-3 flex justify-center">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  </div>
                ) : (
                  serverTypes.map((s) => (
                    <button
                      key={s.id}
                      className={cn(
                        "flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all relative overflow-hidden",
                        selectedServer?.id === s.id ? "bg-primary text-black shadow-lg shadow-primary/20" : "text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => setSelectedServer(s)}
                    >
                      {s.label}
                    </button>
                  ))
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                {isLoadingPlans ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-24 bg-white/5 animate-pulse rounded-xl" />
                  ))
                ) : (
                  periods.map((p) => (
                    <Card 
                      key={p.id}
                      className={cn(
                        "cursor-pointer transition-all border-2 relative group",
                        selectedPeriod?.id === p.id ? "border-primary bg-primary/5" : "border-white/5 bg-white/[0.02] hover:border-primary/30"
                      )}
                      onClick={() => setSelectedPeriod(p)}
                    >
                      <CardContent className="p-4 space-y-2">
                         <div className="flex justify-between items-start">
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{p.label}</span>
                          {p.discount && <Badge className="bg-primary text-black text-[9px] h-4 px-1 font-black">{p.discount}</Badge>}
                        </div>
                        <div className="text-xl font-black">
                          {(p.price || 0) + (selectedServer?.price || 0)} <span className="text-sm">₽</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {p.days} дней доступа
                        </div>
                      </CardContent>
                      {selectedPeriod?.id === p.id && (
                        <div className="absolute -top-2 -right-2 bg-primary text-black rounded-full p-1 shadow-lg">
                          <Check size={12} />
                        </div>
                      )}
                    </Card>
                  ))
                )}
              </div>

              {!isLoadingPlans && selectedServer && (
                <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20 flex gap-4 items-center">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Zap className={cn("w-5 h-5", selectedServer.id === 'lte' ? 'text-primary' : 'text-primary/60')} />
                  </div>
                  <div className="flex-1">
                      <div className="text-xs font-bold uppercase tracking-widest text-primary">{selectedServer.label} План</div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">
                        {selectedServer.id === 'lte' 
                          ? 'Максимальная скорость, выделенные каналы для стриминга и игр.' 
                          : 'Стабильный доступ для повседневного использования и соцсетей.'}
                      </p>
                  </div>
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
              className="space-y-4"
            >
              <h3 className="text-lg font-bold">Выберите локацию сервера</h3>
              <div className="grid grid-cols-1 gap-3">
                {locations.length > 0 ? (
                  locations.map((loc) => (
                    <Card 
                      key={loc.id}
                      className={cn(
                        "cursor-pointer transition-all border-2 relative overflow-hidden",
                        selectedLocation?.id === loc.id 
                          ? "border-primary bg-primary/5 shadow-lg shadow-primary/20 ring-1 ring-primary/50" 
                          : "border-white/5 bg-white/5 hover:border-primary/40 hover:bg-white/10"
                      )}
                      onClick={() => {
                        console.log('📍 Selected Location:', loc.name, loc.id);
                        setSelectedLocation(loc);
                      }}
                    >
                      <CardContent className="p-4 flex items-center justify-between relative z-10">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center font-bold text-xs uppercase text-primary">
                            {loc.location_code}
                          </div>
                          <span className="font-medium">{loc.name}</span>
                        </div>
                        {selectedLocation?.id === loc.id && <CheckCircle2 size={18} className="text-primary" />}
                      </CardContent>
                    </Card>
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 opacity-20" />
                    <p>Загрузка доступных локаций...</p>
                  </div>
                )}
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
                      className="h-12 w-full text-lg border-primary/30 focus-visible:ring-primary/50 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2 text-muted-foreground text-sm">
                    <p className="text-[10px] italic">Это поможет вам отличать устройства в списке</p>
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
                      <ChevronLeft />
                    </Button>
                    <div className="text-5xl font-black">{deviceCount}</div>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      className="rounded-full w-12 h-12 border-primary/50 text-primary"
                      onClick={() => setDeviceCount(Math.min(maxDeviceLimit, deviceCount + 1))}
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                  <div className="space-y-2 text-muted-foreground text-sm">
                    <p>Вы заказываете {deviceCount} {deviceCount === 1 ? 'ключ' : 'ключа'}</p>
                    <p className="text-[10px] italic text-primary/70">Согласно правилам izinet, доступно не более {maxDeviceLimit}-х устройств на один аккаунт</p>
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
              <div className="space-y-3 p-5 rounded-3xl bg-white/[0.03] border border-white/5">
                <div className="flex justify-between text-xs py-1">
                  <span className="text-muted-foreground italic">Выбранный тариф</span>
                  <span className="font-black text-primary uppercase">{selectedServer.id === 'lte' ? 'LTE ПРЕМИУМ' : 'WI-FI СТАНДАРТ'}</span>
                </div>
                {selectedLocation && (
                  <div className="flex justify-between text-xs py-1 border-t border-white/5 pt-2">
                    <span className="text-muted-foreground italic">Локация</span>
                    <span className="font-bold">{selectedLocation.name}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs py-1 border-t border-white/5 pt-2">
                  <span className="text-muted-foreground italic">Срок подписки</span>
                  <span className="font-bold">{selectedPeriod.label}</span>
                </div>
                {deviceCount > 1 && !forceNew && !targetDeviceId && (
                  <div className="flex justify-between text-xs py-1 border-t border-white/5 pt-2">
                    <span className="text-muted-foreground italic">Количество устройств</span>
                    <span className="font-bold text-primary">x{deviceCount}</span>
                  </div>
                )}
                {forceNew && deviceName && (
                  <div className="flex justify-between text-xs py-1 border-t border-white/5 pt-2">
                    <span className="text-muted-foreground italic">Доп. устройство</span>
                    <span className="font-medium text-foreground">{deviceName}</span>
                  </div>
                )}
                {targetDeviceId && (
                  <div className="flex justify-between text-xs py-1 border-t border-white/5 pt-2">
                    <span className="text-muted-foreground italic">Операция</span>
                    <span className="font-medium text-primary">Продление устройства</span>
                  </div>
                )}
                {!targetDeviceId && !forceNew && existingDeviceCount > 0 && hasActiveSub && (
                  <div className="flex justify-between text-xs py-1 border-t border-white/5 pt-2">
                    <span className="text-muted-foreground italic">Операция</span>
                    <span className="font-medium text-primary">Продление подписки ({deviceCount} шт.)</span>
                  </div>
                )}
                <div className="pt-4 border-t border-primary/20 flex justify-between items-center">
                  <span className="font-black text-sm uppercase tracking-wider">К оплате</span>
                  <div className="text-right">
                    <span className="text-3xl font-black text-primary neon-text tracking-tighter">{totalPrice} ₽</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center text-xs px-2">
                <span className="text-muted-foreground">Ваш баланс:</span>
                <span className={cn("font-bold", hasEnoughFunds ? "text-primary" : "text-destructive")}>
                  {balance !== null ? `${Number(balance).toFixed(0)} ₽` : '...'}
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
          className="flex-1 bg-primary text-black hover:bg-primary/90 rounded-xl neon-glow font-bold"
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
