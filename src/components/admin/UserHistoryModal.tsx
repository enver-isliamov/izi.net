import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ArrowUpRight, ArrowDownLeft, Clock, Wallet, WalletCards } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  type: 'deposit' | 'withdrawal';
  status: string;
  description: string;
  created_at: string;
}

interface Summary {
  totalDeposits: number;
  totalWithdrawals: number;
  netProfit: number;
}

interface UserHistoryModalProps {
  user: any;
  isOpen: boolean;
  onClose: () => void;
}

export function UserHistoryModal({ user, isOpen, onClose }: UserHistoryModalProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ transactions: Transaction[], summary: Summary } | null>(null);

  useEffect(() => {
    if (isOpen && user) {
      fetchHistory();
    }
  }, [isOpen, user]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`/api/admin/users/${user.id}/transactions`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      setData(res.data);
    } catch (err: any) {
      toast.error('Ошибка загрузки истории транзакций');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-[#0f1115] border-l border-white/10 z-[70] shadow-2xl p-6 overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-xl font-bold text-white mb-1">История клиента</h2>
                <p className="text-xs text-muted-foreground font-mono">{user.email}</p>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-xl transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-muted-foreground animate-pulse">Загрузка операций...</p>
              </div>
            ) : data ? (
              <div className="space-y-8">
                {/* Statistics Grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Всего пополнено</p>
                    <div className="flex items-center gap-2">
                       <div className="p-1.5 bg-green-500/10 text-green-500 rounded-lg">
                         <ArrowDownLeft size={14} />
                       </div>
                       <span className="text-lg font-bold text-white font-mono">{data.summary.totalDeposits} ₽</span>
                    </div>
                  </div>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Всего потрачено</p>
                    <div className="flex items-center gap-2">
                       <div className="p-1.5 bg-blue-500/10 text-blue-500 rounded-lg">
                         <ArrowUpRight size={14} />
                       </div>
                       <span className="text-lg font-bold text-white font-mono">{data.summary.totalWithdrawals} ₽</span>
                    </div>
                  </div>
                </div>

                {/* Balance Display */}
                <div className="p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/20 text-blue-400 rounded-xl">
                      <Wallet size={20} />
                    </div>
                    <div>
                      <p className="text-[10px] text-blue-400/70 uppercase font-bold">Текущий баланс</p>
                      <p className="text-xl font-bold text-blue-400 font-mono">{user.balance || 0} ₽</p>
                    </div>
                  </div>
                </div>

                {/* Timeline */}
                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">Операции</h3>
                  
                  {data.transactions.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground italic text-sm">
                      Операций пока нет
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {data.transactions.map((tx) => (
                        <div key={tx.id} className="group p-4 bg-white/5 hover:bg-white/[0.08] border border-white/5 rounded-2xl transition-all duration-300">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex gap-3">
                              <div className={`mt-1 p-2 rounded-xl shrink-0 ${
                                tx.type === 'deposit' 
                                  ? 'bg-green-500/10 text-green-500' 
                                  : 'bg-blue-500/10 text-blue-500'
                              }`}>
                                {tx.type === 'deposit' ? <ArrowDownLeft size={18} /> : <WalletCards size={18} />}
                              </div>
                              <div className="flex flex-col">
                                <span className={`text-sm font-bold ${
                                  tx.type === 'deposit' ? 'text-green-400' : 'text-blue-400'
                                }`}>
                                  {tx.type === 'deposit' ? '+' : '-'}{tx.amount} ₽
                                </span>
                                <p className="text-white/70 text-xs leading-relaxed mt-1">
                                  {tx.description || (tx.type === 'deposit' ? 'Пополнение баланса' : 'Списание')}
                                </p>
                                <div className="flex items-center gap-1.5 mt-2 text-[10px] text-muted-foreground font-mono">
                                  <Clock size={10} />
                                  {new Date(tx.created_at).toLocaleString()}
                                </div>
                              </div>
                            </div>
                            
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter ${
                              tx.status === 'completed' ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'
                            }`}>
                              {tx.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
