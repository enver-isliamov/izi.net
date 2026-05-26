import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  CreditCard, 
  Download, 
  LifeBuoy, 
  User, 
  Users, 
  HelpCircle,
  LogOut,
  ShieldCheck,
  Globe,
  Wallet,
  Settings
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

const menuItems = [
  { icon: LayoutDashboard, label: 'Дашборд', path: '/dashboard' },
  { icon: Download, label: 'Установка', path: '/installation' },
  { icon: Wallet, label: 'Кошелек', path: '/wallet' },
  { icon: Users, label: 'Рефералы', path: '/referrals' },
  { icon: LifeBuoy, label: 'Поддержка', path: '/support' },
  { icon: HelpCircle, label: 'FAQ', path: '/faq' },
];

export function Sidebar() {
  const location = useLocation();
  const { signOut, role } = useAuth();
  
  const isAdmin = role === 'admin' || role === 'superadmin';

  return (
    <aside className="w-64 border-r border-border bg-card/30 backdrop-blur-xl hidden md:flex flex-col h-screen sticky top-0">
      <div className="p-6 flex items-center gap-3">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center neon-glow">
          <ShieldCheck className="text-black w-6 h-6" />
        </div>
        <span className="text-xl font-bold tracking-tight neon-text">izinet</span>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link key={item.path} to={item.path}>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-3 h-12 px-4 rounded-xl transition-all duration-200",
                  isActive 
                    ? "bg-primary/10 text-primary hover:bg-primary/20" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <item.icon className={cn("w-5 h-5", isActive && "neon-text")} />
                <span className="font-medium">{item.label}</span>
              </Button>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border space-y-4">
        <div className="flex flex-col gap-2 px-4 text-[10px] text-muted-foreground w-full">
          <Link to="/terms" className="hover:text-primary transition-colors">Правила сервиса</Link>
          <Link to="/refund" className="hover:text-primary transition-colors">Политика возвратов</Link>
        </div>
        <Button
          variant="ghost"
          onClick={signOut}
          className="w-full justify-start gap-3 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl h-12"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Выйти</span>
        </Button>
      </div>
    </aside>
  );
}
