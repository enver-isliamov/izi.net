import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

interface PageContainerProps {
  children: React.ReactNode;
}

export function PageContainer({ children }: PageContainerProps) {
  return (
    <div className="flex min-h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto p-6 md:p-8 lg:p-10">
          <div className="max-w-6xl mx-auto space-y-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
