import { Router } from 'express';
import { supabase } from '../services/supabase';
import { paymentService } from '../services/payment.service';

const router = Router();

// Создание счета на оплату через Enot.io
router.post('/create', async (req, res) => {
  const { amount, userId, email, method } = req.body;
  if (!amount || !userId) return res.status(400).json({ error: 'Missing parameters' });

  try {
    // FIX: Если origin не передан, берем PUBLIC_URL из настроек
    const { data: publicUrlSetting } = await supabase.from('settings').select('value').eq('key', 'PUBLIC_URL').maybeSingle();
    const origin = req.body.origin || publicUrlSetting?.value || process.env.PUBLIC_URL || 'https://izinet.online';

    const orderId = `pay_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const invoice = await paymentService.createEnotInvoice(amount, userId, orderId, origin, email);

    // Сохраняем платеж в БД
    await supabase.from('payments').insert({
      id: orderId,
      user_id: userId,
      amount: amount,
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
  const { amount, status, invoice_id, order_id, custom_fields } = req.body;

  console.log(`📡 [Enot Webhook] Получено уведомление для заказа ${order_id}, статус: ${status}`);

  try {
    let isValid = await paymentService.verifyEnotWebhook(req.body, headerSignature);
    
    // Запасной вариант проверки, если подпись не совпала
    if (!isValid && invoice_id) {
       const check = await paymentService.checkEnotStatus(invoice_id);
       if (['success', 'paid', 'finish', 'finished'].includes(check.enotStatus)) {
         isValid = true;
       }
    }

    if (!isValid) {
      console.warn(`⚠️ [Enot Webhook] Невалидная подпись для заказа ${order_id}`);
      return res.status(400).send('Invalid signature');
    }

    const isSuccess = ['success', 'paid', 'finish', 'finished'].includes(status.toLowerCase());
    if (isSuccess) {
      let userId = '';
      if (custom_fields) {
        try {
          const cf = typeof custom_fields === 'string' ? JSON.parse(custom_fields) : custom_fields;
          userId = cf.user_id || cf.userId;
        } catch (e) {}
      }

      if (!userId && order_id) {
        const { data } = await supabase.from('payments').select('user_id').eq('id', order_id).maybeSingle();
        userId = data?.user_id;
      }

      if (userId) {
        await paymentService.processSuccessfulPayment(userId, parseFloat(amount), order_id, 'enot');
      }
    }

    res.send('YES');
  } catch (err: any) {
    console.error(`❌ [Enot Webhook] Ошибка обработки заказа ${order_id}:`, err.message);
    res.status(500).send('Error');
  }
});

export default router;
