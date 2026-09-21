import axios from 'axios';
import { supabase } from './supabase';

/**
 * Уведомления пользователям в Telegram (реальная отправка).
 * Повторяет цикл раз в час, отправляет один раз на событие:
 *  - подписка истекает (<= 3 дней)
 *  - подписка истекла
 * Учитывает персональные настройки: notification_settings.subscription_expiring / subscription_expired.
 */
const STATE_KEY = 'NOTIFICATIONS_STATE';
const EXPIRING_DAYS = 3;
const SITE_URL = process.env.PUBLIC_URL || 'https://izinet.online';

type NotifyState = { sent: Record<string, string>; lastRunAt?: string };

export class NotificationService {
  private static interval: NodeJS.Timeout | null = null;

  static init() {
    if (this.interval) return;
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.log('[Notifications] TELEGRAM_BOT_TOKEN не задан — уведомления в Telegram отключены');
      return;
    }
    console.log('[Notifications] Сервис уведомлений запущен (проверка раз в час)');
    this.interval = setInterval(() => void this.runCycle(), 60 * 60 * 1000);
    setTimeout(() => void this.runCycle(), 45 * 1000);
  }

  private static async readState(): Promise<NotifyState> {
    try {
      const { data } = await supabase.from('settings').select('value').eq('key', STATE_KEY).maybeSingle();
      if (data?.value) return JSON.parse(data.value);
    } catch (e: any) {
      console.warn(`[Notifications] state read failed: ${e.message}`);
    }
    return { sent: {} };
  }

  private static async saveState(state: NotifyState) {
    try {
      await supabase.from('settings').upsert(
        { key: STATE_KEY, value: JSON.stringify(state), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    } catch (e: any) {
      console.warn(`[Notifications] state save failed: ${e.message}`);
    }
  }

  /** Отправить сообщение в Telegram (Bot API, без внешних зависимостей). */
  static async sendTelegram(chatId: string | number, text: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return false;
    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await axios.post(url, { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }, { timeout: 15000 });
      return Boolean(res.data?.ok);
    } catch (e: any) {
      console.warn(`[Notifications] telegram send failed for ${chatId}: ${e.message}`);
      return false;
    }
  }

  static async runCycle() {
    try {
      const { data: subs } = await supabase
        .from('subscriptions')
        .select('id, user_id, expires_at, status')
        .in('status', ['active', 'limited'])
        .not('expires_at', 'is', null)
        .limit(500);
      if (!subs || subs.length === 0) return;

      const now = Date.now();
      const state = await this.readState();
      let sentCount = 0;

      // Настройки уведомлений одним запросом
      const userIds = Array.from(new Set(subs.map((s: any) => s.user_id)));
      const { data: settingsRows } = await supabase
        .from('notification_settings')
        .select('user_id, subscription_expiring, subscription_expired')
        .in('user_id', userIds);
      const settingsMap = new Map<string, any>((settingsRows || []).map((r: any) => [r.user_id, r]));

      const { data: users } = await supabase
        .from('users')
        .select('id, email, telegram_id')
        .in('id', userIds);
      const userMap = new Map<string, any>((users || []).map((u: any) => [u.id, u]));

      for (const sub of subs as any[]) {
        const user = userMap.get(sub.user_id);
        const chatId = user?.telegram_id;
        if (!chatId) continue;

        const expiry = new Date(sub.expires_at).getTime();
        const daysLeft = Math.ceil((expiry - now) / 86400000);
        const isExpired = expiry < now;
        const isExpiring = !isExpired && daysLeft <= EXPIRING_DAYS;
        if (!isExpired && !isExpiring) continue;

        const kind = isExpired ? 'expired' : 'expiring';
        const key = `${sub.id}:${kind}`;
        const prev = state.sent[key] ? new Date(state.sent[key]).getTime() : 0;
        const cooldownMs = isExpired ? 3 * 86400000 : 20 * 3600000;
        if (prev && now - prev < cooldownMs) continue;

        const prefs = settingsMap.get(sub.user_id);
        if (kind === 'expiring' && prefs && prefs.subscription_expiring === false) continue;
        if (kind === 'expired' && prefs && prefs.subscription_expired === false) continue;

        const dateStr = new Date(sub.expires_at).toLocaleDateString('ru-RU');
        const text = isExpired
          ? `⚠️ <b>Подписка izinet истекла</b> (${dateStr}).\nПродлите в личном кабинете: ${SITE_URL}/subscription`
          : `⏰ <b>Подписка izinet истекает</b> через ${daysLeft} дн. (${dateStr}).\nПродлить: ${SITE_URL}/subscription`;

        const ok = await this.sendTelegram(chatId, text);
        if (ok) {
          state.sent[key] = new Date().toISOString();
          sentCount++;
        }
      }

      state.lastRunAt = new Date().toISOString();
      await this.saveState(state);
      if (sentCount > 0) console.log(`[Notifications] отправлено уведомлений: ${sentCount}`);
    } catch (e: any) {
      console.error(`[Notifications] cycle failed: ${e.message}`);
    }
  }
}
