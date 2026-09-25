import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Layers, 
  RefreshCw, 
  Sparkles, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  HardDrive, 
  Terminal, 
  ArrowUpCircle,
  X,
  Clock,
  Cpu
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';

interface PanelVersionData {
  ok: boolean;
  currentVersion: string;
  xrayVersion: string;
  containerStatus: string;
  imageCreated?: string;
  latestVersion: string;
  latestReleaseName: string;
  latestReleaseUrl: string;
  publishedAt?: string | null;
  updateAvailable: boolean;
  isDocker?: boolean;
}

function formatDisplayVersion(ver?: string | null): string {
  if (!ver) return 'v3.8.5';
  const clean = ver.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\[[0-9;]*m/g, '').trim();
  if (/usages|subcommands|OS release|alpine|control menu/i.test(clean) || clean.includes('\n')) {
    const match = clean.match(/\b(v[1-9]\d*\.\d+(?:\.\d+)?)\b/);
    if (match) return match[1];
    return 'v3.8.5';
  }
  return clean.length > 16 ? clean.slice(0, 16) : clean;
}

export function PanelManagementSection() {
  const { session } = useAuth();
  const [data, setData] = useState<PanelVersionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    fetchVersion();
  }, [session]);

  const fetchVersion = async (showToast = false) => {
    try {
      setLoading(true);
      const res = await axios.get('/api/admin/panel/version', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (res.data?.ok) {
        setData(res.data);
        if (showToast) {
          if (res.data.updateAvailable) {
            toast.info(`Доступна новая версия: ${res.data.latestVersion}`);
          } else {
            toast.success('Панель 3x-ui актуальна!');
          }
        }
      }
    } catch (e: any) {
      console.error('Failed to fetch panel version:', e);
      if (showToast) toast.error('Не удалось проверить версию панели');
    } finally {
      setLoading(false);
    }
  };

  const handleStartUpdate = async () => {
    setShowConfirmModal(false);
    setIsUpdating(true);
    setShowLogs(true);
    setUpdateLogs([
      `[${new Date().toLocaleTimeString('ru-RU')}] Инициализация обновления 3x-ui...`,
      `[${new Date().toLocaleTimeString('ru-RU')}] Создание бэкапа базы данных SQLite x-ui.db...`
    ]);

    const toastId = toast.loading('Обновление 3x-ui... Скачивание свежего Docker-образа...');

    try {
      const res = await axios.post('/api/admin/panel/update', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });

      if (res.data?.ok) {
        toast.success(res.data.message || 'Панель 3x-ui успешно обновлена!', { id: toastId });
        if (Array.isArray(res.data.logs)) {
          setUpdateLogs(res.data.logs);
        }
        await fetchVersion();
      } else {
        toast.error(`Ошибка обновления: ${res.data?.error || 'Сбой выполнения'}`, { id: toastId });
        if (Array.isArray(res.data?.logs)) {
          setUpdateLogs(res.data.logs);
        }
      }
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.message || 'Не удалось выполнить обновление';
      toast.error(`Ошибка: ${errMsg}`, { id: toastId });
      if (e.response?.data?.logs) {
        setUpdateLogs(e.response.data.logs);
      } else {
        setUpdateLogs(prev => [...prev, `[Ошибка] ${errMsg}`]);
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const isUpToDate = data && !data.updateAvailable;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 bg-gradient-to-r from-blue-950/20 via-secondary/30 to-purple-950/20 rounded-2xl border border-blue-500/20 backdrop-blur-sm space-y-6 shadow-xl shadow-blue-950/10"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-white/5 gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400 border border-blue-500/20">
            <Layers size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">Панель 3x-ui & Xray Core</h2>
              {data?.containerStatus === 'running' || data?.containerStatus === 'active' ? (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Running
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-zinc-800 text-zinc-400 border border-white/10">
                  {data?.containerStatus || 'Active'}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Мониторинг версий, автоматический бэкап x-ui.db и безопасное обновление в 1 клик
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            disabled={loading || isUpdating}
            onClick={() => fetchVersion(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-xs font-medium border border-white/10 transition-colors disabled:opacity-50"
            title="Проверить релиз на GitHub"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin text-blue-400' : ''} />
            <span>Проверить</span>
          </button>

          {data && (
            <div className="shrink-0">
              {data.updateAvailable ? (
                <span className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 shadow-sm shadow-amber-500/10">
                  <Sparkles size={14} className="text-amber-400 animate-bounce" />
                  Доступно {data.latestVersion}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 size={14} />
                  Версия актуальна
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Info Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {/* Current Version */}
        <div className="p-4 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between space-y-2 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Установленная версия:</span>
            <Cpu size={14} className="text-blue-400 shrink-0" />
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <span 
              className="text-xl font-bold font-mono text-white truncate max-w-full"
              title={formatDisplayVersion(data?.currentVersion)}
            >
              {loading && !data ? '...' : formatDisplayVersion(data?.currentVersion)}
            </span>
            <span className="text-[10px] font-mono text-zinc-500 shrink-0">Docker</span>
          </div>
          <div 
            className="text-[11px] text-zinc-400 font-mono truncate"
            title={data?.xrayVersion || 'Xray-core (VLESS Reality)'}
          >
            {data?.xrayVersion || 'Xray-core (VLESS Reality)'}
          </div>
        </div>

        {/* Latest Available Release */}
        <div className="p-4 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between space-y-2 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Свежий релиз GitHub:</span>
            {data?.latestReleaseUrl && (
              <a
                href={data.latestReleaseUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-[10px] shrink-0"
                title="Открыть релиз на GitHub"
              >
                GitHub <ExternalLink size={10} />
              </a>
            )}
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-xl font-bold font-mono text-emerald-400 truncate">
              {loading && !data ? '...' : data?.latestVersion || 'v3.8.5'}
            </span>
            {data?.updateAvailable && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                Новое
              </span>
            )}
          </div>
          <div className="text-[11px] text-zinc-400 font-mono flex items-center gap-1 truncate">
            <Clock size={11} className="text-zinc-500 shrink-0" />
            <span className="truncate">
              {data?.publishedAt 
                ? new Date(data.publishedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
                : 'Актуальный'}
            </span>
          </div>
        </div>

        {/* Safety & Backups */}
        <div className="p-4 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between space-y-2 sm:col-span-2 md:col-span-1 min-w-0 overflow-hidden">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Безопасность:</span>
            <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
          </div>
          <div className="text-xs text-zinc-300 leading-relaxed">
            Автобэкап базы <code className="text-blue-300 font-mono text-[10px] bg-white/5 px-1 py-0.5 rounded">x-ui.db</code> перед накатом обновления.
          </div>
          <div className="text-[11px] text-emerald-400/90 flex items-center gap-1 truncate">
            <CheckCircle2 size={12} className="shrink-0" />
            <span className="truncate">Ключи Reality и клиенты сохраняются</span>
          </div>
        </div>
      </div>

      {/* Action Banner / Update Button */}
      <div className="p-4 bg-black/40 rounded-xl border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <HardDrive size={16} className="text-blue-400 shrink-0" />
            <h3 className="text-sm font-bold text-white">
              {data?.updateAvailable 
                ? `Доступно обновление 3x-ui до ${data.latestVersion}`
                : 'Панель 3x-ui обновлена до актуальной версии'}
            </h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {data?.updateAvailable 
              ? 'Процесс скачает свежий Docker-образ, создаст бэкап базы, пересоздаст контейнер и проверит целостность Reality ключей.'
              : 'Вы можете запустить процедуру повторно при необходимости обновить слои Docker или перепроверить целостность конфигурации.'}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {updateLogs.length > 0 && (
            <button
              type="button"
              onClick={() => setShowLogs(!showLogs)}
              className="flex items-center gap-1.5 px-3 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-xs font-mono border border-white/10 transition-colors"
            >
              <Terminal size={14} />
              <span>{showLogs ? 'Скрыть лог' : 'Показать лог'}</span>
            </button>
          )}

          <button
            type="button"
            disabled={isUpdating}
            onClick={() => setShowConfirmModal(true)}
            className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition-all active:scale-95 ${
              data?.updateAvailable
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-600/25 ring-2 ring-blue-500/30 animate-pulse'
                : 'bg-white/10 hover:bg-white/15 text-white shadow-white/5 border border-white/10'
            }`}
          >
            {isUpdating ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Обновление панели...</span>
              </>
            ) : (
              <>
                <ArrowUpCircle size={15} />
                <span>{data?.updateAvailable ? `Обновить до ${data.latestVersion}` : 'Переустановить / Обновить'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Terminal Logs Output */}
      {showLogs && updateLogs.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-white/5">
          <div className="flex justify-between items-center text-xs font-mono text-zinc-400">
            <span className="flex items-center gap-1.5">
              <Terminal size={12} className="text-blue-400" />
              Журнал операции обновления:
            </span>
            <button
              type="button"
              onClick={() => setUpdateLogs([])}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 underline"
            >
              Очистить
            </button>
          </div>
          <div className="bg-neutral-950 font-mono text-[10px] md:text-xs p-4 rounded-xl border border-zinc-800 space-y-1 max-h-56 overflow-y-auto scrollbar-thin select-all">
            {updateLogs.map((log, idx) => {
              let color = 'text-zinc-300';
              if (log.includes('✅') || log.toLowerCase().includes('успешно') || log.toLowerCase().includes('success')) color = 'text-emerald-400 font-semibold';
              if (log.includes('❌') || log.toLowerCase().includes('error') || log.toLowerCase().includes('ошибка')) color = 'text-red-400 font-semibold';
              if (log.includes('⚠️') || log.toLowerCase().includes('warning')) color = 'text-amber-400';
              if (log.includes('📦') || log.includes('📥') || log.includes('🐳') || log.includes('🔧') || log.includes('🩺')) color = 'text-cyan-400';
              return (
                <div key={idx} className="flex gap-2">
                  <span className="text-zinc-600 shrink-0">~</span>
                  <span className={color}>{log}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl p-6 space-y-5 shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-500/10 rounded-xl text-blue-400">
                    <ArrowUpCircle size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">Обновление панели 3x-ui</h3>
                    <p className="text-xs text-muted-foreground">Подтверждение операции</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3 text-xs text-zinc-300">
                <p>
                  Система выполнит безопасное обновление панели до версии{' '}
                  <strong className="text-emerald-400 font-mono text-sm">{data?.latestVersion || 'актуальной'}</strong>:
                </p>
                
                <div className="p-3 bg-black/40 rounded-xl border border-white/5 space-y-2 text-[11px]">
                  <div className="flex items-center gap-2 text-zinc-300">
                    <CheckCircle2 size={13} className="text-blue-400 shrink-0" />
                    <span>Автоматический бэкап базы <code className="text-blue-300">xui-db/x-ui.db</code></span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-300">
                    <CheckCircle2 size={13} className="text-blue-400 shrink-0" />
                    <span>Скачивание образа <code className="text-blue-300">ghcr.io/mhsanaei/3x-ui:latest</code></span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-300">
                    <CheckCircle2 size={13} className="text-blue-400 shrink-0" />
                    <span>Пересоздание контейнера (клиенты и трафик сохраняются)</span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-300">
                    <CheckCircle2 size={13} className="text-blue-400 shrink-0" />
                    <span>Проверка Reality-ключей и порта fallback 3443</span>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-200/90 text-[11px]">
                  <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Во время перезапуска контейнера (10-20 секунд) веб-панель 3x-ui кратковременно перезагрузится. Подключения клиентов восстановятся автоматически.
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="px-4 py-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-medium text-zinc-300 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleStartUpdate}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-600/20"
                >
                  <ArrowUpCircle size={14} />
                  <span>Да, начать обновление</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
