import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Wallet, ShieldCheck, Zap, ArrowRight, CheckCircle } from 'lucide-react';

export function WelcomeWizard() {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1);

  useEffect(() => {
    const isCompleted = localStorage.getItem('izinet_tutorial_completed');
    if (!isCompleted) {
      setIsOpen(true);
    }
  }, []);

  const handleClose = () => {
    setIsOpen(false);
    localStorage.setItem('izinet_tutorial_completed', 'true');
  };

  const nextStep = () => {
    if (step < 3) {
      setStep(step + 1);
    } else {
      handleClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px] bg-[#0a0c10] border-white/10 p-6">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            Добро пожаловать в izinet! 🚀
          </DialogTitle>
          <DialogDescription className="text-muted-foreground mt-2">
            Пару простых шагов, чтобы начать пользоваться быстрым и безопасным интернетом.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {step === 1 && (
            <div className="flex flex-col items-center text-center space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 mb-2">
                <Wallet className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white">Шаг 1. Пополнение кошелька</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Сначала пополните ваш внутренний баланс в разделе <b>«Кошелек»</b>. Вы можете оплатить картой (РФ) или по СБП. Все средства зачислятся моментально.
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col items-center text-center space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 mb-2">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white">Шаг 2. Активация подписки</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Зайдите на главную страницу и нажмите <b>«Активировать»</b>. Средства спишутся с вашего баланса, и вы получите персональный секретный ключ-ссылку.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center text-center space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="w-16 h-16 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400 mb-2">
                <Zap className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-white">Шаг 3. Как это работает?</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Вам нужно будет скачать специальное приложение (например, INCY), вставить ваш ключ и нажать Подключить.
                Оно автоматически настроит <b>умный обход</b> — все российские сайты (Госуслуги, Банки) будут работать напрямую, а остальной мир через нашу сеть.
              </p>
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg">
                <CheckCircle className="w-4 h-4" />
                Все очень просто!
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-row items-center gap-2 sm:gap-0 mt-4">
          <div className="flex gap-1 flex-1">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  step === i ? 'w-6 bg-emerald-400' : 'w-2 bg-white/10'
                }`}
              />
            ))}
          </div>
          <Button
            onClick={nextStep}
            className="bg-primary text-black hover:bg-primary/90 font-bold px-6 shrink-0"
          >
            {step < 3 ? (
              <>Далее <ArrowRight className="w-4 h-4 ml-1.5" /></>
            ) : (
              'Понятно, начать!'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
