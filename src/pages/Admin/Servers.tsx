import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Server, Plus, Globe, Settings, Trash2, CheckCircle, XCircle, Zap, RefreshCw, Activity, AlertTriangle, ShieldCheck, Cloud, CloudDownload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import axios from 'axios';
import { toast } from 'sonner';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { PanelManagementSection } from '@/components/admin/PanelManagementSection';

export function AdminServersList() {
  const { session } = useAuth();
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState<string | null>(null);
  const [isBackingUp, setIsBackingUp] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState<string | null>(null);
  const [restoreModalTarget, setRestoreModalTarget] = useState<any | null>(null);
  const [healthData, setHealthData] = useState<Record<string, { online: boolean, error?: string }>>({});
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagResults, setDiagResults] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    name: '', ip: '', domain: '', api_port: 2053, username: '', password: '', location_code: 'DE'
  });

  const fetchServers = async () => {
    try {
      const { data } = await axios.get('/api/admin/servers', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (Array.isArray(data)) {
        setServers(data);
      } else {
        setServers([]);
      }
    } catch (e: any) {
      // ... errors handled
    } finally {
      setLoading(false);
    }
  };

  const fetchHealth = async () => {
    if (!session?.access_token) return;
    try {
      const { data } = await axios.get('/api/admin/servers/health', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      const healthMap: Record<string, { online: boolean, error?: string }> = {};
      data.forEach((item: any) => {
        healthMap[item.id] = { online: item.online, error: item.error };
      });
      setHealthData(healthMap);
    } catch (e) {
      console.warn('Health fetch failed (admin servers)');
    }
  };

  useEffect(() => {
    fetchServers();
  }, [session]);

  useEffect(() => {
    if (servers.length > 0) {
      fetchHealth();
      const interval = setInterval(fetchHealth, 30000);
      return () => clearInterval(interval);
    }
  }, [servers, session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await axios.put(`/api/admin/servers/${editingId}`, formData, {
          headers: { Authorization: `Bearer ${session?.access_token}` }
        });
        toast.success('Сервер обновлен (API)');
      } else {
        await axios.post('/api/admin/servers', formData, {
          headers: { Authorization: `Bearer ${session?.access_token}` }
        });
        toast.success('Сервер добавлен (API)');
      }
      
      setIsAdding(false);
      setEditingId(null);
      setFormData({ name: '', ip: '', domain: '', api_port: 2053, username: '', password: '', location_code: 'DE' });
      fetchServers();
    } catch (e: any) {
      const errorMsg = e.response?.data?.error || e.message || 'Ошибка сохранения сервера';
      toast.error(errorMsg);
      console.error('Save server error:', e);
    }
  };

  const checkConnection = async (id: string | number) => {
    try {
      setIsChecking(id.toString());
      toast.loading('Проверка соединения и Reality...', { id: 'check-conn' });
      const { data } = await axios.post(`/api/admin/servers/${id}/client-check`, {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (data.ok) {
        toast.success(`Сервер в норме! (Inbounds: ${data.inbounds?.length || 0}, TCP ${data.vpn_port || 443} OK)`, { id: 'check-conn' });
        fetchServers();
      } else if (data.panel_ok) {
        const issues = (data.issues || []).join(', ');
        toast.error(`Панель OK, но проблемы VPN: ${issues || 'Проверьте Reality'}`, { id: 'check-conn', duration: 6000 });
        fetchServers();
      } else {
        toast.error(`Ошибка связи с панелью: ${data.error || (data.issues || []).join(', ') || 'Нет ответа'}`, { id: 'check-conn' });
      }
    } catch (e: any) {
      console.error('Check connection error:', e);
      // Fallback to simple check
      try {
        const { data } = await axios.post(`/api/admin/servers/${id}/check`, {}, {
          headers: { Authorization: `Bearer ${session?.access_token}` }
        });
        if (data.status === 'ok') {
          toast.success('Соединение с панелью установлено!', { id: 'check-conn' });
          fetchServers();
        } else {
          toast.error(`Ошибка: ${data.message}`, { id: 'check-conn' });
        }
      } catch (fallbackErr: any) {
        const status = fallbackErr.response?.status;
        const errorData = fallbackErr.response?.data?.error || fallbackErr.message;
        toast.error(`Ошибка соединения (${status || 'Network'}): ${errorData}`, { id: 'check-conn' });
      }
    } finally {
      setIsChecking(null);
    }
  };

  const cloudBackup = async (id: string) => {
    try {
      setIsBackingUp(id);
      toast.loading('Создание бэкапа в облако...', { id: 'backup' });
      const { data } = await axios.post(`/api/admin/servers/${id}/backup`, {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (data.success) {
        toast.success(data.message, { id: 'backup' });
        fetchServers();
      } else {
        toast.error(data.error || 'Ошибка бэкапа', { id: 'backup' });
      }
    } catch (e: any) {
      console.error('Cloud backup error:', e);
      toast.error('Критическая ошибка бэкапа: ' + (e.response?.data?.error || e.message), { id: 'backup' });
    } finally {
      setIsBackingUp(null);
    }
  };

  const cloudRestore = async (id: string, sourceId?: string) => {
    if (!window.confirm('ВНИМАНИЕ! Это действие удалит все текущие настройки на панели 3x-ui и восстановит настройки из бэкапа (включая всех пользователей и порты). Продолжить?')) return;
    
    try {
      setIsRestoring(id);
      toast.loading('Восстановление конфигурации...', { id: 'restore' });
      const { data } = await axios.post(`/api/admin/servers/${id}/restore`, { sourceId }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (data.success) {
        toast.success(data.message, { id: 'restore' });
      } else {
        toast.error(data.error || 'Ошибка восстановления', { id: 'restore' });
      }
    } catch (e: any) {
      console.error('Cloud restore error:', e);
      toast.error('Ошибка восстановления: ' + (e.response?.data?.error || e.message), { id: 'restore' });
    } finally {
      setIsRestoring(null);
    }
  };

  const runDiagnostic = async () => {
    try {
      setIsDiagnosing(true);
      toast.loading('Запуск диагностики Reality...', { id: 'diag' });
      const { data } = await axios.get('/api/admin/servers/diag', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      setDiagResults(data);
      toast.success('Диагностика завершена', { id: 'diag' });
    } catch (e: any) {
      toast.error('Ошибка диагностики: ' + (e.response?.data?.error || e.message), { id: 'diag' });
    } finally {
      setIsDiagnosing(false);
    }
  };

  const startEdit = (server: any) => {
    setEditingId(server.id);
    setFormData({
      name: server.name || '',
      ip: server.ip || '',
      domain: server.domain || '',
      api_port: server.api_port || 2053,
      username: server.username || '',
      password: server.password || '',
      location_code: server.location_code || 'DE'
    });
    setIsAdding(true);
  };

  const cancelEdit = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', ip: '', domain: '', api_port: 2053, username: '', password: '', location_code: 'DE' });
  };

  const toggleServer = async (id: string, active: boolean) => {
    try {
      await axios.put(`/api/admin/servers/${id}`, { is_active: !active }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      fetchServers();
    } catch (e) {
      toast.error('Ошибка обновления status');
    }
  };

  const deleteServer = async (id: string) => {
    if (!confirm('Вы уверены?')) return;
    try {
      await axios.delete(`/api/admin/servers/${id}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      fetchServers();
      toast.success('Сервер удален');
    } catch (e) {
      toast.error('Ошибка удаления сервера');
    }
  };

  return (
    <div className="space-y-6 pt-2">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 pb-2 border-b border-white/5">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-white leading-tight">Управление серверами</h2>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Синхронизация, диагностика и добавление нод</p>
        </div>
      </div>

      {/* 3x-ui Panel Version & 1-Click Update */}
      <PanelManagementSection />

      {/* Подключенные серверы Block */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-6 bg-gradient-to-r from-blue-950/20 via-secondary/30 to-purple-950/20 rounded-2xl border border-blue-500/20 backdrop-blur-sm space-y-6 shadow-xl shadow-blue-950/10"
      >
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-4 border-b border-white/5 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-400 border border-blue-500/20">
              <Server size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">Подключенные серверы & Ноды</h2>
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {Array.isArray(servers) ? `${servers.filter(s => s.is_active).length} активных` : 'Активно'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Распределенный пул VPN-нод, балансировка клиентов, резервные копии и мониторинг доступности
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={async () => {
                try {
                  toast.loading('Синхронизация клиентов...', { id: 'sync' });
                  const { data } = await axios.post('/api/admin/system/sync-servers', { force: true }, {
                    headers: { Authorization: `Bearer ${session?.access_token}` }
                  });
                  toast.success(`Синхронизировано ${data.updatedUsers} пользователей`, { id: 'sync' });
                  fetchServers();
                } catch (e: any) {
                  toast.error('Ошибка синхронизации: ' + (e.response?.data?.error || e.message), { id: 'sync' });
                }
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded-xl text-xs font-medium border border-purple-500/20 transition-colors"
              title="Принудительная выгрузка клиентов из БД во все активные сервера 3x-ui"
            >
              <RefreshCw size={13} />
              <span>Синхронизировать юзеров</span>
            </button>

            <button
              onClick={runDiagnostic}
              disabled={isDiagnosing}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-xs font-medium border border-white/10 transition-colors disabled:opacity-50"
              title="Проверка Reality, версий Xray и сетевых портов"
            >
              <Activity size={13} className={isDiagnosing ? 'animate-spin text-blue-400' : ''} />
              <span>Диагностика Reality</span>
            </button>

            <button
              onClick={() => {
                if (isAdding) cancelEdit();
                else setIsAdding(true);
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-medium transition-colors shadow-sm shadow-blue-600/20"
            >
              {isAdding ? <XCircle size={14} /> : <Plus size={14} />}
              <span>{isAdding ? 'Отмена' : 'Добавить сервер'}</span>
            </button>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between">
            <span className="text-[11px] text-muted-foreground">Всего нод в пуле</span>
            <span className="text-xl font-bold font-mono text-white mt-1">{Array.isArray(servers) ? servers.length : 0}</span>
            <span className="text-[10px] text-zinc-500 font-mono">Шлюзы доступа</span>
          </div>
          <div className="p-3 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between">
            <span className="text-[11px] text-muted-foreground">Активных шлюзов</span>
            <span className="text-xl font-bold font-mono text-emerald-400 mt-1">
              {Array.isArray(servers) ? servers.filter(s => s.is_active).length : 0}
            </span>
            <span className="text-[10px] text-emerald-500/70 font-mono">Принимают трафик</span>
          </div>
          <div className="p-3 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between">
            <span className="text-[11px] text-muted-foreground">Пользователей в БД</span>
            <span className="text-xl font-bold font-mono text-blue-400 mt-1">
              {Array.isArray(servers) ? servers.reduce((acc, s) => acc + (Number(s.total_users) || 0), 0) : 0}
            </span>
            <span className="text-[10px] text-blue-400/70 font-mono">Синхронизировано</span>
          </div>
          <div className="p-3 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between">
            <span className="text-[11px] text-muted-foreground">Онлайн сейчас</span>
            <span className="text-xl font-bold font-mono text-amber-400 mt-1">
              {Array.isArray(servers) ? servers.reduce((acc, s) => acc + (Number(s.online_users) || 0), 0) : 0}
            </span>
            <span className="text-[10px] text-amber-400/70 font-mono">Активные сессии</span>
          </div>
        </div>

        {/* Server List */}
        <div className="space-y-4">
          {Array.isArray(servers) && servers.map((server) => {
            const isOnline = healthData[server.id]?.online;
            return (
              <motion.div
                key={server.id}
                layout
                className={`p-5 rounded-xl border transition-all ${
                  server.is_active 
                    ? 'bg-black/30 border-white/10 hover:border-blue-500/30 shadow-md' 
                    : 'bg-black/20 border-white/5 opacity-70'
                }`}
              >
                {/* Server Top Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-white/5">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl border ${
                      server.is_active 
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' 
                        : 'bg-zinc-800 text-zinc-500 border-white/5'
                    }`}>
                      <Server size={20} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white text-base">{server.name}</span>
                        <span className="text-[10px] bg-white/5 text-zinc-300 px-2 py-0.5 rounded font-mono uppercase font-bold border border-white/10">
                          {server.location_code || 'LOC'}
                        </span>
                        
                        {/* Live Health Status */}
                        {isOnline ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            Online
                          </span>
                        ) : isOnline === false ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            Offline
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-zinc-800 text-zinc-400 border border-white/10">
                            Проверка...
                          </span>
                        )}

                        {server.xui_config_state?.backup_at && (
                          <span className="text-[10px] bg-indigo-500/10 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-500/20 flex items-center gap-1 font-mono">
                            <Cloud size={10} /> 
                            Бэкап: {new Date(server.xui_config_state.backup_at).toLocaleDateString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-muted-foreground font-mono mt-1 flex items-center gap-2">
                        <span>{server.ip}</span>
                        {server.domain && <span className="text-zinc-500">({server.domain})</span>}
                        <span className="text-zinc-600">·</span>
                        <span className="text-zinc-400">Порт API: {server.api_port || 2053}</span>
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons Toolbar */}
                  <div className="flex flex-wrap items-center gap-1.5 self-start md:self-auto">
                    <button 
                      onClick={() => setRestoreModalTarget(server)}
                      disabled={isRestoring === server.id || !(Array.isArray(servers) && servers.some(s => s.xui_config_state?.backup_at))}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg text-xs font-medium border border-amber-500/20 transition-colors disabled:opacity-40"
                      title="Восстановить конфигурацию из облачного бэкапа"
                    >
                      {isRestoring === server.id ? <RefreshCw className="animate-spin" size={13} /> : <CloudDownload size={13} />}
                      <span className="hidden sm:inline">Восстановить</span>
                    </button>

                    <button 
                      onClick={() => cloudBackup(server.id)}
                      disabled={isBackingUp === server.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg text-xs font-medium border border-emerald-500/20 transition-colors disabled:opacity-40"
                      title="Создать резервную копию конфигурации в Supabase"
                    >
                      {isBackingUp === server.id ? <RefreshCw className="animate-spin" size={13} /> : <Cloud size={13} />}
                      <span className="hidden sm:inline">Бэкап</span>
                    </button>

                    <button 
                      onClick={() => checkConnection(server.id)}
                      disabled={isChecking === server.id}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-lg text-xs font-medium border border-blue-500/20 transition-colors disabled:opacity-40"
                      title="Проверить соединение и Reality параметры"
                    >
                      {isChecking === server.id ? <RefreshCw className="animate-spin" size={13} /> : <Zap size={13} />}
                      <span className="hidden sm:inline">Проверить</span>
                    </button>

                    <button
                      onClick={() => startEdit(server)}
                      className="p-1.5 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-lg border border-white/10 transition-colors"
                      title="Редактировать параметры сервера"
                    >
                      <Settings size={14} />
                    </button>

                    <button
                      onClick={() => toggleServer(server.id, server.is_active)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                        server.is_active 
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20' 
                          : 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20'
                      }`}
                    >
                      {server.is_active ? <CheckCircle size={13} /> : <XCircle size={13} />}
                      <span>{server.is_active ? 'Активен' : 'Отключен'}</span>
                    </button>

                    <button
                      onClick={() => deleteServer(server.id)}
                      className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg border border-red-500/20 transition-colors"
                      title="Удалить сервер"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Server Inner Metrics Grid */}
                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div className="p-3 bg-black/40 rounded-xl border border-white/5 flex flex-col justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">База пользователей</span>
                    <span className="text-base font-bold font-mono text-blue-400 mt-0.5">{server.total_users || 0}</span>
                    <span className="text-[9px] text-zinc-500 font-mono">Учетных записей</span>
                  </div>
                  <div className="p-3 bg-black/40 rounded-xl border border-white/5 flex flex-col justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Клиенты в 3x-ui</span>
                    <span className="text-base font-bold font-mono text-indigo-400 mt-0.5">{server.xui_total_clients || 0}</span>
                    <span className="text-[9px] text-zinc-500 font-mono">В панели XUI</span>
                  </div>
                  <div className="p-3 bg-black/40 rounded-xl border border-white/5 flex flex-col justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Онлайн сейчас</span>
                    <span className="text-base font-bold font-mono text-emerald-400 mt-0.5">{server.online_users || 0}</span>
                    <span className="text-[9px] text-emerald-500/70 font-mono">Активные туннели</span>
                  </div>
                </div>
              </motion.div>
            );
          })}

          {(!Array.isArray(servers) || servers.length === 0) && !loading && (
            <div className="text-center py-12 bg-black/20 rounded-2xl border border-dashed border-white/10">
              <Globe className="mx-auto mb-3 text-muted-foreground opacity-30" size={40} />
              <p className="text-sm font-medium text-zinc-300">Список подключенных серверов пуст</p>
              <p className="text-xs text-muted-foreground mt-1">Добавьте первую ноду с панелью 3x-ui через кнопку «Добавить сервер»</p>
            </div>
          )}
        </div>
      </motion.div>

      {diagResults.length > 0 && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-secondary/30 rounded-2xl border border-white/10 overflow-hidden"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
              <ShieldCheck size={16} /> Результаты диагностики Reality
            </h2>
            <button onClick={() => setDiagResults([])} className="text-xs text-muted-foreground hover:text-white">Скрыть</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {diagResults.map((res: any) => (
              <div key={res.id} className={`p-4 rounded-xl border ${
                res.status === 'ok' ? 'bg-green-500/5 border-green-500/20' : 
                res.status === 'error' ? 'bg-red-500/5 border-red-500/20' : 'bg-white/5 border-white/10'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm truncate">{res.name}</span>
                  {res.status === 'ok' ? <CheckCircle size={14} className="text-green-500" /> : <AlertTriangle size={14} className="text-red-500" />}
                </div>
                {res.issues?.length > 0 ? (
                  <ul className="space-y-1">
                    {res.issues.map((msg: string, i: number) => (
                      <li key={i} className="text-[10px] text-red-400 flex items-center gap-1">
                         <XCircle size={10} /> {msg}
                      </li>
                    ))}
                  </ul>
                ) : res.message ? (
                  <p className="text-[10px] text-muted-foreground">{res.message}</p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-[10px] text-green-500">Конфигруация в норме</p>
                    <div className="flex flex-col gap-0.5 mt-2 font-mono text-[9px] text-muted-foreground opacity-70">
                      <span>SNI: {res.details?.sni}</span>
                      <span>SID: {res.details?.sid}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <form onSubmit={handleSubmit} className="p-6 bg-secondary/30 rounded-2xl border border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 mb-2 font-bold text-sm text-blue-400">
                {editingId ? 'Редактирование сервера' : 'Новый сервер'}
              </div>
              <input
                placeholder="Название (например, NL-Base-1)"
                className="bg-black/20 border border-white/5 rounded-xl p-3 text-sm focus:border-blue-500/50 outline-none"
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                required
              />
              <div className="flex flex-col gap-1">
                <input
                  placeholder="IP адрес или URL"
                  className="bg-black/20 border border-white/5 rounded-xl p-3 text-sm focus:border-blue-500/50 outline-none w-full"
                  value={formData.ip}
                  onChange={e => setFormData({...formData, ip: e.target.value})}
                  required
                />
                <span className="text-[10px] text-muted-foreground px-1">Можно указать с путем: 1.2.3.4/secret</span>
              </div>
              <input
                placeholder="Домен (опционально)"
                className="bg-black/20 border border-white/5 rounded-xl p-3 text-sm focus:border-blue-500/50 outline-none"
                value={formData.domain}
                onChange={e => setFormData({...formData, domain: e.target.value})}
              />
              <input
                type="number"
                placeholder="API Порт (2053)"
                className="bg-black/20 border border-white/5 rounded-xl p-3 text-sm focus:border-blue-500/50 outline-none"
                value={formData.api_port}
                onChange={e => setFormData({...formData, api_port: e.target.value === '' ? 0 : parseInt(e.target.value)})}
              />
              <input
                placeholder="XUI Username"
                className="bg-black/20 border border-white/5 rounded-xl p-3 text-sm focus:border-blue-500/50 outline-none"
                value={formData.username}
                onChange={e => setFormData({...formData, username: e.target.value})}
                required
              />
              <input
                type="password"
                placeholder="XUI Password"
                className="bg-black/20 border border-white/5 rounded-xl p-3 text-sm focus:border-blue-500/50 outline-none"
                value={formData.password}
                onChange={e => setFormData({...formData, password: e.target.value})}
                required
              />
              <div className="md:col-span-2 flex gap-2">
                <button type="submit" className="px-6 py-2 bg-blue-600 rounded-xl text-sm font-medium">
                  {editingId ? 'Обновить' : 'Сохранить'}
                </button>
                <button type="button" onClick={cancelEdit} className="px-6 py-2 bg-white/5 rounded-xl text-sm">Отмена</button>
              </div>
            </form>
          </motion.div>
        )}

        {restoreModalTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#151515] border border-white/10 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl overflow-hidden"
            >
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <h3 className="font-semibold text-white text-base">Синхронизация конфигурации</h3>
                <button 
                  onClick={() => setRestoreModalTarget(null)}
                  className="text-muted-foreground hover:text-white transition-colors p-1"
                >
                  <XCircle size={18} />
                </button>
              </div>

              <div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Выберите конфигурацию (инбаунды и порты), которую вы хотите скопировать и применить на сервер <span className="text-blue-400 font-bold">{restoreModalTarget.name}</span>:
                </p>
                <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/25 rounded-lg text-[11px] text-yellow-500 leading-normal">
                  ⚠️ <strong>Внимание:</strong> Текущие инбаунды на целевом сервере будут полностью удалены и заменены на новые. Подключения пользователей будут перегенерированы по новым портам.
                </div>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1 scrollbar-thin">
                {servers
                  .filter(s => s.xui_config_state?.backup_at)
                  .map(sourceServer => {
                    const isOwn = sourceServer.id === restoreModalTarget.id;
                    const backupDate = new Date(sourceServer.xui_config_state.backup_at).toLocaleString([], {
                      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                    });
                    const count = sourceServer.xui_config_state.inbounds?.length || 0;

                    return (
                      <div 
                        key={sourceServer.id}
                        className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                          isOwn 
                            ? 'bg-blue-600/5 border-blue-500/20 hover:border-blue-500/40' 
                            : 'bg-white/5 border-white/5 hover:border-white/15'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-semibold text-white truncate">{sourceServer.name}</span>
                            {isOwn && (
                              <span className="text-[8px] bg-blue-500/25 text-blue-400 border border-blue-500/30 px-1 py-0.5 rounded font-bold uppercase tracking-wider shrink-0">Целевой</span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono">
                            <span>Бэкап: {backupDate}</span>
                            <span>•</span>
                            <span className="text-indigo-400">{count} инбаундов</span>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            const targetId = restoreModalTarget.id;
                            const sourceId = sourceServer.id;
                            setRestoreModalTarget(null);
                            cloudRestore(targetId, sourceId);
                          }}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-all shrink-0 shadow-md"
                        >
                          Выбрать
                        </button>
                      </div>
                    );
                  })}
                
                {servers.filter(s => s.xui_config_state?.backup_at).length === 0 && (
                  <div className="text-center py-6 text-muted-foreground text-xs">
                    Нет доступных бэкапов в облаке. Сначала сделайте бэкап с эталонного сервера (кнопка ☁️).
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2 border-t border-white/5">
                <button
                  onClick={() => setRestoreModalTarget(null)}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs text-white transition-all font-medium"
                >
                  Отмена
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
