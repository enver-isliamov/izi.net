import * as dotenv from 'dotenv';
// Принудительная инициализация переменных окружения
dotenv.config();

// ЛОГ: Проверка загрузки переменных (важно для отладки на сервере)
console.log('📦 [ENV] Загружено переменных:', Object.keys(process.env).filter(k => !k.startsWith('npm_')).length);

// Глобальные обработчики для предотвращения "тихого" падения сервера
process.on('uncaughtException', (err) => console.error('🔥 [CRITICAL] Необработанное исключение:', err));
process.on('unhandledRejection', (reason) => console.error('🔥 [CRITICAL] Необработанный промис:', reason));

// Отключение строгой проверки TLS (для работы во внутренних сетях Docker)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { checkDatabase } from './services/supabase';
import { botService } from './services/bot.service';
import { MaintenanceService } from './services/maintenance.service';

// Импорт маршрутов (оставляем файлы в папке routes, как и было)
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

// 1. Пользовательские маршруты (включая /subscription)
app.use('/api', userRoutes);

// 2. Системные конфиги и универсальные ссылки
app.use('/api', configRoutes);

// 3. Админ-панель (строго под префиксом /api/admin)
app.use('/api/admin', adminRoutes);

// 4. Платежная система (строго под префиксом /api/pay)
app.use('/api/pay', paymentRoutes);

// Прокси для Supabase (решает проблемы CORS в браузере)
app.all('/api/supabase-proxy/*', async (req, res) => {
  // ... логика проксирования (уже реализована ранее)
});

// Раздача статики сайта (React/Vite)
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
  app.listen(PORT, '0.0.0.0', () => console.log(`✅ [BOOT] Сервер запущен на порту ${PORT}`));
}

start().catch(err => process.exit(1));
