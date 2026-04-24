import { useState, useEffect } from 'react';

export function useAppConfig() {
  const [telegramBotName, setTelegramBotName] = useState('izinet_bot');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If we have it in vite env (client-side), use it directly
    if (import.meta.env.VITE_TELEGRAM_BOT_NAME) {
      setTelegramBotName(import.meta.env.VITE_TELEGRAM_BOT_NAME);
      setLoading(false);
      return;
    }

    // Otherwise, try to fetch from backend (which has access to process.env.TELEGRAM_BOT_NAME)
    const fetchConfig = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || '';
        const res = await fetch(`${apiUrl}/api/config`);
        if (res.ok) {
          const data = await res.json();
          if (data.telegramBotName) {
            setTelegramBotName(data.telegramBotName);
          }
        }
      } catch (e) {
        console.error('Failed to fetch config', e);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  return { telegramBotName, loading };
}
