import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { Telegraf, Context } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import crypto from 'crypto';
import axios from 'axios';

import https from 'https';

dotenv.config();

// Create a global HTTPS agent that ignores self-signed certificate errors (common in VPN panels)
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

//@ts-ignore
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
const PORT = 3000;

// --- XUI Service ---
class XUIService {
  private host: string;
  private username: string;
  private password: string;
  private sessionCookie: string | null = null;

  constructor() {
    let host = (process.env.XUI_HOST || '').trim();
    // Remove trailing slashes and /panel if it exists (we will add it back where needed)
    host = host.replace(/\/+$/, "").replace(/\/panel$/, "");
    
    // Add protocol if missing. If the user provided IP:PORT, assume HTTP if not specified, 
    // but usually user should provide https:// for panel
    if (host && !host.startsWith('http://') && !host.startsWith('https://')) {
      host = 'http://' + host;
    }
    
    this.host = host;
    this.username = process.env.XUI_USERNAME || '';
    this.password = process.env.XUI_PASSWORD || '';
  }

  async checkConfig() {
    console.log(`🔍 Checking 3x-ui connection to ${this.host}...`);
    if (!this.host || !this.username || !this.password) {
      console.warn('⚠️ 3x-ui credentials missing in environment variables!');
      return false;
    }
    try {
      await this.login();
      console.log('✅ 3x-ui connection successful');
      return true;
    } catch (e: any) {
      console.error('❌ 3x-ui connection failed:', e.message);
      return false;
    }
  }

  private async login() {
    if (!this.host) {
      throw new Error('XUI_HOST is empty. Please set it in Settings -> Secrets.');
    }
    try {
      // 3x-ui login URL usually ends in /login
      const loginUrl = `${this.host}/login`;
      console.log(`📡 Attempting login to: ${loginUrl}`);
      
      const response = await axios.post(
        loginUrl,
        `username=${this.username}&password=${this.password}`,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
          httpsAgent: httpsAgent
        }
      );
      
      if (response.data && response.data.success === false) {
        throw new Error(response.data.msg || 'Login failed');
      }

      const cookie = response.headers['set-cookie']?.[0];
      if (!cookie) throw new Error('No cookie received from 3x-ui. Check if host URL is correct and starts with http/https.');
      this.sessionCookie = cookie;
      console.log('✅ Logged in to 3x-ui');
      return cookie;
    } catch (error: any) {
      console.error('❌ 3x-ui login error:', error.message);
      if (error.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || error.message.includes('hostname')) {
        console.warn('💡 Tip: Try using IP address in XUI_HOST instead of domain if certificate is invalid.');
      }
      throw error;
    }
  }

  async addClient(email: string, uuid: string, inboundId: number) {
    if (!this.sessionCookie) await this.login();

    // First, let's try to get the inbound to see its settings (for link generation later)
    let inbound;
    try {
      // API requests usually start with /panel/api/
      const getInboundUrl = `${this.host}/panel/api/inbounds/get/${inboundId}`;
      const resp = await axios.get(getInboundUrl, {
        headers: { 'Cookie': this.sessionCookie },
        httpsAgent: httpsAgent
      });
      if (resp.data.success) {
        inbound = resp.data.obj;
      }
    } catch (e: any) {
      console.warn(`Could not fetch inbound settings from ${this.host}, will use defaults. Error: ${e.message}`);
    }

    const clientData = {
      id: inboundId,
      settings: JSON.stringify({
        clients: [
          {
            id: uuid,
            flow: "xtls-rprx-vision",
            email: email,
            limitIp: 0,
            totalGB: 0,
            expiryTime: 0,
            enable: true,
            tgId: "",
            subId: ""
          }
        ]
      })
    };

    try {
      const addClientUrl = `${this.host}/panel/api/inbounds/addClient`;
      const response = await axios.post(
        addClientUrl,
        clientData,
        {
          headers: { 
            'Cookie': this.sessionCookie,
            'Content-Type': 'application/json'
          },
          httpsAgent: httpsAgent
        }
      );

      if (response.data.success) {
        console.log(`✅ Client ${email} added to 3x-ui`);
        
        // Generate link
        let link = "";
        if (inbound) {
          try {
            const streamSettings = JSON.parse(inbound.streamSettings);
            const realitySettings = streamSettings.realitySettings;
            const port = inbound.port;
            
            // Safer host extraction
            let host = 'server.izinet.app'; // fallback
            try {
              if (this.host.includes('://')) {
                const urlParts = new URL(this.host);
                host = urlParts.hostname;
              } else {
                host = this.host.split(':')[0];
              }
            } catch (urlErr) {
              console.warn('URL parsing failed in addClient, using raw host');
              host = this.host.split('/')[0].split(':')[0] || host;
            }

            const sni = realitySettings.serverNames[0];
            const pbk = realitySettings.publicKey;
            const sid = realitySettings.shortIds[0];
            link = `vless://${uuid}@${host}:${port}?type=tcp&security=reality&sni=${sni}&pbk=${pbk}&fp=chrome&sid=${sid}&flow=xtls-rprx-vision#izinet_${email}`;
          } catch (e) {
            console.error('Error parsing inbound settings for link generation:', e);
            link = this.generateVlessLink(uuid, email);
          }
        } else {
          link = this.generateVlessLink(uuid, email);
        }
        
        return link;
      } else {
        throw new Error(response.data.msg || 'Failed to add client');
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        return this.addClient(email, uuid, inboundId);
      }
      console.error('❌ 3x-ui addClient error:', error.message);
      throw error;
    }
  }

  generateVlessLink(uuid: string, email: string) {
    const host = new URL(this.host).hostname;
    // Fallback if inbound fetch fails (Standard TLS, no Reality parameters to avoid strict base64 errors in clients like Hiddify)
    return `vless://${uuid}@${host}:443?type=tcp&security=tls&sni=${host}#izinet_${email}`;
  }
}

