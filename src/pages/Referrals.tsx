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

export default function Referrals() {
  const { user } = useAuth();
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
  const siteLink = `https://izinet.app/login?ref=${refCode}`;
  const botLink = `https://t.me/izinet_bot?start=ref_${refCode}`;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Реферальная программа</h1>
          <p className="text-muted-foreground mt-1 text-sm">Приглашайте друзей и получайте <span className="text-primary font-bold">25%</span> от их пополнений пожизненно</p>
        </div>
        <Badge variant="outline" className="w-fit border-primary/50 text-tertiary px-3 py-1 rounded-full bg-primary/5">
          Ваш код: <span className="ml-2 font-mono font-bold text-primary">{refCode}</span>
        </Badge>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="glass-card border-primary/20 relative overflow-hidden group">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors" />
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Всего рефералов</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{refCount}</div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex -space-x-2">
                {[...Array(Math.min(3, refCount))].map((_, i) => (
                  <div key={i} className="w-6 h-6 rounded-full border-2 border-background bg-muted flex items-center justify-center">
                    <Users className="w-3 h-3 text-muted-foreground" />
                  </div>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{activeCount} активных</span>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Общий заработок</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalEarned.toFixed(2)} ₽</div>
            <div className="flex items-center gap-1 mt-2 text-xs text-green-500">
              <TrendingUp className="w-3 h-3" /> +0% в этом месяце
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ваша комиссия</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">25%</div>
            <p className="text-xs text-muted-foreground mt-2">Пожизненные отчисления</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Referral Links */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Ваши ссылки</CardTitle>
              <CardDescription>Используйте эти ссылки для привлечения новых пользователей</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Ссылка на сайт</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 p-3 rounded-xl bg-muted/30 border border-border text-sm truncate">
                      {siteLink}
                    </div>
                    <Button onClick={() => handleCopy(siteLink)} size="icon" variant="outline" className="rounded-xl border-border hover:text-primary">
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="outline" className="rounded-xl border-border hover:text-primary">
                      <Share2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Ссылка на Telegram бота</label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 p-3 rounded-xl bg-muted/30 border border-border text-sm truncate">
                      {botLink}
                    </div>
                    <Button onClick={() => handleCopy(botLink)} size="icon" variant="outline" className="rounded-xl border-border hover:text-primary">
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="outline" className="rounded-xl border-border hover:text-primary">
                      <Share2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* How it works */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Как это работает</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">1</div>
                  <h4 className="font-bold text-sm">Поделитесь ссылкой</h4>
                  <p className="text-xs text-muted-foreground">Отправьте свою уникальную ссылку друзьям или опубликуйте её в соцсетях.</p>
                </div>
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">2</div>
                  <h4 className="font-bold text-sm">Друг регистрируется</h4>
                  <p className="text-xs text-muted-foreground">Ваш друг получает бонус 60₽ на баланс при регистрации по вашей ссылке.</p>
                </div>
                <div className="space-y-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">3</div>
                  <h4 className="font-bold text-sm">Получайте доход</h4>
                  <p className="text-xs text-muted-foreground">Вы получаете 25% от каждого пополнения баланса вашим другом навсегда.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Partner Program */}
          <Card className="glass-card bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="w-5 h-5 text-primary" />
                Партнерская программа
              </CardTitle>
              <CardDescription>Для владельцев каналов и сайтов</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                У вас есть аудитория? Мы предлагаем индивидуальные условия: повышенный процент комиссии и персональные промокоды.
              </p>
              <ul className="space-y-2">
                <li className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="w-3 h-3 text-primary" /> Комиссия до 40%
                </li>
                <li className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="w-3 h-3 text-primary" /> Персональный менеджер
                </li>
                <li className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="w-3 h-3 text-primary" /> Выплаты в день запроса
                </li>
              </ul>
              <Button className="w-full bg-primary text-black hover:bg-primary/90 rounded-xl mt-2">
                Стать партнером
              </Button>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Info className="w-4 h-4 text-muted-foreground" /> Условия
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-[10px] text-muted-foreground leading-relaxed">
              <p>• Минимальная сумма для вывода: 500₽</p>
              <p>• Запрещен спам и контекстная реклама на бренд</p>
              <p>• Бонусы начисляются автоматически в течение 5 минут после оплаты рефералом</p>
              <Button variant="link" className="p-0 h-auto text-[10px] text-primary">Полные правила программы</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
