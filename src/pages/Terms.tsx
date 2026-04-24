import React from 'react';
import { ShieldCheck, FileText, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export default function Terms() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground p-6 flex flex-col items-center">
      <div className="w-full max-w-4xl space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center border border-primary/30">
              <FileText className="text-primary w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-glow">Пользовательское соглашение и оферта</h1>
              <p className="text-muted-foreground">Договор публичной оферты</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => navigate('/login')}>
            Вернуться
          </Button>
        </div>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>1. Общие положения</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              1.1. Настоящий документ представляет собой публичную оферту (далее — «Соглашение»). Использование сайта izinet и его сервисов означает безоговорочное согласие пользователя с условиями данного Соглашения. 
            </p>
            <p>
              1.2. Платформа предоставляет услуги доступа к цифровому контенту и специализированному программному обеспечению (далее — «Сервис»). 
            </p>
            <p>
              1.3. Сервис предоставляется на условиях «КАК ЕСТЬ» (AS IS). Разработчики и администрация проекта не предоставляют никаких гарантий относительно соответствия Сервиса специфическим целям, ожиданиям или требованиям пользователя.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>2. Предмет соглашения</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              2.1. Предметом настоящего Соглашения является предоставление Пользователю неэксклюзивного права использования панели управления и базового доступа к информационной инфраструктуре Сервиса.
            </p>
            <p>
              2.2. Услуга считается полностью и надлежащим образом оказанной автоматически в момент предоставления Пользователю авторизационных данных (доступа к личному кабинету) и/или генерации ключей доступа на платформе.
            </p>
            <p>
              2.3. Вся ответственность за использование предоставленных данных и инструментов возлагается исключительно на Пользователя.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>3. Ограничение ответственности (Disclaimer of Warranties and Liability)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl mb-4">
              <div className="flex items-center gap-2 text-destructive font-bold mb-2">
                <AlertTriangle className="w-5 h-5" />
                Отказ от ответственности
              </div>
              <p className="text-secondary-foreground text-xs leading-relaxed">
                Администрация проекта, владельцы, разработчики и любые аффилированные лица полностью и безоговорочно снимают с себя любую юридическую, финансовую и иную ответственность за любые прямые, косвенные, случайные, штрафные или вытекающие убытки, потерю данных, прибыли или репутации, возникающие вследствие использования или невозможности использования Сервиса. 
              </p>
            </div>
            <p>
              3.1. Пользователь признает и соглашается, что весь риск, связанный с использованием Сервиса, лежит исключительно на нем. Ни при каких обстоятельствах администрация не несет ответственности за действия пользователя или третьих лиц в рамках использования Сервиса.
            </p>
            <p>
              3.2. Мы не гарантируем бесперебойную работу, отсутствие ошибок, а также защиту от блокировок со стороны интернет-провайдеров, операторов связи, или органов государственной власти на любых территориях. Обход блокировок или фильтрации трафика не является предметом или гарантией данного соглашения.
            </p>
            <p>
              3.3. Данное соглашение базируется на принципах международного права и применяется вне зависимости от юрисдикции Пользователя, исключая применение любого локального законодательства о защите прав потребителей, в той мере, в какой это допускается законом. Любые споры решаются исключительно путем электронных переговоров.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>4. Заверения пользователя</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              4.1. Пользователь подтверждает, что использует Сервис исключительно в законных целях и обязуется не нарушать применимое законодательство, права третьих лиц или правила сетевой этики.
            </p>
            <p>
              4.2. Пользователь осознает, что Сервис не осуществляет сбор, хранение и логгирование персонального пользовательского трафика, в связи с чем не располагает данными для передачи третьим лицам по запросу.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
