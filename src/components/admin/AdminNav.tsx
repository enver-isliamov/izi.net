import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Server, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AdminNav() {
  const location = useLocation();

  const navItems = [
    { name: 'Статистика', path: '/admin', icon: LayoutDashboard },
    { name: 'Серверы', path: '/admin/servers', icon: Server },
    { name: 'Пользователи', path: '/admin/users', icon: Users },
  ];

  return (
    <div className="flex items-center gap-2 p-1 bg-white/5 rounded-xl border border-white/5 mb-8 overflow-x-auto scrollbar-hide no-scrollbar">
      {navItems.map((item) => {
        const isActive = location.pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap",
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
