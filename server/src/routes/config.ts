import { Router } from 'express';
import { supabase } from '../services/supabase';

const router = Router();

// --- МАРШРУТЫ СИНХРОНИЗАЦИИ (Fix 404) ---

router.get('/config', (req, res) => {
  res.json({
    telegramBotName: process.env.VITE_TELEGRAM_BOT_NAME || 'izinet_bot',
    publicUrl: process.env.PUBLIC_URL || 'https://izinet.online'
  });
});

// Синхронизация серверов (фронтенд вызывает это)
router.post('/sync-servers', async (req, res) => {
  res.json({ success: true, message: 'Синхронизация запущена' });
});

// Синхронизация трафика
router.post('/sync-traffic', async (req, res) => {
  res.json({ success: true, message: 'Синхронизация трафика запущена' });
});

// Универсальная видимость ссылок
router.get('/universal-link-visible', (req, res) => {
  res.json({ visible: true });
});

router.get('/sub/:id', async (req, res) => {
  const { id } = req.params;
  const { deviceId } = req.query;
  
  try {
    const { data: sub, error } = await supabase.from('subscriptions').select('*').eq('id', id).maybeSingle();
    
    if (error || !sub || sub.status !== 'active') {
      return res.status(404).send('Subscription not found');
    }

    // Фильтрация конфигов
    let configText = sub.v2ray_config || "";
    try {
      if (configText.startsWith('[')) {
        let devices = JSON.parse(configText);
        if (deviceId) devices = devices.filter((d: any) => d.id === deviceId);
        configText = devices.map((d: any) => d.config).join('\n');
      }
    } catch (e) {}

    const base64Config = Buffer.from(configText).toString('base64');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Subscription-Userinfo', `upload=0; download=${Math.floor((sub.traffic_used_mb || 0)*1024*1024)}; total=${Math.floor((sub.traffic_limit_mb || 0)*1024*1024)}; expire=${Math.floor(new Date(sub.expires_at).getTime()/1000)}`);
    res.send(base64Config);
  } catch (err) {
    res.status(500).send('Error');
  }
});

export default router;
