import { Telegraf, Context } from 'telegraf';
import { supabase } from './supabase';

export class BotService {
  private bot: Telegraf | null = null;
  private adminId: string = '';
  private static botUsername: string = '';

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN || '';
    if (!token) {
      console.log('ℹ️ [BotService] TELEGRAM_BOT_TOKEN is not set - bot disabled');
      return;
    }
    this.bot = new Telegraf(token);
    this.adminId = process.env.TELEGRAM_ADMIN_ID || '';
  }

  public static getBotUsername(): string {
    return this.botUsername || process.env.TELEGRAM_BOT_NAME || process.env.VITE_TELEGRAM_BOT_NAME || 'izinet_bot';
  }

  public init() {
    if (!process.env.TELEGRAM_BOT_TOKEN || !this.bot) {
      return;
    }

    this.bot.telegram.getMe()
      .then(me => {
        if (me?.username) {
          BotService.botUsername = me.username;
          console.log(`🤖 [BotService] Telegram bot active: @${me.username}`);
        }
      })
      .catch(e => console.warn('[BotService] getMe failed:', e.message));

    this.bot.start((ctx) => this.handleStart(ctx));

    this.bot.action('action_status', (ctx) => this.handleStatus(ctx));
    this.bot.action('action_help', (ctx) => ctx.reply('❓ Инструкция:\n1. Скачайте приложение Hiddify, V2Box или AmneziaVPN.\n2. В личном кабинете на сайте скопируйте ссылку подписки или скачайте .conf файл.\n3. Вставьте ссылку в приложение или импортируйте файл в роутер.'));
    this.bot.action('action_support', (ctx) => ctx.reply('🎧 Поддержка izinet:\nЕсли у вас возникли вопросы или сложности с подключением, напишите в тикеты в личном кабинете на сайте.'));

    this.bot.launch().catch(err => console.error('Bot launch failed:', err));
  }

  private async handleStart(ctx: Context) {
    const payload = (ctx.message as any)?.text?.split(' ')?.[1]?.trim() || '';
    const chatId = ctx.chat?.id?.toString();
    if (!chatId) return this.showMainMenu(ctx);

    // 1. Привязка Telegram к существующему аккаунту (из Профиля)
    if (payload.startsWith('link_')) {
      const token = payload.replace('link_', '').trim();
      try {
        const { data, error } = await supabase
          .from('telegram_linking_tokens')
          .select('user_id')
          .eq('token', token)
          .maybeSingle();

        if (error || !data || !data.user_id) {
          return ctx.reply('❌ Ссылка для привязки недействительна или срок её действия истёк. Создайте новую ссылку в Профиле.');
        }

        const username = (ctx.from as any)?.username || null;
        const firstName = (ctx.from as any)?.first_name || '';

        const { error: updateErr } = await supabase
          .from('users')
          .update({ 
            telegram_id: chatId, 
            telegram_linked: true,
            ...(username ? { telegram_username: username } : {})
          })
          .eq('id', data.user_id);

        if (updateErr) {
          console.error('Telegram link update error:', updateErr);
          return ctx.reply('❌ Ошибка привязки Telegram к профилю. Попробуйте позже.');
        }

        await supabase.from('telegram_linking_tokens').delete().eq('token', token);

        return ctx.reply(`✅ Telegram успешно привязан к вашему аккаунту izinet, ${firstName}!\n\nТеперь вы можете получать уведомления о подписке и входить на сайт в 1 клик через Telegram.`);
      } catch (e: any) {
        console.error('Telegram link error:', e);
        return ctx.reply('❌ Ошибка привязки. Попробуйте позже.');
      }
    }

    // 2. Быстрый вход / регистрация через Telegram (со страницы Входа)
    if (payload.startsWith('auth_') || payload.length >= 8) {
      try {
        // Ищем токен с префиксом или без
        const cleanPayload = payload.trim();
        const { data: row, error } = await supabase
          .from('telegram_linking_tokens')
          .select('token, user_id')
          .or(`token.eq.${cleanPayload},token.eq.auth_${cleanPayload}`)
          .maybeSingle();

        if (error || !row) {
          return ctx.reply('❌ Ссылка для входа недействительна или устарела. Нажмите «Войти через Telegram» на сайте заново.');
        }

        // Обновляем токен с chat_id пользователя
        await supabase
          .from('telegram_linking_tokens')
          .update({ user_id: chatId })
          .eq('token', row.token);

        // Проверяем, есть ли пользователь
        const { data: existingUser } = await supabase
          .from('users')
          .select('id, email')
          .eq('telegram_id', chatId)
          .maybeSingle();

        const firstName = (ctx.from as any)?.first_name || 'пользователь';
        if (existingUser?.email) {
          return ctx.reply(`✅ С возвращением, ${firstName}! Вход в izinet подтверждён.\n\nВернитесь на вкладку браузера — вы будете автоматически авторизованы.`);
        } else {
          return ctx.reply(`✅ Вход подтверждён! Добро пожаловать в izinet, ${firstName}.\n\nВернитесь на сайт — ваш личный кабинет уже готов.`);
        }
      } catch (e: any) {
        console.error('Telegram auth error:', e);
        return ctx.reply('❌ Ошибка входа через Telegram. Попробуйте позже.');
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
    if (this.bot) {
      this.bot.stop(signal);
    }
  }
}

export const botService = new BotService();
