import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { 
  Users, 
  Server, 
  DollarSign, 
  Activity, 
  Zap, 
  ShieldAlert, 
  CheckCircle2, 
  AlertCircle,
  TrendingUp,
  RefreshCw,
  ShieldCheck,
  CreditCard,
  Cpu,
  ArrowUpCircle,
  Sparkles
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { toast } from 'sonner';
import { AdminServersList } from './Servers';

export default function AdminDashboard() {
  const { session } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [diag, setDiag] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showDebug, setShowDebug] = useState(false);

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

  useEffect(() => {
    if (session?.access_token) {
      fetchData();
    }
  }, [session]);

  const cards = [
    { 
      title: 'Всего пользователей', 
      value: stats?.totalUsers || 0, 
      icon: Users, 
      color: 'text-blue-400',
      badgeColor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      subtext: 'Учетных записей в БД',
      detail: 'Синхронизировано со всеми серверами'
    },
    { 
      title: 'Активных подписок', 
      value: stats?.activeSubscriptions || 0, 
      icon: ShieldCheck, 
      color: 'text-emerald-400',
      badgeColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      subtext: 'Действующие тарифы',
      detail: `${stats?.totalUsers ? Math.round(((stats.activeSubscriptions || 0) / stats.totalUsers) * 100) : 0}% конверсия пользователей`
    },
    { 
      title: 'Сейчас онлайн', 
      value: stats?.totalOnline || 0, 
      icon: Zap, 
      color: 'text-amber-400',
      badgeColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      subtext: 'Активные VPN сессии',
      detail: 'Текущий туннельный трафик'
    },
  ];

  if (loading && !stats) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <AdminNav />
        <AdminPageHeader title="Обзор" description="Ключевые показатели сервиса" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-6 bg-secondary/30 rounded-2xl border border-white/5 space-y-4">
              <div className="flex items-center gap-4">
                <Skeleton className="w-12 h-12 rounded-xl bg-white/5" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-32 bg-white/5" />
                  <Skeleton className="h-8 w-24 bg-white/10" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64 w-full rounded-2xl bg-white/5" />
          <Skeleton className="h-64 w-full rounded-2xl bg-white/5" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AdminNav />
      <AdminPageHeader title="Обзор" description="Ключевые показатели сервиса" />

      {/* Ключевые показатели сервиса Command Center Block */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-6 bg-gradient-to-r from-blue-950/20 via-secondary/30 to-purple-950/20 rounded-2xl border border-blue-500/20 backdrop-blur-sm space-y-6 shadow-xl shadow-blue-950/10"
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-white/5 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400 border border-blue-500/20">
              <TrendingUp size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">Ключевые показатели сервиса</h2>
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Система активна
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Операционный мониторинг пользователей, активных подписок и сетевой нагрузки
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/admin/settings"
              className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-blue-600/30 via-indigo-600/20 to-purple-600/30 hover:from-blue-600/50 hover:to-indigo-600/40 text-blue-300 rounded-xl text-xs font-medium border border-blue-500/30 transition-all active:scale-95 shadow-sm"
              title="Обновить проект и перезапустить Docker (update.sh)"
            >
              <ArrowUpCircle size={14} className="text-blue-400" />
              <span>Обновить из GitHub</span>
            </a>
            <button
              onClick={() => {
                setLoading(true);
                fetchData();
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-xs font-medium border border-white/10 transition-colors"
              title="Обновить метрики"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin text-blue-400' : ''} />
              <span>Обновить</span>
            </button>
          </div>
        </div>

        {/* Info Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {cards.map((card, i) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-4 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between space-y-3 min-w-0 overflow-hidden hover:border-white/15 transition-all"
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{card.title}</span>
                <card.icon size={16} className={`${card.color} shrink-0`} />
              </div>

              <div className="flex items-baseline gap-2 min-w-0">
                <span className={`text-2xl sm:text-3xl font-bold font-mono ${card.color} truncate`}>
                  {card.value}
                </span>
                <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                  {card.subtext}
                </span>
              </div>

              <div className="text-[11px] text-zinc-400 font-mono flex items-center justify-between pt-1 border-t border-white/5">
                <span className="truncate">{card.detail}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
      
      {/* 🛠 Diagnostics Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Payment Diagnostics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-gradient-to-r from-blue-950/20 via-secondary/30 to-slate-900/40 rounded-2xl border border-blue-500/20 backdrop-blur-sm space-y-5 shadow-xl shadow-blue-950/10"
        >
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400 border border-blue-500/20">
                <CreditCard size={20} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Платежная система (Enot.io)</h3>
                <p className="text-xs text-muted-foreground">Проверка API ключей, подписи и вебхуков</p>
              </div>
            </div>
            {diag?.enot?.merchantId?.len > 0 && diag?.enot?.secretKey?.len > 0 ? (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 size={12} /> Готово к приему
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                <AlertCircle size={12} /> Ошибка ключей
              </span>
            )}
          </div>

          <div className="space-y-3">
            {/* Shop ID */}
            <div className="p-3.5 bg-black/40 rounded-xl border border-white/5 flex justify-between items-center">
              <div>
                <span className="text-xs font-medium text-zinc-300">Shop ID (Merchant ID)</span>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  Источник: {diag?.enot?.merchantId?.source || 'Не задан'}
                </p>
              </div>
              {diag?.enot?.merchantId?.len > 0 ? (
                <span className="text-emerald-400 flex items-center gap-1 text-xs font-mono font-bold bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                  <CheckCircle2 size={13} /> {diag.enot.merchantId.len} симв.
                </span>
              ) : (
                <span className="text-red-400 flex items-center gap-1 text-xs font-bold bg-red-500/10 px-2.5 py-1 rounded-lg border border-red-500/20">
                  <AlertCircle size={13} /> MISSING
                </span>
              )}
            </div>

            {/* Secret Key #1 */}
            <div className="p-3.5 bg-black/40 rounded-xl border border-white/5 flex justify-between items-center">
              <div>
                <span className="text-xs font-medium text-zinc-300">Secret Key #1 (HMAC)</span>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  Источник: {diag?.enot?.secretKey?.source || 'Не задан'}
                </p>
              </div>
              {diag?.enot?.secretKey?.len > 0 ? (
                <span className="text-emerald-400 flex items-center gap-1 text-xs font-mono font-bold bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                  <CheckCircle2 size={13} /> {diag.enot.secretKey.len} симв.
                </span>
              ) : (
                <span className="text-red-400 flex items-center gap-1 text-xs font-bold bg-red-500/10 px-2.5 py-1 rounded-lg border border-red-500/20">
                  <AlertCircle size={13} /> MISSING
                </span>
              )}
            </div>

            {/* Secret Key #2 */}
            <div className="p-3.5 bg-black/40 rounded-xl border border-white/5 flex justify-between items-center">
              <div>
                <span className="text-xs font-medium text-zinc-300">Secret Key #2 (Вебхуки)</span>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  Источник: {diag?.enot?.secretKey2?.source || 'Не задан'}
                </p>
              </div>
              {diag?.enot?.secretKey2?.len > 0 ? (
                <span className="text-emerald-400 flex items-center gap-1 text-xs font-mono font-bold bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                  <CheckCircle2 size={13} /> {diag.enot.secretKey2.len} симв.
                </span>
              ) : (
                <span className="text-amber-400 flex items-center gap-1 text-xs font-bold bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                  <AlertCircle size={13} /> Fallback (Key #1)
                </span>
              )}
            </div>
          </div>
        </motion.div>

        {/* System Diagnostics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-gradient-to-r from-purple-950/20 via-secondary/30 to-slate-900/40 rounded-2xl border border-purple-500/20 backdrop-blur-sm space-y-5 shadow-xl shadow-purple-950/10"
        >
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-400 border border-purple-500/20">
                <ShieldAlert size={20} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Проверка системы & Доступ</h3>
                <p className="text-xs text-muted-foreground">Состояние БД Supabase и права администратора</p>
              </div>
            </div>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 size={12} /> RBAC OK
            </span>
          </div>

          <div className="space-y-3">
            <div className="p-3.5 bg-black/40 rounded-xl border border-white/5 flex justify-between items-center">
              <div>
                <span className="text-xs font-medium text-zinc-300">Таблица настроек Supabase</span>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">Глобальный реестр конфигурации</p>
              </div>
              {diag?.database?.settingsTableOk ? (
                <span className="text-emerald-400 flex items-center gap-1 text-xs font-mono font-bold bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                  <CheckCircle2 size={13} /> Подключена
                </span>
              ) : (
                <span className="text-red-400 flex items-center gap-1 text-xs font-bold bg-red-500/10 px-2.5 py-1 rounded-lg border border-red-500/20">
                  <AlertCircle size={13} /> Отсутствует
                </span>
              )}
            </div>

            <div className="p-3.5 bg-black/40 rounded-xl border border-white/5 flex justify-between items-center">
              <div>
                <span className="text-xs font-medium text-zinc-300">Уровень доступа пользователя</span>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">Текущая авторизованная сессия</p>
              </div>
              <span className={`text-xs font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border ${
                diag?.role === 'superadmin' 
                  ? 'bg-red-500/10 text-red-400 border-red-500/20' 
                  : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
              }`}>
                {diag?.role || 'user'}
              </span>
            </div>

            <div className="p-3.5 bg-black/40 rounded-xl border border-white/5 flex justify-between items-center">
              <div>
                <span className="text-xs font-medium text-zinc-300">Архитектурный протокол</span>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">Xray Reality + Nginx + Hysteria2</p>
              </div>
              <span className="text-emerald-400 flex items-center gap-1 text-xs font-mono font-bold bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                <CheckCircle2 size={13} /> Стабилен
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      <AdminServersList />

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
