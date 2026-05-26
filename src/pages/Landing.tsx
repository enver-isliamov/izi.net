import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Shield, Zap, Globe, Lock, ArrowRight, CheckCircle, Server, Smartphone } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function Landing() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleCTA = () => {
    if (user) {
      navigate('/dashboard');
    } else {
      navigate('/login');
    }
  };

  return (
    <div className="min-h-screen bg-[#06080a] text-foreground font-sans selection:bg-primary/30 flex flex-col">
      {/* Navbar */}
      <nav className="border-b border-white/5 bg-[#06080a]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <span className="font-black text-white text-lg tracking-tight uppercase">izinet</span>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" className="text-muted-foreground hover:text-white hidden sm:flex" onClick={() => navigate('/login')}>
              Личный кабинет
            </Button>
            <Button onClick={handleCTA} className="bg-primary text-black hover:bg-primary/90 font-bold rounded-xl px-5 h-9">
              {user ? 'В панель' : 'Начать'}
            </Button>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative pt-20 pb-32 overflow-hidden">
          {/* Background Glow */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/10 blur-[120px] rounded-full pointer-events-none opacity-50"></div>
          
          <div className="max-w-4xl mx-auto px-4 text-center relative z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-emerald-400 mb-8 uppercase tracking-widest mx-auto">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Стабильно работает в {new Date().getFullYear()}
            </div>
            
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-black text-white tracking-tighter leading-[1.1] mb-6">
              Свободный интернет <br className="hidden sm:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-500">без границ и лимитов</span>
            </h1>
            
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              Защищенный и скоростной доступ ко всем мировым ресурсам. Умная маршрутизация: локальные сервисы работают напрямую, остальной мир — через защищенный туннель.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button onClick={handleCTA} className="bg-primary text-black hover:bg-primary/90 text-base font-bold h-14 px-8 rounded-2xl w-full sm:w-auto shadow-[0_0_40px_-10px_rgba(0,255,136,0.5)] transition-all hover:scale-105 duration-300">
                Начать использование <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </div>
            
            <div className="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-4 text-sm font-medium text-muted-foreground/60">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" /> Безлимитный трафик
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" /> Умный обход блокировок
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" /> Анонимность 100%
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-24 bg-[#0a0c10] border-y border-white/5 relative z-10">
          <div className="max-w-6xl mx-auto px-4">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight uppercase">Почему выбирают нас</h2>
              <p className="text-muted-foreground mt-4 max-w-xl mx-auto">Никаких падений, блокировок или сбоев. Только современный подход к организации сети.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="bg-[#111318] border border-white/5 p-8 rounded-3xl hover:border-primary/30 transition-colors group">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mb-6 group-hover:scale-110 transition-transform">
                  <Zap className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white mb-3">Умная маршрутизация</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Наши алгоритмы автоматически направляют трафик: Госуслуги, банки и доставки открываются напрямую, а недоступные сайты — через защищенный узел.
                </p>
              </div>

              <div className="bg-[#111318] border border-white/5 p-8 rounded-3xl hover:border-cyan-500/30 transition-colors group">
                <div className="w-12 h-12 bg-cyan-500/10 rounded-2xl flex items-center justify-center text-cyan-400 mb-6 group-hover:scale-110 transition-transform">
                  <Shield className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white mb-3">Современные протоколы</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Вместо устаревших и легко блокируемых протоколов мы используем передовые решения, маскирующее трафик под обычное посещение веб-сайтов.
                </p>
              </div>

              <div className="bg-[#111318] border border-white/5 p-8 rounded-3xl hover:border-purple-500/30 transition-colors group">
                <div className="w-12 h-12 bg-purple-500/10 rounded-2xl flex items-center justify-center text-purple-400 mb-6 group-hover:scale-110 transition-transform">
                  <Server className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white mb-3">Единая подписка</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Один тариф для всех ваших устройств. Телефоны, планшеты, компьютеры — подключайте до нескольких устройств одновременно за одну цену.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-24 relative z-10">
          <div className="max-w-4xl mx-auto px-4 text-center">
            <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight uppercase mb-12">Как начать?</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
              {/* Connector line */}
              <div className="hidden md:block absolute top-[40px] left-[15%] right-[15%] h-[2px] bg-gradient-to-r from-transparent via-white/10 to-transparent -z-10"></div>
              
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 bg-[#111318] border border-white/10 rounded-full flex items-center justify-center shadow-xl text-2xl font-black text-white mb-6">1</div>
                <h4 className="text-lg font-bold text-white mb-2">Создать аккаунт</h4>
                <p className="text-sm text-muted-foreground">Зарегистрируйтесь за пару кликов через удобную веб-панель.</p>
              </div>
              
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 bg-[#111318] border border-white/10 rounded-full flex items-center justify-center shadow-xl text-2xl font-black text-primary mb-6">2</div>
                <h4 className="text-lg font-bold text-white mb-2">Оформить подписку</h4>
                <p className="text-sm text-muted-foreground">Пополните баланс картой (РФ) или СБП и активируйте доступ.</p>
              </div>
              
              <div className="flex flex-col items-center">
                <div className="w-20 h-20 bg-primary shadow-[0_0_30px_-5px_rgba(0,255,136,0.3)] rounded-full flex items-center justify-center text-2xl font-black text-black mb-6">
                  <Smartphone className="w-8 h-8" />
                </div>
                <h4 className="text-lg font-bold text-white mb-2">Подключиться</h4>
                <p className="text-sm text-muted-foreground">Скопируйте ключ и вставьте в рекомендованное приложение.</p>
              </div>
            </div>
            
            <div className="mt-16">
               <Button onClick={handleCTA} className="bg-white text-black hover:bg-neutral-200 text-base font-bold h-12 px-8 rounded-xl shadow-xl transition-all hover:scale-105 duration-300">
                Зарегистрироваться
               </Button>
            </div>
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 text-center text-muted-foreground text-sm flex flex-col md:flex-row items-center justify-between max-w-6xl mx-auto w-full px-4 gap-4">
        <div className="flex items-center gap-2">
            <span className="font-extrabold uppercase tracking-wide text-white">izinet</span>
            <span className="opacity-50">© {new Date().getFullYear()}</span>
        </div>
        <div className="flex gap-6">
            <a href="/terms" className="hover:text-white transition-colors">Пользовательское соглашение</a>
            <a href="/privacy" className="hover:text-white transition-colors">Конфиденциальность</a>
        </div>
      </footer>
    </div>
  );
}
