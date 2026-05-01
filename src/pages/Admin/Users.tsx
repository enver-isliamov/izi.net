import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Users, Search, Shield, UserX, UserCheck, ShieldAlert, Server } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { AdminNav } from '@/components/admin/AdminNav';

export default function AdminUsers() {
  const { session, user: currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      const [usersRes, serversRes] = await Promise.all([
        axios.get('/api/admin/users', {
          headers: { Authorization: `Bearer ${session?.access_token}` },
          params: { search }
        }),
        axios.get('/api/admin/servers', {
          headers: { Authorization: `Bearer ${session?.access_token}` }
        })
      ]);
      setUsers(usersRes.data);
      setServers(serversRes.data);
    } catch (e) {
      toast.error('Ошибка загрузки данных. Убедитесь, что бэкенд работает и VITE_API_URL указан.');
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
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/5">
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Пользователь</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Роль</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Подписка</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">VPN Сервер</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Трафик</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {Array.isArray(users) && users.map((user) => {
                const sub = user.active_subscription;
                const trafficUsedGB = sub ? (sub.traffic_used_mb / 1024).toFixed(1) : 0;
                const trafficLimitGB = sub ? (sub.traffic_limit_mb / 1024).toFixed(1) : 0;
                const expiryDate = sub ? new Date(sub.expires_at) : null;
                const isExpired = expiryDate ? expiryDate.getTime() < Date.now() : false;

                return (
                  <tr key={user.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-medium text-white/90">{user.name || 'Без имени'}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{user.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        user.role === 'superadmin' ? 'bg-red-500/10 text-red-500' : 
                        user.role === 'admin' ? 'bg-blue-500/10 text-blue-500' : 'bg-white/10 text-muted-foreground'
                      }`}>
                        {user.role === 'superadmin' ? 'Superadmin' : user.role === 'admin' ? 'Admin' : 'User'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {sub ? (
                        <div className="flex flex-col">
                          <span className={`text-[10px] font-bold uppercase tracking-tight ${isExpired ? 'text-red-400' : 'text-green-400'}`}>
                            {isExpired ? 'Истекла' : 'Активна'}
                          </span>
                          <span className="text-[10px] text-muted-foreground">До: {expiryDate?.toLocaleDateString()}</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic uppercase">Нет подписки</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {sub ? (
                        <div className="flex items-center gap-2">
                          <select 
                            className="bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[10px] outline-none text-blue-400 focus:border-blue-500/50"
                            value={sub.server_id || ''}
                            onChange={(e) => moveUserServer(user.id, e.target.value)}
                          >
                            {servers.map(s => (
                              <option key={s.id} value={s.id}>{s.name} ({s.location_code})</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground opacity-50">Не назначен</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {sub ? (
                        <div className="flex flex-col min-w-[100px]">
                          <div className="flex justify-between items-center text-[10px] font-mono mb-1">
                            <span>{trafficUsedGB} GB</span>
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
                      ) : <span className="opacity-30 text-xs">—</span>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                         {user.role !== 'admin' && user.role !== 'superadmin' ? (
                           <button 
                             onClick={() => updateUserRole(user.id, 'admin')}
                             className="p-2 bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 rounded-lg transition-all"
                             title="Сделать админом"
                           >
                             <Shield size={14} />
                           </button>
                         ) : user.role === 'admin' ? (
                           <button 
                             onClick={() => updateUserRole(user.id, 'user')}
                             className="p-2 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 rounded-lg transition-all"
                             title="Снять права админа"
                           >
                             <ShieldAlert size={14} />
                           </button>
                         ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {users.length === 0 && !loading && (
            <div className="px-6 py-12 text-center text-muted-foreground italic">
              Пользователи не найдены
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
