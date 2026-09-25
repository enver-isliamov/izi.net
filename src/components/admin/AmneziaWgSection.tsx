import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { 
  ShieldCheck, 
  RefreshCw, 
  Copy, 
  CheckCircle2, 
  AlertCircle, 
  HelpCircle, 
  ExternalLink,
  Users,
  Server,
  Zap,
  Sliders,
  Download
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';

interface AwgStatusData {
  ok: boolean;
  available: boolean;
  message: string;
  port: number;
  subnet: string;
  interface: string;
  serverPublicKey: string;
  endpoint: string;
  obfuscation: {
    jc: number;
    jmin: number;
    jmax: number;
    s1: number;
    s2: number;
    h1: number;
    h2: number;
    h3: number;
    h4: number;
  };
  peersCount: number;
  peers: Array<{
    name: string;
    address: string;
    created_at?: string;
    rx: number;
    tx: number;
    totalBytes: number;
    online: boolean;
  }>;
}

export function AmneziaWgSection() {
  const { session } = useAuth();
  const [data, setData] = useState<AwgStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showPeers, setShowPeers] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, [session]);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/admin/awg/status', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      setData(res.data);
    } catch (e: any) {
      console.error('Error fetching AWG status:', e);
    } finally {
      setLoading(false);
    }
  };

  const restartAwg = async () => {
    try {
      setRestarting(true);
      const toastId = toast.loading('Перезапуск AmneziaWG...');
      const res = await axios.post('/api/admin/awg/restart', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (res.data?.ok) {
        toast.success(res.data.message || 'AmneziaWG успешно перезапущен', { id: toastId });
        await fetchStatus();
      } else {
        toast.error('Не удалось перезапустить AmneziaWG', { id: toastId });
      }
    } catch (e: any) {
      toast.error('Ошибка: ' + (e.response?.data?.error || e.message));
    } finally {
      setRestarting(false);
    }
  };

  const syncAllSubscriptions = async () => {
    try {
      setSyncing(true);
      const toastId = toast.loading('Синхронизация AmneziaWG для всех подписчиков...');
      const res = await axios.post('/api/admin/awg/sync-all', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (res.data?.ok) {
        toast.success(res.data.message || `Синхронизировано ${res.data.syncedCount} подписок!`, { id: toastId });
        await fetchStatus();
      } else {
        toast.error('Ошибка синхронизации: ' + (res.data?.error || 'Сбой'), { id: toastId });
      }
    } catch (e: any) {
      toast.error('Ошибка: ' + (e.response?.data?.error || e.message));
    } finally {
      setSyncing(false);
    }
  };

  const isOnline = data?.available;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 bg-gradient-to-r from-emerald-950/20 via-secondary/30 to-teal-950/20 rounded-2xl border border-emerald-500/20 backdrop-blur-sm space-y-6 shadow-xl shadow-emerald-950/10"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-white/5 gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">AmneziaWG (Обфусцированный WireGuard)</h2>
              {loading ? (
                <span className="text-xs text-muted-foreground animate-pulse">Загрузка...</span>
              ) : isOnline ? (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Активен (DPI-proof)
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  Вспомогательный режим
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Анти-DPI защита с мусорными пакетами (Jc, S1, H1-H4). Автоматически входит во все подписки пользователей.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            disabled={loading}
            onClick={fetchStatus}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-xs font-medium border border-white/10 transition-colors disabled:opacity-50"
            title="Обновить статус"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-emerald-400' : ''} />
            <span>Статус</span>
          </button>
          <button
            type="button"
            onClick={() => setShowHelp(!showHelp)}
            className="p-2 text-muted-foreground hover:text-white rounded-xl bg-white/5 border border-white/10"
            title="Справка"
          >
            <HelpCircle size={16} />
          </button>
        </div>
      </div>

      {/* Info Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {/* Endpoint & Port */}
        <div className="p-4 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between space-y-2 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Эндпоинт и порт:</span>
            <Server size={14} className="text-emerald-400 shrink-0" />
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-lg font-bold font-mono text-white truncate">
              {data?.endpoint || '194.50.94.28'}:{data?.port || 51820}
            </span>
          </div>
          <div className="text-[11px] text-zinc-400 font-mono truncate">
            Протокол: UDP • {data?.interface || 'awg0'}
          </div>
        </div>

        {/* Subnet & Network */}
        <div className="p-4 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between space-y-2 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Внутренняя сеть:</span>
            <Zap size={14} className="text-emerald-400 shrink-0" />
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-lg font-bold font-mono text-emerald-400 truncate">
              {data?.subnet || '10.88.0'}.0/24
            </span>
          </div>
          <div className="text-[11px] text-zinc-400 font-mono truncate">
            DNS: 1.1.1.1, 8.8.8.8
          </div>
        </div>

        {/* Obfuscation Parameters */}
        <div className="p-4 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between space-y-2 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Параметры DPI:</span>
            <Sliders size={14} className="text-emerald-400 shrink-0" />
          </div>
          <div className="text-xs font-mono text-zinc-300 space-y-0.5 truncate">
            <div>Jc={data?.obfuscation?.jc || 4}, Jmin={data?.obfuscation?.jmin || 50}</div>
            <div>S1={data?.obfuscation?.s1 || 64}, S2={data?.obfuscation?.s2 || 128}</div>
          </div>
          <div className="text-[10px] text-emerald-400/90 font-mono">
            H1..H4: {data?.obfuscation?.h1 || 1},{data?.obfuscation?.h2 || 2},{data?.obfuscation?.h3 || 3},{data?.obfuscation?.h4 || 4}
          </div>
        </div>

        {/* Peers Count & Sync */}
        <div className="p-4 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between space-y-2 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Подключено пиров:</span>
            <Users size={14} className="text-emerald-400 shrink-0" />
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-2xl font-bold font-mono text-white">
              {data?.peersCount ?? data?.peers?.length ?? 0}
            </span>
            <span className="text-[10px] text-zinc-400">клиентов</span>
          </div>
          <button
            type="button"
            onClick={() => setShowPeers(!showPeers)}
            className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium text-left underline"
          >
            {showPeers ? 'Скрыть список' : 'Показать клиентов'}
          </button>
        </div>
      </div>

      {/* Action Controls */}
      <div className="p-4 bg-black/40 rounded-xl border border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            Автоматическая доставка в подписки
            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
              Включено
            </span>
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Все пользователи при обновлении подписки в Hiddify или скачивании .conf получают персональный AmneziaWG ключ.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
          <button
            type="button"
            disabled={syncing}
            onClick={async () => {
              try {
                setSyncing(true);
                const toastId = toast.loading('Проверка чистоты инбаундов в 3x-ui...');
                const res = await axios.post('/api/admin/xui/setup-wireguard-inbound', {}, {
                  headers: { Authorization: `Bearer ${session?.access_token}` }
                });
                if (res.data?.success) {
                  toast.success('3x-ui проверен: конфликтующие инбаунды исключены, Xray в безопасности!', { id: toastId });
                  await fetchStatus();
                }
              } catch (e: any) {
                toast.error('Ошибка проверки: ' + (e.response?.data?.error || e.message));
              } finally {
                setSyncing(false);
              }
            }}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3.5 py-2.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-xl font-bold text-xs transition-all active:scale-95"
            title="Проверить отсутствие конфликтующих WireGuard инбаундов в панели 3x-ui"
          >
            <ShieldCheck size={14} className="text-blue-400" />
            Проверить 3x-ui
          </button>

          <button
            type="button"
            disabled={syncing}
            onClick={syncAllSubscriptions}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-lg shadow-emerald-600/20 transition-all active:scale-95"
          >
            {syncing ? <RefreshCw className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}
            Синхронизировать всех
          </button>

          <button
            type="button"
            disabled={restarting}
            onClick={restartAwg}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/15 text-zinc-200 disabled:opacity-50 rounded-xl font-bold text-xs transition-colors"
          >
            {restarting ? <RefreshCw className="animate-spin" size={14} /> : <RefreshCw size={14} />}
            Перезапуск
          </button>
        </div>
      </div>

      {/* Peers List (if toggled) */}
      {showPeers && (
        <div className="space-y-2 p-4 bg-black/40 rounded-xl border border-white/5 max-h-60 overflow-y-auto">
          <div className="flex items-center justify-between text-xs font-mono text-zinc-400 pb-2 border-b border-white/5">
            <span>Клиент / Адрес</span>
            <span>Трафик / Статус</span>
          </div>
          {(!data?.peers || data.peers.length === 0) ? (
            <p className="text-xs text-zinc-500 font-mono py-2">Пиры ещё не создавались.</p>
          ) : (
            data.peers.map((p, idx) => (
              <div key={idx} className="flex items-center justify-between font-mono text-xs py-1 text-zinc-300">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-white font-semibold">{p.name}</span>
                  <span className="text-zinc-500 text-[10px]">({p.address})</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-zinc-400">
                    {(Number(p.totalBytes || 0) / (1024 * 1024)).toFixed(1)} МБ
                  </span>
                  <span className={`w-2 h-2 rounded-full ${p.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Help Section */}
      {showHelp && (
        <div className="p-4 bg-black/40 rounded-xl border border-white/5 space-y-3 text-xs text-muted-foreground">
          <h3 className="font-semibold text-white">Как подключиться через AmneziaWG:</h3>
          <ul className="space-y-1.5 list-disc list-inside">
            <li><strong className="text-white">В приложении Hiddify:</strong> ссылка на AmneziaWG уже добавлена в универсальную подписку каждого пользователя.</li>
            <li><strong className="text-white">В официальном приложении AmneziaWG:</strong> скачайте файл <code className="text-emerald-300">.conf</code> в личном кабинете или отсканируйте QR-код.</li>
            <li><strong className="text-white">Установка сервера на VPS:</strong> при необходимости поднять службу вручную, выполните по SSH: <code className="text-emerald-300">bash scripts/amneziawg/setup_awg.sh</code>.</li>
          </ul>
        </div>
      )}
    </motion.div>
  );
}
