import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Copy, 
  Archive, 
  Download, 
  Trash2, 
  HardDrive, 
  Terminal, 
  ArrowUpCircle, 
  Sparkles, 
  X,
  Activity,
  Layers,
  Zap,
  Wrench
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { PanelManagementSection } from '@/components/admin/PanelManagementSection';
import { Hysteria2Section } from '@/components/admin/Hysteria2Section';
import { AmneziaWgSection } from '@/components/admin/AmneziaWgSection';
import { toast } from 'sonner';

interface BackupItem {
  filename: string;
  size_bytes: number;
  size_formatted: string;
  created_at: string;
}

export default function AdminMaintenance() {
  const { session } = useAuth();
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [loadingBackups, setLoadingBackups] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingInbounds, setIsSyncingInbounds] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isGitUpdating, setIsGitUpdating] = useState(false);
  const [gitUpdateLogs, setGitUpdateLogs] = useState<string[]>([]);
  const [showGitConfirmModal, setShowGitConfirmModal] = useState(false);
  const [showGitLogs, setShowGitLogs] = useState(false);
  const [systemLogs, setSystemLogs] = useState<string[]>([
    '[Система] Журнал операций и обслуживания VPS изинет.',
    '[Система] Выберите действие — результат появится здесь.',
    '[Подсказка] Обновление сервера выполняется кнопкой «Обновить из GitHub» или скриптом update.sh.'
  ]);

  useEffect(() => {
    fetchBackups();
  }, [session]);

  const fetchBackups = async () => {
    try {
      setLoadingBackups(true);
      const { data } = await axios.get('/api/admin/system/backups', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (data.ok && Array.isArray(data.backups)) {
        setBackups(data.backups);
      }
    } catch (e: any) {
      console.error('Failed to fetch backups:', e);
    } finally {
      setLoadingBackups(false);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setIsBackingUp(true);
      setSystemLogs(prev => [
        ...prev,
        '[Старт] Создание полной резервной копии VPS (3x-ui x-ui.db, Hysteria2, .env, Supabase snapshot)...',
        '[Система] Упаковка в tar.gz архив...'
      ]);
      toast.loading('Создание бэкапа VPS...', { id: 'sys-backup' });
      
      const { data } = await axios.post('/api/admin/system/backup', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });

      if (data.ok) {
        toast.success(`Бэкап создан: ${data.filename} (${data.size_formatted})`, { id: 'sys-backup' });
        setSystemLogs(prev => [
          ...prev,
          `[Успех] Резервная копия сохранена: ${data.filename} (${data.size_formatted})`,
          `[Инфо] Сохранённые компоненты: ${(data.saved_files || []).join(', ')}`
        ]);
        fetchBackups();
      } else {
        toast.error(`Ошибка создания бэкапа: ${data.error}`, { id: 'sys-backup' });
      }
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.message;
      setSystemLogs(prev => [...prev, `[Ошибка бэкапа] ${errMsg}`]);
      toast.error('Ошибка бэкапа: ' + errMsg, { id: 'sys-backup' });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleDownloadBackup = async (filename: string) => {
    try {
      toast.loading(`Скачивание ${filename}...`, { id: 'dl-backup' });
      const response = await axios.get(`/api/admin/system/backups/${encodeURIComponent(filename)}/download`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Архив успешно скачан на ваше устройство!', { id: 'dl-backup' });
    } catch (e: any) {
      toast.error('Ошибка скачивания: ' + (e.response?.data?.error || e.message), { id: 'dl-backup' });
    }
  };

  const handleDeleteBackup = async (filename: string) => {
    if (!confirm(`Вы действительно хотите удалить бэкап ${filename}?`)) return;
    try {
      await axios.delete(`/api/admin/system/backups/${encodeURIComponent(filename)}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.success('Бэкап удален');
      fetchBackups();
    } catch (e: any) {
      toast.error('Ошибка удаления: ' + (e.response?.data?.error || e.message));
    }
  };

  const handleCopyDeployScript = () => {
    const script = `cd /opt/izinet && git fetch origin main && git reset --hard origin/main && bash update.sh`;
    navigator.clipboard.writeText(script);
    toast.success('Команда обновления скопирована!');
  };

  const handleStartGitUpdate = async () => {
    setShowGitConfirmModal(false);
    setIsGitUpdating(true);
    setShowGitLogs(true);
    setGitUpdateLogs([
      `[${new Date().toLocaleTimeString('ru-RU')}] 🚀 Запуск: cd /opt/izinet && git fetch origin main && git reset --hard origin/main && bash update.sh`,
      `[${new Date().toLocaleTimeString('ru-RU')}] ⏳ Отправка команды на VPS хост...`
    ]);
    toast.loading('Запуск обновления из GitHub...', { id: 'git-update' });

    try {
      const { data } = await axios.post('/api/admin/system/git-update', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });

      if (data.ok) {
        toast.loading('Выполняется обновление из GitHub и пересборка контейнеров...', { id: 'git-update' });
        
        let pollCount = 0;
        const pollInterval = setInterval(async () => {
          pollCount++;
          try {
            const statusRes = await axios.get('/api/admin/system/git-update/status', {
              headers: { Authorization: `Bearer ${session?.access_token}` }
            });
            
            if (statusRes.data?.logs?.length) {
              setGitUpdateLogs(statusRes.data.logs);
            }

            if (statusRes.data?.completed) {
              clearInterval(pollInterval);
              setIsGitUpdating(false);
              toast.success('🎉 Обновление из GitHub успешно завершено!', { id: 'git-update', duration: 8000 });
              setSystemLogs(prev => [
                ...prev,
                `[Успех] Обновление из GitHub ветки main и перезапуск Docker завершены!`,
                ...(statusRes.data.logs.slice(-6))
              ]);
            } else if (statusRes.data?.error) {
              clearInterval(pollInterval);
              setIsGitUpdating(false);
              toast.error('Процесс завершился с ошибками. Проверьте лог.', { id: 'git-update' });
            }
          } catch (pollErr) {
            // В момент пересборки контейнер может кратковременно перезапускаться
          }
        }, 2500);

        setTimeout(() => {
          clearInterval(pollInterval);
          setIsGitUpdating(false);
        }, 300000);
      }
    } catch (e: any) {
      setIsGitUpdating(false);
      const errMsg = e.response?.data?.error || e.message;
      toast.error('Ошибка запуска обновления: ' + errMsg, { id: 'git-update' });
      setGitUpdateLogs(prev => [...prev, `[Ошибка] ${errMsg}`]);
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

  const handleCheckAwg = async () => {
    try {
      const { data } = await axios.get('/api/admin/awg/status', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      const lines = [
        data.available
          ? `[AWG] AmneziaWG работает: порт ${data.port}/udp, подсеть ${data.subnet}, клиентов ${data.peers?.length || 0}`
          : `[AWG] ${data.message}`
      ];
      (data.peers || []).slice(0, 15).forEach((p: any) => {
        lines.push(`[AWG] ${p.name} · ${p.address} · ${(Number(p.totalBytes || 0) / 1048576).toFixed(1)} МБ · ${p.online ? 'online' : 'offline'}`);
      });
      setSystemLogs(lines);
      toast.success('Статус AmneziaWG получен');
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message;
      setSystemLogs(prev => [...prev, `[Ошибка] ${msg}`]);
      toast.error('Не удалось получить статус AmneziaWG');
    }
  };

  const handleSyncAllInbounds = async () => {
    try {
      setIsSyncingInbounds(true);
      setSystemLogs(['[Старт] Развожу клиентов по всем включённым инбаундам...']);
      const { data } = await axios.post('/api/admin/system/sync-clients-all-inbounds', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      const lines = [
        `[Готово] Устройств обработано: ${data.devices}, добавлено клиентов в инбаунды: ${data.addedTotal}, ошибок: ${data.failedTotal}`
      ];
      (data.report || []).slice(0, 12).forEach((r: any) => {
        lines.push(`[${r.server}] ${r.device}: добавлено [${r.added.join(', ') || '—'}], уже было [${r.existing.join(', ') || '—'}]`);
      });
      setSystemLogs(lines);
      toast.success('Клиенты разведены по всем инбаундам');
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message;
      setSystemLogs(prev => [...prev, `[Ошибка] ${msg}`]);
      toast.error('Не удалось развести клиентов: ' + msg);
    } finally {
      setIsSyncingInbounds(false);
    }
  };

  const handleRegenerateLinks = async () => {
    try {
      setIsRegenerating(true);
      setSystemLogs([
        '[Старт] Обновление всех VPN-ссылок (Reality: chrome fp, актуальный publicKey)...',
        '[Система] Подождите, операция может занять до 30 секунд...'
      ]);
      toast.loading('Обновление VPN-ссылок...', { id: 'regen-links' });

      const { data } = await axios.post('/api/admin/system/regenerate-all-links', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });

      const msg = `Обновлено: ${data.updated} из ${data.total} подписок` + (data.errors ? `, ошибок: ${data.errors}` : '');
      setSystemLogs(prev => [...prev, `[Успех] ${msg}`]);
      toast.success(msg, { id: 'regen-links' });
    } catch (e: any) {
      const errMsg = e.response?.data?.error || e.message;
      setSystemLogs(prev => [...prev, `[Ошибка] ${errMsg}`]);
      toast.error('Ошибка: ' + errMsg, { id: 'regen-links' });
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminNav />

      <AdminPageHeader
        title="Сервис и Обслуживание"
        description="Обновление из GitHub, бэкапы VPS, службы 3x-ui, Hysteria2 и AmneziaWG"
        onRefresh={fetchBackups}
      />

      {/* GitHub 1-Click Update Card */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-5 sm:p-6 bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-purple-950/30 rounded-2xl border border-blue-500/30 space-y-4 shadow-xl shadow-blue-500/10 relative overflow-hidden"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="p-1.5 bg-blue-500/20 text-blue-400 rounded-lg border border-blue-500/30 shrink-0">
                <Sparkles size={16} className="animate-pulse" />
              </span>
              <h2 className="text-base sm:text-lg font-bold text-white">
                Обновление VPS из GitHub
              </h2>
              <span className="text-[10px] bg-blue-500/20 text-blue-300 font-mono px-2 py-0.5 rounded-full border border-blue-500/30">
                main → update.sh
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
              Стягивает свежий код ветки <code className="text-blue-300 font-mono text-[11px]">main</code>, сбрасывает локальные правки, чистит .env и пересобирает контейнеры Docker без потери баз данных.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
            {gitUpdateLogs.length > 0 && (
              <button
                type="button"
                onClick={() => setShowGitLogs(!showGitLogs)}
                className="flex items-center gap-1.5 px-3 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-xs font-mono border border-white/10 transition-colors w-full sm:w-auto justify-center"
              >
                <Terminal size={14} />
                <span>{showGitLogs ? 'Скрыть лог' : 'Лог обновления'}</span>
              </button>
            )}

            <button
              type="button"
              disabled={isGitUpdating}
              onClick={() => setShowGitConfirmModal(true)}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-lg shadow-blue-600/30 ring-2 ring-blue-500/30 transition-all active:scale-95 w-full sm:w-auto"
            >
              {isGitUpdating ? (
                <>
                  <RefreshCw className="animate-spin" size={14} />
                  <span>Обновление сервера...</span>
                </>
              ) : (
                <>
                  <ArrowUpCircle size={15} />
                  <span>Обновить всё из GitHub (update.sh)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Command Preview with Copy */}
        <div className="relative group">
          <div className="bg-black/50 border border-blue-500/20 rounded-xl p-3 font-mono text-[11px] text-blue-200 overflow-x-auto whitespace-pre flex items-center justify-between">
            <span className="truncate mr-2">cd /opt/izinet && git fetch origin main && git reset --hard origin/main && bash update.sh</span>
            <button
              type="button"
              onClick={handleCopyDeployScript}
              className="p-1.5 bg-blue-500/20 hover:bg-blue-500/40 text-blue-300 rounded-lg transition-colors border border-blue-500/30 shrink-0"
              title="Копировать команду для SSH"
            >
              <Copy size={12} />
            </button>
          </div>
        </div>

        {/* Live Git Update Logs Viewer */}
        {showGitLogs && gitUpdateLogs.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-white/10 animate-in fade-in duration-200">
            <div className="flex justify-between items-center text-xs font-mono text-zinc-400">
              <span className="flex items-center gap-1.5 text-blue-400">
                <Terminal size={13} />
                Журнал выполнения git update & docker compose:
              </span>
              <button
                type="button"
                onClick={() => setGitUpdateLogs([])}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 underline"
              >
                Очистить
              </button>
            </div>
            <div className="bg-neutral-950 font-mono text-[10px] md:text-xs p-4 rounded-xl border border-zinc-800 space-y-1 max-h-60 overflow-y-auto scrollbar-thin select-all">
              {gitUpdateLogs.map((log, idx) => {
                let color = 'text-zinc-300';
                if (log.includes('✅') || log.includes('🎉') || log.toLowerCase().includes('успешно') || log.toLowerCase().includes('success')) color = 'text-emerald-400 font-semibold';
                if (log.includes('❌') || log.toLowerCase().includes('error') || log.toLowerCase().includes('fatal') || log.toLowerCase().includes('ошибка')) color = 'text-red-400 font-semibold';
                if (log.includes('⚠️') || log.toLowerCase().includes('warning')) color = 'text-amber-400';
                if (log.includes('🚀') || log.includes('📡') || log.includes('🔄') || log.includes('⚙️') || log.includes('🐳')) color = 'text-cyan-400 font-medium';
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
      </motion.div>

      {/* 3x-ui Panel Version & 1-Click Update Section */}
      <PanelManagementSection />

      {/* Hysteria2 Section */}
      <Hysteria2Section />

      {/* AmneziaWG Section */}
      <AmneziaWgSection />

      {/* Quick Server Operations Grid */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-5 sm:p-6 bg-secondary/30 rounded-2xl border border-white/5 backdrop-blur-sm space-y-6"
      >
        <div className="flex items-center gap-3 pb-3 border-b border-white/5">
          <div className="p-2 bg-purple-500/10 rounded-lg text-purple-400">
            <Wrench size={20} />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-white">Инструменты синхронизации</h2>
            <p className="text-xs text-muted-foreground">Глобальное обслуживание клиентов и ссылок</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Sync Card */}
          <div className="p-4 bg-black/30 rounded-xl flex flex-col justify-between border border-white/5 space-y-3">
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
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50 rounded-xl transition-colors font-bold text-xs border border-red-500/20"
            >
              {isSyncing ? <RefreshCw className="animate-spin" size={12} /> : <RefreshCw size={12} />}
              Запустить синхронизацию
            </button>
          </div>

          {/* All Inbounds Card */}
          <div className="p-4 bg-black/30 rounded-xl flex flex-col justify-between border border-white/5 space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Клиенты во все инбаунды</h3>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Разводит каждого клиента по всем включённым инбаундам сервера (tcp / grpc / xhttp).
              </p>
            </div>
            <button
              type="button"
              disabled={isSyncingInbounds}
              onClick={handleSyncAllInbounds}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 rounded-xl transition-colors font-bold text-xs border border-emerald-500/20"
            >
              {isSyncingInbounds ? <RefreshCw className="animate-spin" size={12} /> : <RefreshCw size={12} />}
              Развести по всем инбаундам
            </button>
          </div>

          {/* Regenerate All VPN Links Card */}
          <div className="p-4 bg-black/30 rounded-xl flex flex-col justify-between border border-white/5 space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Обновить все VPN-ссылки</h3>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Пересоздаст VLESS-ссылки для всех активных подписок с актуальным Reality publicKey.
              </p>
            </div>
            <button
              type="button"
              disabled={isRegenerating}
              onClick={handleRegenerateLinks}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-green-500/10 text-green-400 hover:bg-green-500/20 disabled:opacity-50 rounded-xl transition-colors font-bold text-xs border border-green-500/20"
            >
              {isRegenerating ? <RefreshCw className="animate-spin" size={12} /> : <RefreshCw size={12} />}
              Обновить все ссылки
            </button>
          </div>

          {/* Diagnostics Card */}
          <div className="p-4 bg-black/30 rounded-xl flex flex-col justify-between border border-white/5 space-y-3">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Диагностика и тесты</h3>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Реальные проверки: конфигурация, база, docker-порты, Reality-ключи и трафик.
              </p>
            </div>
            <a
              href="/admin/tests"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded-xl transition-colors font-bold text-xs border border-blue-500/20"
            >
              <Activity size={12} />
              Открыть раздел «Тесты»
            </a>
          </div>
        </div>

        {/* VPS Backup Management */}
        <div className="p-5 bg-gradient-to-r from-blue-950/30 to-purple-950/20 rounded-2xl border border-blue-500/20 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400 border border-blue-500/20 shrink-0">
                <Archive size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                  Резервное копирование VPS в 1 клик
                  <span className="text-[10px] bg-blue-500/20 text-blue-300 font-mono px-2 py-0.5 rounded-full border border-blue-500/30">
                    3x-ui + Hysteria2 + .env + Supabase
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Архив конфигурации: база 3x-ui, конфиг Hysteria2, .env и настройки базы.
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={isBackingUp}
              onClick={handleCreateBackup}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs shadow-lg shadow-blue-600/20 transition-all active:scale-95 shrink-0 w-full sm:w-auto"
            >
              {isBackingUp ? <RefreshCw className="animate-spin" size={14} /> : <HardDrive size={14} />}
              Создать бэкап VPS
            </button>
          </div>

          {/* Backups List */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <div className="flex justify-between items-center text-xs font-mono text-zinc-400">
              <span>Сохраненные архивы ({backups.length}):</span>
              {loadingBackups && <RefreshCw size={12} className="animate-spin text-blue-400" />}
            </div>

            {backups.length === 0 ? (
              <p className="text-xs text-zinc-500 font-mono py-2">
                Архивы еще не создавались. Нажмите кнопку выше для создания первой резервной копии.
              </p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {backups.map((b) => (
                  <div key={b.filename} className="flex items-center justify-between p-3 bg-black/40 rounded-xl border border-white/5 hover:border-blue-500/20 transition-all font-mono text-xs">
                    <div className="flex items-center gap-3 truncate">
                      <Archive size={14} className="text-blue-400 shrink-0" />
                      <div className="truncate">
                        <p className="text-zinc-200 truncate font-semibold">{b.filename}</p>
                        <p className="text-[10px] text-zinc-500">
                          {new Date(b.created_at).toLocaleString('ru-RU')} • {b.size_formatted}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <button
                        type="button"
                        onClick={() => handleDownloadBackup(b.filename)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/20 rounded-lg text-xs font-semibold transition-colors"
                        title="Скачать на устройство"
                      >
                        <Download size={12} />
                        <span className="hidden sm:inline">Скачать</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteBackup(b.filename)}
                        className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg transition-colors"
                        title="Удалить архив"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Diagnostic Script Snippet */}
        <div className="p-4 bg-orange-500/5 rounded-xl flex flex-col justify-between border border-orange-500/10 space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-orange-400">Скрипт быстрой диагностики в SSH</h3>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Показывает RAM, диск, последние логи Docker и события OOM Killer.
            </p>
          </div>
          <div className="relative group">
            <div className="bg-black/40 border border-orange-500/20 rounded-xl p-3 font-mono text-[10px] text-orange-200 overflow-x-auto whitespace-pre">
{`echo "=== RAM & DISK ===" && free -h && df -h && echo "=== DOCKER LOGS ===" && docker logs --tail 30 x3-ui && dmesg -T | grep -i oom`}
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(`echo "=== RAM & DISK ===" && free -h && df -h && echo "=== DOCKER LOGS ===" && docker logs --tail 30 x3-ui && dmesg -T | grep -i oom`);
                toast.success('Скрипт скопирован!');
              }}
              className="absolute top-2 right-2 p-1.5 bg-orange-500/20 hover:bg-orange-500/40 text-orange-300 rounded-lg transition-colors border border-orange-500/30"
              title="Копировать"
            >
              <Copy size={12} />
            </button>
          </div>
        </div>

        {/* Terminal Output */}
        <div className="space-y-2 pt-2">
          <div className="flex justify-between items-center ml-1">
            <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Журнал операций:</label>
            <button 
              type="button" 
              onClick={() => setSystemLogs(['[Консоль очищена пользователем]'])}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 font-mono underline"
            >
              Очистить экран
            </button>
          </div>
          <div className="bg-neutral-950 font-mono text-[10px] md:text-xs p-4 rounded-xl border border-zinc-800 space-y-1.5 max-h-72 overflow-y-auto scrollbar-thin select-all">
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

      {/* Modal Confirmation for GitHub Update */}
      <AnimatePresence>
        {showGitConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-lg bg-zinc-950 border border-blue-500/30 rounded-2xl p-6 shadow-2xl space-y-5 relative overflow-hidden"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-500/20 text-blue-400 rounded-xl border border-blue-500/30">
                    <Sparkles size={22} className="animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Обновить проект из GitHub</h3>
                    <p className="text-xs text-zinc-400">Ветка <span className="text-blue-400 font-mono">origin/main</span></p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGitConfirmModal(false)}
                  className="p-1 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-3 text-xs text-zinc-300">
                <p className="leading-relaxed">
                  На сервере будет выполнена полная цепочка обновления и пересборки:
                </p>

                <div className="p-3 bg-black/60 rounded-xl border border-white/10 font-mono text-[11px] text-blue-300 space-y-1">
                  <div>cd /opt/izinet</div>
                  <div>git fetch origin main</div>
                  <div>git reset --hard origin/main</div>
                  <div>bash update.sh</div>
                </div>

                <div className="space-y-1.5 text-[11px] text-zinc-400 bg-white/5 p-3.5 rounded-xl border border-white/5">
                  <div className="flex items-center gap-2 text-emerald-400 font-medium">
                    <CheckCircle2 size={14} />
                    <span>Все базы данных (x-ui.db), Reality-ключи и клиенты сохраняются</span>
                  </div>
                  <div className="flex items-center gap-2 text-emerald-400 font-medium">
                    <CheckCircle2 size={14} />
                    <span>Перед обновлением создаётся резервная копия базы</span>
                  </div>
                  <div className="flex items-center gap-2 text-blue-300">
                    <RefreshCw size={14} />
                    <span>Контейнеры Docker будут пересобраны и перезапущены (~30-60 сек)</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowGitConfirmModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-medium text-zinc-300 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleStartGitUpdate}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
                >
                  <ArrowUpCircle size={15} />
                  <span>🚀 Запустить обновление сейчас</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
