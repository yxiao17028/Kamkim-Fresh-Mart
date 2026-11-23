import { Request, Router } from 'express';
import { DbClient } from '../db/database';
import {
  LALAMOVE_WEBHOOK_SECRET,
  POSPAL_WEBHOOK_SECRET,
  PAYMENT_WEBHOOK_SECRET,
  verifyHmac,
} from '../services/auth';
import { writeAuditLog } from '../services/audit';
import { sendOrderEmail } from '../services/email';
import { finalizeGatewayRefundOutcome, handleGatewayPaymentWebhook } from '../services/paymentGateway';
import { applyInboundPospalChange } from '../services/pospal';
import { getPospalConfig, verifyPospalV3Callback } from '../services/pospalClient';

function getRawBody(req: Request): string {
  const withRaw = req as Request & { rawBody?: string };
  if (typeof withRaw.rawBody === 'string') return withRaw.rawBody;
  return typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
}

export function createWebhooksRouter(db: DbClient): Router {
  const router = Router();

  router.post('/payment', (req, res) => {
    const sig = String(req.headers['x-gateway-signature'] ?? '');
    const rawBody = getRawBody(req);
    const result = handleGatewayPaymentWebhook(db, rawBody, sig);
    res.json(result);
  });

  router.post('/refund', (req, res) => {
    const sig = String(req.headers['x-gateway-signature'] ?? '');
    const rawBody = getRawBody(req);
    if (!verifyHmac(PAYMENT_WEBHOOK_SECRET, rawBody, sig)) {
      res.status(401).json({ error: 'Invalid refund webhook signature.' });
      return;
    }
    const payload = JSON.parse(rawBody) as {
      eventId: string;
      gatewayRefundId: string;
      status: 'Success' | 'Failed';
      errorMessage?: string;
    };
    const result = finalizeGatewayRefundOutcome(db, payload);
    res.json(result);
  });

  router.post('/pospal', (req, res) => {
    const rawBody = getRawBody(req);
    const v3Sign = String(req.headers['x-sign'] ?? '');
    const v3EventId = String(req.headers['x-event-id'] ?? '');
    const v3Timestamp = String(req.headers['x-timestamp'] ?? '');
    const legacySig = String(req.headers['x-pospal-signature'] ?? '');
    const config = getPospalConfig();

    if (v3Sign && v3EventId && v3Timestamp) {
      if (!verifyPospalV3Callback(config.callbackSecret, v3EventId, v3Timestamp, v3Sign)) {
        res.status(401).json({ error: 'Invalid POSPAL V3 callback signature.' });
        return;
      }
      const parsed = JSON.parse(rawBody) as {
        eventId?: string;
        eventType?: string;
        eventTime?: string;
        data?: {
          uid: string | number;
          barcode: string;
          name: string;
          sellPrice: number;
          stock: number;
          enable?: number;
          sysUpdateTime?: string;
        };
      };
      if (parsed.eventType && parsed.eventType !== 'product.change') {
        res.json({ ignored: true, eventType: parsed.eventType });
        return;
      }
      if (!parsed.data) {
        res.status(400).json({ error: 'Missing data payload in POSPAL V3 callback.' });
        return;
      }
      const result = applyInboundPospalChange(db, {
        eventId: parsed.eventId || v3EventId,
        pospalUid: String(parsed.data.uid),
        sku: parsed.data.barcode || `PP-${parsed.data.uid}`,
        name: parsed.data.name,
        category: 'POSPAL Synced',
        basePriceSen: Math.round(Number(parsed.data.sellPrice || 0) * 100),
        stockOnHand: Math.max(0, Math.round(Number(parsed.data.stock || 0))),
        revision: Math.floor(Number(v3Timestamp) || Date.now() / 1000),
        updatedAt: parsed.data.sysUpdateTime || parsed.eventTime || new Date().toISOString(),
      });
      res.json(result);
      return;
    }

    if (!verifyHmac(POSPAL_WEBHOOK_SECRET, rawBody, legacySig)) {
      res.status(401).json({ error: 'Invalid POSPAL webhook signature.' });
      return;
    }
    const payload = JSON.parse(rawBody) as Parameters<typeof applyInboundPospalChange>[1];
    const result = applyInboundPospalChange(db, payload);
    res.json(result);
  });

  router.post('/lalamove', (req, res) => {
    const sig = String(req.headers['x-lalamove-signature'] ?? '');
    const rawBody = getRawBody(req);
    if (!verifyHmac(LALAMOVE_WEBHOOK_SECRET, rawBody, sig)) {
      res.status(401).json({ error: 'Invalid Lalamove webhook signature.' });
      return;
    }

    const payload = JSON.parse(rawBody) as {
      eventId: string;
      lalamoveOrderId: string;
      status: 'Driver Assigned' | 'Picked Up' | 'Delivered' | 'Failed';
      driverLat?: number | null;
      driverLng?: number | null;
    };

    const existing = db.get<{ id: number }>(
      `SELECT id FROM processed_webhooks WHERE provider = 'lalamove' AND event_id = ?`,
      [payload.eventId],
    );
    if (existing) {
      res.json({ duplicate: true });
      return;
    }

    const delivery = db.get<{ id: number; order_id: number }>(
      'SELECT id, order_id FROM deliveries WHERE lalamove_order_id = ?',
      [payload.lalamoveOrderId],
    );
    if (!delivery) {
      res.status(404).json({ error: 'Delivery record not found.' });
      return;
    }

    const order = db.get<{ id: number; order_code: string; customer_email: string; lang: string }>(
      'SELECT id, order_code, customer_email, lang FROM orders WHERE id = ?',
      [delivery.order_id],
    )!;
    const now = new Date().toISOString();
    const orderStatus = payload.status === 'Delivered' ? 'Completed' : payload.status === 'Failed' ? 'Exception' : 'In Delivery';

    db.transaction(() => {
      db.run(`INSERT INTO processed_webhooks (provider, event_id, processed_at) VALUES ('lalamove', ?, ?)`, [
        payload.eventId,
        now,
      ]);
      db.run(
        `UPDATE deliveries SET status = ?, driver_lat = COALESCE(?, driver_lat), driver_lng = COALESCE(?, driver_lng), updated_at = ? WHERE id = ?`,
        [payload.status, payload.driverLat ?? null, payload.driverLng ?? null, now, delivery.id],
      );
      db.run(`UPDATE orders SET delivery_status = ?, order_status = ?, updated_at = ? WHERE id = ?`, [
        payload.status,
        orderStatus,
        now,
        order.id,
      ]);
      sendOrderEmail(db, {
        orderId: order.id,
        orderCode: order.order_code,
        recipient: order.customer_email,
        lang: order.lang,
        event: 'order_status_changed',
        extra: { status: `${orderStatus} (${payload.status})` },
      });
      writeAuditLog(db, {
        actorType: 'lalamove',
        actorId: payload.lalamoveOrderId,
        actorName: 'Lalamove Webhook',
        action: `LALAMOVE_WEBHOOK_${payload.status.toUpperCase().replace(/\s+/g, '_')}`,
        entityType: 'order',
        entityId: order.order_code,
      });
    });

    res.json({ duplicate: false, orderCode: order.order_code, deliveryStatus: payload.status });
  });

  return router;
}
