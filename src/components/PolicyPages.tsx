import React from 'react';
import { AlertTriangle, Clock, MapPin, MessageCircle, Phone, ShieldCheck } from 'lucide-react';
import { Lang, StoreInfo } from '../types';

export const PolicyPages: React.FC<{
  lang: Lang;
  storeInfo: StoreInfo | null;
}> = ({ lang, storeInfo }) => {
  if (!storeInfo) return null;

  const isZh = lang === 'zh-CN';
  const isMs = lang === 'ms-MY';

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* 1. Store Info, Hours & Contact */}
      <section className="bg-white rounded-2xl border border-stone-200 p-6 md:p-8 shadow-sm space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-stone-900">
            {isZh ? '关于 KamKim Fresh Mart' : isMs ? 'Tentang KamKim Fresh Mart' : 'About KamKim Fresh Mart'}
          </h2>
          <p className="text-sm text-stone-600 mt-2 leading-relaxed">
            {isZh
              ? '位于雪兰莪双溪龙（Bandar Sungai Long）的社区生鲜杂货店，提供固定包装新鲜食材与日用品，线上库存与店内 POSPAL 实时同步。'
              : isMs
                ? 'Kedai runcit segar kejiranan anda di Bandar Sungai Long, Selangor dengan stok pek tetap yang disegerakkan bersama POSPAL kedai.'
                : 'Your Sungai Long neighbourhood fresh grocer offering fixed-unit packaged produce, meat, dairy, and pantry staples synced directly with our in-store POSPAL inventory.'}
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-4 flex gap-3">
            <MapPin className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-emerald-950">
                {isZh ? '门店与自取地址' : isMs ? 'Alamat Kedai & Ambil Sendiri' : 'Store & Self-Pickup Address'}
              </div>
              <div className="text-emerald-900 mt-1">{storeInfo.storeAddress}</div>
            </div>
          </div>

          <div className="rounded-xl bg-amber-50/70 border border-amber-200 p-4 flex gap-3">
            <Clock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-amber-950">
                {isZh ? '营业时间' : isMs ? 'Waktu Operasi' : 'Opening Hours'} ({storeInfo.operatingHours.timezone})
              </div>
              <div className="text-amber-900 mt-1">
                Mon–Sat: {storeInfo.operatingHours.monSat} · Sun: {storeInfo.operatingHours.sun}
              </div>
            </div>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 text-sm pt-1">
          <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 flex items-center gap-3">
            <Phone className="w-4 h-4 text-emerald-700 shrink-0" />
            <div>
              <div className="text-xs text-stone-500">{isZh ? '门店 / 店主电话' : 'Phone'}</div>
              <div className="font-semibold text-stone-900">{storeInfo.ownerPhone}</div>
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 flex items-center gap-3">
            <MessageCircle className="w-4 h-4 text-emerald-700 shrink-0" />
            <div>
              <div className="text-xs text-stone-500">WhatsApp</div>
              <div className="font-semibold text-stone-900">{storeInfo.storeWhatsapp}</div>
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 flex items-center gap-3">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
            <div className="min-w-0">
              <div className="text-xs text-stone-500">{isZh ? '店主邮箱' : 'Owner Email'}</div>
              <div className="font-semibold text-stone-900 truncate">{storeInfo.ownerEmail}</div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Delivery, Order & Refund Policy */}
      <section className="bg-white rounded-2xl border border-stone-200 p-6 md:p-8 shadow-sm space-y-4">
        <h3 className="text-lg font-bold text-stone-900">
          {isZh ? '配送、订单与退款说明' : isMs ? 'Polisi Pesanan & Penghantaran' : 'Order, Delivery & Refund Policy'}
        </h3>

        <div className="rounded-xl bg-amber-50 border border-amber-300 p-4 flex items-start gap-3 text-sm text-amber-950">
          <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            {isZh
              ? '订单一经提交，无法在网站取消，亦不提供顾客自助退款申请。如有任何问题或争议，请直接通过上方电话或 WhatsApp 联系店主（' +
                storeInfo.ownerName +
                '）。若遇商品缺货，经授权商家人员可通过原支付网关为您办理缺货商品退款。'
              : isMs
                ? 'Pesanan yang telah dihantar tidak boleh dibatalkan melalui laman web dan tiada borang permohonan bayaran balik pelanggan. Sila hubungi Pemilik kedai (' +
                  storeInfo.ownerName +
                  ') secara terus untuk sebarang pertanyaan.'
                : 'Submitted orders cannot be cancelled via the website, and online customer refund requests are not supported. For any issue or refund enquiry, please contact the Store Owner (' +
                  storeInfo.ownerName +
                  ') directly. Where an ordered item is unavailable during packing, authorised merchant staff may process an item-level refund via the payment gateway.'}
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4 text-sm text-stone-600">
          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200">
            <div className="font-semibold text-stone-900 mb-1">
              {isZh ? 'Lalamove 送货上门' : isMs ? 'Penghantaran Lalamove' : 'Home Delivery (Lalamove)'}
            </div>
            <p>
              {isZh
                ? '运费在付款前实时报价并由顾客承担，无最低消费要求。若预约时段报价过期且运费上涨，需补缴差额后再安排骑士。'
                : isMs
                  ? 'Caj penghantaran dipaparkan sebelum bayaran dan tiada had belian minimum. Tambahan caj diperlukan jika kadar berubah sebelum penghantaran.'
                  : 'Delivery fees are quoted live before payment with no minimum order. If a scheduled quote expires and rates rise before dispatch, a top-up is collected first.'}
            </p>
          </div>
          <div className="p-4 rounded-xl bg-stone-50 border border-stone-200">
            <div className="font-semibold text-stone-900 mb-1">
              {isZh ? '门店自取与到店付款' : isMs ? 'Ambil Sendiri & Bayar di Kedai' : 'Self-Pickup & Pay at Store'}
            </div>
            <p>
              {isZh
                ? '选择到店自取时，可线上支付或选择“到店付款”。取货时将在柜台核对并完成付款。'
                : isMs
                  ? 'Untuk ambil sendiri, anda boleh bayar dalam talian atau pilih Bayar di Kedai semasa pengambilan di kaunter.'
                  : 'Self-pickup orders can be paid online or at the Sungai Long counter upon collection.'}
            </p>
          </div>
        </div>
      </section>

      {/* 3. Privacy Notice (PDPA Malaysia) */}
      <section className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm text-sm text-stone-600 space-y-1.5">
        <div className="font-bold text-stone-900">
          {isZh ? '隐私声明（马来西亚 PDPA）' : isMs ? 'Notis Privasi (PDPA Malaysia)' : 'Privacy Notice (PDPA Malaysia)'}
        </div>
        <p>
          {isZh
            ? '我们仅收集完成订单所必需的资料（姓名、电话、邮箱及配送地址）。银行卡与电子钱包支付由第三方支付网关安全处理，本站不保存您的原始支付密码或卡号。'
            : isMs
              ? 'Kami hanya mengumpul maklumat minimum untuk penghantaran dan pengambilan pesanan. Maklumat pembayaran diproses terus oleh gerbang pembayaran berlesen.'
              : 'We collect only the minimum details needed to fulfil your order (name, phone, email, and delivery address). Payment credentials are processed directly by the payment gateway and never stored on our servers.'}
        </p>
      </section>
    </div>
  );
};
