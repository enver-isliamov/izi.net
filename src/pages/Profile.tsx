import React, { useEffect, useState } from 'react';
import { 
  User, 
  Mail, 
  Send, 
  Shield, 
  Copy, 
  ChevronRight,
  Loader2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export default function Profile() {
  const { user, signOut } = useAuth();
  const [userData, setUserData] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      try {
        const [
          { data: userRes, error: userErr },
          { data: settingsRes, error: settingsErr }
        ] = await Promise.all([
          supabase.from('users').select('*').eq('id', user.id).single(),
          supabase.from('notification_settings').select('*').eq('user_id', user.id).single()
        ]);
          
        if (userErr && userErr.code !== 'PGRST116') {
          console.error('Error fetching user:', userErr);
        } else {
          setUserData(userRes);
        }

        if (settingsErr && settingsErr.code !== 'PGRST116') {
          console.error('Error fetching settings:', settingsErr);
        } else {
          setSettings(settingsRes);
        }
      } catch (error) {
        console.error('Profile fetch error:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProfile();
  }, [user]);

  const handleCopyRef = () => {
    if (userData?.referral_code) {
      navigator.clipboard.writeText(`izinet.app/ref/${userData.referral_code}`);
      toast.success('Ссылка скопирована!');
    } else {
      toast.error('Реферальный код не найден');
    }
  };

  const handleSettingChange = async (key: string, value: boolean) => {
    if (!user) return;
    
    // Update local state immediately for responsive UI
    setSettings((prev: any) => ({ ...prev, [key]: value }));
    
    try {
      const { error } = await supabase
        .from('notification_settings')
        .upsert({ user_id: user.id, [key]: value }, { onConflict: 'user_id' });
        
      if (error) throw error;
      toast.success('Настройки сохранены');
    } catch (error) {
      console.error('Error updating settings:', error);
      toast.error('Ошибка при сохранении настроек');
      // Revert on error
      setSettings((prev: any) => ({ ...prev, [key]: !value }));
    }
  };

  const handleLinkTelegram = async () => {
    if (!user) return;
    
    setIsLoading(true);
    const toastId = toast.loading('Генерация ссылки для привязки...');
    
    try {
      // 1. Generate a random 16-char token
      const token = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
      
      console.log('Attempting to create linking token for user:', user.id);
      
      // 2. Save token to DB
      const { error } = await supabase.from('telegram_linking_tokens').insert({
        token,
        user_id: user.id
      });
      
      if (error) {
        console.error('Supabase error creating token:', error);
        if (error.code === 'PGRST204' || error.code === 'PGRST205') {
          throw new Error('Таблица telegram_linking_tokens не найдена. Пожалуйста, выполните SQL скрипт создания таблиц.');
        }
        throw error;
      }
      
      // 3. Open Telegram
      const botName = 'izinet_bot';
      const link = `https://t.me/${botName}?start=link_${token}`;
      
      toast.success('Ссылка готова! Переходим в Telegram...', { id: toastId });
      
      // Small delay to let user see the success message
      setTimeout(() => {
        window.open(link, '_blank');
        setIsLoading(false);
      }, 1500);
      
    } catch (error) {
      console.error('Error linking telegram:', error);
      toast.error('Не удалось создать ссылку для привязки', { id: toastId });
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Профиль</h1>
        <p className="text-muted-foreground mt-1">Управление вашим аккаунтом и настройками</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Personal Info */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Личная информация</CardTitle>
              <CardDescription>Ваши основные данные</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <User className="w-10 h-10 text-primary" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-bold">{userData?.name || user?.email?.split('@')?.[0] || 'User'}</h3>
                  <p className="text-sm text-muted-foreground">ID: {user?.id?.substring(0, 8)}...</p>
                  <Badge className="bg-primary/20 text-primary border-primary/30 mt-1">
                    {(userData?.email_verified || userData?.telegram_linked) ? 'Активен' : 'Ожидает подтверждения'}
                  </Badge>
                </div>
              </div>

              <Separator className="bg-border" />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Email</label>
                  <div className="flex items-center gap-2">
                    <Input value={user?.email || ''} disabled className="bg-muted/30 border-border rounded-xl" />
                    {userData?.email_verified && (
                      <Badge className="bg-green-500/20 text-green-500 border-green-500/30">✓</Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Telegram</label>
                  {userData?.telegram_linked ? (
                    <div className="flex items-center gap-2">
                      <Input value={userData.telegram_id || 'Привязан'} disabled className="bg-muted/30 border-border rounded-xl" />
                      <Badge className="bg-green-500/20 text-green-500 border-green-500/30">✓</Badge>
                    </div>
                  ) : (
                    <Button 
                      onClick={handleLinkTelegram}
                      variant="outline" 
                      className="w-full rounded-xl border-border gap-2 hover:bg-muted"
                    >
                      <Send className="w-4 h-4 text-[#0088cc]" /> Привязать Telegram
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notification Settings */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Уведомления</CardTitle>
              <CardDescription>Настройте, о чем вы хотите получать оповещения</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">Окончание подписки</div>
                    <div className="text-xs text-muted-foreground">За {settings?.subscription_expiry_days || 3} дня до истечения срока</div>
                  </div>
                  <Switch 
                    checked={settings?.subscription_expiry_alert ?? true} 
                    onCheckedChange={(val) => handleSettingChange('subscription_expiry_alert', val)} 
                  />
                </div>
                <Separator className="bg-border" />
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">Лимит трафика</div>
                    <div className="text-xs text-muted-foreground">При достижении {settings?.traffic_warning_percent || 80}% объема</div>
                  </div>
                  <Switch 
                    checked={settings?.traffic_warning_alert ?? true} 
                    onCheckedChange={(val) => handleSettingChange('traffic_warning_alert', val)} 
                  />
                </div>
                <Separator className="bg-border" />
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">Новости и акции</div>
                    <div className="text-xs text-muted-foreground">Специальные предложения и обновления</div>
                  </div>
                  <Switch 
                    checked={settings?.news_alert ?? true} 
                    onCheckedChange={(val) => handleSettingChange('news_alert', val)} 
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Referral Link Quick Access */}
          <Card className="glass-card border-primary/20">
            <CardHeader>
              <CardTitle className="text-sm">Реферальная ссылка</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-xl bg-muted/30 border border-border flex items-center gap-2">
                <code className="text-[10px] truncate flex-1">
                  {userData?.referral_code ? `izinet.app/ref/${userData.referral_code}` : 'Код не сгенерирован'}
                </code>
                <Button onClick={handleCopyRef} size="icon" variant="ghost" className="h-8 w-8 rounded-lg hover:text-primary">
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground text-center">
                Получайте 25% от всех пополнений ваших друзей
              </p>
            </CardContent>
          </Card>

          {/* Security */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" /> Безопасность
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="ghost" className="w-full justify-between rounded-xl text-xs h-10">
                Сменить пароль <ChevronRight className="w-4 h-4" />
              </Button>
              <Button onClick={signOut} variant="ghost" className="w-full justify-between rounded-xl text-xs h-10 text-destructive hover:text-destructive hover:bg-destructive/10">
                Выйти из аккаунта <ChevronRight className="w-4 h-4" />
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
