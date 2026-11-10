import React from 'react';
import { FileText, ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate, Link } from 'react-router-dom';

export default function Terms() {
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
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-white">
              Пользовательское соглашение и оферта
            </h1>
            <p className="text-xs sm:text-sm text-[#8d959f]">Договор публичной оферты</p>
          </div>
        </div>

        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-2 sm:p-4 backdrop-blur-xl shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white">1. Общие положения</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[#8d959f] leading-relaxed">
            <p>
              1.1. Настоящий документ представляет собой публичную оферту (далее — «Соглашение»). izinet (далее — «Сервис») является программным комплексом, предоставляющим интерфейс для управления сетевыми параметрами.
            </p>
            <p>
              1.2. Платформа предоставляет неисключительную лицензию на использование программного обеспечения и доступ к цифровому контенту. Сервис не является оператором связи и не оказывает телематические услуги.
            </p>
            <p>
              1.3. Сервис предоставляется на условиях «КАК ЕСТЬ» (AS IS). Администрация не гарантирует пригодность ПО для конкретных целей пользователя, кроме как обеспечения работоспособности самого интерфейса.
            </p>
            <p>
              1.4. Администрация оставляет за собой право в одностороннем порядке изменять настоящее Соглашение. Новая редакция вступает в силу с момента ее опубликования. Продолжение использования Сервиса означает полное согласие с изменениями, в той мере, в какой это не ограничивает установленные законом императивные права потребителей.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-2 sm:p-4 backdrop-blur-xl shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white">2. Предмет и момент оказания услуги</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[#8d959f] leading-relaxed">
            <p>
              2.1. Предметом Соглашения является предоставление права доступа к информационной инфраструктуре и генерации уникальных конфигурационных данных.
            </p>
            <p>
              2.2. Услуга считается полностью и надлежащим образом оказанной в момент предоставления доступа к Личному кабинету или генерации уникального ключа/файла. С этого момента обязательства Сервиса считаются выполненными за весь оплаченный период ввиду нематериального характера передаваемого контента.
            </p>
            <p>
              2.3. Пользователь дает явное согласие на начало исполнения услуги немедленно после совершения оплаты и подтверждает, что осознает утрату права на безусловный отказ от договора с момента предоставления цифрового доступа.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-2 sm:p-4 backdrop-blur-xl shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white">3. Ограничение ответственности и форс-мажор</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[#8d959f] leading-relaxed">
            <p>
              3.1. Администрация Сервиса не несет ответственности за перебои в работе, вызванные действиями третьих лиц, включая операторов связи, магистральных провайдеров, регуляторов, а также блокировками сетевых протоколов со стороны ТСПУ/РКН.
            </p>
            <p>
              3.2. Максимальный размер совокупной ответственности Администрации по любым искам или претензиям ограничивается суммой, фактически уплаченной Пользователем за текущий расчетный период (1 месяц), предшествующий возникновению основания для претензии.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-2 sm:p-4 backdrop-blur-xl shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white">4. Приостановка и прекращение доступа</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[#8d959f] leading-relaxed">
            <p>
              4.1. Администрация имеет право приостановить или полностью прекратить доступ Пользователя к Сервису при нарушении правил использования, совершении мошеннических действий или создании чрезмерной нагрузки на инфраструктуру.
            </p>
            <p>
              4.2. В случае блокировки за нарушение условий Соглашения, возврат неиспользованных денежных средств не производится.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-2 sm:p-4 backdrop-blur-xl shadow-xl">
          <CardHeader>
            <CardTitle className="text-lg font-medium text-white">5. Заверения пользователя</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[#8d959f] leading-relaxed">
            <p>
              5.1. Пользователь подтверждает, что использует Сервис исключительно в законных целях и обязуется не нарушать применимое законодательство, права третьих лиц или правила сетевой этики.
            </p>
            <p>
              5.2. Пользователь осознает, что Сервис не осуществляет сбор, хранение и логгирование персонального пользовательского трафика (Zero-Logs Policy).
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
