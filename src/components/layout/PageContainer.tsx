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
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
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
