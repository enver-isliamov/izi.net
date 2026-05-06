import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Save, RefreshCw, Key, ShieldCheck, Wallet, AlertCircle } from 'lucide-react';
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

  useEffect(() => {
    fetchSettings();
  }, [session]);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get('/api/admin/settings', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
      const mapped: Record<string, string> = {};
      data.forEach((s: Setting) => {
        mapped[s.key] = s.value;
      });
      
      setSettings(prev => ({ ...prev, ...mapped }));
    } catch (e: any) {
      console.error(e);
      toast.error('Ошибка при загрузке настроек');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      const payload = Object.entries(settings).map(([key, value]) => ({ key, value }));
      
      await axios.post('/api/admin/settings', { settings: payload }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
      toast.success('Настройки успешно сохранены');
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
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition-all font-mono text-sm"
                  placeholder="Ваш Merchant ID"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Secret Key #1</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-blue-400 transition-colors">
                    <Key size={18} />
                  </div>
                  <input
                    type="password"
                    value={settings.ENOT_SECRET_KEY}
                    onChange={(e) => setSettings({ ...settings, ENOT_SECRET_KEY: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition-all font-mono text-sm"
                    placeholder="Секретный ключ"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider ml-1">Secret Key #2</label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-4 flex items-center text-muted-foreground group-focus-within:text-blue-400 transition-colors">
                    <Key size={18} />
                  </div>
                  <input
                    type="password"
                    value={settings.ENOT_SECRET_KEY2}
                    onChange={(e) => setSettings({ ...settings, ENOT_SECRET_KEY2: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-blue-500/50 focus:bg-white/[0.07] transition-all font-mono text-sm"
                    placeholder="Секретный ключ #2 (вебхуки)"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 bg-blue-500/5 rounded-xl border border-blue-500/10">
              <AlertCircle className="text-blue-400 shrink-0 mt-0.5" size={16} />
              <div className="space-y-1">
                <p className="text-[11px] text-blue-200">Примечание к вебхукам</p>
                <p className="text-[10px] text-blue-200/60 leading-relaxed">
                  Secret Key #1 используется для формирования подписи оплаты на стороне клиента. <br />
                  Secret Key #2 используется для верификации уведомлений от сервера Enot.io. Если он не задан, будет использован Key #1.
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
