import { Router } from 'express';
import { supabase } from '../services/supabase';
import { paymentService } from '../services/payment.service';
import { authenticateUser } from '../utils/auth';

const router = Router();

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
    // FIX: Если origin не передан, берем PUBLIC_URL из настроек
    const { data: publicUrlSetting } = await supabase.from('settings').select('value').eq('key', 'PUBLIC_URL').maybeSingle();
    const rawOrigin = req.body.origin || publicUrlSetting?.value || process.env.PUBLIC_URL || 'https://izinet.online';
    const origin = /^https?:\/\//i.test(String(rawOrigin)) ? String(rawOrigin).replace(/\/$/, '') : 'https://izinet.online';

    const orderId = `pay_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const invoice = await paymentService.createEnotInvoice(normalizedAmount, userId, orderId, origin, email);

    // Сохраняем платеж в БД
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
    // PAY-SEC-002: fallback is bound to the local pending payment invoice, preventing forged cross-order credits.
    if (!isValid && invoice_id && localPayment.external_id === invoice_id) {
       const check = await paymentService.checkEnotStatus(invoice_id);
       const checkedAmount = Number(check.amount);
       const amountMatches = !Number.isFinite(checkedAmount) || Math.round(checkedAmount) === Math.round(Number(localPayment.amount));
       if (amountMatches && ['success', 'paid', 'finish', 'finished'].includes(check.enotStatus)) {
         isValid = true;
       }
    }

    if (!isValid) {
      console.warn(`⚠️ [Enot Webhook] Невалидная подпись для заказа ${order_id}`);
      return res.status(400).send('Invalid signature');
    }

    const isSuccess = ['success', 'paid', 'finish', 'finished'].includes(String(status || '').toLowerCase());
    if (isSuccess) {
      const userId = localPayment.user_id;
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
    }

    res.send('YES');
  } catch (err: any) {
    console.error(`❌ [Enot Webhook] Ошибка обработки заказа ${order_id}:`, err.message);
    res.status(500).send('Error');
  }
});

export default router;
