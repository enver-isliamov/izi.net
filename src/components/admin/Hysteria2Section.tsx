import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Wifi, RefreshCw, Eye, EyeOff, Copy, CheckCircle2, AlertCircle, HelpCircle, ExternalLink } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';

export function Hysteria2Section() {
  const { session } = useAuth();
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => { fetchStatus(); }, [session]);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/admin/hysteria/status', {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      setStatus(res.data);
      setPassword(res.data.password || '');
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const savePassword = async () => {
    if (!password || password.length < 8) {
      toast.error('Пароль минимум 8 символов');
      return;
    }
    try {
      setSaving(true);
      await axios.post('/api/admin/hysteria/password', { password }, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.success('Пароль сохранен. Перезапустите Hysteria2.');
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const restartHysteria = async () => {
    try {
      setRestarting(true);
      await axios.post('/api/admin/hysteria/restart', {}, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      });
      toast.success('Hysteria2 перезапущен');
      setTimeout(fetchStatus, 2000);
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Ошибка перезапуска');
    } finally {
      setRestarting(false);
    }
  };

  const copyLink = () => {
    if (status?.link) {
      navigator.clipboard.writeText(status.link);
      setCopied(true);
      toast.success('Ссылка скопирована');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isOnline = status?.status === 'active';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 bg-green-500/5 rounded-2xl border border-green-500/10 backdrop-blur-sm space-y-6"
    >
      <div className="flex items-center justify-between pb-4 border-b border-green-500/10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-500/10 rounded-lg text-green-400">
            <Wifi size={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Hysteria2 (UDP)</h2>
            <p className="text-xs text-muted-foreground">Обход DPI через UDP-транспорт</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <RefreshCw className="animate-spin text-muted-foreground" size={16} />
          ) : isOnline ? (
            <span className="flex items-center gap-1 text-green-400 text-xs font-medium">
              <CheckCircle2 size={14} /> Работает
            </span>
          ) : (
            <span className="flex items-center gap-1 text-red-400 text-xs font-medium">
              <AlertCircle size={14} /> Остановлен
            </span>
          )}
        </div>
      </div>

      {/* Status Info */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-3 bg-black/20 rounded-xl border border-white/5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Протокол</p>
          <p className="text-sm font-bold text-white mt-1">UDP</p>
        </div>
        <div className="p-3 bg-black/20 rounded-xl border border-white/5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Порт</p>
          <p className="text-sm font-bold text-white mt-1">443</p>
        </div>
        <div className="p-3 bg-black/20 rounded-xl border border-white/5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">IP сервера</p>
          <p className="text-sm font-bold text-white mt-1">{status?.serverIp || '—'}</p>
        </div>
        <div className="p-3 bg-black/20 rounded-xl border border-white/5">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Запущен</p>
          <p className="text-xs text-white mt-1 truncate">{status?.uptime || '—'}</p>
        </div>
      </div>

      {/* Password Management */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-white">Пароль Hysteria2</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              data-lpignore="true"
              data-1p-ignore="true"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введите пароль (мин. 8 символов)"
              className="w-full px-4 py-2.5 bg-muted/30 border border-border rounded-xl text-sm text-white pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button
            onClick={savePassword}
            disabled={saving}
            className="px-4 py-2 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-xl text-sm font-medium disabled:opacity-50"
          >
            {saving ? '...' : 'Сохранить'}
          </button>
        </div>
      </div>

      {/* Connection Link */}
      {status?.hasPassword && (
        <div className="space-y-3">
          <label className="text-sm font-medium text-white">Ссылка для подключения</label>
          <div className="flex gap-2">
            <div className="flex-1 px-4 py-2.5 bg-black/30 border border-border rounded-xl text-xs text-green-400 font-mono overflow-x-auto whitespace-nowrap">
              {status.link}
            </div>
            <button
              onClick={copyLink}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm text-white flex items-center gap-1"
            >
              {copied ? <CheckCircle2 size={14} className="text-green-400" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={restartHysteria}
          disabled={restarting}
          className="flex items-center gap-2 px-4 py-2 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-xl text-sm font-medium disabled:opacity-50"
        >
          {restarting ? <RefreshCw className="animate-spin" size={14} /> : <RefreshCw size={14} />}
          Перезапустить
        </button>
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-sm text-muted-foreground"
        >
          <HelpCircle size={14} />
          {showHelp ? 'Скрыть справку' : 'Как пользоваться?'}
        </button>
      </div>

      {/* Help Section */}
      {showHelp && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="p-4 bg-black/20 rounded-xl border border-white/5 space-y-3 text-xs text-muted-foreground"
        >
          <h3 className="font-bold text-white">Как подключиться через Hysteria2</h3>
          <ol className="list-decimal list-inside space-y-1.5">
            <li>Скопируйте ссылку выше (нажмите кнопку копирования)</li>
            <li>Откройте Hiddify или другой VPN-клиент</li>
            <li>Нажмите "Добавить" → "Из буфера обмена"</li>
            <li>Нажмите "Подключить"</li>
          </ol>
          <p className="text-green-400 font-medium mt-2">
            Hysteria2 использует UDP — обходит DPI блокировки TCP.
          </p>
          <p className="text-yellow-400 font-medium">
            Если Hysteria2 не работает — клиент автоматически переключится на Reality (TCP).
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
