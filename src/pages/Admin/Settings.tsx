import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Save, RefreshCw, Key, ShieldCheck, Wallet, AlertCircle, Eye, EyeOff, Cloud, Globe, Activity, CheckCircle2, Lock, Unlock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { AdminNav } from '@/components/admin/AdminNav';
import { toast } from 'sonner';

interface Setting {
  key: string;
  value: string;
}

export default function AdminSettings() {
  const { session } = useAuth();
  const [settings, setSettings] = useState<Record<string, string>>({
    MONTHLY_PRICE: '100',
    PUBLIC_URL: '',
    ENOT_MERCHANT_ID: '',
    ENOT_SECRET_KEY: '',
    ENOT_SECRET_KEY2: '',
    PROMO_CODES_ENABLED: 'true',
    PROMO_CODES_LIST: '',
    UNIVERSAL_LINK_STATUS: 'all',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);
  const [editLocks, setEditLocks] = useState<Record<string, boolean>>({
    MONTHLY_PRICE: true,
    PUBLIC_URL: true,
    ENOT_MERCHANT_ID: true,
    ENOT_SECRET_KEY: true,
    ENOT_SECRET_KEY2: true,
    PROMO_CODES_LIST: true,
  });

  const toggleLock = (key: string) => {
    setEditLocks(prev => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    fetchSettings();
  }, [session]);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setTableMissing(false);
      const { data } = await axios.get('/api/admin/settings', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
      const mapped: Record<string, string> = {};
      if (Array.isArray(data)) {
        data.forEach((s: Setting) => {
          mapped[s.key] = s.value;
        });
      }
      
      setSettings(prev => ({ ...prev, ...mapped }));
    } catch (e: any) {
      console.error('Failed to fetch settings:', e.response?.data || e.message);
      if (e.response?.status === 404 && e.response?.data?.error === 'table_not_found') {
        setTableMissing(true);
      } else {
        toast.error('Ошибка при загрузке настроек');
      }
    } finally {
      setLoading(false);
    }
  };

  const [showKeys, setShowKeys] = useState<{ [key: string]: boolean }>({});

  const toggleKey = (key: string) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      // Clean values
      const cleanSettings = {
        MONTHLY_PRICE: settings.MONTHLY_PRICE?.trim() || '100',
        PUBLIC_URL: settings.PUBLIC_URL?.trim() || '',
        ENOT_MERCHANT_ID: settings.ENOT_MERCHANT_ID?.trim() || '',
        ENOT_SECRET_KEY: settings.ENOT_SECRET_KEY?.trim() || '',
        ENOT_SECRET_KEY2: settings.ENOT_SECRET_KEY2?.trim() || '',
        PROMO_CODES_ENABLED: settings.PROMO_CODES_ENABLED || 'true',
        PROMO_CODES_LIST: settings.PROMO_CODES_LIST?.trim() || '',
        UNIVERSAL_LINK_STATUS: settings.UNIVERSAL_LINK_STATUS || 'all',
      };
      
      const payload = Object.entries(cleanSettings).map(([key, value]) => ({ key, value }));
      
      await axios.post('/api/admin/settings', { settings: payload }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
      toast.success('Настройки успешно сохранены');
      fetchSettings(); // Refresh to be sure
    } catch (e: any) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  const [isRepairing, setIsRepairing] = useState(false);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [isRedeploying, setIsRedeploying] = useState(false);
  const [systemLogs, setSystemLogs] = useState<string[]>([
    '[Система] Добро пожаловать в веб-консоль управления сервером изинет.',
    '[Система] Выберите желаемое действие выше для получения детального отчета.',
    '[Подсказка] Кнопка ремонта полностью настроит сожительство Reality на порту 443 и Nginx на порту 3443.',
    '[Подсказка] Кнопка деплоя из GitHub стянет свежую версию кода, установит зависимости, пересоберет проект и автоматически перезапустит сервер.'
  ]);

  const handleGitRedeploy = async () => {
    try {
      setIsRedeploying(true);
      setSystemLogs([
        '[Старт] Запуск развертывания новой версии с GitHub (git pull)...',
        '[Сборка] Установка новых npm зависимостей (npm install)...',
        '[Компиляция] Сборка фронтенда и бэкенда (npm run build)...',
        '[Система] Пожалуйста подождите, сборка в среднем занимает от 30 до 90 секунд...'
      ]);
      toast.loading('Деплой и сборка кода из GitHub...', { id: 'sys-redeploy' });
      
      const { data } = await axios.post('/api/admin/system/git-pull-redeploy', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
      const outLines = (data.stdout || '').split('\n');
      const errLines = (data.stderr || '').split('\n');
      const lines = [...outLines, ...errLines].filter((l: string) => l.trim().length > 0);
      
      setSystemLogs(lines.length ? lines : ['[Успех] Код успешно обновлен.']);
      
      if (data.success) {
        toast.success(data.message || 'Сборка успешна! Перезапуск сервера...', { id: 'sys-redeploy' });
        // Даем 4 секунды на перезагрузку страницы, пока сервер перезапускается
        setTimeout(() => {
          window.location.reload();
        }, 4000);
      } else {
        toast.error('Ошибка сборки. Проверьте логи в терминале выше.', { id: 'sys-redeploy', duration: 10000 });
      }
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.message;
      setSystemLogs(prev => [...prev, `[Ошибка] ${errMsg}`]);
      toast.error('Ошибка сборки с GitHub: ' + errMsg, { id: 'sys-redeploy' });
    } finally {
      setIsRedeploying(false);
    }
  };

  const handleRepairVless = async () => {
    try {
      setIsRepairing(true);
      setSystemLogs([
        '[Старт] Запуск автоматического ремонта VLESS/Reality и сожительства с Nginx...',
        '[Система] Пожалуйста подождите, операция может занять до 20 секунд...'
      ]);
      toast.loading('Запуск авторемонта Reality + Nginx...', { id: 'sys-repair' });
      
      const { data } = await axios.post('/api/admin/system/repair-vless', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
      const outLines = (data.stdout || '').split('\n');
      const errLines = (data.stderr || '').split('\n');
      const lines = [...outLines, ...errLines].filter((l: string) => l.trim().length > 0);
      
      setSystemLogs(lines.length ? lines : ['[Успех] Скрипт не вернул логов, но завершился успешно.']);
      
      if (data.success) {
        toast.success(data.message || 'Авторемонт успешно выполнен!', { id: 'sys-repair' });
      } else {
        toast.error('Ремонт выполнен с предупреждениями', { id: 'sys-repair' });
      }
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.message;
      setSystemLogs(prev => [...prev, `[Ошибка] ${errMsg}`]);
      toast.error('Ошибка ремонта: ' + errMsg, { id: 'sys-repair' });
    } finally {
      setIsRepairing(false);
    }
  };

  const handleDiagnoseVps = async () => {
    try {
      setIsDiagnosing(true);
      setSystemLogs([
        '[Старт] Сбор диагностических данных VPS (активные порты, докер-контейнеры, сертификаты, настройки SQ-Lite)...',
        '[Система] Пожалуйста подождите...'
      ]);
      toast.loading('Запуск диагностики сервера...', { id: 'sys-diag' });
      
      const { data } = await axios.post('/api/admin/system/diagnose-vps', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
      const outLines = (data.stdout || '').split('\n');
      const errLines = (data.stderr || '').split('\n');
      const lines = [...outLines, ...errLines].filter((l: string) => l.trim().length > 0);
      
      setSystemLogs(lines.length ? lines : ['[Успех] Скрипт диагностики завершен.']);
      
      if (data.success) {
        toast.success(data.message || 'Диагностика успешно выполнена!', { id: 'sys-diag' });
      } else {
        toast.error('Диагностика выполнена с предупреждениями', { id: 'sys-diag' });
      }
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.message;
      setSystemLogs(prev => [...prev, `[Ошибка] ${errMsg}`]);
      toast.error('Ошибка диагностики: ' + errMsg, { id: 'sys-diag' });
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleFullSync = async () => {
    try {
      setIsSyncing(true);
      toast.loading('Запуск глобальной синхронизации...', { id: 'sync-all' });
      await axios.post('/api/admin/system/sync-all', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.success('Синхронизация запущена в фоновом режиме', { id: 'sync-all' });
    } catch (e: any) {
      toast.error('Ошибка: ' + (e.response?.data?.error || e.message), { id: 'sync-all' });
    } finally {
      setIsSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
        <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Loading Settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl md:text-2xl font-bold font-mono tracking-tight text-blue-400 uppercase">System Settings</h1>
        <button
          onClick={fetchSettings}
          className="flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-colors font-medium text-xs text-muted-foreground"
        >
          <RefreshCw size={14} /> Обновить
        </button>
      </div>

      <AdminNav />

      {tableMissing && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-4 mb-6"
        >
          <AlertCircle className="text-red-400 shrink-0" />
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-red-400">Ошибка базы данных: Таблица не найдена</h3>
            <p className="text-xs text-red-200/70 leading-relaxed">
              Таблица <code className="bg-red-500/20 px-1 rounded text-red-300">public.settings</code> отсутствует в вашем Supabase проекте. 
              Без неё настройки платежей не будут сохраняться. Пожалуйста, выполните SQL скрипт из файла 
              <code className="bg-white/5 px-1 rounded text-white italic ml-1">MULTI_SERVER_SETUP.md</code> в панели SQL Editor вашего Supabase.
            </p>
          </div>
        </motion.div>
      )}

      <form onSubmit={handleSave} className="space-y-8">
        {/* Core Platform config Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-secondary/30 rounded-2xl border border-white/5 backdrop-blur-sm space-y-6"
        >
          <div className="flex items-center gap-3 pb-4 border-b border-white/5">
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <Globe size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Домен платформы</h2>
              <p className="text-xs text-muted-foreground">Настройки основного домена для генерации ссылок на оплату и подписки</p>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">PUBLIC_URL (Домен приложения)</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-emerald-400 transition-colors">
                  <Globe size={18} />
                </div>
                <input
                  type="text"
                  disabled={editLocks.PUBLIC_URL}
                  value={settings.PUBLIC_URL || ''}
                  onChange={(e) => setSettings({ ...settings, PUBLIC_URL: e.target.value })}
                  className="w-full disabled:opacity-50 disabled:cursor-not-allowed bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-12 focus:outline-none focus:border-emerald-500/50 focus:bg-white/[0.07] transition-all font-mono text-sm"
                  placeholder="https://izinet.online"
                />
                <button
                  type="button"
                  onClick={() => toggleLock('PUBLIC_URL')}
                  className="absolute inset-y-0 right-4 flex items-center text-muted-foreground hover:text-white transition-colors"
                >
                  {editLocks.PUBLIC_URL ? <Lock size={16} className="text-red-400/70" /> : <Unlock size={16} className="text-green-400" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground ml-1">
                Укажите точный домен (вместе с https://), на котором размещен сайт.
              </p>
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Базовая стоимость за месяц (₽)</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-emerald-400 transition-colors">
                  <Wallet size={18} />
                </div>
                <input
                  type="number"
                  disabled={editLocks.MONTHLY_PRICE}
                  value={settings.MONTHLY_PRICE || ''}
                  onChange={(e) => setSettings({ ...settings, MONTHLY_PRICE: e.target.value })}
                  className="w-full disabled:opacity-50 disabled:cursor-not-allowed bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-12 focus:outline-none focus:border-emerald-500/50 focus:bg-white/[0.07] transition-all font-mono text-sm"
                  placeholder="100"
                />
                <button
                  type="button"
                  onClick={() => toggleLock('MONTHLY_PRICE')}
                  className="absolute inset-y-0 right-4 flex items-center text-muted-foreground hover:text-white transition-colors"
                >
                  {editLocks.MONTHLY_PRICE ? <Lock size={16} className="text-red-400/70" /> : <Unlock size={16} className="text-green-400" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground ml-1">
                Цена за 1 месяц подписки с одного устройства. При покупке на более длительный срок скидки применяться не будут.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Enot.io Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-secondary/30 rounded-2xl border border-white/5 backdrop-blur-sm space-y-6"
        >
          <div className="flex items-center gap-3 pb-4 border-b border-white/5">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <Wallet size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Enot.io Integration</h2>
              <p className="text-xs text-muted-foreground">Настройки платежного шлюза для пополнения баланса</p>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Shop ID</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-blue-400 transition-colors">
                  <ShieldCheck size={18} />
                </div>
                <input
                  type="text"
                  disabled={editLocks.ENOT_MERCHANT_ID}
                  value={settings.ENOT_MERCHANT_ID}
                  onChange={(e) => setSettings({ ...settings, ENOT_MERCHANT_ID: e.target.value })}
                  className="w-full disabled:opacity-50 disabled:cursor-not-allowed bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-12 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition-all font-mono text-sm"
                  placeholder="UUID кассы Enot.io"
                />
                <button
                  type="button"
                  onClick={() => toggleLock('ENOT_MERCHANT_ID')}
                  className="absolute inset-y-0 right-4 flex items-center text-muted-foreground hover:text-white transition-colors"
                >
                  {editLocks.ENOT_MERCHANT_ID ? <Lock size={16} className="text-red-400/70" /> : <Unlock size={16} className="text-green-400" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Секретный ключ</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-blue-400 transition-colors">
                    <Key size={18} />
                  </div>
                  <input
                    type={showKeys.ENOT_SECRET_KEY ? "text" : "password"}
                    autoComplete="new-password"
                    disabled={editLocks.ENOT_SECRET_KEY}
                    name={`enot_sk1_${Date.now()}`}
                    value={settings.ENOT_SECRET_KEY}
                    onChange={(e) => setSettings({ ...settings, ENOT_SECRET_KEY: e.target.value })}
                    className="w-full disabled:opacity-50 disabled:cursor-not-allowed bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-[80px] focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] focus:ring-0 transition-all font-mono text-sm [appearance:textfield]"
                    placeholder="Из кабинета Enot.io"
                  />
                  <div className="absolute inset-y-0 right-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleLock('ENOT_SECRET_KEY')}
                      className="text-muted-foreground hover:text-white transition-colors"
                    >
                      {editLocks.ENOT_SECRET_KEY ? <Lock size={16} className="text-red-400/70" /> : <Unlock size={16} className="text-green-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleKey('ENOT_SECRET_KEY')}
                      className="text-muted-foreground hover:text-white transition-colors"
                    >
                      {showKeys.ENOT_SECRET_KEY ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Дополнительный ключ</label>
                <div className="relative group">
                   <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-blue-400 transition-colors">
                    <Key size={18} />
                  </div>
                  <input
                    type={showKeys.ENOT_SECRET_KEY2 ? "text" : "password"}
                    autoComplete="new-password"
                    disabled={editLocks.ENOT_SECRET_KEY2}
                    name={`enot_sk2_${Date.now()}`}
                    value={settings.ENOT_SECRET_KEY2}
                    onChange={(e) => setSettings({ ...settings, ENOT_SECRET_KEY2: e.target.value })}
                    className="w-full disabled:opacity-50 disabled:cursor-not-allowed bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-[80px] focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] focus:ring-0 transition-all font-mono text-sm [appearance:textfield]"
                    placeholder="Из кабинета Enot.io (Дополнительный)"
                  />
                  <div className="absolute inset-y-0 right-4 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleLock('ENOT_SECRET_KEY2')}
                      className="text-muted-foreground hover:text-white transition-colors"
                    >
                      {editLocks.ENOT_SECRET_KEY2 ? <Lock size={16} className="text-red-400/70" /> : <Unlock size={16} className="text-green-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleKey('ENOT_SECRET_KEY2')}
                      className="text-muted-foreground hover:text-white transition-colors"
                    >
                      {showKeys.ENOT_SECRET_KEY2 ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 bg-blue-500/5 rounded-xl border border-blue-500/10">
              <AlertCircle className="text-blue-400 shrink-0 mt-0.5" size={16} />
              <div className="space-y-1">
                <p className="text-[11px] text-blue-200">Как настроить ключи</p>
                <p className="text-[10px] text-blue-200/60 leading-relaxed">
                  1. В поле Shop ID укажите идентификатор кассы из Enot.io. <br />
                  2. В первое поле ключа вставьте <b>секретный ключ кассы</b> для заголовка x-api-key. <br />
                  3. Во второе поле вставьте <b>дополнительный ключ</b> для проверки HMAC-подписи webhook.
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Promo Codes Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-secondary/30 rounded-2xl border border-white/5 backdrop-blur-sm space-y-6"
        >
          <div className="flex items-center gap-3 pb-4 border-b border-white/5">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <Key size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Промокоды на пробный период (24ч)</h2>
              <p className="text-xs text-muted-foreground">Настройка промокодов для активации бесплатного теста на 24 часа для новых пользователей</p>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-white/5 rounded-xl border border-white/5">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">Активность функции промокодов</p>
                <p className="text-xs text-muted-foreground">Включить или полностью отключить поле ввода промокодов у пользователей</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, PROMO_CODES_ENABLED: 'true' })}
                  className={`px-4 py-2 text-xs font-bold uppercase rounded-lg border transition-all ${
                    settings.PROMO_CODES_ENABLED === 'true'
                      ? 'bg-blue-500 border-blue-500 text-white'
                      : 'bg-white/5 border-white/5 text-muted-foreground hover:bg-white/10'
                  }`}
                >
                  Включено
                </button>
                <button
                  type="button"
                  onClick={() => setSettings({ ...settings, PROMO_CODES_ENABLED: 'false' })}
                  className={`px-4 py-2 text-xs font-bold uppercase rounded-lg border transition-all ${
                    settings.PROMO_CODES_ENABLED === 'false'
                      ? 'bg-red-500 border-red-500 text-white'
                      : 'bg-white/5 border-white/5 text-muted-foreground hover:bg-white/10'
                  }`}
                >
                  Отключено
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Список промокодов (слов/кодов)</label>
              <div className="relative group">
                <textarea
                  disabled={editLocks.PROMO_CODES_LIST}
                  value={settings.PROMO_CODES_LIST || ''}
                  onChange={(e) => setSettings({ ...settings, PROMO_CODES_LIST: e.target.value })}
                  className="w-full disabled:opacity-50 disabled:cursor-not-allowed bg-white/5 border border-white/10 rounded-xl py-3 pl-4 pr-12 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition-all font-mono text-sm min-h-[100px]"
                  placeholder="PROMO24&#10;FREE24&#10;IZINET24"
                />
                <button
                  type="button"
                  onClick={() => toggleLock('PROMO_CODES_LIST')}
                  className="absolute top-3 right-4 flex items-center text-muted-foreground hover:text-white transition-colors"
                >
                  {editLocks.PROMO_CODES_LIST ? <Lock size={16} className="text-red-400/70" /> : <Unlock size={16} className="text-green-400" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground ml-1">
                Введите промокоды, каждый с новой строки или через запятую. Регистр букв игнорируется (все будет приведено к верхнему регистру).
              </p>
            </div>

            <div className="flex items-start gap-3 p-4 bg-blue-500/5 rounded-xl border border-blue-500/10">
              <AlertCircle className="text-blue-400 shrink-0 mt-0.5" size={16} />
              <div className="space-y-1">
                <p className="text-[11px] text-blue-200">Как это работает для пользователей</p>
                <p className="text-[10px] text-blue-200/60 leading-relaxed">
                  Пользователь заходит в раздел подписок и в поле промокода вводит одно из указанных ключевых слов. <br />
                  Если промокод валиден и пользователь еще никогда не использовал пробный период через промокод, <br />
                  для него автоматически за пару секунд генерируется VLESS подписка на 24 часа. <br />
                  По окончании пробного периода пользователь сможет продлить подписку стандартным способом, пополнив баланс.
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Universal Link Visibility Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-secondary/30 rounded-2xl border border-white/5 backdrop-blur-sm space-y-6"
        >
          <div className="flex items-center gap-3 pb-4 border-b border-white/5">
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
              <Globe size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Универсальная ссылка подписки у юзеров</h2>
              <p className="text-xs text-muted-foreground">Настройка видимости общей ссылки (одна ссылка на все устройства) во избежание обхода оплаты за доп. устройства</p>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-white/5 rounded-xl border border-white/5">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">Статус отображения ссылки</p>
                <p className="text-xs text-muted-foreground">Кто будет видеть общую ссылку v2ray/vless подписки на дашборде</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={settings.UNIVERSAL_LINK_STATUS || 'all'}
                  onChange={(e) => setSettings({ ...settings, UNIVERSAL_LINK_STATUS: e.target.value })}
                  className="bg-secondary/50 border border-white/15 text-white text-xs font-bold rounded-lg px-3 py-2 outline-none focus:border-purple-500 transition-all font-mono"
                >
                  <option value="all">Показывать всем (All Users)</option>
                  <option value="pro">Только Pro-пользователям (Pro Only)</option>
                  <option value="none">Скрыть для всех (No/Hidden)</option>
                </select>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 bg-purple-500/5 rounded-xl border border-purple-500/10">
              <AlertCircle className="text-purple-400 shrink-0 mt-0.5" size={16} />
              <div className="space-y-1">
                <p className="text-[11px] text-purple-200">Монетизация на несколько устройств</p>
                <p className="text-[10px] text-purple-200/60 leading-relaxed">
                  По умолчанию пользователи получают универсальный URL подписки, который включает в себя ключи для ВСЕХ их добавленных устройств. <br />
                  Если вы хотите монетизировать каждое устройство отдельно (чтобы пользователь платил за каждое дополнительное устройство отдельно и не мог поделиться одной ссылкой на все девайсы): <br />
                  1. Выберите режим <b>"Только Pro-пользователям"</b> или <b>"Скрыть для всех"</b>. <br />
                  2. Пользователи без Pro статуса вынуждены будут копировать и настраивать конфигурации индивидуально для каждого устройства, а администратор сможет брать плату за доп. слоты. <br />
                  3. Вы можете даровать право "Pro" отдельным надежным пользователям через панель "Пользователи".
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* System Maintenance Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-red-500/5 rounded-2xl border border-red-500/10 backdrop-blur-sm space-y-6"
        >
          <div className="flex items-center gap-3 pb-4 border-b border-red-500/10">
            <div className="p-2 bg-red-500/10 rounded-lg text-red-400">
              <RefreshCw size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Обслуживание системы</h2>
              <p className="text-xs text-muted-foreground">Глобальные инструменты управления инфраструктурой</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {/* Sync Card */}
            <div className="p-4 bg-black/20 rounded-xl flex flex-col justify-between border border-white/5 space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">Синхронизация X-UI</h3>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Принудительно переподключит всех активных пользователей к X-UI на всех серверах.
                </p>
              </div>
              <button
                type="button"
                disabled={isSyncing}
                onClick={handleFullSync}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50 rounded-xl transition-colors font-bold text-xs border border-red-500/20"
              >
                {isSyncing ? <RefreshCw className="animate-spin" size={12} /> : <RefreshCw size={12} />}
                Запустить синхронизацию
              </button>
            </div>

            {/* GitHub Pull / Redeploy Card */}
            <div className="p-4 bg-blue-500/5 rounded-xl flex flex-col justify-between border border-blue-500/10 space-y-3 shadow-md shadow-blue-500/5">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-blue-400">Деплой с GitHub</h3>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Стянет свежий код с ветки репозитория, бережно пересоберет проект и выполнит хот-рестарт.
                </p>
              </div>
              <button
                type="button"
                disabled={isRedeploying}
                onClick={handleGitRedeploy}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50 rounded-xl transition-colors font-bold text-xs border border-blue-500/30"
              >
                {isRedeploying ? <RefreshCw className="animate-spin" size={12} /> : <RefreshCw size={12} />}
                Стянуть и обновить
              </button>
            </div>

            {/* Repair / Coexistence Card */}
            <div className="p-4 bg-black/20 rounded-xl flex flex-col justify-between border border-white/5 space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">Авторемонт VLESS & Nginx</h3>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Запустит скрипт <code className="text-orange-400">repair_xui.py</code> для настройки VLESS Reality (443) + Nginx (3443) co-existence.
                </p>
              </div>
              <button
                type="button"
                disabled={isRepairing}
                onClick={handleRepairVless}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 disabled:opacity-50 rounded-xl transition-colors font-bold text-xs border border-yellow-500/20"
              >
                {isRepairing ? <RefreshCw className="animate-spin" size={12} /> : <RefreshCw size={12} />}
                Ремонт портов и VLESS
              </button>
            </div>

            {/* VPS Diagnostics Card */}
            <div className="p-4 bg-black/20 rounded-xl flex flex-col justify-between border border-white/5 space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white">Диагностика VPS сервера</h3>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Проверит свободные порты, запущенные docker-контейнеры, SSL сертификаты и настройки БД.
                </p>
              </div>
              <button
                type="button"
                disabled={isDiagnosing}
                onClick={handleDiagnoseVps}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 rounded-xl transition-colors font-bold text-xs border border-blue-500/20"
              >
                {isDiagnosing ? <RefreshCw className="animate-spin" size={12} /> : <RefreshCw size={12} />}
                Диагностика системы
              </button>
            </div>
          </div>

          {/* Terminal Console Output */}
          <div className="space-y-2 pt-2">
            <div className="flex justify-between items-center ml-1">
              <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Интерактивная Веб-Консоль Логов (VPS Terminal):</label>
              <button 
                type="button" 
                onClick={() => setSystemLogs(['[Консоль очищена пользователем]'])}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 font-mono underline"
              >
                Очистить экран
              </button>
            </div>
            <div className="bg-neutral-950 font-mono text-[10px] md:text-xs p-4 rounded-xl border border-zinc-800 space-y-1.5 max-h-72 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800 select-all">
              {systemLogs.map((log, idx) => {
                let colorClass = 'text-zinc-300';
                if (log.includes('[Ошибка]') || log.toLowerCase().includes('failed') || log.startsWith('❌')) colorClass = 'text-red-400 font-semibold';
                if (log.toLowerCase().includes('success') || log.startsWith('✅')) colorClass = 'text-green-400 font-semibold';
                if (log.startsWith('[Старт]') || log.startsWith('[Система]')) colorClass = 'text-cyan-400';
                if (log.startsWith('===') || log.startsWith('---')) colorClass = 'text-zinc-500 font-bold';
                return (
                  <div key={idx} className="flex gap-2 leading-relaxed">
                    <span className="text-zinc-600 shrink-0 select-none">~</span>
                    <span className={colorClass}>{log}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>

        <div className="sticky bottom-6 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all font-bold shadow-lg shadow-blue-600/20 active:scale-95"
          >
            {saving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
            {saving ? 'Сохранение...' : 'Сохранить изменения'}
          </button>
        </div>
      </form>
    </div>
  );
}
