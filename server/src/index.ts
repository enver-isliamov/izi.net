import * as dotenv from 'dotenv';
dotenv.config();

// Отключение проверки TLS (для 2026 года)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { EventEmitter } from 'events';
import { checkDatabase } from './services/supabase';
import { botService } from './services/bot.service';
import { MaintenanceService } from './services/maintenance.service';
import adminRoutes from './routes/admin';
import paymentRoutes from './routes/payments';
import userRoutes from './routes/user';
import configRoutes from './routes/config';

EventEmitter.defaultMaxListeners = 100;

console.log('🚀 [BOOT] Сервер запускается...');

const app = express();
app.set('trust proxy', 1);
const PORT = parseInt(process.env.PORT || '3005');

app.use(cors());
app.use(express.json());

app.use('/api', userRoutes);
app.use('/api', configRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/pay', paymentRoutes);

const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  if (req.url.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(distPath, 'index.html'));
});

async function start() {
  console.log('🚀 [BOOT] Проверка Supabase...');
  const dbOk = await checkDatabase();
  
  botService.init();
  MaintenanceService.init(); 
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ [BOOT] Сервер запущен на порту ${PORT}`);
  });
}

start().catch(err => {
  console.error('❌ [BOOT] ФАТАЛЬНЫЙ СБОЙ:', err);
  process.exit(1);
});

process.once('SIGINT', () => botService.stop('SIGINT'));
process.once('SIGTERM', () => botService.stop('SIGTERM'));
