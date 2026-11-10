import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useLocation } from 'react-router-dom';

interface PageContainerProps {
  children: React.ReactNode;
}

export function PageContainer({ children }: PageContainerProps) {
  const location = useLocation();
  const isNoScrollPage = location.pathname === '/support' || location.pathname === '/wallet';

  return (
    <div className="flex h-screen bg-[#06080c] text-[#f1f4f7] overflow-hidden relative selection:bg-[#7bdcff]/30 selection:text-white">
      {/* Ambient background aura */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-0 right-1/4 w-[800px] h-[500px] bg-[radial-gradient(ellipse_at_top,rgba(13,23,34,0.45)_0%,transparent_65%)]" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(123,220,255,0.02)_0%,transparent_70%)] blur-[80px]" />
      </div>

      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 h-full relative z-10">
        <Header />
        <main className={`flex-1 flex flex-col min-h-0 ${isNoScrollPage ? 'overflow-hidden' : 'overflow-y-auto'} p-3.5 md:p-8 lg:p-10`}>
          <div className={`w-full ${isNoScrollPage ? 'flex-1 flex flex-col min-h-0 h-full' : 'max-w-6xl mx-auto space-y-4 md:space-y-8'}`}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
