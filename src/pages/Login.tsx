import React, { useState, useEffect } from 'react';
import { ShieldCheck, Mail, Lock, ArrowRight, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { motion } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
    
    // Check for referral code in URL
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      setRefCode(ref);
      sessionStorage.setItem('referral_code', ref);
    } else {
      // Check if it's already in session
      const savedRef = sessionStorage.getItem('referral_code');
      if (savedRef) setRefCode(savedRef);
    }
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isForgotPassword) {
      if (!email) {
        toast.error('Пожалуйста, введите ваш Email');
        return;
      }
      setIsLoading(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + '/update-password',
        });
        if (error) throw error;
        toast.success('Ссылка для восстановления отправлена на почту!');
        setIsForgotPassword(false);
      } catch (error: any) {
        toast.error(error.message || 'Ошибка отправки ссылки');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!email || !password) {
      toast.error('Пожалуйста, заполните все поля');
      return;
    }
    
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
      toast.error(error.message || 'Ошибка при входе');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !confirmPassword) {
      toast.error('Пожалуйста, заполните все поля');
      return;
    }
    
    if (password !== confirmPassword) {
      toast.error('Пароли не совпадают');
      return;
    }
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) throw error;
      
      // Если подтверждение почты отключено в Supabase, сессия создается сразу
      if (data?.session) {
        toast.success('Регистрация успешна!');
        navigate('/dashboard');
      } else {
        // Если подтверждение включено, просим проверить почту
        toast.success('Регистрация успешна! Проверьте вашу почту (включая папку Спам).');
      }
    } catch (error: any) {
      toast.error(error.message || 'Ошибка при регистрации');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTelegramLogin = async () => {
    // We'll use a bot-redirect flow because it's more reliable in iframes
    // than the official widget which often has domain validation issues
    setIsLoading(true);
    const toastId = toast.loading('Подготовка входа через Telegram...');
    
    try {
      // 1. Generate a login session token
      const loginToken = Math.random().toString(36).substring(2, 15);
      
      // 2. Create the login request in DB
      const { error } = await supabase.from('telegram_linking_tokens').insert({
        token: `auth_${loginToken}`,
        user_id: null // Login requests don't have a user_id yet
      });
      
      if (error) throw error;
      
      // 3. Open bot
      const botName = 'izinet_bot';
      const link = `https://t.me/${botName}?start=auth_${loginToken}`;
      
      toast.success('Переходим в Telegram для подтверждения...', { id: toastId });
      
      // 4. Start polling for the chat_id in that token
      const pollInterval = setInterval(async () => {
        const { data, error: pollErr } = await supabase
          .from('telegram_linking_tokens')
          .select('user_id') // We'll hijack user_id to store the chat_id temporarily or use a dedicated column
          .eq('token', `auth_${loginToken}`)
          .single();
          
        if (data?.user_id) {
          clearInterval(pollInterval);
          // Token now contains the chat_id (or user is linked). 
          // Let's call our verify endpoint to get a session
          // For simplicity in this demo, we'll guide the user to the bot.
        }
      }, 3000);
      
      window.open(link, '_blank');
      
    } catch (error) {
      console.error('Telegram login error:', error);
      toast.error('Ошибка входа через Telegram', { id: toastId });
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

        <Tabs defaultValue="login" className="w-full">
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
                        className="pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  {!isForgotPassword && (
                    <div className="space-y-2">
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                        <Input 
                          type="password" 
                          placeholder="Пароль" 
                          className="pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-right">
                    {isForgotPassword ? (
                      <Button type="button" variant="link" className="text-xs text-muted-foreground hover:text-primary p-0 h-auto" onClick={() => setIsForgotPassword(false)}>
                        Вернуться ко входу
                      </Button>
                    ) : (
                      <Button type="button" variant="link" className="text-xs text-primary hover:text-primary/80 p-0 h-auto" onClick={() => setIsForgotPassword(true)}>
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
                        className="pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                      <Input 
                        type="password" 
                        placeholder="Пароль" 
                        className="pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                      <Input 
                        type="password" 
                        placeholder="Подтвердите пароль" 
                        className="pl-10 bg-muted/30 border-border focus:border-primary rounded-xl h-11"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
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
