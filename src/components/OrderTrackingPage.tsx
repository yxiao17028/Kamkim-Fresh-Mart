import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Mail,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { apiFetch, formatRM } from '../lib/api';
import { Lang } from '../types';
import { HostedGatewayModal } from './HostedGatewayModal';

interface OrderDetailResponse {
  order: {
    id: number;
    order_code: string;
    guest_access_token: string;
    customer_name: string;
    customer_phone: string;
    customer_email: string;
    fulfilment_type: 'delivery' | 'pickup';
    scheduled_slot_label: string;
    delivery_address: string;
    delivery_postcode: string;
    subtotal_sen: number;
    delivery_fee_sen: number;
    topup_fee_sen: number;
    total_sen: number;
    payment_method: string;
    order_status: string;
    payment_status: string;
    pos_sync_status: string;
    delivery_status: string;
    created_at: string;
  };
  items: Array<{
    id: number;
    product_id: number;
    sku: string;
    product_name: string;
    unit_label: string;
    unit_price_sen: number;
    quantity: number;
    line_total_sen: number;
    fulfilment_flag: 'normal' | 'unavailable';
    flag_reason: string;
    refunded_qty: number;
    refunded_amount_sen: number;
  }>;
  refunds: Array<{
    id: number;
    gateway_refund_id: string;
    amount_sen: number;
    reason: string;
    status: string;
    created_at: string;
  }>;
  delivery: {
    lalamove_order_id: string | null;
    status: string;
    topup_required_sen: number;
    driver_name: string;
    driver_phone: string;
    driver_plate: string;
    driver_lat: number | null;
    driver_lng: number | null;
    tracking_url: string;
    last_error: string;
  } | null;
  emails: Array<{ id: number; subject: string; body: string; created_at: string }>;
  ownerContact: {
    store_name: string;
    store_address: string;
    store_phone: string;
    store_whatsapp: string;
    owner_name: string;
    owner_email: string;
    owner_phone: string;
  };
}

