import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Users, Server, DollarSign, Activity } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { AdminNav } from '@/components/admin/AdminNav';

export default function AdminDashboard() {
  const { session } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const { data } = await axios.get('/api/admin/stats', {
          headers: { Authorization: `Bearer ${session?.access_token}` }
        });
        setStats(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, [session]);

  const cards = [
    { title: 'Всего пользователей', value: stats?.totalUsers || 0, icon: Users, color: 'text-blue-500' },
    { title: 'Активных подписок', value: stats?.activeSubscriptions || 0, icon: Activity, color: 'text-green-500' },
    { title: 'Общая выручка', value: `$${stats?.totalRevenue || 0}`, icon: DollarSign, color: 'text-yellow-500' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-mono tracking-tight text-blue-400 uppercase">Admin Panel</h1>
      </div>

      <AdminNav />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {cards.map((card, i) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="p-6 bg-secondary/30 rounded-2xl border border-white/5"
          >
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl bg-white/5 ${card.color}`}>
                <card.icon size={24} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{card.title}</p>
                <p className="text-2xl font-bold">{card.value}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="p-6 bg-secondary/30 rounded-2xl border border-white/5">
        <h2 className="text-lg font-semibold mb-4 text-blue-400">Добро пожаловать в админ-панель izinet</h2>
        <p className="text-muted-foreground leading-relaxed">
          Здесь вы можете управлять VPN-серверами, пользователями и следить за статистикой сервиса. 
          Выберите нужный раздел в боковом меню или кнопках управления.
        </p>
      </div>
    </div>
  );
}
