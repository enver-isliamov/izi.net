import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Users, Search, Shield, UserX, UserCheck, ShieldAlert, Server, History, Trash2, Key, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { AdminNav } from '@/components/admin/AdminNav';
import { UserHistoryModal } from '@/components/admin/UserHistoryModal';

export default function AdminUsers() {
  const { session, user: currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      try {
        const usersRes = await axios.get('/api/admin/users', {
          headers: { Authorization: `Bearer ${session?.access_token}` },
          params: { search }
        });
        setUsers(usersRes.data);
      } catch (userErr: any) {
        console.error('Fetch users error:', userErr);
        toast.error(`Ошибка загрузки пользователей: ${userErr.response?.data?.error || userErr.message}`);
      }

      try {
        const serversRes = await axios.get('/api/admin/servers', {
          headers: { Authorization: `Bearer ${session?.access_token}` }
        });
        setServers(serversRes.data || []);
      } catch (serverErr: any) {
        console.error('Fetch servers for users error:', serverErr);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchData();
    }, 300);
    return () => clearTimeout(timer);
  }, [search, session]);

  const updateUserRole = async (userId: string, newRole: string) => {
    if (userId === currentUser?.id) {
      toast.error('Вы не можете изменить роль самому себе');
      return;
    }
    try {
      await axios.put(`/api/admin/users/${userId}`, { role: newRole }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.success('Роль обновлена');
      fetchData();
    } catch (e) {
      toast.error('Ошибка обновления роли');
    }
  };

  const moveUserServer = async (userId: string, newServerId: string) => {
    const loadingToast = toast.loading('Перенос пользователя на новый сервер...');
    try {
      await axios.post('/api/admin/users/move-server', { userId, newServerId }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.dismiss(loadingToast);
      toast.success('Пользователь успешно перенесен');
      fetchData();
    } catch (e: any) {
      toast.dismiss(loadingToast);
      toast.error(e.response?.data?.error || 'Ошибка переноса сервера');
    }
  };

  const deleteDevice = async (userId: string, deviceId: string) => {
    if (!window.confirm('Действительно удалить устройство? Пользователь потеряет доступ с него.')) return;
    try {
      await axios.delete(`/api/admin/users/${userId}/devices/${deviceId}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.success('Устройство удалено');
      fetchData();
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Ошибка удаления устройства');
    }
  };

  const addDevice = async (userId: string) => {
    const label = window.prompt('Введите название для нового устройства (допускается пустое):');
    if (label === null) return; // cancelled
    try {
      const loadingToast = toast.loading('Добавление устройства...');
      await axios.post(`/api/admin/users/${userId}/devices`, { label }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.dismiss(loadingToast);
      toast.success('Устройство успешно добавлено');
      fetchData();
    } catch (e: any) {
      toast.dismiss();
      toast.error(e.response?.data?.error || 'Ошибка добавления устройства');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold font-mono tracking-tight text-blue-400 uppercase">Пользователи</h1>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <input
            placeholder="Email, Имя или Telegram ID..."
            className="w-full bg-secondary/30 border border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm focus:border-blue-500/50 outline-none transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <AdminNav />

      <div className="bg-secondary/30 rounded-2xl border border-white/5 overflow-hidden backdrop-blur-sm">
        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/5">
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground w-1/5">Пользователь</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground w-1/6">Роль</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground w-1/5">Подписка</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground w-1/5">Устройства</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground text-right w-1/6">Управление</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {Array.isArray(users) && users.map((user) => {
                const sub = user.active_subscription;
                const trafficUsedGB = sub ? (sub.traffic_used_mb / 1024).toFixed(1) : 0;
                const trafficLimitGB = sub ? (sub.traffic_limit_mb / 1024).toFixed(1) : 0;
                const expiryDate = sub ? new Date(sub.expires_at) : null;
                const isExpired = expiryDate ? expiryDate.getTime() < Date.now() : false;
                
                let devices = [];
                if (sub?.v2ray_config) {
                  try {
                    devices = typeof sub.v2ray_config === 'string' ? JSON.parse(sub.v2ray_config) : sub.v2ray_config;
                    if (!Array.isArray(devices)) devices = [];
                  } catch (e) { }
                }

                return (
                  <tr key={user.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4 text-nowrap align-top">
                      <div className="flex flex-col">
                        <span className="font-medium text-white/90">{user.name || 'Без имени'}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{user.email}</span>
                        <span className="font-mono text-xs text-blue-400 font-bold mt-1">Баланс: {user.balance || 0} ₽</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="flex flex-col items-start gap-1.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          user.role === 'superadmin' ? 'bg-red-500/10 text-red-500' : 
                          user.role === 'admin' ? 'bg-blue-500/10 text-blue-500' : 'bg-white/10 text-muted-foreground'
                        }`}>
                          {user.role === 'superadmin' ? 'Superadmin' : user.role === 'admin' ? 'Admin' : 'User'}
                        </span>
                        {user.role !== 'admin' && user.role !== 'superadmin' ? (
                          <button onClick={() => updateUserRole(user.id, 'admin')} className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">Дать админа</button>
                        ) : user.role === 'admin' ? (
                          <button onClick={() => updateUserRole(user.id, 'user')} className="text-[10px] text-yellow-500 hover:text-yellow-400 transition-colors">Снять админа</button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      {sub ? (
                        <div className="flex flex-col min-w-[120px] space-y-2">
                           <div className="flex flex-col text-xs">
                             <div className="flex items-center gap-1.5 font-bold uppercase tracking-wide text-[10px] mb-1">
                               <span className={isExpired ? 'text-red-400' : 'text-primary'}>
                                 {sub.plan_type || 'Custom'}
                               </span>
                               <span className="text-white/20">•</span>
                               <span className={isExpired ? 'text-red-400' : 'text-green-400'}>
                                 {isExpired ? 'Истекла' : 'Активна'}
                               </span>
                             </div>
                             <span className="text-[10px] text-muted-foreground">До {expiryDate?.toLocaleDateString()}</span>
                           </div>
                           <div className="flex flex-col min-w-[100px] pt-1">
                            <div className="flex justify-between items-center text-[10px] font-mono mb-1">
                              <span>{trafficUsedGB}</span>
                              <span className="text-muted-foreground">/ {trafficLimitGB} GB</span>
                            </div>
                            <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                               <div 
                                 className={`h-full transition-all duration-500 ${
                                   (Number(trafficUsedGB) / Number(trafficLimitGB)) > 0.9 ? 'bg-red-500' : 'bg-blue-500'
                                 }`}
                                 style={{ width: `${Math.min(100, (Number(trafficUsedGB) / Number(trafficLimitGB)) * 100)}%` }}
                               />
                            </div>
                          </div>
                        </div>
                      ) : <span className="opacity-30 text-xs">—</span>}
                    </td>
                    <td className="px-6 py-4 align-top">
                      {sub && devices.length > 0 ? (
                        <div className="flex flex-col gap-2 min-w-[130px]">
                          {devices.map((device: any) => (
                            <div key={device.id} className="flex justify-between items-center group">
                              <div className="flex items-center gap-2 overflow-hidden max-w-[110px]">
                                <span className="relative flex h-2 w-2 shrink-0">
                                  {!isExpired && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
                                  <span className={`relative inline-flex rounded-full h-2 w-2 ${isExpired ? 'bg-red-500' : 'bg-green-500'}`}></span>
                                </span>
                                <span className="text-[10px] font-medium text-white truncate" title={device.email || device.id}>{device.label || 'Устройство'}</span>
                              </div>
                              <button
                                onClick={() => deleteDevice(user.id, device.id)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 p-0.5 rounded transition-all shrink-0"
                                title="Удалить устройство"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => addDevice(user.id)}
                            className="text-[10px] text-blue-400 hover:text-blue-300 mt-1 flex items-center gap-1 opacity-50 hover:opacity-100 transition-all"
                          >
                            <Plus size={10} /> Добавить
                          </button>
                        </div>
                      ) : (
                        sub ? (
                          <button
                            onClick={() => addDevice(user.id)}
                            className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 opacity-50 hover:opacity-100 transition-all"
                          >
                            <Plus size={10} /> Добавить
                          </button>
                        ) : <span className="opacity-30 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 border-l border-white/5 align-top">
                      <div className="flex flex-col items-end justify-start gap-2 h-full">
                         <button 
                           onClick={() => {
                             setSelectedUser(user);
                             setIsHistoryOpen(true);
                           }}
                           className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white rounded-lg transition-all text-[10px]"
                           title="История транзакций"
                         >
                           <History size={12} /> История
                         </button>
                         {sub && (
                           <select 
                             className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] outline-none text-blue-400 focus:border-blue-500/50 w-full"
                             value={sub.server_id || ''}
                             onChange={(e) => moveUserServer(user.id, e.target.value)}
                           >
                             <option value="" disabled>Сервер не выбран</option>
                             {servers.map(s => (
                               <option key={s.id} value={s.id}>{s.name} ({s.location_code})</option>
                             ))}
                           </select>
                         )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards View */}
        <div className="md:hidden divide-y divide-white/5">
          {Array.isArray(users) && users.map((user) => {
            const sub = user.active_subscription;
            const trafficUsedGB = sub ? (sub.traffic_used_mb / 1024).toFixed(1) : 0;
            const trafficLimitGB = sub ? (sub.traffic_limit_mb / 1024).toFixed(1) : 0;
            const expiryDate = sub ? new Date(sub.expires_at) : null;
            const isExpired = expiryDate ? expiryDate.getTime() < Date.now() : false;
            
            let devices = [];
            if (sub?.v2ray_config) {
              try {
                devices = typeof sub.v2ray_config === 'string' ? JSON.parse(sub.v2ray_config) : sub.v2ray_config;
                if (!Array.isArray(devices)) devices = [];
              } catch (e) { }
            }

            return (
              <div key={user.id} className="p-4 space-y-4">
                <div className="flex justify-between items-start">
                  <div className="flex flex-col">
                    <span className="font-bold text-white text-base">{user.name || 'Без имени'}</span>
                    <span className="text-xs text-muted-foreground font-mono">{user.email}</span>
                    <span className="font-mono text-xs text-blue-400 font-bold mt-1">Баланс: {user.balance || 0} ₽</span>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                      user.role === 'superadmin' ? 'bg-red-500/10 text-red-500' : 
                      user.role === 'admin' ? 'bg-blue-500/10 text-blue-500' : 'bg-white/10 text-muted-foreground'
                    }`}>
                      {user.role === 'superadmin' ? 'Superadmin' : user.role === 'admin' ? 'Admin' : 'User'}
                    </span>
                    {user.role !== 'admin' && user.role !== 'superadmin' ? (
                      <button onClick={() => updateUserRole(user.id, 'admin')} className="text-[10px] text-blue-400 hover:text-blue-300">Дать админа</button>
                    ) : user.role === 'admin' ? (
                      <button onClick={() => updateUserRole(user.id, 'user')} className="text-[10px] text-yellow-500 hover:text-yellow-400">Снять админа</button>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-2 bg-white/5 rounded-xl border border-white/5 flex flex-col pt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-muted-foreground uppercase">Подписка</span>
                    </div>
                    {sub ? (
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1">
                          <span className={`text-[10px] font-bold tracking-wide uppercase ${isExpired ? 'text-red-400' : 'text-primary'}`}>{sub.plan_type || 'Custom'}</span>
                          <span className="text-white/20">•</span>
                          <span className={`text-[10px] font-bold ${isExpired ? 'text-red-400' : 'text-green-400'}`}>
                            {isExpired ? 'Истекла' : 'Активна'}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">До {expiryDate?.toLocaleDateString()}</span>
                      </div>
                    ) : <span className="text-[10px] italic text-muted-foreground mt-0.5">Нет подписки</span>}
                  </div>

                  <div className="p-2 bg-white/5 rounded-xl border border-white/5 flex flex-col justify-center gap-2">
                    <button 
                      onClick={() => {
                        setSelectedUser(user);
                        setIsHistoryOpen(true);
                      }}
                      className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-white/5 text-white hover:bg-white/10 rounded-lg transition-all text-xs"
                    >
                      <History size={12} /> История
                    </button>
                  </div>
                </div>

                {sub && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-1 p-2 bg-white/5 rounded-xl border border-white/5">
                      <div className="flex justify-between items-center text-[10px] font-mono mb-1">
                        <span className="text-muted-foreground uppercase">Трафик</span>
                      </div>
                      <div className="flex justify-between items-center text-[10px] font-mono mb-1">
                        <span className="text-white font-bold">{trafficUsedGB}</span>
                        <span className="text-muted-foreground">/ {trafficLimitGB} GB</span>
                      </div>
                      <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-500 ${(Number(trafficUsedGB) / Number(trafficLimitGB)) > 0.9 ? 'bg-red-500' : 'bg-blue-500'}`}
                          style={{ width: `${Math.min(100, (Number(trafficUsedGB) / Number(trafficLimitGB)) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="col-span-1 p-2 bg-white/5 rounded-xl border border-white/5">
                      <p className="text-[10px] text-muted-foreground uppercase mb-1">Вкл. Сервер</p>
                      <select 
                        className="w-full bg-[#0a0c10] border border-white/10 p-1.5 rounded text-[10px] outline-none text-blue-400 focus:ring-0"
                        value={sub.server_id || ''}
                        onChange={(e) => moveUserServer(user.id, e.target.value)}
                      >
                        {servers.map(s => (
                          <option key={s.id} value={s.id} className="bg-[#0f1115] text-white">
                            {s.location_code} - {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {sub && (
                  <div className="p-3 bg-white/5 rounded-xl border border-white/5 space-y-2">
                    <div className="flex justify-between items-center">
                      <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1"><Key size={12}/> Устройства ({devices.length})</p>
                      <button
                        onClick={() => addDevice(user.id)}
                        className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-all"
                      >
                        <Plus size={10} /> Добавить
                      </button>
                    </div>
                    {devices.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {devices.map((device: any) => (
                          <div key={device.id} className="flex justify-between items-center bg-[#0a0c10] p-2 rounded-lg border border-white/5">
                            <div className="flex items-center gap-2 overflow-hidden mr-2">
                              <span className="relative flex h-2 w-2 shrink-0">
                                {!isExpired && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>}
                                <span className={`relative inline-flex rounded-full h-2 w-2 ${isExpired ? 'bg-red-500' : 'bg-green-500'}`}></span>
                              </span>
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-white truncate max-w-[120px]">{device.label || 'Устройство'}</span>
                                <span className="text-[10px] font-mono text-muted-foreground truncate">{device.email || device.id}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => deleteDevice(user.id, device.id)}
                              className="text-muted-foreground hover:text-red-400 p-1.5 rounded transition-colors flex-shrink-0"
                              title="Удалить устройство"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic text-center py-2">
                        Нет устройств
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
          {users.length === 0 && !loading && (
            <div className="px-6 py-12 text-center text-muted-foreground italic">
              Пользователи не найдены
            </div>
          )}
        </div>

        <UserHistoryModal 
          user={selectedUser}
          isOpen={isHistoryOpen}
          onClose={() => setIsHistoryOpen(false)}
        />
      </div>
    );
}
