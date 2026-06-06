 import * as dotenv from 'dotenv';
        // Инициализация переменных окружения ПЕРЕД всеми остальными импортами
        dotenv.config();
       
        // Отключение проверки TLS сертификатов (необходимо для среды 2026 года)
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
      
       // Увеличение лимитов для предотвращения утечек
       EventEmitter.defaultMaxListeners = 100;
      
       console.log('🚀 [BOOT] Инициализация сервера...');
      
       const app = express();
       app.set('trust proxy', 1); // Доверяем Nginx/Cloudflare
       const PORT = parseInt(process.env.PORT || '3005');
      
       app.use(cors());
       app.use(express.json());
      
       // Маршруты API
       app.use('/api', userRoutes);
       app.use('/api', configRoutes);
       app.use('/api/admin', adminRoutes);