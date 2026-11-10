import React from 'react';
import { Lock, ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate, Link } from 'react-router-dom';

export default function PrivacyPolicy() {
  const navigate = useNavigate();

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
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-white">
              Политика конфиденциальности
            </h1>
            <p className="text-xs sm:text-sm text-[#8d959f]">Privacy Policy & Zero-Logs Principle</p>
          </div>
        </div>

        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-2 sm:p-4 backdrop-blur-xl shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white">1. Сбор информации</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[#8d959f] leading-relaxed">
            <p>
              1.1. Мы собираем минимальный объем информации, необходимый исключительно для аутентификации пользователей и обеспечения работоспособности личного кабинета (адрес электронной почты, зашифрованный хеш пароля, Telegram ID при входе через бота).
            </p>
            <p>
              1.2. Мы принципиально не сохраняем платёжные реквизиты банковских карт. Вся платёжная обработка осуществляется сертифицированными провайдерами (ЮMoney, Enot, Cryptomus) по стандарту PCI DSS.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-2 sm:p-4 backdrop-blur-xl shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white">2. Политика отсутствия логов (Zero-Logs)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[#8d959f] leading-relaxed">
            <p>
              2.1. Сервис не ведёт журналы сетевой активности Пользователя. Мы не собираем и не храним: посещённые веб-сайты, переданный трафик, DNS-запросы и внешние IP-адреса назначения.
            </p>
            <p>
              2.2. Серверные службы работают в оперативной памяти с автоматической ротацией сессий.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-2 sm:p-4 backdrop-blur-xl shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white">3. Безопасность данных</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[#8d959f] leading-relaxed">
            <p>
              3.1. Все соединения с Сервисом защищены современным шифрованием TLS 1.3 с использованием совершенной прямой секретности (Forward Secrecy).
            </p>
            <p>
              3.2. Мы не передаем и не продаем данные пользователей сторонним аналитическим или рекламным компаниям.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
