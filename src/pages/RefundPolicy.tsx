import React from 'react';
import { RefreshCcw, ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate, Link } from 'react-router-dom';
import { useAppConfig } from '@/hooks/useAppConfig';

export default function RefundPolicy() {
  const navigate = useNavigate();
  const { telegramBotName } = useAppConfig();
  const botLink = `https://t.me/${telegramBotName || 'izinet_bot'}`;

  return (
    <div className="min-h-screen bg-[#06080c] text-[#f1f4f7] p-4 sm:p-6 flex flex-col items-center relative overflow-hidden selection:bg-[#7bdcff]/30 selection:text-white">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[radial-gradient(ellipse_at_top,rgba(13,23,34,0.6)_0%,transparent_65%)]" />
      </div>

      <div className="w-full max-w-4xl space-y-6 relative z-10 animate-in fade-in duration-500 py-6">
        {/* Brand Header */}
        <div className="flex items-center justify-between pb-6 border-b border-white/[0.08]">
          <Link to="/" className="inline-flex items-center gap-2.5 group">
            <div className="relative w-8 h-8 rounded-full border border-cyan-400/60 shadow-[0_0_12px_rgba(123,220,255,0.35)] flex items-center justify-center bg-cyan-950/30 group-hover:border-cyan-300 transition-colors">
              <span className="w-2 h-2 rounded-full bg-[#8be5f0] shadow-[0_0_8px_#6ae6ff]" />
            </div>
            <span className="text-xl font-bold tracking-tight text-white">
              izi<span className="text-[#7bdcff]">net</span>
            </span>
          </Link>
          <Button 
            variant="outline" 
            onClick={() => navigate(-1)}
            className="bg-[#0e141b]/60 border-white/10 hover:bg-[#19232c] text-[#d6dce4] rounded-xl text-xs gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Назад
          </Button>
        </div>

        {/* Page Title */}
        <div className="flex items-center gap-3 pt-2">
          <div className="w-10 h-10 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl flex items-center justify-center text-[#7bdcff]">
            <RefreshCcw className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-white">
              Политика возвратов
            </h1>
            <p className="text-xs sm:text-sm text-[#8d959f]">Refund Policy & Правила отмены</p>
          </div>
        </div>

        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-2 sm:p-4 backdrop-blur-xl shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white">1. Характер предоставляемой услуги</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[#8d959f] leading-relaxed">
            <p>
              1.1. izinet предоставляет доступ к цифровому нематериальному контенту и генерации персональных сетевых конфигураций. В силу характера услуги доступ считается предоставленным в полном объёме с момента генерации цифрового ключа или подписки.
            </p>
            <p>
              1.2. Каждому новому пользователю предоставляется бесплатный 3-дневный пробный период, позволяющий всесторонне протестировать скорость и доступность сервиса до совершения оплаты.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-2 sm:p-4 backdrop-blur-xl shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white">2. Условия возврата средств</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[#8d959f] leading-relaxed">
            <p>
              2.1. Возврат средств возможен при обращении в службу поддержки в течение первых 24 часов с момента оплаты первого платного периода при условии, что сервис объективно был недоступен по вине инфраструктуры izinet и служба поддержки не смогла устранить проблему.
            </p>
            <p>
              2.2. При ошибочном повторном списании средств возврат осуществляется в полном объёме на ту же платёжную систему или банковскую карту, с которой был совершен платёж.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-2 sm:p-4 backdrop-blur-xl shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white">3. Порядок обращения</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[#8d959f] leading-relaxed">
            <p>
              3.1. Для оформления возврата напишите в нашу службу заботы через Telegram-бота{' '}
              <a href={botLink} target="_blank" rel="noopener noreferrer" className="text-[#7bdcff] hover:underline font-medium">
                @{telegramBotName || 'izinet_bot'}
              </a>{' '}
              или тикет в личном кабинете. Укажите ваш Email, дату платежа и описание проблемы.
            </p>
            <p>
              3.2. Обращения рассматриваются в течение 24 часов. Срок зачисления возврата банком обычно составляет от 1 до 5 рабочих дней.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
