import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Box,
  CheckCircle2,
  ClipboardList,
  LogOut,
  RefreshCw,
  RotateCcw,
  Settings,
  Shield,
  Store,
  Truck,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { apiFetch, formatRM } from '../lib/api';
import { AdminUser } from '../types';

interface AdminOrderItem {
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
}

interface AdminOrder {
  id: number;
  order_code: string;
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
  items: AdminOrderItem[];
  delivery: {
    lalamove_order_id: string | null;
    status: string;
    topup_required_sen: number;
    tracking_url: string;
    last_error: string;
  } | null;
  refunds: Array<{
    id: number;
    gateway_refund_id: string;
    amount_sen: number;
    reason: string;
    status: string;
    error_message: string;
    initiated_by_name: string;
    created_at: string;
  }>;
}

interface AdminProduct {
  id: number;
  pospal_uid: string;
  sku: string;
  name: string;
  name_zh: string;
  name_ms: string;
  category: string;
  base_price_sen: number;
  pospal_stock: number;
  sellable_stock: number;
  pospal_revision: number;
  unit_label: string;
  short_desc_en: string;
  extended_desc_en: string;
  extended_desc_zh: string;
  extended_desc_ms: string;
  image_url: string;
  is_featured: number;
  is_active: number;
}

function playBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, 180);
  } catch {
    // Browser blocked audio until interaction
  }
}

