import React from 'react';
import { Bell, Globe, User } from 'lucide-react';
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
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function Header() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <header className="h-16 border-b border-border bg-background/50 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-40">
      <div className="flex items-center gap-4">
        {/* Mobile menu trigger could go here */}
      </div>

      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger 
            render={
              <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:text-primary">
                <Globe className="w-5 h-5" />
              </Button>
            } 
          />
          <TooltipContent>Сменить сервер</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger 
            render={
              <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:text-primary relative">
                <Bell className="w-5 h-5" />
                <span className="absolute top-2 right-2 w-2 h-2 bg-primary rounded-full neon-glow" />
              </Button>
            } 
          />
          <TooltipContent>Уведомления</TooltipContent>
        </Tooltip>
        
        <DropdownMenu>
          <DropdownMenuTrigger 
            render={
              <Button variant="ghost" size="icon" className="rounded-full bg-muted/50 border border-border ml-2">
                <User className="w-5 h-5" />
              </Button>
            } 
          />
          <DropdownMenuContent align="end" className="w-56 bg-card border-border">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Мой аккаунт</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-pointer" onClick={() => navigate('/profile')}>
                Профиль
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={() => navigate('/profile')}>
                Настройки
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive cursor-pointer" onClick={handleLogout}>
                Выйти
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
