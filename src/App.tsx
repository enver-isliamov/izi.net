import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

// Real Pages
import Dashboard from '@/pages/Dashboard';
import Subscription from '@/pages/Subscription';
import Instructions from '@/pages/Instructions';
import Support from '@/pages/Support';
import Profile from '@/pages/Profile';
import Referrals from '@/pages/Referrals';
import FAQ from '@/pages/FAQ';
import Login from '@/pages/Login';
import Wallet from '@/pages/Wallet';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Загрузка...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default function App() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route 
              path="/*" 
              element={
                <ProtectedRoute>
                  <PageContainer>
                    <Routes>
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/subscription" element={<Subscription />} />
                      <Route path="/installation" element={<Instructions />} />
                      <Route path="/support" element={<Support />} />
                      <Route path="/profile" element={<Profile />} />
                      <Route path="/referrals" element={<Referrals />} />
                      <Route path="/wallet" element={<Wallet />} />
                      <Route path="/faq" element={<FAQ />} />
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                  </PageContainer>
                </ProtectedRoute>
              } 
            />
          </Routes>
          <Toaster position="top-right" theme="dark" />
        </Router>
      </TooltipProvider>
    </AuthProvider>
  );
}
