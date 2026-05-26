import React from 'react';
import { 
  Smartphone, 
  Monitor, 
  Apple, 
  ArrowLeft,
  Globe
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';

export default function Instructions() {
  const navigate = useNavigate();

  return (
    <div className="space-y-3 animate-in fade-in duration-300 max-w-sm mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 pb-1">
        <Button 
          variant="ghost" 
          size="icon" 
          className="rounded-xl h-8 w-8 text-text-muted-foreground hover:text-primary shrink-0"
          onClick={() => navigate('/dashboard')}
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Назад на главную</span>
      </div>

      {/* Card 1: INCY */}
      <Card className="glass-card border-primary/20 p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-lg shrink-0">
              <span className="font-black text-black text-sm tracking-tighter">IN</span>
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-white flex items-center gap-1.5">
                INCY <Badge className="bg-primary/20 text-primary border-primary/20 text-[8px] font-black uppercase tracking-wider py-0 px-1 hover:bg-primary/20">Рекомендуем</Badge>
              </h3>
              <p className="text-[10px] text-muted-foreground leading-tight">Простое официальное приложение</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button 
            variant="outline" 
            onClick={() => window.open('https://apps.apple.com/us/app/incy/id6756943388', '_blank')} 
            className="rounded-xl border-border hover:bg-white/5 text-[11px] font-bold h-9 gap-1.5 w-full py-1 px-2"
          >
            <Apple className="w-3.5 h-3.5 text-primary shrink-0" /> App Store (iOS)
          </Button>
          <Button 
            variant="outline" 
            onClick={() => window.open('https://play.google.com/store/apps/details?id=llc.itdev.incy', '_blank')} 
            className="rounded-xl border-border hover:bg-white/5 text-[11px] font-bold h-9 gap-1.5 w-full py-1 px-2"
          >
            <Smartphone className="w-3.5 h-3.5 text-primary shrink-0" /> Google Play
          </Button>
        </div>
      </Card>

      {/* Card 2: Hiddify */}
      <Card className="glass-card border-white/10 p-3.5 space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 border border-primary/20">
            <Globe className="text-primary w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-extrabold text-white">Hiddify</h3>
            <p className="text-[10px] text-muted-foreground leading-tight">Универсальный клиент под все ОС</p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button 
              variant="outline" 
              onClick={() => window.open('https://apps.apple.com/us/app/hiddify-proxy-vpn/id6596777532', '_blank')} 
              className="rounded-xl border-border hover:bg-white/5 text-[11px] font-bold h-9 gap-1.5 w-full py-1 px-1.5"
            >
              <Apple className="w-3.5 h-3.5 text-primary shrink-0" /> App Store (iOS)
            </Button>
            <Button 
              variant="outline" 
              onClick={() => window.open('https://play.google.com/store/apps/details?id=app.hiddify.com', '_blank')} 
              className="rounded-xl border-border hover:bg-white/5 text-[11px] font-bold h-9 gap-1.5 w-full py-1 px-1.5"
            >
              <Smartphone className="w-3.5 h-3.5 text-primary shrink-0" /> Google Play
            </Button>
          </div>
          
          <div className="grid grid-cols-2 gap-2">
            <Button 
              variant="outline" 
              onClick={() => window.open('https://github.com/hiddify/hiddify-next/releases', '_blank')} 
              className="rounded-xl border-border hover:bg-white/5 text-[11px] font-bold h-9 gap-1.5 w-full py-1 px-1.5"
            >
              <Monitor className="w-3.5 h-3.5 text-primary shrink-0" /> для Windows
            </Button>
            <Button 
              variant="outline" 
              onClick={() => window.open('https://github.com/hiddify/hiddify-next/releases', '_blank')} 
              className="rounded-xl border-border hover:bg-white/5 text-[11px] font-bold h-9 gap-1.5 w-full py-1 px-1.5"
            >
              <Apple className="w-3.5 h-3.5 text-primary shrink-0" /> для macOS
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
