import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Server, ShieldCheck, Zap, Globe, Signal, Info } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';

export default function Servers() {
  const { session, subscription } = useAuth();
  const [servers, setServers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchServers = async () => {
      try {
        const { data } = await axios.get('/api/servers/status');
        setServers(data.filter((s: any) => s.is_active));
      } catch (e) {
        console.error('Failed to fetch servers');
      } finally {
        setLoading(false);
      }
    };
    fetchServers();
  }, []);

  const currentServerId = subscription?.server_id;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold font-mono tracking-tight text-white uppercase italic">
          Сети <span className="text-blue-500">izinet</span>
        </h1>
        <p className="text-muted-foreground mt-2">Доступные локации и состояние сети</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full py-10 text-center text-muted-foreground">Загрузка состояния сети...</div>
        ) : servers.map((server, i) => {
          const isConnected = server.id === currentServerId;
          
          return (
            <motion.div
              key={server.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className={`relative group bg-secondary/30 rounded-2xl border ${
                isConnected ? 'border-blue-500/50 bg-blue-500/5' : 'border-white/5'
              } p-6 overflow-hidden`}
            >
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <div className={`p-3 rounded-xl ${isConnected ? 'bg-blue-500 text-white' : 'bg-white/5 text-muted-foreground'}`}>
                    <Server size={24} />
                  </div>
                  {isConnected && (
                    <span className="flex items-center gap-1.5 px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-[10px] font-bold uppercase tracking-widest ring-1 ring-blue-500/30">
                      <ShieldCheck size={12} />
                      Подключено
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <h3 className="text-xl font-bold flex items-center gap-2">
                       {server.name}
                       <span className="text-xs font-mono text-muted-foreground opacity-50">#{server.location_code}</span>
                    </h3>
                    <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                      <Globe size={14} className="opacity-50" />
                      <span>{server.domain || server.ip}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 py-4 border-y border-white/5">
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Пинг</span>
                      <div className={`flex items-center gap-1.5 ${server.ping > 200 ? 'text-yellow-400' : server.ping === 999 ? 'text-red-400' : 'text-green-400'}`}>
                        <Signal size={14} />
                        <span className="font-mono text-sm font-bold">{server.ping === 999 ? 'Error' : `~${server.ping}ms`}</span>
                      </div>
                    </div>
                    <div className="space-y-1 text-right">
                      <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Нагрузка</span>
                      <div className={`font-mono text-sm font-bold ${server.load > 80 ? 'text-red-400' : 'text-white'}`}>
                        {server.load}%
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 text-xs text-muted-foreground bg-white/5 p-3 rounded-lg leading-relaxed">
                    <Zap size={14} className="shrink-0 mt-0.5 text-yellow-500" />
                    <span>Hysteria2 / VLESS. Reality-протоколы для защиты от DPI и блокировок.</span>
                  </div>
                </div>
              </div>

              {/* Decorative background accent */}
              <div className={`absolute -right-12 -bottom-12 w-40 h-40 rounded-full blur-[80px] opacity-20 pointer-events-none transition-all duration-500 group-hover:opacity-40 ${
                isConnected ? 'bg-blue-500' : 'bg-white'
              }`} />
            </motion.div>
          );
        })}

        {servers.length === 0 && !loading && (
          <div className="col-span-full py-20 text-center bg-secondary/20 rounded-3xl border border-dashed border-white/10">
            <div className="inline-flex p-4 bg-white/5 rounded-full mb-4">
              <Info className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-xl font-bold mb-2">Серверы не найдены</h3>
            <p className="text-muted-foreground">В данный момент нет доступных узлов. Пожалуйста, обратитесь в поддержку.</p>
          </div>
        )}
      </div>
    </div>
  );
}
