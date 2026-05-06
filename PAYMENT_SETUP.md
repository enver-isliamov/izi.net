# Настройка платежей (Enot.io)

Актуальный flow:

1. `POST /api/pay/create` создает `payments.status = pending`.
2. Backend вызывает `POST https://api.enot.io/invoice/create` с `x-api-key`.
3. ENOT отправляет webhook на `/api/pay/webhook/enot`.
4. Backend проверяет `x-api-sha256-signature`.
5. При `status = success` пополняется `balances`, закрывается `payments`, пишется `transactions type = deposit`.

Старые ссылки `https://enot.io/checkout?...` не используются.

Чтобы платежи начали работать, выполните следующие шаги:

## 1. Настройка Базы Данных (Supabase)
Выполните этот SQL запрос в SQL Editor вашей панели Supabase:

```sql
-- Инвойсы и статусы платежей
CREATE TABLE IF NOT EXISTS public.payments (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES public.users(id),
    amount numeric,
    currency varchar DEFAULT 'RUB',
    payment_method varchar,
    status varchar DEFAULT 'pending',
    payment_link varchar,
    expires_at timestamp,
    completed_at timestamp,
    created_at timestamp DEFAULT now()
);

-- Журнал успешных операций баланса
CREATE TABLE IF NOT EXISTS public.transactions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) NOT NULL,
    amount numeric NOT NULL,
    currency varchar DEFAULT 'RUB',
    type varchar CHECK (type IN ('deposit', 'withdrawal', 'referral_bonus')),
    status varchar DEFAULT 'completed',
    description text,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Настройка RLS для транзакций
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own transactions" ON public.transactions;
CREATE POLICY "Users can view their own transactions" 
ON public.transactions FOR SELECT 
USING (auth.uid() = user_id);
```

## 2. Настройка Secrets
Добавьте следующие переменные в **Settings -> Secrets** в Google AI Studio:

### Для Enot.io:
- `ENOT_MERCHANT_ID`: Shop ID / UUID кассы Enot.io
- `ENOT_SECRET_KEY`: секретный ключ кассы для API-запросов (`x-api-key`)
- `ENOT_SECRET_KEY2`: дополнительный ключ кассы для HMAC SHA-256 проверки webhook
- `VITE_APP_URL`: URL вашего приложения (например, `shared-app-url.run.app`) — нужно для вебхуков.

## 3. Webhook URL
В панелях платежных систем укажите следующие URL для уведомлений:
- **Enot.io**: `https://ВАШ_URL/api/pay/webhook/enot`
