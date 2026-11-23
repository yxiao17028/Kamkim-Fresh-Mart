export type Lang = 'en' | 'zh-CN' | 'ms-MY';

export interface TimeSlot {
  slotId: string;
  label: string;
  dateLabel: string;
  startIso: string;
  endIso: string;
  isImmediate?: boolean;
}

export interface StoreInfo {
  storeName: string;
  storeAddress: string;
  storePhone: string;
  storeWhatsapp: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  operatingHours: { monSat: string; sun: string; timezone: string };
  availableSlots: TimeSlot[];
  currency: 'MYR';
  timezone: 'Asia/Kuala_Lumpur';
  noMinimumOrder: boolean;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  nameZh: string;
  nameMs: string;
  category: string;
  priceSen: number;
  sellableStock: number;
  outOfStock: boolean;
  unitLabel: string;
  shortDescEn: string;
  extendedDescEn: string;
  extendedDescZh: string;
  extendedDescMs: string;
  imageUrl: string;
  seoSlug: string;
  isFeatured: boolean;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface CustomerUser {
  id: number;
  email: string;
  name: string;
  phone: string;
  defaultAddress: string;
  defaultPostcode: string;
  preferredLang?: string;
}

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  email: string;
  role: 'owner' | 'staff';
  canProcessRefunds: boolean;
}

export interface LalamoveQuote {
  quoteId: string;
  feeSen: number;
  currency: 'MYR';
  distanceKm: number;
  expiresAt: string;
  serviceType: string;
}
