import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Server, Users, Settings, DollarSign, Route, FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AdminNav() {
  const location = useLocation();

  const navItems = [
    { name: 'Обзор / Серверы', path: '/admin', icon: LayoutDashboard },
    { name: 'Пользователи', path: '/admin/users', icon: Users },
    { name: 'Платежи', path: '/admin/payments', icon: DollarSign },
    { name: 'Настройки', path: '/admin/settings', icon: Settings },
    { name: 'Маршрутизация', path: '/admin/routing', icon: Route },
    { name: 'Тесты', path: '/admin/tests', icon: FlaskConical },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-1 p-1 bg-white/5 rounded-xl border border-white/5 sm:flex sm:items-stretch sm:gap-2">
      {navItems.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center justify-center gap-2 px-2 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap sm:flex-1 sm:basis-0 sm:min-w-[124px]",
              isActive 
                ? "bg-blue-500 text-white shadow-lg shadow-blue-500/20" 
                : "text-muted-foreground hover:text-white hover:bg-white/5"
            )}
          >
            <item.icon size={16} />
            {item.name}
          </Link>
        );
      })}
    </div>
  );
}
