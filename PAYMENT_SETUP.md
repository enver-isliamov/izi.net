# Настройка платежей (Cryptomus & Enot.io)

Чтобы платежи начали работать, выполните следующие шаги:

## 1. Настройка Базы Данных (Supabase)
Выполните этот SQL запрос в SQL Editor вашей панели Supabase:

```sql
-- Таблица транзакций
CREATE TABLE IF NOT EXISTS public.transactions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamp with time zone DEFAULT now(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    amount decimal NOT NULL,
    currency text DEFAULT 'RUB',
    status text DEFAULT 'pending', -- pending, completed, failed
    provider text NOT NULL, -- cryptomus, enot
    provider_order_id text UNIQUE NOT NULL
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

### Для Cryptomus:
- `CRYPTOMUS_MERCHANT_ID`: ID мерчанта из панели
- `CRYPTOMUS_API_KEY`: API ключ (Payment Key)
- `VITE_APP_URL`: URL вашего приложения (например, `shared-app-url.run.app`) — нужно для вебхуков.

### Для Enot.io:
- `ENOT_MERCHANT_ID`: ID кассы
- `ENOT_SECRET_KEY`: Секретный пароль (тот, что используется для подписи)
- `ENOT_SECRET_KEY2`: Второй секретный пароль (для вебхуков) — *Примечание: в коде используется ENOT_SECRET_KEY, если у вас один ключ, используйте его.*

## 3. Webhook URL
В панелях платежных систем укажите следующие URL для уведомлений:
- **Cryptomus**: `https://ВАШ_URL/api/pay/webhook/cryptomus`
- **Enot.io**: `https://ВАШ_URL/api/pay/webhook/enot`
