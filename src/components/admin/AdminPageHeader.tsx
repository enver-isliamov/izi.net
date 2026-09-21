import React from 'react';
import { RefreshCw } from 'lucide-react';

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Дополнительные действия справа (поиск, фильтры, кнопки). */
  children?: React.ReactNode;
}

/**
 * Единая шапка страниц админки.
 * На телефоне элементы идут в столбик и растягиваются, на широком экране — в одну строку.
 */
export function AdminPageHeader({ title, description, onRefresh, refreshing, children }: AdminPageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-2">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold text-white leading-tight">{title}</h1>
        {description && (
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p>
        )}
      </div>
      {(children || onRefresh) && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto sm:shrink-0">
          {children}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-xl border border-white/10 bg-white/5 text-xs sm:text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-50 w-full sm:w-auto"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              Обновить
            </button>
          )}
        </div>
      )}
    </div>
  );
}
