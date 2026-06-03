import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Server, Plus, Globe, Settings, Trash2, CheckCircle, XCircle, Zap, RefreshCw, Activity, AlertTriangle, ShieldCheck, Cloud, CloudDownload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import axios from 'axios';
import { toast } from 'sonner';
import { AdminNav } from '@/components/admin/AdminNav';

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
  
  // Detailed diagnostic modal state variables
  const [diagServerId, setDiagServerId] = useState<string | null>(null);
  const [diagLogs, setDiagLogs] = useState<string[]>([]);
  const [diagResultsObj, setDiagResultsObj] = useState<any | null>(null);
  const [isDiagServerLoading, setIsDiagServerLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '', ip: '', domain: '', api_port: 2053, username: '', password: '', location_code: 'DE', is_default: false
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
      setFormData({ name: '', ip: '', domain: '', api_port: 2053, username: '', password: '', location_code: 'DE', is_default: false });
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
      toast.loading('Проверка соединения...', { id: 'check-conn' });
      const { data } = await axios.post(`/api/admin/servers/${id}/check`, {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      if (data.status === 'ok') {
        toast.success('Соединение установлено!', { id: 'check-conn' });
        fetchServers();
      } else {
        toast.error(`Ошибка: ${data.message}`, { id: 'check-conn' });
      }
    } catch (e: any) {
      console.error('Check connection error:', e);
      const status = e.response?.status;
      const errorData = e.response?.data?.error || e.message;
      
      if (status === 404) {
        toast.error('Маршрут /api/admin/servers/:id/check не найден на сервере.', { id: 'check-conn' });
      } else {
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

  const diagnoseSingleServer = async (id: string | number) => {
    try {
      setIsDiagServerLoading(true);
      const serverObj = servers.find(s => s.id === id);
      const serverName = serverObj?.name || 'Сервер';
      
      setDiagServerId(id.toString());
      setDiagLogs([`[Соединение] Инициализация процесса диагностики для "${serverName}"...`]);
      setDiagResultsObj(null);
      
      const { data } = await axios.post(`/api/admin/servers/${id}/diagnose`, {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
      if (data.success) {
        setDiagLogs(data.logs || []);
        setDiagResultsObj(data.results || null);
      } else {
        setDiagLogs(prev => [...prev, '❌ Сбой диагностики.', `Ошибка: ${data.message || 'Неизвестная ошибка'}`]);
      }
    } catch (e: any) {
      console.error('Diagnosis request error:', e);
      const errMsg = e.response?.data?.error || e.message || 'Не удалось связаться с сервером';
      setDiagLogs(prev => [...prev, `❌ Критическая ошибка: ${errMsg}`]);
    } finally {
      setIsDiagServerLoading(false);
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
      location_code: server.location_code || 'DE',
      is_default: !!server.is_default
    });
    setIsAdding(true);
  };

  const cancelEdit = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', ip: '', domain: '', api_port: 2053, username: '', password: '', location_code: 'DE', is_default: false });
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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2 text-white">
            <Server size={20} className="text-blue-400" /> Управление серверами
          </h2>
          <div className="text-[11px] text-muted-foreground mt-2 max-w-2xl space-y-2">
            <div>
              <p className="text-white/70"><b><RefreshCw size={10} className="inline mr-1" /> Синхронизировать юзеров:</b> Принудительная выгрузка всех клиентов из БД изинет во все активные сервера 3x-ui.</p>
              <p className="text-white/40 italic ml-4">Пример: Вы полностью переустановили XUI панель сервера, купили другой сервер или пользователи жалуются, что ключ не работает. Эта кнопка сопоставит квоты, лимиты и ключи из вашей базы с панелью.</p>
            </div>
            <div>
              <p className="text-white/70"><b><Activity size={10} className="inline mr-1" /> Диагностика Reality:</b> Проверяет доступность сервера, версию Xray и получает логи нагрузки / ОЗУ.</p>
              <p className="text-white/40 italic ml-4">Пример: Пользователи жалуются на обрывы связи ("VPN ломается"). Вы нажимаете эту кнопку, чтобы получить вывод терминала и убедиться, что серверу хватает памяти и Xray не перезагружается из-за ошибок конфигурации.</p>
            </div>
            <div>
              <p className="text-white/70"><b><Plus size={10} className="inline mr-1" /> Добавить сервер:</b> Добавляет новую ноду (IP/Домен) в пул доступных локаций.</p>
              <p className="text-white/40 italic ml-4">Пример: Вашего старого сервера (Например, Германия) стало не хватать, вы покупаете новый VPS в Нидерландах, устанавливаете туда 3x-ui и добавляете его суда для выдачи новым клиентам.</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2 w-full sm:w-auto">
          <button
            onClick={async () => {
              try {
                toast.loading('Синхронизация...', { id: 'sync' });
                const { data } = await axios.post('/api/admin/system/sync-servers', { force: true }, {
                  headers: { Authorization: `Bearer ${session?.access_token}` }
                });
                toast.success(`Синхронизировано ${data.updatedUsers} пользователей`, { id: 'sync' });
              } catch (e: any) {
                toast.error('Ошибка синхронизации: ' + (e.response?.data?.error || e.message), { id: 'sync' });
              }
            }}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 rounded-xl transition-colors font-medium text-sm flex-1 sm:flex-none border border-purple-500/20"
          >
            <RefreshCw size={18} />
            Синхронизировать юзеров
          </button>
          <button
            onClick={runDiagnostic}
            disabled={isDiagnosing}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl transition-colors font-medium text-sm flex-1 sm:flex-none border border-white/5"
          >
            {isDiagnosing ? <RefreshCw size={18} className="animate-spin" /> : <Activity size={18} />}
            Диагностика Reality
          </button>
          <button
            onClick={() => {
              if (isAdding) cancelEdit();
              else setIsAdding(true);
            }}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors font-medium text-sm flex-1 sm:flex-none"
          >
            {isAdding ? <XCircle size={18} /> : <Plus size={18} />}
            {isAdding ? 'Отмена' : 'Добавить'}
          </button>
        </div>
      </div>

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
                    <div className="flex flex-col gap-0.5 mt-2 font-mono text-[9px] text-muted-foreground opacity-70 break-all">
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
              <div className="md:col-span-2 flex items-center gap-3 px-1">
                <input
                  type="checkbox"
                  id="is_default"
                  checked={formData.is_default}
                  onChange={e => setFormData({...formData, is_default: e.target.checked})}
                  className="w-4 h-4 accent-blue-600"
                />
                <label htmlFor="is_default" className="text-sm text-muted-foreground cursor-pointer">
                  Сделать сервером по умолчанию для новых пользователей
                </label>
              </div>
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

        {diagServerId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="bg-[#0f0f0f] border border-white/10 rounded-2xl p-6 max-w-2xl w-full space-y-4 shadow-2xl overflow-hidden text-left"
            >
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <Activity size={18} className="text-blue-500 animate-pulse" />
                  <h3 className="font-semibold text-white text-base">
                    Трассировка и Диагностика: {servers.find(s => s.id.toString() === diagServerId)?.name || 'Сервер'}
                  </h3>
                </div>
                <button 
                  onClick={() => setDiagServerId(null)}
                  className="text-[#666] hover:text-white transition-colors p-1"
                >
                  <XCircle size={18} />
                </button>
              </div>

              {/* Console terminal logs */}
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground font-medium mb-1">События диагностики:</div>
                <div className="bg-black/40 border border-white/5 font-mono text-[11px] p-4 rounded-xl min-h-[160px] max-h-[220px] overflow-y-auto space-y-1 scrollbar-thin text-green-400 select-text leading-relaxed">
                  {diagLogs.map((log, index) => {
                    const isError = log.includes('❌') || log.includes('Ошибка') || log.includes('Сбой');
                    const isWarning = log.includes('⚠️');
                    const isSuccess = log.includes('✅');
                    return (
                      <div 
                        key={index} 
                        className={
                          isError ? 'text-red-400' :
                          isWarning ? 'text-yellow-400' :
                          isSuccess ? 'text-green-400' : 'text-gray-400 font-light'
                        }
                      >
                        {log}
                      </div>
                    );
                  })}
                  {isDiagServerLoading && (
                    <div className="text-blue-400 flex items-center gap-1.5 animate-pulse mt-1">
                      <RefreshCw size={12} className="animate-spin" /> Рассчитываем сетевую задержку и трассируем порты...
                    </div>
                  )}
                </div>
              </div>

              {/* Diagnostic checklist results */}
              {diagResultsObj && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                  <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">DNS Резолв</span>
                    {diagResultsObj.dns_resolved ? (
                      <CheckCircle size={18} className="text-green-500" />
                    ) : (
                      <XCircle size={18} className="text-red-500" />
                    )}
                    <span className="text-[9px] text-muted-foreground mt-1 truncate max-w-full font-mono">{diagResultsObj.dns_ip || 'n/a'}</span>
                  </div>

                  <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Порт Панели</span>
                    {diagResultsObj.port_open ? (
                      <CheckCircle size={18} className="text-green-500" />
                    ) : (
                      <XCircle size={18} className="text-red-500" />
                    )}
                    <span className="text-[9px] text-muted-foreground mt-1 font-mono">{diagResultsObj.latency_ms > 0 ? `${diagResultsObj.latency_ms}мс` : 'n/a'}</span>
                  </div>

                  <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Апи Сессия</span>
                    {diagResultsObj.login_successful ? (
                      <CheckCircle size={18} className="text-green-500" />
                    ) : (
                      <XCircle size={18} className="text-red-500" />
                    )}
                    <span className="text-[9px] text-muted-foreground mt-1 font-mono">{diagResultsObj.login_successful ? 'ОК' : 'Ошибка'}</span>
                  </div>

                  <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex flex-col items-center justify-center text-center">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">VLESS Порт</span>
                    {diagResultsObj.vless_port_open ? (
                      <CheckCircle size={18} className="text-green-500" />
                    ) : (
                      <AlertTriangle size={18} className="text-yellow-500" />
                    )}
                    <span className="text-[9px] text-muted-foreground mt-1 font-mono">{diagResultsObj.vless_port_open ? 'Открыт' : 'Закрыт'}</span>
                  </div>
                </div>
              )}

              {/* Actionable recommendations / advice section */}
              {diagResultsObj?.advice?.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-white/5 max-h-[160px] overflow-y-auto pr-1 scrollbar-thin">
                  <div className="text-xs text-blue-400 font-semibold flex items-center gap-1.5">
                    <AlertTriangle size={14} /> Рекомендации и решения проблем:
                  </div>
                  <div className="space-y-2">
                    {diagResultsObj.advice.map((item: string, i: number) => {
                      const isInfo = item.includes('💡');
                      return (
                        <div 
                          key={i} 
                          className={`p-2.5 rounded-xl text-[11px] leading-relaxed select-text text-left ${
                            isInfo 
                              ? 'bg-blue-500/5 text-blue-300 border border-blue-500/10' 
                              : 'bg-red-500/5 text-red-300 border border-red-500/10'
                          }`}
                        >
                          <p className="whitespace-pre-line">{item}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-between items-center pt-2 border-t border-white/5">
                <span className="text-[10px] text-muted-foreground font-mono">izinet-diagnostics v1.1</span>
                <button
                  type="button"
                  onClick={() => setDiagServerId(null)}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs text-white transition-all font-medium"
                >
                  Закрыть диагностику
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 gap-4">
        {Array.isArray(servers) && servers.map((server) => (
          <motion.div
            key={server.id}
            layout
            className="p-6 bg-secondary/30 rounded-2xl border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl bg-white/5 ${server.is_active ? 'text-green-500' : 'text-red-500'}`}>
                <Server size={24} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div 
                    title={healthData[server.id]?.online ? "Панель доступна" : `Нет связи с панелью: ${healthData[server.id]?.error || 'Неизвестная ошибка'}`}
                    className={`w-2 h-2 rounded-full shrink-0 cursor-help ${
                      healthData[server.id]?.online 
                        ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)] animate-pulse' 
                        : healthData[server.id]?.online === false 
                          ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]' 
                          : 'bg-gray-500'
                    }`} 
                  />
                  <h3 className="font-semibold">{server.name}</h3>
                  <span className="text-xs bg-white/5 px-2 py-0.5 rounded uppercase font-mono">{server.location_code}</span>
                  {server.is_default && (
                    <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full border border-blue-500/30 font-bold uppercase tracking-widest">Default</span>
                  )}
                  {server.xui_config_state?.backup_at && (
                    <span className="text-[9px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded-full border border-green-500/20 flex items-center gap-1">
                      <Cloud size={10} /> 
                      {new Date(server.xui_config_state.backup_at).toLocaleDateString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground font-mono truncate max-w-[200px] md:max-w-xs">{server.ip}{server.domain ? ` (${server.domain})` : ''}</p>
                
                <div className="flex items-center gap-4 mt-2">
                   <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground uppercase">База</span>
                      <span className="text-sm font-bold text-blue-400">{server.total_users || 0}</span>
                   </div>
                   <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground uppercase">X-UI</span>
                      <span className="text-sm font-bold text-indigo-400">{server.xui_total_clients || 0}</span>
                   </div>
                   <div className="flex flex-col">
                      <span className="text-[10px] text-muted-foreground uppercase">Онлайн</span>
                      <span className="text-sm font-bold text-green-400">{server.online_users || 0}</span>
                   </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-2 md:mt-0">
              <button 
                onClick={() => setRestoreModalTarget(server)}
                disabled={isRestoring === server.id || !(Array.isArray(servers) && servers.some(s => s.xui_config_state?.backup_at))}
                className="p-2 md:p-2.5 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 rounded-xl transition-colors disabled:opacity-50"
                title="Восстановить конфигурацию из облака на сервер"
              >
                {isRestoring === server.id ? <RefreshCw className="animate-spin" size={18} /> : <CloudDownload size={18} />}
              </button>
              <button 
                onClick={() => cloudBackup(server.id)}
                disabled={isBackingUp === server.id}
                className="p-2 md:p-2.5 bg-green-500/10 text-green-500 hover:bg-green-500/20 rounded-xl transition-colors disabled:opacity-50"
                title="Бэкап конфигурации в Supabase"
              >
                {isBackingUp === server.id ? <RefreshCw className="animate-spin" size={18} /> : <Cloud size={18} />}
              </button>
              <button 
                onClick={() => checkConnection(server.id)}
                disabled={isChecking === server.id}
                className="p-2 md:p-2.5 bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 rounded-xl transition-colors disabled:opacity-50"
                title="Проверить соединение"
              >
                {isChecking === server.id ? <RefreshCw className="animate-spin" size={18} /> : <Zap size={18} />}
              </button>
              <button 
                onClick={() => diagnoseSingleServer(server.id)}
                disabled={isDiagServerLoading && diagServerId === server.id.toString()}
                className="p-2 md:p-2.5 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 rounded-xl transition-colors disabled:opacity-50"
                title="Подробная трассировка и диагностика"
              >
                {isDiagServerLoading && diagServerId === server.id.toString() ? <RefreshCw className="animate-spin" size={18} /> : <Activity size={18} />}
              </button>
              <button
                onClick={() => startEdit(server)}
                className="p-2 md:p-2.5 bg-white/5 text-muted-foreground hover:bg-white/10 rounded-xl transition-colors"
                title="Редактировать"
              >
                <Settings size={18} />
              </button>
              <button
                onClick={() => toggleServer(server.id, server.is_active)}
                className={`flex-1 md:flex-none flex justify-center items-center gap-2 px-3 py-2 md:px-4 md:py-2.5 rounded-xl text-sm transition-colors ${
                  server.is_active ? 'bg-green-500/10 text-green-500 hover:bg-green-500/20' : 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                }`}
              >
                {server.is_active ? <CheckCircle size={16} /> : <XCircle size={16} />}
                {server.is_active ? 'Активен' : 'Отключен'}
              </button>
              <button
                onClick={() => deleteServer(server.id)}
                className="p-2 md:p-2.5 bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded-xl transition-colors"
                title="Удалить"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </motion.div>
        ))}

        {(!Array.isArray(servers) || servers.length === 0) && !loading && (
          <div className="text-center py-12 bg-white/5 rounded-2xl border border-dashed border-white/10">
            <Globe className="mx-auto mb-4 text-muted-foreground opacity-20" size={48} />
            <p className="text-muted-foreground">Список серверов пуст</p>
          </div>
        )}
      </div>
    </div>
  );
}
