import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { Telegraf, Context } from 'telegraf';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import crypto from 'crypto';

// --- Types for Advanced Device Management ---
export interface VpnDevice {
  id: string;
  label: string;
  config: string;
  email: string;
  uuid: string;
  expiresAt: string;
  serverType: string;
  trafficUsedBytes: number;
}

// Support function to migrate legacy v2ray_config text to JSON
function parseVpnDevices(configStr: string | null, rootExpiresAt?: string, rootServerType?: string): VpnDevice[] {
  if (!configStr) return [];
  
  if (configStr.trim().startsWith('[')) {
    try {
      return JSON.parse(configStr);
    } catch (e) {
      console.warn("Failed to parse JSON config, falling back to legacy", e);
    }
  }

  // Legacy parsing
  const configs = configStr.split('\n---KEY_SEP---\n').filter(Boolean);
  return configs.map((cfg, index) => {
    const uuidMatch = cfg.match(/vless:\/\/([^@]+)@/);
    const emailMatch = cfg.match(/#izinet_([^&?#\s]+)/);
    return {
      id: index === 0 ? 'primary' : `device_${index}`,
      label: index === 0 ? 'Основное устройство' : `Доп. устройство ${index}`,
      config: cfg,
      email: emailMatch ? emailMatch[1] : 'unknown',
      uuid: uuidMatch ? uuidMatch[1] : 'unknown',
      expiresAt: rootExpiresAt || new Date().toISOString(),
      serverType: rootServerType || 'Wi-Fi',
      trafficUsedBytes: 0
    };
  });
}
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
    if (!this.host || !this.username || !this.password) {
      console.warn('⚠️ 3x-ui credentials missing in environment variables!');
      return false;
    }
    try {
      await this.login();
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
      return cookie;
    } catch (error: any) {
      console.error('❌ 3x-ui login error:', error.message);
      if (error.code === 'ERR_TLS_CERT_ALTNAME_INVALID' || error.message.includes('hostname')) {
        console.warn('💡 Tip: Try using IP address in XUI_HOST instead of domain if certificate is invalid.');
      }
      throw error;
    }
  }

  async addClient(email: string, uuid: string, inboundId: number, expiryTime: number = 0, limitBytes: number = 0) {
    if (!this.sessionCookie) await this.login();

    // First, let's try to get the inbound to see its settings (for link generation later)
    let inbound;
    try {
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
            limitIp: 1,
            totalGB: limitBytes,
            expiryTime: expiryTime,
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
        console.log(`✅ Client ${email} added to 3x-ui with expiry ${expiryTime}`);
        
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

            const sni = realitySettings.serverNames?.[0] || 'google.com';
            // Extract from realitySettings.settings.publicKey or realitySettings.publicKey depending on XUI version
            const pbk = realitySettings.settings?.publicKey || realitySettings.publicKey || '';
            const sid = realitySettings.shortIds?.[0] || '';
            
            if (!pbk) throw new Error("Public key not found in inbound");
            
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
        return this.addClient(email, uuid, inboundId, expiryTime);
      }
      console.error('❌ 3x-ui addClient error:', error.message);
      throw error;
    }
  }

  async updateClient(email: string, uuid: string, inboundId: number, expiryTime: number, limitBytes: number = 0) {
    if (!this.sessionCookie) await this.login();

    const clientData = {
      id: inboundId,
      settings: JSON.stringify({
        clients: [
          {
            id: uuid,
            flow: "xtls-rprx-vision",
            email: email,
            limitIp: 1,
            totalGB: limitBytes,
            expiryTime: expiryTime,
            enable: true,
            tgId: "",
            subId: ""
          }
        ]
      })
    };

    try {
      // 3x-ui uses updateClient/{uuid}
      const updateClientUrl = `${this.host}/panel/api/inbounds/updateClient/${uuid}`;
      const response = await axios.post(
        updateClientUrl,
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
        console.log(`✅ Client ${email} updated in 3x-ui with expiry ${expiryTime}`);
        return true;
      } else {
        console.warn(`⚠️ Failed to update client in 3x-ui: ${response.data.msg}`);
        return false;
      }
    } catch (error: any) {
      console.error('❌ 3x-ui updateClient error:', error.message);
      return false;
    }
  }

  async getClientTraffic(email: string) {
    if (!this.sessionCookie) await this.login();

    try {
      const response = await axios.get(`${this.host}/panel/api/inbounds/getClientTraffics/${email}`, {
        headers: { 'Cookie': this.sessionCookie },
        httpsAgent: httpsAgent
      });

      if (response.data.success && response.data.obj) {
        const stats = response.data.obj;
        // up + down in bytes. total field in 3x-ui represents the LIMIT in bytes
        return {
          up: stats.up || 0,
          down: stats.down || 0,
          used: (stats.up || 0) + (stats.down || 0),
          limit: stats.total || 0
        };
      }
      return null;
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.sessionCookie = null;
        return this.getClientTraffic(email);
      }
      console.error(`❌ 3x-ui getClientTraffic error for ${email}:`, error.message);
      return null;
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

app.post('/api/support/notify', async (req, res) => {
  const { ticketId, type, content } = req.body;
  
  if (!bot || !botAdminId) {
    return res.status(503).json({ error: 'Telegram bot not configured' });
  }

  try {
    if (type === 'new_ticket') {
      const { data: ticket } = await supabase.from('support_tickets').select('*, users(email)').eq('id', ticketId).single();
      if (ticket) {
        const msg = `🆕 <b>Новое обращение!</b>\n\n<b>От:</b> ${ticket.users?.email || 'Неизвестный'}\n<b>Тема:</b> ${ticket.subject}\n<b>Текст:</b> ${ticket.message}\n\n<i>ID: ${ticket.id}</i>\n----------\nОтветьте на это сообщение для связи.`;
        await bot.telegram.sendMessage(botAdminId, msg, { parse_mode: 'HTML' });
      }
    } else if (type === 'new_message') {
      const { data: msgData } = await supabase.from('support_messages').select('*, support_tickets(subject, user_id)').eq('id', ticketId).single();
      if (msgData) {
        const { data: user } = await supabase.from('users').select('email').eq('id', msgData.support_tickets.user_id).single();
        const msg = `💬 <b>Новое сообщение в тикете!</b>\n\n<b>От:</b> ${user?.email || 'Неизвестный'}\n<b>Тема:</b> ${msgData.support_tickets.subject}\n<b>Текст:</b> ${msgData.content}\n\n<i>ID Тикета: ${msgData.ticket_id}</i>\n----------\nОтветьте для ответа.`;
        await bot.telegram.sendMessage(botAdminId, msg, { parse_mode: 'HTML' });
      }
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('Manual notify error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 💰 Create Payment Link
app.post('/api/pay/create', async (req, res) => {
  const { userId, amount, method } = req.body;
  const authHeader = req.headers.authorization;
  
  if (!userId || !amount || !method) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  // Security check: Verify token
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user || user.id !== userId) {
      return res.status(401).json({ error: 'Unauthorized: ID mismatch' });
    }
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

// 📊 Sync user traffic manually
app.post('/api/subscription/sync-traffic', async (req, res) => {
  const { userId } = req.body;
  const authHeader = req.headers.authorization;
  
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  // Security check: Verify token
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user || user.id !== userId) {
      return res.status(401).json({ error: 'Unauthorized: ID mismatch' });
    }
  }

  try {
    const updatedSub = await syncUserTraffic(userId);
    res.json({ success: true, subscription: updatedSub });
  } catch (error: any) {
    console.error('❌ Manual traffic sync error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
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
app.get('/api/config', (req, res) => {
  res.json({
    telegramBotName: process.env.VITE_TELEGRAM_BOT_NAME || process.env.TELEGRAM_BOT_NAME || 'izinet_bot'
  });
});

app.get('/api/health', (req, res) => {
  const configStatus = {
    supabase: !!process.env.VITE_SUPABASE_URL,
    bot: !!process.env.TELEGRAM_BOT_TOKEN,
    xui: !!process.env.XUI_HOST && !!process.env.XUI_USERNAME && !!process.env.XUI_PASSWORD,
    inboundId: process.env.XUI_INBOUND_ID || '1'
  };
  res.json({ status: 'ok', config: configStatus });
});

// --- Subscription Routes ---
app.post('/api/subscription/buy', async (req, res) => {
  const { userId, planId, planName, price, durationDays, periodMonths, serverType, deviceLimit, forceNew, targetDeviceId, deviceName } = req.body;
  const authHeader = req.headers.authorization;

  if (!userId || !planId || !price) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // 0. Security check: Verify token
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user || user.id !== userId) {
      return res.status(401).json({ error: 'Unauthorized: ID mismatch' });
    }
  }

  try {
    // 1. Get current balance
    const { data: balanceData, error: balanceErr } = await supabase
      .from('balances')
      .select('amount')
      .eq('user_id', userId)
      .single();

    if (balanceErr || !balanceData) throw new Error('Balance not found');
    if (balanceData.amount < price) return res.status(400).json({ error: 'Insufficient balance' });

    // 2. Fetch last subscription & Parse existing devices
    const { data: lastSub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const existingDevices: VpnDevice[] = parseVpnDevices(
      lastSub?.v2ray_config || null,
      lastSub?.expires_at,
      lastSub?.server_type
    );

    const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
    const trafficLimitMb = 100 * 1024; // 100 GB default limit per device logic (you can tune this)
    const limitBytes = trafficLimitMb * 1024 * 1024;

    let targetDevice: VpnDevice | undefined;

    if (forceNew || existingDevices.length === 0) {
      // 3A. CREATE NEW DEVICE
      if (existingDevices.length >= 2) {
        return res.status(400).json({ error: 'Превышен лимит: можно добавить только 1 дополнительное устройство.' });
      }

      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const email = `user_${userId.slice(0, 8)}_${randomSuffix}`;
      const uuid = crypto.randomUUID();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + durationDays);

      console.log(`🆕 Creating VPN client ${email}...`);
      const rawConfig = await xui.addClient(email, uuid, inboundId, expiresAt.getTime(), limitBytes);
      
      const newDevice: VpnDevice = {
        id: existingDevices.length === 0 ? 'primary' : `device_${uuid.slice(0,8)}`,
        label: deviceName || (existingDevices.length === 0 ? 'Основное' : 'Доп. устройство'),
        config: rawConfig,
        email: email,
        uuid: uuid,
        expiresAt: expiresAt.toISOString(),
        serverType: serverType || 'LTE',
        trafficUsedBytes: 0
      };
      existingDevices.push(newDevice);
      targetDevice = newDevice;

    } else {
      // 3B. RENEW SPECIFIC OR PRIMARY DEVICE
      const idToRenew = targetDeviceId || existingDevices[0].id;
      targetDevice = existingDevices.find(d => d.id === idToRenew);
      
      if (!targetDevice) {
        return res.status(404).json({ error: 'Устройство для продления не найдено.' });
      }

      const currentExpiry = new Date(targetDevice.expiresAt);
      const newExpiresAt = currentExpiry > new Date() ? new Date(currentExpiry) : new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + durationDays);
      
      targetDevice.expiresAt = newExpiresAt.toISOString();
      targetDevice.serverType = serverType || targetDevice.serverType;
      
      console.log(`♻️ Syncing expiration for specific device ${targetDevice.email}`);
      await xui.updateClient(targetDevice.email, targetDevice.uuid, inboundId, newExpiresAt.getTime(), limitBytes);
    }

    // Determine absolute max expiry for the subscription row
    const maxExpiryDate = existingDevices.reduce((max, d) => {
      const dDate = new Date(d.expiresAt);
      return dDate > max ? dDate : max;
    }, new Date(0));

    const finalConfigJson = JSON.stringify(existingDevices);

    // 4. Update or Insert Database Record
    let subData, subErr;
    if (lastSub) {
      const { data: updatedSub, error: updateErr } = await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          expires_at: maxExpiryDate.toISOString(),
          plan_type: planName.toLowerCase(),
          period_months: periodMonths || 1,
          server_type: serverType || lastSub.server_type,
          device_limit: existingDevices.length,
          v2ray_config: finalConfigJson
        })
        .eq('id', lastSub.id)
        .select()
        .single();
      subData = updatedSub; subErr = updateErr;
    } else {
      const { data: newSub, error: insertErr } = await supabase
        .from('subscriptions')
        .insert({
          user_id: userId,
          plan_type: planName.toLowerCase(),
          status: 'active',
          expires_at: maxExpiryDate.toISOString(),
          v2ray_config: finalConfigJson,
          server_type: serverType,
          period_months: periodMonths || 1,
          device_limit: existingDevices.length,
          traffic_limit_mb: trafficLimitMb,
          traffic_used_mb: 0
        })
        .select()
        .single();
      subData = newSub; subErr = insertErr;
    }

    if (subErr) {
      console.error('❌ Supabase sub operation error:', JSON.stringify(subErr, null, 2));
      throw subErr;
    }

    // 5. Deduct balance
    const { error: deductErr } = await supabase
      .from('balances')
      .update({ amount: balanceData.amount - price })
      .eq('user_id', userId);

    if (deductErr) console.error('CRITICAL: Subscription processed but balance deduction failed!', deductErr);

    res.json({ success: true, subscription: subData, updatedDevice: targetDevice });

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
const botName = process.env.VITE_TELEGRAM_BOT_NAME || 'izinet_bot';
const botAdminId = process.env.TELEGRAM_ADMIN_ID;
const bot = botToken ? new Telegraf(botToken) : null;

// Bot Session and State Management
const botSessions = new Map<number, { state: string }>();
const adminReplyMap = new Map<number, number>(); // Maps admin's message ID to user's chat ID


// --- Realtime DB Listener ---
// This listens for manual changes in the database (e.g., via Supabase Dashboard)
// and syncs them to the 3x-ui panel automatically.
function setupRealtimeListener() {
  console.log('🔄 Setting up Realtime DB Listener...');
  
  supabase
    .channel('subscription-sync')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'subscriptions'
      },
      async (payload) => {
        const newData = payload.new;
        const oldData = payload.old;

        // If expiry date, config or traffic limit changed, sync to XUI
        if (
          newData.expires_at !== oldData.expires_at || 
          newData.v2ray_config !== oldData.v2ray_config ||
          newData.traffic_limit_mb !== oldData.traffic_limit_mb
        ) {
          console.log(`🔔 Manual DB update detected for sub ${newData.id}. Syncing to 3x-ui...`);
          
          const userId = newData.user_id;
          const vpnEmail = `user_${userId.slice(0, 8)}`;
          const inboundId = parseInt(process.env.XUI_INBOUND_ID || '1');
          const expiryTimestamp = new Date(newData.expires_at).getTime();
          const trafficLimitMb = newData.traffic_limit_mb || 102400;
          const limitBytes = trafficLimitMb * 1024 * 1024;
          
          const uuidMatch = newData.v2ray_config.match(/vless:\/\/([^@]+)@/);
          if (uuidMatch) {
            const uuid = uuidMatch[1];
            await xui.updateClient(vpnEmail, uuid, inboundId, expiryTimestamp, limitBytes);
          }
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'support_tickets'
      },
      async (payload) => {
        const newTicket = payload.new;
        if (bot && botAdminId) {
          try {
            const { data: user } = await supabase.from('users').select('email').eq('id', newTicket.user_id).single();
            const msg = `🆕 <b>Новое обращение!</b>\n\n<b>От:</b> ${user?.email || 'Неизвестный'}\n<b>Тема:</b> ${newTicket.subject}\n<b>Обращение:</b> ${newTicket.message}\n\n<i>ID Тикета: ${newTicket.id}</i>\n----------\nОтветьте на это сообщение для связи с пользователем.`;
            await bot.telegram.sendMessage(botAdminId, msg, { parse_mode: 'HTML' });
          } catch (e) {
            console.error('Error sending ticket to admin TG', e);
          }
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'support_messages',
        filter: "sender=eq.user"
      },
      async (payload) => {
        const newMessage = payload.new;
        if (bot && botAdminId) {
          try {
             // Get ticket info for user email
             const {data: t} = await supabase.from('support_tickets').select('user_id, subject').eq('id', newMessage.ticket_id).single();
             if (t) {
               const {data: u} = await supabase.from('users').select('email').eq('id', t.user_id).single();
               const msg = `💬 <b>Новое сообщение в тикете!</b>\n\n<b>От:</b> ${u?.email || 'Неизвестный'}\n<b>Тема:</b> ${t.subject}\n<b>Сообщение:</b> ${newMessage.content}\n\n<i>ID Тикета: ${newMessage.ticket_id}</i>\n----------\nОтветьте на это сообщение для ответа пользователю.`;
               await bot.telegram.sendMessage(botAdminId, msg, { parse_mode: 'HTML' });
             }
          } catch (e) {
             console.error('Error sending message to admin TG', e);
          }
        }
      }
    )
    .subscribe((status) => {
      console.log(`📡 Realtime subscription status: ${status}`);
    });
}

// --- Traffic Synchronization Task ---
/**
 * Syncs traffic for a specific user.
 * @param userId - The ID of the user to sync
 * @returns The subscription data with updated traffic
 */
async function syncUserTraffic(userId: string) {
  // 1. Get current active subscription
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub) return null;

  // 2. Identify all devices by parsing VpnDevice JSON
  const devices = parseVpnDevices(sub.v2ray_config, sub.expires_at, sub.server_type);

  let totalUsedBytes = 0;
  let maxLimitBytes = 0;

  // 3. Fetch stats for all devices
  for (const device of devices) {
    try {
      const stats = await xui.getClientTraffic(device.email);
      if (stats) {
        device.trafficUsedBytes = stats.used;
        totalUsedBytes += stats.used;
        maxLimitBytes = Math.max(maxLimitBytes, stats.limit);
      }
    } catch (e) {
      console.warn(`Could not sync traffic for individual device ${device.email}`, e);
    }
  }

  const trafficUsedMb = Math.round(totalUsedBytes / (1024 * 1024));
  const trafficLimitMb = maxLimitBytes > 0 ? Math.round(maxLimitBytes / (1024 * 1024)) : sub.traffic_limit_mb || 102400;

  // 4. Update the subscription in DB, saving back the updated devices JSON
  const { data, error } = await supabase
    .from('subscriptions')
    .update({ 
      traffic_used_mb: trafficUsedMb,
      traffic_limit_mb: trafficLimitMb,
      v2ray_config: JSON.stringify(devices)
    })
    .eq('id', sub.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error(`❌ Error updating aggregate traffic for user ${userId}:`, error.message);
    return null;
  }
  return data;
}

async function syncTrafficStats() {
  try {
    // 1. Get all active subscriptions
    const { data: subs, error } = await supabase
      .from('subscriptions')
      .select('user_id')
      .gt('expires_at', new Date().toISOString()); // Only active ones

    if (error) throw error;
    if (!subs || subs.length === 0) return;

    // Use a Set to avoid duplicate syncs if a user somehow has multiple active subs
    const userIds = Array.from(new Set(subs.map(s => s.user_id)));

    for (const userId of userIds) {
      await syncUserTraffic(userId);
    }
    
  } catch (err) {
    console.error('❌ Global traffic sync error:', err);
  }
}

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

const showMainMenu = (ctx: any) => {
  const username = ctx.from.username || ctx.from.first_name;
  return ctx.reply(`Привет, ${username}! 🌐\n\nЯ бот ${botName}. Здесь ты можешь:\n• Проверить статус подписки\n• Узнать остаток трафика\n• Изменить пароль\n• Обратиться в поддержку`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Моя подписка и баланс', callback_data: 'action_status' }],
        [{ text: '🎧 Связаться с поддержкой', callback_data: 'action_support' }],
        [{ text: '🔑 Сменить пароль', callback_data: 'action_password' }],
        [{ text: 'ℹ️ Справка', callback_data: 'action_help' }]
      ]
    }
  });
};

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
      const { data: updateData, error: updateErr } = await supabase
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
      await ctx.reply('✅ Аккаунт izinet успешно привязан!\n\nТеперь вы можете получать уведомления и управлять подпиской прямо здесь.');
      return showMainMenu(ctx);
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
  return showMainMenu(ctx);
  });

  bot.action('action_status', async (ctx) => {
    ctx.answerCbQuery();
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;
    
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

  bot.action('action_support', (ctx) => {
    ctx.answerCbQuery();
    if (!ctx.chat) return;
    botSessions.set(ctx.chat.id, { state: 'support' });
    ctx.reply('🎧 Вы перешли в режим поддержки.\nНапишите ваш вопрос следующим сообщением, и наш специалист ответит вам.\n\nДля выхода из режима поддержки нажмите кнопку ниже.', {
      reply_markup: {
        inline_keyboard: [[{ text: '❌ Выйти из режима поддержки', callback_data: 'action_exit_mode' }]]
      }
    });
  });

  bot.action('action_password', (ctx) => {
    ctx.answerCbQuery();
    if (!ctx.chat) return;
    botSessions.set(ctx.chat.id, { state: 'password' });
    ctx.reply('🔑 Введите новый пароль для вашего аккаунта (минимум 8 символов):\n\nДля отмены нажмите кнопку ниже.', {
      reply_markup: {
        inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'action_exit_mode' }]]
      }
    });
  });

  bot.action('action_help', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply(`Доступные команды:\n• Моя подписка и баланс\n• Связаться с поддержкой\n• Сменить пароль\n\nВсё это доступно в главном меню командой /start`);
  });

  bot.action('action_exit_mode', (ctx) => {
    ctx.answerCbQuery();
    if (!ctx.chat) return;
    botSessions.delete(ctx.chat.id);
    ctx.reply('✅ Вы вернулись в обычный режим.', {
      reply_markup: {
        inline_keyboard: [[{ text: '◀️ В главное меню', callback_data: 'action_menu' }]]
      }
    });
  });

  bot.action('action_menu', (ctx) => {
    ctx.answerCbQuery();
    return showMainMenu(ctx);
  });

  // Handle all other text messages
  bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    // Check if admin is replying to a forwarded user message
    if (botAdminId && chatId.toString() === botAdminId.toString()) {
      const replyToMsg = ctx.message.reply_to_message;
      if (replyToMsg) {
        // Fallback or explicit mapping check for live-chat TG-TG
        const originalChatId = adminReplyMap.get(replyToMsg.message_id);
        if (originalChatId) {
          try {
            await ctx.telegram.sendMessage(originalChatId, `💬 Сообщение от поддержки:\n\n${text}`);
            return;
          } catch(e) {
            console.error('Failed to send reply to user', e);
            return ctx.reply('❌ Ошибка отправки ответа пользователю.');
          }
        }
        
        // --- NEW: Handle replies to UI Tickets ---
        if ('text' in replyToMsg && replyToMsg.text) {
          const match = replyToMsg.text.match(/ID Тикета:\s*([a-f0-9\-]+)/i);
          if (match && match[1]) {
            const ticketId = match[1];
            try {
              // Check if ticket exists first? Just insert message.
              await supabase.from('support_messages').insert({
                ticket_id: ticketId,
                sender: 'admin',
                content: text
              });
              
              // Also update ticket status to in_progress or somewhat
              // await supabase.from('support_tickets').update({status: 'in_progress'}).eq('id', ticketId);
              
              ctx.reply('✅ Ответ доставлен пользователю в интерфейс приложения.');
              return;
            } catch(e) {
              console.error('Failed to save admin reply to db', e);
              return ctx.reply('❌ Ошибка сохранения ответа в базу данных.');
            }
          }
        }
      }
    }

    // Check user sessions
    const session = botSessions.get(chatId);
    
    if (session?.state === 'support') {
      if (!botAdminId) {
         return ctx.reply('К сожалению, поддержка сейчас недоступна.');
      }
      try {
        const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
        // Send to admin
        const sentMsg = await ctx.telegram.sendMessage(botAdminId, `🆘 Вопрос от пользователя ${username} (ID: ${chatId}):\n\n${text}`);
        // Save mapping so admin can reply
        adminReplyMap.set(sentMsg.message_id, chatId);
        ctx.reply('✅ Ваше сообщение отправлено в поддержку. Ожидайте ответа (можно писать ещё сообщения, мы их получим).');
      } catch (error) {
         console.error('Failed to forward to admin', error);
         ctx.reply('❌ Ошибка связи с сервером поддержки.');
      }
      return;
    }

    if (session?.state === 'password') {
      if (text.length < 8) {
        return ctx.reply('⚠️ Пароль должен содержать минимум 8 символов. Попробуйте еще раз:');
      }

      // Reset password logic
      try {
        // Find user
        const { data: userData, error: userErr } = await supabase
          .from('users')
          .select('id')
          .eq('telegram_id', chatId.toString())
          .single();

        if (userErr || !userData) {
          botSessions.delete(chatId);
          return ctx.reply('⚠️ Ваш Telegram не привязан к аккаунту izinet. Невозможно сменить пароль.');
        }

        const { error: updateErr } = await supabase.auth.admin.updateUserById(userData.id, {
          password: text
        });

        if (updateErr) throw updateErr;

        botSessions.delete(chatId);
        ctx.reply('✅ Пароль успешно изменен! Вы можете использовать его для входа.', {
          reply_markup: {
            inline_keyboard: [[{ text: '◀️ В главное меню', callback_data: 'action_menu' }]]
          }
        });
      } catch (error) {
        console.error('Password change error', error);
        ctx.reply('❌ Ошибка при смене пароля. Попробуйте позже.');
      }
      return;
    }

    // Default reply if no session and not a command
    ctx.reply('Я не понимаю эту команду. Воспользуйтесь меню.', {
      reply_markup: {
        inline_keyboard: [[{ text: '◀️ В главное меню', callback_data: 'action_menu' }]]
      }
    });
  });

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
  
  // Setup Realtime DB Listener for manual syncing
  setupRealtimeListener();

  // Initial traffic sync and schedule every 15 minutes
  syncTrafficStats();
  setInterval(syncTrafficStats, 15 * 60 * 1000);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    // Catch-all for dev mode if Vite middleware didn't handle it
    app.get('*', async (req, res, next) => {
      if (req.url.startsWith('/api')) return next();
      try {
        const template = await vite.transformIndexHtml(req.url, '<html>...</html>'); // Minimal template
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
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
