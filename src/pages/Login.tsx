import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Mail, Lock, ArrowRight, Send, Loader2, Sparkles, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { motion } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useNavigate, useLocation, Link } from 'react-router-dom';
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
      const { data: startRes } = await axios.post('/api/user/auth/telegram/start', {});
      const token = startRes?.token;
      const targetBot = startRes?.botName || telegramBotName || 'izinet_bot';
      if (!token) throw new Error('Сервер не вернул токен входа');

      const link = `https://t.me/${targetBot}?start=${token}`;
      toast.success('Переходим в Telegram... Нажмите START в боте для входа', { id: toastId });
      window.open(link, '_blank');

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
    <div className="min-h-screen bg-[#06080c] text-[#f1f4f7] flex flex-col items-center justify-center p-4 relative overflow-hidden selection:bg-[#7bdcff]/30 selection:text-white">
      {/* Background radial atmosphere */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-[radial-gradient(ellipse_at_top,rgba(13,23,34,0.7)_0%,transparent_65%)]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(123,220,255,0.03)_0%,transparent_70%)] blur-[90px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10 my-8"
      >
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-6">
          <Link to="/" className="inline-flex items-center gap-2.5 group mb-2">
            <div className="relative w-8 h-8 rounded-full border border-cyan-400/60 shadow-[0_0_15px_rgba(123,220,255,0.35)] flex items-center justify-center bg-cyan-950/30 group-hover:border-cyan-300 transition-colors">
              <span className="w-2 h-2 rounded-full bg-[#8be5f0] shadow-[0_0_8px_#6ae6ff]" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-white">
              izi<span className="text-[#7bdcff]">net</span>
            </span>
          </Link>
          <Link to="/" className="text-xs text-[#8d959f] hover:text-white transition-colors inline-flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> На главную страницу
          </Link>
        </div>

        {/* Auth Card */}
        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-2 sm:p-4 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] relative overflow-hidden">
          <CardHeader className="pb-4 text-center">
            <CardTitle className="text-2xl font-medium tracking-tight text-white">
              {mode === 'forgot' ? 'Восстановление пароля' : (mode === 'register' ? 'Создать аккаунт' : 'Вход в izinet')}
            </CardTitle>
            <CardDescription className="text-xs text-[#8d959f]">
              {mode === 'forgot'
                ? 'Введите ваш email для получения ссылки на сброс пароля'
                : 'Быстрый вход через Telegram или по Email'}
            </CardDescription>

            {refCode && (
              <div className="mt-2 p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500/20 flex items-center justify-center gap-2 text-xs text-[#7bdcff] font-medium">
                <Sparkles className="w-4 h-4 shrink-0" />
                <span>Бонус 50 ₽ будет зачислен при первой авторизации!</span>
              </div>
            )}
          </CardHeader>

          {/* Быстрые способы входа (Telegram & Google) */}
          {mode !== 'forgot' && (
            <div className="px-6 pb-2 space-y-2.5">
              <Button 
                onClick={handleTelegramLogin}
                disabled={isLoading}
                type="button" 
                className="w-full bg-[#0e1620] hover:bg-[#142232] text-[#7bdcff] border border-cyan-500/25 hover:border-cyan-400/40 hover:shadow-[0_0_20px_rgba(123,220,255,0.2)] font-medium rounded-xl h-11 gap-3 text-sm transition-all"
              >
                <Send className="w-4 h-4 shrink-0" />
                <span>Войти через Telegram</span>
                <span className="ml-auto text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-cyan-500/15 text-[#7bdcff] border border-cyan-500/20">
                  Быстро
                </span>
              </Button>

              <Button 
                onClick={handleGoogleLogin}
                disabled={isLoading}
                type="button" 
                variant="outline"
                className="w-full bg-[#0e141b]/50 border-white/10 hover:bg-[#151c25] hover:border-white/20 text-[#d6dce4] rounded-xl h-11 gap-3 text-sm transition-all"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>Войти через Google</span>
              </Button>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-white/5" />
                </div>
                <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                  <span className="bg-[#0c1016] px-3 text-[#59636f]">или по Email</span>
                </div>
              </div>
            </div>
          )}

          {/* Email форма */}
          <form onSubmit={mode === 'forgot' ? handleForgotPassword : (mode === 'register' ? handleRegister : handleLogin)}>
            <CardContent className="space-y-3.5">
              {/* Email поле */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#8d959f]">Электронная почта</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-3 w-4 h-4 text-[#59636f]" />
                  <Input 
                    type="email" 
                    placeholder="name@example.com" 
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (errors.email) setErrors({ ...errors, email: '' });
                    }}
                    className={`pl-10 h-11 bg-[#080c12] border-white/10 rounded-xl text-white placeholder:text-[#59636f] focus:border-cyan-400 focus:ring-cyan-400/20 text-sm ${errors.email ? 'border-red-500/80' : ''}`}
                    disabled={isLoading}
                  />
                </div>
                {errors.email && <p className="text-xs text-red-400 pl-1">{errors.email}</p>}
              </div>

              {/* Password поле */}
              {mode !== 'forgot' && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[#8d959f]">Пароль</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-3 w-4 h-4 text-[#59636f]" />
                    <Input 
                      type="password" 
                      placeholder="••••••••" 
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errors.password) setErrors({ ...errors, password: '' });
                      }}
                      className={`pl-10 h-11 bg-[#080c12] border-white/10 rounded-xl text-white placeholder:text-[#59636f] focus:border-cyan-400 focus:ring-cyan-400/20 text-sm ${errors.password ? 'border-red-500/80' : ''}`}
                      disabled={isLoading}
                    />
                  </div>
                  {errors.password && <p className="text-xs text-red-400 pl-1">{errors.password}</p>}
                </div>
              )}

              {/* Confirm Password поле */}
              {mode === 'register' && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[#8d959f]">Подтверждение пароля</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-3 w-4 h-4 text-[#59636f]" />
                    <Input 
                      type="password" 
                      placeholder="••••••••" 
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (errors.confirmPassword) setErrors({ ...errors, confirmPassword: '' });
                      }}
                      className={`pl-10 h-11 bg-[#080c12] border-white/10 rounded-xl text-white placeholder:text-[#59636f] focus:border-cyan-400 focus:ring-cyan-400/20 text-sm ${errors.confirmPassword ? 'border-red-500/80' : ''}`}
                      disabled={isLoading}
                    />
                  </div>
                  {errors.confirmPassword && <p className="text-xs text-red-400 pl-1">{errors.confirmPassword}</p>}
                </div>
              )}

              {/* Главная кнопка действия (Oxy glossy white) */}
              <Button 
                type="submit" 
                disabled={isLoading} 
                className="w-full bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold hover:shadow-[0_0_25px_rgba(176,232,255,0.35)] hover:-translate-y-0.5 rounded-xl h-11 text-sm transition-all mt-2"
              >
                {isLoading && <Loader2 className="animate-spin w-4 h-4 mr-2" />}
                {mode === 'forgot'
                  ? 'Сбросить пароль'
                  : (mode === 'register' ? 'Зарегистрироваться' : 'Войти по Email')}
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>

              {/* Переключатели режимов */}
              <div className="pt-2 flex flex-col items-center gap-1.5 text-xs text-[#8d959f] text-center">
                {mode === 'login' && (
                  <>
                    <div>
                      Нет аккаунта?{' '}
                      <button 
                        type="button" 
                        onClick={() => { setMode('register'); setErrors({}); }}
                        className="text-[#7bdcff] hover:underline font-medium"
                      >
                        Зарегистрироваться
                      </button>
                    </div>
                    <div>
                      <button 
                        type="button" 
                        onClick={() => { setMode('forgot'); setErrors({}); }}
                        className="text-[#59636f] hover:text-white transition-colors"
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
                      className="text-[#7bdcff] hover:underline font-medium"
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
                      className="text-[#7bdcff] hover:underline font-medium"
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
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-[#59636f]">
          <Link to="/terms" className="hover:text-white transition-colors">Пользовательское соглашение</Link>
          <span className="text-white/10">•</span>
          <Link to="/refund" className="hover:text-white transition-colors">Политика возвратов</Link>
          <span className="text-white/10">•</span>
          <Link to="/privacy" className="hover:text-white transition-colors">Конфиденциальность</Link>
        </div>
      </motion.div>
    </div>
  );
}
