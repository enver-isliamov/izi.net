import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ShieldCheck, Mail, Lock, ArrowRight, Send, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { motion } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useAppConfig } from '@/hooks/useAppConfig';

export default function Login() {
  const { telegramBotName } = useAppConfig();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Режим email формы: 'login' | 'register' | 'forgot'
  const initialMode = location.pathname === '/register'
    ? 'register'
    : (location.pathname === '/forgot-password' ? 'forgot' : 'login');
  
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});

  const validateEmail = (value: string) => {
    if (!value) return 'Введите email';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Некорректный формат email';
    return '';
  };

  const validatePassword = (value: string) => {
    if (!value) return 'Введите пароль';
    if (value.length < 6) return 'Пароль должен быть не менее 6 символов';
    return '';
  };

  const validateConfirmPassword = (value: string) => {
    if (!value) return 'Подтвердите пароль';
    if (value !== password) return 'Пароли не совпадают';
    return '';
  };

  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }

    // Обработка ошибок OAuth от Supabase
    const hash = window.location.hash;
    if (hash && (hash.includes('error=validation_failed') || hash.includes('Unsupported+provider') || hash.includes('provider_not_enabled'))) {
      toast.error('Авторизация через Google временно недоступна в Supabase. Воспользуйтесь Telegram или Email.', { duration: 7000 });
      window.history.replaceState(null, '', window.location.pathname);
    }

    // Сохраняем реферальный код
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      setRefCode(ref);
      sessionStorage.setItem('referral_code', ref);
      localStorage.setItem('izinet_referral_code', ref);
    } else {
      const savedRef = sessionStorage.getItem('referral_code') || localStorage.getItem('izinet_referral_code');
      if (savedRef) setRefCode(savedRef);
    }
  }, [user, navigate]);

  useEffect(() => {
    if (location.pathname === '/register') setMode('register');
    else if (location.pathname === '/forgot-password') setMode('forgot');
    else if (location.pathname === '/login') setMode('login');
  }, [location.pathname]);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailErr = validateEmail(email);
    setErrors({ email: emailErr });
    if (emailErr) return;

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/update-password',
      });
      if (error) throw error;
      toast.success('Ссылка для восстановления отправлена на почту!');
      setMode('login');
    } catch (error: any) {
      const msg = error.message?.includes('For security purposes')
        ? 'Проверьте почту — письмо уже отправлено'
        : error.message?.includes('Invalid email')
        ? 'Некорректный email'
        : 'Не удалось отправить ссылку. Попробуйте позже';
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailErr = validateEmail(email);
    const passErr = validatePassword(password);
    setErrors({ email: emailErr, password: passErr });
    if (emailErr || passErr) return;

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      toast.success('Успешный вход!');
      navigate('/dashboard');
    } catch (error: any) {
      const msg = error.message?.includes('Invalid login credentials')
        ? 'Неверный email или пароль'
        : error.message?.includes('Email not confirmed')
        ? 'Подтвердите email перед входом. Проверьте почту.'
        : 'Ошибка входа. Проверьте данные и попробуйте снова';
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailErr = validateEmail(email);
    const passErr = validatePassword(password);
    const confirmErr = validateConfirmPassword(confirmPassword);
    setErrors({ email: emailErr, password: passErr, confirmPassword: confirmErr });
    if (emailErr || passErr || confirmErr) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) throw error;

      // Помечаем нового пользователя для первого показа WelcomeWizard
      sessionStorage.setItem('izinet_just_registered', 'true');

      if (data?.session) {
        toast.success('Регистрация успешна!');
        navigate('/dashboard');
      } else {
        toast.success('Регистрация успешна! Проверьте вашу почту (включая папку Спам).');
      }
    } catch (error: any) {
      const msg = error.message?.includes('already registered')
        ? 'Аккаунт с таким email уже существует'
        : error.message?.includes('valid email')
        ? 'Введите корректный email'
        : error.message?.includes('at least')
        ? 'Пароль слишком короткий (минимум 6 символов)'
        : 'Ошибка регистрации. Попробуйте другой email или пароль';
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTelegramLogin = async () => {
    setIsLoading(true);
    const toastId = toast.loading('Подготовка входа через Telegram...');
    try {
      // 1. Токен создаёт сервер под service-role
      const { data: startRes } = await axios.post('/api/user/auth/telegram/start', {});
      const token = startRes?.token;
      const targetBot = startRes?.botName || telegramBotName || 'izinet_bot';
      if (!token) throw new Error('Сервер не вернул токен входа');

      // 2. Открываем бота со ссылкой подтверждения
      const link = `https://t.me/${targetBot}?start=${token}`;
      toast.success('Переходим в Telegram... Нажмите START в боте для входа', { id: toastId });
      window.open(link, '_blank');

      // 3. Опрашиваем сервер: подтвердил ли пользователь вход в боте
      const startedAt = Date.now();
      let verifiedSuccessfully = false;

      const timer = window.setInterval(async () => {
        if (verifiedSuccessfully) {
          window.clearInterval(timer);
          return;
        }

        if (Date.now() - startedAt > 120000) {
          window.clearInterval(timer);
          toast.error('Время ожидания истекло. Нажмите «Войти через Telegram» заново или используйте Email.', { id: toastId });
          setIsLoading(false);
          return;
        }

        try {
          const { data } = await axios.get(`/api/user/auth/telegram/verify?token=${token}`);
          
          if (data?.status === 'linked' && (data?.tokenHash || data?.actionLink)) {
            verifiedSuccessfully = true;
            window.clearInterval(timer);

            let sessionEstablished = false;

            if (data.tokenHash) {
              try {
                const { data: authData, error: otpErr } = await supabase.auth.verifyOtp({ 
                  type: 'magiclink', 
                  token_hash: data.tokenHash 
                });
                if (!otpErr && authData?.session) {
                  sessionEstablished = true;
                }
              } catch (_) {}

              if (!sessionEstablished) {
                try {
                  const { data: authData2, error: otpErr2 } = await supabase.auth.verifyOtp({ 
                    type: 'email', 
                    token_hash: data.tokenHash 
                  });
                  if (!otpErr2 && authData2?.session) {
                    sessionEstablished = true;
                  }
                } catch (_) {}
              }
            }

            if (!sessionEstablished && data.actionLink) {
              window.location.href = data.actionLink;
              return;
            }

            toast.success('🎉 Вход через Telegram выполнен!', { id: toastId });
            setIsLoading(false);
            navigate('/dashboard');
          } else if (data?.status === 'no_user') {
            window.clearInterval(timer);
            setIsLoading(false);
            toast.error(data.hint || 'Не удалось завершить вход через Telegram.', { id: toastId });
          }
        } catch (_) {}
      }, 2000);
    } catch (error: any) {
      console.error('Telegram login error:', error);
      toast.error(error.message || 'Ошибка входа через Telegram', { id: toastId });
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`
        }
      });
      if (error) {
        if (error.message?.includes('provider is not enabled') || error.message?.includes('validation_failed') || (error as any)?.code === 400) {
          toast.error('Вход через Google временно не настроен в Supabase. Воспользуйтесь Telegram или Email.', { duration: 7000 });
        } else {
          toast.error(error.message || 'Ошибка авторизации через Google');
        }
        setIsLoading(false);
      }
    } catch (error: any) {
      console.error('Google login error:', error);
      toast.error('Вход через Google временно недоступен. Воспользуйтесь Telegram или Email.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Brand Header */}
        <div className="flex justify-center mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center neon-glow">
              <ShieldCheck className="text-black w-8 h-8" />
            </div>
            <span className="text-3xl font-bold tracking-tight neon-text">izinet</span>
          </div>
        </div>

        <Card className="glass-card border-border/50 shadow-2xl relative overflow-hidden">
          <CardHeader className="pb-4 text-center">
            <CardTitle className="text-2xl font-black tracking-tight text-white">
              {mode === 'forgot' ? 'Восстановление пароля' : (mode === 'register' ? 'Создать аккаунт' : 'Вход в izinet')}
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              {mode === 'forgot'
                ? 'Введите ваш email для получения ссылки на сброс пароля'
                : 'Быстрый вход в 1 клик через Telegram или классический по Email'}
            </CardDescription>

            {refCode && (
              <div className="mt-2 p-2.5 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center gap-2 text-xs text-primary font-bold">
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>Бонус 50₽ будет зачислен при первой авторизации!</span>
              </div>
            )}
          </CardHeader>

          {/* ОСНОВНЫЕ СПОСОБЫ ВХОДА (TELEGRAM & GOOGLE) */}
          {mode !== 'forgot' && (
            <div className="px-6 pb-2 space-y-2.5">
              {/* Кнопка 1: Telegram (Основной и рекомендуемый способ) */}
              <Button 
                onClick={handleTelegramLogin}
                disabled={isLoading}
                type="button" 
                className="w-full bg-[#0088cc] hover:bg-[#0088cc]/90 text-white font-bold rounded-xl h-12 gap-3 text-sm shadow-lg shadow-[#0088cc]/20 transition-all hover:scale-[1.01] active:scale-[0.99] border border-white/10"
              >
                <Send className="w-4 h-4 shrink-0" />
                <span>Войти через Telegram</span>
                <span className="ml-auto text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-white/20 text-white font-black tracking-wider">
                  Быстро
                </span>
              </Button>

              {/* Кнопка 2: Google */}
              <Button 
                onClick={handleGoogleLogin}
                disabled={isLoading}
                type="button" 
                variant="outline" 
                className="w-full bg-white/[0.04] hover:bg-white/[0.08] border-white/10 hover:border-white/20 text-white font-semibold rounded-xl h-12 gap-3 text-xs shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>Продолжить с Google</span>
                <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-muted-foreground">
                  1 клик
                </span>
              </Button>

              {/* Разделитель */}
              <div className="relative py-2.5">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/50" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-wider">
                  <span className="bg-card px-3 text-muted-foreground">или по электронной почте</span>
                </div>
              </div>
            </div>
          )}

          {/* ФОРМА ПОЧТЫ (КОМПАКТНАЯ, БЕЗ ВКЛАДОК) */}
          <form onSubmit={mode === 'forgot' ? handleForgotPassword : (mode === 'register' ? handleRegister : handleLogin)}>
            <CardContent className="space-y-3.5 pt-1">
              <div className="space-y-1">
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Ваш Email"
                    type="email"
                    aria-label="Email"
                    className={`pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11 text-sm ${errors.email ? 'border-red-500' : ''}`}
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setErrors(prev => ({ ...prev, email: '' })); }}
                  />
                </div>
                {errors.email && <p className="text-xs text-red-500 pl-1">{errors.email}</p>}
              </div>

              {mode !== 'forgot' && (
                <div className="space-y-1">
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="password"
                      placeholder="Пароль"
                      aria-label="Пароль"
                      className={`pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11 text-sm ${errors.password ? 'border-red-500' : ''}`}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setErrors(prev => ({ ...prev, password: '' })); }}
                    />
                  </div>
                  {errors.password && <p className="text-xs text-red-500 pl-1">{errors.password}</p>}
                </div>
              )}

              {mode === 'register' && (
                <div className="space-y-1 animate-in fade-in duration-200">
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-3.5 w-4 h-4 text-muted-foreground" />
                    <Input
                      type="password"
                      placeholder="Повторите пароль"
                      aria-label="Повторите пароль"
                      className={`pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11 text-sm ${errors.confirmPassword ? 'border-red-500' : ''}`}
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setErrors(prev => ({ ...prev, confirmPassword: '' })); }}
                    />
                  </div>
                  {errors.confirmPassword && <p className="text-xs text-red-500 pl-1">{errors.confirmPassword}</p>}
                </div>
              )}

              {/* Главная кнопка действия */}
              <Button 
                type="submit" 
                disabled={isLoading} 
                className="w-full bg-primary text-black hover:bg-primary/90 rounded-xl h-11 font-bold text-sm neon-glow mt-1"
              >
                {isLoading && <Loader2 className="animate-spin w-4 h-4 mr-2" />}
                {mode === 'forgot'
                  ? 'Сбросить пароль'
                  : (mode === 'register' ? 'Зарегистрироваться' : 'Войти по Email')}
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>

              {/* Плавные переключатели режимов (вместо громоздких вкладок) */}
              <div className="pt-2 flex flex-col items-center gap-1.5 text-xs text-muted-foreground text-center">
                {mode === 'login' && (
                  <>
                    <div>
                      Нет аккаунта?{' '}
                      <button 
                        type="button" 
                        onClick={() => { setMode('register'); setErrors({}); }}
                        className="text-primary hover:underline font-semibold"
                      >
                        Зарегистрироваться
                      </button>
                    </div>
                    <div>
                      <button 
                        type="button" 
                        onClick={() => { setMode('forgot'); setErrors({}); }}
                        className="text-muted-foreground hover:text-white transition-colors"
                      >
                        Забыли пароль?
                      </button>
                    </div>
                  </>
                )}

                {mode === 'register' && (
                  <div>
                    Уже есть аккаунт?{' '}
                    <button 
                      type="button" 
                      onClick={() => { setMode('login'); setErrors({}); }}
                      className="text-primary hover:underline font-semibold"
                    >
                      Войти
                    </button>
                  </div>
                )}

                {mode === 'forgot' && (
                  <div>
                    <button 
                      type="button" 
                      onClick={() => { setMode('login'); setErrors({}); }}
                      className="text-primary hover:underline font-semibold"
                    >
                      Вернуться ко входу
                    </button>
                  </div>
                )}
              </div>
            </CardContent>
          </form>
        </Card>
        
        {/* Footer links */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4 text-xs text-muted-foreground">
          <a href="/terms" className="hover:text-primary transition-colors">Пользовательское соглашение</a>
          <span className="hidden sm:inline text-border">•</span>
          <a href="/refund" className="hover:text-primary transition-colors">Политика возвратов</a>
          <span className="hidden sm:inline text-border">•</span>
          <a href="/privacy" className="hover:text-primary transition-colors">Политика конфиденциальности</a>
        </div>
      </motion.div>
    </div>
  );
}
