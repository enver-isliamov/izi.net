import React, { useState, useEffect } from 'react';
import { Lock, ArrowRight, Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { motion } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useNavigate, Link } from 'react-router-dom';

export default function UpdatePassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        if (!hashParams.has('access_token')) {
            toast.error('Недействительная или устаревшая ссылка для восстановления пароля.');
            navigate('/login');
        }
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Ready
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
    <div className="min-h-screen bg-[#06080c] text-[#f1f4f7] flex flex-col items-center justify-center p-4 relative overflow-hidden selection:bg-[#7bdcff]/30 selection:text-white">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-[radial-gradient(ellipse_at_top,rgba(13,23,34,0.6)_0%,transparent_65%)]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="flex flex-col items-center mb-6">
          <Link to="/" className="inline-flex items-center gap-2.5 group mb-2">
            <div className="relative w-8 h-8 rounded-full border border-cyan-400/60 shadow-[0_0_12px_rgba(123,220,255,0.35)] flex items-center justify-center bg-cyan-950/30 group-hover:border-cyan-300 transition-colors">
              <span className="w-2 h-2 rounded-full bg-[#8be5f0] shadow-[0_0_8px_#6ae6ff]" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-white">
              izi<span className="text-[#7bdcff]">net</span>
            </span>
          </Link>
          <Link to="/login" className="text-xs text-[#8d959f] hover:text-white transition-colors inline-flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Вернуться ко входу
          </Link>
        </div>

        <Card className="rounded-3xl border border-white/10 bg-[#0c1016]/90 p-4 sm:p-6 backdrop-blur-xl shadow-2xl">
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-2xl font-medium tracking-tight text-white">Новый пароль</CardTitle>
            <CardDescription className="text-xs text-[#8d959f]">Введите новый надежный пароль для вашего аккаунта</CardDescription>
          </CardHeader>
          <form onSubmit={handleUpdate}>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#8d959f]">Пароль</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3 w-4 h-4 text-[#59636f]" />
                  <Input 
                    type="password" 
                    placeholder="••••••••" 
                    className="pl-10 h-11 bg-[#080c12] border-white/10 rounded-xl text-white placeholder:text-[#59636f] focus:border-cyan-400 focus:ring-cyan-400/20 text-sm"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#8d959f]">Подтверждение пароля</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-3 w-4 h-4 text-[#59636f]" />
                  <Input 
                    type="password" 
                    placeholder="••••••••" 
                    className="pl-10 h-11 bg-[#080c12] border-white/10 rounded-xl text-white placeholder:text-[#59636f] focus:border-cyan-400 focus:ring-cyan-400/20 text-sm"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </div>
              <Button 
                type="submit" 
                disabled={isLoading} 
                className="w-full bg-gradient-to-b from-white to-[#dfe8ed] text-[#0c1117] font-semibold hover:shadow-[0_0_25px_rgba(176,232,255,0.35)] hover:-translate-y-0.5 rounded-xl h-11 text-sm transition-all mt-2"
              >
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