export const OrderTrackingPage: React.FC<{
  orderCode: string;
  accessToken: string;
  lang: Lang;
  onReorder: (cartItems: Array<{ productId: number; quantity: number }>, notices: string[]) => void;
  onBack: () => void;
}> = ({ orderCode, accessToken, lang, onReorder, onBack }) => {
  const [data, setData] = useState<OrderDetailResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [topupSession, setTopupSession] = useState<{
    orderCode: string;
    gatewayRef: string;
    amountSen: number;
    method: string;
    isTopup: boolean;
  } | null>(null);

  const loadOrder = async () => {
    setLoading(true);
    setError('');
    try {
      const q = accessToken ? `?token=${encodeURIComponent(accessToken)}` : '';
      const res = await apiFetch<OrderDetailResponse>(`/api/orders/${encodeURIComponent(orderCode)}${q}`);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load order.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrder();
  }, [orderCode, accessToken]);

  const handlePayTopup = async () => {
    try {
      const res = await apiFetch<{ gatewayRef: string; amountSen: number; method: string }>(
        `/api/orders/${encodeURIComponent(orderCode)}/topup/initiate`,
        {
          method: 'POST',
          body: JSON.stringify({ token: accessToken, method: 'fpx' }),
        },
      );
      setTopupSession({ ...res, orderCode, isTopup: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start top-up payment.');
    }
  };

  const handleReorderClick = async () => {
    try {
      const res = await apiFetch<{ cartItems: Array<{ productId: number; quantity: number }>; notices: string[] }>(
        `/api/orders/${encodeURIComponent(orderCode)}/reorder`,
        {
          method: 'POST',
          body: JSON.stringify({ token: accessToken }),
        },
      );
      onReorder(res.cartItems, res.notices);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reorder.');
    }
  };

  if (loading) {
    return <div className="max-w-4xl mx-auto p-8 text-center text-stone-500">Loading order details...</div>;
  }
  if (error || !data) {
    return (
      <div className="max-w-xl mx-auto p-8 bg-white rounded-2xl border border-red-200 mt-8 text-center space-y-4">
        <div className="text-red-700 font-semibold">{error || 'Order not found'}</div>
        <button onClick={onBack} className="px-4 py-2 rounded-xl bg-stone-900 text-white text-sm">
          Back to Storefront
        </button>
      </div>
    );
  }

  const { order, items, refunds, delivery, emails, ownerContact } = data;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <button onClick={onBack} className="text-sm text-emerald-700 font-semibold hover:underline mb-1">
            ← Back to Storefront
          </button>
          <h2 className="text-2xl font-bold text-stone-900 flex items-center gap-3">
            Order <span className="font-mono">{order.order_code}</span>
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Guest Access Token (save to reopen): <code className="bg-stone-100 px-1.5 py-0.5 rounded">{order.guest_access_token}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadOrder}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-300 bg-white text-sm font-medium hover:bg-stone-50"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={handleReorderClick}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800"
          >
            Reorder Items
          </button>
        </div>
      </div>

      {/* Explicit No-Cancellation / No-Self-Refund Policy Banner (FR-009, FR-018, AT-13, AT-14) */}
      <div className="rounded-xl bg-amber-50 border border-amber-300 p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-sm text-amber-950">
          <span className="font-bold">Order Policy:</span>{' '}
          {lang === 'zh-CN'
            ? '已提交的订单无法在网站取消，亦不提供线上自助退款申请。如有任何修改、缺货或退款咨询，请直接联系店主。'
            : lang === 'ms-MY'
              ? 'Pesanan yang telah dihantar tidak boleh dibatalkan di laman web dan tiada permohonan bayaran balik dalam talian. Sila hubungi Pemilik kedai terus.'
              : 'Submitted orders cannot be cancelled via the website, and online customer refund requests are not supported. For any order enquiry or dispute, please contact the Owner directly.'}
        </div>
      </div>

      {/* Top-up Required Alert (FR-045, AT-11) */}
      {order.payment_status === 'Top-up Due' && delivery && delivery.topup_required_sen > 0 && (
        <div className="rounded-xl bg-rose-50 border border-rose-300 p-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-bold text-rose-950">Lalamove Delivery Fee Top-Up Required</div>
            <div className="text-sm text-rose-900 mt-1">
              The previous Lalamove quotation expired and the updated rate requires an additional{' '}
              <span className="font-bold">{formatRM(delivery.topup_required_sen)}</span> before rider dispatch.
            </div>
          </div>
          <button
            onClick={handlePayTopup}
            className="px-4 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-semibold text-sm"
          >
            Pay Top-up ({formatRM(delivery.topup_required_sen)})
          </button>
        </div>
      )}

      {/* Status Cards */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 uppercase">Order Status</div>
          <div className="text-lg font-bold text-stone-900 mt-1">{order.order_status}</div>
          <div className="text-xs text-stone-500 mt-1">{order.scheduled_slot_label}</div>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 uppercase">Payment Status</div>
          <div className="text-lg font-bold text-emerald-700 mt-1">
            {order.payment_status} ({order.payment_method.toUpperCase().replace(/_/g, ' ')})
          </div>
          <div className="text-xs text-stone-500 mt-1">Total: {formatRM(order.total_sen)}</div>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <div className="text-xs font-medium text-stone-500 uppercase">
            {order.fulfilment_type === 'delivery' ? 'Lalamove Delivery' : 'Self-Pickup'}
          </div>
          <div className="text-lg font-bold text-stone-900 mt-1">{order.delivery_status}</div>
          <div className="text-xs text-stone-500 mt-1">
            {order.fulfilment_type === 'delivery'
              ? `${order.delivery_address} (${order.delivery_postcode})`
              : ownerContact.store_address}
          </div>
        </div>
      </div>

      {/* Conditional Rider Map / Fallback Tracking Link (FR-011, FR-047, AT-18) */}
      {order.fulfilment_type === 'delivery' && delivery && (
        <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-bold text-stone-900 flex items-center gap-2">
              <Truck className="w-5 h-5 text-emerald-700" />
              Delivery & Rider Tracking
            </div>
            {delivery.lalamove_order_id && (
              <span className="text-xs font-mono bg-stone-100 px-2.5 py-1 rounded-full">
                {delivery.lalamove_order_id}
              </span>
            )}
          </div>
          {delivery.driver_name ? (
            <div className="grid md:grid-cols-2 gap-4 items-center">
              <div className="text-sm space-y-1">
                <div>
                  <span className="text-stone-500">Rider:</span> <span className="font-semibold">{delivery.driver_name}</span> ({delivery.driver_plate})
                </div>
                <div>
                  <span className="text-stone-500">Contact:</span> {delivery.driver_phone}
                </div>
                {delivery.tracking_url && (
                  <a
                    href={delivery.tracking_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-700 font-semibold hover:underline mt-1"
                  >
                    Open Lalamove Tracking Link <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
              {delivery.driver_lat != null && delivery.driver_lng != null ? (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-950 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-emerald-700 shrink-0" />
                  <div>
                    <div className="font-semibold">Live Authorised Rider Coordinates</div>
                    <div className="font-mono mt-0.5">
                      Lat {delivery.driver_lat.toFixed(4)}, Lng {delivery.driver_lng.toFixed(4)} (Sungai Long Corridor)
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-stone-100 border border-stone-200 p-3 text-xs text-stone-700">
                  Precise live map coordinates are currently unavailable from the courier; please use the status badge and Lalamove tracking link above (AT-18 fallback).
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-stone-600">
              {delivery.status === 'Waiting for Slot'
                ? 'Your order is packed and waiting for your scheduled delivery pickup window.'
                : delivery.last_error || 'Rider will be booked once your order is packed and within the eligible slot.'}
            </div>
          )}
        </div>
      )}

      {/* Items & Merchant Refunds */}
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200 font-bold text-stone-900 flex items-center gap-2">
          <Package className="w-5 h-5 text-emerald-700" /> Order Items
        </div>
        <div className="divide-y divide-stone-200">
          {items.map((item) => (
            <div key={item.id} className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="font-semibold text-stone-900">{item.product_name}</div>
                <div className="text-xs text-stone-500">
                  SKU: {item.sku} · {item.unit_label} · {formatRM(item.unit_price_sen)} × {item.quantity}
                </div>
                {item.fulfilment_flag === 'unavailable' && (
                  <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-xs font-semibold">
                    Unavailable: {item.flag_reason}
                  </div>
                )}
                {item.refunded_qty > 0 && (
                  <div className="mt-1 ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 text-xs font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Merchant Refunded: {item.refunded_qty} unit(s) (
                    {formatRM(item.refunded_amount_sen)})
                  </div>
                )}
              </div>
              <div className="font-bold text-stone-900">{formatRM(item.line_total_sen)}</div>
            </div>
          ))}
        </div>
        <div className="bg-stone-50 px-5 py-4 border-t border-stone-200 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-stone-600">Subtotal</span>
            <span>{formatRM(order.subtotal_sen)}</span>
          </div>
          {order.delivery_fee_sen > 0 && (
            <div className="flex justify-between">
              <span className="text-stone-600">Lalamove Delivery Fee</span>
              <span>{formatRM(order.delivery_fee_sen)}</span>
            </div>
          )}
          {order.topup_fee_sen > 0 && (
            <div className="flex justify-between">
              <span className="text-stone-600">Delivery Top-up Paid</span>
              <span>{formatRM(order.topup_fee_sen)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base pt-2 border-t border-stone-200">
            <span>Total</span>
            <span className="text-emerald-700">{formatRM(order.total_sen)}</span>
          </div>
        </div>
      </div>

      {refunds.length > 0 && (
        <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-3">
          <h3 className="font-bold text-stone-900">Merchant-Processed Gateway Refunds</h3>
          <div className="space-y-2 text-sm">
            {refunds.map((rf) => (
              <div key={rf.id} className="flex flex-wrap justify-between items-center p-3 rounded-xl bg-stone-50 border border-stone-200">
                <div>
                  <div className="font-mono text-xs text-stone-500">{rf.gateway_refund_id}</div>
                  <div className="font-medium text-stone-900">{rf.reason}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-emerald-700">{formatRM(rf.amount_sen)}</div>
                  <div className="text-xs font-semibold">{rf.status}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Owner Contact & Email Notifications */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-2">
          <div className="font-bold text-emerald-950 flex items-center gap-2">
            <Phone className="w-4 h-4" /> Store Owner Contact (Disputes & Enquiries)
          </div>
          <div className="text-sm text-emerald-900">
            <div>{ownerContact.owner_name}</div>
            <div>Phone: {ownerContact.owner_phone}</div>
            <div>WhatsApp: {ownerContact.store_whatsapp}</div>
            <div>Email: {ownerContact.owner_email}</div>
          </div>
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-2">
          <div className="font-bold text-stone-900 flex items-center gap-2">
            <Mail className="w-4 h-4 text-emerald-700" /> Order Email Notifications
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto text-xs">
            {emails.map((em) => (
              <div key={em.id} className="p-2 rounded bg-stone-50 border border-stone-200">
                <div className="font-semibold text-stone-800">{em.subject}</div>
                <div className="text-stone-600 mt-0.5">{em.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {topupSession && (
        <HostedGatewayModal
          session={topupSession}
          onComplete={() => {
            setTopupSession(null);
            loadOrder();
          }}
          onClose={() => setTopupSession(null)}
        />
      )}
    </div>
  );
};
