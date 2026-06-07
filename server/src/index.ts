import * as dotenv from 'dotenv';
dotenv.config();

// Глобальные обработчики ошибок (Fix: Логирование перед падением)
process.on('uncaughtException', (err) => {
  console.error('🔥 [CRITICAL] Необработанное исключение:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 [CRITICAL] Необработанный промис:', promise, 'причина:', reason);
});

// Санитарная очистка ключей Reality (Fix: замена .strip() на .trim())
if (process.env.XUI_REALITY_PUB_KEY) {
  process.env.XUI_REALITY_PUB_KEY = process.env.XUI_REALITY_PUB_KEY.split('#')[0].trim().replace(/[^a-zA-Z0-9\-_]/g, '');
}
if (process.env.XUI_REALITY_PRIV_KEY) {
  process.env.XUI_REALITY_PRIV_KEY = process.env.XUI_REALITY_PRIV_KEY.split('#')[0].trim().replace(/[^a-zA-Z0-9\-_]/g, '');
}

// Отключение проверки TLS (для 2026 года)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import express from 'express';
import cors from 'cors';
import path from 'path';
import axios from 'axios';
import { EventEmitter } from 'events';
import { checkDatabase } from './services/supabase';
import { botService } from './services/bot.service';
import { MaintenanceService } from './services/maintenance.service';
import adminRoutes from './routes/admin';
import paymentRoutes from './routes/payments';
import userRoutes from './routes/user';
import configRoutes from './routes/config';

EventEmitter.defaultMaxListeners = 100;

console.log('🚀 [BOOT] Инициализация сервера...');

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3005');

app.use(cors());
app.use(express.json());

// --- Transparent Supabase Proxy (Fix Admin Panel Data) ---
app.all('/api/supabase-proxy/*', async (req, res) => {
  const targetPath = req.params[0];
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  
  if (!supabaseUrl) return res.status(500).json({ error: 'Supabase URL not configured' });

  const queryString = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  const url = `${supabaseUrl}/${targetPath}${queryString}`;
  
  try {
    const proxyHeaders: any = {
      'apikey': process.env.VITE_SUPABASE_ANON_KEY || '',
      'Authorization': req.headers.authorization || `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    };
    
    if (req.headers['range']) proxyHeaders['range'] = req.headers['range'];
    if (req.headers['prefer']) proxyHeaders['prefer'] = req.headers['prefer'];

    const response = await axios({
      method: req.method,
      url: url,
      data: req.body,
      headers: proxyHeaders,
      validateStatus: () => true
    });

    res.status(response.status).json(response.data);
  } catch (error: any) {
    console.error(`❌ [Proxy Error] ${targetPath}:`, error.message);
    res.status(500).json({ error: 'Proxy failed' });
  }
});

// Маршруты API
app.use('/api', userRoutes);
app.use('/api', configRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/pay', paymentRoutes);

// Статика фронтенда
const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  if (req.url.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(distPath, 'index.html'));
});

async function start() {
  console.log('🚀 [BOOT] Проверка Supabase...');
  const dbOk = await checkDatabase();
  
  if (dbOk) {
    console.log('🚀 [BOOT] Инициализация сервисов...');
    botService.init();
    MaintenanceService.init(); 
  } else {
    console.error('⚠️ [BOOT] База данных недоступна. Проверьте .env');
  }
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ [BOOT] Сервер успешно запущен на порту ${PORT}`);
  });
}

start().catch(err => {
  console.error('❌ [BOOT] ФАТАЛЬНЫЙ СБОЙ ПРИ ЗАПУСКЕ:', err);
  process.exit(1);
});

process.once('SIGINT', () => botService.stop('SIGINT'));
process.once('SIGTERM', () => botService.stop('SIGTERM'));
