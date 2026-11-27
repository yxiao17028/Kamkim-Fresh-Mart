import React, { useState } from 'react';
import { MapPin, Store, Truck, X } from 'lucide-react';
import { TRANSLATIONS } from '../i18n/translations';
import { apiFetch, formatRM } from '../lib/api';
import { CartItem, CustomerUser, LalamoveQuote, Lang, StoreInfo } from '../types';

export const CheckoutModal: React.FC<{
  cart: CartItem[];
  lang: Lang;
  storeInfo: StoreInfo;
  customer: CustomerUser | null;
  onClose: () => void;
  onOrderCreated: (res: {
    orderCode: string;
    guestAccessToken: string;
    paymentRequired: boolean;
    gatewayRef?: string;
    amountSen: number;
    method?: string;
  }) => void;
}> = ({ cart, lang, storeInfo, customer, onClose, onOrderCreated }) => {
  const t = TRANSLATIONS[lang];
  const [fulfilmentType, setFulfilmentType] = useState<'delivery' | 'pickup'>('delivery');
  const [slotId, setSlotId] = useState(storeInfo.availableSlots[0]?.slotId || 'immediate');
  const [customerName, setCustomerName] = useState(customer?.name || '');
  const [customerPhone, setCustomerPhone] = useState(customer?.phone || '');
  const [customerEmail, setCustomerEmail] = useState(customer?.email || '');
  const preferredAddr = customer?.preferredCheckoutAddress;
  const savedAddresses = customer?.addresses || [];
  const [address, setAddress] = useState(preferredAddr?.address || customer?.defaultAddress || '');
  const [postcode, setPostcode] = useState(preferredAddr?.postcode || customer?.defaultPostcode || '43000');
  const [saveAddress, setSaveAddress] = useState(false);
  const [addressLabel, setAddressLabel] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'fpx' | 'card' | 'tng' | 'grabpay' | 'pay_at_store'>('fpx');
  const [policyAccepted, setPolicyAccepted] = useState(false);

  const [quote, setQuote] = useState<LalamoveQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const subtotalSen = cart.reduce((acc, item) => acc + item.product.priceSen * item.quantity, 0);
  const deliveryFeeSen = fulfilmentType === 'delivery' ? quote?.feeSen || 0 : 0;
  const totalSen = subtotalSen + deliveryFeeSen;

  const handleGetQuote = async () => {
    setQuoteLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ quote: LalamoveQuote }>('/api/delivery/quote', {
        method: 'POST',
        body: JSON.stringify({ address, postcode }),
      });
      setQuote(res.quote);
    } catch (e) {
      setQuote(null);
      setError(e instanceof Error ? e.message : 'Unable to quote Lalamove delivery.');
    } finally {
      setQuoteLoading(false);
    }
  };

  const handleSwitchFulfilment = (next: 'delivery' | 'pickup') => {
    setFulfilmentType(next);
    setError('');
    if (next === 'delivery' && paymentMethod === 'pay_at_store') {
      setPaymentMethod('fpx');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (fulfilmentType === 'delivery' && !quote) {
      setError('Please check your Lalamove delivery quote before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{
        orderCode: string;
        guestAccessToken: string;
        paymentRequired: boolean;
        gatewayRef?: string;
        amountSen: number;
        method?: string;
      }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerEmail,
          lang,
          fulfilmentType,
          slotId,
          deliveryAddress: address,
          deliveryPostcode: postcode,
          deliveryNotes,
          saveAddress,
          addressLabel,
          paymentMethod,
          policyAccepted,
          quoteId: quote?.quoteId,
          items: cart.map((c) => ({ productId: c.product.id, quantity: c.quantity })),
        }),
      });
      onOrderCreated(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order creation failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-stone-200 overflow-hidden my-8">
        <div className="px-6 py-4 bg-emerald-900 text-white flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold">Checkout — KamKim Fresh Mart</h3>
            <p className="text-xs text-emerald-200">{t.noMinSpend}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-emerald-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Fulfilment Mode */}
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleSwitchFulfilment('delivery')}
              className={`p-3.5 rounded-xl border text-left flex items-center gap-3 transition ${
                fulfilmentType === 'delivery'
                  ? 'border-emerald-700 bg-emerald-50 ring-2 ring-emerald-600/20'
                  : 'border-stone-200 hover:bg-stone-50'
              }`}
            >
              <Truck className="w-5 h-5 text-emerald-700 shrink-0" />
              <div>
                <div className="font-semibold text-sm">{t.delivery}</div>
                <div className="text-xs text-stone-500">Live quote · Sungai Long & Klang Valley</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleSwitchFulfilment('pickup')}
              className={`p-3.5 rounded-xl border text-left flex items-center gap-3 transition ${
                fulfilmentType === 'pickup'
                  ? 'border-emerald-700 bg-emerald-50 ring-2 ring-emerald-600/20'
                  : 'border-stone-200 hover:bg-stone-50'
              }`}
            >
              <Store className="w-5 h-5 text-emerald-700 shrink-0" />
              <div>
                <div className="font-semibold text-sm">{t.selfPickup}</div>
                <div className="text-xs text-stone-500">Collect at 40G, Jalan SL 1/2 · Pay online or at store</div>
              </div>
            </button>
          </div>

          {/* Customer Contact */}
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">Full Name *</label>
              <input
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                placeholder="e.g. Tan Wei Ming"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">Phone *</label>
              <input
                required
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                placeholder="+6012-3456789"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-stone-600 mb-1">Email *</label>
              <input
                required
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                placeholder="you@example.com"
              />
            </div>
          </div>

          {/* Time Slot */}
          <div>
            <label className="block text-xs font-semibold text-stone-600 mb-1">
              Scheduled Fulfilment Slot (Asia/Kuala_Lumpur)
            </label>
            <select
              value={slotId}
              onChange={(e) => setSlotId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white"
            >
              {storeInfo.availableSlots.map((s) => (
                <option key={s.slotId} value={s.slotId}>
                  {s.dateLabel} — {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Delivery Address + Live Lalamove Quote */}
          {fulfilmentType === 'delivery' && (
            <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-3">
              <div className="font-semibold text-sm flex items-center justify-between gap-2 text-stone-800">
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-emerald-700" /> Delivery Address & Lalamove Quote
                </span>
                {preferredAddr?.source === 'last_order' && address.trim() === preferredAddr.address.trim() && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold">
                    {lang === 'zh-CN' ? '已优先填入上次订单地址' : 'Prioritized: Last Order'}
                  </span>
                )}
              </div>

              {customer && (preferredAddr || savedAddresses.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {preferredAddr?.source === 'last_order' && (
                    <button
                      type="button"
                      onClick={() => {
                        setAddress(preferredAddr.address);
                        setPostcode(preferredAddr.postcode || '43000');
                        setQuote(null);
                      }}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition ${
                        address.trim().toLowerCase() === preferredAddr.address.trim().toLowerCase()
                          ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                          : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      ★ {lang === 'zh-CN' ? '上次订单' : 'Last Order'}: {preferredAddr.address.slice(0, 26)}
                      {preferredAddr.address.length > 26 ? '…' : ''}
                    </button>
                  )}
                  {savedAddresses
                    .filter(
                      (sa) =>
                        !preferredAddr ||
                        preferredAddr.source !== 'last_order' ||
                        sa.address.trim().toLowerCase() !== preferredAddr.address.trim().toLowerCase(),
                    )
                    .map((sa) => (
                      <button
                        type="button"
                        key={sa.id}
                        onClick={() => {
                          setAddress(sa.address);
                          setPostcode(sa.postcode || '43000');
                          setQuote(null);
                        }}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition ${
                          address.trim().toLowerCase() === sa.address.trim().toLowerCase()
                            ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                            : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                        }`}
                      >
                        {sa.label}: {sa.address.slice(0, 24)}
                        {sa.address.length > 24 ? '…' : ''}
                      </button>
                    ))}
                </div>
              )}

              <div className="grid sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <input
                    required
                    value={address}
                    onChange={(e) => {
                      setAddress(e.target.value);
                      setQuote(null);
                    }}
                    placeholder="Street address, unit / condo name"
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white"
                  />
                </div>
                <div>
                  <input
                    required
                    value={postcode}
                    onChange={(e) => {
                      setPostcode(e.target.value);
                      setQuote(null);
                    }}
                    placeholder="Postcode (e.g. 43000)"
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white"
                  />
                </div>
              </div>
              {customer &&
                address.trim() &&
                savedAddresses.length < 5 &&
                !savedAddresses.some((sa) => sa.address.trim().toLowerCase() === address.trim().toLowerCase()) && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-700">
                    <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={saveAddress}
                        onChange={(e) => setSaveAddress(e.target.checked)}
                        className="rounded border-stone-300 text-emerald-700"
                      />
                      {lang === 'zh-CN'
                        ? `保存到我的地址簿 (${savedAddresses.length}/5)`
                        : `Save address to my profile (${savedAddresses.length}/5)`}
                    </label>
                    {saveAddress && (
                      <input
                        value={addressLabel}
                        onChange={(e) => setAddressLabel(e.target.value)}
                        placeholder={lang === 'zh-CN' ? '地址标签（如：公司）' : 'Label (e.g. Office)'}
                        className="px-2.5 py-1 rounded-lg border border-stone-300 bg-white text-xs"
                      />
                    )}
                  </div>
                )}
              <input
                value={deliveryNotes}
                onChange={(e) => setDeliveryNotes(e.target.value)}
                placeholder="Guardhouse / delivery notes (optional)"
                className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm bg-white"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={quoteLoading}
                  onClick={handleGetQuote}
                  className="px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold disabled:opacity-50"
                >
                  {quoteLoading ? 'Quoting Lalamove...' : t.getQuote}
                </button>
                {quote && (
                  <div className="text-sm font-semibold text-emerald-800">
                    {t.deliveryFee}: {formatRM(quote.feeSen)} ({quote.distanceKm} km · valid 5 min)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Payment Methods */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-stone-600">Payment Method</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {[
                { id: 'fpx', label: 'FPX Online Banking' },
                { id: 'card', label: 'Credit / Debit Card' },
                { id: 'tng', label: "Touch 'n Go eWallet" },
                { id: 'grabpay', label: 'GrabPay' },
                ...(fulfilmentType === 'pickup' ? [{ id: 'pay_at_store', label: 'Pay at Store (Cash/QR)' }] : []),
              ].map((m) => (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => setPaymentMethod(m.id as typeof paymentMethod)}
                  className={`px-3 py-2.5 rounded-xl border text-xs font-semibold text-left ${
                    paymentMethod === m.id
                      ? 'border-emerald-700 bg-emerald-50 text-emerald-900'
                      : 'border-stone-200 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {paymentMethod === 'pay_at_store' && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                {t.payAtStoreNote}
              </p>
            )}
          </div>

          {/* Totals */}
          <div className="rounded-xl bg-stone-50 border border-stone-200 p-4 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-stone-600">{t.subtotal}</span>
              <span>{formatRM(subtotalSen)}</span>
            </div>
            {fulfilmentType === 'delivery' && (
              <div className="flex justify-between">
                <span className="text-stone-600">{t.deliveryFee}</span>
                <span>{quote ? formatRM(deliveryFeeSen) : 'Quote required'}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base pt-2 border-t border-stone-200">
              <span>{t.total}</span>
              <span className="text-emerald-700">{formatRM(totalSen)}</span>
            </div>
          </div>

          {/* No-Cancel Policy Confirmation */}
          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 cursor-pointer">
            <input
              type="checkbox"
              checked={policyAccepted}
              onChange={(e) => setPolicyAccepted(e.target.checked)}
              className="mt-1 rounded border-amber-400 text-emerald-700"
            />
            <span className="text-xs text-amber-950 font-medium leading-relaxed">{t.policyCheckbox}</span>
          </label>

          {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}

          <button
            type="submit"
            disabled={submitting || !policyAccepted}
            className="w-full py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm disabled:opacity-50"
          >
            {submitting ? 'Submitting Order...' : `${t.placeOrder} · ${formatRM(totalSen)}`}
          </button>
        </form>
      </div>
    </div>
  );
};
