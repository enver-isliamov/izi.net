import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AdminNav } from '@/components/admin/AdminNav';
import { toast } from 'sonner';
import { RefreshCw, Plus, Trash2, Edit2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formDomains, setFormDomains] = useState('');
  const [formIps, setFormIps] = useState('');
  const [formOutboundTag, setFormOutboundTag] = useState('block');

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

  const handleSaveRule = async () => {
    try {
      const domainsArr = formDomains.split(',').map(d => d.trim()).filter(d => !!d);
      const ipsArr = formIps.split(',').map(i => i.trim()).filter(i => !!i);

      if (!formName) {
        toast.error('Введите название правила');
        return;
      }

      const payload = {
        name: formName,
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

      setEditingId(null);
      setFormName('');
      setFormDomains('');
      setFormIps('');
      setFormOutboundTag('block');
      fetchRules();
      
      // Auto-sync to panels!
      syncToServers();
    } catch (e: any) {
      toast.error('Ошибка сохранения: ' + e.message);
    }
  };

  const handleEdit = (r: RoutingRule) => {
    setEditingId(r.id);
    setFormName(r.name);
    setFormDomains((r.domains || []).join(', '));
    setFormIps((r.ips || []).join(', '));
    setFormOutboundTag(r.outbound_tag || 'block');
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
      toast.success('Правила успешно внедрены на серверы!', { id: 'routing-sync' });
    } catch (e: any) {
      console.error(e);
      toast.error(e.response?.data?.error || 'Ошибка синхронизации', { id: 'routing-sync' });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <AdminNav />

      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-sm">Управление исключениями и блоками доменов/IP</p>
        </div>
        <Button 
          onClick={syncToServers}
          disabled={isSyncing}
          className="bg-blue-500 hover:bg-blue-600 text-white gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Синхронизация...' : 'Вшить в XUI'}
        </Button>
      </div>

      <Card className="glass-card border-white/10">
        <CardHeader>
          <CardTitle className="text-lg">{editingId ? 'Редактировать правило' : 'Добавить новое правило'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Название (для удобства)</label>
              <Input 
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="RKN blocklist, ZetFlix bypass..."
                className="bg-black/20"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Outbound Tag</label>
              <select 
                value={formOutboundTag}
                onChange={e => setFormOutboundTag(e.target.value)}
                className="w-full h-10 px-3 rounded-md bg-black/20 border border-input text-sm"
              >
                <option value="block">block (Блокировать)</option>
                <option value="direct">direct (Напрямую)</option>
                <option value="proxy">proxy (Через прокси)</option>
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">Домены (через запятую)</label>
              <Input 
                value={formDomains}
                onChange={e => setFormDomains(e.target.value)}
                placeholder="domain:zetflix.com, geosite:ru, regexp:.*\.ru$"
                className="bg-black/20"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs uppercase tracking-wider font-bold text-muted-foreground">IP адреса (через запятую)</label>
              <Input 
                value={formIps}
                onChange={e => setFormIps(e.target.value)}
                placeholder="geoip:ru, 192.168.0.0/16, 8.8.8.8"
                className="bg-black/20"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-4">
            {editingId && (
              <Button variant="ghost" onClick={() => {
                setEditingId(null);
                setFormName('');
                setFormDomains('');
                setFormIps('');
                setFormOutboundTag('block');
              }}>
                Отмена
              </Button>
            )}
            <Button onClick={handleSaveRule} className="bg-primary/20 hover:bg-primary/30 text-primary">
              <Plus className="w-4 h-4 mr-2" /> {editingId ? 'Сохранить изменения' : 'Добавить в базу'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {rules.map((rule) => (
          <Card key={rule.id} className={`glass-card border-white/5 ${!rule.is_active ? 'opacity-50' : ''}`}>
             <CardContent className="p-4 flex items-center justify-between">
               <div>
                 <div className="flex items-center gap-2 mb-1">
                   <ShieldAlert className={`w-4 h-4 ${rule.outbound_tag === 'block' ? 'text-red-500' : 'text-blue-500'}`} />
                   <span className="font-bold">{rule.name}</span>
                   <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                     rule.outbound_tag === 'block' ? 'bg-red-500/10 text-red-500' : 
                     rule.outbound_tag === 'direct' ? 'bg-green-500/10 text-green-500' : 'bg-blue-500/10 text-blue-500'
                   }`}>{rule.outbound_tag}</span>
                 </div>
                 <div className="text-xs text-muted-foreground mt-2 grid grid-cols-1 gap-1">
                   {rule.domains && rule.domains.length > 0 && <div><span className="font-bold text-white/70">Domains:</span> {rule.domains.join(', ')}</div>}
                   {rule.ips && rule.ips.length > 0 && <div><span className="font-bold text-white/70">IPs:</span> {rule.ips.join(', ')}</div>}
                 </div>
               </div>
               <div className="flex gap-2">
                 <Button size="sm" variant="ghost" className="h-8" onClick={() => handleToggleStatus(rule.id, rule.is_active)}>
                   {rule.is_active ? 'Отключить' : 'Включить'}
                 </Button>
                 <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-400" onClick={() => handleEdit(rule)}>
                   <Edit2 className="w-4 h-4" />
                 </Button>
                 <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500" onClick={() => handleDelete(rule.id)}>
                   <Trash2 className="w-4 h-4" />
                 </Button>
               </div>
             </CardContent>
          </Card>
        ))}
        {rules.length === 0 && !loading && (
           <div className="p-8 text-center text-muted-foreground border border-white/10 rounded-xl bg-white/5">
             Нет заведённых правил маршрутизации.
           </div>
        )}
      </div>

    </div>
  );
}