// --- Payment Service ---
class PaymentService {
  private cryptoMerchantId: string;
  private cryptoApiKey: string;
  private enotMerchantId: string;
  private enotSecretKey: string;

  constructor() {
    this.cryptoMerchantId = process.env.CRYPTOMUS_MERCHANT_ID || '';
    this.cryptoApiKey = process.env.CRYPTOMUS_API_KEY || '';
    this.enotMerchantId = process.env.ENOT_MERCHANT_ID || '';
    this.enotSecretKey = process.env.ENOT_SECRET_KEY || '';
  }

  async createCryptomusInvoice(amount: number, userId: string, orderId: string) {
    if (!this.cryptoMerchantId || !this.cryptoApiKey) {
      throw new Error('Cryptomus credentials missing');
    }

    const payload = {
      amount: amount.toString(),
      currency: 'USD',
      order_id: orderId,
      url_callback: `https://${process.env.VITE_APP_URL || 'izinet.app'}/api/pay/webhook/cryptomus`,
      url_return: `https://${process.env.VITE_APP_URL || 'izinet.app'}/dashboard`,
      additional_data: userId
    };

    const sign = crypto
      .createHash('md5')
      .update(Buffer.from(JSON.stringify(payload)).toString('base64') + this.cryptoApiKey)
      .digest('hex');

    const response = await axios.post('https://api.cryptomus.com/v1/payment', payload, {
      headers: {
        merchant: this.cryptoMerchantId,
        sign: sign
      }
    });

    return response.data.result.url;
  }

  createEnotInvoice(amount: number, userId: string, orderId: string) {
    if (!this.enotMerchantId || !this.enotSecretKey) {
      throw new Error('Enot.io credentials missing');
    }

    // Enot signature: merchant_id:amount:secret_word:order_id
    const sign = crypto
      .createHash('md5')
      .update(`${this.enotMerchantId}:${amount}:${this.enotSecretKey}:${orderId}`)
      .digest('hex');

    const params = new URLSearchParams({
      m: this.enotMerchantId,
      oa: amount.toString(),
      o: orderId,
      s: sign,
      cf: userId, // Custom field to pass userId
      curr: 'RUB'
    });

    return `https://enot.io/checkout?${params.toString()}`;
  }
}

