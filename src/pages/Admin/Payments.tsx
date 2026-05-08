import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { AdminNav } from '@/components/admin/AdminNav';
import { toast } from 'sonner';
import { Search, Filter, CheckCircle2, XCircle, Clock, AlertCircle, RefreshCw, Check } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export default function AdminPayments() {
  const { session } = useAuth();
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all, pending, completed, failed
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const fetchPayments = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/admin/payments', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      setPayments(res.data || []);
    } catch (e: any) {
      console.error(e);
      toast.error('Не удалось загрузить список платежей');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session?.access_token) {
      fetchPayments();
    }
  }, [session]);

  const handleConfirm = async (paymentId: string) => {
    if (!window.confirm('Вы уверены, что хотите вручную подтвердить этот платеж и начислить баланс?')) return;
    
    setConfirmingId(paymentId);
    try {
      await axios.post('/api/admin/payments/confirm', { paymentId }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.success('Платеж успешно подтвержден!');
      fetchPayments(); // Refresh list
    } catch (e: any) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Ошибка при подтверждении платежа');
    } finally {
      setConfirmingId(null);
    }
  };

  const filtered = payments.filter(p => {
    const matchesSearch = 
      p.id.toLowerCase().includes(search.toLowerCase()) || 
      (p.user_id && p.user_id.toLowerCase().includes(search.toLowerCase()));
    
    const matchesFilter = filter === 'all' || p.status === filter;
    
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl md:text-2xl font-bold font-mono tracking-tight text-blue-400 uppercase">Управление платежами</h1>
        <button 
          onClick={fetchPayments}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-xl border border-white/5 text-sm hover:bg-white/10 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Обновить
        </button>
      </div>

      <AdminNav />

      <div className="flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <input
            type="text"
            placeholder="Поиск по ID платежа или ID пользователя..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-secondary/30 rounded-xl border border-white/5 focus:border-blue-500/50 outline-none transition-all"
          />
        </div>
        <div className="flex gap-2">
          {['all', 'pending', 'completed', 'failed'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl border text-sm capitalize transition-all ${
                filter === f 
                  ? 'bg-blue-500 border-blue-500 text-white' 
                  : 'bg-white/5 border-white/5 text-muted-foreground hover:bg-white/10'
              }`}
            >
              {f === 'all' ? 'Все' : f === 'pending' ? 'Ожидают' : f === 'completed' ? 'Завершены' : 'Ошибка'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-secondary/30 rounded-2xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/5 bg-white/5">
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">ID / Дата</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Пользователь</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Сумма</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Статус</th>
                <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-6 py-8 h-16 bg-white/5"></td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                    Платежи не найдены
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="text-sm font-mono text-blue-300 mb-1">{p.id.substring(0, 13)}...</div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.created_at ? format(new Date(p.created_at), 'dd MMM yyyy, HH:mm', { locale: ru }) : '---'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-mono text-muted-foreground opacity-60 truncate max-w-[150px]" title={p.user_id}>
                        {p.user_id}
                      </div>
                      {p.provider && (
                        <div className="text-[10px] uppercase text-blue-500/70 font-bold mt-1">
                          Провайдер: {p.provider}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-white">
                        {p.amount} <span className="text-[10px] font-normal text-muted-foreground">RUB</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {p.status === 'completed' ? (
                          <span className="flex items-center gap-1 text-xs font-bold text-green-400 bg-green-400/10 px-2 py-1 rounded-md">
                            <CheckCircle2 size={12} /> Готово
                          </span>
                        ) : p.status === 'pending' ? (
                          <span className="flex items-center gap-1 text-xs font-bold text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded-md">
                            <Clock size={12} /> Ожидает
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs font-bold text-red-400 bg-red-400/10 px-2 py-1 rounded-md">
                            <XCircle size={12} /> Ошибка
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {p.status === 'pending' && (
                        <button
                          onClick={() => handleConfirm(p.id)}
                          disabled={confirmingId === p.id}
                          className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all"
                        >
                          {confirmingId === p.id ? (
                            <RefreshCw size={12} className="animate-spin" />
                          ) : (
                            <Check size={12} />
                          )}
                          Подтвердить
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-start gap-4">
         <AlertCircle className="text-blue-400 shrink-0 mt-0.5" size={20} />
         <div className="text-sm text-blue-200/80 leading-relaxed">
            <p className="font-bold text-blue-300 mb-1">Ручное подтверждение</p>
            Используйте эту кнопку только если вы точно уверены, что клиент оплатил (например, прислал скриншот чека), 
            но платежная система не отправила уведомление. Это действие **начислит баланс** пользователю 
            и сменит статус платежа на завершенный.
         </div>
      </div>
    </div>
  );
}
