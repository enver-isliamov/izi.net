import * as dotenv from 'dotenv';
dotenv.config();

process.on('uncaughtException', (err) => console.error('🔥 [CRITICAL] Exception:', err));
process.on('unhandledRejection', (reason) => console.error('🔥 [CRITICAL] Rejection:', reason));

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import express from 'express';
import cors from 'cors';
import path from 'path';
import axios from 'axios';
import { checkDatabase } from './services/supabase';
import { botService } from './services/bot.service';
import { MaintenanceService } from './services/maintenance.service';

import adminRoutes from './routes/admin';
import paymentRoutes from './routes/payments';
import userRoutes from './routes/user';
import configRoutes from './routes/config';

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3005');

app.use(cors());
app.use(express.json());

// --- МАРШРУТЫ ---
app.use('/api', userRoutes);
app.use('/api', configRoutes);
app.use('/api/subscription', configRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/pay', paymentRoutes);

// --- УНИВЕРСАЛЬНЫЙ SUPABASE PROXY ---
app.all('/api/supabase-proxy/*', async (req, res) => {
  try {
    const targetPath = req.params[0]; // Например: auth/v1/token или rest/v1/users
    const supabaseUrl = (process.env.VITE_SUPABASE_URL || '').replace(/\\/$/, '');
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl) throw new Error('Supabase URL missing');

    // FIX: Не добавляем /rest/v1/, так как путь уже содержит нужный сервис
    const url = supabaseUrl + '/' + targetPath;
    
    const headers: any = {
      'apikey': supabaseKey,
      'Authorization': req.headers.authorization || 'Bearer ' + supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': req.headers.prefer || ''
    };

    const response = await axios({
      method: req.method,
      url: url,
      data: req.body,
      params: req.query,
      headers: headers,
      validateStatus: () => true
    });

    res.status(response.status).json(response.data);
  } catch (err: any) {
    console.error('❌ Proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
    botService.init();
    MaintenanceService.init();
  }
  app.listen(PORT, '0.0.0.0', () => console.log('✅ [BOOT] Сервер запущен на порту ' + PORT));
}

start().catch(err => process.exit(1));

