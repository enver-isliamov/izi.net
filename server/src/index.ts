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

console.log('🚀 [BOOT] Инициализация сервера...');

const app = express();
const PORT = parseInt(process.env.PORT || '3005');

app.use(cors());
app.use(express.json());

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
  console.log('🚀 [BOOT] Проверка базы данных...');
  const dbOk = await checkDatabase();
  if (!dbOk) {
    console.error('❌ [BOOT] Критическая ошибка: База данных не отвечает.');
  }

  console.log('🚀 [BOOT] Запуск Telegram бота...');
  botService.init();
  
  console.log('🚀 [BOOT] Запуск службы обслуживания...');
  MaintenanceService.init(); 
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ [BOOT] Сервер успешно запущен на порту ${PORT}`);
  });
}

start().catch(err => {
  console.error('❌ [BOOT] Фатальная ошибка при запуске:', err);
});

process.once('SIGINT', () => botService.stop('SIGINT'));
process.once('SIGTERM', () => botService.stop('SIGTERM'));
