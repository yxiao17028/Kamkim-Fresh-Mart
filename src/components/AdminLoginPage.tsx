import React, { useState } from 'react';
import { ArrowLeft, KeyRound, Lock, ShieldAlert } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { AdminUser } from '../types';

export const AdminLoginPage: React.FC<{ onSuccess: (admin: AdminUser) => void }> = ({ onSuccess }) => {
  const [username, setUsername] = useState('owner');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ admin: AdminUser }>('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onSuccess(res.admin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-stone-900 border border-stone-800 rounded-2xl p-8 shadow-2xl space-y-6">
        <div className="flex items-center justify-between">
          <a href="/" className="inline-flex items-center gap-1.5 text-xs text-stone-400 hover:text-white">
            <ArrowLeft className="w-3.5 h-3.5" /> Return to Storefront
          </a>
          <span className="px-2.5 py-1 rounded-full bg-emerald-950 border border-emerald-800 text-emerald-300 text-[11px] font-semibold">
            Restricted Portal
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-700 text-white flex items-center justify-center mb-3">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">KamKim Admin Dashboard</h1>
          <p className="text-sm text-stone-400">
            Enter your Owner or Staff password to access store fulfilment, POSPAL sync, Lalamove dispatch, and reporting.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-stone-300 mb-1.5">Username</label>
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="owner or staff"
              className="w-full px-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-700 text-white text-sm focus:border-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-stone-300 mb-1.5">Password</label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-stone-500 absolute left-3.5 top-3" />
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter backend password"
                className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-stone-950 border border-stone-700 text-white text-sm focus:border-emerald-500 outline-none"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm transition disabled:opacity-50"
          >
            {loading ? 'Verifying Password...' : 'Sign In to Admin Dashboard'}
          </button>
        </form>

        <div className="rounded-xl bg-stone-950 border border-stone-800 p-3.5 text-xs text-stone-400 space-y-1">
          <div className="font-semibold text-stone-300">Default Sandbox Credentials (Two-Role RBAC):</div>
          <div>
            Owner (Full + Refunds + Staff): <code>owner</code> / <code>kamkim-owner-2026</code>
          </div>
          <div>
            Staff (Fulfilment + Exceptions only): <code>staff</code> / <code>kamkim-staff-2026</code>
          </div>
        </div>
      </div>
    </div>
  );
};
