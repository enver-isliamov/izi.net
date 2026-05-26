import React, { useEffect, useState } from 'react';
import { 
  Users, 
  TrendingUp, 
  Gift, 
  Copy, 
  Share2, 
  ExternalLink,
  CheckCircle2,
  Info,
  Loader2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useAppConfig } from '@/hooks/useAppConfig';
import { useNavigate } from 'react-router-dom';

export default function Referrals() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { telegramBotName } = useAppConfig();
  const [userData, setUserData] = useState<any>(null);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchReferralData = async () => {
      if (!user) return;
      
      try {
        const [
          { data: userRes, error: userErr },
          { data: refRes, error: refErr }
        ] = await Promise.all([
          supabase.from('users').select('*').eq('id', user.id).single(),
          supabase.from('referrals').select('*').eq('referrer_id', user.id)
        ]);

        if (userErr && userErr.code !== 'PGRST116') {
          console.error('Error fetching user:', userErr);
          toast.error('Ошибка при загрузке данных профиля');
        }
        if (refErr) {
          console.error('Error fetching referrals:', refErr);
          toast.error('Ошибка при загрузке списка рефералов');
        }

        let currentUserData = userRes;

        // If user document exists but has no referral code, generate one
        if (currentUserData && !currentUserData.referral_code) {
          const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
          const { error: updateErr } = await supabase
            .from('users')
            .update({ referral_code: newCode })
            .eq('id', user.id);
            
          if (!updateErr) {
            currentUserData.referral_code = newCode;
          }
        }

        setUserData(currentUserData);
        setReferrals(refRes || []);
      } catch (error) {
        console.error('Referral data fetch error:', error);
        toast.error('Проблема с сетью при получении данных');
      } finally {
        setIsLoading(false);
      }
    };

    fetchReferralData();
  }, [user]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Ссылка скопирована!');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const refCount = referrals.length;
  const activeCount = referrals.filter(r => r.status === 'active' || r.commission_earned > 0).length;
  const totalEarned = referrals.reduce((sum, ref) => sum + (Number(ref.commission_earned) || 0), 0);
  
  const refCode = userData?.referral_code || 'Генерация...';
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const siteLink = `${siteUrl}/login?ref=${refCode}`;
  const cleanLink = `${siteUrl}/ref/${refCode}`;
  const botLink = `https://t.me/${telegramBotName}?start=ref_${refCode}`;

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in duration-500 max-w-4xl mx-auto">
      {/* Upper header block */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/[0.01] border border-white/5 p-3.5 rounded-2xl md:rounded-[32px]">
        <div className="space-y-1">
          <h1 className="text-xl md:text-3xl font-black tracking-tight text-white uppercase">Рефералы</h1>
          <p className="text-[11px] md:text-xs text-muted-foreground">
            Приглашайте друзей и получайте <span className="text-primary font-bold">10%</span> комиссионных пожизненно
          </p>
        </div>
        <Badge variant="outline" className="w-fit border-primary/20 text-primary px-3 py-1 rounded-xl bg-primary/5 text-[10px] md:text-xs">
          Ваш код: <span className="ml-1.5 font-mono font-bold text-primary">{refCode}</span>
        </Badge>
      </div>

      {/* Stats Grid - 3 cols even on mobile to be super compact and elegant */}
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        {/* Stat 1 */}
        <Card className="glass-card border-primary/20 relative overflow-hidden p-2.5 md:p-5 flex flex-col justify-between">
          <div className="space-y-0.5">
            <span className="text-[9px] md:text-xs font-bold text-muted-foreground uppercase tracking-wider block">Рефералы</span>
            <span className="text-lg md:text-3xl font-black text-white">{refCount}</span>
          </div>
          <span className="text-[8px] md:text-xs text-muted-foreground mt-1 block">
            {activeCount} актив.
          </span>
        </Card>

        {/* Stat 2 */}
        <Card className="glass-card border-primary/20 p-2.5 md:p-5 flex flex-col justify-between">
          <div className="space-y-0.5">
            <span className="text-[9px] md:text-xs font-bold text-muted-foreground uppercase tracking-wider block">Заработано</span>
            <span className="text-lg md:text-3xl font-black text-primary">{totalEarned.toFixed(0)} ₽</span>
          </div>
          <span className="text-[8px] md:text-xs text-green-400 mt-1 flex items-center gap-0.5">
            <TrendingUp className="w-2 md:w-3 h-2 md:h-3" /> +10%
          </span>
        </Card>

        {/* Stat 3 */}
        <Card className="glass-card border-primary/20 p-2.5 md:p-5 flex flex-col justify-between">
          <div className="space-y-0.5">
            <span className="text-[9px] md:text-xs font-bold text-muted-foreground uppercase tracking-wider block">Комиссия</span>
            <span className="text-lg md:text-3xl font-black text-white">10%</span>
          </div>
          <span className="text-[8px] md:text-xs text-muted-foreground mt-1 block">
            Пожизненно
          </span>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 space-y-4 md:space-y-6">
          {/* Referral Links list format (extremely clean and compact) */}
          <Card className="glass-card p-4 space-y-3">
            <div>
              <h3 className="text-xs md:text-base font-black text-white uppercase tracking-wider">Ваши реферальные ссылки</h3>
              <p className="text-[10px] md:text-xs text-muted-foreground">Используйте любую ссылку для приглашения</p>
            </div>
            
            <div className="space-y-2 pt-1 border-t border-white/5">
              {/* Link 1: Clean/Short */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2 rounded-xl bg-white/[0.01] border border-white/5 hover:border-white/10 gap-2 transition-all">
                <div className="min-w-0 flex-1">
                  <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide block">Ссылка на сайт</span>
                  <span className="text-[11px] font-mono text-primary truncate block">{cleanLink}</span>
                </div>
                <div className="flex gap-2">
                  <Button 
                    onClick={() => handleCopy(cleanLink)} 
                    variant="outline" 
                    className="h-7 text-[10px] font-bold px-2.5 rounded-lg gap-1 border-border shrink-0"
                  >
                    <Copy className="w-3 h-3 text-primary" /> Копировать
                  </Button>
                </div>
              </div>

              {/* Link 2: Bot Link */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2 rounded-xl bg-white/[0.01] border border-white/5 hover:border-white/10 gap-2 transition-all">
                <div className="min-w-0 flex-1">
                  <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide block">Telegram Бот</span>
                  <span className="text-[11px] font-mono text-white/70 truncate block">{botLink}</span>
                </div>
                <div className="flex gap-2">
                  <Button 
                    onClick={() => handleCopy(botLink)} 
                    variant="outline" 
                    className="h-7 text-[10px] font-bold px-2.5 rounded-lg gap-1 border-border shrink-0"
                  >
                    <Copy className="w-3 h-3 text-primary" /> Копировать
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {/* How it works */}
          <Card className="glass-card p-4 space-y-3">
            <h3 className="text-xs md:text-base font-black text-white uppercase tracking-wider">Как это работает</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 border-t border-white/5">
              <div className="flex items-start gap-2.5 p-2 rounded-xl bg-white/[0.01] border border-white/5">
                <div className="min-w-fit w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-black shrink-0">1</div>
                <div>
                  <h4 className="font-extrabold text-[11px] text-white">Делитесь ссылкой</h4>
                  <p className="text-[10px] text-muted-foreground leading-normal mt-0.5">Друг регистрируется и получает стартовые 50₽ на баланс.</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 rounded-xl bg-white/[0.01] border border-white/5">
                <div className="min-w-fit w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-black shrink-0">2</div>
                <div>
                  <h4 className="font-extrabold text-[11px] text-white">Друг оплачивает</h4>
                  <p className="text-[10px] text-muted-foreground leading-normal mt-0.5">Вносит любые платежи за покупку качественного туннеля VPN.</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2 rounded-xl bg-white/[0.01] border border-white/5">
                <div className="min-w-fit w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-black shrink-0">3</div>
                <div>
                  <h4 className="font-extrabold text-[11px] text-white">Получайте доход</h4>
                  <p className="text-[10px] text-muted-foreground leading-normal mt-0.5">Вы получаете 10% от каждого платежа на ваш баланс навсегда.</p>
                </div>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {/* Partner Program */}
          <Card className="glass-card bg-primary/5 border-primary/20 p-4 space-y-3">
            <div>
              <h3 className="text-xs md:text-base font-black text-white flex items-center gap-1.5 uppercase tracking-wider">
                <Gift className="w-4 h-4 text-primary" />
                Партнерам
              </h3>
              <p className="text-[10px] text-muted-foreground mt-0.5">Для лидеров мнений и вебмастеров</p>
            </div>
            
            <div className="space-y-2.5 text-xs text-muted-foreground leading-relaxed">
              <p className="text-[10px]">
                У вас есть аудитория? Напишите нам, чтобы получить индивидуальные условия: повышенный процент комиссии и персональные промокоды.
              </p>
              <ul className="space-y-1.5 border-t border-white/5 pt-2">
                <li className="flex items-center gap-1.5 text-[10px]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" /> Повышенная комиссия до 40%
                </li>
                <li className="flex items-center gap-1.5 text-[10px]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" /> Персональные именные промокоды
                </li>
                <li className="flex items-center gap-1.5 text-[10px]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" /> Выплаты без задержек
                </li>
              </ul>
              <Button onClick={() => navigate('/support')} className="w-full bg-primary text-black hover:bg-primary/95 text-[11px] font-black uppercase rounded-lg h-8 mt-2.5">
                Связаться
              </Button>
            </div>
          </Card>

          {/* Rules/Info Card */}
          <Card className="glass-card p-4 space-y-2">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" /> Условия программы
            </h3>
            <div className="space-y-1.5 text-[9px] text-muted-foreground leading-normal">
              <p>• Начисленные реферальные средства зачисляются автоматически в течение 5 минут после оплаты.</p>
              <p>• Бонусы можно использовать для оплаты любых тарифов VPN.</p>
              <p>• Запрещены любые виды мошенничества, спама или контекстной рекламы на бренд.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
