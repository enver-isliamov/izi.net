import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';

// Real Pages
import Landing from '@/pages/Landing';
import Dashboard from '@/pages/Dashboard';
import Subscription from '@/pages/Subscription';
import Instructions from '@/pages/Instructions';
import Support from '@/pages/Support';
import Profile from '@/pages/Profile';
import Referrals from '@/pages/Referrals';
import FAQ from '@/pages/FAQ';
import Login from '@/pages/Login';
import UpdatePassword from '@/pages/UpdatePassword';
import Wallet from '@/pages/Wallet';

import Terms from '@/pages/Terms';
import RefundPolicy from '@/pages/RefundPolicy';
import PrivacyPolicy from '@/pages/PrivacyPolicy';

// Admin Pages
import AdminDashboard from '@/pages/Admin/Dashboard';
import AdminUsers from '@/pages/Admin/Users';
import AdminSettings from '@/pages/Admin/Settings';
import AdminPayments from '@/pages/Admin/Payments';
import AdminRouting from '@/pages/Admin/Routing';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <PageContainer>
        <div className="space-y-6 opacity-60">
          <div className="h-[200px] w-full bg-secondary/30 animate-pulse rounded-2xl" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             <div className="h-[120px] bg-secondary/30 animate-pulse rounded-2xl" />
             <div className="h-[120px] bg-secondary/30 animate-pulse rounded-2xl" />
             <div className="h-[120px] bg-secondary/30 animate-pulse rounded-2xl" />
          </div>
        </div>
      </PageContainer>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, role, isLoading } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-blue-400 font-mono tracking-widest animate-pulse">
      [ AUTHENTICATING_ACCESS_LEVEL ]
    </div>;
  }

  if (!user || (role !== 'admin' && role !== 'superadmin')) {
    console.warn('Unauthorized admin access attempt', { user, role });
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

export default function App() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <Router>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/update-password" element={<UpdatePassword />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/refund" element={<RefundPolicy />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/ref/:refCode" element={<NavigateWithRef />} />
            
            {/* Admin Routes */}
            <Route 
              path="/admin/*" 
              element={
                <AdminRoute>
                  <PageContainer>
                    <Routes>
                      <Route path="/" element={<AdminDashboard />} />
                      <Route path="/users" element={<AdminUsers />} />
                      <Route path="/payments" element={<AdminPayments />} />
                      <Route path="/settings" element={<AdminSettings />} />
                      <Route path="/routing" element={<AdminRouting />} />
                      <Route path="*" element={<Navigate to="/admin" replace />} />
                    </Routes>
                  </PageContainer>
                </AdminRoute>
              } 
            />

            <Route 
              path="/*" 
              element={
                <ProtectedRoute>
                  <PageContainer>
                    <Routes>
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/subscription" element={<Navigate to="/dashboard" replace />} />
                      <Route path="/installation" element={<Instructions />} />
                      <Route path="/support" element={<Support />} />
                      <Route path="/profile" element={<Profile />} />
                      <Route path="/referrals" element={<Referrals />} />
                      <Route path="/wallet" element={<Wallet />} />
                      <Route path="/faq" element={<FAQ />} />
                      <Route path="/" element={<Navigate to="/dashboard" replace />} />
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
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

function NavigateWithRef() {
  const { refCode } = useParams();
  useEffect(() => {
    if (refCode) {
      sessionStorage.setItem('referral_code', refCode);
    }
  }, [refCode]);
  return <Navigate to="/login" replace />;
}
