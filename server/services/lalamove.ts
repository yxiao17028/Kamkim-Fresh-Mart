import crypto from 'node:crypto';
import { DbClient } from '../db/database';
import { writeAuditLog } from './audit';
import { sendOrderEmail } from './email';
import { adminEvents } from './events';

export interface LalamoveQuote {
  quoteId: string;
  feeSen: number;
  currency: 'MYR';
  distanceKm: number;
  expiresAt: string;
  serviceType: 'MOTORCYCLE' | 'CAR';
}

export function getLalamoveQuote(
  db: DbClient,
  address: string,
  postcode: string,
  options?: { forceIncrease?: boolean },
): LalamoveQuote {
  const cleanPostcode = postcode.trim();
  if (!address.trim() || !/^\d{5}$/.test(cleanPostcode)) {
    throw Object.assign(new Error('Valid delivery address and 5-digit Malaysian postcode are required.'), {
      statusCode: 400,
    });
  }

  const pcNum = Number(cleanPostcode);
  // Sungai Long / Kajang / Selangor / KL serviceability window
  if (pcNum < 40000 || pcNum > 68100) {
    throw Object.assign(
      new Error(`Address postcode ${cleanPostcode} is outside Lalamove Klang Valley / Sungai Long delivery coverage.`),
      { statusCode: 422 },
    );
  }

  const settings = db.get<{ lalamove_force_price_increase: number }>(
    'SELECT lalamove_force_price_increase FROM store_settings WHERE id = 1',
  );
  const isSungaiLongArea = cleanPostcode.startsWith('430') || cleanPostcode.startsWith('432');
  const distanceKm = isSungaiLongArea ? 3.5 : pcNum >= 50000 && pcNum <= 60000 ? 18.0 : 10.5;
  let feeSen = isSungaiLongArea ? 900 : pcNum >= 50000 && pcNum <= 60000 ? 1800 : 1300;

  if (options?.forceIncrease || settings?.lalamove_force_price_increase === 1) {
    feeSen += 600; // +RM 6.00 peak surcharge simulation
  }

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5-minute Lalamove quote TTL
  return {
    quoteId: `LLM-Q-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
    feeSen,
    currency: 'MYR',
    distanceKm,
    expiresAt,
    serviceType: 'CAR',
  };
}

/**
 * Checks whether the scheduled pickup window is eligible for Lalamove dispatch.
 * Early packing ("Ready" hours before scheduled window) must wait in "Waiting for Slot" (FR-042, AT-10).
 */
export function isPickupWindowEligible(scheduledStartIso: string, now = new Date()): boolean {
  const slotStart = new Date(scheduledStartIso).getTime();
  if (Number.isNaN(slotStart)) return true;
  const leadWindowMs = 45 * 60 * 1000; // Dispatch rider up to 45 minutes before slot starts
  return now.getTime() >= slotStart - leadWindowMs;
}

export function bookLalamoveForOrder(
  db: DbClient,
  orderId: number,
  actor: { type: 'owner' | 'staff' | 'system'; id: string | number; name: string },
  options?: { now?: Date; forceFreshQuoteIncrease?: boolean },
): {
  status: string;
  lalamoveOrderId?: string;
  topupRequiredSen?: number;
  message: string;
} {
  const order = db.get<{
    id: number;
    order_code: string;
    fulfilment_type: string;
    order_status: string;
    payment_status: string;
    delivery_status: string;
    delivery_address: string;
    delivery_postcode: string;
    scheduled_start_iso: string;
    customer_email: string;
    lang: string;
    delivery_fee_sen: number;
    topup_fee_sen: number;
  }>('SELECT * FROM orders WHERE id = ?', [orderId]);

  if (!order) {
    throw Object.assign(new Error('Order not found.'), { statusCode: 404 });
  }
  if (order.fulfilment_type !== 'delivery') {
    throw Object.assign(new Error('Lalamove booking applies to delivery orders only.'), { statusCode: 400 });
  }

  const delivery = db.get<{
    id: number;
    quote_id: string;
    quoted_fee_sen: number;
    quote_expires_at: string;
    actual_fee_sen: number;
    topup_required_sen: number;
    lalamove_order_id: string | null;
    idempotency_key: string | null;
    status: string;
  }>('SELECT * FROM deliveries WHERE order_id = ?', [orderId]);

  if (!delivery) {
    throw Object.assign(new Error('Delivery quote record missing for order.'), { statusCode: 500 });
  }

  // Idempotent guard: never create a second Lalamove booking (AT-12)
  if (delivery.lalamove_order_id) {
    return {
      status: delivery.status,
      lalamoveOrderId: delivery.lalamove_order_id,
      message: `Existing Lalamove booking ${delivery.lalamove_order_id} returned (idempotent).`,
    };
  }

  if (!['Ready', 'Exception'].includes(order.order_status)) {
    throw Object.assign(new Error('Order must be marked Ready for Pickup before booking Lalamove.'), {
      statusCode: 400,
    });
  }
  if (order.payment_status === 'Top-up Due') {
    throw Object.assign(new Error('Cannot book Lalamove while delivery fee top-up payment is still due.'), {
      statusCode: 409,
    });
  }
  if (order.payment_status !== 'Paid') {
    throw Object.assign(new Error('Delivery order must be Paid before booking Lalamove.'), { statusCode: 400 });
  }

  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();

  // Check scheduled window eligibility (FR-042, AT-10)
  if (!isPickupWindowEligible(order.scheduled_start_iso, now)) {
    db.run(`UPDATE orders SET delivery_status = 'Waiting for Slot', updated_at = ? WHERE id = ?`, [nowIso, orderId]);
    db.run(`UPDATE deliveries SET status = 'Waiting for Slot', updated_at = ? WHERE order_id = ?`, [nowIso, orderId]);
    writeAuditLog(db, {
      actorType: actor.type,
      actorId: actor.id,
      actorName: actor.name,
      action: 'LALAMOVE_WAITING_FOR_SLOT',
      entityType: 'order',
      entityId: order.order_code,
      details: { scheduledStartIso: order.scheduled_start_iso },
    });
    return {
      status: 'Waiting for Slot',
      message: `Order is Ready early; waiting until eligible pickup window (${order.scheduled_start_iso}).`,
    };
  }

  const settings = db.get<{ lalamove_force_price_increase: number; lalamove_hide_coordinates: number }>(
    'SELECT lalamove_force_price_increase, lalamove_hide_coordinates FROM store_settings WHERE id = 1',
  );

  // Check quote expiry or fresh requote (FR-044, FR-045, AT-11)
  const quoteExpired = new Date(delivery.quote_expires_at).getTime() < now.getTime();
  let effectiveFeeSen = delivery.quoted_fee_sen;
  let effectiveQuoteId = delivery.quote_id;

  if (quoteExpired || options?.forceFreshQuoteIncrease || settings?.lalamove_force_price_increase === 1) {
    const freshQuote = getLalamoveQuote(db, order.delivery_address, order.delivery_postcode, {
      forceIncrease: options?.forceFreshQuoteIncrease,
    });
    effectiveFeeSen = freshQuote.feeSen;
    effectiveQuoteId = freshQuote.quoteId;

    const customerAlreadyPaidDeliverySen = order.delivery_fee_sen + order.topup_fee_sen;
    if (freshQuote.feeSen > customerAlreadyPaidDeliverySen) {
      const topupNeeded = freshQuote.feeSen - customerAlreadyPaidDeliverySen;
      db.transaction(() => {
        db.run(
          `UPDATE deliveries
           SET quote_id = ?, quote_expires_at = ?, actual_fee_sen = ?, topup_required_sen = ?, status = 'Top-up Required', updated_at = ?
           WHERE order_id = ?`,
          [freshQuote.quoteId, freshQuote.expiresAt, freshQuote.feeSen, topupNeeded, nowIso, orderId],
        );
        db.run(
          `UPDATE orders SET delivery_status = 'Top-up Required', payment_status = 'Top-up Due', updated_at = ? WHERE id = ?`,
          [nowIso, orderId],
        );
        sendOrderEmail(db, {
          orderId,
          orderCode: order.order_code,
          recipient: order.customer_email,
          lang: order.lang,
          event: 'topup_required',
          extra: { amount: (topupNeeded / 100).toFixed(2) },
        });
        writeAuditLog(db, {
          actorType: actor.type,
          actorId: actor.id,
          actorName: actor.name,
          action: 'LALAMOVE_TOPUP_REQUIRED',
          entityType: 'order',
          entityId: order.order_code,
          details: { previousPaidSen: customerAlreadyPaidDeliverySen, freshFeeSen: freshQuote.feeSen, topupNeeded },
        });
      });

      adminEvents.emit({
        type: 'delivery_updated',
        title: 'Lalamove Top-up Required',
        message: `Order ${order.order_code} requires RM ${(topupNeeded / 100).toFixed(2)} delivery top-up before dispatch.`,
        orderCode: order.order_code,
        severity: 'warning',
        timestamp: nowIso,
      });

      return {
        status: 'Top-up Required',
        topupRequiredSen: topupNeeded,
        message: `Quote expired and new Lalamove fee is RM ${(freshQuote.feeSen / 100).toFixed(2)}. Held for customer top-up of RM ${(topupNeeded / 100).toFixed(2)}.`,
      };
    }
  }

  // Execute idempotent Lalamove booking
  const lalamoveOrderId = `LLM-MY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const bookingIdempKey = `book:${order.order_code}`;
  const hideCoords = settings?.lalamove_hide_coordinates === 1;
  const trackingUrl = `https://share.lalamove.com/my/track/${lalamoveOrderId}`;

  db.transaction(() => {
    db.run(
      `UPDATE deliveries
       SET quote_id = ?, actual_fee_sen = ?, topup_required_sen = 0, lalamove_order_id = ?, idempotency_key = ?,
           status = 'Driver Assigned', driver_name = 'Ahmad Razak', driver_phone = '+6012-8894321',
           driver_plate = 'VKL 4829', driver_lat = ?, driver_lng = ?, tracking_url = ?, last_error = '', updated_at = ?
       WHERE order_id = ? AND lalamove_order_id IS NULL`,
      [
        effectiveQuoteId,
        effectiveFeeSen,
        lalamoveOrderId,
        bookingIdempKey,
        hideCoords ? null : 3.0428,
        hideCoords ? null : 101.7929,
        trackingUrl,
        nowIso,
        orderId,
      ],
    );
    db.run(
      `UPDATE orders SET order_status = 'In Delivery', delivery_status = 'Driver Assigned', updated_at = ? WHERE id = ?`,
      [nowIso, orderId],
    );
    sendOrderEmail(db, {
      orderId,
      orderCode: order.order_code,
      recipient: order.customer_email,
      lang: order.lang,
      event: 'order_status_changed',
      extra: { status: 'In Delivery (Driver Assigned)', detail: `Lalamove Tracking: ${trackingUrl}` },
    });
    writeAuditLog(db, {
      actorType: actor.type,
      actorId: actor.id,
      actorName: actor.name,
      action: 'LALAMOVE_BOOKED',
      entityType: 'order',
      entityId: order.order_code,
      details: { lalamoveOrderId, actualFeeSen: effectiveFeeSen, trackingUrl },
    });
  });

  adminEvents.emit({
    type: 'delivery_updated',
    title: 'Lalamove Rider Assigned',
    message: `Order ${order.order_code} assigned to Ahmad Razak (${lalamoveOrderId}).`,
    orderCode: order.order_code,
    severity: 'info',
    timestamp: nowIso,
  });

  return {
    status: 'Driver Assigned',
    lalamoveOrderId,
    message: `Lalamove booking ${lalamoveOrderId} created and rider assigned.`,
  };
}
