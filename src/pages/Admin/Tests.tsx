import React, { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw, CheckCircle2, AlertTriangle, XCircle, FlaskConical } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import axios from 'axios';
import { toast } from 'sonner';
import { AdminNav } from '@/components/admin/AdminNav';
import { cn } from '@/lib/utils';

type TestStatus = 'ok' | 'warn' | 'fail';

interface TestResult {
  id: string;
  group: string;
  name: string;
  status: TestStatus;
  detail: string;
  ms: number;
}

interface Summary {
  total: number;
  ok: number;
  warn: number;
  fail: number;
  ms: number;
}

const STATUS_STYLE: Record<TestStatus, { icon: React.ElementType; cls: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-emerald-400', label: 'ок' },
  warn: { icon: AlertTriangle, cls: 'text-amber-400', label: 'внимание' },
  fail: { icon: XCircle, cls: 'text-red-400', label: 'ошибка' },
};

export default function AdminTests() {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get('/api/admin/tests', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        timeout: 45000,
      });
      setSummary(data.summary);
      setResults(Array.isArray(data.results) ? data.results : []);
      setGeneratedAt(data.generatedAt || null);
      if (data.summary?.fail > 0) {
        toast.error(`Проверки завершены: ошибок — ${data.summary.fail}`);
      } else {
        toast.success('Проверки завершены: ошибок нет');
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e.message || 'Не удалось выполнить проверки');
      toast.error('Проверки не выполнены');
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    if (session?.access_token) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  const groups = Array.from(new Set(results.map((r) => r.group)));

  return (
    <div className="space-y-6">
      <AdminNav />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white flex items-center gap-2">
            <FlaskConical size={22} className="text-blue-400" />
            Тесты панели
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Самодиагностика: серверы, инбаунды, порты, клиенты, статистика, маршрутизация.
          </p>
        </div>
        <button
          onClick={() => void run()}
          disabled={loading || !session?.access_token}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all',
            loading
              ? 'bg-blue-500/50 text-white/70 cursor-wait'
              : 'bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/20'
          )}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Проверяем…' : 'Запустить проверки'}
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-xl border border-white/5 bg-white/5 p-4">
            <div className="text-xs text-muted-foreground">Всего</div>
            <div className="text-xl font-semibold text-white">{summary.total}</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/5 p-4">
            <div className="text-xs text-muted-foreground">Успешно</div>
            <div className="text-xl font-semibold text-emerald-400">{summary.ok}</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/5 p-4">
            <div className="text-xs text-muted-foreground">Внимание</div>
            <div className="text-xl font-semibold text-amber-400">{summary.warn}</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/5 p-4">
            <div className="text-xs text-muted-foreground">Ошибки</div>
            <div className={cn('text-xl font-semibold', summary.fail ? 'text-red-400' : 'text-white')}>{summary.fail}</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/5 p-4">
            <div className="text-xs text-muted-foreground">Время</div>
            <div className="text-xl font-semibold text-white">{(summary.ms / 1000).toFixed(1)} с</div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>
      )}

      {!loading && !error && results.length === 0 && (
        <div className="rounded-xl border border-white/5 bg-white/5 p-8 text-center text-sm text-muted-foreground">
          Пока нет результатов. Нажмите «Запустить проверки».
        </div>
      )}

      {groups.map((group) => (
        <div key={group} className="rounded-xl border border-white/5 bg-white/5 overflow-hidden">
          <div className="px-4 py-2 border-b border-white/5 text-xs uppercase tracking-wider text-muted-foreground">
            {group}
          </div>
          <div className="divide-y divide-white/5">
            {results
              .filter((r) => r.group === group)
              .map((r) => {
                const s = STATUS_STYLE[r.status];
                const Icon = s.icon;
                return (
                  <div key={r.id} className="flex items-start gap-3 px-4 py-3">
                    <Icon size={16} className={cn('mt-0.5 shrink-0', s.cls)} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white">{r.name}</div>
                      <div className="text-xs text-muted-foreground break-words">{r.detail}</div>
                    </div>
                    {r.ms > 0 && (
                      <div className="text-xs text-muted-foreground shrink-0">{r.ms} мс</div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ))}

      {generatedAt && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Activity size={12} />
          Проверки выполнены: {new Date(generatedAt).toLocaleString('ru-RU')}
        </p>
      )}
    </div>
  );
}
