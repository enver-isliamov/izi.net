import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Save, RefreshCw, Key, ShieldCheck, Wallet, AlertCircle, Eye, EyeOff, Cloud, Globe, Activity, CheckCircle2 } from 'lucide-react';
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
    ENOT_MERCHANT_ID: '',
    ENOT_SECRET_KEY: '',
    ENOT_SECRET_KEY2: '',
    CLOUDFLARE_EMAIL: '',
    CLOUDFLARE_API_KEY: '',
    CLOUDFLARE_API_TOKEN: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);

  // States for Cloudflare Domain Binder Tool
  const [servers, setServers] = useState<any[]>([]);
  const [zones, setZones] = useState<any[]>([]);
  const [isLoadingZones, setIsLoadingZones] = useState(false);
  const [isBinding, setIsBinding] = useState(false);
  const [bindingLogs, setBindingLogs] = useState<string[]>(['Жду получения списка зон...']);

  const [selectedZone, setSelectedZone] = useState<any>(null);
  const [subdomain, setSubdomain] = useState('');
  const [selectedServerId, setSelectedServerId] = useState('panel'); // 'panel' or server.id
  const [isProxied, setIsProxied] = useState(false);

  useEffect(() => {
    fetchSettings();
    fetchServers();
  }, [session]);

  const fetchServers = async () => {
    try {
      const { data } = await axios.get('/api/admin/servers', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      setServers(data || []);
    } catch (e) {
      console.error('Failed to fetch servers:', e);
    }
  };

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
        ENOT_MERCHANT_ID: settings.ENOT_MERCHANT_ID?.trim(),
        ENOT_SECRET_KEY: settings.ENOT_SECRET_KEY?.trim(),
        ENOT_SECRET_KEY2: settings.ENOT_SECRET_KEY2?.trim(),
        CLOUDFLARE_EMAIL: settings.CLOUDFLARE_EMAIL?.trim(),
        CLOUDFLARE_API_KEY: settings.CLOUDFLARE_API_KEY?.trim(),
        CLOUDFLARE_API_TOKEN: settings.CLOUDFLARE_API_TOKEN?.trim(),
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

  const handleLoadZones = async () => {
    try {
      setIsLoadingZones(true);
      setBindingLogs(['[Система] Запрос списка зон из Cloudflare API через наш backend...']);
      const { data } = await axios.get('/api/admin/cloudflare/zones', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      setZones(data || []);
      if (data && data.length > 0) {
        setSelectedZone(data[0]);
        setBindingLogs(prev => [...prev, `[Успех] Загружено ${data.length} зон из Cloudflare! Выберите нужную зону в выпадающем списке.`]);
        toast.success('Список DNS зон успешно получен!');
      } else {
        setBindingLogs(prev => [...prev, '[Внимание] Зоны не найдены в вашем аккаунте. Убедитесь, что токен имеет права "Zone.DNS".']);
        toast.error('Доступные DNS зоны не найдены');
      }
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.message;
      setBindingLogs(prev => [...prev, `[Ошибка] ${errMsg}`]);
      toast.error('Не удалось загрузить зоны: ' + errMsg);
    } finally {
      setIsLoadingZones(false);
    }
  };

  const handleBindDomain = async () => {
    if (!selectedZone) {
      toast.error('Пожалуйста, выберите DNS зону');
      return;
    }
    
    let targetIp = '';
    let serverName = '';
    if (selectedServerId === 'panel') {
      targetIp = window.location.hostname;
      serverName = 'Главный VPS панели';
    } else {
      const srv = servers.find(s => s.id === selectedServerId);
      if (srv) {
        targetIp = srv.ip;
        serverName = srv.name;
      }
    }

    if (!targetIp || targetIp === 'localhost' || targetIp.includes('127.0.0.1')) {
      setBindingLogs(prev => [...prev, `[Внимание] Не удалось автоматически определить внешний IP для панели (${targetIp}). Для VPN серверов IP подтянется корректно.`]);
    }

    const recName = subdomain.trim() === '' || subdomain.trim() === '@' 
      ? selectedZone.name 
      : `${subdomain.trim()}.${selectedZone.name}`;

    try {
      setIsBinding(true);
      setBindingLogs(prev => [
        ...prev,
        `[Старт] Привязка домена "${recName}" к IP "${targetIp}" (${serverName})...`,
        `[Процесс 1/2] Отправка запроса на Cloudflare (проксирование=${isProxied ? 'ВКЛ' : 'ВЫКЛ'})...`
      ]);

      const { data } = await axios.post('/api/admin/cloudflare/bind', {
        zoneId: selectedZone.id,
        domain: recName,
        ip: targetIp,
        proxied: isProxied,
        serverId: selectedServerId === 'panel' ? null : selectedServerId
      }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });

      setBindingLogs(prev => [
        ...prev,
        `[Процесс 2/2] ${data.message}`,
        `[Успех] Домен привязан к серверу! Настройки обновлены. 🚀`
      ]);
      toast.success('Домен привязан!');
      if (selectedServerId !== 'panel') {
        fetchServers();
      }
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.message;
      setBindingLogs(prev => [...prev, `[Ошибка] ${errMsg}`]);
      toast.error('Ошибка привязки: ' + errMsg);
    } finally {
      setIsBinding(false);
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
        toast.error('Сборка завершилась ошибкой', { id: 'sys-redeploy' });
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
                  value={settings.ENOT_MERCHANT_ID}
                  onChange={(e) => setSettings({ ...settings, ENOT_MERCHANT_ID: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition-all font-mono text-sm [&:-webkit-autofill]:[transition:background-color_5000s_ease-in-out_0s] [&:-webkit-autofill]:[-webkit-text-fill-color:white]"
                  placeholder="UUID кассы Enot.io"
                />
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
                    name={`enot_sk1_${Date.now()}`}
                    value={settings.ENOT_SECRET_KEY}
                    onChange={(e) => setSettings({ ...settings, ENOT_SECRET_KEY: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-12 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] focus:ring-0 transition-all font-mono text-sm [appearance:textfield]"
                    placeholder="Из кабинета Enot.io"
                  />
                  <button
                    type="button"
                    onClick={() => toggleKey('ENOT_SECRET_KEY')}
                    className="absolute inset-y-0 right-4 flex items-center text-muted-foreground hover:text-white transition-colors"
                  >
                    {showKeys.ENOT_SECRET_KEY ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
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
                    name={`enot_sk2_${Date.now()}`}
                    value={settings.ENOT_SECRET_KEY2}
                    onChange={(e) => setSettings({ ...settings, ENOT_SECRET_KEY2: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-12 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] focus:ring-0 transition-all font-mono text-sm [appearance:textfield]"
                    placeholder="Из кабинета Enot.io (Дополнительный)"
                  />
                  <button
                    type="button"
                    onClick={() => toggleKey('ENOT_SECRET_KEY2')}
                    className="absolute inset-y-0 right-4 flex items-center text-muted-foreground hover:text-white transition-colors"
                  >
                    {showKeys.ENOT_SECRET_KEY2 ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
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

        {/* Cloudflare API Integration */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-secondary/30 rounded-2xl border border-white/5 backdrop-blur-sm space-y-6"
        >
          <div className="flex items-center gap-3 pb-4 border-b border-white/5">
            <div className="p-2 bg-orange-500/10 rounded-lg text-orange-400">
              <Cloud size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Cloudflare API & DNS Integration</h2>
              <p className="text-xs text-muted-foreground">Настройки интеграции с Cloudflare для автоматического управления DNS-записями</p>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="p-4 bg-zinc-500/5 border border-white/5 rounded-xl text-xs space-y-1 text-zinc-400">
              <p className="font-semibold text-zinc-300">Инструкция безопасности:</p>
              <p>Вы можете использовать либо современный <b>API Token</b> (Рекомендуется, нужны права Zone.DNS:Edit), либо традиционную связку <b>Global API Key + Email</b>.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Cloudflare API Token</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-orange-400 transition-colors">
                    <Key size={18} />
                  </div>
                  <input
                    type={showKeys.CLOUDFLARE_API_TOKEN ? "text" : "password"}
                    value={settings.CLOUDFLARE_API_TOKEN || ''}
                    onChange={(e) => setSettings({ ...settings, CLOUDFLARE_API_TOKEN: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-12 focus:outline-none focus:border-orange-500/50 focus:bg-white/[0.07] focus:ring-0 transition-all font-mono text-sm"
                    placeholder="Рекомендуется: Токен DNS редактирования"
                  />
                  <button
                    type="button"
                    onClick={() => toggleKey('CLOUDFLARE_API_TOKEN')}
                    className="absolute inset-y-0 right-4 flex items-center text-muted-foreground hover:text-white transition-colors"
                  >
                    {showKeys.CLOUDFLARE_API_TOKEN ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Global API Key</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-orange-400 transition-colors">
                    <Key size={18} />
                  </div>
                  <input
                    type={showKeys.CLOUDFLARE_API_KEY ? "text" : "password"}
                    value={settings.CLOUDFLARE_API_KEY || ''}
                    onChange={(e) => setSettings({ ...settings, CLOUDFLARE_API_KEY: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-12 focus:outline-none focus:border-orange-500/50 focus:bg-white/[0.07] focus:ring-0 transition-all font-mono text-sm"
                    placeholder="Используйте, если нет токена API"
                  />
                  <button
                    type="button"
                    onClick={() => toggleKey('CLOUDFLARE_API_KEY')}
                    className="absolute inset-y-0 right-4 flex items-center text-muted-foreground hover:text-white transition-colors"
                  >
                    {showKeys.CLOUDFLARE_API_KEY ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Email аккаунта Cloudflare</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-orange-400 transition-colors">
                  <Globe size={18} />
                </div>
                <input
                  type="email"
                  value={settings.CLOUDFLARE_EMAIL || ''}
                  onChange={(e) => setSettings({ ...settings, CLOUDFLARE_EMAIL: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-orange-500/50 focus:bg-white/[0.07] transition-all font-mono text-sm"
                  placeholder="Необходим ТОЛЬКО для Global API Key"
                />
              </div>
            </div>
          </div>
        </motion.div>

        {/* 1-Click Domain Binding Widget */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-secondary/30 rounded-2xl border border-white/5 backdrop-blur-sm space-y-6"
        >
          <div className="flex items-center justify-between pb-4 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg text-green-400">
                <Globe size={20} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Привязка домена в 2 клика</h2>
                <p className="text-xs text-muted-foreground">Быстрое перенаправление DNS в Cloudflare и настройка узлов панели</p>
              </div>
            </div>
            
            <button
              type="button"
              onClick={handleLoadZones}
              disabled={isLoadingZones}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600/20 text-orange-400 hover:bg-orange-600/30 rounded-xl transition-colors font-medium text-xs border border-orange-500/20 active:scale-95 disabled:opacity-50"
            >
              {isLoadingZones ? <RefreshCw className="animate-spin" size={12} /> : <Cloud size={12} />}
              Шаг 1: Загрузить домены
            </button>
          </div>

          <div className="grid gap-6">
            {zones.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* DNS Zone Selection */}
                <div className="space-y-2">
                  <label className="text-xs font-mono text-zinc-400">DNS Зона (Основной домен)</label>
                  <select
                    value={selectedZone?.id || ''}
                    onChange={(e) => {
                      const zone = zones.find(z => z.id === e.target.value);
                      setSelectedZone(zone);
                    }}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-orange-500/50 transition-colors font-mono text-sm"
                  >
                    {zones.map(z => (
                      <option key={z.id} value={z.id} className="bg-neutral-900 text-white">
                        {z.name} (ID: {z.id.substring(0,6)}...)
                      </option>
                    ))}
                  </select>
                </div>

                {/* Subdomain configure */}
                <div className="space-y-2">
                  <label className="text-xs font-mono text-zinc-400">Субдомен (Subdomain)</label>
                  <input
                    type="text"
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-orange-500/50 transition-colors font-mono text-sm"
                    placeholder="Например: node1 или @ для корня"
                  />
                </div>

                {/* Target VPS Server destination */}
                <div className="space-y-2">
                  <label className="text-xs font-mono text-zinc-400">Назначение привязки (Сервер)</label>
                  <select
                    value={selectedServerId}
                    onChange={(e) => setSelectedServerId(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-orange-500/50 transition-colors font-mono text-sm"
                  >
                    <option value="panel" className="bg-neutral-900 text-white">
                      Главный VPS панели (Эта система: {window.location.hostname})
                    </option>
                    {servers.map(s => (
                      <option key={s.id} value={s.id} className="bg-neutral-900 text-white">
                        {s.name} ({s.location_code || 'VPN Node'}) — IP {s.ip}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Toggle Cloudflare Proxy (grey vs orange cloud) */}
                <div className="space-y-2">
                  <label className="text-xs font-mono text-zinc-400 flex items-center gap-1">
                    Проксирование Cloudflare (CDN)
                  </label>
                  <div className="flex items-center gap-4 py-2 pl-1 bg-white/[0.02] border border-white/5 rounded-xl px-4">
                    <input
                      type="checkbox"
                      id="cf-proxied-toggle"
                      checked={isProxied}
                      onChange={(e) => setIsProxied(e.target.checked)}
                      className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-orange-600 focus:ring-orange-500 focus:ring-offset-black"
                    />
                    <label htmlFor="cf-proxied-toggle" className="text-xs text-zinc-300 cursor-pointer select-none">
                      {isProxied ? (
                        <span className="text-orange-400 font-semibold">Оранжевое облако (Рекомендуется только для сайта панели)</span>
                      ) : (
                        <span className="text-zinc-400">Серое облако (ОБЯЗАТЕЛЬНО для VPN нод VLESS / Reality)</span>
                      )}
                    </label>
                  </div>
                </div>

                {/*实时预览 Real-time domain preview */}
                <div className="md:col-span-2 p-4 bg-white/[0.03] border border-white/5 rounded-xl flex items-center justify-between text-xs font-mono text-zinc-300">
                  <span className="text-zinc-400">Результирующее доменное имя:</span>
                  <span className="text-orange-400 font-bold select-all">
                    {subdomain.trim() === '' || subdomain.trim() === '@' 
                      ? selectedZone.name 
                      : `${subdomain.trim()}.${selectedZone.name}`}
                  </span>
                </div>

                <div className="md:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={handleBindDomain}
                    disabled={isBinding}
                    className="w-full md:w-auto flex items-center justify-center gap-2 px-8 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-xl transition-all font-bold text-xs shadow-lg shadow-green-600/10 active:scale-95"
                  >
                    {isBinding ? <RefreshCw className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
                    Шаг 2: Привязать домен за 1 клик!
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center bg-black/10 rounded-2xl border border-dashed border-white/5 space-y-3">
                <Globe className="mx-auto text-zinc-500 animate-pulse" size={40} />
                <p className="text-xs text-zinc-400 max-w-sm mx-auto">
                  Сохраните настройки Cloudflare API (Email + Ключ / Токен) выше, а затем нажмите <b>«Шаг 1: Загрузить домены»</b>, чтобы активировать мастер быстрой привязки.
                </p>
              </div>
            )}

            {/* Interactive Domain Binding Console log outputs */}
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Статус интеграции и логи DNS:</label>
              <div className="bg-black/60 font-mono text-xs p-4 rounded-xl border border-white/5 space-y-1.5 max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 select-none">
                {bindingLogs.map((log, idx) => {
                  let colorClass = 'text-zinc-400';
                  if (log.startsWith('[Ошибка]')) colorClass = 'text-red-400 font-bold';
                  if (log.startsWith('[Успех]')) colorClass = 'text-green-400 font-semibold';
                  if (log.startsWith('[Старт]') || log.startsWith('[Система]')) colorClass = 'text-blue-400';
                  return (
                    <div key={idx} className="flex gap-2">
                      <span className="text-zinc-600">[{idx+1}]</span>
                      <span className={colorClass}>{log}</span>
                    </div>
                  );
                })}
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
