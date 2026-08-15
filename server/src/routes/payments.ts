import { Router } from 'express';
import crypto from 'crypto';
import { supabase } from '../services/supabase';
import { paymentService } from '../services/payment.service';
import { authenticateUser } from '../utils/auth';

const router = Router();

const ENOT_SUCCESS_STATUSES = ['success', 'paid', 'finish', 'finished'];

// Создание счета на оплату через Enot.io
router.post('/create', authenticateUser, async (req: any, res) => {
  const { amount, userId: requestedUserId, email } = req.body;
  const userId = req.user.id;
  if (requestedUserId && requestedUserId !== userId) return res.status(401).json({ error: 'Unauthorized ID mismatch' });

  const normalizedAmount = Math.round(Number(amount));
  if (!Number.isFinite(normalizedAmount) || normalizedAmount < 10) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  try {
    // FIX: origin берём ТОЛЬКО из настроек сервера (settings.PUBLIC_URL / env).
    // Клиентский origin не принимаем: через него подменяется hook_url —
    // URL, на который Enot.io отправляет webhook об оплате.
    const { data: publicUrlSetting } = await supabase.from('settings').select('value').eq('key', 'PUBLIC_URL').maybeSingle();
    const rawOrigin = publicUrlSetting?.value || process.env.PUBLIC_URL || 'https://izinet.online';
    const origin = /^https?:\/\//i.test(String(rawOrigin)) ? String(rawOrigin).replace(/\/$/, '') : 'https://izinet.online';

    // PAY-001: payments.id в БД имеет тип uuid. Текстовый order_id вида pay_<ts>_<rand>
    // приводил к ошибке "invalid input syntax for type uuid": инвойс в Enot.io создавался,
    // но INSERT в payments падал, и клиент не получал ссылку на оплату (500).
    const orderId = crypto.randomUUID();
    const invoice = await paymentService.createEnotInvoice(normalizedAmount, userId, orderId, origin, email);

    // Сохраняем платеж в БД (колонки provider/external_id добавлены миграцией 002)
    await supabase.from('payments').insert({
      id: orderId,
      user_id: userId,
      amount: normalizedAmount,
      status: 'pending',
      provider: 'enot',
      external_id: invoice.invoiceId,
      expires_at: invoice.expired || new Date(Date.now() + 3600 * 1000).toISOString()
    });

    res.json(invoice);
  } catch (err: any) {
    console.error('❌ [Payment API] Ошибка создания инвойса:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Обработка уведомлений (вебхуков) от Enot.io
router.post('/webhook/enot', async (req, res) => {
  const signature = req.headers['x-api-sha256-signature'];
  const headerSignature = Array.isArray(signature) ? signature[0] : signature;
  const { status, invoice_id, order_id, custom_fields } = req.body;

  console.log(`📡 [Enot Webhook] Получено уведомление для заказа ${order_id}, статус: ${status}`);

  try {
    if (!order_id) return res.status(400).send('Missing order_id');

    const { data: localPayment, error: paymentReadError } = await supabase
      .from('payments')
      .select('id,user_id,amount,status,external_id')
      .eq('id', order_id)
      .maybeSingle();

    if (paymentReadError) throw paymentReadError;
    if (!localPayment) return res.status(404).send('Payment not found');

    let isValid = await paymentService.verifyEnotWebhook(req.body, headerSignature);

    // Запасной вариант проверки, если подпись не совпала
    // PAY-SEC-002: fallback привязан к локальному pending-платежу и его invoice_id,
    // исключая подмену заказа и зачисление чужих сумм.
    if (!isValid && invoice_id && localPayment.external_id === invoice_id) {
       const check = await paymentService.checkEnotStatus(invoice_id);
       const checkedAmount = Number(check.amount);
       const amountMatches = !Number.isFinite(checkedAmount) || Math.round(checkedAmount) === Math.round(Number(localPayment.amount));
       if (amountMatches && ENOT_SUCCESS_STATUSES.includes(check.enotStatus)) {
         isValid = true;
       }
    }

    if (!isValid) {
      console.warn(`⚠️ [Enot Webhook] Невалидная подпись для заказа ${order_id}`);
      return res.status(400).send('Invalid signature');
    }

    const normalizedStatus = String(status || '').toLowerCase();

    if (ENOT_SUCCESS_STATUSES.includes(normalizedStatus)) {
      const userId = localPayment.user_id;

      // Defense-in-depth: сверяем сумму из тела вебхука с локальным платежом
      const bodyAmount = Number(req.body.amount);
      if (Number.isFinite(bodyAmount) && Math.round(bodyAmount) !== Math.round(Number(localPayment.amount))) {
        console.warn(`⚠️ [Enot Webhook] Сумма не совпадает для заказа ${order_id}: webhook=${bodyAmount}, local=${localPayment.amount}`);
        return res.status(400).send('Amount mismatch');
      }

      if (custom_fields) {
        try {
          const cf = typeof custom_fields === 'string' ? JSON.parse(custom_fields) : custom_fields;
          const customUserId = cf.user_id || cf.userId;
          if (customUserId && customUserId !== userId) return res.status(400).send('User mismatch');
        } catch (e) {}
      }

      if (userId) {
        await paymentService.processSuccessfulPayment(userId, Number(localPayment.amount), order_id, 'enot');
      }
    } else if (['fail', 'expired', 'refund'].includes(normalizedStatus)) {
      // PAY-003: отражаем неуспешные статусы, чтобы платежи не висели в pending вечно
      if (normalizedStatus === 'refund' && localPayment.user_id) {
        // PAY-008: при возврате средств списываем с баланса (атомарно).
        // Если на балансе меньше суммы возврата — только статус + предупреждение.
        try {
          const { data: deducted } = await supabase.rpc('deduct_user_balance', {
            p_user_id: localPayment.user_id,
            p_amount: Number(localPayment.amount)
          });
          if (!deducted) {
            console.warn(`⚠️ [Enot Webhook] Refund: недостаточно баланса для списания ${Number(localPayment.amount)} у ${localPayment.user_id}`);
          }
        } catch (e: any) {
          console.error('Failed to deduct balance on refund:', e.message);
        }
      }
      try {
        await supabase
          .from('payments')
          .update({
            status: normalizedStatus === 'refund' ? 'refunded' : 'failed',
            completed_at: new Date().toISOString()
          })
          .eq('id', order_id);
      } catch (e: any) {
        console.error('Failed to mark payment failed:', e.message);
      }
    }

    res.send('YES');
  } catch (err: any) {
    console.error(`❌ [Enot Webhook] Ошибка обработки заказа ${order_id}:`, err.message);
    res.status(500).send('Error');
  }
});

export default router;
