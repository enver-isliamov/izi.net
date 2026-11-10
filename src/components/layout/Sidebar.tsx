import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Download, 
  LifeBuoy, 
  Users, 
  HelpCircle,
  LogOut,
  Wallet
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

const menuItems = [
  { icon: LayoutDashboard, label: 'Дашборд', path: '/dashboard' },
  { icon: Download, label: 'Установка', path: '/installation' },
  { icon: Wallet, label: 'Кошелёк', path: '/wallet' },
  { icon: Users, label: 'Рефералы', path: '/referrals' },
  { icon: LifeBuoy, label: 'Поддержка', path: '/support' },
  { icon: HelpCircle, label: 'FAQ', path: '/faq' },
];

export function Sidebar() {
  const location = useLocation();
  const { signOut, role } = useAuth();
  
  const isAdmin = role === 'admin' || role === 'superadmin';

  return (
    <aside className="w-64 border-r border-white/[0.08] bg-[#080c12]/95 backdrop-blur-xl hidden md:flex flex-col h-screen sticky top-0 z-20">
      {/* Brand Header */}
      <div className="p-6 flex items-center gap-3">
        <Link to="/" className="inline-flex items-center gap-2.5 group">
          <div className="relative w-8 h-8 rounded-full border border-cyan-400/60 shadow-[0_0_12px_rgba(123,220,255,0.35)] flex items-center justify-center bg-cyan-950/30 group-hover:border-cyan-300 transition-colors">
            <span className="w-2 h-2 rounded-full bg-[#8be5f0] shadow-[0_0_8px_#6ae6ff]" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">
            izi<span className="text-[#7bdcff]">net</span>
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1.5">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link key={item.path} to={item.path}>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-3 h-11 px-3.5 rounded-xl transition-all duration-200 text-sm font-medium",
                  isActive 
                    ? "bg-gradient-to-r from-cyan-950/40 via-cyan-900/20 to-transparent text-[#7bdcff] border border-cyan-500/25 shadow-[0_0_15px_rgba(123,220,255,0.12)] font-semibold" 
                    : "text-[#8d959f] hover:text-white hover:bg-white/[0.04]"
                )}
              >
                <item.icon className={cn("w-4 h-4", isActive ? "text-[#7bdcff]" : "text-[#8d959f]")} />
                <span>{item.label}</span>
              </Button>
            </Link>
          );
        })}
      </nav>

      {/* Footer Info & Logout */}
      <div className="p-4 border-t border-white/[0.08] space-y-3">
        <div className="flex flex-col gap-1.5 px-3 text-[11px] text-[#59636f]">
          <Link to="/terms" className="hover:text-[#7bdcff] transition-colors">Правила сервиса</Link>
          <Link to="/refund" className="hover:text-[#7bdcff] transition-colors">Политика возвратов</Link>
          <Link to="/privacy" className="hover:text-[#7bdcff] transition-colors">Конфиденциальность</Link>
        </div>
        <Button
          variant="ghost"
          onClick={signOut}
          className="w-full justify-start gap-3 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl h-10 text-xs font-medium"
        >
          <LogOut className="w-4 h-4" />
          <span>Выйти</span>
        </Button>
      </div>
    </aside>
  );
}
