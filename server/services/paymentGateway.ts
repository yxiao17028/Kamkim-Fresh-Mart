import crypto from 'node:crypto';
import { DbClient } from '../db/database';
import { PAYMENT_WEBHOOK_SECRET, verifyHmac } from './auth';
import { writeAuditLog } from './audit';
import { sendOrderEmail } from './email';
import { adminEvents } from './events';
import { deductStockForOrder } from './pospal';

export interface PaymentWebhookPayload {
  eventId: string;
  gatewayRef: string;
  orderCode: string;
  status: 'Paid' | 'Failed';
  amountSen: number;
  channel?: string;
}

export function handleGatewayPaymentWebhook(
  db: DbClient,
  rawBody: string,
  signature: string,
): { duplicate: boolean; orderCode: string; paymentStatus: string } {
  if (!verifyHmac(PAYMENT_WEBHOOK_SECRET, rawBody, signature)) {
    throw Object.assign(new Error('Invalid payment gateway webhook signature.'), { statusCode: 401 });
  }

  const payload = JSON.parse(rawBody) as PaymentWebhookPayload;
  const existingEvent = db.get<{ id: number }>(
    `SELECT id FROM processed_webhooks WHERE provider = 'gateway_payment' AND event_id = ?`,
    [payload.eventId],
  );
  if (existingEvent) {
    return { duplicate: true, orderCode: payload.orderCode, paymentStatus: payload.status };
  }

  const now = new Date().toISOString();
  const payment = db.get<{
    id: number;
    order_id: number;
    payment_purpose: 'initial' | 'topup';
    amount_sen: number;
    status: string;
  }>('SELECT id, order_id, payment_purpose, amount_sen, status FROM payments WHERE gateway_ref = ?', [
    payload.gatewayRef,
  ]);
  if (!payment) {
    throw Object.assign(new Error(`Payment reference ${payload.gatewayRef} not found.`), { statusCode: 404 });
  }

  const order = db.get<{
    id: number;
    order_code: string;
    customer_email: string;
    customer_name: string;
    customer_id: number | null;
    lang: string;
    order_status: string;
    payment_status: string;
    topup_fee_sen: number;
  }>('SELECT * FROM orders WHERE id = ?', [payment.order_id]);
  if (!order) {
    throw Object.assign(new Error('Order not found for payment.'), { statusCode: 404 });
  }

  if (payload.status === 'Paid' && payload.amountSen !== payment.amount_sen) {
    throw Object.assign(new Error('Gateway callback amount mismatch.'), { statusCode: 400 });
  }

  db.transaction(() => {
    db.run(`INSERT INTO processed_webhooks (provider, event_id, processed_at) VALUES ('gateway_payment', ?, ?)`, [
      payload.eventId,
      now,
    ]);

    if (payment.status === 'Paid') {
      return; // Already settled idempotently
    }

    db.run(
      `UPDATE payments SET status = ?, signature_verified = 1, raw_callback_json = ?, paid_at = ? WHERE id = ?`,
      [payload.status, rawBody, payload.status === 'Paid' ? now : null, payment.id],
    );

    if (payment.payment_purpose === 'initial') {
      if (payload.status === 'Paid') {
        db.run(`UPDATE orders SET payment_status = 'Paid', order_status = 'Preparing', updated_at = ? WHERE id = ?`, [
          now,
          order.id,
        ]);
      } else {
        db.run(`UPDATE orders SET payment_status = 'Failed', updated_at = ? WHERE id = ?`, [now, order.id]);
      }
    } else if (payment.payment_purpose === 'topup') {
      if (payload.status === 'Paid') {
        db.run(
          `UPDATE orders
           SET payment_status = 'Paid', delivery_status = 'Booking', topup_fee_sen = topup_fee_sen + ?, total_sen = total_sen + ?, updated_at = ?
           WHERE id = ?`,
          [payment.amount_sen, payment.amount_sen, now, order.id],
        );
        db.run(`UPDATE deliveries SET topup_required_sen = 0, status = 'Booking', updated_at = ? WHERE order_id = ?`, [
          now,
          order.id,
        ]);
      }
    }

    writeAuditLog(db, {
      actorType: 'gateway',
      actorId: payload.gatewayRef,
      actorName: 'Malaysian Payment Gateway',
      action: `PAYMENT_WEBHOOK_${payload.status.toUpperCase()}`,
      entityType: 'order',
      entityId: order.order_code,
      details: { purpose: payment.payment_purpose, amountSen: payment.amount_sen, channel: payload.channel },
    });
  });

  if (payload.status === 'Paid' && payment.payment_purpose === 'initial') {
    const items = db.all<{ product_id: number; sku: string; product_name: string; quantity: number }>(
      'SELECT product_id, sku, product_name, quantity FROM order_items WHERE order_id = ?',
      [order.id],
    );
    deductStockForOrder(
      db,
      order.id,
      order.order_code,
      items.map((i) => ({ productId: i.product_id, sku: i.sku, productName: i.product_name, quantity: i.quantity })),
      {
        type: 'gateway',
        id: payload.gatewayRef,
        name: 'Verified Payment Callback',
      },
    );
    sendOrderEmail(db, {
      orderId: order.id,
      orderCode: order.order_code,
      recipient: order.customer_email,
      lang: order.lang,
      event: 'order_placed_paid',
    });
    adminEvents.emit({
      type: 'new_order',
      title: 'New Paid Order Received',
      message: `Order ${order.order_code} from ${order.customer_name} is paid and Preparing.`,
      orderCode: order.order_code,
      severity: 'info',
      timestamp: now,
    });
  } else if (payload.status === 'Paid' && payment.payment_purpose === 'topup') {
    adminEvents.emit({
      type: 'order_updated',
      title: 'Delivery Top-up Paid',
      message: `Order ${order.order_code} top-up paid. Ready to retry Lalamove booking.`,
      orderCode: order.order_code,
      severity: 'info',
      timestamp: now,
    });
  }

  return { duplicate: false, orderCode: order.order_code, paymentStatus: payload.status };
}

