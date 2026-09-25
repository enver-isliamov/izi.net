import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ShieldCheck, Mail, Lock, ArrowRight, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { motion } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useAppConfig } from '@/hooks/useAppConfig';

export default function Login() {
  const { telegramBotName } = useAppConfig();
  const location = useLocation();
  const isRegisterPage = location.pathname === '/register';
  const isForgotPage = location.pathname === '/forgot-password';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isForgotPassword, setIsForgotPassword] = useState(isForgotPage);
  const [isLoading, setIsLoading] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});
  const navigate = useNavigate();
  const { user } = useAuth();

  const validateEmail = (value: string) => {
    if (!value) return 'Введите email';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Некорректный формат email';
    return '';
  };

  const validatePassword = (value: string) => {
    if (!value) return 'Введите пароль';
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

    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      setRefCode(ref);
      sessionStorage.setItem('referral_code', ref);
    } else {
      const savedRef = sessionStorage.getItem('referral_code');
      if (savedRef) setRefCode(savedRef);
    }
  }, [user, navigate]);

  useEffect(() => {
    setIsForgotPassword(location.pathname === '/forgot-password');
  }, [location.pathname]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isForgotPassword) {
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
        setIsForgotPassword(false);
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
      return;
    }

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
        ? 'Пароль слишком короткий'
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
      // 1. Токен создаёт сервер (клиентская вставка блокировалась политиками базы)
      const { data: startRes } = await axios.post('/api/user/auth/telegram/start', {});
      const token = startRes?.token;
      if (!token) throw new Error('Сервер не вернул токен входа');

      // 2. Открываем бота со ссылкой подтверждения
      const link = `https://t.me/${telegramBotName}?start=${token}`;
      toast.success('Переходим в Telegram для подтверждения...', { id: toastId });
      window.open(link, '_blank');

      // 3. Опрашиваем сервер до 2 минут: подтвердил ли пользователь вход в боте
      const startedAt = Date.now();
      const timer = window.setInterval(async () => {
        try {
          if (Date.now() - startedAt > 120000) {
            window.clearInterval(timer);
            toast.error('Вход не подтверждён. Попробуйте снова или войдите по email.', { id: toastId });
            return;
          }
          const { data } = await axios.get(`/api/user/auth/telegram/verify?token=${token}`);
          if (data?.status === 'linked' && data?.tokenHash) {
            window.clearInterval(timer);
            const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: data.tokenHash });
            if (error) throw error;
            toast.success('Вход выполнен!', { id: toastId });
            navigate('/dashboard');
          } else if (data?.status === 'no_user') {
            window.clearInterval(timer);
            toast.error(data.hint || 'Telegram не привязан к аккаунту.', { id: toastId });
          }
        } catch (e) {
          // сетевые сбои не прерывают опрос
        }
      }, 3000);
    } catch (error: any) {
      console.error('Telegram login error:', error);
      toast.error(error.message || 'Ошибка входа через Telegram', { id: toastId });
    } finally {
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
      if (error) throw error;
    } catch (error: any) {
      console.error('Google login error:', error);
      toast.error(error.message || 'Ошибка авторизации через Google');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Radar Effect is already in body via index.css */}
      
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center neon-glow">
              <ShieldCheck className="text-black w-8 h-8" />
            </div>
            <span className="text-3xl font-bold tracking-tight neon-text">izinet</span>
          </div>
        </div>

        <Tabs defaultValue={isRegisterPage ? 'register' : 'login'} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6 bg-muted/50 rounded-xl p-1">
            <TabsTrigger value="login" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-black">Вход</TabsTrigger>
            <TabsTrigger value="register" className="rounded-lg data-[state=active]:bg-primary data-[state=active]:text-black">Регистрация</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <Card className="glass-card border-border/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold">{isForgotPassword ? 'Восстановление пароля' : 'Вход в аккаунт'}</CardTitle>
                <CardDescription>
                  {isForgotPassword 
                    ? 'Введите email, и мы отправим ссылку для сброса пароля' 
                    : 'Выберите быстрый вход в 1 клик или классический по Email'}
                </CardDescription>
              </CardHeader>

              {!isForgotPassword && (
                <div className="px-6 pb-2 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Button 
                      onClick={handleGoogleLogin}
                      disabled={isLoading}
                      type="button" 
                      variant="outline" 
                      className="w-full bg-white/[0.03] hover:bg-white/[0.08] border-white/10 hover:border-white/20 rounded-xl h-12 gap-2.5 text-xs font-semibold relative overflow-hidden group shadow-sm transition-all"
                    >
                      <svg className="w-4 h-4 shrink-0 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                      </svg>
                      <span>Google</span>
                      <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">В 1 клик</span>
                    </Button>

                    <Button 
                      onClick={handleTelegramLogin}
                      disabled={isLoading}
                      type="button" 
                      variant="outline" 
                      className="w-full bg-[#0088cc]/10 hover:bg-[#0088cc]/20 border-[#0088cc]/30 hover:border-[#0088cc]/50 rounded-xl h-12 gap-2.5 text-xs font-semibold text-white relative overflow-hidden group shadow-sm transition-all"
                    >
                      <Send className="w-4 h-4 text-[#0088cc] shrink-0 transition-transform group-hover:scale-110" />
                      <span>Telegram</span>
                      <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#0088cc]/20 text-[#0088cc] border border-[#0088cc]/30">Быстро</span>
                    </Button>
                  </div>

                  <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border/60" />
                    </div>
                    <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-wider">
                      <span className="bg-card px-2.5 text-muted-foreground">или вход по почте</span>
                    </div>
                  </div>
                </div>
              )}

              <form onSubmit={handleLogin}>
                <CardContent className="space-y-4 pt-1">
                  <div className="space-y-2">
                    <div className="relative">
                      <Mail className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Email"
                        type="email"
                        aria-label="Email"
                        className={`pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11 ${errors.email ? 'border-red-500' : ''}`}
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setErrors(prev => ({ ...prev, email: '' })); }}
                      />
                    </div>
                    {errors.email && <p className="text-xs text-red-500">{errors.email}</p>}
                  </div>
                  {!isForgotPassword && (
                    <div className="space-y-2">
                      <div className="relative">
                        <Lock className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                        <Input
                          type="password"
                          placeholder="Пароль"
                          aria-label="Пароль"
                          className={`pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11 ${errors.password ? 'border-red-500' : ''}`}
                          value={password}
                          onChange={(e) => { setPassword(e.target.value); setErrors(prev => ({ ...prev, password: '' })); }}
                        />
                      </div>
                      {errors.password && <p className="text-xs text-red-500">{errors.password}</p>}
                    </div>
                  )}
                  <div className="flex justify-between items-center text-right">
                    {isForgotPassword ? (
                      <Button type="button" variant="link" className="text-xs text-muted-foreground hover:text-primary p-0 h-auto" onClick={() => navigate('/login')}>
                        Вернуться ко входу
                      </Button>
                    ) : (
                      <Button type="button" variant="link" className="text-xs text-primary hover:text-primary/80 p-0 h-auto" onClick={() => navigate('/forgot-password')}>
                        Забыли пароль?
                      </Button>
                    )}
                  </div>
                  <Button type="submit" disabled={isLoading} className="w-full bg-primary text-black hover:bg-primary/90 rounded-xl h-11 font-bold neon-glow">
                    {isLoading ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : null}
                    {isForgotPassword ? 'Сбросить пароль' : 'Войти по Email'} <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </CardContent>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="register">
            <Card className="glass-card border-border/50">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl font-bold">Создать аккаунт</CardTitle>
                <CardDescription>Быстрая регистрация за 10 секунд без подтверждения карты</CardDescription>
                {refCode && (
                  <div className="mt-2 p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                    <p className="text-xs text-primary font-bold flex items-center gap-2">
                       🎁 Бонус 50₽ будет начислен сразу после регистрации!
                    </p>
                  </div>
                )}
              </CardHeader>

              <div className="px-6 pb-2 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Button 
                    onClick={handleGoogleLogin}
                    disabled={isLoading}
                    type="button" 
                    variant="outline" 
                    className="w-full bg-white/[0.03] hover:bg-white/[0.08] border-white/10 hover:border-white/20 rounded-xl h-12 gap-2.5 text-xs font-semibold relative overflow-hidden group shadow-sm transition-all"
                  >
                    <svg className="w-4 h-4 shrink-0 transition-transform group-hover:scale-110" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                    </svg>
                    <span>Google</span>
                    <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">В 1 клик</span>
                  </Button>

                  <Button 
                    onClick={handleTelegramLogin}
                    disabled={isLoading}
                    type="button" 
                    variant="outline" 
                    className="w-full bg-[#0088cc]/10 hover:bg-[#0088cc]/20 border-[#0088cc]/30 hover:border-[#0088cc]/50 rounded-xl h-12 gap-2.5 text-xs font-semibold text-white relative overflow-hidden group shadow-sm transition-all"
                  >
                    <Send className="w-4 h-4 text-[#0088cc] shrink-0 transition-transform group-hover:scale-110" />
                    <span>Telegram</span>
                    <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#0088cc]/20 text-[#0088cc] border border-[#0088cc]/30">Мгновенно</span>
                  </Button>
                </div>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border/60" />
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase font-bold tracking-wider">
                    <span className="bg-card px-2.5 text-muted-foreground">или создать через Email</span>
                  </div>
                </div>
              </div>

              <form onSubmit={handleRegister}>
                <CardContent className="space-y-4 pt-1">
                  <div className="space-y-2">
                    <div className="relative">
                      <Mail className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="Email"
                        aria-label="Email"
                        className={`pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11 ${errors.email ? 'border-red-500' : ''}`}
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); setErrors(prev => ({ ...prev, email: '' })); }}
                      />
                    </div>
                    {errors.email && <p className="text-xs text-red-500">{errors.email}</p>}
                  </div>
                  <div className="space-y-2">
                    <div className="relative">
                      <Lock className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="password"
                        placeholder="Пароль"
                        aria-label="Пароль"
                        className={`pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11 ${errors.password ? 'border-red-500' : ''}`}
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setErrors(prev => ({ ...prev, password: '' })); }}
                      />
                    </div>
                    {errors.password && <p className="text-xs text-red-500">{errors.password}</p>}
                  </div>
                  <div className="space-y-2">
                    <div className="relative">
                      <Lock className="absolute left-3 top-3.5 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="password"
                        placeholder="Подтвердите пароль"
                        aria-label="Подтвердите пароль"
                        className={`pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11 ${errors.confirmPassword ? 'border-red-500' : ''}`}
                        value={confirmPassword}
                        onChange={(e) => { setConfirmPassword(e.target.value); setErrors(prev => ({ ...prev, confirmPassword: '' })); }}
                      />
                    </div>
                    {errors.confirmPassword && <p className="text-xs text-red-500">{errors.confirmPassword}</p>}
                  </div>
                  <Button type="submit" disabled={isLoading} className="w-full bg-primary text-black hover:bg-primary/90 rounded-xl h-11 font-bold neon-glow">
                    {isLoading ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : null}
                    Зарегистрироваться по Email <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </CardContent>
              </form>
            </Card>
          </TabsContent>
        </Tabs>
        
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
