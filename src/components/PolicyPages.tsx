import React from 'react';
import { Clock, MapPin, MessageCircle, Phone, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Lang, StoreInfo } from '../types';

export const PolicyPages: React.FC<{
  tab: 'about' | 'policy' | 'contact';
  lang: Lang;
  storeInfo: StoreInfo | null;
}> = ({ tab, lang, storeInfo }) => {
  if (!storeInfo) return null;

  if (tab === 'about') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-6 md:p-8 shadow-sm">
          <h2 className="text-2xl font-bold text-stone-900 mb-3">
            {lang === 'zh-CN'
              ? '关于 KamKim Fresh Mart（双溪龙）'
              : lang === 'ms-MY'
                ? 'Tentang KamKim Fresh Mart (Sungai Long)'
                : 'About KamKim Fresh Mart — Sungai Long'}
          </h2>
          <p className="text-stone-600 leading-relaxed mb-6">
            {lang === 'zh-CN'
              ? 'KamKim Fresh Mart 是位于雪兰莪双溪龙（Bandar Sungai Long）的邻里生鲜与日用杂货专卖店。本店线上商城提供固定包装（Fixed-Unit）新鲜蔬果、肉类海鲜、乳制品及日常干货，库存与店内 POSPAL 收银系统双向实时同步。'
              : lang === 'ms-MY'
                ? 'KamKim Fresh Mart ialah kedai runcit segar kejiranan anda di Bandar Sungai Long, Selangor. Platform dalam talian kami menawarkan produk pek tetap dengan penyegerakan inventori POSPAL dua hala.'
                : 'KamKim Fresh Mart is your trusted neighbourhood fresh grocer in Bandar Sungai Long, Selangor. Our online store offers fixed-unit packaged vegetables, fruits, meats, dairy, and pantry essentials synchronised directly with our in-store POSPAL inventory.'}
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex gap-3">
              <MapPin className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-emerald-950">Store & Self-Pickup Address</div>
                <div className="text-sm text-emerald-900 mt-1">{storeInfo.storeAddress}</div>
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex gap-3">
              <Clock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-amber-950">Operating Hours ({storeInfo.operatingHours.timezone})</div>
                <div className="text-sm text-amber-900 mt-1">
                  Mon–Sat: {storeInfo.operatingHours.monSat} <br />
                  Sunday: {storeInfo.operatingHours.sun}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (tab === 'policy') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-white rounded-2xl border border-stone-200 p-6 md:p-8 shadow-sm space-y-5">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-300">
            <AlertTriangle className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-amber-950">
                {lang === 'zh-CN'
                  ? '重要订单与退款政策（提交后不可取消）'
                  : lang === 'ms-MY'
                    ? 'Polisi Penting Pesanan & Bayaran Balik'
                    : 'Delivery, Order & No-Cancellation Policy'}
              </h3>
              <p className="text-sm text-amber-900 mt-1 leading-relaxed">
                {lang === 'zh-CN'
                  ? '订单一旦成功提交，客户或店员均无法在网站上取消订单，网站也不提供客户自助退款申请功能。如遇任何缺货、配送异常或退款疑问，请直接联系店主处理。若特定商品备货时确认缺货，授权商家人员可针对缺货商品通过原支付网关发起对应款项退款，但不保证或自动承诺无条件退款。'
                  : lang === 'ms-MY'
                    ? 'Setelah pesanan berjaya dihantar, pesanan TIDAK BOLEH dibatalkan melalui laman web oleh pelanggan atau staf, dan laman web tidak menyediakan borang permohonan bayaran balik pelanggan. Sebarang pertanyaan bayaran balik atau pertikaian hendaklah dirujuk terus kepada Pemilik kedai.'
                    : 'Once an order is submitted successfully, it CANNOT be cancelled via the website by customers or staff. Customers cannot submit refund requests on the website; any refund enquiry or fulfilment dispute must be raised directly with the Store Owner. Where an ordered item is found unavailable during packing, authorised merchant staff may initiate an item-level payment gateway refund for the unavailable item(s). Submitting an order does not imply an automatic right to refund.'}
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4 text-sm text-stone-700">
            <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
              <div className="font-bold text-stone-900">1. Delivery (Lalamove)</div>
              <p>Delivery fees are quoted live via Lalamove prior to payment and borne by the customer. No minimum order or free-shipping threshold applies.</p>
              <p>If a scheduled quote expires and Lalamove rates increase before dispatch, a top-up payment will be required before rider assignment.</p>
            </div>
            <div className="p-4 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
              <div className="font-bold text-stone-900">2. Self-Pickup & Pay at Store</div>
              <p>Self-pickup orders can be paid online or via Pay at Store upon collection in Sungai Long. Unpaid Pay-at-Store orders are verified and settled at the counter before release.</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-950">
            <div className="font-bold mb-1">Owner Contact for Disputes & Enquiries</div>
            <div>
              {storeInfo.ownerName} · Phone: {storeInfo.ownerPhone} · WhatsApp: {storeInfo.storeWhatsapp} · Email:{' '}
              {storeInfo.ownerEmail}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 p-6 md:p-8 shadow-sm space-y-6">
        <h2 className="text-2xl font-bold text-stone-900">Contact, WhatsApp & Malaysian PDPA Privacy Notice</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-stone-200 bg-stone-50">
            <Phone className="w-5 h-5 text-emerald-700 mb-2" />
            <div className="font-semibold text-sm">Store & Owner Phone</div>
            <div className="text-sm text-stone-600 mt-1">{storeInfo.storePhone}</div>
            <div className="text-sm text-emerald-800 font-medium">{storeInfo.ownerPhone}</div>
          </div>
          <div className="p-4 rounded-xl border border-stone-200 bg-stone-50">
            <MessageCircle className="w-5 h-5 text-emerald-700 mb-2" />
            <div className="font-semibold text-sm">WhatsApp Direct</div>
            <div className="text-sm text-stone-600 mt-1">{storeInfo.storeWhatsapp}</div>
          </div>
          <div className="p-4 rounded-xl border border-stone-200 bg-stone-50">
            <ShieldCheck className="w-5 h-5 text-emerald-700 mb-2" />
            <div className="font-semibold text-sm">Owner Email</div>
            <div className="text-sm text-stone-600 mt-1">{storeInfo.ownerEmail}</div>
          </div>
        </div>
        <div className="border-t border-stone-200 pt-5 text-sm text-stone-600 space-y-2">
          <h3 className="font-bold text-stone-900">Privacy Notice (PDPA Malaysia) & Terms</h3>
          <p>
            KamKim Fresh Mart collects only the minimum personal information necessary to fulfil your order (name, phone number, email address, and delivery address when home delivery is selected).
          </p>
          <p>
            Payment credentials are handled directly by the payment gateway; raw card details are never stored on our servers. Delivery addresses and rider tracking links are protected behind authenticated customer sessions or secured order access tokens.
          </p>
        </div>
      </div>
    </div>
  );
};
