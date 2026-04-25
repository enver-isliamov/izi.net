import React, { useState, useEffect } from 'react';
import { Lock, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { motion } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

export default function UpdatePassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Check if we have an active session or a recovery token in the URL hash
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        // If there's no session, check hash (Supabase automatically handles hash locally if on same domain, but let's be safe)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        if (!hashParams.has('access_token')) {
            toast.error('Недействительная или устаревшая ссылка для восстановления пароля.');
            navigate('/login');
        }
      }
    });

    // Listener for auth events (specifically password recovery)
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Ready to update
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [navigate]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || !confirmPassword) {
      toast.error('Пожалуйста, заполните все поля');
      return;
    }
    
    if (password !== confirmPassword) {
      toast.error('Пароли не совпадают');
      return;
    }
    
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) throw error;
      
      toast.success('Пароль успешно обновлен!');
      navigate('/dashboard');
    } catch (error: any) {
      toast.error(error.message || 'Ошибка при обновлении пароля');
    } finally {
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
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-primary rounded-2xl flex items-center justify-center neon-glow">
              <ShieldCheck className="text-black w-8 h-8" />
            </div>
            <span className="text-3xl font-bold tracking-tight neon-text">izinet</span>
          </div>
        </div>

        <Card className="glass-card border-border/50">
          <CardHeader>
            <CardTitle>Создайте новый пароль</CardTitle>
            <CardDescription>Введите новый надежный пароль для вашего аккаунта</CardDescription>
          </CardHeader>
          <form onSubmit={handleUpdate}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="relative">
                  <Lock className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                  <Input 
                    type="password" 
                    placeholder="Новый пароль" 
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
                Сохранить пароль <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </CardContent>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
