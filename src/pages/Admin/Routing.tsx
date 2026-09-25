import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { AdminNav } from '@/components/admin/AdminNav';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { toast } from 'sonner';
import { 
  RefreshCw, 
  Plus, 
  Trash2, 
  Edit2, 
  ShieldAlert, 
  Route, 
  ShieldCheck, 
  CheckCircle2, 
  XCircle,
  Globe, 
  Layers, 
  Filter,
  Check,
  X
} from 'lucide-react';
import axios from 'axios';
import { useAuth } from '@/contexts/AuthContext';

interface RoutingRule {
  id: string;
  name: string;
  domains: string[];
  ips: string[];
  outbound_tag: string;
  is_active: boolean;
}

export default function AdminRouting() {
  const { session } = useAuth();
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formDomains, setFormDomains] = useState('');
  const [formIps, setFormIps] = useState('');
  const [formOutboundTag, setFormOutboundTag] = useState<'block' | 'direct' | 'proxy'>('block');

  const fetchRules = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.from('vpn_routing_rules').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setRules(data || []);
    } catch (e: any) {
      toast.error('Ошибка загрузки правил: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleSaveRule = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      const domainsArr = formDomains.split(',').map(d => d.trim()).filter(d => !!d);
      const ipsArr = formIps.split(',').map(i => i.trim()).filter(i => !!i);

      if (!formName.trim()) {
        toast.error('Введите название правила');
        return;
      }

      const payload = {
        name: formName.trim(),
        domains: domainsArr,
        ips: ipsArr,
        outbound_tag: formOutboundTag,
        is_active: true
      };

      if (editingId) {
        const { error } = await supabase.from('vpn_routing_rules').update(payload).eq('id', editingId);
        if (error) throw error;
        toast.success('Правило обновлено');
      } else {
        const { error } = await supabase.from('vpn_routing_rules').insert([payload]);
        if (error) throw error;
        toast.success('Правило добавлено');
      }

      resetForm();
      fetchRules();
      
      // Auto-sync to panels
      syncToServers();
    } catch (e: any) {
      toast.error('Ошибка сохранения: ' + e.message);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormName('');
    setFormDomains('');
    setFormIps('');
    setFormOutboundTag('block');
    setIsFormOpen(false);
  };

  const handleEdit = (r: RoutingRule) => {
    setEditingId(r.id);
    setFormName(r.name);
    setFormDomains((r.domains || []).join(', '));
    setFormIps((r.ips || []).join(', '));
    setFormOutboundTag((r.outbound_tag as any) || 'block');
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить правило?')) return;
    try {
      const { error } = await supabase.from('vpn_routing_rules').delete().eq('id', id);
      if (error) throw error;
      toast.success('Правило удалено');
      fetchRules();
    } catch (e: any) {
      toast.error('Ошибка удаления: ' + e.message);
    }
  };

  const handleToggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase.from('vpn_routing_rules').update({ is_active: !currentStatus }).eq('id', id);
      if (error) throw error;
      fetchRules();
    } catch (e: any) {
      toast.error('Ошибка переключения статуса: ' + e.message);
    }
  };

  const syncToServers = async () => {
    try {
      setIsSyncing(true);
      toast.loading('Применение маршрутизации...', { id: 'routing-sync' });
      await axios.post('/api/admin/system/sync-routing', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.success('Правила успешно внедрены на все серверы 3x-ui!', { id: 'routing-sync' });
    } catch (e: any) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Ошибка синхронизации', { id: 'routing-sync' });
    } finally {
      setIsSyncing(false);
    }
  };

  const blockCount = rules.filter(r => r.outbound_tag === 'block').length;
  const directCount = rules.filter(r => r.outbound_tag === 'direct').length;
  const proxyCount = rules.filter(r => r.outbound_tag === 'proxy').length;

  return (
    <div className="space-y-6">
      <AdminNav />
      <AdminPageHeader title="Маршрутизация" description="Управление исключениями и блоками доменов/IP" />

      {/* Main Routing Command Center Block */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-6 bg-gradient-to-r from-blue-950/20 via-secondary/30 to-purple-950/20 rounded-2xl border border-blue-500/20 backdrop-blur-sm space-y-6 shadow-xl shadow-blue-950/10"
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-white/5 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-400 border border-purple-500/20">
              <Route size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">Маршрутизация трафика & Xray Routing</h2>
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {rules.filter(r => r.is_active).length} активных
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Раздельное туннелирование, блокировки РКН и проксирование списков доменов и IP
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={syncToServers}
              disabled={isSyncing}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-medium transition-colors shadow-sm shadow-blue-600/20 disabled:opacity-50"
              title="Применить правила на все серверы 3x-ui"
            >
              <RefreshCw size={13} className={isSyncing ? 'animate-spin' : ''} />
              <span>{isSyncing ? 'Синхронизация...' : 'Вшить в XUI'}</span>
            </button>

            <button
              onClick={() => {
                if (isFormOpen) resetForm();
                else setIsFormOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-xs font-medium border border-white/10 transition-colors"
            >
              {isFormOpen ? <X size={14} /> : <Plus size={14} />}
              <span>{isFormOpen ? 'Отмена' : 'Добавить правило'}</span>
            </button>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between">
            <span className="text-[11px] text-muted-foreground">Всего правил</span>
            <span className="text-xl font-bold font-mono text-white mt-1">{rules.length}</span>
            <span className="text-[10px] text-zinc-500 font-mono">В базе данных</span>
          </div>

          <div className="p-3 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between">
            <span className="text-[11px] text-muted-foreground">Блокировка (BLOCK)</span>
            <span className="text-xl font-bold font-mono text-red-400 mt-1">{blockCount}</span>
            <span className="text-[10px] text-red-400/70 font-mono">Запрещенные хосты</span>
          </div>

          <div className="p-3 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between">
            <span className="text-[11px] text-muted-foreground">Прямой доступ (DIRECT)</span>
            <span className="text-xl font-bold font-mono text-emerald-400 mt-1">{directCount}</span>
            <span className="text-[10px] text-emerald-400/70 font-mono">В обход VPN</span>
          </div>

          <div className="p-3 bg-black/30 rounded-xl border border-white/5 flex flex-col justify-between">
            <span className="text-[11px] text-muted-foreground">Прокси (PROXY)</span>
            <span className="text-xl font-bold font-mono text-blue-400 mt-1">{proxyCount}</span>
            <span className="text-[10px] text-blue-400/70 font-mono">Туннельный трафик</span>
          </div>
        </div>

        {/* Create / Edit Rule Form */}
        <AnimatePresence>
          {isFormOpen && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              onSubmit={handleSaveRule}
              className="p-5 bg-black/40 rounded-xl border border-white/10 space-y-4 overflow-hidden"
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/5">
                <span className="text-xs font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                  <Edit2 size={13} />
                  {editingId ? 'Редактировать правило' : 'Новое правило маршрутизации'}
                </span>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-muted-foreground hover:text-white"
                >
                  Закрыть
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">Название правила</label>
                  <input
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="Например: RKN blocklist, Кинопоиск bypass..."
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-blue-500/50 outline-none"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-medium">Действие (Outbound Tag)</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormOutboundTag('block')}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        formOutboundTag === 'block'
                          ? 'bg-red-500/20 text-red-300 border-red-500/40 shadow-sm'
                          : 'bg-black/30 text-zinc-400 border-white/5 hover:border-white/15'
                      }`}
                    >
                      BLOCK
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormOutboundTag('direct')}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        formOutboundTag === 'direct'
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                          : 'bg-black/30 text-zinc-400 border-white/5 hover:border-white/15'
                      }`}
                    >
                      DIRECT
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormOutboundTag('proxy')}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                        formOutboundTag === 'proxy'
                          ? 'bg-blue-500/20 text-blue-300 border-blue-500/40 shadow-sm'
                          : 'bg-black/30 text-zinc-400 border-white/5 hover:border-white/15'
                      }`}
                    >
                      PROXY
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs text-muted-foreground font-medium">Домены (через запятую)</label>
                  <input
                    value={formDomains}
                    onChange={e => setFormDomains(e.target.value)}
                    placeholder="domain:zetflix.com, geosite:ru, regexp:.*\.ru$"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-mono focus:border-blue-500/50 outline-none"
                  />
                  <p className="text-[10px] text-zinc-500">Поддерживаются форматы: domain:example.com, full:example.com, geosite:category, regexp:pattern</p>
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs text-muted-foreground font-medium">IP адреса или подсети (через запятую)</label>
                  <input
                    value={formIps}
                    onChange={e => setFormIps(e.target.value)}
                    placeholder="geoip:ru, 192.168.0.0/16, 8.8.8.8"
                    className="w-full bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-mono focus:border-blue-500/50 outline-none"
                  />
                  <p className="text-[10px] text-zinc-500">Поддерживаются форматы: geoip:ru, 10.0.0.0/8, отдельный IP</p>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-xs font-medium transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-medium transition-colors shadow-sm shadow-blue-600/20"
                >
                  {editingId ? 'Сохранить изменения' : 'Создать правило'}
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Rules List */}
        <div className="space-y-3">
          {rules.map((rule) => {
            const isBlock = rule.outbound_tag === 'block';
            const isDirect = rule.outbound_tag === 'direct';
            const isProxy = rule.outbound_tag === 'proxy';

            return (
              <motion.div
                key={rule.id}
                layout
                className={`p-4 rounded-xl border transition-all ${
                  rule.is_active
                    ? 'bg-black/30 border-white/10 hover:border-white/20 shadow-md'
                    : 'bg-black/20 border-white/5 opacity-60'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-white/5">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <div className={`p-2 rounded-lg border ${
                      isBlock ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                      isDirect ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                      'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    }`}>
                      {isBlock ? <ShieldAlert size={16} /> : isDirect ? <Globe size={16} /> : <Layers size={16} />}
                    </div>

                    <span className="font-semibold text-white text-sm">{rule.name}</span>

                    <span className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                      isBlock ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                      isDirect ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                      'bg-blue-500/10 text-blue-400 border-blue-500/20'
                    }`}>
                      {rule.outbound_tag}
                    </span>

                    {rule.is_active ? (
                      <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        Активно
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-zinc-500">
                        Отключено
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    <button
                      onClick={() => handleToggleStatus(rule.id, rule.is_active)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        rule.is_active
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                          : 'bg-zinc-800 text-zinc-400 border-white/5 hover:bg-zinc-700'
                      }`}
                    >
                      {rule.is_active ? 'Отключить' : 'Включить'}
                    </button>

                    <button
                      onClick={() => handleEdit(rule)}
                      className="p-1.5 bg-white/5 hover:bg-white/10 text-blue-400 rounded-lg border border-white/10 transition-colors"
                      title="Редактировать правило"
                    >
                      <Edit2 size={13} />
                    </button>

                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg border border-red-500/20 transition-colors"
                      title="Удалить правило"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Domains & IPs details */}
                <div className="pt-2 space-y-1.5 text-xs">
                  {rule.domains && rule.domains.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] uppercase font-mono text-zinc-500">Домены:</span>
                      {rule.domains.map((dom, idx) => (
                        <span key={idx} className="bg-black/50 text-zinc-300 font-mono text-[10px] px-2 py-0.5 rounded border border-white/5">
                          {dom}
                        </span>
                      ))}
                    </div>
                  )}

                  {rule.ips && rule.ips.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] uppercase font-mono text-zinc-500">IP адреса:</span>
                      {rule.ips.map((ip, idx) => (
                        <span key={idx} className="bg-black/50 text-indigo-300 font-mono text-[10px] px-2 py-0.5 rounded border border-indigo-500/10">
                          {ip}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}

          {rules.length === 0 && !loading && (
            <div className="text-center py-12 bg-black/20 rounded-2xl border border-dashed border-white/10">
              <Route className="mx-auto mb-3 text-muted-foreground opacity-30" size={40} />
              <p className="text-sm font-medium text-zinc-300">Список правил маршрутизации пуст</p>
              <p className="text-xs text-muted-foreground mt-1">Добавьте блокировку РКН или правила прямого доступа нажатием «Добавить правило»</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
