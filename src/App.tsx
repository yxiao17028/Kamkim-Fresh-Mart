import React, { useEffect, useState } from 'react';
import { apiFetch } from './lib/api';
import { AdminUser } from './types';
import { StorefrontApp } from './components/StorefrontApp';
import { AdminLoginPage } from './components/AdminLoginPage';
import { AdminDashboard } from './components/AdminDashboard';

export function App() {
  const isAdminRoute = window.location.pathname.startsWith('/admin');
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [checkingAdmin, setCheckingAdmin] = useState(isAdminRoute);

  useEffect(() => {
    if (!isAdminRoute) return;
    apiFetch<{ admin: AdminUser }>('/api/admin/auth/me')
      .then((res) => setAdminUser(res.admin))
      .catch(() => setAdminUser(null))
      .finally(() => setCheckingAdmin(false));
  }, [isAdminRoute]);

  if (isAdminRoute) {
    if (checkingAdmin) {
      return (
        <div className="min-h-screen bg-stone-950 text-stone-300 flex items-center justify-center text-sm">
          Verifying admin session...
        </div>
      );
    }
    if (!adminUser) {
      return <AdminLoginPage onSuccess={(u) => setAdminUser(u)} />;
    }
    return <AdminDashboard admin={adminUser} onLogout={() => setAdminUser(null)} />;
  }

  return <StorefrontApp />;
}

export default App;