const payment = new PaymentService();

const xui = new XUIService();

// --- API Routes ---

// 💰 Create Payment Link
app.post('/api/pay/create', async (req, res) => {
  const { userId, amount, method } = req.body;
  
  if (!userId || !amount || !method) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const orderId = `order_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  try {
    // Save pending transaction to DB
    const { error: txErr } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        amount: amount,
        status: 'pending',
        provider: method,
        provider_order_id: orderId
      });

    if (txErr) console.warn('Could not log pending transaction:', txErr.message);

    let url = '';
    if (method === 'cryptomus') {
      url = await payment.createCryptomusInvoice(amount, userId, orderId);
    } else if (method === 'enot') {
      // Assuming amount is in USD on frontend, converting to RUB for Enot if needed
      // For now, assume amount is already correct from UI
      url = payment.createEnotInvoice(amount, userId, orderId);
    } else {
      throw new Error('Unsupported payment method');
    }

    res.json({ success: true, url });
  } catch (error: any) {
    console.error('Payment creation error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ⚓ Cryptomus Webhook
app.post('/api/pay/webhook/cryptomus', async (req, res) => {
  const { sign, ...payload } = req.body;
  
  const calculatedSign = crypto
    .createHash('md5')
    .update(Buffer.from(JSON.stringify(payload)).toString('base64') + (process.env.CRYPTOMUS_API_KEY || ''))
    .digest('hex');

  if (sign !== calculatedSign) {
    return res.status(400).send('Invalid signature');
  }

  if (payload.status === 'paid' || payload.status === 'paid_over') {
    const userId = payload.additional_data;
    const amount = parseFloat(payload.amount);
    const orderId = payload.order_id;

    await processSuccessfulPayment(userId, amount, orderId, 'cryptomus');
  }

  res.send('OK');
});

// ⚓ Enot Webhook
app.post('/api/pay/webhook/enot', async (req, res) => {
  const { merchant_id, amount, intid, custom_field, sign } = req.body;
  const orderId = req.body.merchant_order_id;

  // Enot webhook sign: merchant_id:amount:secret_word2:merchant_order_id
  // Usually Enot has a second secret key for webhooks
  const secret2 = process.env.ENOT_SECRET_KEY || ''; 
  const calculatedSign = crypto
    .createHash('md5')
    .update(`${merchant_id}:${amount}:${secret2}:${orderId}`)
    .digest('hex');

  if (sign !== calculatedSign) {
    return res.status(400).send('Invalid signature');
  }

  await processSuccessfulPayment(custom_field, parseFloat(amount), orderId, 'enot');
  res.send('YES');
});

async function processSuccessfulPayment(userId: string, amount: number, orderId: string, provider: string) {
  console.log(`💰 Processing payment: ${amount} for user ${userId} via ${provider}`);
  
  // 1. Check if already processed to avoid double-spend
  const { data: existingTx } = await supabase
    .from('transactions')
    .select('status')
    .eq('provider_order_id', orderId)
    .single();

  if (existingTx?.status === 'completed') {
    console.log(`⚠️ Payment ${orderId} already processed.`);
    return;
  }

  // 2. Update balance
  const { data: balanceData } = await supabase
    .from('balances')
    .select('amount')
    .eq('user_id', userId)
    .single();

  const currentAmount = balanceData?.amount || 0;
  
  // Using Supabase Service Role to bypass RLS for balance update
  const { error: balErr } = await supabase
    .from('balances')
    .upsert({ 
      user_id: userId, 
      amount: currentAmount + amount,
      updated_at: new Date().toISOString()
    });

  if (balErr) {
    console.error('❌ Failed to update balance:', balErr.message);
    return;
  }

  // 3. Update transaction status
  await supabase
    .from('transactions')
    .update({ status: 'completed' })
    .eq('provider_order_id', orderId);

  console.log(`✅ Balance updated for user ${userId}. +${amount}`);
}

// Health check and configuration status
app.get('/api/health', (req, res) => {
  const configStatus = {
    supabase: !!process.env.VITE_SUPABASE_URL,
    bot: !!process.env.TELEGRAM_BOT_TOKEN,
    xui: !!process.env.XUI_HOST && !!process.env.XUI_USERNAME && !!process.env.XUI_PASSWORD,
    inboundId: process.env.XUI_INBOUND_ID || '1'
  };
  res.json({ status: 'ok', config: configStatus });
});

app.post('/api/subscription/buy', async (req, res) => {
  const { userId, planId, planName, price, durationDays, periodMonths, serverType, deviceLimit } = req.body;

  if (!userId || !planId || !price) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    // 1. Get current balance
    const { data: balanceData, error: balanceErr } = await supabase
      .from('balances')
      .select('amount')
      .eq('user_id', userId)
      .single();

    if (balanceErr || !balanceData) {
      throw new Error('Balance not found');
    }

    if (balanceData.amount < price) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // 2. Check for ANY previous subscription to REUSE the same VPN key/config
    const { data: lastSub, error: lastSubErr } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let vpnConfig = lastSub?.v2ray_config;
    let expiresAt = new Date();

    // Handling Stacking: If current sub is still active, start from its end date
    if (lastSub && new Date(lastSub.expires_at) > new Date()) {
      expiresAt = new Date(lastSub.expires_at);
    }
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    // 3. If NO previous config found (brand new user), create one in 3x-ui
    if (!vpnConfig) {
      // Use a STABLE email for the user in 3x-ui
      const uuid = crypto.randomUUID();
      const vpnEmail = `user_${userId.slice(0, 8)}`; // Stable email based on Supabase ID
      const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');

      try {
        console.log(`🆕 Creating first-time VPN client for user ${userId}...`);
        vpnConfig = await xui.addClient(vpnEmail, uuid, inboundId);
      } catch (apiError: any) {
        // If 3x-ui says it's a duplicate (maybe leftovers from previous DB installs), 
        // we could handle it, but for now we follow the "fail-safe" path.
        console.error('❌ 3x-ui error during first-time setup:', apiError.message);
        throw apiError;
      }
    } else {
      console.log(`♻️ Reusing permanent VPN config for user ${userId}`);
    }

    // 4. Update or Insert subscription record
    // We update the most recent active sub or create a new one if it's a fresh start
    let subData, subErr;

    if (lastSub && lastSub.status === 'active') {
      // Update existing active subscription (Extension)
      const { data: updatedSub, error: updateErr } = await supabase
        .from('subscriptions')
        .update({
          expires_at: expiresAt.toISOString(),
          plan_type: planName.toLowerCase(),
          period_months: periodMonths || 1,
          server_type: serverType || 'LTE',
          device_limit: deviceLimit || 1
        })
        .eq('id', lastSub.id)
        .select()
        .single();
      
      subData = updatedSub;
      subErr = updateErr;
    } else {
      // Create new subscription record (either first time or after total expiry)
      const { data: newSub, error: insertErr } = await supabase
        .from('subscriptions')
        .insert({
          user_id: userId,
          plan_type: planName.toLowerCase(),
          status: 'active',
          expires_at: expiresAt.toISOString(),
          v2ray_config: vpnConfig,
          traffic_limit_mb: 100 * 1024,
          traffic_used_mb: 0,
          period_months: periodMonths || 1,
          server_type: serverType || 'LTE',
          device_limit: deviceLimit || 1
        })
        .select()
        .single();
      
      subData = newSub;
      subErr = insertErr;
    }

    if (subErr) {
      console.error('❌ Supabase sub operation error:', JSON.stringify(subErr, null, 2));
      throw subErr;
    }

    // 5. FINAL STEP: Deduct balance
    const { error: deductErr } = await supabase
      .from('balances')
      .update({ amount: balanceData.amount - price })
      .eq('user_id', userId);

    if (deductErr) {
      console.error('CRITICAL: Subscription processed but balance deduction failed!', deductErr);
    }

    res.json({ success: true, subscription: subData });

  } catch (error: any) {
    console.error('❌ Subscription purchase error details:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: error.details || error.hint || null
    });
  }
});

// Supabase Setup
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; // Needs to be set in Settings
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Telegram Bot Setup
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const bot = botToken ? new Telegraf(botToken) : null;

// --- Auth Utilities ---

function verifyTelegramWebAppData(data: any): boolean {
  const { hash, ...userData } = data;
  if (!hash) return false;

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const dataCheckString = Object.keys(userData)
    .sort()
    .map(key => `${key}=${userData[key]}`)
    .join('\n');

  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return hmac === hash;
}

// --- API Routes ---

app.post('/api/auth/telegram/verify', async (req, res) => {
  const telegramData = req.body;

  if (!verifyTelegramWebAppData(telegramData)) {
    return res.status(401).json({ error: 'Invalid telegram data hash' });
  }

  const { id: telegramId, first_name, username, photo_url } = telegramData;

  try {
    // 1. Check if user with this telegram_id exists
    let { data: userData, error: userErr } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId.toString())
      .single();

    let userId = userData?.id;

    if (!userData) {
      // 2. If not, maybe search by email if we can? (Telegram doesn't provide email)
      // Usually we create a NEW user if not found by telegram_id
      const email = `tg_${telegramId}@izinet.app`; // Placeholder email
      
      const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { 
          full_name: first_name,
          username: username,
          avatar_url: photo_url,
          telegram_id: telegramId.toString()
        }
      });

      if (createErr) throw createErr;
      userId = newUser.user.id;
      
      // Update public.users table as well (trigger might have handled it, but let's be sure)
      await supabase.from('users').update({
        telegram_id: telegramId.toString(),
        telegram_linked: true,
        name: first_name
      }).eq('id', userId);
    }

    // 3. Generate a magic link or a login token for the frontend
    // Since we need to log in the user on the frontend, we use signInWithOtp (email) for simplicity
    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: userData?.email || `tg_${telegramId}@izinet.app`
    });

    if (linkErr) throw linkErr;

    res.json({ 
      success: true, 
      redirect_url: linkData.properties.action_link 
    });

  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(500).json({ error: 'Internal server error during auth' });
  }
});

// --- Bot Logic ---

// Handle /start and /start link_TOKEN
if (bot) {
  bot.start(async (ctx) => {
  const startPayload = (ctx as any).startPayload;
  const chatId = ctx.chat.id;
  const username = ctx.from.username || ctx.from.first_name;

  if (startPayload && startPayload.startsWith('link_')) {
    const token = startPayload.replace('link_', '');
    
    try {
      // 1. Find linking token in DB
      const { data: linkData, error: linkErr } = await supabase
        .from('telegram_linking_tokens')
        .select('*')
        .eq('token', token)
        .single();

      if (linkErr || !linkData) {
        return ctx.reply('❌ Ссылка для привязки недействительна или срок её действия истёк. Пожалуйста, создайте новую в Личном кабинете.');
      }

      // 2. Update user profile
      const { data: updateData, error: updateErr, count } = await supabase
        .from('users')
        .update({
          telegram_id: chatId.toString(),
          telegram_linked: true,
          name: username
        })
        .eq('id', linkData.user_id)
        .select();

      if (updateErr) {
        console.error('Bot update database error:', updateErr);
        throw updateErr;
      }

      if (!updateData || updateData.length === 0) {
        console.error('Bot linking: User record not found for ID:', linkData.user_id);
        return ctx.reply('❌ Ошибка: Пользователь не найден в системе. Попробуйте создать новую ссылку для привязки.');
      }

      // 3. Delete the temporary token
      await supabase.from('telegram_linking_tokens').delete().eq('token', token);

      console.log(`Successfully linked Telegram ${chatId} to user ${linkData.user_id}`);
      return ctx.reply('✅ Аккаунт izinet успешно привязан!\n\nТеперь вы можете получать уведомления и управлять подпиской прямо здесь.');
    } catch (error) {
      console.error('Bot linking error:', error);
      return ctx.reply('❌ Произошла ошибка при привязке аккаунта. Попробуйте позже.');
    }
  }

  // Handle Auth (Login)
  if (startPayload && startPayload.startsWith('auth_')) {
    try {
      // 1. Find the user by chatId
      const { data: userData, error: userErr } = await supabase
        .from('users')
        .select('email')
        .eq('telegram_id', chatId.toString())
        .single();

      if (userErr || !userData) {
        return ctx.reply('⚠️ Ваш Telegram не привязан к аккаунту izinet. Сначала привяжите его в личном кабинете на сайте или войдите через Email.');
      }

      // 2. Generate Magic Link
      const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: userData.email,
        options: {
          redirectTo: `${process.env.APP_URL || 'https://izinet.app'}/dashboard`
        }
      });

      if (linkErr) throw linkErr;

      return ctx.reply('🔑 Нажмите на кнопку ниже, чтобы войти в свой аккаунт izinet:', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Войти в личный кабинет', url: linkData.properties.action_link }]
          ]
        }
      });
    } catch (error) {
      console.error('Bot auth error:', error);
      return ctx.reply('❌ Ошибка при генерации ссылки для входа.');
    }
  }

  // Generic welcome
  return ctx.reply(`Привет, ${username}! 🌐\n\nЯ бот izinet. Здесь ты можешь:\n• Проверить статус подписки\n• Узнать остаток трафика\n• Получить помощь\n\nЕсли ты хочешь привязать свой аккаунт, нажми "Привязать Telegram" в личном кабинете на сайте.`);
  });

  // Stats Command
  bot.command('status', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  
  try {
    const { data: userData, error: userErr } = await supabase
      .from('users')
      .select('id, email, balances(amount), subscriptions(*)')
      .eq('telegram_id', chatId)
      .single();

    if (userErr || !userData) {
      return ctx.reply('⚠️ Ваш аккаунт не привязан. Сделайте это в личном кабинете на сайте.');
    }

    const balance = userData.balances?.[0]?.amount || 0;
    const sub = userData.subscriptions?.[0];
    
    let statusText = `👤 Аккаунт: ${userData.email}\n💰 Баланс: ${balance} ₽\n\n`;
    
    if (sub) {
      const expiryDate = new Date(sub.expires_at).toLocaleDateString();
      const trafficUsed = (sub.traffic_used_mb / 1024).toFixed(2);
      const trafficLimit = (sub.traffic_limit_mb / 1024).toFixed(2);
      
      statusText += `💎 Подписка: ${sub.plan_type.toUpperCase()}\n`;
      statusText += `📅 Истекает: ${expiryDate}\n`;
      statusText += `📊 Трафик: ${trafficUsed} / ${trafficLimit} ГБ`;
    } else {
      statusText += `❌ Активной подписки нет.`;
    }

    ctx.reply(statusText);
  } catch (error) {
    console.error('Bot status error:', error);
    ctx.reply('❌ Ошибка при получении данных.');
  }
  });

  // Help Command
  bot.help((ctx) => ctx.reply('Доступные команды:\n/status - Моя подписка и баланс\n/help - Справка\n/support - Связаться с поддержкой'));
}

// Start Polling (Development)
if (bot) {
  bot.launch().then(() => {
    console.log('🤖 Telegram Bot started');
  }).catch((err) => {
    console.error('Bot launch failed. Check your TELEGRAM_BOT_TOKEN');
  });
} else {
  console.log('⚠️ TELEGRAM_BOT_TOKEN is not set. Bot is inactive.');
}

// --- Vite Middleware ---

async function startServer() {
  // Check 3x-ui configuration on startup
  xui.checkConfig();

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

// Enable graceful stop
if (bot) {
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