export interface RefundLineRequest {
  orderItemId: number;
  quantity: number;
}

/**
 * Merchant-only item-level partial/full refund via integrated payment gateway (SRS v1.3 Addendum).
 * - Rejects Pay at Store (no gateway transaction)
 * - Prevents duplicate/excessive refunds
 * - Never increases physical POSPAL/website stock
 */
export function initiateMerchantItemRefund(
  db: DbClient,
  params: {
    orderId: number;
    items: RefundLineRequest[];
    reason: string;
    idempotencyKey: string;
    adminUser: { id: number; displayName: string; role: 'owner' | 'staff' };
    simulateAsyncPending?: boolean;
  },
): {
  refundId: number;
  gatewayRefundId: string;
  amountSen: number;
  status: 'Pending' | 'Success' | 'Failed';
  errorMessage?: string;
} {
  if (!params.items || params.items.length === 0) {
    throw Object.assign(new Error('Select at least one unavailable item to refund.'), { statusCode: 400 });
  }
  if (!params.reason.trim()) {
    throw Object.assign(new Error('Refund reason is required.'), { statusCode: 400 });
  }

  // Idempotency check
  const existingRefund = db.get<{
    id: number;
    gateway_refund_id: string;
    amount_sen: number;
    status: 'Pending' | 'Success' | 'Failed';
    error_message: string;
  }>('SELECT id, gateway_refund_id, amount_sen, status, error_message FROM refund_transactions WHERE idempotency_key = ?', [
    params.idempotencyKey,
  ]);
  if (existingRefund) {
    return {
      refundId: existingRefund.id,
      gatewayRefundId: existingRefund.gateway_refund_id,
      amountSen: existingRefund.amount_sen,
      status: existingRefund.status,
      errorMessage: existingRefund.error_message || undefined,
    };
  }

  const order = db.get<{
    id: number;
    order_code: string;
    payment_method: string;
    payment_status: string;
    customer_email: string;
    lang: string;
    subtotal_sen: number;
  }>('SELECT * FROM orders WHERE id = ?', [params.orderId]);
  if (!order) {
    throw Object.assign(new Error('Order not found.'), { statusCode: 404 });
  }

  if (order.payment_method === 'pay_at_store') {
    throw Object.assign(
      new Error('Pay at Store orders have no online payment gateway transaction. Follow Owner offline settlement policy.'),
      { statusCode: 400 },
    );
  }
  if (order.payment_status !== 'Paid') {
    throw Object.assign(new Error('Gateway refund requires a settled Paid order.'), { statusCode: 400 });
  }

  const capturedPayment = db.get<{ id: number; amount_sen: number; gateway_ref: string }>(
    `SELECT id, amount_sen, gateway_ref FROM payments WHERE order_id = ? AND payment_purpose = 'initial' AND status = 'Paid'`,
    [order.id],
  );
  if (!capturedPayment) {
    throw Object.assign(new Error('No captured online gateway payment found for this order.'), { statusCode: 400 });
  }

  // Sum existing non-failed refunds so cumulative refunds never exceed captured eligible amount
  const prevRefundSum = db.get<{ total: number }>(
    `SELECT COALESCE(SUM(amount_sen), 0) AS total FROM refund_transactions WHERE order_id = ? AND status IN ('Pending', 'Success')`,
    [order.id],
  );
  const alreadyReservedSen = prevRefundSum?.total ?? 0;

  let totalRefundSen = 0;
  const allocations: Array<{ orderItemId: number; productName: string; quantity: number; amountSen: number }> = [];

  for (const reqLine of params.items) {
    if (!Number.isInteger(reqLine.quantity) || reqLine.quantity <= 0) {
      throw Object.assign(new Error('Refund quantity must be a positive integer.'), { statusCode: 400 });
    }
    const line = db.get<{
      id: number;
      product_name: string;
      unit_price_sen: number;
      quantity: number;
      refunded_qty: number;
      fulfilment_flag: string;
    }>('SELECT * FROM order_items WHERE id = ? AND order_id = ?', [reqLine.orderItemId, order.id]);
    if (!line) {
      throw Object.assign(new Error(`Order item ${reqLine.orderItemId} not found in order.`), { statusCode: 404 });
    }
    if (line.fulfilment_flag !== 'unavailable') {
      throw Object.assign(
        new Error(`Item "${line.product_name}" must be flagged unavailable before merchant gateway refund.`),
        { statusCode: 400 },
      );
    }

    // Also include Pending refunds for this line so concurrent calls cannot double-refund
    const pendingItemsRows = db.all<{ items_json: string }>(
      `SELECT items_json FROM refund_transactions WHERE order_id = ? AND status = 'Pending'`,
      [order.id],
    );
    let pendingQtyForLine = 0;
    for (const pr of pendingItemsRows) {
      const parsed = JSON.parse(pr.items_json) as Array<{ orderItemId: number; quantity: number }>;
      for (const p of parsed) {
        if (p.orderItemId === line.id) pendingQtyForLine += p.quantity;
      }
    }

    if (line.refunded_qty + pendingQtyForLine + reqLine.quantity > line.quantity) {
      throw Object.assign(
        new Error(
          `Refund quantity exceeds remaining eligible quantity for "${line.product_name}" (ordered ${line.quantity}, already refunded/pending ${line.refunded_qty + pendingQtyForLine}).`,
        ),
        { statusCode: 400 },
      );
    }

    const lineRefundSen = line.unit_price_sen * reqLine.quantity;
    totalRefundSen += lineRefundSen;
    allocations.push({
      orderItemId: line.id,
      productName: line.product_name,
      quantity: reqLine.quantity,
      amountSen: lineRefundSen,
    });
  }

  if (alreadyReservedSen + totalRefundSen > capturedPayment.amount_sen) {
    throw Object.assign(new Error('Total refunds cannot exceed captured gateway payment amount.'), { statusCode: 400 });
  }

  const now = new Date().toISOString();
  const gatewayRefundId = `GW-RF-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

  let refundId = 0;
  db.transaction(() => {
    const res = db.run(
      `INSERT INTO refund_transactions
       (order_id, payment_id, idempotency_key, gateway_refund_id, amount_sen, items_json, reason, status, initiated_by_id, initiated_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?)`,
      [
        order.id,
        capturedPayment.id,
        params.idempotencyKey,
        gatewayRefundId,
        totalRefundSen,
        JSON.stringify(allocations),
        params.reason.trim(),
        params.adminUser.id,
        params.adminUser.displayName,
        now,
      ],
    );
    refundId = res.lastInsertRowid;

    writeAuditLog(db, {
      actorType: params.adminUser.role,
      actorId: params.adminUser.id,
      actorName: params.adminUser.displayName,
      action: 'MERCHANT_REFUND_INITIATED',
      entityType: 'order',
      entityId: order.order_code,
      details: { refundId, gatewayRefundId, amountSen: totalRefundSen, allocations, reason: params.reason },
    });
  });

  if (params.simulateAsyncPending) {
    return { refundId, gatewayRefundId, amountSen: totalRefundSen, status: 'Pending' };
  }

  // Call simulated gateway server-to-server refund endpoint
  const settings = db.get<{ gateway_force_refund_failure: number }>(
    'SELECT gateway_force_refund_failure FROM store_settings WHERE id = 1',
  );
  if (settings?.gateway_force_refund_failure === 1) {
    return finalizeGatewayRefundOutcome(db, {
      eventId: `gw-rf-evt:${gatewayRefundId}:fail`,
      gatewayRefundId,
      status: 'Failed',
      errorMessage: 'GATEWAY_REFUND_REJECTED: Provider returned settlement/channel error (no funds reversed).',
    });
  }

  return finalizeGatewayRefundOutcome(db, {
    eventId: `gw-rf-evt:${gatewayRefundId}:ok`,
    gatewayRefundId,
    status: 'Success',
  });
}

/**
 * Confirms or fails a Pending gateway refund (from gateway sync response or signed webhook).
 * NOTE: Refund is financial-only; NEVER auto-restocks products or POSPAL inventory (FR-037, AT-13).
 */
export function finalizeGatewayRefundOutcome(
  db: DbClient,
  outcome: {
    eventId: string;
    gatewayRefundId: string;
    status: 'Success' | 'Failed';
    errorMessage?: string;
  },
): {
  refundId: number;
  gatewayRefundId: string;
  amountSen: number;
  status: 'Pending' | 'Success' | 'Failed';
  errorMessage?: string;
} {
  const refund = db.get<{
    id: number;
    order_id: number;
    amount_sen: number;
    items_json: string;
    status: string;
  }>('SELECT id, order_id, amount_sen, items_json, status FROM refund_transactions WHERE gateway_refund_id = ?', [
    outcome.gatewayRefundId,
  ]);
  if (!refund) {
    throw Object.assign(new Error(`Refund ${outcome.gatewayRefundId} not found.`), { statusCode: 404 });
  }

  const existingEvt = db.get<{ id: number }>(
    `SELECT id FROM processed_webhooks WHERE provider = 'gateway_refund' AND event_id = ?`,
    [outcome.eventId],
  );
  if (existingEvt || refund.status !== 'Pending') {
    return {
      refundId: refund.id,
      gatewayRefundId: outcome.gatewayRefundId,
      amountSen: refund.amount_sen,
      status: refund.status as 'Pending' | 'Success' | 'Failed',
    };
  }

  const order = db.get<{ id: number; order_code: string; customer_email: string; lang: string }>(
    'SELECT id, order_code, customer_email, lang FROM orders WHERE id = ?',
    [refund.order_id],
  )!;
  const now = new Date().toISOString();

  db.transaction(() => {
    db.run(`INSERT INTO processed_webhooks (provider, event_id, processed_at) VALUES ('gateway_refund', ?, ?)`, [
      outcome.eventId,
      now,
    ]);

    db.run(
      `UPDATE refund_transactions SET status = ?, error_message = ?, confirmed_at = ? WHERE id = ?`,
      [outcome.status, outcome.errorMessage ?? '', outcome.status === 'Success' ? now : null, refund.id],
    );

    if (outcome.status === 'Success') {
      const allocations = JSON.parse(refund.items_json) as Array<{
        orderItemId: number;
        quantity: number;
        amountSen: number;
      }>;
      for (const alloc of allocations) {
        db.run(
          `UPDATE order_items
           SET refunded_qty = refunded_qty + ?, refunded_amount_sen = refunded_amount_sen + ?
           WHERE id = ?`,
          [alloc.quantity, alloc.amountSen, alloc.orderItemId],
        );
      }

      sendOrderEmail(db, {
        orderId: order.id,
        orderCode: order.order_code,
        recipient: order.customer_email,
        lang: order.lang,
        event: 'refund_processed',
        extra: {
          status: 'Success',
          amount: (refund.amount_sen / 100).toFixed(2),
          ref: outcome.gatewayRefundId,
        },
      });
    }

    writeAuditLog(db, {
      actorType: 'gateway',
      actorId: outcome.gatewayRefundId,
      actorName: 'Payment Gateway Refund API',
      action: `MERCHANT_REFUND_${outcome.status.toUpperCase()}`,
      entityType: 'order',
      entityId: order.order_code,
      details: {
        refundId: refund.id,
        amountSen: refund.amount_sen,
        errorMessage: outcome.errorMessage || null,
        physicalStockRestored: false,
      },
    });
  });

  adminEvents.emit({
    type: 'refund_updated',
    title: outcome.status === 'Success' ? 'Gateway Refund Confirmed' : 'Gateway Refund Failed',
    message:
      outcome.status === 'Success'
        ? `Refund ${outcome.gatewayRefundId} (RM ${(refund.amount_sen / 100).toFixed(2)}) succeeded for ${order.order_code}.`
        : `Refund ${outcome.gatewayRefundId} failed for ${order.order_code}: ${outcome.errorMessage}`,
    orderCode: order.order_code,
    severity: outcome.status === 'Success' ? 'info' : 'critical',
    timestamp: now,
  });

  return {
    refundId: refund.id,
    gatewayRefundId: outcome.gatewayRefundId,
    amountSen: refund.amount_sen,
    status: outcome.status,
    errorMessage: outcome.errorMessage,
  };
}
