import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Server, Plus, Globe, Settings, Trash2, CheckCircle, XCircle, Zap, RefreshCw, Activity, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import axios from 'axios';
import { toast } from 'sonner';
import { AdminNav } from '@/components/admin/AdminNav';

export default function AdminServers() {
  const { session } = useAuth();
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState<string | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagResults, setDiagResults] = useState<any[]>([]);
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
        console.error('Invalid servers data:', data);
        setServers([]);
      }
    } catch (e: any) {
      const status = e.response?.status;
      const errorData = e.response?.data?.error || e.message;
      console.error('Fetch servers error:', e);
      
      if (status === 401 || status === 403) {
        toast.error(`Доступ запрещен (Ошибка ${status}): У вас недостаточно прав администратора.`);
      } else {
        toast.error(`Ошибка загрузки серверов (${status || 'Network Error'}): ${errorData}`);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, [session]);

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl md:text-2xl font-bold font-mono tracking-tight text-blue-400 uppercase">Admin Panel</h1>
        <div className="flex items-center gap-2 w-full sm:w-auto">
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

      <AdminNav />

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
                  <h3 className="font-semibold">{server.name}</h3>
                  <span className="text-xs bg-white/5 px-2 py-0.5 rounded uppercase font-mono">{server.location_code}</span>
                  {server.is_default && (
                    <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full border border-blue-500/30 font-bold uppercase tracking-widest">Default</span>
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

            <div className="flex items-center gap-3">
              <button 
                onClick={() => checkConnection(server.id)}
                disabled={isChecking === server.id}
                className="p-2.5 bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 rounded-xl transition-colors disabled:opacity-50"
                title="Проверить соединение"
              >
                {isChecking === server.id ? <RefreshCw className="animate-spin" size={18} /> : <Zap size={18} />}
              </button>
              <button
                onClick={() => startEdit(server)}
                className="p-2.5 bg-white/5 text-muted-foreground hover:bg-white/10 rounded-xl transition-colors"
                title="Редактировать"
              >
                <Settings size={18} />
              </button>
              <button
                onClick={() => toggleServer(server.id, server.is_active)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm transition-colors ${
                  server.is_active ? 'bg-green-500/10 text-green-500 hover:bg-green-500/20' : 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                }`}
              >
                {server.is_active ? <CheckCircle size={16} /> : <XCircle size={16} />}
                {server.is_active ? 'Активен' : 'Отключен'}
              </button>
              <button
                onClick={() => deleteServer(server.id)}
                className="p-2.5 bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded-xl transition-colors"
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