export const AdminDashboard: React.FC<{ admin: AdminUser; onLogout: () => void }> = ({ admin, onLogout }) => {
  const [tab, setTab] = useState<'orders' | 'catalogue' | 'pospal' | 'reports' | 'staff' | 'settings' | 'audit'>('orders');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [alerts, setAlerts] = useState<Array<{ title: string; message: string; severity?: string; timestamp: string }>>([]);
  const [toast, setToast] = useState('');

  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [pospalData, setPospalData] = useState<{
    outageMode: boolean;
    safetyStockBuffer: number;
    connection?: { mode: 'live' | 'mock'; apiBase: string; account: string; maskedAppId: string };
    outbox: Array<{ id: number; event_type: string; sku: string; product_name: string; delta: number; status: string; attempts: number; last_error: string; created_at: string }>;
    ledger: Array<{ id: number; sku: string; product_name: string; delta: number; balance_after: number; reason: string; reference_id: string; note: string; created_at: string }>;
    mockProducts: Array<{ pospal_uid: string; sku: string; name: string; category: string; base_price_sen: number; stock_on_hand: number; revision: number }>;
  } | null>(null);
  const [reportPeriod, setReportPeriod] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [reportData, setReportData] = useState<{
    summary: Record<string, number>;
    topSellers: Array<{ product_name: string; sku: string; units_sold: number; gross_sen: number }>;
    disclaimer: string;
  } | null>(null);
  const [staffList, setStaffList] = useState<Array<{ id: number; username: string; display_name: string; email: string; role: string; can_process_refunds: number; is_active: number }>>([]);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [auditData, setAuditData] = useState<{
    logs: Array<{ id: number; actor_type: string; actor_name: string; action: string; entity_type: string; entity_id: string; details_json: string; created_at: string }>;
    emails: Array<{ id: number; recipient: string; subject: string; body: string; lang: string; created_at: string }>;
  } | null>(null);

  // Modals state
  const [refundOrder, setRefundOrder] = useState<AdminOrder | null>(null);
  const [refundQtyMap, setRefundQtyMap] = useState<Record<number, number>>({});
  const [refundReason, setRefundReason] = useState('Item unavailable during store packing');

  const [editProduct, setEditProduct] = useState<AdminProduct | null>(null);
  const [stockAdjustTarget, setStockAdjustTarget] = useState<{ product: AdminProduct; delta: string; note: string } | null>(null);
  const [remoteSimForm, setRemoteSimForm] = useState({ pospalUid: 'PP-1001', name: '', basePriceSen: '', stockOnHand: '' });
  const [debugEndpoint, setDebugEndpoint] = useState('/openapi/v3/product/increment-page');
  const [debugBodyText, setDebugBodyText] = useState(
    JSON.stringify(
      {
        account: 'KAMKIM',
        lastId: 0,
        order: 'asc',
        limit: 10,
        needCategory: true,
        needImages: true,
        needMainUnit: true,
      },
      null,
      2,
    ),
  );
  const [debugResult, setDebugResult] = useState<string>('');
  const [debugLoading, setDebugLoading] = useState(false);
  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [catalogueLowStockOnly, setCatalogueLowStockOnly] = useState(false);
  const [catalogueLimit, setCatalogueLimit] = useState(50);
  const [orderFilter, setOrderFilter] = useState<'all' | 'active' | 'exception' | 'completed'>('all');
  const [showOrderTestSim, setShowOrderTestSim] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [logView, setLogView] = useState<'audit' | 'emails'>('audit');
  const [contactForm, setContactForm] = useState({ storePhone: '', storeWhatsapp: '', ownerName: '', ownerEmail: '', ownerPhone: '' });
  const [newStaff, setNewStaff] = useState({ username: '', displayName: '', email: '', password: '', canProcessRefunds: false });

  const loadAll = async () => {
    const [ordRes, prodRes, posRes, repRes, audRes, setRes] = await Promise.all([
      apiFetch<{ orders: AdminOrder[] }>('/api/admin/orders'),
      apiFetch<{ products: AdminProduct[] }>('/api/admin/products'),
      apiFetch<typeof pospalData>('/api/admin/pospal'),
      apiFetch<typeof reportData>(`/api/admin/reports?period=${reportPeriod}`),
      apiFetch<typeof auditData>('/api/admin/audit-logs'),
      apiFetch<{ settings: Record<string, unknown> }>('/api/admin/settings'),
    ]);
    setOrders(ordRes.orders);
    setProducts(prodRes.products);
    setPospalData(posRes);
    setReportData(repRes);
    setAuditData(audRes);
    setSettings(setRes.settings);
    if (setRes.settings) {
      setContactForm({
        storePhone: String(setRes.settings.store_phone || ''),
        storeWhatsapp: String(setRes.settings.store_whatsapp || ''),
        ownerName: String(setRes.settings.owner_name || ''),
        ownerEmail: String(setRes.settings.owner_email || ''),
        ownerPhone: String(setRes.settings.owner_phone || ''),
      });
    }

    if (admin.role === 'owner') {
      const stRes = await apiFetch<{ users: typeof staffList }>('/api/admin/staff');
      setStaffList(stRes.users);
    }
  };

  useEffect(() => {
    loadAll();
  }, [reportPeriod]);

  useEffect(() => {
    const es = new EventSource('/api/admin/events', { withCredentials: true });
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed.type === 'connected') return;
        setAlerts((prev) => [parsed, ...prev].slice(0, 10));
        setToast(`${parsed.title}: ${parsed.message}`);
        if (soundEnabled) playBeep();
        loadAll();
      } catch {
        // ignore parse errors
      }
    };
    return () => es.close();
  }, [soundEnabled]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 5000);
  };

  const handleLogout = async () => {
    await apiFetch('/api/admin/auth/logout', { method: 'POST' });
    onLogout();
  };

  const handleStatusChange = async (orderId: number, status: string) => {
    try {
      const res = await apiFetch<{ lalamoveResult?: { message?: string } }>(`/api/admin/orders/${orderId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      showToast(res.lalamoveResult?.message || `Order updated to ${status}`);
      loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Status update failed');
    }
  };

  const handleCollectPayAtStore = async (orderId: number) => {
    try {
      await apiFetch(`/api/admin/orders/${orderId}/collect-pay-at-store`, { method: 'POST' });
      showToast('Pay at Store payment collected & order marked Completed.');
      loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to record collection payment');
    }
  };

  const handleFlagUnavailable = async (orderId: number, itemId: number) => {
    const reason = window.prompt('Reason for unavailability:', 'Out of physical shelf stock during packing');
    if (reason === null) return;
    try {
      await apiFetch(`/api/admin/orders/${orderId}/flag-unavailable`, {
        method: 'POST',
        body: JSON.stringify({ orderItemIds: [itemId], reason }),
      });
      showToast('Item flagged unavailable & customer notified.');
      loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to flag item');
    }
  };

  const handleBookLalamove = async (orderId: number, forceFreshQuoteIncrease = false) => {
    try {
      const res = await apiFetch<{ message: string }>(`/api/admin/orders/${orderId}/lalamove/book`, {
        method: 'POST',
        body: JSON.stringify({ forceFreshQuoteIncrease }),
      });
      showToast(res.message);
      loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Lalamove booking failed');
    }
  };

  const handleSimDelivery = async (orderId: number, status: string) => {
    try {
      await apiFetch(`/api/admin/orders/${orderId}/lalamove/simulate-status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      showToast(`Lalamove status simulated: ${status}`);
      loadAll();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Simulation failed');
    }
  };

  const openRefundModal = (order: AdminOrder) => {
    const initial: Record<number, number> = {};
    for (const it of order.items) {
      if (it.fulfilment_flag === 'unavailable' && it.quantity - it.refunded_qty > 0) {
        initial[it.id] = it.quantity - it.refunded_qty;
      }
    }
    setRefundQtyMap(initial);
    setRefundOrder(order);
  };

  const submitRefund = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refundOrder) return;
    const selected = Object.entries(refundQtyMap)
      .filter(([, qty]) => qty > 0)
      .map(([id, quantity]) => ({ orderItemId: Number(id), quantity }));
    try {
      const res = await apiFetch<{ status: string; amountSen: number; gatewayRefundId: string; errorMessage?: string }>(
        `/api/admin/orders/${refundOrder.id}/refund`,
        {
          method: 'POST',
          body: JSON.stringify({
            items: selected,
            reason: refundReason,
            idempotencyKey: `ui-rf-${refundOrder.id}-${Date.now()}`,
          }),
        },
      );
      showToast(
        res.status === 'Success'
          ? `Refund ${res.gatewayRefundId} (${formatRM(res.amountSen)}) succeeded. Physical stock unchanged.`
          : `Refund status: ${res.status}. ${res.errorMessage || ''}`,
      );
      setRefundOrder(null);
      loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Refund failed');
    }
  };

  const refundComputedSen = refundOrder
    ? refundOrder.items.reduce((acc, it) => acc + (refundQtyMap[it.id] || 0) * it.unit_price_sen, 0)
    : 0;

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 flex flex-col">
      {/* Top Admin Header */}
      <header className="bg-stone-950 text-white px-4 py-3 border-b border-stone-800">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center font-extrabold">KK</div>
            <div>
              <div className="font-bold text-sm flex items-center gap-2">
                KamKim Admin
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-400 text-stone-950">
                  {admin.role === 'owner' ? 'Owner' : 'Staff'}
                </span>
              </div>
              <div className="text-xs text-stone-400">
                {admin.displayName} · Refunds: {admin.canProcessRefunds ? 'Allowed' : 'Owner Only'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {pospalData?.outageMode && (
              <span className="px-2.5 py-1 rounded-full bg-red-600 text-white text-xs font-bold animate-pulse">
                POSPAL DEGRADED MODE
              </span>
            )}
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              title="Toggle incoming order alert sound"
              className="p-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button
              onClick={loadAll}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
            <a
              href="/"
              className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs font-semibold text-stone-200"
            >
              Storefront ↗
            </a>
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800 text-xs font-semibold text-red-100"
            >
              <LogOut className="w-3.5 h-3.5" /> Logout
            </button>
          </div>
        </div>
      </header>

      {toast && (
        <div className="bg-emerald-900 text-white text-xs px-4 py-2.5 text-center font-medium">
          {toast}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="bg-white border-b border-stone-200 px-4">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-1 py-2 text-xs font-semibold">
          {[
            { id: 'orders', label: `Orders (${orders.filter((o) => o.order_status !== 'Completed').length}/${orders.length})`, icon: ClipboardList },
            { id: 'catalogue', label: 'Products & Stock', icon: Box },
            { id: 'pospal', label: 'POSPAL Sync', icon: RefreshCw },
            { id: 'reports', label: 'Reports', icon: BarChart3 },
            ...(admin.role === 'owner'
              ? [
                  { id: 'staff', label: 'Staff', icon: Users },
                  { id: 'settings', label: 'Settings', icon: Settings },
                ]
              : []),
            { id: 'audit', label: 'Logs', icon: Shield },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id as typeof tab)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl transition ${
                  tab === item.id ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <main className="max-w-7xl w-full mx-auto px-4 py-6 flex-1 space-y-6">
        {alerts.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 font-semibold text-amber-950">
              <Bell className="w-4 h-4 text-amber-700" />
              Latest Realtime Alert: {alerts[0].title} — {alerts[0].message}
            </div>
            <button onClick={() => setAlerts([])} className="text-amber-800 underline">
              Clear
            </button>
          </div>
        )}

        {/* ORDERS TAB */}
        {tab === 'orders' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: 'all', label: `All (${orders.length})` },
                  { id: 'active', label: `Active (${orders.filter((o) => !['Completed', 'Exception'].includes(o.order_status)).length})` },
                  { id: 'exception', label: `Exceptions (${orders.filter((o) => o.order_status === 'Exception').length})` },
                  { id: 'completed', label: `Completed (${orders.filter((o) => o.order_status === 'Completed').length})` },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setOrderFilter(f.id as typeof orderFilter)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
                      orderFilter === f.id ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200 text-stone-700'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-xs text-stone-500">
                <span>Flag unavailable items to enable Owner gateway refund.</span>
                <label className="flex items-center gap-1.5 cursor-pointer text-stone-700 font-medium">
                  <input
                    type="checkbox"
                    checked={showOrderTestSim}
                    onChange={(e) => setShowOrderTestSim(e.target.checked)}
                  />
                  Test Sim
                </label>
              </div>
            </div>

            {orders.filter((o) => {
              if (orderFilter === 'active') return !['Completed', 'Exception'].includes(o.order_status);
              if (orderFilter === 'exception') return o.order_status === 'Exception';
              if (orderFilter === 'completed') return o.order_status === 'Completed';
              return true;
            }).length === 0 ? (
              <div className="bg-white rounded-2xl border border-stone-200 p-10 text-center text-sm text-stone-500">
                No orders in this view.
              </div>
            ) : (
              orders
                .filter((o) => {
                  if (orderFilter === 'active') return !['Completed', 'Exception'].includes(o.order_status);
                  if (orderFilter === 'exception') return o.order_status === 'Exception';
                  if (orderFilter === 'completed') return o.order_status === 'Completed';
                  return true;
                })
                .map((order) => (
                <div key={order.id} className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-100 pb-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-extrabold text-base">{order.order_code}</span>
                        <span className="px-2.5 py-0.5 rounded-full bg-stone-900 text-white text-xs font-bold">
                          {order.order_status}
                        </span>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            order.payment_status === 'Paid'
                              ? 'bg-emerald-100 text-emerald-800'
                              : order.payment_status === 'Top-up Due'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {order.payment_status} ({order.payment_method.toUpperCase().replace(/_/g, ' ')})
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-800 text-xs font-semibold">
                          POSPAL: {order.pos_sync_status}
                        </span>
                      </div>
                      <div className="text-xs text-stone-600 mt-1">
                        {order.customer_name} · {order.customer_phone} · {order.customer_email} ·{' '}
                        <strong>{order.fulfilment_type.toUpperCase()}</strong> ({order.scheduled_slot_label})
                      </div>
                      {order.fulfilment_type === 'delivery' && (
                        <div className="text-xs text-stone-500 mt-0.5">
                          Deliver to: {order.delivery_address} ({order.delivery_postcode}) · Delivery Status:{' '}
                          <strong>{order.delivery_status}</strong>
                          {order.delivery?.lalamove_order_id ? ` · ${order.delivery.lalamove_order_id}` : ''}
                        </div>
                      )}
                    </div>

                    <div className="text-right">
                      <div className="text-lg font-extrabold text-emerald-700">{formatRM(order.total_sen)}</div>
                      <div className="text-[11px] text-stone-400">{new Date(order.created_at).toLocaleString()}</div>
                    </div>
                  </div>

                  {/* Line Items */}
                  <div className="divide-y divide-stone-100 text-sm">
                    {order.items.map((item) => (
                      <div key={item.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-semibold">{item.product_name}</span>{' '}
                          <span className="text-xs text-stone-500">
                            ({item.sku}) × {item.quantity} @ {formatRM(item.unit_price_sen)}
                          </span>
                          {item.fulfilment_flag === 'unavailable' && (
                            <span className="ml-2 px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-xs font-semibold">
                              Unavailable: {item.flag_reason}
                            </span>
                          )}
                          {item.refunded_qty > 0 && (
                            <span className="ml-2 px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 text-xs font-semibold">
                              Refunded {item.refunded_qty} ({formatRM(item.refunded_amount_sen)})
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{formatRM(item.line_total_sen)}</span>
                          {item.fulfilment_flag !== 'unavailable' && order.order_status !== 'Completed' && (
                            <button
                              onClick={() => handleFlagUnavailable(order.id, item.id)}
                              className="px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold"
                            >
                              Flag Unavailable
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Refund Records */}
                  {order.refunds.length > 0 && (
                    <div className="bg-stone-50 rounded-xl p-3 text-xs space-y-1 border border-stone-200">
                      <div className="font-bold text-stone-700">Gateway Refund Transactions:</div>
                      {order.refunds.map((rf) => (
                        <div key={rf.id} className="flex justify-between">
                          <span>
                            {rf.gateway_refund_id} · {rf.reason} (by {rf.initiated_by_name})
                          </span>
                          <span className={rf.status === 'Success' ? 'text-emerald-700 font-bold' : 'text-red-600 font-bold'}>
                            {rf.status} · {formatRM(rf.amount_sen)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action Toolbar (No Cancel Button!) */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-100">
                    {['Preparing', 'Exception'].includes(order.order_status) && (
                      <button
                        onClick={() => handleStatusChange(order.id, 'Ready')}
                        className="px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                      >
                        {order.fulfilment_type === 'pickup' ? 'Mark Ready for Collection' : 'Mark Ready for Pickup'}
                      </button>
                    )}

                    {order.fulfilment_type === 'pickup' &&
                      order.payment_method === 'pay_at_store' &&
                      order.payment_status === 'Unpaid' && (
                        <button
                          onClick={() => handleCollectPayAtStore(order.id)}
                          className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-stone-950 text-xs font-bold"
                        >
                          Confirm Store Payment Collected & Complete
                        </button>
                      )}

                    {order.fulfilment_type === 'pickup' &&
                      order.payment_status === 'Paid' &&
                      order.order_status !== 'Completed' && (
                        <button
                          onClick={() => handleStatusChange(order.id, 'Completed')}
                          className="px-3 py-1.5 rounded-xl bg-stone-900 text-white text-xs font-semibold"
                        >
                          Mark Collected / Completed
                        </button>
                      )}

                    {order.fulfilment_type === 'delivery' &&
                      ['Ready', 'Exception'].includes(order.order_status) &&
                      order.payment_status === 'Paid' &&
                      !order.delivery?.lalamove_order_id && (
                        <>
                          <button
                            onClick={() => handleBookLalamove(order.id, false)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold"
                          >
                            <Truck className="w-3.5 h-3.5" /> Book Lalamove
                          </button>
                          {showOrderTestSim && (
                            <button
                              onClick={() => handleBookLalamove(order.id, true)}
                              className="px-3 py-1.5 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-xs font-semibold"
                            >
                              Sim Quote Surge (+RM6)
                            </button>
                          )}
                        </>
                      )}

                    {showOrderTestSim && order.delivery?.lalamove_order_id && order.delivery_status !== 'Delivered' && (
                      <>
                        <button
                          onClick={() => handleSimDelivery(order.id, 'Picked Up')}
                          className="px-3 py-1.5 rounded-xl border border-stone-300 text-xs font-semibold"
                        >
                          Sim: Picked Up
                        </button>
                        <button
                          onClick={() => handleSimDelivery(order.id, 'Delivered')}
                          className="px-3 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-semibold"
                        >
                          Sim: Delivered
                        </button>
                      </>
                    )}

                    {/* Merchant-only Item-Level Gateway Refund button */}
                    {admin.canProcessRefunds &&
                      order.items.some((i) => i.fulfilment_flag === 'unavailable' && i.quantity - i.refunded_qty > 0) && (
                        <button
                          onClick={() => openRefundModal(order)}
                          className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-bold ml-auto"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Initiate Item Gateway Refund
                        </button>
                      )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* CATALOGUE & STOCK TAB */}
        {tab === 'catalogue' && (
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm">
            <div className="px-5 py-4 border-b border-stone-200 flex flex-wrap justify-between items-center gap-3">
              <div>
                <h2 className="font-bold text-base">Products & Stock ({products.length})</h2>
                <p className="text-xs text-stone-500">
                  Name, price & stock sync with POSPAL. Images & descriptions stay local.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={catalogueLowStockOnly}
                    onChange={(e) => {
                      setCatalogueLowStockOnly(e.target.checked);
                      setCatalogueLimit(50);
                    }}
                    className="rounded border-stone-300 text-emerald-700"
                  />
                  Low / Out of Stock (≤5)
                </label>
                <input
                  value={catalogueQuery}
                  onChange={(e) => {
                    setCatalogueQuery(e.target.value);
                    setCatalogueLimit(50);
                  }}
                  placeholder="Search SKU, name, or category..."
                  className="px-3 py-1.5 rounded-xl border border-stone-300 text-xs w-60"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-xs uppercase text-stone-500 border-b border-stone-200">
                  <tr>
                    <th className="text-left px-4 py-3">SKU / UID</th>
                    <th className="text-left px-4 py-3">Product</th>
                    <th className="text-left px-4 py-3">Category</th>
                    <th className="text-right px-4 py-3">Price</th>
                    <th className="text-right px-4 py-3">POSPAL / Online</th>
                    <th className="text-right px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {products
                    .filter((p) => {
                      if (catalogueLowStockOnly && p.sellable_stock > 5) return false;
                      if (!catalogueQuery.trim()) return true;
                      const q = catalogueQuery.toLowerCase();
                      return `${p.sku} ${p.name} ${p.category} ${p.pospal_uid}`.toLowerCase().includes(q);
                    })
                    .slice(0, catalogueLimit)
                    .map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-mono text-xs">
                        <div>{p.sku}</div>
                        <div className="text-stone-400">
                          {p.pospal_uid} (r{p.pospal_revision})
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{p.name}</div>
                        <div className="text-xs text-stone-500">{p.name_zh}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">{p.category}</td>
                      <td className="px-4 py-3 text-right font-bold">{formatRM(p.base_price_sen)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono">
                          {p.pospal_stock} / <strong className="text-emerald-700">{p.sellable_stock}</strong>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          onClick={() => setEditProduct({ ...p })}
                          className="px-2.5 py-1 rounded-lg border border-stone-300 text-xs font-semibold hover:bg-stone-50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setStockAdjustTarget({ product: p, delta: '5', note: 'Physical restock count' })}
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold"
                        >
                          Adjust Stock
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {products.length > catalogueLimit && (
              <div className="p-4 border-t border-stone-200 text-center">
                <button
                  onClick={() => setCatalogueLimit((c) => c + 50)}
                  className="px-4 py-2 rounded-xl bg-stone-900 text-white text-xs font-semibold"
                >
                  Load More ({catalogueLimit} / {products.length} shown)
                </button>
              </div>
            )}
          </div>
        )}

        {/* POSPAL SYNC TAB */}
        {tab === 'pospal' && pospalData && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-stone-200 p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <h2 className="font-bold text-base">POSPAL Sync</h2>
                <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 font-semibold">
                    {pospalData.connection?.mode === 'live' ? 'Live V3' : 'Sandbox Mock'}
                  </span>
                  <span>Account: <strong>{pospalData.connection?.account || 'N/A'}</strong></span>
                  <span>· AppId: <code>{pospalData.connection?.maskedAppId || '-'}</code></span>
                  <span className={pospalData.outageMode ? 'text-red-600 font-bold' : 'text-emerald-700 font-semibold'}>
                    · {pospalData.outageMode ? 'Outage Mode' : 'Healthy'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {pospalData.connection?.mode === 'live' && (
                  <button
                    onClick={async () => {
                      try {
                        const r = await apiFetch<{ fetched: number; importedOrUpdated: number; conflictsResolved: number }>(
                          '/api/admin/pospal/pull-live',
                          { method: 'POST' },
                        );
                        showToast(
                          `Pulled ${r.fetched} items (${r.importedOrUpdated} updated).`,
                        );
                        loadAll();
                      } catch (e) {
                        showToast(e instanceof Error ? e.message : 'Live POSPAL pull failed');
                      }
                    }}
                    className="px-3.5 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold"
                  >
                    Pull Full Catalogue
                  </button>
                )}
                <button
                  onClick={async () => {
                    try {
                      const r = await apiFetch<{ productsReconciled: number; conflictsResolved: number }>('/api/admin/pospal/reconcile', {
                        method: 'POST',
                      });
                      showToast(`Synced stock for ${r.productsReconciled} items (${r.conflictsResolved} updated).`);
                      loadAll();
                    } catch (e) {
                      showToast(e instanceof Error ? e.message : 'Stock sync failed');
                    }
                  }}
                  className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                >
                  {pospalData.connection?.mode === 'live' ? 'Sync Stock Only' : 'Run Reconciliation'}
                </button>
                <button
                  onClick={async () => {
                    const r = await apiFetch<{ confirmed: number; failed: number; lastError?: string }>(
                      '/api/admin/pospal/flush',
                      { method: 'POST' },
                    );
                    showToast(
                      `Retry queue: ${r.confirmed} sent, ${r.failed} failed${r.lastError ? ` (${r.lastError})` : ''}`,
                    );
                    loadAll();
                  }}
                  className="px-3.5 py-2 rounded-xl border border-stone-300 text-xs font-semibold hover:bg-stone-50"
                >
                  Retry Failed ({pospalData.outbox.filter((j) => j.status === 'Failed' || j.status === 'Pending').length})
                </button>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-5">
              <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-3">
                <h3 className="font-bold text-sm">Outbound Sync Queue ({pospalData.outbox.length})</h3>
                <div className="space-y-2 max-h-72 overflow-y-auto text-xs">
                  {pospalData.outbox.length === 0 ? (
                    <div className="text-stone-400 py-6 text-center">Queue is empty.</div>
                  ) : (
                    pospalData.outbox.map((job) => (
                      <div key={job.id} className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 flex justify-between gap-2">
                        <div>
                          <div className="font-semibold">
                            #{job.id} · {job.event_type} · {job.sku} ({job.delta >= 0 ? `+${job.delta}` : job.delta})
                          </div>
                          {job.last_error && <div className="text-red-600 mt-0.5">{job.last_error}</div>}
                        </div>
                        <span
                          className={`px-2 py-0.5 h-fit rounded font-bold ${
                            job.status === 'Confirmed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : job.status === 'Failed'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {job.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-3">
                <h3 className="font-bold text-sm">Stock Ledger ({pospalData.ledger.length})</h3>
                <div className="space-y-2 max-h-72 overflow-y-auto text-xs">
                  {pospalData.ledger.length === 0 ? (
                    <div className="text-stone-400 py-6 text-center">No stock movements yet.</div>
                  ) : (
                    pospalData.ledger.map((l) => (
                      <div key={l.id} className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 flex justify-between gap-2">
                        <div>
                          <div className="font-semibold">
                            {l.sku} · {l.reason} ({l.delta >= 0 ? `+${l.delta}` : l.delta}) → Bal {l.balance_after}
                          </div>
                          <div className="text-stone-500">{l.note}</div>
                        </div>
                        <span className="font-mono text-stone-400">{l.reference_id}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Collapsible Developer & Testing Tools */}
            <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowDevTools(!showDevTools)}
                className="w-full px-5 py-3.5 text-left flex items-center justify-between text-xs font-bold text-stone-600 hover:bg-stone-50"
              >
                <span>Developer & API Testing Tools (V3 Debugger & Callback Simulator)</span>
                <span>{showDevTools ? 'Hide ▲' : 'Show ▼'}</span>
              </button>

              {showDevTools && (
                <div className="p-5 border-t border-stone-200 space-y-6">
                  {admin.role === 'owner' && pospalData.connection?.mode === 'live' && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="font-bold text-sm">POSPAL V3 API Debugger</h3>
                          <p className="text-xs text-stone-500">Signed server-side; appKey never leaves the backend.</p>
                        </div>
                        <div className="flex gap-2">
                          <select
                            value={debugEndpoint}
                            onChange={(e) => {
                              const ep = e.target.value;
                              setDebugEndpoint(ep);
                              if (ep === '/openapi/v3/product/increment-page') {
                                setDebugBodyText(
                                  JSON.stringify(
                                    {
                                      account: pospalData.connection?.account || 'KAMKIM',
                                      lastId: 0,
                                      order: 'asc',
                                      limit: 10,
                                      needCategory: true,
                                      needImages: true,
                                      needMainUnit: true,
                                    },
                                    null,
                                    2,
                                  ),
                                );
                              } else {
                                setDebugBodyText(
                                  JSON.stringify({ account: pospalData.connection?.account || 'KAMKIM', lastId: 0 }, null, 2),
                                );
                              }
                            }}
                            className="px-3 py-1.5 rounded-xl border border-stone-300 text-xs bg-white font-mono"
                          >
                            <option value="/openapi/v3/product/increment-page">increment-page</option>
                            <option value="/openapi/v3/product/stock-page">stock-page</option>
                            <option value="/openapi/v3/product/category-page">category-page</option>
                            <option value="/openapi/v3/product/supplier-page">supplier-page</option>
                            <option value="/openapi/v3/product/unit-page">unit-page</option>
                          </select>
                          <button
                            type="button"
                            disabled={debugLoading}
                            onClick={async () => {
                              setDebugLoading(true);
                              try {
                                const parsedBody = JSON.parse(debugBodyText);
                                const res = await apiFetch('/api/admin/pospal/debug', {
                                  method: 'POST',
                                  body: JSON.stringify({ endpointPath: debugEndpoint, body: parsedBody }),
                                });
                                setDebugResult(JSON.stringify(res, null, 2));
                              } catch (err) {
                                setDebugResult(err instanceof Error ? err.message : 'Debug request failed');
                              } finally {
                                setDebugLoading(false);
                              }
                            }}
                            className="px-4 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold disabled:opacity-50"
                          >
                            {debugLoading ? 'Sending...' : 'Send Request'}
                          </button>
                        </div>
                      </div>
                      <div className="grid lg:grid-cols-2 gap-3">
                        <textarea
                          rows={8}
                          value={debugBodyText}
                          onChange={(e) => setDebugBodyText(e.target.value)}
                          className="w-full p-3 rounded-xl border border-stone-300 font-mono text-xs bg-stone-50"
                        />
                        <pre className="w-full p-3 rounded-xl border border-stone-800 bg-stone-950 text-emerald-200 font-mono text-xs overflow-auto max-h-56">
                          {debugResult || '// Response appears here'}
                        </pre>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3 pt-4 border-t border-stone-200">
                    <h3 className="font-bold text-sm">Simulate Inbound `product.change` Callback</h3>
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const r = await apiFetch<{ applied: { reason: string; conflictDetected: boolean } }>(
                          '/api/admin/pospal/simulate-remote-change',
                          {
                            method: 'POST',
                            body: JSON.stringify({
                              pospalUid: remoteSimForm.pospalUid,
                              name: remoteSimForm.name || undefined,
                              basePriceSen: remoteSimForm.basePriceSen ? Number(remoteSimForm.basePriceSen) : undefined,
                              stockOnHand: remoteSimForm.stockOnHand ? Number(remoteSimForm.stockOnHand) : undefined,
                            }),
                          },
                        );
                        showToast(`POSPAL event: ${r.applied.reason}${r.applied.conflictDetected ? ' (conflict resolved)' : ''}.`);
                        loadAll();
                      }}
                      className="grid sm:grid-cols-5 gap-3"
                    >
                      <select
                        value={remoteSimForm.pospalUid}
                        onChange={(e) => setRemoteSimForm({ ...remoteSimForm, pospalUid: e.target.value })}
                        className="px-3 py-2 rounded-xl border border-stone-300 text-xs bg-white"
                      >
                        {pospalData.mockProducts.slice(0, 100).map((mp) => (
                          <option key={mp.pospal_uid} value={mp.pospal_uid}>
                            {mp.sku} (stock {mp.stock_on_hand})
                          </option>
                        ))}
                      </select>
                      <input
                        value={remoteSimForm.name}
                        onChange={(e) => setRemoteSimForm({ ...remoteSimForm, name: e.target.value })}
                        placeholder="New Name (optional)"
                        className="px-3 py-2 rounded-xl border border-stone-300 text-xs"
                      />
                      <input
                        type="number"
                        value={remoteSimForm.basePriceSen}
                        onChange={(e) => setRemoteSimForm({ ...remoteSimForm, basePriceSen: e.target.value })}
                        placeholder="New Price in sen"
                        className="px-3 py-2 rounded-xl border border-stone-300 text-xs"
                      />
                      <input
                        type="number"
                        value={remoteSimForm.stockOnHand}
                        onChange={(e) => setRemoteSimForm({ ...remoteSimForm, stockOnHand: e.target.value })}
                        placeholder="New Stock"
                        className="px-3 py-2 rounded-xl border border-stone-300 text-xs"
                      />
                      <button type="submit" className="px-3 py-2 rounded-xl bg-stone-900 text-white text-xs font-semibold">
                        Trigger Event
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* REPORTS TAB */}
        {tab === 'reports' && reportData && (
          <div className="space-y-6">
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-xs text-amber-950 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
              <div>
                <strong>Scope Disclosure (FR-029 / AT-16):</strong> {reportData.disclaimer}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Online Sales & Gateway Refund Reconciliation</h2>
              <div className="flex gap-1 bg-white border border-stone-200 rounded-xl p-1 text-xs font-semibold">
                {(['daily', 'weekly', 'monthly'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setReportPeriod(p)}
                    className={`px-3 py-1.5 rounded-lg capitalize ${
                      reportPeriod === p ? 'bg-emerald-700 text-white' : 'text-stone-600'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-2xl border border-stone-200 p-4">
                <div className="text-xs text-stone-500">Gross Paid Online Revenue</div>
                <div className="text-2xl font-extrabold text-stone-900 mt-1">
                  {formatRM(reportData.summary.grossPaidRevenueSen)}
                </div>
                <div className="text-xs text-stone-500 mt-1">{reportData.summary.paidOrderCount} paid orders</div>
              </div>
              <div className="bg-white rounded-2xl border border-stone-200 p-4">
                <div className="text-xs text-stone-500">Item-Level Gateway Refunded</div>
                <div className="text-2xl font-extrabold text-rose-700 mt-1">
                  {formatRM(reportData.summary.itemRefundedTotalSen)}
                </div>
                <div className="text-xs text-stone-500 mt-1">
                  Pending: {reportData.summary.refundPendingCount} · Failed: {reportData.summary.refundFailedCount}
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-stone-200 p-4">
                <div className="text-xs text-stone-500">Net Online Sales (Excl. Refunds)</div>
                <div className="text-2xl font-extrabold text-emerald-700 mt-1">
                  {formatRM(reportData.summary.netSalesSen)}
                </div>
                <div className="text-xs text-stone-500 mt-1">Exceptions: {reportData.summary.exceptionCount}</div>
              </div>
              <div className="bg-white rounded-2xl border border-stone-200 p-4">
                <div className="text-xs text-stone-500">Unpaid Pay-at-Store Pickup</div>
                <div className="text-2xl font-extrabold text-amber-700 mt-1">
                  {formatRM(reportData.summary.unpaidPayAtStoreSen)}
                </div>
                <div className="text-xs text-stone-500 mt-1">{reportData.summary.unpaidOrderCount} unpaid pickups</div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-stone-200 p-5">
              <h3 className="font-bold text-sm mb-3">Top Selling Online Products</h3>
              {reportData.topSellers.length === 0 ? (
                <div className="text-xs text-stone-500">No sales recorded in this window.</div>
              ) : (
                <div className="divide-y divide-stone-100 text-sm">
                  {reportData.topSellers.map((ts) => (
                    <div key={ts.sku} className="py-2 flex justify-between">
                      <span>
                        <strong>{ts.product_name}</strong> ({ts.sku})
                      </span>
                      <span>
                        {ts.units_sold} units · <strong>{formatRM(ts.gross_sen)}</strong>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* STAFF MANAGEMENT TAB (OWNER ONLY) */}
        {tab === 'staff' && admin.role === 'owner' && (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
              <h2 className="font-bold text-lg">Staff & Owner Accounts (Two-Role RBAC)</h2>
              <div className="divide-y divide-stone-100 text-sm">
                {staffList.map((u) => (
                  <div key={u.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-bold">
                        {u.display_name} <span className="font-mono text-xs text-stone-500">(@{u.username})</span>
                      </div>
                      <div className="text-xs text-stone-500">
                        Role: <strong>{u.role.toUpperCase()}</strong> · Refund Permission:{' '}
                        {u.role === 'owner' || u.can_process_refunds === 1 ? 'Allowed' : 'Blocked'} ·{' '}
                        {u.is_active === 1 ? 'Active' : 'Disabled'}
                      </div>
                    </div>
                    {u.role !== 'owner' && (
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            await apiFetch(`/api/admin/staff/${u.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ canProcessRefunds: u.can_process_refunds !== 1 }),
                            });
                            loadAll();
                          }}
                          className="px-2.5 py-1 rounded-lg border border-stone-300 text-xs font-semibold"
                        >
                          {u.can_process_refunds === 1 ? 'Revoke Refund Auth' : 'Authorise Refunds'}
                        </button>
                        <button
                          onClick={async () => {
                            await apiFetch(`/api/admin/staff/${u.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ isActive: u.is_active !== 1 }),
                            });
                            loadAll();
                          }}
                          className="px-2.5 py-1 rounded-lg bg-stone-900 text-white text-xs font-semibold"
                        >
                          {u.is_active === 1 ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
              <h3 className="font-bold text-base">Create Staff Account</h3>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await apiFetch('/api/admin/staff', {
                      method: 'POST',
                      body: JSON.stringify({ ...newStaff, role: 'staff' }),
                    });
                    setNewStaff({ username: '', displayName: '', email: '', password: '', canProcessRefunds: false });
                    showToast('Staff account created.');
                    loadAll();
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : 'Failed to create staff');
                  }
                }}
                className="space-y-3 text-sm"
              >
                <input
                  required
                  value={newStaff.username}
                  onChange={(e) => setNewStaff({ ...newStaff, username: e.target.value })}
                  placeholder="Username"
                  className="w-full px-3 py-2 rounded-xl border border-stone-300"
                />
                <input
                  required
                  value={newStaff.displayName}
                  onChange={(e) => setNewStaff({ ...newStaff, displayName: e.target.value })}
                  placeholder="Display Name"
                  className="w-full px-3 py-2 rounded-xl border border-stone-300"
                />
                <input
                  required
                  type="email"
                  value={newStaff.email}
                  onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                  placeholder="Email"
                  className="w-full px-3 py-2 rounded-xl border border-stone-300"
                />
                <input
                  required
                  type="password"
                  value={newStaff.password}
                  onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })}
                  placeholder="Password (min 6 chars)"
                  className="w-full px-3 py-2 rounded-xl border border-stone-300"
                />
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={newStaff.canProcessRefunds}
                    onChange={(e) => setNewStaff({ ...newStaff, canProcessRefunds: e.target.checked })}
                  />
                  Explicitly authorise this staff member to process item-level gateway refunds
                </label>
                <button type="submit" className="w-full py-2.5 rounded-xl bg-emerald-700 text-white font-bold text-sm">
                  Add Staff Member
                </button>
              </form>
            </div>
          </div>
        )}

        {/* SETTINGS TAB (OWNER ONLY) */}
        {tab === 'settings' && admin.role === 'owner' && settings && (
          <div className="grid lg:grid-cols-2 gap-6">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await apiFetch('/api/admin/settings', {
                  method: 'PATCH',
                  body: JSON.stringify(contactForm),
                });
                showToast('Store & Owner contact details saved.');
                loadAll();
              }}
              className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4 text-sm"
            >
              <h2 className="font-bold text-base flex items-center gap-2">
                <Store className="w-4 h-4 text-emerald-700" /> Store & Owner Contact Info
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-500 mb-1">Owner Name</label>
                  <input
                    value={contactForm.ownerName}
                    onChange={(e) => setContactForm({ ...contactForm, ownerName: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-500 mb-1">Owner Email</label>
                  <input
                    type="email"
                    value={contactForm.ownerEmail}
                    onChange={(e) => setContactForm({ ...contactForm, ownerEmail: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-500 mb-1">Owner Phone</label>
                  <input
                    value={contactForm.ownerPhone}
                    onChange={(e) => setContactForm({ ...contactForm, ownerPhone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-500 mb-1">WhatsApp</label>
                  <input
                    value={contactForm.storeWhatsapp}
                    onChange={(e) => setContactForm({ ...contactForm, storeWhatsapp: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300"
                  />
                </div>
              </div>
              <button type="submit" className="px-5 py-2 rounded-xl bg-emerald-700 text-white font-bold text-xs">
                Save Contact Info
              </button>
            </form>

            <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
              <div>
                <h2 className="font-bold text-base">Testing Failure Simulators</h2>
                <p className="text-xs text-stone-500">Use only for QA testing (keep OFF in production).</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                {[
                  { key: 'pospal_outage_mode', prop: 'pospalOutageMode', label: 'POSPAL Outage Mode' },
                  { key: 'lalamove_force_price_increase', prop: 'lalamoveForcePriceIncrease', label: 'Lalamove Surge (+RM6)' },
                  { key: 'lalamove_hide_coordinates', prop: 'lalamoveHideCoordinates', label: 'Hide Rider Coordinates' },
                  { key: 'gateway_force_refund_failure', prop: 'gatewayForceRefundFailure', label: 'Gateway Refund Failure' },
                ].map((toggle) => {
                  const active = settings[toggle.key] === 1;
                  return (
                    <button
                      key={toggle.key}
                      onClick={async () => {
                        await apiFetch('/api/admin/settings', {
                          method: 'PATCH',
                          body: JSON.stringify({ [toggle.prop]: !active }),
                        });
                        loadAll();
                      }}
                      className={`p-3 rounded-xl border text-left flex items-center justify-between ${
                        active ? 'border-rose-400 bg-rose-50 text-rose-900' : 'border-stone-200 bg-stone-50'
                      }`}
                    >
                      <span className="font-semibold text-xs">{toggle.label}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${active ? 'bg-rose-600 text-white' : 'bg-stone-200'}`}>
                        {active ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* LOGS TAB */}
        {tab === 'audit' && auditData && (
          <div className="bg-white rounded-2xl border border-stone-200 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-bold text-base">System Logs</h2>
              <div className="flex gap-1 bg-stone-100 p-1 rounded-xl text-xs font-semibold">
                <button
                  onClick={() => setLogView('audit')}
                  className={`px-3 py-1.5 rounded-lg ${logView === 'audit' ? 'bg-white shadow text-stone-900' : 'text-stone-600'}`}
                >
                  Audit Trail ({auditData.logs.length})
                </button>
                <button
                  onClick={() => setLogView('emails')}
                  className={`px-3 py-1.5 rounded-lg ${logView === 'emails' ? 'bg-white shadow text-stone-900' : 'text-stone-600'}`}
                >
                  Customer Emails ({auditData.emails.length})
                </button>
              </div>
            </div>

            {logView === 'audit' ? (
              <div className="space-y-2 max-h-[520px] overflow-y-auto text-xs">
                {auditData.logs.map((l) => (
                  <div key={l.id} className="p-2.5 rounded-xl bg-stone-50 border border-stone-200 flex flex-wrap justify-between gap-2">
                    <div>
                      <span className="font-semibold">{l.action}</span>{' '}
                      <span className="text-stone-500">
                        · {l.actor_name} ({l.actor_type}) · {l.entity_type}:{l.entity_id}
                      </span>
                    </div>
                    <span className="text-stone-400">{new Date(l.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-y-auto text-xs">
                {auditData.emails.map((em) => (
                  <div key={em.id} className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                    <div className="flex justify-between font-semibold">
                      <span>{em.subject}</span>
                      <span className="text-stone-400">{new Date(em.created_at).toLocaleString()}</span>
                    </div>
                    <div className="text-stone-500 mt-0.5">To: {em.recipient} ({em.lang})</div>
                    <div className="text-stone-700 mt-1">{em.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Merchant Item-Level Gateway Refund Modal */}
      {refundOrder && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-stone-200 pb-3">
              <h3 className="font-bold text-lg">Merchant Item-Level Gateway Refund · {refundOrder.order_code}</h3>
              <button onClick={() => setRefundOrder(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {refundOrder.payment_method === 'pay_at_store' ? (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-sm text-amber-950">
                <strong>Pay at Store Order:</strong> No online payment gateway transaction exists for this order. Follow Owner offline settlement policy outside the gateway.
              </div>
            ) : (
              <form onSubmit={submitRefund} className="space-y-4">
                <div className="space-y-2">
                  {refundOrder.items
                    .filter((i) => i.fulfilment_flag === 'unavailable' && i.quantity - i.refunded_qty > 0)
                    .map((item) => {
                      const maxQty = item.quantity - item.refunded_qty;
                      return (
                        <div key={item.id} className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-between gap-3">
                          <div className="text-sm">
                            <div className="font-semibold">{item.product_name}</div>
                            <div className="text-xs text-stone-500">
                              {formatRM(item.unit_price_sen)} each · Max eligible: {maxQty}
                            </div>
                          </div>
                          <input
                            type="number"
                            min={0}
                            max={maxQty}
                            value={refundQtyMap[item.id] ?? 0}
                            onChange={(e) =>
                              setRefundQtyMap({
                                ...refundQtyMap,
                                [item.id]: Math.max(0, Math.min(maxQty, Number(e.target.value))),
                              })
                            }
                            className="w-20 px-2.5 py-1.5 rounded-lg border border-stone-300 text-sm text-right font-bold"
                          />
                        </div>
                      );
                    })}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-600 mb-1">Merchant Refund Reason *</label>
                  <input
                    required
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                  />
                </div>

                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1">
                  <div className="flex justify-between font-bold text-sm">
                    <span>Computed Gateway Refund Amount</span>
                    <span>{formatRM(refundComputedSen)}</span>
                  </div>
                  <div>Note: Refund is financial-only. Physical stock is NOT automatically increased (FR-037).</div>
                </div>

                <button
                  type="submit"
                  disabled={refundComputedSen <= 0}
                  className="w-full py-2.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-bold text-sm disabled:opacity-50"
                >
                  Confirm & Submit Gateway Refund ({formatRM(refundComputedSen)})
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Edit Product Modal */}
      {editProduct && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg">Edit Product · {editProduct.sku}</h3>
              <button onClick={() => setEditProduct(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await apiFetch(`/api/admin/products/${editProduct.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    name: editProduct.name,
                    nameZh: editProduct.name_zh,
                    nameMs: editProduct.name_ms,
                    category: editProduct.category,
                    basePriceSen: Number(editProduct.base_price_sen),
                    extendedDescEn: editProduct.extended_desc_en,
                    imageUrl: editProduct.image_url,
                  }),
                });
                setEditProduct(null);
                showToast('Product updated (shared fields queued to POSPAL; media saved locally).');
                loadAll();
              }}
              className="space-y-3 text-sm"
            >
              <div>
                <label className="block text-xs font-semibold text-stone-500">Shared POSPAL Name (EN)</label>
                <input
                  value={editProduct.name}
                  onChange={(e) => setEditProduct({ ...editProduct, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-stone-500">Chinese Name (Local)</label>
                  <input
                    value={editProduct.name_zh}
                    onChange={(e) => setEditProduct({ ...editProduct, name_zh: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-stone-500">Base Price (sen)</label>
                  <input
                    type="number"
                    value={editProduct.base_price_sen}
                    onChange={(e) => setEditProduct({ ...editProduct, base_price_sen: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-stone-300"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-500">Website Image URL (Local only)</label>
                <input
                  value={editProduct.image_url}
                  onChange={(e) => setEditProduct({ ...editProduct, image_url: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-500">Extended Description (Local only)</label>
                <textarea
                  rows={2}
                  value={editProduct.extended_desc_en}
                  onChange={(e) => setEditProduct({ ...editProduct, extended_desc_en: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300"
                />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-emerald-700 text-white font-bold">
                Save Changes
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {stockAdjustTarget && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-base">Audited Stock Adjustment · {stockAdjustTarget.product.sku}</h3>
              <button onClick={() => setStockAdjustTarget(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const r = await apiFetch<{ sellableStock: number; outboxStatus: string }>(
                    `/api/admin/products/${stockAdjustTarget.product.id}/stock-adjust`,
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        delta: Number(stockAdjustTarget.delta),
                        note: stockAdjustTarget.note,
                      }),
                    },
                  );
                  setStockAdjustTarget(null);
                  showToast(`Stock adjusted to ${r.sellableStock}. POSPAL Sync: ${r.outboxStatus}`);
                  loadAll();
                } catch (err) {
                  showToast(err instanceof Error ? err.message : 'Stock adjustment failed');
                }
              }}
              className="space-y-3 text-sm"
            >
              <div>
                <label className="block text-xs font-semibold text-stone-500">Delta (+/- integer)</label>
                <input
                  type="number"
                  required
                  value={stockAdjustTarget.delta}
                  onChange={(e) => setStockAdjustTarget({ ...stockAdjustTarget, delta: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-stone-500">Audit Note</label>
                <input
                  required
                  value={stockAdjustTarget.note}
                  onChange={(e) => setStockAdjustTarget({ ...stockAdjustTarget, note: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300"
                />
              </div>
              <button type="submit" className="w-full py-2.5 rounded-xl bg-emerald-700 text-white font-bold">
                Apply & Queue POSPAL Sync
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
