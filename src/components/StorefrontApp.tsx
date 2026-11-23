import React, { useEffect, useMemo, useState } from 'react';
import {
  Globe,
  Lock,
  Minus,
  PackageSearch,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { TRANSLATIONS } from '../i18n/translations';
import { apiFetch, formatRM } from '../lib/api';
import { CartItem, CustomerUser, Lang, Product, StoreInfo } from '../types';
import { CheckoutModal } from './CheckoutModal';
import { HostedGatewayModal } from './HostedGatewayModal';
import { OrderTrackingPage } from './OrderTrackingPage';
import { PolicyPages } from './PolicyPages';

function getLocalizedName(p: Product, lang: Lang): string {
  if (lang === 'zh-CN' && p.nameZh) return p.nameZh;
  if (lang === 'ms-MY' && p.nameMs) return p.nameMs;
  return p.name;
}

function getLocalizedDesc(p: Product, lang: Lang): string {
  if (lang === 'zh-CN' && p.extendedDescZh) return p.extendedDescZh;
  if (lang === 'ms-MY' && p.extendedDescMs) return p.extendedDescMs;
  return p.extendedDescEn || p.shortDescEn;
}

export const StorefrontApp: React.FC = () => {
  const [lang, setLang] = useState<Lang>('en');
  const t = TRANSLATIONS[lang];

  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customer, setCustomer] = useState<CustomerUser | null>(null);
  const [customerOrders, setCustomerOrders] = useState<
    Array<{
      id: number;
      order_code: string;
      guest_access_token: string;
      fulfilment_type: string;
      scheduled_slot_label: string;
      total_sen: number;
      order_status: string;
      payment_status: string;
      created_at: string;
    }>
  >([]);

  const [activeTab, setActiveTab] = useState<'shop' | 'about' | 'policy' | 'contact' | 'orders' | 'track'>('shop');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(48);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '', phone: '', address: '', postcode: '43000' });
  const [authError, setAuthError] = useState('');

  const [trackLookup, setTrackLookup] = useState({ orderCode: '', token: '' });
  const [activeOrderView, setActiveOrderView] = useState<{ orderCode: string; token: string } | null>(null);
  const [gatewaySession, setGatewaySession] = useState<{
    orderCode: string;
    guestAccessToken: string;
    gatewayRef: string;
    amountSen: number;
    method: string;
  } | null>(null);
  const [bannerNotice, setBannerNotice] = useState('');

  const loadInitialData = async () => {
    const [info, prodRes, meRes] = await Promise.all([
      apiFetch<StoreInfo>('/api/store/info'),
      apiFetch<{ products: Product[] }>('/api/products'),
      apiFetch<{ customer: CustomerUser | null }>('/api/auth/me'),
    ]);
    setStoreInfo(info);
    setProducts(prodRes.products);
    setCustomer(meRes.customer);
    if (meRes.customer) {
      const ordRes = await apiFetch<{ orders: typeof customerOrders }>('/api/customer/orders');
      setCustomerOrders(ordRes.orders);
    }
  };

  useEffect(() => {
    loadInitialData();
    const params = new URLSearchParams(window.location.search);
    const code = params.get('order');
    const tok = params.get('token');
    if (code) {
      setActiveOrderView({ orderCode: code, token: tok || '' });
      setActiveTab('track');
    }
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>(['All']);
    for (const p of products) set.add(p.category);
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;
      if (inStockOnly && p.sellableStock <= 0) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${p.name} ${p.nameZh} ${p.nameMs} ${p.sku} ${p.category} ${p.shortDescEn}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, selectedCategory, inStockOnly, searchQuery]);

  const addToCart = (product: Product, qty = 1) => {
    if (product.outOfStock || product.sellableStock <= 0) return;
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product.id === product.id);
      if (idx >= 0) {
        const nextQty = Math.min(product.sellableStock, prev[idx].quantity + qty);
        const copy = [...prev];
        copy[idx] = { product, quantity: nextQty };
        return copy;
      }
      return [...prev, { product, quantity: Math.min(product.sellableStock, qty) }];
    });
  };

  const updateCartQty = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.product.id !== productId) return c;
          const next = Math.min(c.product.sellableStock, c.quantity + delta);
          return next <= 0 ? null : { ...c, quantity: next };
        })
        .filter((x): x is CartItem => x !== null),
    );
  };

  const cartCount = cart.reduce((acc, c) => acc + c.quantity, 0);
  const cartSubtotalSen = cart.reduce((acc, c) => acc + c.product.priceSen * c.quantity, 0);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (authMode === 'login') {
        const res = await apiFetch<{ customer: CustomerUser }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: authForm.email, password: authForm.password }),
        });
        setCustomer(res.customer);
      } else {
        const res = await apiFetch<{ customer: CustomerUser }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email: authForm.email,
            password: authForm.password,
            name: authForm.name,
            phone: authForm.phone,
            defaultAddress: authForm.address,
            defaultPostcode: authForm.postcode,
            preferredLang: lang,
          }),
        });
        setCustomer(res.customer);
      }
      setAuthModalOpen(false);
      const ordRes = await apiFetch<{ orders: typeof customerOrders }>('/api/customer/orders');
      setCustomerOrders(ordRes.orders);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
    }
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    setCustomer(null);
    setCustomerOrders([]);
    if (activeTab === 'orders') setActiveTab('shop');
  };

  const handleReorder = (items: Array<{ productId: number; quantity: number }>, notices: string[]) => {
    const rebuilt: CartItem[] = [];
    for (const it of items) {
      const prod = products.find((p) => p.id === it.productId);
      if (prod && prod.sellableStock > 0) {
        rebuilt.push({ product: prod, quantity: Math.min(it.quantity, prod.sellableStock) });
      }
    }
    setCart(rebuilt);
    setCartOpen(true);
    setActiveTab('shop');
    if (notices.length > 0) {
      setBannerNotice(notices.join(' '));
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-stone-50 text-stone-900">
      {/* Top Policy Strip */}
      <div className="bg-emerald-950 text-emerald-100 text-xs py-2 px-4 text-center">
        <span>{t.noCancelBanner}</span>
      </div>

      {/* Main Navigation Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('shop')}>
            <div className="w-10 h-10 rounded-xl bg-emerald-700 text-white flex items-center justify-center font-extrabold text-lg shadow-sm">
              KK
            </div>
            <div>
              <div className="font-extrabold text-lg tracking-tight text-stone-900 leading-none">
                KamKim Fresh Mart
              </div>
              <div className="text-[11px] text-stone-500 mt-0.5">{t.brandTagline}</div>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="flex flex-wrap items-center gap-1 sm:gap-2 text-sm font-medium">
            {[
              { id: 'shop', label: t.navShop },
              { id: 'about', label: t.navAbout },
              { id: 'policy', label: t.navPolicy },
              { id: 'contact', label: t.navContact },
              { id: 'orders', label: customer ? t.navOrders : t.trackOrder },
            ].map((nav) => (
              <button
                key={nav.id}
                onClick={() => setActiveTab(nav.id as typeof activeTab)}
                className={`px-3 py-1.5 rounded-lg transition ${
                  activeTab === nav.id ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                {nav.label}
              </button>
            ))}
          </nav>

          {/* Right Controls: Language, Customer Auth, Cart */}
          <div className="flex items-center gap-2">
            <div className="flex items-center border border-stone-200 rounded-xl overflow-hidden bg-stone-50 text-xs font-semibold">
              <span className="px-2 text-stone-400">
                <Globe className="w-3.5 h-3.5" />
              </span>
              {(['en', 'zh-CN', 'ms-MY'] as Lang[]).map((code) => (
                <button
                  key={code}
                  onClick={() => setLang(code)}
                  className={`px-2 py-1.5 ${lang === code ? 'bg-emerald-700 text-white' : 'text-stone-600 hover:bg-stone-200'}`}
                >
                  {code === 'en' ? 'EN' : code === 'zh-CN' ? '中文' : 'BM'}
                </button>
              ))}
            </div>

            {customer ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('orders')}
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 text-xs font-semibold text-stone-800"
                >
                  <User className="w-3.5 h-3.5 text-emerald-700" /> {customer.name}
                </button>
                <button onClick={handleLogout} className="text-xs text-stone-500 hover:text-stone-800 px-2">
                  {t.logout}
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setAuthMode('login');
                  setAuthModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-300 text-xs font-semibold hover:bg-stone-50"
              >
                <User className="w-3.5 h-3.5" /> {t.login}
              </button>
            )}

            <button
              onClick={() => setCartOpen(true)}
              className="relative inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-sm"
            >
              <ShoppingCart className="w-4 h-4" />
              <span className="hidden sm:inline">{formatRM(cartSubtotalSen)}</span>
              {cartCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-stone-950 text-[11px] font-extrabold">
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Notice banner (e.g. reorder adjustments) */}
      {bannerNotice && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-xs text-amber-950 flex items-center justify-between max-w-7xl mx-auto w-full">
          <span>{bannerNotice}</span>
          <button onClick={() => setBannerNotice('')} className="font-bold ml-4">
            Dismiss
          </button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1">
        {activeTab === 'shop' && (
          <>
            {/* Hero Banner */}
            <section className="bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-900 text-white">
              <div className="max-w-7xl mx-auto px-4 py-10 md:py-14 grid md:grid-cols-5 gap-6 items-center">
                <div className="md:col-span-3 space-y-4">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-700/70 border border-emerald-500/40 text-xs font-semibold text-emerald-100">
                    Sungai Long, Selangor · MYR · No Minimum Order
                  </span>
                  <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight">
                    {t.heroTitle}
                  </h1>
                  <p className="text-emerald-100/90 text-sm md:text-base max-w-2xl leading-relaxed">
                    {t.heroSubtitle}
                  </p>
                  <div className="flex flex-wrap gap-3 pt-1">
                    <a
                      href="#catalogue"
                      className="px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-bold text-sm"
                    >
                      {t.shopNow}
                    </a>
                    <button
                      onClick={() => setActiveTab('orders')}
                      className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold text-sm"
                    >
                      {t.trackOrder}
                    </button>
                  </div>
                </div>
                <div className="md:col-span-2 bg-white/10 backdrop-blur rounded-2xl p-5 border border-white/15 space-y-2.5 text-xs">
                  <div className="font-bold text-sm text-amber-300">Store Fulfilment Highlights</div>
                  <div>• Fixed-unit packaged groceries (no loose weighing discrepancies)</div>
                  <div>• Bidirectional POSPAL stock & price sync</div>
                  <div>• Lalamove scheduled & express home delivery</div>
                  <div>• Self-Pickup at Bandar Sungai Long (Online or Pay at Store)</div>
                  <div>• FPX, Cards, Touch 'n Go eWallet & GrabPay</div>
                </div>
              </div>
            </section>

            {/* Catalogue Filters & Grid */}
            <section id="catalogue" className="max-w-7xl mx-auto px-4 py-8 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
                        selectedCategory === cat
                          ? 'bg-emerald-700 text-white'
                          : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      {cat === 'All' ? t.allCategories : cat}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t.searchPlaceholder}
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-stone-300 bg-white text-sm"
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inStockOnly}
                      onChange={(e) => setInStockOnly(e.target.checked)}
                      className="rounded border-stone-300 text-emerald-700"
                    />
                    {t.inStockOnly}
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {filteredProducts.slice(0, visibleCount).map((product) => {
                  const localName = getLocalizedName(product, lang);
                  const inCart = cart.find((c) => c.product.id === product.id)?.quantity || 0;
                  return (
                    <div
                      key={product.id}
                      className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm hover:shadow-md transition flex flex-col"
                    >
                      <div
                        className="relative h-44 bg-stone-100 cursor-pointer overflow-hidden"
                        onClick={() => setSelectedProduct(product)}
                      >
                        <img
                          loading="lazy"
                          src={product.imageUrl || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600'}
                          alt={localName}
                          className={`w-full h-full object-cover ${product.outOfStock ? 'grayscale opacity-60' : ''}`}
                        />
                        <span className="absolute top-2.5 left-2.5 px-2.5 py-0.5 rounded-full bg-white/90 text-[11px] font-semibold text-stone-700">
                          {product.unitLabel}
                        </span>
                        {product.outOfStock && (
                          <span className="absolute top-2.5 right-2.5 px-2.5 py-0.5 rounded-full bg-red-600 text-white text-[11px] font-bold">
                            {t.outOfStock}
                          </span>
                        )}
                      </div>

                      <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                        <div>
                          <div className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">
                            {product.category}
                          </div>
                          <h3
                            onClick={() => setSelectedProduct(product)}
                            className="font-bold text-stone-900 text-sm mt-0.5 cursor-pointer hover:text-emerald-700 line-clamp-2"
                          >
                            {localName}
                          </h3>
                          <p className="text-xs text-stone-500 mt-1 line-clamp-2">{getLocalizedDesc(product, lang)}</p>
                        </div>

                        <div className="pt-2 border-t border-stone-100 flex items-center justify-between gap-2">
                          <div>
                            <div className="text-base font-extrabold text-stone-900">{formatRM(product.priceSen)}</div>
                            <div className="text-[11px] text-stone-500">
                              {product.outOfStock ? t.outOfStock : `${product.sellableStock} ${t.stockLeft}`}
                            </div>
                          </div>

                          <button
                            disabled={product.outOfStock || inCart >= product.sellableStock}
                            onClick={() => addToCart(product, 1)}
                            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                              product.outOfStock
                                ? 'bg-stone-200 text-stone-500 cursor-not-allowed'
                                : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                            }`}
                          >
                            {product.outOfStock ? t.outOfStock : inCart > 0 ? `+1 (${inCart})` : t.addToCart}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {filteredProducts.length > visibleCount && (
                <div className="flex flex-col items-center gap-2 pt-2">
                  <div className="text-xs text-stone-500">
                    Showing {Math.min(visibleCount, filteredProducts.length)} of {filteredProducts.length} products
                  </div>
                  <button
                    onClick={() => setVisibleCount((c) => c + 48)}
                    className="px-6 py-2.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white text-sm font-semibold"
                  >
                    Load More Products
                  </button>
                </div>
              )}
            </section>
          </>
        )}

        {(activeTab === 'about' || activeTab === 'policy' || activeTab === 'contact') && (
          <PolicyPages tab={activeTab} lang={lang} storeInfo={storeInfo} />
        )}

        {activeTab === 'orders' && (
          <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
            <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <PackageSearch className="w-5 h-5 text-emerald-700" />
                {t.trackOrder} (Guest Order Lookup)
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!trackLookup.orderCode.trim()) return;
                  setActiveOrderView({
                    orderCode: trackLookup.orderCode.trim().toUpperCase(),
                    token: trackLookup.token.trim(),
                  });
                  setActiveTab('track');
                }}
                className="grid sm:grid-cols-3 gap-3"
              >
                <input
                  required
                  value={trackLookup.orderCode}
                  onChange={(e) => setTrackLookup({ ...trackLookup, orderCode: e.target.value })}
                  placeholder="Order Code (e.g. KK-261123-ABCD)"
                  className="px-3 py-2 rounded-xl border border-stone-300 text-sm"
                />
                <input
                  value={trackLookup.token}
                  onChange={(e) => setTrackLookup({ ...trackLookup, token: e.target.value })}
                  placeholder="Guest Access Token (if guest)"
                  className="px-3 py-2 rounded-xl border border-stone-300 text-sm"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold"
                >
                  View Order Status
                </button>
              </form>
            </div>

            {customer && (
              <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
                <h3 className="text-lg font-bold">Order History — {customer.name}</h3>
                {customerOrders.length === 0 ? (
                  <p className="text-sm text-stone-500">You have not placed any orders yet.</p>
                ) : (
                  <div className="divide-y divide-stone-200">
                    {customerOrders.map((ord) => (
                      <div key={ord.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-mono font-bold text-sm">{ord.order_code}</div>
                          <div className="text-xs text-stone-500">
                            {ord.fulfilment_type.toUpperCase()} · {ord.scheduled_slot_label} · {ord.order_status} ·{' '}
                            {ord.payment_status}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-sm">{formatRM(ord.total_sen)}</span>
                          <button
                            onClick={() => {
                              setActiveOrderView({ orderCode: ord.order_code, token: ord.guest_access_token });
                              setActiveTab('track');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-semibold hover:bg-emerald-100"
                          >
                            Details / Reorder
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'track' && activeOrderView && (
          <OrderTrackingPage
            orderCode={activeOrderView.orderCode}
            accessToken={activeOrderView.token}
            lang={lang}
            onReorder={handleReorder}
            onBack={() => setActiveTab('shop')}
          />
        )}
      </main>

      {/* Footer with explicit separate webpage link to /admin (Password Login) */}
      <footer className="bg-stone-900 text-stone-300 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-8 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div>
            <div className="font-bold text-white text-sm">KamKim Fresh Mart · Sungai Long</div>
            <div className="text-stone-400 mt-1">{storeInfo?.storeAddress}</div>
            <div className="text-stone-400 mt-0.5">
              Owner Contact: {storeInfo?.ownerName} ({storeInfo?.ownerPhone} · {storeInfo?.ownerEmail})
            </div>
          </div>
          <div className="flex flex-col sm:items-end gap-2">
            <a
              href="/admin"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 border border-stone-700 text-amber-300 font-semibold transition"
            >
              <Lock className="w-3.5 h-3.5" />
              {t.adminPortalLink}
            </a>
            <span className="text-stone-500">SRS v1.3 Compliant · Fixed-Unit Grocer · MYR</span>
          </div>
        </div>
      </footer>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-stone-200">
            <div className="relative h-56 bg-stone-100">
              <img src={selectedProduct.imageUrl} alt={selectedProduct.name} className="w-full h-full object-cover" />
              <button
                onClick={() => setSelectedProduct(null)}
                className="absolute top-3 right-3 p-1.5 rounded-full bg-white/90 text-stone-800 shadow"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <div className="text-xs font-semibold text-emerald-700 uppercase">
                {selectedProduct.category} · {selectedProduct.sku} · {selectedProduct.unitLabel}
              </div>
              <h3 className="text-xl font-bold">{getLocalizedName(selectedProduct, lang)}</h3>
              <p className="text-sm text-stone-600 leading-relaxed">{getLocalizedDesc(selectedProduct, lang)}</p>
              <div className="pt-3 border-t border-stone-200 flex items-center justify-between">
                <div>
                  <div className="text-xl font-extrabold text-emerald-700">{formatRM(selectedProduct.priceSen)}</div>
                  <div className="text-xs text-stone-500">
                    {selectedProduct.outOfStock ? t.outOfStock : `${selectedProduct.sellableStock} ${t.stockLeft}`}
                  </div>
                </div>
                <button
                  disabled={selectedProduct.outOfStock}
                  onClick={() => {
                    addToCart(selectedProduct, 1);
                    setSelectedProduct(null);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm disabled:bg-stone-300"
                >
                  {selectedProduct.outOfStock ? t.outOfStock : t.addToCart}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Slide-over Cart Drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-40 bg-black/45 flex justify-end">
          <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
              <div className="font-bold text-lg flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-emerald-700" /> {t.cartTitle}
              </div>
              <button onClick={() => setCartOpen(false)} className="p-1 rounded-lg hover:bg-stone-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {cart.length === 0 ? (
                <div className="text-center text-sm text-stone-500 py-12">{t.emptyCart}</div>
              ) : (
                cart.map((item) => (
                  <div key={item.product.id} className="flex gap-3 items-center border border-stone-200 rounded-xl p-3">
                    <img
                      src={item.product.imageUrl}
                      alt={item.product.name}
                      className="w-16 h-16 rounded-lg object-cover bg-stone-100"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{getLocalizedName(item.product, lang)}</div>
                      <div className="text-xs text-stone-500">
                        {formatRM(item.product.priceSen)} · {item.product.unitLabel}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => updateCartQty(item.product.id, -1)}
                          className="p-1 rounded-lg border border-stone-300 hover:bg-stone-100"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-sm font-bold w-6 text-center">{item.quantity}</span>
                        <button
                          onClick={() => updateCartQty(item.product.id, 1)}
                          className="p-1 rounded-lg border border-stone-300 hover:bg-stone-100"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="text-right space-y-2">
                      <div className="font-bold text-sm">{formatRM(item.product.priceSen * item.quantity)}</div>
                      <button
                        onClick={() => updateCartQty(item.product.id, -item.quantity)}
                        className="text-stone-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-5 border-t border-stone-200 bg-stone-50 space-y-3">
              <div className="flex justify-between font-bold text-base">
                <span>{t.subtotal}</span>
                <span className="text-emerald-700">{formatRM(cartSubtotalSen)}</span>
              </div>
              <button
                disabled={cart.length === 0}
                onClick={() => {
                  setCartOpen(false);
                  setCheckoutOpen(true);
                }}
                className="w-full py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm disabled:opacity-50"
              >
                {t.checkoutBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {checkoutOpen && storeInfo && (
        <CheckoutModal
          cart={cart}
          lang={lang}
          storeInfo={storeInfo}
          customer={customer}
          onClose={() => setCheckoutOpen(false)}
          onOrderCreated={(res) => {
            setCheckoutOpen(false);
            setCart([]);
            loadInitialData();
            if (res.paymentRequired && res.gatewayRef) {
              setGatewaySession({
                orderCode: res.orderCode,
                guestAccessToken: res.guestAccessToken,
                gatewayRef: res.gatewayRef,
                amountSen: res.amountSen,
                method: res.method || 'fpx',
              });
            } else {
              setActiveOrderView({ orderCode: res.orderCode, token: res.guestAccessToken });
              setActiveTab('track');
            }
          }}
        />
      )}

      {/* Hosted Gateway Modal */}
      {gatewaySession && (
        <HostedGatewayModal
          session={gatewaySession}
          onComplete={() => {
            const { orderCode, guestAccessToken } = gatewaySession;
            setGatewaySession(null);
            loadInitialData();
            setActiveOrderView({ orderCode, token: guestAccessToken });
            setActiveTab('track');
          }}
          onClose={() => {
            const { orderCode, guestAccessToken } = gatewaySession;
            setGatewaySession(null);
            setActiveOrderView({ orderCode, token: guestAccessToken });
            setActiveTab('track');
          }}
        />
      )}

      {/* Customer Login / Register Modal */}
      {authModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">{authMode === 'login' ? t.login : t.register}</h3>
              <button onClick={() => setAuthModalOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex gap-2 text-xs font-semibold">
              <button
                onClick={() => setAuthMode('login')}
                className={`flex-1 py-2 rounded-lg ${authMode === 'login' ? 'bg-emerald-700 text-white' : 'bg-stone-100'}`}
              >
                {t.login}
              </button>
              <button
                onClick={() => setAuthMode('register')}
                className={`flex-1 py-2 rounded-lg ${authMode === 'register' ? 'bg-emerald-700 text-white' : 'bg-stone-100'}`}
              >
                {t.register}
              </button>
            </div>
            <form onSubmit={handleAuthSubmit} className="space-y-3">
              {authMode === 'register' && (
                <>
                  <input
                    required
                    value={authForm.name}
                    onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                    placeholder="Full Name"
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                  />
                  <input
                    required
                    value={authForm.phone}
                    onChange={(e) => setAuthForm({ ...authForm, phone: e.target.value })}
                    placeholder="Phone Number (+60...)"
                    className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
                  />
                </>
              )}
              <input
                required
                type="email"
                value={authForm.email}
                onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                placeholder="Email address"
                className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
              />
              <input
                required
                type="password"
                value={authForm.password}
                onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                placeholder="Password"
                className="w-full px-3 py-2 rounded-xl border border-stone-300 text-sm"
              />
              {authMode === 'register' && (
                <div className="grid grid-cols-3 gap-2">
                  <input
                    value={authForm.address}
                    onChange={(e) => setAuthForm({ ...authForm, address: e.target.value })}
                    placeholder="Default Address"
                    className="col-span-2 px-3 py-2 rounded-xl border border-stone-300 text-sm"
                  />
                  <input
                    value={authForm.postcode}
                    onChange={(e) => setAuthForm({ ...authForm, postcode: e.target.value })}
                    placeholder="Postcode"
                    className="px-3 py-2 rounded-xl border border-stone-300 text-sm"
                  />
                </div>
              )}
              {authError && <div className="text-xs text-red-600">{authError}</div>}
              <button type="submit" className="w-full py-2.5 rounded-xl bg-emerald-700 text-white font-bold text-sm">
                {authMode === 'login' ? t.login : t.register}
              </button>
              {authMode === 'login' && (
                <p className="text-[11px] text-stone-500 text-center">
                  Demo customer: <code>customer@example.com</code> / <code>customer123</code>
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
