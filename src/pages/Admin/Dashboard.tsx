import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Users, Server, DollarSign, Activity, Zap, ShieldAlert, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { AdminNav } from '@/components/admin/AdminNav';
import { toast } from 'sonner';

export default function AdminDashboard() {
  const { session } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [diag, setDiag] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const headers = { Authorization: `Bearer ${session?.access_token}` };
        const [statsRes, diagRes] = await Promise.all([
          axios.get('/api/admin/stats', { headers }),
          axios.get('/api/admin/diag', { headers }).catch(e => ({ data: null }))
        ]);
        setStats(statsRes.data);
        setDiag(diagRes.data);
      } catch (e: any) {
        console.error(e);
        if (e.response?.status === 401 || e.response?.status === 403) {
          toast.error(e.response.data.message || 'Ошибка доступа');
        }
      } finally {
        setLoading(false);
      }
    };
    if (session?.access_token) {
      fetchData();
    }
  }, [session]);

  const cards = [
    { title: 'Всего пользователей', value: stats?.totalUsers || 0, icon: Users, color: 'text-blue-500' },
    { title: 'Активных подписок', value: stats?.activeSubscriptions || 0, icon: Activity, color: 'text-green-500' },
    { title: 'Сейчас онлайн', value: stats?.totalOnline || 0, icon: Zap, color: 'text-yellow-400' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl md:text-2xl font-bold font-mono tracking-tight text-blue-400 uppercase">Admin Panel</h1>
      </div>

      <AdminNav />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {cards.map((card, i) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="p-6 bg-secondary/30 rounded-2xl border border-white/5"
          >
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl bg-white/5 ${card.color}`}>
                <card.icon size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{card.title}</p>
                <p className="text-2xl font-bold">{card.value}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      
      {/* 🛠 Diagnostics Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 bg-secondary/30 rounded-2xl border border-white/5">
          <h2 className="text-lg font-semibold mb-4 text-blue-400 flex items-center gap-2">
            <Zap size={20} /> Статус платежной системы (Enot.io)
          </h2>
          <div className="space-y-3">
            {/* Merchant ID */}
            <div className="flex justify-between items-center p-3 bg-white/5 rounded-xl border border-white/5">
              <span className="text-sm text-muted-foreground">Merchant ID</span>
              {diag?.enot?.merchantId?.len > 0 ? (
                <div className="flex flex-col items-end">
                  <span className="text-green-400 flex items-center gap-1 text-sm font-mono">
                    <CheckCircle2 size={14} /> OK ({diag.enot.merchantId.len} симв.)
                  </span>
                  <span className="text-[9px] text-muted-foreground uppercase opacity-50">Источник: {diag.enot.merchantId.source}</span>
                </div>
              ) : (
                <span className="text-red-400 flex items-center gap-1 text-sm font-bold">
                  <AlertCircle size={14} /> MISSING
                </span>
              )}
            </div>

            {/* Secret Key #1 */}
            <div className="flex justify-between items-center p-3 bg-white/5 rounded-xl border border-white/5">
              <span className="text-sm text-muted-foreground">Secret Key #1</span>
              {diag?.enot?.secretKey?.len > 0 ? (
                <div className="flex flex-col items-end">
                  <span className="text-green-400 flex items-center gap-1 text-sm font-mono">
                    <CheckCircle2 size={14} /> OK ({diag.enot.secretKey.len} симв.)
                  </span>
                  <span className="text-[9px] text-muted-foreground uppercase opacity-50">Источник: {diag.enot.secretKey.source}</span>
                </div>
              ) : (
                <span className="text-red-400 flex items-center gap-1 text-sm font-bold">
                  <AlertCircle size={14} /> MISSING
                </span>
              )}
            </div>

            {/* Secret Key #2 */}
            <div className="flex justify-between items-center p-3 bg-white/5 rounded-xl border border-white/5">
              <span className="text-sm text-muted-foreground">Secret Key #2</span>
              {diag?.enot?.secretKey2?.len > 0 ? (
                <div className="flex flex-col items-end">
                  <span className="text-green-400 flex items-center gap-1 text-sm font-mono">
                    <CheckCircle2 size={14} /> OK ({diag.enot.secretKey2.len} симв.)
                  </span>
                  <span className="text-[9px] text-muted-foreground uppercase opacity-50">Источник: {diag.enot.secretKey2.source}</span>
                </div>
              ) : (
                <span className="text-yellow-400 flex items-center gap-1 text-sm font-bold">
                  <AlertCircle size={14} /> WARNING (Using Key #1)
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 bg-secondary/30 rounded-2xl border border-white/5">
          <h2 className="text-lg font-semibold mb-4 text-blue-400 flex items-center gap-2">
            <ShieldAlert size={20} /> Проверка системы
          </h2>
          <div className="space-y-4">
             <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-[10px] text-muted-foreground uppercase mb-1">Таблица настроек (DB)</p>
                {diag?.database?.settingsTableOk ? (
                  <p className="text-green-400 flex items-center gap-1 text-sm font-bold">
                    <CheckCircle2 size={14} /> ТАБЛИЦА НАЙДЕНА
                  </p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-red-400 flex items-center gap-1 text-sm font-bold">
                      <AlertCircle size={14} /> ТАБЛИЦА ОТСУТСТВУЕТ
                    </p>
                    <p className="text-[10px] text-red-300/50 leading-tight">Выполните SQL-скрипт из MULTI_SERVER_SETUP.md</p>
                  </div>
                )}
             </div>
             <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-[10px] text-muted-foreground uppercase mb-1">Ваша текущая Роль</p>
                <p className={`font-bold text-sm uppercase tracking-wider ${diag?.role === 'superadmin' ? 'text-red-400' : 'text-blue-400'}`}>
                  {diag?.role || '...'}
                </p>
             </div>
          </div>
        </div>
      </div>

      <div className="p-6 bg-secondary/30 rounded-2xl border border-white/5">
        <h2 className="text-lg font-semibold mb-4 text-blue-400">Добро пожаловать в админ-панель izinet</h2>
        <p className="text-muted-foreground leading-relaxed">
          Здесь вы можете управлять VPN-серверами, пользователями и следить за статистикой сервиса. 
          Выберите нужный раздел в боковом меню или кнопках управления.
        </p>
      </div>

      {/* Debug Section for Superadmins */}
      {diag?.role === 'superadmin' && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-8 p-6 bg-black/40 rounded-2xl border border-white/10"
        >
          <button 
            onClick={() => setShowDebug(!showDebug)}
            className="text-xs text-muted-foreground hover:text-white transition-colors uppercase tracking-widest font-mono"
          >
            {showDebug ? '[-] Hide Debug Data' : '[+] Show Debug Data'}
          </button>
          
          {showDebug && (
            <pre className="mt-4 p-4 bg-black rounded-xl overflow-auto text-[10px] font-mono text-blue-300/80 max-h-60 border border-white/5">
              {JSON.stringify(diag, null, 2)}
            </pre>
          )}
        </motion.div>
      )}
    </div>
  );
}
