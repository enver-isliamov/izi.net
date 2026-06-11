import axios from 'axios';
import crypto from 'crypto';
import { supabase } from './supabase';
import { sharedHttpsAgent } from '../utils/axios';
import { stableJsonStringify } from '../utils/json';

export class PaymentService {
  constructor() {}

  private async getEnotConfig() {
    try {
      const { data: dbSettings, error: dbError } = await supabase
        .from('settings')
        .select('*')
        .in('key', ['ENOT_MERCHANT_ID', 'ENOT_SECRET_KEY', 'ENOT_SECRET_KEY2']);
      
      if (dbError) {
        console.warn('⚠️ [PaymentService] Settings table fetch failed:', dbError.message);
        return this.getEnvFallback();
      }

      const settingsMap: Record<string, string> = {};
      dbSettings?.forEach(s => settingsMap[s.key] = s.value);

      const merchantId = (settingsMap['ENOT_MERCHANT_ID'] || process.env.ENOT_MERCHANT_ID || '').trim();
      const secretKey = (settingsMap['ENOT_SECRET_KEY'] || process.env.ENOT_SECRET_KEY || '').trim();
      const secretKey2 = (settingsMap['ENOT_SECRET_KEY2'] || process.env.ENOT_SECRET_KEY2 || secretKey).trim();

      if (!merchantId || !secretKey) {
        throw new Error('Enot.io credentials missing.');
      }

      return { merchantId, secretKey, secretKey2 };
    } catch (err: any) {
      return this.getEnvFallback();
    }
  }

  private getEnvFallback() {
    const merchantId = (process.env.ENOT_MERCHANT_ID || '').trim();
    const secretKey = (process.env.ENOT_SECRET_KEY || '').trim();
    const secretKey2 = (process.env.ENOT_SECRET_KEY2 || secretKey).trim();

    if (!merchantId || !secretKey) {
      throw new Error(`Enot.io credentials missing in environment.`);
    }
    return { merchantId, secretKey, secretKey2 };
  }

  async createEnotInvoice(amount: number, userId: string, orderId: string, origin: string, email?: string) {
    const { merchantId, secretKey } = await this.getEnotConfig();

    const payload: Record<string, any> = {
      amount,
      order_id: orderId,
      currency: 'RUB',
      shop_id: merchantId,
      custom_fields: JSON.stringify({ user_id: userId }),
      comment: 'izinet balance top-up',
      success_url: `${origin}/dashboard`,
      fail_url: `${origin}/wallet`,
      // FIX: Убеждаемся, что hook_url — это полный валидный URL без лишних символов
      hook_url: `${origin.replace(/\/$/, '')}/api/pay/webhook/enot`,
      expire: 3600
    };

    console.log(`📡 [Enot] Создание инвойса. Hook URL: ${payload.hook_url}`);

    if (email) payload.email = email;

    const response = await axios.post('https://api.enot.io/invoice/create', payload, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': secretKey
      },
      timeout: 15000,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true
    });

    if (!response.data?.status_check || !response.data?.data?.url) {
      const enotError = response.data?.error || response.data?.message || response.data;
      throw new Error(`Enot.io invoice creation failed: ${JSON.stringify(enotError)}`);
    }

    return {
      url: response.data.data.url,
      invoiceId: response.data.data.id,
      expired: response.data.data.expired
    };
  }

  async checkEnotStatus(invoiceId: string) {
    const { merchantId, secretKey } = await this.getEnotConfig();

    const payload = {
      invoice_id: invoiceId,
      shop_id: merchantId
    };

    const response = await axios.post('https://api.enot.io/invoice/info', payload, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': secretKey
      },
      timeout: 10000,
      httpsAgent: sharedHttpsAgent,
      validateStatus: () => true
    });

    if (response.data && response.data.status_check) {
      const info = response.data.data;
      return {
        enotStatus: info?.status || 'unknown',
        amount: info?.amount,
        enotResponse: response.data
      };
    } else {
      const errorMsg = response.data?.error || response.data?.message || 'Enot.io API error';
      return {
        enotStatus: 'error',
        message: typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg),
        enotResponse: response.data
      };
    }
  }

  async verifyEnotWebhook(body: any, headerSignature: string | undefined) {
    const { secretKey2 } = await this.getEnotConfig();
    if (!secretKey2 || !headerSignature) return false;

    const calculatedSign = crypto
      .createHmac('sha256', secretKey2)
      .update(stableJsonStringify(body))
      .digest('hex');

    const received = headerSignature.toLowerCase();
    const calculatedSignCompact = crypto
      .createHmac('sha256', secretKey2)
      .update(JSON.stringify(body))
      .digest('hex');

    if (!/^[a-f0-9]{64}$/.test(received)) return false;

    const matchesStable = crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(calculatedSign, 'hex'));
    const matchesCompact = crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(calculatedSignCompact, 'hex'));

    return matchesStable || matchesCompact;
  }

  async processSuccessfulPayment(userId: string, amount: number, orderId: string, provider: string) {
    console.log(`Processing payment: ${amount} for user ${userId} via ${provider}`);

    const { data: existingPayment, error: paymentReadErr } = await supabase
      .from('payments')
      .select('status')
      .eq('id', orderId)
      .maybeSingle();

    if (paymentReadErr) throw new Error(`Payment read failed: ${paymentReadErr.message}`);
    if (existingPayment?.status === 'completed') {
      console.log(`Payment ${orderId} already processed.`);
      return;
    }

    const { data: balanceData } = await supabase
      .from('balances')
      .select('amount')
      .eq('user_id', userId)
      .maybeSingle();

    const currentAmount = Number(balanceData?.amount || 0);
    const { error: balErr } = await supabase
      .from('balances')
      .upsert({
        user_id: userId,
        amount: currentAmount + amount,
        currency: 'RUB',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (balErr) throw new Error(`Balance update failed: ${balErr.message}`);

    const { error: paymentStatusErr } = await supabase
      .from('payments')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (paymentStatusErr) console.error('Failed to update payment status:', paymentStatusErr.message);

    const { error: txInsertErr } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        amount,
        currency: 'RUB',
        type: 'deposit',
        status: 'completed',
        description: `Balance top-up via ${provider}. Payment ID: ${orderId}`
      });

    if (txInsertErr) console.error('Failed to insert transaction journal row:', txInsertErr.message);

    console.log(`Balance successfully updated for user ${userId}. New total: ${currentAmount + amount}`);
  }
}

export const paymentService = new PaymentService();
