import express from 'express';
import cors from 'cors';
import path from 'path';
import * as dotenv from 'dotenv';
import { checkDatabase } from './services/supabase';
import { botService } from './services/bot.service';
import { MaintenanceService } from './services/maintenance.service';
import adminRoutes from './routes/admin';
import paymentRoutes from './routes/payments';
import userRoutes from './routes/user';
import configRoutes from './routes/config';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3005');

app.use(cors());
app.use(express.json());

// API Routes
app.use('/api', userRoutes);
app.use('/api', configRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/pay', paymentRoutes);

// Static frontend
const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  if (req.url.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(distPath, 'index.html'));
});

async function start() {
  await checkDatabase();
  botService.init();
  
  // Включаем службу обслуживания для синхронизации трафика и правил маршрутизации
  MaintenanceService.init(); 
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
  });
}

start().catch(console.error);

process.once('SIGINT', () => botService.stop('SIGINT'));
process.once('SIGTERM', () => botService.stop('SIGTERM'));
