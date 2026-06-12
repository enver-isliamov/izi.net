import * as dotenv from 'dotenv';
dotenv.config();

console.log('📦 [ENV] Загружено переменных:', Object.keys(process.env).filter(k => !k.startsWith('npm_')).length);

process.on('uncaughtException', (err) => console.error('🔥 [CRITICAL] Необработанное исключение:', err));
process.on('unhandledRejection', (reason) => console.error('🔥 [CRITICAL] Необработанный промис:', reason));

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import express from 'express';
import cors from 'cors';
import path from 'path';
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

// --- РЕГИСТРАЦИЯ МАРШРУТОВ (СИНХРОНИЗАЦИЯ С ФРОНТЕНДОМ) ---

// 1. Пользовательские маршруты
app.use('/api', userRoutes);

// 2. Системные конфиги и универсальные ссылки
app.use('/api', configRoutes);
// FIX: Дублируем маршруты под префиксом /subscription для совместимости с фронтендом
app.use('/api/subscription', configRoutes);

// 3. Админ-панель (строго под префиксом /api/admin)
app.use('/api/admin', adminRoutes);

// 4. Платежная система (строго под префиксом /api/pay)
app.use('/api/pay', paymentRoutes);

const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  if (req.url.startsWith('/api')) return res.status(404).json({ error: 'Route not found' });
  res.sendFile(path.join(distPath, 'index.html'));
});

async function start() {
  console.log('🚀 [BOOT] Проверка Supabase...');
  const dbOk = await checkDatabase();
  if (dbOk) {
    console.log('🚀 [BOOT] Инициализация сервисов...');
    botService.init();
    MaintenanceService.init();
  }
  app.listen(PORT, '0.0.0.0', () => console.log('✅ [BOOT] Сервер запущен на порту ' + PORT));
}

start().catch(err => process.exit(1));

