import React from 'react';
import { RefreshCcw, ShieldCheck, Mail } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useAppConfig } from '@/hooks/useAppConfig';

export default function RefundPolicy() {
  const navigate = useNavigate();
  const { telegramBotName } = useAppConfig();

  return (
    <div className="min-h-screen bg-background text-foreground p-6 flex flex-col items-center">
      <div className="w-full max-w-4xl space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center border border-primary/30">
              <RefreshCcw className="text-primary w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-glow">Политика возвратов (Refund Policy)</h1>
              <p className="text-muted-foreground">Правила отмены и возврата средств</p>
            </div>
          </div>
          <Button variant="outline" onClick={() => navigate('/login')}>
            Вернуться
          </Button>
        </div>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>1. Характер предоставляемой услуги</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              1.1. Наш сервис предоставляет пользователям доступ к цифровому контенту (программному обеспечению, уникальным конфигурационным файлам и интерфейсу личного кабинета) в нематериальной форме.
            </p>
            <p className="text-primary/90 font-medium">
              1.2. Оплачивая доступ к Сервису, Пользователь выражает свое <strong>явное предварительное согласие</strong> на начало оказания услуги немедленно после совершения оплаты. Пользователь подтверждает, что осознает и соглашается с тем, что в связи с передачей доступа к цифровому контенту в момент оплаты, он <strong>теряет свое право на отказ от договора (право на возврат)</strong> в соответствии с международными нормами о реализации цифровых товаров и услуг.
            </p>
            <p>
              1.3. Услуга считается оказанной в полном объеме и надлежащего качества в момент генерации первой конфигурации или предоставления доступа к функционалу Личного кабинета.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>2. В каких случаях возврат средств ВОЗМОЖЕН</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>Мы заботимся о справедливости расчетов. Процедура возврата средств полностью предусмотрена для исключения технических ошибок. Возврат возможен исключительно в следующих случаях:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong className="text-foreground">Оплата прошла дважды (задвоение транзакции):</strong> произошел технический сбой на стороне платежного шлюза, в результате чего с вашего счета средства были списаны два и более раз за одну и ту же операцию.
              </li>
              <li>
                <strong className="text-foreground">Сбой системы (услуга не поступила):</strong> если после успешной оплаты цифровой доступ к личному кабинету не был предоставлен системой автоматически в течение 24 часов и наша служба поддержки не смогла активировать его вручную.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>3. В каких случаях возврат НЕ ВОЗМОЖЕН</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>Поскольку оплачиваемая услуга является предоставлением цифрового доступа (который не может быть физически "возвращен"), возврат денежных средств не производится в следующих случаях:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Пользователь передумал использовать сервис после получения к нему доступа.</li>
              <li>Проблемы на стороне оборудования, устройства или интернет-провайдера Пользователя (включая блокировки сетевых протоколов со стороны провайдеров или властей региона).</li>
              <li>Неумение или нежелание Пользователя следовать предоставленным инструкциям по настройке.</li>
              <li>Несоответствие сервиса личным ожиданиям Пользователя.</li>
              <li>Случайная покупка.</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>4. Как оформить возврат, сроки подачи и рассмотрения</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              4.1. <strong>Сроки подачи:</strong> Заявление на возврат (в случаях, описанных в п.2) должно быть подано в течение <strong>24 часов</strong> с момента обнаружения технического сбоя (двойного списания) или неоказания услуги.
            </p>
            <p>
              4.2. <strong>Куда обращаться:</strong> Для оформления возврата необходимо связаться со службой поддержки путем отправки запроса в Telegram-бот <a href={`https://t.me/${telegramBotName}`} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">@{telegramBotName}</a>, либо на электронную почту (если она доступна в личном кабинете). К обращению обязательно прикрепите подтверждение (чек) об оплате, информацию о вашем Email-аккаунте и описание проблемы (например, выписку о двойном списании).
            </p>
            <p>
              4.3. <strong>Сроки рассмотрения:</strong> Каждое обращение рассматривается службой поддержки в срок до <strong>14 рабочих дней</strong>. Мы проверим логи системы и информацию от платежного шлюза.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>5. Возврат через платежные системы и Chargeback</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              5.1. Пользователь признает, что инициирование процедуры оспаривания транзакции (Chargeback) в банке без предварительной попытки урегулирования вопроса через службу поддержки Сервиса, при условии фактически оказанной услуги (предоставленного доступа), рассматривается как попытка мошенничества и злоупотребление правом.
            </p>
            <p>
              5.2. В случае поступления уведомления о Chargeback по транзакции, по которой услуга была предоставлена, личный кабинет Пользователя блокируется навсегда без права восстановления, а данные о нарушении могут быть переданы в межбанковские скоринговые системы и платежным агрегаторам (Platega, ENOT.io).
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>6. Как производится возврат</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              6.1. При одобрении заявки техническим отделом, средства возвращаются исключительно на ту же банковскую карту или тот же платежный счет, с которого была произведена исходная оплата. 
            </p>
            <p>
              6.2. <strong>Сроки зачисления:</strong> Процедура зачисления средств может занимать от <strong>5 до 30 рабочих дней</strong> с момента подтверждения возврата с нашей стороны. Данный срок зависит исключительно от регламентов работы вашего банка-эмитента и платежной системы.
            </p>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader>
            <CardTitle>4. Законодательные оговорки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
            <p>
              4.1. Настоящая Политика не ограничивает ваши законные права на возврат или расторжение договора, предусмотренные императивными нормами законодательства вашей страны, которые не могут быть изменены договором.
            </p>
            <p>
              4.2. В случае, если обязательные законы вашей юрисдикции требуют предоставления возврата за цифровой контент, даже при наличии вашего явного согласия на начало исполнения услуги, мы будем следовать таким нормам.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
