import nodemailer from 'nodemailer';
import { DbClient } from '../db/database';

type Lang = 'en' | 'zh-CN' | 'ms-MY';

function createMailTransport() {
  const gmailUser = process.env.GMAIL_USER?.trim();
  const gmailPass = process.env.GMAIL_APP_PASSWORD?.trim();
  if (gmailUser && gmailPass) {
    return {
      from: process.env.SMTP_FROM?.trim() || `"KamKim Fresh Mart" <${gmailUser}>`,
      transporter: nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailUser, pass: gmailPass },
      }),
    };
  }

  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (host && user && pass) {
    const port = Number(process.env.SMTP_PORT || 587);
    return {
      from: process.env.SMTP_FROM?.trim() || `"KamKim Fresh Mart" <${user}>`,
      transporter: nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      }),
    };
  }

  return null;
}

export function isSmtpEmailConfigured(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  return Boolean(
    (process.env.GMAIL_USER?.trim() && process.env.GMAIL_APP_PASSWORD?.trim()) ||
      (process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()),
  );
}

export async function sendPasswordResetCodeEmail(
  db: DbClient,
  params: {
    recipient: string;
    customerName: string;
    code: string;
    lang: string;
  },
): Promise<{ deliveryMode: 'email' | 'demo' }> {
  const lang = (['en', 'zh-CN', 'ms-MY'].includes(params.lang) ? params.lang : 'en') as Lang;

  const subjects: Record<Lang, string> = {
    en: '[KamKim Fresh Mart] Your Password Reset Verification Code',
    'zh-CN': '[KamKim Fresh Mart] 您的密码重置验证码',
    'ms-MY': '[KamKim Fresh Mart] Kod Pengesahan Tetapan Semula Kata Laluan',
  };

  const bodies: Record<Lang, string> = {
    en: `Hi ${params.customerName},\n\nYour 6-digit password reset verification code is: ${params.code}\n\nThis code expires in 15 minutes. If you did not request a password reset, you can safely ignore this email.\n\nKamKim Fresh Mart`,
    'zh-CN': `您好 ${params.customerName}，\n\n您的 6 位密码重置验证码为：${params.code}\n\n验证码 15 分钟内有效。如非本人操作，请忽略此邮件。\n\nKamKim Fresh Mart`,
    'ms-MY': `Hai ${params.customerName},\n\nKod pengesahan 6 digit untuk menetapkan semula kata laluan anda ialah: ${params.code}\n\nKod ini tamat tempoh dalam 15 minit. Jika anda tidak meminta tetapan semula ini, sila abaikan e-mel ini.\n\nKamKim Fresh Mart`,
  };

  const mailCfg = process.env.NODE_ENV === 'test' ? null : createMailTransport();
  let deliveryMode: 'email' | 'demo' = 'demo';

  if (mailCfg) {
    await mailCfg.transporter.sendMail({
      from: mailCfg.from,
      to: params.recipient,
      subject: subjects[lang],
      text: bodies[lang],
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
        <h2 style="color:#075E40;margin:0 0 12px;">KamKim Fresh Mart</h2>
        <p style="color:#374151;font-size:14px;">Hi ${params.customerName},</p>
        <p style="color:#374151;font-size:14px;">Use the verification code below to reset your password (valid for 15 minutes):</p>
        <div style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#075E40;background:#ecfdf5;padding:14px 20px;border-radius:10px;text-align:center;margin:16px 0;">
          ${params.code}
        </div>
        <p style="color:#6b7280;font-size:12px;">If you did not request this reset, you can safely ignore this email.</p>
      </div>`,
    });
    deliveryMode = 'email';
  }

  // Record audit trail without storing the plaintext OTP code in email_logs
  db.run(
    `INSERT INTO email_logs (order_id, recipient, subject, body, lang, status, created_at)
     VALUES (NULL, ?, ?, ?, ?, ?, ?)`,
    [
      params.recipient,
      subjects[lang],
      `Password reset verification code (${deliveryMode === 'email' ? 'sent via SMTP' : 'sandbox preview'}).`,
      lang,
      deliveryMode === 'email' ? 'sent' : 'sandbox',
      new Date().toISOString(),
    ],
  );

  return { deliveryMode };
}

export function sendOrderEmail(
  db: DbClient,
  params: {
    orderId: number;
    orderCode: string;
    recipient: string;
    lang: string;
    event:
      | 'order_placed_paid'
      | 'order_placed_pay_at_store'
      | 'order_status_changed'
      | 'item_unavailable_notice'
      | 'refund_processed'
      | 'topup_required';
    extra?: Record<string, string>;
  },
): void {
  const lang = (['en', 'zh-CN', 'ms-MY'].includes(params.lang) ? params.lang : 'en') as Lang;
  const settings = db.get<{ store_name: string; owner_name: string; owner_phone: string; store_whatsapp: string }>(
    'SELECT store_name, owner_name, owner_phone, store_whatsapp FROM store_settings WHERE id = 1',
  );
  const ownerContact = settings
    ? `${settings.owner_name} (${settings.owner_phone} / WhatsApp ${settings.store_whatsapp})`
    : 'Store Owner';

  const subjects: Record<typeof params.event, Record<Lang, string>> = {
    order_placed_paid: {
      en: `[KamKim Fresh Mart] Order ${params.orderCode} Confirmed & Preparing`,
      'zh-CN': `[KamKim Fresh Mart] 订单 ${params.orderCode} 已确认并正在备货`,
      'ms-MY': `[KamKim Fresh Mart] Pesanan ${params.orderCode} Disahkan & Sedang Disediakan`,
    },
    order_placed_pay_at_store: {
      en: `[KamKim Fresh Mart] Self-Pickup Order ${params.orderCode} (Pay at Store)`,
      'zh-CN': `[KamKim Fresh Mart] 自取订单 ${params.orderCode}（到店付款）`,
      'ms-MY': `[KamKim Fresh Mart] Pesanan Ambil Sendiri ${params.orderCode} (Bayar di Kedai)`,
    },
    order_status_changed: {
      en: `[KamKim Fresh Mart] Order ${params.orderCode} Status Update: ${params.extra?.status ?? ''}`,
      'zh-CN': `[KamKim Fresh Mart] 订单 ${params.orderCode} 状态更新：${params.extra?.status ?? ''}`,
      'ms-MY': `[KamKim Fresh Mart] Kemas Kini Status Pesanan ${params.orderCode}: ${params.extra?.status ?? ''}`,
    },
    item_unavailable_notice: {
      en: `[KamKim Fresh Mart] Item Availability Notice for Order ${params.orderCode}`,
      'zh-CN': `[KamKim Fresh Mart] 订单 ${params.orderCode} 商品缺货通知`,
      'ms-MY': `[KamKim Fresh Mart] Notis Ketersediaan Item untuk Pesanan ${params.orderCode}`,
    },
    refund_processed: {
      en: `[KamKim Fresh Mart] Refund Update for Order ${params.orderCode}`,
      'zh-CN': `[KamKim Fresh Mart] 订单 ${params.orderCode} 退款通知`,
      'ms-MY': `[KamKim Fresh Mart] Kemas Kini Bayaran Balik Pesanan ${params.orderCode}`,
    },
    topup_required: {
      en: `[KamKim Fresh Mart] Delivery Fee Top-Up Required for ${params.orderCode}`,
      'zh-CN': `[KamKim Fresh Mart] 订单 ${params.orderCode} 需要补缴运费差额`,
      'ms-MY': `[KamKim Fresh Mart] Tambahan Caj Penghantaran Diperlukan untuk ${params.orderCode}`,
    },
  };

  const bodies: Record<typeof params.event, Record<Lang, string>> = {
    order_placed_paid: {
      en: `Thank you for shopping with KamKim Fresh Mart. Your order ${params.orderCode} is paid and now Preparing. Note: Submitted orders cannot be cancelled online. For enquiries or disputes, please contact ${ownerContact}.`,
      'zh-CN': `感谢您在 KamKim Fresh Mart 购物。您的订单 ${params.orderCode} 已付款并进入备货阶段。注意：已提交的订单无法在网站取消，如有任何疑问或争议请直接联系店主：${ownerContact}。`,
      'ms-MY': `Terima kasih kerana membeli-belah di KamKim Fresh Mart. Pesanan anda ${params.orderCode} telah dibayar dan sedang disediakan. Nota: Pesanan yang telah dihantar tidak boleh dibatalkan di laman web. Untuk pertanyaan atau pertikaian, sila hubungi Pemilik: ${ownerContact}.`,
    },
    order_placed_pay_at_store: {
      en: `Your self-pickup order ${params.orderCode} is confirmed and Preparing. Payment status is Unpaid (Pay at Store upon collection). Note: Submitted orders cannot be cancelled online; contact ${ownerContact} for assistance.`,
      'zh-CN': `您的自取订单 ${params.orderCode} 已确认并正在备货。当前付款状态为“未付款（到店付款）”。注意：已提交的订单无法在网站取消，如需协助请联系店主：${ownerContact}。`,
      'ms-MY': `Pesanan ambil sendiri anda ${params.orderCode} disahkan dan sedang disediakan. Status bayaran ialah Belum Dibayar (Bayar di Kedai semasa pengambilan). Pesanan tidak boleh dibatalkan secara dalam talian; hubungi ${ownerContact} untuk bantuan.`,
    },
    order_status_changed: {
      en: `Order ${params.orderCode} is now ${params.extra?.status ?? ''}. ${params.extra?.detail ?? ''} For assistance, contact ${ownerContact}.`,
      'zh-CN': `您的订单 ${params.orderCode} 状态已更新为：${params.extra?.status ?? ''}。${params.extra?.detail ?? ''} 如需帮助请联系店主：${ownerContact}。`,
      'ms-MY': `Pesanan ${params.orderCode} kini berstatus ${params.extra?.status ?? ''}. ${params.extra?.detail ?? ''} Hubungi ${ownerContact} untuk bantuan.`,
    },
    item_unavailable_notice: {
      en: `Some item(s) in order ${params.orderCode} were marked unavailable (${params.extra?.items ?? ''}). Our Owner will review and assist you; you may also contact ${ownerContact} directly.`,
      'zh-CN': `订单 ${params.orderCode} 中部分商品暂时缺货（${params.extra?.items ?? ''}）。店主将协助处理，您也可以直接联系店主：${ownerContact}。`,
      'ms-MY': `Sebahagian item dalam pesanan ${params.orderCode} tidak tersedia (${params.extra?.items ?? ''}). Pemilik kedai akan membantu; anda juga boleh menghubungi ${ownerContact}.`,
    },
    refund_processed: {
      en: `Merchant refund update for order ${params.orderCode}: Status ${params.extra?.status ?? ''}, Amount RM ${params.extra?.amount ?? '0.00'}. Ref: ${params.extra?.ref ?? '-'}. Contact ${ownerContact} for any questions.`,
      'zh-CN': `订单 ${params.orderCode} 商家退款状态更新：${params.extra?.status ?? ''}，金额 RM ${params.extra?.amount ?? '0.00'}，流水号：${params.extra?.ref ?? '-'}。如有疑问请联系店主：${ownerContact}。`,
      'ms-MY': `Kemas kini bayaran balik peniaga untuk pesanan ${params.orderCode}: Status ${params.extra?.status ?? ''}, Jumlah RM ${params.extra?.amount ?? '0.00'}, Rujukan: ${params.extra?.ref ?? '-'}. Hubungi ${ownerContact} jika ada pertanyaan.`,
    },
    topup_required: {
      en: `Lalamove delivery rate updated for order ${params.orderCode}. An additional top-up of RM ${params.extra?.amount ?? '0.00'} is needed before driver dispatch. Please complete top-up via your order tracking page or contact ${ownerContact}.`,
      'zh-CN': `订单 ${params.orderCode} 的 Lalamove 最新配送费有所调整，需补缴差额 RM ${params.extra?.amount ?? '0.00'} 后才能安排骑士。请前往订单追踪页完成补缴或联系店主：${ownerContact}。`,
      'ms-MY': `Kadar penghantaran Lalamove untuk pesanan ${params.orderCode} telah berubah. Tambahan sebanyak RM ${params.extra?.amount ?? '0.00'} diperlukan sebelum penghantar ditempah. Sila bayar melalui halaman pesanan anda atau hubungi ${ownerContact}.`,
    },
  };

  db.run(
    `INSERT INTO email_logs (order_id, recipient, subject, body, lang, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'sent', ?)`,
    [params.orderId, params.recipient, subjects[params.event][lang], bodies[params.event][lang], lang, new Date().toISOString()],
  );
}
