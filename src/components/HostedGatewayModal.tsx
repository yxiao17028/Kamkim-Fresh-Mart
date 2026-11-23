import React, { useState } from 'react';
import { CreditCard, ShieldCheck, XCircle } from 'lucide-react';
import { apiFetch, formatRM } from '../lib/api';

export const HostedGatewayModal: React.FC<{
  session: {
    orderCode: string;
    gatewayRef: string;
    amountSen: number;
    method: string;
    isTopup?: boolean;
  };
  onComplete: () => void;
  onClose: () => void;
}> = ({ session, onComplete, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submitOutcome = async (outcome: 'Paid' | 'Failed') => {
    setLoading(true);
    setError('');
    try {
      await apiFetch('/api/sandbox/gateway/complete', {
        method: 'POST',
        body: JSON.stringify({
          gatewayRef: session.gatewayRef,
          orderCode: session.orderCode,
          outcome,
          channel: session.method,
        }),
      });
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment gateway error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-5">
        <div className="flex items-center justify-between border-b border-stone-200 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-stone-900">Malaysian Payment Gateway</div>
              <div className="text-xs text-stone-500">Hosted Sandbox Checkout · HMAC Signed Webhook</div>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-stone-100 text-xs font-semibold uppercase text-stone-700">
            {session.method}
          </span>
        </div>

        <div className="bg-stone-50 rounded-xl p-4 space-y-2 text-sm border border-stone-200">
          <div className="flex justify-between">
            <span className="text-stone-500">Order Reference</span>
            <span className="font-mono font-semibold">{session.orderCode}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-stone-500">Gateway Ref</span>
            <span className="font-mono text-xs">{session.gatewayRef}</span>
          </div>
          <div className="flex justify-between text-base font-bold text-stone-900 pt-2 border-t border-stone-200">
            <span>{session.isTopup ? 'Delivery Top-up Due' : 'Amount Payable'}</span>
            <span className="text-emerald-700">{formatRM(session.amountSen)}</span>
          </div>
        </div>

        <p className="text-xs text-stone-500 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>
            Authorisation triggers a signed server-to-server webhook callback before your order transitions to Preparing
            and deducts POSPAL stock (FR-017).
          </span>
        </p>

        {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>}

        <div className="grid grid-cols-2 gap-3">
          <button
            disabled={loading}
            onClick={() => submitOutcome('Failed')}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 font-semibold text-sm disabled:opacity-50"
          >
            <XCircle className="w-4 h-4" />
            Simulate Failed
          </button>
          <button
            disabled={loading}
            onClick={() => submitOutcome('Paid')}
            className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-sm disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Authorise Payment'}
          </button>
        </div>

        <button
          disabled={loading}
          onClick={onClose}
          className="w-full text-xs text-stone-500 hover:text-stone-700 py-1"
        >
          Close Window (Payment remains Pending)
        </button>
      </div>
    </div>
  );
};
