import React from 'react';
import { Lock, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground p-6 flex flex-col items-center">
      <div className="w-full max-w-4xl space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center border border-primary/30">
              <Lock className="text-primary w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-glow">Политика Конфиденциальности</h1>
              <p className="text-muted-foreground">Privacy Policy</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => navigate('/login')}>
            Вернуться
          </Button>
        </div>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>1. Сбор информации</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              1.1. Мы собираем минимальный объем информации, необходимый исключительно для аутентификации пользователей и обеспечения работоспособности личного кабинета (например, адрес электронной почты, зашифрованный пароль, внутренние идентификаторы).
            </p>
            <p className="font-medium text-primary/90">
              1.2. ZERO-LOGS ПОЛИТИКА: Мы НЕ отслеживаем, НЕ записываем и НЕ храним ваш интернет-трафик, DNS-запросы, историю просмотров, содержимое передаваемых данных или IP-адреса конечных сетевых соединений. Мы физически не можем предоставить эти данные третьим лицам по причине их отсутствия (by design).
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>2. Использование данных</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              2.1. Данные, указанные при регистрации, используются исключительно для предоставления доступа к порталу, обработке платежей через агрегаторов и обратной связи.
            </p>
            <p>
              2.2. Сервис не раскрывает и не продает контактные данные пользователей рекламным агентствам или сторонним сервисам.
            </p>
            <p>
              2.3. Исключением является обмен техническими данными с платежными шлюзами (ENOT.io, Platega), необходимый исключительно для проведения транзакций и предотвращения фрода.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>3. Безопасность и хранение</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              3.1. Мы принимаем все экономически оправданные технические меры для защиты инфраструктуры личного кабинета от несанкционированного доступа. Однако никакая система не может гарантировать 100% безопасность, и мы снимаем с себя ответственность за форс-мажорные утечки данных.
            </p>
            <p>
              3.2. Вся ответственность за сохранность учетных данных лежит на пользователе. Сервис не восстанавливает доступ в случае утери контроля над Google-аккаунтом или почтой, использованными при регистрации.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
