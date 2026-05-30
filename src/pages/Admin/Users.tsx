import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Users, Search, Shield, UserX, UserCheck, ShieldAlert, Server, History, Trash2, Key, Plus, QrCode, RefreshCw, Copy, UserPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { cn, copyToClipboard } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminNav } from '@/components/admin/AdminNav';
import { UserHistoryModal } from '@/components/admin/UserHistoryModal';
import { CreateUserModal } from '@/components/admin/CreateUserModal';
import { QRCodeSVG } from 'qrcode.react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export default function AdminUsers() {
  const { session, user: currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [balanceEditUser, setBalanceEditUser] = useState<any>(null);
  const [balanceEditValue, setBalanceEditValue] = useState<string>('');
  
  const [subCreateUser, setSubCreateUser] = useState<any>(null);
  const [subCreateData, setSubCreateData] = useState({
    serverId: '',
    periodMonths: '1',
    trafficLimitGb: '0'
  });

  useEffect(() => {
    if (servers.length > 0 && !subCreateData.serverId) {
      setSubCreateData(prev => ({ ...prev, serverId: servers[0].id }));
    }
  }, [servers]);

  const handleCreateSub = async () => {
    if (!subCreateUser) return;
    try {
      const payload = {
        ...subCreateData,
        trafficLimitMb: subCreateData.trafficLimitGb ? String(parseFloat(subCreateData.trafficLimitGb) * 1024) : '0'
      };
      await axios.post(`/api/admin/users/${subCreateUser.id}/subscription`, payload, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.success('Подписка успешно выдана');
      setSubCreateUser(null);
      fetchData();
    } catch (err: any) {
      toast.error('Ошибка: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleUpdateBalance = async () => {
    if (!balanceEditUser) return;
    try {
      const val = parseFloat(balanceEditValue);
      if (isNaN(val)) throw new Error('Неверное число');
      await axios.put(`/api/admin/users/${balanceEditUser.id}`, { balance: val }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.success('Баланс обновлен');
      setBalanceEditUser(null);
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.error || err.message || 'Ошибка обновления баланса');
    }
  };
  
  // QR States
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [qrMode, setQrMode] = useState<'key' | 'sub'>('sub');
  const [qrInfo, setQrInfo] = useState<{ key?: string; sub?: string; value?: string } | null>(null);
  const [qrTitle, setQrTitle] = useState<string>('');
  const [qrType, setQrType] = useState<'device' | 'subscription'>('device');
  const [sortRule, setSortRule] = useState('newest');

  const sortedUsers = [...users].sort((a, b) => {
    if (sortRule === 'balance_desc') return (b.balance || 0) - (a.balance || 0);
    if (sortRule === 'balance_asc') return (a.balance || 0) - (b.balance || 0);
    if (sortRule === 'role') {
      const roleWeight: any = { superadmin: 3, admin: 2, user: 1 };
      return (roleWeight[b.role] || 0) - (roleWeight[a.role] || 0);
    }
    return 0; // newest/default
  });

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

  const handleRegenerateDevice = async (userId: string, deviceId: string) => {
    if (!window.confirm('Вы уверены, что хотите перегенерировать ключ? Старый ключ перестанет работать.')) return;
    
    try {
      const res = await axios.post(`/api/admin/users/${userId}/devices/${deviceId}/regenerate`, {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
      if (res.data.success) {
        toast.success("Ключ успешно обновлен");
        fetchData(); // Refresh data to show new config in QR modal if opened
      }
    } catch (err: any) {
      console.error('Regeneration error:', err);
      toast.error(`Ошибка: ${err.response?.data?.error || err.message}`);
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

  const toggleUserProStatus = async (userId: string, currentProStatus: boolean) => {
    try {
      await axios.put(`/api/admin/users/${userId}`, { is_pro: !currentProStatus }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.success(currentProStatus ? 'Pro статус снят' : 'Pro статус выдан');
      fetchData();
    } catch (e) {
      toast.error('Ошибка обновления Pro статуса');
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

  const moveDeviceServer = async (userId: string, deviceId: string, newServerId: string) => {
    try {
      const loadingToast = toast.loading('Перенос устройства...');
      await axios.put(`/api/admin/users/${userId}/devices/${deviceId}/move`, { newServerId }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.dismiss(loadingToast);
      toast.success('Устройство успешно перенесено');
      fetchData();
    } catch (e: any) {
      toast.dismiss();
      toast.error(e.response?.data?.error || 'Ошибка переноса устройства');
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
        <div></div>
        <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
          <select
            value={sortRule}
            onChange={(e) => setSortRule(e.target.value)}
            className="bg-secondary/30 border border-white/5 rounded-xl py-2 px-3 text-sm focus:border-blue-500/50 outline-none transition-all"
          >
            <option value="newest">Сначала новые</option>
            <option value="balance_desc">Баланс (убыв)</option>
            <option value="balance_asc">Баланс (возр)</option>
            <option value="role">По роли</option>
          </select>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <input
              placeholder="Email, Имя или Telegram ID..."
              className="w-full bg-secondary/30 border border-white/5 rounded-xl py-2 pl-10 pr-4 text-sm focus:border-blue-500/50 outline-none transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300 rounded-xl transition-colors shrink-0 whitespace-nowrap text-sm font-bold border border-blue-500/20"
          >
            <UserPlus size={16} /> {/* don't forget to import UserPlus */}
            Создать юзера
          </button>
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
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground w-auto">Устройства / Трафик</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-[10px] text-muted-foreground text-right w-1/6">Управление</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                /* Skeleton rows */
                [1, 2, 3, 4, 5].map((i) => (
                  <tr key={i}>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-full bg-white/5" />
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-32 bg-white/5" />
                          <Skeleton className="h-3 w-48 bg-white/5" />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Skeleton className="h-6 w-16 rounded-full bg-white/5" />
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-full bg-white/5" />
                        <Skeleton className="h-3 w-2/3 bg-white/5" />
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        <Skeleton className="h-8 w-8 rounded-lg bg-white/5" />
                        <Skeleton className="h-8 w-8 rounded-lg bg-white/5" />
                      </div>
                    </td>
                  </tr>
                ))
              ) : Array.isArray(sortedUsers) && sortedUsers.length > 0 ? (
                sortedUsers.map((user) => {
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
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white/90">{user.name || 'Без имени'}</span>
                          {sub && (
                            <button
                              onClick={() => {
                                const subUrl = `${window.location.origin}/api/sub/${sub.id}`;
                                setQrInfo({ value: subUrl, sub: subUrl });
                                setQrType('subscription');
                                setQrMode('sub');
                                setQrTitle(`Подписка: ${user.email}`);
                                setIsQrOpen(true);
                              }}
                              className="p-1 text-muted-foreground hover:text-primary transition-colors"
                              title="QR Подписки"
                            >
                              <QrCode size={12} />
                            </button>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono">{user.email}</span>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-xs text-blue-400 font-bold">Баланс: {user.balance || 0} ₽</span>
                          <button
                            onClick={() => {
                              setBalanceEditUser(user);
                              setBalanceEditValue(String(user.balance || 0));
                            }}
                            className="text-muted-foreground hover:text-blue-400 transition-colors bg-white/5 rounded px-1.5 py-0.5 text-[10px]"
                            title="Изменить баланс"
                          >
                            Изм.
                          </button>
                        </div>
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

                        <div className="mt-2 pt-2 border-t border-white/5 w-full space-y-1">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                            user.is_pro ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-white/5 text-muted-foreground'
                          }`}>
                            {user.is_pro ? '👑 Pro Аккаунт' : 'Обычный'}
                          </span>
                          <button 
                            onClick={() => toggleUserProStatus(user.id, !!user.is_pro)} 
                            className="block text-[10px] text-purple-400 hover:text-purple-300 transition-colors font-semibold"
                          >
                            {user.is_pro ? 'Снять Pro' : 'Сделать Pro'}
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      {sub && devices.length > 0 ? (
                        <div className="flex flex-col gap-2 min-w-[200px]">
                          {devices.map((device: any) => {
                            const deviceUsedGB = ((device.trafficUsedBytes || 0) / (1024 * 1024 * 1024));
                            const devExpiry = new Date(device.expiresAt || +(sub?.expires_at || 0));
                            const devIsExpired = devExpiry.getTime() < Date.now();
                            // Heuristic for online: more than 0 bytes used and refreshed within last 2 hours (ideally we'd have a heartbeat, but for now we look at traffic activity)
                            const isOnlineDevice = device.trafficUsedBytes > 0 && !devIsExpired;
                            
                            return (
                              <div key={device.id} className="flex flex-col gap-1.5 p-2 bg-black/20 rounded-lg group border border-white/5 relative">
                                <div className="flex justify-between items-center w-full">
                                  <div className="flex items-center gap-2 overflow-hidden flex-[1] min-w-[70px]">
                                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                                      {devIsExpired ? (
                                        <span className="relative inline-flex rounded-full h-full w-full bg-red-500 shadow-[0_0_5px_red]"></span>
                                      ) : isOnlineDevice ? (
                                        <>
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-full w-full bg-green-500 shadow-[0_0_5px_rgba(0,255,0,0.5)]"></span>
                                        </>
                                      ) : (
                                        <span className="relative inline-flex rounded-full h-full w-full border border-blue-400 bg-blue-500/20" title="Offline"></span>
                                      )}
                                    </span>
                                    <span className="text-xs font-bold text-white truncate w-full pr-1" title={device.email || device.id}>{device.label || 'Устройство'}</span>
                                  </div>
                                  
                                  <div className="flex flex-col flex-[1.5] min-w-[80px] shrink-0 mx-1 gap-1">
                                    <div className="flex justify-between items-center text-[9px] font-mono leading-none">
                                      <span className={cn("text-white/80", devIsExpired && "text-red-400")} title={`${deviceUsedGB.toFixed(2)} GB / ${trafficLimitGB} GB`}>
                                        {deviceUsedGB.toFixed(1)}<span className="text-muted-foreground text-[8px]">/{trafficLimitGB}</span>
                                      </span>
                                      <span className="text-[8px] text-muted-foreground break-keep">{devExpiry.toLocaleDateString()}</span>
                                    </div>
                                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                      <div 
                                        className={`h-full transition-all duration-500 ${
                                          devIsExpired ? 'bg-red-500' : (deviceUsedGB / Number(trafficLimitGB)) > 0.9 ? 'bg-yellow-500' : 'bg-primary'
                                        }`}
                                        style={{ width: `${trafficLimitGB !== "0.0" ? Math.min(100, (deviceUsedGB / Number(trafficLimitGB)) * 100) : 0}%` }}
                                      />
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-0.5 shrink-0 ml-1">
                                    <button
                                      onClick={() => {
                                        const deviceSubUrl = `${window.location.origin}/api/sub/${sub.id}?deviceId=${device.id}`;
                                        setQrInfo({ key: device.config, sub: deviceSubUrl });
                                        setQrType('device'); setQrMode('sub'); setQrTitle(`Ключ: ${device.label || 'Устройство'}`);
                                        setIsQrOpen(true);
                                      }}
                                      className="text-muted-foreground hover:text-primary p-1 rounded-md hover:bg-white/10 transition-colors" title="QR Ключ"
                                    >
                                      <QrCode size={12} />
                                    </button>
                                    <button
                                      onClick={() => handleRegenerateDevice(user.id, device.id)}
                                      className="text-muted-foreground hover:text-green-400 p-1 rounded-md hover:bg-white/10 transition-colors" title="Перегенерировать ключ"
                                    >
                                      <RefreshCw size={12} />
                                    </button>
                                    <button
                                      onClick={() => deleteDevice(user.id, device.id)}
                                      className="text-muted-foreground hover:text-red-400 p-1 rounded-md hover:bg-white/10 transition-colors" title="Удалить устройство"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          <button
                            onClick={() => addDevice(user.id)}
                            className="text-[10px] text-blue-400 hover:text-blue-300 mt-1 flex items-center justify-center gap-1 opacity-60 hover:opacity-100 transition-all border border-blue-500/20 bg-blue-500/10 rounded-lg py-2"
                          >
                            <Plus size={12} /> Добавить устройство
                          </button>
                        </div>
                      ) : (
                        sub ? (
                          <div className="flex flex-col items-start gap-2">
                            <span className="text-xs text-muted-foreground italic">Нет устройств</span>
                            <button
                              onClick={() => addDevice(user.id)}
                              className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 opacity-80 hover:opacity-100 transition-all border border-blue-500/20 bg-blue-500/10 rounded px-2 py-1"
                            >
                              <Plus size={10} /> Добавить
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-start gap-2">
                            <span className="opacity-30 text-xs">—</span>
                            <button
                              onClick={() => setSubCreateUser(user)}
                              className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 opacity-80 hover:opacity-100 transition-all border border-blue-500/20 bg-blue-500/10 rounded px-2 py-1"
                            >
                              <Plus size={10} /> Выдать подписку
                            </button>
                          </div>
                        )
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
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground italic">
                  Пользователи не найдены
                </td>
              </tr>
            )}
          </tbody>
          </table>
        </div>

        {/* Mobile Cards View */}
        <div className="md:hidden divide-y divide-white/5">
          {Array.isArray(sortedUsers) && sortedUsers.map((user) => {
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
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-base">{user.name || 'Без имени'}</span>
                      {sub && (
                        <button
                          onClick={() => {
                            const subUrl = `${window.location.origin}/api/sub/${sub.id}`;
                            setQrInfo({ value: subUrl, sub: subUrl });
                            setQrType('subscription');
                            setQrMode('sub');
                            setQrTitle(`Подписка: ${user.email}`);
                            setIsQrOpen(true);
                          }}
                          className="p-1.5 text-muted-foreground hover:text-primary transition-colors bg-white/5 rounded-lg"
                        >
                          <QrCode size={14} />
                        </button>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{user.email}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono text-xs text-blue-400 font-bold">Баланс: {user.balance || 0} ₽</span>
                      <button
                        onClick={() => {
                          setBalanceEditUser(user);
                          setBalanceEditValue(String(user.balance || 0));
                        }}
                        className="text-muted-foreground hover:text-blue-400 transition-colors bg-white/5 rounded px-1.5 py-0.5 text-[10px]"
                        title="Изменить баланс"
                      >
                        Изм.
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0 text-right">
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

                    <div className="mt-1.5 pt-1.5 border-t border-white/5 flex flex-col items-end gap-1">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                        user.is_pro ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-white/5 text-muted-foreground'
                      }`}>
                        {user.is_pro ? '👑 Pro' : 'Обычный'}
                      </span>
                      <button 
                        onClick={() => toggleUserProStatus(user.id, !!user.is_pro)} 
                        className="text-[9px] text-purple-400 hover:text-purple-300 transition-colors font-semibold"
                      >
                        {user.is_pro ? 'Снять Pro' : 'Сделать Pro'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex justify-end">
                    <button 
                      onClick={() => {
                        setSelectedUser(user);
                        setIsHistoryOpen(true);
                      }}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white/5 text-white hover:bg-white/10 rounded-lg transition-all text-xs w-full"
                    >
                      <History size={12} /> История Тразакций
                    </button>
                  </div>
                  
                  {sub ? (
                    <div className="p-3 bg-white/5 rounded-xl border border-white/5 space-y-3">
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
                          {devices.map((device: any) => {
                            const deviceUsedGB = ((device.trafficUsedBytes || 0) / (1024 * 1024 * 1024));
                            const devExpiry = new Date(device.expiresAt || +(sub?.expires_at || 0));
                            const devIsExpired = devExpiry.getTime() < Date.now();
                            const isOnlineDevice = device.trafficUsedBytes > 0 && !devIsExpired;
                            
                            return (
                              <div key={device.id} className="flex flex-col gap-1.5 p-2 bg-[#0a0c10] rounded-lg group border border-white/5 relative">
                                <div className="flex justify-between items-center w-full">
                                  <div className="flex items-center gap-2 overflow-hidden flex-[1] min-w-[70px]">
                                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                                      {devIsExpired ? (
                                        <span className="relative inline-flex rounded-full h-full w-full bg-red-500 shadow-[0_0_5px_red]"></span>
                                      ) : isOnlineDevice ? (
                                        <>
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-full w-full bg-green-500 shadow-[0_0_5px_rgba(0,255,0,0.5)]"></span>
                                        </>
                                      ) : (
                                        <span className="relative inline-flex rounded-full h-full w-full border border-blue-400 bg-blue-500/20" title="Offline"></span>
                                      )}
                                    </span>
                                    <span className="text-xs font-bold text-white truncate w-full pr-1" title={device.email || device.id}>{device.label || 'Устройство'}</span>
                                  </div>
                                  
                                  <div className="flex flex-col flex-[1.5] min-w-[80px] shrink-0 mx-1 gap-1">
                                    <div className="flex justify-between items-center text-[9px] font-mono leading-none">
                                      <span className={cn("text-white/80", devIsExpired && "text-red-400")} title={`${deviceUsedGB.toFixed(2)} GB / ${trafficLimitGB} GB`}>
                                        {deviceUsedGB.toFixed(1)}<span className="text-muted-foreground text-[8px]">/{trafficLimitGB}</span>
                                      </span>
                                      <span className="text-[8px] text-muted-foreground break-keep">{devExpiry.toLocaleDateString()}</span>
                                    </div>
                                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                                      <div 
                                        className={`h-full transition-all duration-500 ${
                                          devIsExpired ? 'bg-red-500' : (deviceUsedGB / Number(trafficLimitGB)) > 0.9 ? 'bg-yellow-500' : 'bg-primary'
                                        }`}
                                        style={{ width: `${trafficLimitGB !== "0.0" ? Math.min(100, (deviceUsedGB / Number(trafficLimitGB)) * 100) : 0}%` }}
                                      />
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-0.5 shrink-0 ml-1">
                                    <button
                                      onClick={() => {
                                        const deviceSubUrl = `${window.location.origin}/api/sub/${sub.id}?deviceId=${device.id}`;
                                        setQrInfo({ key: device.config, sub: deviceSubUrl });
                                        setQrType('device'); setQrMode('sub'); setQrTitle(`Ключ: ${device.label || 'Устройство'}`);
                                        setIsQrOpen(true);
                                      }}
                                      className="text-muted-foreground hover:text-primary p-1.5 rounded-md hover:bg-white/10 transition-colors" title="QR Ключ"
                                    >
                                      <QrCode size={12} />
                                    </button>
                                    <button
                                      onClick={() => handleRegenerateDevice(user.id, device.id)}
                                      className="text-muted-foreground hover:text-green-400 p-1.5 rounded-md hover:bg-white/10 transition-colors" title="Перегенерировать ключ"
                                    >
                                      <RefreshCw size={12} />
                                    </button>
                                    <button
                                      onClick={() => deleteDevice(user.id, device.id)}
                                      className="text-muted-foreground hover:text-red-400 p-1.5 rounded-md hover:bg-white/10 transition-colors" title="Удалить устройство"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground italic text-center py-2">
                          Нет устройств
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-white/5 flex flex-col gap-2">
                       <button
                         onClick={() => setSubCreateUser(user)}
                         className="w-full text-xs text-blue-400 hover:text-blue-300 flex items-center justify-center gap-1 opacity-80 hover:opacity-100 transition-all border border-blue-500/20 bg-blue-500/10 rounded-xl py-2"
                       >
                         <Plus size={14} /> Выдать подписку
                       </button>
                    </div>
                  )}
                </div>
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

        <CreateUserModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          servers={servers}
          onSuccess={fetchData}
        />

        {/* Sub Create Dialog */}
        <Dialog open={!!subCreateUser} onOpenChange={(open) => !open && setSubCreateUser(null)}>
          <DialogContent className="sm:max-w-[400px] bg-[#0a0c10] border-white/5 p-6">
            <DialogHeader className="mb-4">
              <DialogTitle className="text-xl font-bold text-white tracking-tight">Выдача подписки</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">Добавить подписку ({subCreateUser?.email})</p>
            </DialogHeader>
            <div className="space-y-4">
               <div className="space-y-2">
                 <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Локация</label>
                 <select
                   value={subCreateData.serverId}
                   onChange={(e) => setSubCreateData(prev => ({ ...prev, serverId: e.target.value }))}
                   className="w-full bg-black/40 border border-white/5 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500/50"
                 >
                   {servers.map(s => (
                     <option key={s.id} value={s.id}>{s.name} ({s.location_code})</option>
                   ))}
                 </select>
               </div>

               <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-2">
                   <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Срок (мес)</label>
                   <input
                     type="number"
                     value={subCreateData.periodMonths}
                     onChange={(e) => setSubCreateData(prev => ({ ...prev, periodMonths: e.target.value }))}
                     className="w-full bg-black/40 border border-white/5 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500/50"
                     min="1"
                   />
                 </div>
                 <div className="space-y-2">
                   <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Трафик (ГБ)</label>
                   <input
                     type="number"
                     value={subCreateData.trafficLimitGb}
                     onChange={(e) => setSubCreateData(prev => ({ ...prev, trafficLimitGb: e.target.value }))}
                     className="w-full bg-black/40 border border-white/5 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500/50"
                     min="0"
                     step="0.1"
                     placeholder="0 = безлимит"
                   />
                 </div>
               </div>
              <div className="flex gap-2 justify-end pt-4">
                <Button variant="ghost" className="text-muted-foreground" onClick={() => setSubCreateUser(null)}>
                  Отмена
                </Button>
                <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleCreateSub}>
                  Создать (1 устройство)
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Balance Edit Dialog */}
        <Dialog open={!!balanceEditUser} onOpenChange={(open) => !open && setBalanceEditUser(null)}>
          <DialogContent className="sm:max-w-[400px] bg-[#0a0c10] border-white/5 p-6">
            <DialogHeader className="mb-4">
              <DialogTitle className="text-xl font-bold text-white tracking-tight">Изменить баланс</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">Пользователь: {balanceEditUser?.email}</p>
            </DialogHeader>
            <div className="space-y-4">
              <input
                type="number"
                value={balanceEditValue}
                onChange={(e) => setBalanceEditValue(e.target.value)}
                className="w-full bg-black/40 border border-white/5 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500/50"
                placeholder="Сумма"
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" className="text-muted-foreground" onClick={() => setBalanceEditUser(null)}>
                  Отмена
                </Button>
                <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleUpdateBalance}>
                  Сохранить
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

         {/* QR Code Dialog */}
         <Dialog open={isQrOpen} onOpenChange={setIsQrOpen}>
           <DialogContent className="sm:max-w-[400px] bg-[#0a0c10] border-white/5 flex flex-col items-center p-8">
             <DialogHeader className="w-full text-center mb-6">
               <DialogTitle className="text-xl font-bold text-white tracking-tight">{qrTitle}</DialogTitle>
               <p className="text-sm text-muted-foreground mt-1">
                 {qrMode === 'sub' 
                   ? 'Универсальная ссылка для Hiddify / V2Box' 
                   : 'Индивидуальный ключ VLESS'}
               </p>
             </DialogHeader>

             {qrInfo?.key && qrInfo?.sub && (
               <div className="flex p-1 bg-white/5 rounded-xl mb-6 w-full max-w-[280px] border border-white/5">
                 <button
                   onClick={() => setQrMode('sub')}
                   className={cn(
                     "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                     qrMode === 'sub' ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-white"
                   )}
                 >
                   Подписка
                 </button>
                 <button
                   onClick={() => setQrMode('key')}
                   className={cn(
                     "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                     qrMode === 'key' ? "bg-blue-600 text-white" : "text-muted-foreground hover:text-white"
                   )}
                 >
                   Ключ
                 </button>
               </div>
             )}
             
             <div className="bg-white p-6 rounded-3xl shadow-2xl shadow-blue-500/10">
               <QRCodeSVG 
                 value={qrMode === 'sub' ? (qrInfo?.sub || qrInfo?.value || '') : (qrInfo?.key || qrInfo?.value || '')} 
                 size={240}
                 level="M"
                 includeMargin={false}
                 bgColor="#FFFFFF"
                 fgColor="#000000"
               />
             </div>
             
             <div className="mt-8 w-full space-y-3">
               <div className="flex items-center gap-2">
                 <div className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-3 font-mono text-[10px] truncate text-muted-foreground">
                   {qrMode === 'sub' ? (qrInfo?.sub || qrInfo?.value) : (qrInfo?.key || qrInfo?.value)}
                 </div>
                 <Button 
                   size="icon" 
                   variant="secondary" 
                   className="rounded-xl bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 shrink-0 h-10 w-10"
                   onClick={async () => {
                     const val = qrMode === 'sub' ? (qrInfo?.sub || qrInfo?.value) : (qrInfo?.key || qrInfo?.value);
                     if (val) {
                       const success = await copyToClipboard(val);
                       if (success) toast.success("Скопировано");
                     }
                   }}
                 >
                   <Copy size={16} />
                 </Button>
               </div>
               <Button 
                 className="w-full h-12 bg-blue-600 text-white hover:bg-blue-500 font-bold rounded-xl shadow-lg shadow-blue-900/20"
                 onClick={() => setIsQrOpen(false)}
               >
                 Закрыть
               </Button>
             </div>
           </DialogContent>
         </Dialog>
      </div>
    );
}
