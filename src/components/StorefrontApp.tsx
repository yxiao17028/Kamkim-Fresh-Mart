import React, { useEffect, useMemo, useState } from 'react';
import {
  Globe,
  Home,
  LayoutGrid,
  Menu,
  Minus,
  Package,
  PackageSearch,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Store,
  Trash2,
  Truck,
  User,
  Wallet,
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

const CATEGORY_PRESETS: Record<
  string,
  { img: string; label: Record<Lang, string> }
> = {
  零食: {
    img: '/images/cat-snacks.jpg',
    label: { en: 'Snacks', 'zh-CN': '零食', 'ms-MY': 'Snek' },
  },
  饮料: {
    img: '/images/cat-drinks.jpg',
    label: { en: 'Drinks', 'zh-CN': '饮料', 'ms-MY': 'Minuman' },
  },
  冷冻类: {
    img: '/images/cat-frozen.jpg',
    label: { en: 'Frozen', 'zh-CN': '冷冻类', 'ms-MY': 'Makanan Beku' },
  },
  面类: {
    img: '/images/cat-noodles.jpg',
    label: { en: 'Noodles', 'zh-CN': '面类', 'ms-MY': 'Mi & Bihun' },
  },
  酱料: {
    img: '/images/cat-sauces.jpg',
    label: { en: 'Sauces', 'zh-CN': '酱料', 'ms-MY': 'Sos & Pes' },
  },
  调味料: {
    img: '/images/cat-seasoning.jpg',
    label: { en: 'Seasoning', 'zh-CN': '调味料', 'ms-MY': 'Perasa' },
  },
  'MEDICAL ,FACE MASK': {
    img: '/images/cat-medical.jpg',
    label: { en: 'Medical & Face Mask', 'zh-CN': '医疗与口罩', 'ms-MY': 'Perubatan & Pelitup Muka' },
  },
  文具用品: {
    img: '/images/cat-stationery.jpg',
    label: { en: 'Stationery', 'zh-CN': '文具用品', 'ms-MY': 'Alat Tulis' },
  },
  素食: {
    img: '/images/cat-vegetarian.jpg',
    label: { en: 'Vegetarian', 'zh-CN': '素食', 'ms-MY': 'Vegetarian' },
  },
  海鲜: {
    img: '/images/cat-seafood.jpg',
    label: { en: 'Seafood', 'zh-CN': '海鲜', 'ms-MY': 'Makanan Laut' },
  },
  '点心,包类': {
    img: '/images/cat-dimsum.jpg',
    label: { en: 'Dim Sum & Buns', 'zh-CN': '点心与包类', 'ms-MY': 'Dim Sum & Pau' },
  },
  方便包: {
    img: '/images/cat-readymeal.jpg',
    label: { en: 'Ready Meals', 'zh-CN': '方便包', 'ms-MY': 'Pek Sedia Dimakan' },
  },
  '面包，蛋糕': {
    img: '/images/cat-bakery.jpg',
    label: { en: 'Bread & Cakes', 'zh-CN': '面包与蛋糕', 'ms-MY': 'Roti & Kek' },
  },
  罐头: {
    img: '/images/cat-canned.jpg',
    label: { en: 'Canned Food', 'zh-CN': '罐头', 'ms-MY': 'Makanan Tin' },
  },
  冰淇淋: {
    img: '/images/cat-icecream.jpg',
    label: { en: 'Ice Cream', 'zh-CN': '冰淇淋', 'ms-MY': 'Aiskrim' },
  },
  肉类: {
    img: '/images/cat-meat.jpg',
    label: { en: 'Meat', 'zh-CN': '肉类', 'ms-MY': 'Daging' },
  },
  汤料: {
    img: '/images/cat-soup.jpg',
    label: { en: 'Soup Spices', 'zh-CN': '汤料', 'ms-MY': 'Rempah Sup' },
  },
  五谷类: {
    img: '/images/cat-grains.jpg',
    label: { en: 'Grains & Rice', 'zh-CN': '五谷类', 'ms-MY': 'Bijirin & Beras' },
  },
  'Beverages & Snacks': {
    img: '/images/cat-snacks.jpg',
    label: { en: 'Beverages & Snacks', 'zh-CN': '饮品零食', 'ms-MY': 'Minuman & Snek' },
  },
  'Pantry & Grains': {
    img: '/images/cat-sauces.jpg',
    label: { en: 'Pantry & Grains', 'zh-CN': '粮油酱料', 'ms-MY': 'Barangan Dapur' },
  },
  'Fresh Produce': {
    img: '/images/card-essentials.jpg',
    label: { en: 'Fresh Produce', 'zh-CN': '新鲜蔬果', 'ms-MY': 'Sayur & Buah' },
  },
  'Meat & Seafood': {
    img: '/images/cat-frozen.jpg',
    label: { en: 'Meat & Seafood', 'zh-CN': '肉类海鲜', 'ms-MY': 'Daging & Makanan Laut' },
  },
  'Dairy & Chilled': {
    img: '/images/cat-drinks.jpg',
    label: { en: 'Dairy & Chilled', 'zh-CN': '乳品冷藏', 'ms-MY': 'Tenusu & Sejuk' },
  },
  Household: {
    img: '/images/cat-seasoning.jpg',
    label: { en: 'Household', 'zh-CN': '家居日用', 'ms-MY': 'Keperluan Rumah' },
  },
};

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

  const [activeTab, setActiveTab] = useState<'shop' | 'about' | 'orders' | 'track'>('shop');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const PAGE_SIZE = 30;
  const [currentPage, setCurrentPage] = useState(1);

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

  const categoryCards = useMemo(() => {
    const counts = new Map<string, { count: number; sampleImg: string }>();
    for (const p of products) {
      const prev = counts.get(p.category);
      if (!prev) {
        counts.set(p.category, { count: 1, sampleImg: p.imageUrl || '' });
      } else {
        prev.count += 1;
        if (!prev.sampleImg && p.imageUrl) prev.sampleImg = p.imageUrl;
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([rawName, info]) => {
        const preset = CATEGORY_PRESETS[rawName];
        return {
          rawName,
          count: info.count,
          label: preset ? preset.label[lang] : rawName,
          img: preset?.img || info.sampleImg || '/images/card-essentials.jpg',
        };
      });
  }, [products, lang]);

  const displayedCategoryCards = showAllCategories ? categoryCards.slice(0, 18) : categoryCards.slice(0, 6);

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

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageProducts = filteredProducts.slice(pageStart, pageStart + PAGE_SIZE);

  const pageNumbers = useMemo(() => {
    const nums = new Set<number>([1, totalPages, safePage - 1, safePage, safePage + 1]);
    return Array.from(nums)
      .filter((n) => n >= 1 && n <= totalPages)
      .sort((a, b) => a - b);
  }, [safePage, totalPages]);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(totalPages, page)));
    document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' });
  };

  const selectCategoryAndScroll = (cat: string) => {
    setSelectedCategory(cat);
    setCurrentPage(1);
    document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' });
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
    <div className="min-h-screen flex flex-col bg-stone-50 text-stone-900 pb-16 md:pb-0">
      {/* Slim SRS Policy Bar */}
      <div className="bg-emerald-950 text-emerald-100 text-[10px] sm:text-[11px] py-1.5 px-3 sm:px-4 text-center">
        <span>{t.noCancelBanner}</span>
      </div>

      {/* Responsive Sticky Header: Mobile (Figure 1) & Tablet/Desktop */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-stone-200">
        {/* Mobile Header (< md) */}
        <div className="md:hidden px-4 pt-2.5 pb-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                aria-label="Toggle Menu"
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="p-1.5 -ml-1.5 rounded-lg text-stone-700 hover:bg-stone-100"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <div
                className="min-w-0 cursor-pointer"
                onClick={() => {
                  setActiveTab('shop');
                  setMobileMenuOpen(false);
                }}
              >
                <div className="font-extrabold text-base tracking-tight text-[#075E40] leading-none truncate">
                  KamKim Fresh Mart
                </div>
                <div className="text-[11px] text-stone-500 mt-0.5 truncate">{t.brandTagline}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCartOpen(true)}
              aria-label="Open Basket"
              className="relative p-2 rounded-xl text-[#075E40] hover:bg-emerald-50"
            >
              <ShoppingCart className="w-5 h-5" />
              {cartCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#075E40] text-white text-[10px] font-extrabold flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </button>
          </div>

          {/* Mobile Top Pill Search Bar (Figure 1) */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setActiveTab('shop');
              setTimeout(() => document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' }), 50);
            }}
            className="relative"
          >
            <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-2.5" />
            <input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
                if (activeTab !== 'shop') setActiveTab('shop');
              }}
              placeholder={t.searchPlaceholder}
              className="w-full pl-10 pr-4 py-2 rounded-full border border-stone-200 bg-stone-50 text-sm focus:bg-white focus:border-[#075E40] outline-none"
            />
          </form>

          {mobileMenuOpen && (
            <div className="pt-2 border-t border-stone-200 space-y-3">
              <div className="grid grid-cols-3 gap-2 text-xs font-semibold">
                {[
                  { id: 'shop', label: t.navShop },
                  { id: 'about', label: t.navAbout },
                  { id: 'orders', label: customer ? t.navOrders : t.trackOrder },
                ].map((nav) => (
                  <button
                    key={nav.id}
                    onClick={() => {
                      setActiveTab(nav.id as typeof activeTab);
                      setMobileMenuOpen(false);
                    }}
                    className={`py-2 px-2 rounded-xl text-center transition ${
                      activeTab === nav.id
                        ? 'bg-[#075E40] text-white'
                        : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                    }`}
                  >
                    {nav.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center border border-stone-200 rounded-xl overflow-hidden bg-stone-50 text-xs font-semibold">
                  <span className="px-2 text-stone-400">
                    <Globe className="w-3.5 h-3.5" />
                  </span>
                  {(['en', 'zh-CN', 'ms-MY'] as Lang[]).map((code) => (
                    <button
                      key={code}
                      onClick={() => setLang(code)}
                      className={`px-2.5 py-1.5 ${lang === code ? 'bg-[#075E40] text-white' : 'text-stone-600'}`}
                    >
                      {code === 'en' ? 'EN' : code === 'zh-CN' ? '中文' : 'BM'}
                    </button>
                  ))}
                </div>

                {customer ? (
                  <button
                    onClick={() => {
                      handleLogout();
                      setMobileMenuOpen(false);
                    }}
                    className="px-3 py-1.5 rounded-xl border border-stone-200 text-xs font-semibold text-stone-700"
                  >
                    {customer.name} · {t.logout}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setAuthMode('login');
                      setAuthModalOpen(true);
                      setMobileMenuOpen(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#075E40] text-white text-xs font-semibold"
                  >
                    <User className="w-3.5 h-3.5" /> {t.login}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Tablet & Desktop Header (md+) */}
        <div className="hidden md:flex max-w-7xl mx-auto px-4 py-3 flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('shop')}>
            <div className="w-10 h-10 rounded-xl bg-[#075E40] text-white flex items-center justify-center font-extrabold text-base shadow-sm">
              KK
            </div>
            <div>
              <div className="font-extrabold text-base lg:text-lg tracking-tight text-stone-900 leading-none">
                KamKim Fresh Mart
              </div>
              <div className="text-[11px] text-stone-500 mt-0.5">{t.brandTagline}</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:gap-3">
            <nav className="flex items-center gap-1 text-sm font-medium">
              {[
                { id: 'shop', label: t.navShop },
                { id: 'about', label: t.navAbout },
                { id: 'orders', label: customer ? t.navOrders : t.trackOrder },
              ].map((nav) => (
                <button
                  key={nav.id}
                  onClick={() => setActiveTab(nav.id as typeof activeTab)}
                  className={`px-3 py-1.5 rounded-xl transition ${
                    activeTab === nav.id
                      ? 'text-[#075E40] font-bold bg-emerald-50'
                      : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
                  }`}
                >
                  {nav.label}
                </button>
              ))}
            </nav>

            <div className="flex items-center border border-stone-200 rounded-xl overflow-hidden bg-stone-50 text-xs font-semibold">
              <span className="px-2 text-stone-400">
                <Globe className="w-3.5 h-3.5" />
              </span>
              {(['en', 'zh-CN', 'ms-MY'] as Lang[]).map((code) => (
                <button
                  key={code}
                  onClick={() => setLang(code)}
                  className={`px-2 py-1.5 ${lang === code ? 'bg-[#075E40] text-white' : 'text-stone-600 hover:bg-stone-200'}`}
                >
                  {code === 'en' ? 'EN' : code === 'zh-CN' ? '中文' : 'BM'}
                </button>
              ))}
            </div>

            {customer ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setActiveTab('orders')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 text-xs font-semibold text-stone-800"
                >
                  <User className="w-3.5 h-3.5 text-[#075E40]" /> {customer.name}
                </button>
                <button onClick={handleLogout} className="text-xs text-stone-500 hover:text-stone-800 px-1.5">
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
              aria-label="Open Basket"
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#075E40] hover:bg-emerald-900 text-white text-xs font-bold shadow-sm transition"
            >
              <ShoppingCart className="w-4 h-4" />
              {cartCount > 0 && (
                <>
                  <span>{formatRM(cartSubtotalSen)}</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-400 text-stone-950 text-[11px] font-extrabold">
                    {cartCount}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {bannerNotice && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-950 flex items-center justify-between max-w-7xl mx-auto w-full">
          <span>{bannerNotice}</span>
          <button onClick={() => setBannerNotice('')} className="font-bold ml-4">
            Dismiss
          </button>
        </div>
      )}

      <main className="flex-1">
        {activeTab === 'shop' && (
          <>
            {/* Hero Split Banner: mobile stacks photo on top + full-width CTA (Figure 1); tablet/desktop splits side-by-side */}
            <section className="w-full bg-[#075E40] text-white overflow-hidden">
              <div className="flex flex-col md:flex-row items-stretch">
                <div className="order-2 md:order-1 flex-1 px-5 py-6 md:py-10 lg:py-12 md:pl-[max(2rem,calc((100vw-80rem)/2+1rem))] md:pr-8 lg:pr-10 flex flex-col justify-center space-y-3 md:space-y-5">
                  <div className="hidden sm:block text-[11px] font-bold tracking-widest uppercase text-amber-300">
                    {t.heroEyebrow}
                  </div>
                  <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-[42px] font-extrabold tracking-tight leading-tight max-w-xl">
                    {t.heroTitle}
                  </h1>
                  <p className="text-emerald-100/90 text-sm md:text-base max-w-lg leading-relaxed">
                    {t.heroSubtitle}
                  </p>
                  <div className="pt-1 md:pt-2">
                    <a
                      href="#catalogue"
                      className="block md:inline-block w-full md:w-auto text-center px-6 py-3 rounded-xl md:rounded-full bg-amber-400 hover:bg-amber-300 text-stone-950 font-bold text-sm shadow-sm transition"
                    >
                      {t.shopNow}
                    </a>
                  </div>
                </div>
                <div className="order-1 md:order-2 w-full md:w-[50%] lg:w-[52%] md:max-w-[760px] shrink-0 bg-[#075E40] flex items-center justify-end">
                  <img
                    src="/images/hero-bag.jpg"
                    alt="KamKim Fresh Mart Groceries"
                    className="w-full h-auto block"
                  />
                </div>
              </div>
            </section>

            {/* Feature Strip: 3 crisp items in 1 row on mobile (Figure 1), 4 columns on tablet & desktop */}
            <section className="bg-white border-b border-stone-200">
              <div className="max-w-7xl mx-auto grid grid-cols-3 md:grid-cols-4 divide-x divide-stone-200">
                {[
                  { icon: Store, label: t.featShopLocal, mobileHide: true },
                  { icon: Wallet, label: t.featNoMin, mobileHide: false },
                  { icon: Truck, label: t.featDelivery, mobileHide: false },
                  { icon: ShoppingBag, label: t.featFreePickup, mobileHide: false },
                ].map((feat) => {
                  const Icon = feat.icon;
                  return (
                    <div
                      key={feat.label}
                      className={`py-3 sm:py-4 px-2 sm:px-3 flex-col items-center justify-center gap-1 sm:gap-1.5 text-center ${
                        feat.mobileHide ? 'hidden md:flex' : 'flex'
                      }`}
                    >
                      <Icon className="w-5 h-5 text-[#075E40]" />
                      <span className="text-[11px] sm:text-xs font-semibold text-stone-700 leading-tight">
                        {feat.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8 space-y-8 sm:space-y-10">
              {/* Shop by Category: circular 4-up row on mobile (Figure 2), 6-up cards on tablet/desktop */}
              {categoryCards.length > 0 && (
                <section className="space-y-3 sm:space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg sm:text-xl font-extrabold text-stone-900">{t.shopByCategory}</h2>
                    {categoryCards.length > 6 && (
                      <button
                        onClick={() => setShowAllCategories(!showAllCategories)}
                        className="text-xs font-bold text-[#075E40] hover:underline"
                      >
                        {showAllCategories ? t.showLess : t.viewAll}
                      </button>
                    )}
                  </div>

                  <div
                    className={
                      showAllCategories
                        ? 'grid grid-cols-4 sm:grid-cols-4 md:grid-cols-6 gap-3 md:gap-4'
                        : 'grid grid-flow-col auto-cols-[calc((100%-2.25rem)/4)] overflow-x-auto pb-1 gap-3 md:grid-flow-row md:grid-cols-6 md:overflow-visible md:pb-0 md:gap-4'
                    }
                  >
                    {displayedCategoryCards.map((cat) => {
                      const active = selectedCategory === cat.rawName;
                      return (
                        <button
                          key={cat.rawName}
                          onClick={() => selectCategoryAndScroll(active ? 'All' : cat.rawName)}
                          className={`group flex flex-col items-center text-center transition rounded-xl md:rounded-2xl md:bg-white md:border md:p-3 md:shadow-sm md:hover:shadow-md ${
                            active
                              ? 'md:border-[#075E40] md:ring-2 md:ring-[#075E40]/20'
                              : 'md:border-stone-200'
                          }`}
                        >
                          <div
                            className={`w-full aspect-square rounded-full md:rounded-xl bg-white overflow-hidden flex items-center justify-center mb-1.5 md:mb-2.5 border md:border-0 p-1 md:p-0 ${
                              active ? 'border-[#075E40] ring-2 ring-[#075E40]/25 md:ring-0' : 'border-stone-200'
                            }`}
                          >
                            <img
                              loading="lazy"
                              src={cat.img}
                              alt={cat.label}
                              className="w-full h-full object-contain group-hover:scale-105 transition duration-200"
                            />
                          </div>
                          <div className="w-full text-[11px] sm:text-xs font-semibold md:font-bold text-stone-800 truncate">
                            {cat.label}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Explore Our Groceries: 2 cols on mobile (Figure 2), 3 cols on tablet, 4 cols on desktop */}
              <section id="catalogue" className="space-y-4 pt-1 sm:pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                  <h2 className="text-lg sm:text-xl font-extrabold text-stone-900">{t.exploreTitle}</h2>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
                    <select
                      value={selectedCategory}
                      onChange={(e) => {
                        setSelectedCategory(e.target.value);
                        setCurrentPage(1);
                      }}
                      className="px-2.5 sm:px-3 py-1.5 rounded-xl border border-stone-200 bg-white font-medium text-stone-700 max-w-[160px] sm:max-w-none"
                    >
                      <option value="All">
                        {t.allCategories} ({products.length})
                      </option>
                      {categoryCards.map((c) => (
                        <option key={c.rawName} value={c.rawName}>
                          {c.label} ({c.count})
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 font-semibold text-stone-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={inStockOnly}
                        onChange={(e) => {
                          setInStockOnly(e.target.checked);
                          setCurrentPage(1);
                        }}
                        className="rounded border-stone-300 text-[#075E40]"
                      />
                      {t.inStockOnly}
                    </label>
                  </div>
                </div>

                {/* Desktop/Tablet Wide Pill Search Bar (hidden on mobile since Figure 1 shows top search bar) */}
                <div className="hidden md:block relative">
                  <Search className="w-4 h-4 text-stone-400 absolute left-4 top-3.5" />
                  <input
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder={t.searchPlaceholder}
                    className="w-full pl-11 pr-4 py-3 rounded-2xl border border-stone-200 bg-white text-sm shadow-sm focus:border-[#075E40] outline-none"
                  />
                </div>

                {/* Responsive Product Grid: 2 cols Phone (Figure 2), 3 cols Tablet, 4 cols Desktop (30 per page) */}
                {filteredProducts.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-stone-200 p-12 text-center text-sm text-stone-500">
                    No matching products found.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-5">
                    {pageProducts.map((product) => {
                      const localName = getLocalizedName(product, lang);
                      const inCart = cart.find((c) => c.product.id === product.id)?.quantity || 0;
                      return (
                        <div
                          key={product.id}
                          className="bg-white rounded-2xl border border-stone-200 p-2.5 sm:p-3.5 shadow-sm hover:shadow-md transition flex flex-col justify-between gap-2.5 sm:gap-3"
                        >
                          <div>
                            <div
                              onClick={() => setSelectedProduct(product)}
                              className="aspect-square rounded-xl bg-white overflow-hidden flex items-center justify-center mb-3 cursor-pointer"
                            >
                              <img
                                loading="lazy"
                                src={product.imageUrl || '/images/card-essentials.jpg'}
                                alt={localName}
                                className={`w-full h-full object-contain ${product.outOfStock ? 'grayscale opacity-50' : ''}`}
                              />
                            </div>

                            <h3
                              onClick={() => setSelectedProduct(product)}
                              className="text-sm font-medium text-stone-800 hover:text-[#075E40] cursor-pointer line-clamp-2 leading-snug min-h-[2.4rem]"
                            >
                              {localName}
                            </h3>
                            <div className="flex items-baseline justify-between mt-1">
                              <span className="text-base font-extrabold text-stone-900">
                                {formatRM(product.priceSen)}
                              </span>
                              <span className="text-[11px] text-stone-400">
                                {product.outOfStock ? t.outOfStock : `${product.sellableStock} ${t.stockLeft}`}
                              </span>
                            </div>
                          </div>

                          {inCart > 0 ? (
                            <div className="w-full flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5">
                              <button
                                onClick={() => updateCartQty(product.id, -1)}
                                className="p-1 rounded-full hover:bg-emerald-100 text-[#075E40]"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="text-xs font-bold text-emerald-950">{inCart}</span>
                              <button
                                disabled={inCart >= product.sellableStock}
                                onClick={() => updateCartQty(product.id, 1)}
                                className="p-1 rounded-full hover:bg-emerald-100 text-[#075E40] disabled:opacity-40"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              disabled={product.outOfStock}
                              onClick={() => addToCart(product, 1)}
                              className={`w-full py-2 rounded-full text-xs font-bold transition ${
                                product.outOfStock
                                  ? 'bg-stone-100 text-stone-400 cursor-not-allowed'
                                  : 'bg-[#077A57] hover:bg-[#075E40] text-white'
                              }`}
                            >
                              {product.outOfStock ? t.outOfStock : `+ ${t.addToCart}`}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {filteredProducts.length > 0 && (
                  <div className="flex flex-col items-center gap-3 pt-4">
                    <div className="text-xs text-stone-500">
                      {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredProducts.length)} / {filteredProducts.length} · Page {safePage} / {totalPages}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        <button
                          type="button"
                          disabled={safePage <= 1}
                          onClick={() => goToPage(safePage - 1)}
                          className="px-3 py-1.5 rounded-full border border-stone-200 bg-white text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          ←
                        </button>
                        {pageNumbers.map((num, idx) => {
                          const prevNum = pageNumbers[idx - 1];
                          const showEllipsis = prevNum !== undefined && num - prevNum > 1;
                          return (
                            <React.Fragment key={num}>
                              {showEllipsis && (
                                <span className="px-1.5 text-xs text-stone-400">…</span>
                              )}
                              <button
                                type="button"
                                onClick={() => goToPage(num)}
                                className={`min-w-[34px] h-[34px] px-2.5 rounded-full text-xs font-bold transition ${
                                  num === safePage
                                    ? 'bg-[#075E40] text-white shadow-sm'
                                    : 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-100'
                                }`}
                              >
                                {num}
                              </button>
                            </React.Fragment>
                          );
                        })}
                        <button
                          type="button"
                          disabled={safePage >= totalPages}
                          onClick={() => goToPage(safePage + 1)}
                          className="px-3 py-1.5 rounded-full border border-stone-200 bg-white text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          →
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          </>
        )}

        {activeTab === 'about' && <PolicyPages lang={lang} storeInfo={storeInfo} />}

        {activeTab === 'orders' && (
          <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
            <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <PackageSearch className="w-5 h-5 text-[#075E40]" />
                {t.trackOrder}
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
                  placeholder="Guest Token (if guest)"
                  className="px-3 py-2 rounded-xl border border-stone-300 text-sm"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#075E40] hover:bg-emerald-900 text-white text-sm font-semibold"
                >
                  Check Status
                </button>
              </form>
            </div>

            {customer && (
              <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm space-y-4">
                <h3 className="text-base font-bold">Order History — {customer.name}</h3>
                {customerOrders.length === 0 ? (
                  <p className="text-sm text-stone-500">No orders placed yet.</p>
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
                            className="px-3 py-1.5 rounded-lg bg-emerald-50 text-[#075E40] text-xs font-semibold hover:bg-emerald-100"
                          >
                            View / Reorder
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

      <footer className="bg-stone-900 text-stone-300 mt-10">
        <div className="max-w-7xl mx-auto px-4 py-6 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="space-y-1">
            <div className="font-bold text-white text-sm">KamKim Fresh Mart · Sungai Long</div>
            <div className="text-stone-400 flex flex-wrap items-center gap-x-2 gap-y-1">
              <a
                href={storeInfo?.storeMapUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:text-white underline decoration-stone-600 underline-offset-2"
              >
                {storeInfo?.storeAddress}
              </a>
              <span>· {storeInfo?.ownerPhone}</span>
              <span>· {storeInfo?.ownerEmail}</span>
              {storeInfo?.storeFacebookUrl && (
                <a
                  href={storeInfo.storeFacebookUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline"
                >
                  · Facebook
                </a>
              )}
            </div>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Tab Bar (Figure 2) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-stone-200 grid grid-cols-4 py-1.5 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]"
      >
        <button
          type="button"
          onClick={() => {
            setActiveTab('shop');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-semibold ${
            activeTab === 'shop' ? 'text-[#075E40]' : 'text-stone-500'
          }`}
        >
          <Home className="w-5 h-5" />
          <span>{t.navHome}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('shop');
            setTimeout(() => document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' }), 50);
          }}
          className="flex flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-semibold text-stone-600 hover:text-[#075E40]"
        >
          <LayoutGrid className="w-5 h-5" />
          <span>{t.navShop}</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('orders')}
          className={`flex flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-semibold ${
            activeTab === 'orders' || activeTab === 'track' ? 'text-[#075E40]' : 'text-stone-500'
          }`}
        >
          <Package className="w-5 h-5" />
          <span>{t.navOrdersShort}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (customer) {
              setActiveTab('orders');
            } else {
              setAuthMode('login');
              setAuthModalOpen(true);
            }
          }}
          className="flex flex-col items-center justify-center gap-0.5 py-1 text-[11px] font-semibold text-stone-500 hover:text-[#075E40]"
        >
          <User className="w-5 h-5" />
          <span>{t.navAccount}</span>
        </button>
      </nav>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-stone-200">
            <div className="relative h-56 bg-white flex items-center justify-center p-4">
              <img
                src={selectedProduct.imageUrl || '/images/card-essentials.jpg'}
                alt={selectedProduct.name}
                className="max-h-full max-w-full object-contain"
              />
              <button
                onClick={() => setSelectedProduct(null)}
                className="absolute top-3 right-3 p-1.5 rounded-full bg-stone-100 text-stone-800 shadow"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 border-t border-stone-100">
              <div className="text-xs font-semibold text-[#075E40] uppercase">
                {selectedProduct.category} · {selectedProduct.unitLabel}
              </div>
              <h3 className="text-lg font-bold">{getLocalizedName(selectedProduct, lang)}</h3>
              <p className="text-sm text-stone-600 leading-relaxed">{getLocalizedDesc(selectedProduct, lang)}</p>
              <div className="pt-3 border-t border-stone-200 flex items-center justify-between">
                <div>
                  <div className="text-xl font-extrabold text-[#075E40]">{formatRM(selectedProduct.priceSen)}</div>
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
                  className="px-6 py-2.5 rounded-full bg-[#077A57] hover:bg-[#075E40] text-white font-bold text-sm disabled:bg-stone-300"
                >
                  {selectedProduct.outOfStock ? t.outOfStock : `+ ${t.addToCart}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cart Drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-40 bg-black/45 flex justify-end">
          <div className="bg-white w-full max-w-md h-full flex flex-col shadow-2xl">
            <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
              <div className="font-bold text-lg flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-[#075E40]" /> {t.cartTitle}
              </div>
              <button onClick={() => setCartOpen(false)} className="p-1 rounded-lg hover:bg-stone-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {cart.length === 0 ? (
                <div className="text-center text-sm text-stone-500 py-12">{t.emptyCart}</div>
              ) : (
                cart.map((item) => (
                  <div key={item.product.id} className="flex gap-3 items-center border border-stone-200 rounded-xl p-3">
                    <img
                      src={item.product.imageUrl || '/images/card-essentials.jpg'}
                      alt={item.product.name}
                      className="w-14 h-14 rounded-lg object-contain bg-white border border-stone-100"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{getLocalizedName(item.product, lang)}</div>
                      <div className="text-xs text-stone-500">
                        {formatRM(item.product.priceSen)} · {item.product.unitLabel}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
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
                <span className="text-[#075E40]">{formatRM(cartSubtotalSen)}</span>
              </div>
              <button
                disabled={cart.length === 0}
                onClick={() => {
                  setCartOpen(false);
                  setCheckoutOpen(true);
                }}
                className="w-full py-3 rounded-full bg-[#077A57] hover:bg-[#075E40] text-white font-bold text-sm disabled:opacity-50"
              >
                {t.checkoutBtn}
              </button>
            </div>
          </div>
        </div>
      )}

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
                className={`flex-1 py-2 rounded-lg ${authMode === 'login' ? 'bg-[#075E40] text-white' : 'bg-stone-100'}`}
              >
                {t.login}
              </button>
              <button
                onClick={() => setAuthMode('register')}
                className={`flex-1 py-2 rounded-lg ${authMode === 'register' ? 'bg-[#075E40] text-white' : 'bg-stone-100'}`}
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
              <button type="submit" className="w-full py-2.5 rounded-xl bg-[#075E40] text-white font-bold text-sm">
                {authMode === 'login' ? t.login : t.register}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
