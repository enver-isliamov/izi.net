import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, Settings, DollarSign, Route, FlaskConical, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AdminNav() {
  const location = useLocation();

  const navItems = [
    { name: 'Обзор', path: '/admin', icon: LayoutDashboard },
    { name: 'Юзеры', path: '/admin/users', icon: Users },
    { name: 'Платежи', path: '/admin/payments', icon: DollarSign },
    { name: 'Сервис', path: '/admin/maintenance', icon: Wrench },
    { name: 'Настройки', path: '/admin/settings', icon: Settings },
    { name: 'Маршруты', path: '/admin/routing', icon: Route },
    { name: 'Тесты', path: '/admin/tests', icon: FlaskConical },
  ];

  return (
    <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 p-1 bg-white/5 rounded-2xl border border-white/5 sm:flex sm:items-stretch sm:gap-1.5 overflow-hidden">
      {navItems.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-1.5 py-2 sm:py-2.5 rounded-xl text-[11px] sm:text-xs md:text-sm font-medium transition-all duration-200 whitespace-nowrap sm:flex-1 sm:basis-0 min-w-0 text-center",
              isActive 
                ? "bg-blue-500 text-white shadow-lg shadow-blue-500/25 font-semibold" 
                : "text-muted-foreground hover:text-white hover:bg-white/5"
            )}
          >
            <item.icon size={15} className="shrink-0" />
            <span className="truncate">{item.name}</span>
          </Link>
        );
      })}
    </div>
  );
}

