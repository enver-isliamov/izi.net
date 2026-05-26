import React from 'react';
import { Bell, Globe, User, Menu, ShieldCheck, LayoutDashboard, CreditCard, Wallet as WalletIcon, Download, LifeBuoy, Users, HelpCircle, Settings, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  { icon: WalletIcon, label: 'Кошелек', path: '/wallet' },
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
    <header className="h-16 border-b border-border bg-background/50 backdrop-blur-md flex items-center justify-between px-4 md:px-6 sticky top-0 z-40">
      <div className="flex items-center gap-4">
        {/* Mobile menu trigger */}
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger 
            render={
              <Button variant="ghost" size="icon" className="md:hidden rounded-lg">
                <Menu className="w-6 h-6" />
              </Button>
            }
          />
          <SheetContent side="left" className="w-[280px] bg-card border-r border-border p-0">
            <SheetHeader className="p-6 text-left border-b border-border">
              <SheetTitle className="flex items-center gap-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <ShieldCheck className="text-black w-5 h-5" />
                </div>
                <span className="text-xl font-bold tracking-tight neon-text">izinet</span>
              </SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col p-4 gap-1">
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
            <div className="absolute bottom-4 left-4 right-4 space-y-4">
              <div className="flex flex-col gap-2 px-4 text-[10px] text-muted-foreground w-full">
                <Link to="/terms" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-primary transition-colors">Правила сервиса</Link>
                <Link to="/refund" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-primary transition-colors">Политика возвратов</Link>
              </div>
              <Button
                variant="ghost"
                onClick={handleLogout}
                className="w-full justify-start gap-3 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl h-12"
              >
                <LogOut className="w-5 h-5" />
                <span className="font-medium">Выйти</span>
              </Button>
            </div>
          </SheetContent>
        </Sheet>
        
        <div className="md:hidden flex items-center gap-2">
           <ShieldCheck className="text-primary w-6 h-6" />
           <span className="text-lg font-bold">izinet</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isAdmin && (
          <Button
            variant="ghost"
            onClick={() => navigate('/admin')}
            className={cn(
              "h-10 px-4 gap-2 text-xs font-bold uppercase tracking-wider text-blue-400 hover:text-blue-300 hover:bg-blue-400/10 rounded-xl border border-blue-400/20 shadow-sm transition-all duration-200 cursor-pointer flex items-center",
              location.pathname.startsWith('/admin') && "bg-blue-400/10 border-blue-400/40"
            )}
          >
            <ShieldCheck className="w-4 h-4" />
            <span className="hidden sm:inline">Админ-панель</span>
          </Button>
        )}
        
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => navigate('/profile')}
          className={cn(
            "rounded-full bg-muted/50 border border-border w-10 h-10 hover:bg-muted font-medium transition-all duration-200 cursor-pointer flex items-center justify-center",
            location.pathname === '/profile' && "border-primary text-primary"
          )}
          title="Профиль"
        >
          <User className="w-5 h-5" />
        </Button>
      </div>
    </header>
  );
}
