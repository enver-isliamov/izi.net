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
    this.bot.start((ctx) => this.handleStart(ctx));

    this.bot.action('action_status', (ctx) => this.handleStatus(ctx));
    this.bot.action('action_help', (ctx) => ctx.reply('❓ Инструкция:\n1. Скачайте приложение Hiddify или V2Ray.\n2. В личном кабинете на сайте скопируйте ссылку подписки.\n3. Вставьте ссылку в приложение.'));

    this.bot.launch().catch(err => console.error('Bot launch failed:', err));
  }

  private async handleStart(ctx: Context) {
    const payload = (ctx.message as any)?.text?.split(' ')?.[1] || '';
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return this.showMainMenu(ctx);

    if (payload.startsWith('link_')) {
      const token = payload.replace('link_', '');
      try {
        const { data, error } = await supabase
          .from('telegram_linking_tokens')
          .select('user_id')
          .eq('token', token)
          .maybeSingle();

        if (error || !data) {
          return ctx.reply('❌ Ссылка для привязки недействительна или уже использована.');
        }

        const { error: updateErr } = await supabase
          .from('users')
          .update({ telegram_id: chatId, telegram_linked: true })
          .eq('id', data.user_id);

        if (updateErr) {
          console.error('Telegram link update error:', updateErr);
          return ctx.reply('❌ Ошибка привязки. Попробуйте позже.');
        }

        await supabase.from('telegram_linking_tokens').delete().eq('token', token);

        return ctx.reply('✅ Аккаунт успешно привязан! Теперь вы можете использовать бота для управления VPN.');
      } catch (e) {
        return ctx.reply('❌ Ошибка привязки. Попробуйте позже.');
      }
    }

    if (payload.startsWith('auth_')) {
      const token = payload.replace('auth_', '');
      try {
        const { data, error } = await supabase
          .from('telegram_linking_tokens')
          .select('user_id')
          .eq('token', `auth_${token}`)
          .maybeSingle();

        if (error || !data) {
          return ctx.reply('❌ Ссылка для входа недействительна или уже использована.');
        }

        await supabase
          .from('telegram_linking_tokens')
          .update({ user_id: chatId })
          .eq('token', `auth_${token}`);

        await supabase
          .from('users')
          .update({ telegram_id: chatId })
          .eq('telegram_id', chatId);

        return ctx.reply('✅ Вход выполнен! Вернитесь на сайт.');
      } catch (e) {
        return ctx.reply('❌ Ошибка входа. Попробуйте позже.');
      }
    }

    return this.showMainMenu(ctx);
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
