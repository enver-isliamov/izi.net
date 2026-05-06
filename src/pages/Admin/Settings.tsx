import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Save, RefreshCw, Key, ShieldCheck, Wallet, AlertCircle, Eye, EyeOff } from 'lucide-react';
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
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tableMissing, setTableMissing] = useState(false);

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
        ENOT_MERCHANT_ID: settings.ENOT_MERCHANT_ID?.trim(),
        ENOT_SECRET_KEY: settings.ENOT_SECRET_KEY?.trim(),
        ENOT_SECRET_KEY2: settings.ENOT_SECRET_KEY2?.trim(),
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
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Merchant ID</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-blue-400 transition-colors">
                  <ShieldCheck size={18} />
                </div>
                <input
                  type="text"
                  value={settings.ENOT_MERCHANT_ID}
                  onChange={(e) => setSettings({ ...settings, ENOT_MERCHANT_ID: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition-all font-mono text-sm [&:-webkit-autofill]:[transition:background-color_5000s_ease-in-out_0s] [&:-webkit-autofill]:[-webkit-text-fill-color:white]"
                  placeholder="Ваш Merchant ID"
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
                    autoComplete="off"
                    name="random_name_to_prevent_autofill_1"
                    value={settings.ENOT_SECRET_KEY}
                    onChange={(e) => setSettings({ ...settings, ENOT_SECRET_KEY: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-12 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] focus:ring-0 transition-all font-mono text-sm [appearance:textfield] [&:-webkit-autofill]:[transition:background-color_5000s_ease-in-out_0s] [&:-webkit-autofill]:[-webkit-text-fill-color:white]"
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
                    autoComplete="off"
                    name="random_name_to_prevent_autofill_2"
                    value={settings.ENOT_SECRET_KEY2}
                    onChange={(e) => setSettings({ ...settings, ENOT_SECRET_KEY2: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-12 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] focus:ring-0 transition-all font-mono text-sm [appearance:textfield] [&:-webkit-autofill]:[transition:background-color_5000s_ease-in-out_0s] [&:-webkit-autofill]:[-webkit-text-fill-color:white]"
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
                  1. Скопируйте <b>Секретный ключ</b> из кабинета Enot.io в первое поле. <br />
                  2. Скопируйте <b>Дополнительный ключ</b> во второе поле. Именно он отвечает за проверку оплаты сервером (Webhook).
                </p>
              </div>
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
