import { Telegraf, Context } from 'telegraf';
import { supabase } from './supabase';

export class BotService {
  private bot: Telegraf;
  private adminId: string;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    this.bot = new Telegraf(token);
    this.adminId = process.env.TELEGRAM_ADMIN_ID || '';
  }

  public init() {
    this.bot.command('start', (ctx) => this.showMainMenu(ctx));
    
    this.bot.action('action_status', (ctx) => this.handleStatus(ctx));
    this.bot.action('action_help', (ctx) => ctx.reply('❓ Инструкция:\n1. Скачайте приложение Hiddify или V2Ray.\n2. В личном кабинете на сайте скопируйте ссылку подписки.\n3. Вставьте ссылку в приложение.'));
    
    // ... rest of bot logic ...

    this.bot.launch().catch(err => console.error('Bot launch failed:', err));
  }

  private async showMainMenu(ctx: Context) {
    return ctx.reply('👋 Добро пожаловать в izinet!', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Статус подписки', callback_data: 'action_status' }],
          [{ text: '❓ Помощь', callback_data: 'action_help' }],
          [{ text: '🎧 Поддержка', callback_data: 'action_support' }]
        ]
      }
    });
  }

  private async handleStatus(ctx: Context) {
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return;

    try {
      const { data: userData } = await supabase
        .from('users')
        .select('email, balances(amount), subscriptions(*)')
        .eq('telegram_id', chatId)
        .maybeSingle();

      if (!userData) {
        return ctx.reply('⚠️ Аккаунт не привязан.');
      }

      const balance = userData.balances?.[0]?.amount || 0;
      const sub = userData.subscriptions?.[0];
      
      let text = `👤 Аккаунт: ${userData.email}\n💰 Баланс: ${balance} ₽\n\n`;
      if (sub) {
        text += `📅 Истекает: ${new Date(sub.expires_at).toISOString().split('T')[0]} (UTC)\n`;
        text += `📊 Трафик: ${(sub.traffic_used_mb / 1024).toFixed(2)} ГБ`;
      } else {
        text += `❌ Нет активной подписки.`;
      }
      ctx.reply(text);
    } catch (e) {
      ctx.reply('❌ Ошибка.');
    }
  }

  public stop(signal: string) {
    this.bot.stop(signal);
  }
}

export const botService = new BotService();
