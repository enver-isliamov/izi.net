import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { 
  Save, 
  RefreshCw, 
  ShieldCheck, 
  Wallet, 
  AlertCircle, 
  Globe, 
  Lock, 
  Unlock, 
  Key, 
  Eye, 
  EyeOff, 
  Tag, 
  SlidersHorizontal,
  Layers
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
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
  const [tableMissing, setTableMissing] = useState(false);
  const [showKeys, setShowKeys] = useState<{ [key: string]: boolean }>({});
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

  const toggleKey = (key: string) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }));
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
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
      fetchSettings();
    } catch (e: any) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Ошибка при сохранении');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <AdminNav />
        <div className="flex flex-col items-center justify-center min-h-[350px] gap-4">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">Загрузка настроек...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminNav />

      <AdminPageHeader
        title="Настройки платформы"
        description="Тарифы подписок, платёжный шлюз Enot.io, промокоды и ссылки"
        onRefresh={fetchSettings}
      />

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
              Таблица <code className="bg-red-500/20 px-1 rounded text-red-300">public.settings</code> отсутствует в Supabase. 
              Выполните миграцию <code className="bg-white/5 px-1 rounded text-white italic ml-1">000_full_schema.sql</code> в SQL Editor.
            </p>
          </div>
        </motion.div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Core Platform config Section */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 sm:p-6 bg-secondary/30 rounded-2xl border border-white/5 backdrop-blur-sm space-y-6"
        >
          <div className="flex items-center gap-3 pb-3 border-b border-white/5">
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <Globe size={20} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-white">Домен и базовая цена</h2>
              <p className="text-xs text-muted-foreground">Основной URL приложения и тарифные расчеты</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
                  title={editLocks.PUBLIC_URL ? 'Разблокировать для редактирования' : 'Заблокировать'}
                >
                  {editLocks.PUBLIC_URL ? <Lock size={16} className="text-red-400/70" /> : <Unlock size={16} className="text-green-400" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground ml-1">
                Точный домен с https:// для формирования ссылок на оплату и вебхуков.
              </p>
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Базовая стоимость за 1 месяц (₽)</label>
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
                  title={editLocks.MONTHLY_PRICE ? 'Разблокировать для редактирования' : 'Заблокировать'}
                >
                  {editLocks.MONTHLY_PRICE ? <Lock size={16} className="text-red-400/70" /> : <Unlock size={16} className="text-green-400" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground ml-1">
                Базовая цена 1 месяца подписки за 1 устройство. Для роутеров применяется коэффициент x2.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Enot.io Section */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 sm:p-6 bg-secondary/30 rounded-2xl border border-white/5 backdrop-blur-sm space-y-6"
        >
          <div className="flex items-center gap-3 pb-3 border-b border-white/5">
            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
              <Wallet size={20} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-white">Платёжный шлюз Enot.io</h2>
              <p className="text-xs text-muted-foreground">Параметры кассы и секретные ключи для пополнения баланса</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Shop ID (UUID кассы)</label>
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
                  placeholder="UUID кассы"
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

            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Секретный ключ #1</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-blue-400 transition-colors">
                  <Key size={18} />
                </div>
                <input
                  type={showKeys.ENOT_SECRET_KEY ? 'text' : 'password'}
                  disabled={editLocks.ENOT_SECRET_KEY}
                  value={settings.ENOT_SECRET_KEY}
                  onChange={(e) => setSettings({ ...settings, ENOT_SECRET_KEY: e.target.value })}
                  className="w-full disabled:opacity-50 disabled:cursor-not-allowed bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-20 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition-all font-mono text-sm"
                  placeholder="Secret Key 1"
                />
                <div className="absolute inset-y-0 right-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleKey('ENOT_SECRET_KEY')}
                    className="text-muted-foreground hover:text-white transition-colors"
                  >
                    {showKeys.ENOT_SECRET_KEY ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleLock('ENOT_SECRET_KEY')}
                    className="text-muted-foreground hover:text-white transition-colors"
                  >
                    {editLocks.ENOT_SECRET_KEY ? <Lock size={16} className="text-red-400/70" /> : <Unlock size={16} className="text-green-400" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Секретный ключ #2 (Webhooks)</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-blue-400 transition-colors">
                  <Key size={18} />
                </div>
                <input
                  type={showKeys.ENOT_SECRET_KEY2 ? 'text' : 'password'}
                  disabled={editLocks.ENOT_SECRET_KEY2}
                  value={settings.ENOT_SECRET_KEY2}
                  onChange={(e) => setSettings({ ...settings, ENOT_SECRET_KEY2: e.target.value })}
                  className="w-full disabled:opacity-50 disabled:cursor-not-allowed bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-20 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition-all font-mono text-sm"
                  placeholder="Secret Key 2"
                />
                <div className="absolute inset-y-0 right-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleKey('ENOT_SECRET_KEY2')}
                    className="text-muted-foreground hover:text-white transition-colors"
                  >
                    {showKeys.ENOT_SECRET_KEY2 ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleLock('ENOT_SECRET_KEY2')}
                    className="text-muted-foreground hover:text-white transition-colors"
                  >
                    {editLocks.ENOT_SECRET_KEY2 ? <Lock size={16} className="text-red-400/70" /> : <Unlock size={16} className="text-green-400" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Promo Codes & Monetization Section */}
        <motion.div 
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-5 sm:p-6 bg-secondary/30 rounded-2xl border border-white/5 backdrop-blur-sm space-y-6"
        >
          <div className="flex items-center gap-3 pb-3 border-b border-white/5">
            <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
              <Tag size={20} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-white">Промокоды и политика ссылок</h2>
              <p className="text-xs text-muted-foreground">Управление бонусами и доступом к универсальным ссылкам</p>
            </div>
          </div>

          <div className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-black/30 rounded-xl border border-white/5">
              <div className="space-y-0.5">
                <span className="text-sm font-medium text-white">Активация промокодов</span>
                <p className="text-xs text-muted-foreground">Разрешить пользователям вводить промокоды при пополнении баланса</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={settings.PROMO_CODES_ENABLED === 'true'}
                  onChange={(e) => setSettings({ ...settings, PROMO_CODES_ENABLED: e.target.checked ? 'true' : 'false' })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between ml-1">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Список промокодов (Формат: КОД:СКИДКА_ИЛИ_РУБЛИ)</label>
                <button
                  type="button"
                  onClick={() => toggleLock('PROMO_CODES_LIST')}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white"
                >
                  {editLocks.PROMO_CODES_LIST ? <Lock size={12} className="text-red-400" /> : <Unlock size={12} className="text-green-400" />}
                  <span className="text-[10px]">{editLocks.PROMO_CODES_LIST ? 'Заблокировано' : 'Редактируется'}</span>
                </button>
              </div>
              <textarea
                disabled={editLocks.PROMO_CODES_LIST}
                value={settings.PROMO_CODES_LIST}
                onChange={(e) => setSettings({ ...settings, PROMO_CODES_LIST: e.target.value })}
                rows={3}
                className="w-full disabled:opacity-50 disabled:cursor-not-allowed bg-white/5 border border-white/10 rounded-xl p-3 font-mono text-xs focus:outline-none focus:border-purple-500/50 transition-all placeholder:text-muted-foreground/30"
                placeholder="START2026:50 (50 рублей бонус)&#10;IZI100:100 (100 рублей бонус)"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-black/30 rounded-xl border border-white/5">
              <div className="space-y-0.5">
                <span className="text-sm font-medium text-white">Режим универсальной ссылки подписки</span>
                <p className="text-xs text-muted-foreground">Кому отображать единую ссылку на все устройства</p>
              </div>
              <select
                value={settings.UNIVERSAL_LINK_STATUS || 'all'}
                onChange={(e) => setSettings({ ...settings, UNIVERSAL_LINK_STATUS: e.target.value })}
                className="bg-secondary/50 border border-white/15 text-white text-xs font-bold rounded-lg px-3 py-2 outline-none focus:border-purple-500 transition-all font-mono"
              >
                <option value="all">Показывать всем (All Users)</option>
                <option value="pro">Только Pro-пользователям</option>
                <option value="none">Скрыть для всех</option>
              </select>
            </div>
          </div>
        </motion.div>

        <div className="sticky bottom-6 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all font-bold shadow-lg shadow-blue-600/20 active:scale-95 text-sm"
          >
            {saving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
            {saving ? 'Сохранение...' : 'Сохранить изменения'}
          </button>
        </div>
      </form>
    </div>
  );
}
