import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, UserPlus, Server } from 'lucide-react';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface CreateUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  servers: any[];
}

export function CreateUserModal({ isOpen, onClose, onSuccess, servers }: CreateUserModalProps) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    initialBalance: '0',
    createSubscription: false,
    serverId: servers[0]?.id || '',
    trafficLimitGb: '0',
    periodMonths: '1'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email) return toast.error('Введите Email');
    
    try {
      setLoading(true);
      const payload = {
        ...formData,
        trafficLimitMb: formData.trafficLimitGb ? String(parseFloat(formData.trafficLimitGb) * 1024) : '0'
      };
      const res = await axios.post('/api/admin/users/create', payload, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.success(`Успешно! Пароль: ${res.data.password}`, { duration: 10000 });
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error('Ошибка создания пользователя: ' + (err.response?.data?.error || err.message));
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
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            className="fixed inset-x-0 bottom-0 top-20 md:top-auto md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:left-1/2 md:-translate-x-1/2 md:max-w-lg w-full bg-[#0f1115] md:rounded-3xl border-t md:border border-white/10 z-[70] shadow-2xl p-6 overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl">
                  <UserPlus size={20} />
                </div>
                <h2 className="text-xl font-bold text-white">Создать пользователя</h2>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-xl transition-colors text-muted-foreground">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Email (Логин) *</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full bg-black/20 border border-white/5 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500/50"
                  placeholder="user@example.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Пароль (Опционально)</label>
                <input
                  type="text"
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full bg-black/20 border border-white/5 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500/50"
                  placeholder="Сгенерируется автоматически, если пусто"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Начальный баланс (₽)</label>
                <input
                  type="number"
                  value={formData.initialBalance}
                  onChange={(e) => setFormData(prev => ({ ...prev, initialBalance: e.target.value }))}
                  className="w-full bg-black/20 border border-white/5 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500/50"
                  min="0"
                />
              </div>

              <div className="pt-4 border-t border-white/5 space-y-4">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${formData.createSubscription ? 'bg-blue-500 border-blue-500' : 'border-white/20 group-hover:border-white/40'}`}>
                    {formData.createSubscription && <X size={12} className="rotate-45" />}
                  </div>
                  <span className="text-sm font-medium text-white">Сразу выдать подписку и создать VPN ключ</span>
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={formData.createSubscription}
                    onChange={(e) => setFormData(prev => ({ ...prev, createSubscription: e.target.checked }))}
                  />
                </label>

                {formData.createSubscription && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-4 bg-white/5 p-4 rounded-xl border border-white/5">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Локация</label>
                      <select
                        value={formData.serverId}
                        onChange={(e) => setFormData(prev => ({ ...prev, serverId: e.target.value }))}
                        className="w-full bg-black/40 border border-white/5 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500/50"
                      >
                        {servers.map(s => (
                          <option key={s.id} value={s.id}>{s.name} ({s.location_code})</option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Срок (месяцев)</label>
                        <input
                          type="number"
                          value={formData.periodMonths}
                          onChange={(e) => setFormData(prev => ({ ...prev, periodMonths: e.target.value }))}
                          className="w-full bg-black/40 border border-white/5 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500/50"
                          min="1"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Трафик (ГБ)</label>
                        <input
                          type="number"
                          value={formData.trafficLimitGb}
                          onChange={(e) => setFormData(prev => ({ ...prev, trafficLimitGb: e.target.value }))}
                          className="w-full bg-black/40 border border-white/5 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-blue-500/50"
                          min="0"
                          step="0.1"
                          placeholder="0 = безлимит"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>

              <div className="pt-4 border-t border-white/5">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl transition-all disabled:opacity-50"
                >
                  {loading ? 'Создание...' : 'Создать пользователя'}
                </button>
              </div>
            </form>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
