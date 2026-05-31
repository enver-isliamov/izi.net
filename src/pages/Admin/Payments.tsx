import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { AdminNav } from '@/components/admin/AdminNav';
import { toast } from 'sonner';
import { Search, Filter, CheckCircle2, XCircle, Clock, AlertCircle, RefreshCw, Check, HelpCircle, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export default function AdminPayments() {
  const { session } = useAuth();
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all, pending, completed, failed
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  
  // Cache for Enot API statuses
  const [enotStatuses, setEnotStatuses] = useState<Record<string, { status: string; info?: string; loading?: boolean }>>({});

  const checkEnotStatus = async (paymentId: string) => {
    setEnotStatuses(prev => ({ ...prev, [paymentId]: { status: 'checking', loading: true, info: 'Запрос к API Enot.io...' } }));
    try {
      const res = await axios.post('/api/admin/payments/check-enot', { paymentId }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      
      if (res.data.success) {
        let statusText = 'unknown';
        let detail = '';
        if (res.data.enotStatus === 'success') {
          statusText = 'success';
          detail = 'ОПЛАЧЕН (Успешно на стороне Enot.io)';
        } else if (res.data.enotStatus === 'created') {
          statusText = 'created';
          detail = 'Создан (Оплата еще не вносилась)';
        } else if (res.data.enotStatus === 'fail') {
          statusText = 'fail';
          detail = 'Истек / Отклонен на стороне Enot.io';
        } else if (res.data.enotStatus === 'none') {
          statusText = 'none';
          detail = res.data.message || 'Прямой перевод или промокод';
        } else {
          statusText = 'error';
          detail = res.data.message || 'Ошибка API';
        }
        setEnotStatuses(prev => ({ 
          ...prev, 
          [paymentId]: { status: statusText, info: detail, loading: false } 
        }));
      } else {
        setEnotStatuses(prev => ({ 
          ...prev, 
          [paymentId]: { status: 'error', info: res.data.message || 'Ошибка проверки', loading: false } 
        }));
      }
    } catch (e: any) {
      console.error(e);
      setEnotStatuses(prev => ({ 
        ...prev, 
        [paymentId]: { status: 'error', info: e.response?.data?.error || 'Сетевая ошибка API Enot.io', loading: false } 
      }));
    }
  };

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
    const paymentItem = payments.find(p => p.id === paymentId);
    const isExpired = paymentItem?.status === 'pending' && paymentItem?.expires_at && new Date(paymentItem.expires_at) < new Date();
    
    const confirmMsg = isExpired
      ? 'ВНИМАНИЕ: Срок действия этой ссылки ОПЛАТЫ ИСТЕК на стороне Enot! Вы точно уверены, что клиент перевел рубли, и вы хотите принудительно зачислить баланс просроченной транзакции?'
      : 'Вы уверены, что хотите вручную подтвердить этот платеж и начислить баланс?';

    if (!window.confirm(confirmMsg)) return;
    
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
        <div></div>
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
        <div className="flex flex-wrap gap-2">
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
        <div className="hidden md:block overflow-x-auto">
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
                filtered.map((p) => {
                  const isExpired = p.status === 'pending' && p.expires_at && new Date(p.expires_at) < new Date();
                  return (
                    <tr key={p.id} className="hover:bg-white/5 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="text-sm font-mono text-blue-300 mb-1" title={p.id}>{p.id.substring(0, 13)}...</div>
                        {p.invoice_id && (
                          <div className="text-[10px] font-mono text-muted-foreground/70 mb-1" title={p.invoice_id}>
                            Транзакция: {p.invoice_id}
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground">
                          {p.created_at ? format(new Date(p.created_at), 'dd MMM yyyy, HH:mm', { locale: ru }) : '---'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {p.users?.email ? (
                          <div className="text-sm font-bold text-white mb-0.5">
                            {p.users.email}
                          </div>
                        ) : null}
                        <div className="text-[10px] font-mono text-muted-foreground opacity-60 truncate max-w-[150px]" title={p.user_id}>
                          {p.user_id}
                        </div>
                        {p.provider && (
                          <div className="flex flex-col gap-1 mt-1 text-[10px]">
                            <span className="uppercase text-blue-500/70 font-semibold">
                              Провайдер: {p.provider}
                            </span>
                            {p.provider === 'enot' && p.invoice_id && (
                              <div className="flex flex-col gap-1 items-start mt-0.5">
                                <button
                                  onClick={() => checkEnotStatus(p.id)}
                                  className="text-[9px] text-blue-400 hover:text-blue-300 font-mono underline cursor-pointer flex items-center gap-1"
                                >
                                  {enotStatuses[p.id]?.loading ? (
                                    <RefreshCw size={10} className="animate-spin inline text-blue-400" />
                                  ) : (
                                    <HelpCircle size={10} className="inline text-blue-400" />
                                  )}
                                  Проверить в Enot.io
                                </button>
                                {enotStatuses[p.id]?.info && (
                                  <div className={`text-[9px] font-medium leading-normal p-1 rounded mt-0.5 max-w-[200px] whitespace-normal ${
                                    enotStatuses[p.id]?.status === 'success' 
                                      ? 'bg-green-500/10 text-green-400 border border-green-500/20 font-bold' 
                                      : enotStatuses[p.id]?.status === 'created'
                                      ? 'bg-zinc-800 text-zinc-400 border border-white/5'
                                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                  }`}>
                                    {enotStatuses[p.id]?.info}
                                  </div>
                                )}
                              </div>
                            )}
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
                            isExpired ? (
                              <span className="flex items-center gap-1 text-xs font-semibold text-neutral-500 bg-white/5 px-2 py-1 rounded-md" title="Пользователь покинул страницу оплаты">
                                <Clock size={12} className="text-neutral-500" /> Брошен
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs font-bold text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded-md animate-pulse">
                                <Clock size={12} /> Ожидает
                              </span>
                            )
                          ) : (
                            <span className="flex items-center gap-1 text-xs font-semibold text-neutral-500 bg-neutral-500/5 px-2 py-1 rounded-md">
                              <XCircle size={12} className="text-neutral-500" /> Не оплачен
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {p.status !== 'completed' && (() => {
                          const enotState = enotStatuses[p.id];
                          
                          if (enotState) {
                            if (enotState.status === 'created') {
                              return (
                                <div className="flex flex-col items-start gap-1">
                                  <span className="text-[9px] font-bold text-zinc-500 uppercase px-2 py-1 bg-zinc-800 rounded border border-white/5" title="Пользователь не оплатил счет">
                                    Не оплачен
                                  </span>
                                  <button
                                    onClick={() => handleConfirm(p.id)}
                                    disabled={confirmingId === p.id}
                                    className="text-[9px] text-blue-400 hover:text-blue-300 underline font-semibold"
                                  >
                                    Зачислить вручную
                                  </button>
                                </div>
                              );
                            }
                            
                            if (enotState.status === 'success') {
                              return (
                                <button
                                  onClick={() => handleConfirm(p.id)}
                                  disabled={confirmingId === p.id}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-black text-[10px] font-black uppercase tracking-wider rounded-lg transition-all shadow-lg shadow-green-500/10 animate-bounce"
                                >
                                  {confirmingId === p.id ? (
                                    <RefreshCw size={12} className="animate-spin" />
                                  ) : (
                                    <CheckCircle2 size={12} />
                                  )}
                                  Зачислить (ОПЛАЧЕН!)
                                </button>
                              );
                            }

                            if (enotState.status === 'fail') {
                              return (
                                <div className="flex flex-col items-start gap-1">
                                  <span className="text-[9px] font-bold text-red-400 uppercase px-2 py-1 bg-red-400/10 rounded">
                                    Платеж отменен
                                  </span>
                                  <button
                                    onClick={() => handleConfirm(p.id)}
                                    disabled={confirmingId === p.id}
                                    className="text-[9px] text-muted-foreground hover:text-white underline"
                                  >
                                    Все равно зачислить
                                  </button>
                                </div>
                              );
                            }
                          }

                          return (
                            <div className="flex flex-col sm:flex-row gap-1.5 items-start">
                              {p.provider === 'enot' && p.invoice_id && (
                                <button
                                  onClick={() => checkEnotStatus(p.id)}
                                  className="px-2.5 py-1 text-[10px] font-bold bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-lg transition-all"
                                >
                                  Проверить статус
                                </button>
                              )}
                              <button
                                onClick={() => handleConfirm(p.id)}
                                disabled={confirmingId === p.id}
                                className={`flex items-center justify-center gap-1 px-3 py-1 text-[10px] font-bold uppercase rounded-lg transition-all ${
                                  isExpired 
                                    ? 'bg-neutral-800 text-neutral-400 border border-white/5 hover:bg-neutral-700 hover:text-white' 
                                    : 'bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/10'
                                }`}
                              >
                                {confirmingId === p.id ? (
                                  <RefreshCw size={10} className="animate-spin" />
                                ) : (
                                  <Check size={10} />
                                )}
                                {isExpired ? 'Провести' : 'Подтвердить'}
                              </button>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden divide-y divide-white/5">
          {loading ? (
             Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="animate-pulse p-4 h-24 bg-white/5" />
             ))
          ) : filtered.length === 0 ? (
             <div className="p-12 text-center text-muted-foreground text-sm">
                Платежи не найдены
             </div>
          ) : (
             filtered.map((p) => {
               const isExpired = p.status === 'pending' && p.expires_at && new Date(p.expires_at) < new Date();
               const enotState = enotStatuses[p.id];

               return (
                 <div key={p.id} className="p-4 space-y-3">
                   <div className="flex justify-between items-start">
                     <div className="flex flex-col">
                       <span className="text-xs font-mono text-blue-300">{p.id.substring(0, 13)}...</span>
                       <span className="text-[10px] text-muted-foreground">
                         {p.created_at ? format(new Date(p.created_at), 'dd MMM yyyy, HH:mm', { locale: ru }) : '---'}
                       </span>
                     </div>
                     <div className="text-right">
                       <span className="text-sm font-bold text-white">{p.amount} ₽</span>
                     </div>
                   </div>
                   
                   <div className="flex justify-between items-center text-xs">
                     <span className="font-mono text-muted-foreground opacity-60 truncate max-w-[150px]">{p.user_id}</span>
                     {p.status === 'completed' ? (
                       <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-green-400 bg-green-400/10 px-2 py-0.5 rounded-md">
                         <CheckCircle2 size={10} /> Готово
                       </span>
                     ) : p.status === 'pending' ? (
                       isExpired ? (
                         <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-neutral-500 bg-white/5 px-2 py-0.5 rounded-md">
                           <Clock size={10} className="text-neutral-500" /> Брошен
                         </span>
                       ) : (
                         <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded-md animate-pulse">
                           <Clock size={10} /> Ожидает
                         </span>
                       )
                     ) : (
                       <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium text-neutral-500 bg-neutral-500/5 px-2 py-0.5 rounded-md">
                         <XCircle size={10} className="text-neutral-500" /> Не оплачен
                       </span>
                     )}
                   </div>

                   {p.provider && (
                     <div className="text-[10px] bg-white/[0.01] p-2 rounded-xl border border-white/5 space-y-1.5">
                       <div className="flex justify-between items-center">
                         <span className="text-muted-foreground uppercase font-semibold">Провайдер:</span>
                         <span className="text-white font-mono">{p.provider}</span>
                       </div>
                       {p.provider === 'enot' && p.invoice_id && (
                         <div className="pt-1.5 border-t border-white/5 space-y-1.5">
                           <div className="flex justify-between items-center">
                             <span className="text-muted-foreground">Enot.io ID:</span>
                             <span className="text-blue-300 text-[9px] font-mono select-all">{p.invoice_id}</span>
                           </div>
                           <div className="flex gap-2 justify-end">
                             <button
                               onClick={() => checkEnotStatus(p.id)}
                               className="text-[9px] text-blue-400 hover:text-blue-300 font-mono underline cursor-pointer flex items-center gap-1"
                             >
                               {enotState?.loading ? (
                                 <RefreshCw size={10} className="animate-spin inline" />
                               ) : (
                                 <HelpCircle size={10} className="inline" />
                               )}
                               Проверить статус
                             </button>
                           </div>
                           {enotState?.info && (
                             <div className={`p-1.5 text-[9px] rounded text-center leading-normal ${
                               enotState.status === 'success'
                                 ? 'bg-green-500/10 text-green-400 border border-green-500/20 font-bold'
                                 : enotState.status === 'created'
                                 ? 'bg-zinc-800 text-zinc-400 border border-white/5'
                                 : 'bg-red-500/10 text-red-400 border border-red-500/20'
                             }`}>
                               {enotState.info}
                             </div>
                           )}
                         </div>
                       )}
                     </div>
                   )}

                   {p.status === 'pending' && (() => {
                     if (enotState) {
                       if (enotState.status === 'created') {
                         return (
                           <div className="space-y-2">
                             <div className="w-full text-center py-2 bg-zinc-800 text-zinc-500 text-[10px] font-bold uppercase rounded-lg border border-white/5">
                               Оплаты нет в Enot.io
                             </div>
                             <button
                               onClick={() => handleConfirm(p.id)}
                               disabled={confirmingId === p.id}
                               className="w-full text-center py-1 text-[10px] text-muted-foreground hover:text-white underline transition-all"
                             >
                               Все равно подтвердить вручную
                             </button>
                           </div>
                         );
                       }
                       
                       if (enotState.status === 'success') {
                         return (
                           <button
                             onClick={() => handleConfirm(p.id)}
                             disabled={confirmingId === p.id}
                             className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-black text-xs font-black uppercase rounded-lg transition-all animate-bounce"
                           >
                             {confirmingId === p.id ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                             Зачислить (ОПЛАЧЕН!)
                           </button>
                         );
                       }

                       if (enotState.status === 'fail') {
                         return (
                           <div className="space-y-1 text-center">
                             <span className="block text-[10px] text-red-400 font-bold uppercase py-1 bg-red-400/10 rounded">
                               Платеж отменен Enot.io
                             </span>
                             <button
                               onClick={() => handleConfirm(p.id)}
                               disabled={confirmingId === p.id}
                               className="text-[10px] text-muted-foreground hover:text-white underline"
                             >
                               Все равно провести
                             </button>
                           </div>
                         );
                       }
                     }

                     return (
                       <div className="flex gap-2">
                         {p.provider === 'enot' && p.invoice_id && (
                           <button
                             onClick={() => checkEnotStatus(p.id)}
                             className="flex-1 py-2 text-[10px] font-bold bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-lg transition-all"
                           >
                             Проверить в платежке
                           </button>
                         )}
                         <button
                           onClick={() => handleConfirm(p.id)}
                           disabled={confirmingId === p.id}
                           className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 disabled:opacity-50 text-white text-xs font-bold transition-all rounded-lg ${
                             isExpired 
                               ? 'bg-neutral-800 text-neutral-400 border border-white/5 hover:bg-neutral-700 hover:text-white' 
                               : 'bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/10'
                           }`}
                         >
                           {confirmingId === p.id ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                           {isExpired ? 'Провести' : 'Подтвердить'}
                         </button>
                       </div>
                     );
                   })()}
                 </div>
               );
             })
          )}
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
