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
              <CardHeader>
                <CardTitle>{isForgotPassword ? 'Восстановление пароля' : 'С возвращением'}</CardTitle>
                <CardDescription>
                  {isForgotPassword 
                    ? 'Введите email, и мы отправим ссылку для сброса пароля' 
                    : 'Войдите в свой аккаунт для управления VPN'}
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleLogin}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
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
                        <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
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
                  <Button type="submit" disabled={isLoading} className="w-full bg-primary text-black hover:bg-primary/90 rounded-xl h-11 neon-glow">
                    {isLoading ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : null}
                    {isForgotPassword ? 'Сбросить пароль' : 'Войти'} <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </CardContent>
              </form>
              {!isForgotPassword && (
                <CardFooter className="flex flex-col space-y-4">
                  <div className="relative w-full">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">Или через мессенджер</span>
                    </div>
                  </div>
                  <Button 
                    onClick={handleTelegramLogin}
                    type="button" 
                    variant="outline" 
                    className="w-full border-border hover:bg-muted rounded-xl h-11 gap-2"
                  >
                    <Send className="w-4 h-4 text-[#0088cc]" /> Войти через Telegram
                  </Button>
                </CardFooter>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="register">
            <Card className="glass-card border-border/50">
              <CardHeader>
                <CardTitle>Создать аккаунт</CardTitle>
                <CardDescription>Начните пользоваться безопасным VPN уже сегодня</CardDescription>
                {refCode && (
                  <div className="mt-2 p-3 rounded-xl bg-primary/10 border border-primary/20 animate-pulse">
                    <p className="text-xs text-primary font-bold flex items-center gap-2">
                       🎁 Вы получите бонус 50₽ после регистрации!
                    </p>
                  </div>
                )}
              </CardHeader>
              <form onSubmit={handleRegister}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
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
                      <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
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
                      <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
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
                  <Button type="submit" disabled={isLoading} className="w-full bg-primary text-black hover:bg-primary/90 rounded-xl h-11 neon-glow">
                    {isLoading ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : null}
                    Зарегистрироваться <ArrowRight className="ml-2 w-4 h-4" />
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
