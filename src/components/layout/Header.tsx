import React from 'react';
import { Menu, ShieldCheck, LayoutDashboard, Wallet as WalletIcon, Download, LifeBuoy, Users, HelpCircle, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const menuItems = [
  { icon: LayoutDashboard, label: 'Дашборд', path: '/dashboard' },
  { icon: Download, label: 'Установка', path: '/installation' },
  { icon: WalletIcon, label: 'Кошелёк', path: '/wallet' },
  { icon: Users, label: 'Рефералы', path: '/referrals' },
  { icon: LifeBuoy, label: 'Поддержка', path: '/support' },
  { icon: HelpCircle, label: 'FAQ', path: '/faq' },
];

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, role } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const isAdmin = role === 'admin' || role === 'superadmin';

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <header className="h-16 border-b border-white/[0.08] bg-[#06080c]/85 backdrop-blur-xl flex items-center justify-between px-4 md:px-8 sticky top-0 z-40">
      <div className="flex items-center gap-3">
        {/* Mobile menu trigger */}
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger 
            render={
              <Button variant="ghost" size="icon" className="md:hidden rounded-xl text-[#8d959f] hover:text-white hover:bg-white/[0.05]">
                <Menu className="w-5 h-5" />
              </Button>
            }
          />
          <SheetContent side="left" className="w-[280px] bg-[#080c12] border-r border-white/10 p-0 text-[#f1f4f7]">
            <SheetHeader className="p-6 text-left border-b border-white/10">
              <SheetTitle className="flex items-center gap-2.5">
                <div className="relative w-7 h-7 rounded-full border border-cyan-400/60 shadow-[0_0_12px_rgba(123,220,255,0.35)] flex items-center justify-center bg-cyan-950/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8be5f0] shadow-[0_0_8px_#6ae6ff]" />
                </div>
                <span className="text-xl font-bold tracking-tight text-white">
                  izi<span className="text-[#7bdcff]">net</span>
                </span>
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col p-3 gap-1">
              {menuItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link 
                    key={item.path} 
                    to={item.path} 
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
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
            <div className="absolute bottom-4 left-4 right-4 space-y-3">
              <div className="flex flex-col gap-1.5 px-3 text-[11px] text-[#59636f]">
                <Link to="/terms" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-[#7bdcff] transition-colors">Правила сервиса</Link>
                <Link to="/refund" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-[#7bdcff] transition-colors">Политика возвратов</Link>
                <Link to="/privacy" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-[#7bdcff] transition-colors">Конфиденциальность</Link>
              </div>
              <Button
                variant="ghost"
                onClick={handleLogout}
                className="w-full justify-start gap-3 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl h-10 text-xs font-medium"
              >
                <LogOut className="w-4 h-4" />
                <span>Выйти</span>
              </Button>
            </div>
          </SheetContent>
        </Sheet>
        
        {/* Mobile brand text */}
        <Link to="/" className="md:hidden flex items-center gap-2">
          <div className="relative w-6 h-6 rounded-full border border-cyan-400/60 flex items-center justify-center bg-cyan-950/30">
            <span className="w-1.5 h-1.5 rounded-full bg-[#8be5f0]" />
          </div>
          <span className="text-base font-bold text-white tracking-tight">
            izi<span className="text-[#7bdcff]">net</span>
          </span>
        </Link>
      </div>

      <div className="flex items-center gap-3">
        {isAdmin && (
          <Button
            variant="ghost"
            onClick={() => navigate('/admin')}
            className={cn(
              "h-9 px-3.5 gap-2 text-[11px] font-bold uppercase tracking-wider text-[#7bdcff] hover:text-white hover:bg-cyan-950/40 rounded-xl border border-cyan-400/30 shadow-sm transition-all flex items-center",
              location.pathname.startsWith('/admin') && "bg-cyan-950/50 border-cyan-400/50 text-white"
            )}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Админ-панель</span>
          </Button>
        )}
        
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => navigate('/profile')}
          className={cn(
            "rounded-full bg-[#0e141b]/80 border border-white/10 w-9 h-9 text-[#8d959f] hover:text-white hover:bg-[#19232c] transition-all flex items-center justify-center",
            location.pathname === '/profile' && "border-[#7bdcff] text-[#7bdcff] shadow-[0_0_15px_rgba(123,220,255,0.25)]"
          )}
          title="Профиль"
        >
          <User className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}
