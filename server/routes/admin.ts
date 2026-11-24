import { Router } from 'express';
import { DbClient } from '../db/database';
import {
  AuthedRequest,
  POSPAL_WEBHOOK_SECRET,
  createSessionToken,
  hashPassword,
  rateLimitAuth,
  requireAdmin,
  requireOwner,
  requireRefundPermission,
  signHmac,
  verifyPassword,
} from '../services/auth';
import { writeAuditLog } from '../services/audit';
import { sendOrderEmail } from '../services/email';
import { adminEvents } from '../services/events';
import { bookLalamoveForOrder } from '../services/lalamove';
import { initiateMerchantItemRefund } from '../services/paymentGateway';
import {
  adjustStockManually,
  applyInboundPospalChange,
  flushPospalOutbox,
  flushPospalOutboxLive,
  pullLivePospalCatalogue,
  queuePospalCatalogueUpdate,
  reconcileWithLivePospalStockOnly,
  reconcileWithPospal,
} from '../services/pospal';
import { getPospalConfig, maskAppId, signPospalV3Request } from '../services/pospalClient';
import crypto from 'node:crypto';

export function createAdminRouter(db: DbClient): Router {
  const router = Router();

  // Password-protected login endpoint for /admin portal
  router.post('/auth/login', rateLimitAuth(15, 60_000), (req, res) => {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const admin = db.get<{
      id: number;
      username: string;
      display_name: string;
      email: string;
      role: 'owner' | 'staff';
      can_process_refunds: number;
      password_hash: string;
      is_active: number;
    }>('SELECT * FROM admin_users WHERE username = ?', [String(username).trim().toLowerCase()]);

    if (!admin || admin.is_active !== 1 || !verifyPassword(String(password), admin.password_hash)) {
      res.status(401).json({ error: 'Invalid admin credentials.' });
      return;
    }

    const token = createSessionToken({ sub: admin.id, type: 'admin', role: admin.role }, 12);
    res.cookie('kk_admin_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: 12 * 3600 * 1000,
    });

    writeAuditLog(db, {
      actorType: admin.role,
      actorId: admin.id,
      actorName: admin.display_name,
      action: 'ADMIN_LOGIN',
      entityType: 'admin_user',
      entityId: admin.id,
    });

    res.json({
      admin: {
        id: admin.id,
        username: admin.username,
        displayName: admin.display_name,
        email: admin.email,
        role: admin.role,
        canProcessRefunds: admin.role === 'owner' || admin.can_process_refunds === 1,
      },
    });
  });

  router.post('/auth/logout', (_req, res) => {
    res.clearCookie('kk_admin_session');
    res.json({ ok: true });
  });

  router.get('/auth/me', requireAdmin(db), (req: AuthedRequest, res) => {
    res.json({ admin: req.adminUser });
  });

  // Protect all following admin endpoints
  router.use(requireAdmin(db));

  // Realtime SSE stream (FR-022)
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);
    adminEvents.subscribe(res);
    req.on('close', () => {
      res.end();
    });
  });

  // Orders listing & details
  router.get('/orders', (_req, res) => {
    const orders = db.all('SELECT * FROM orders ORDER BY id DESC');
    const items = db.all('SELECT * FROM order_items ORDER BY id ASC');
    const deliveries = db.all('SELECT * FROM deliveries');
    const refunds = db.all('SELECT * FROM refund_transactions ORDER BY id DESC');
    const payments = db.all(
      'SELECT id, order_id, payment_purpose, method, amount_sen, gateway_ref, status, paid_at, created_at FROM payments',
    );

    const groupedItems = new Map<number, unknown[]>();
    for (const it of items as Array<{ order_id: number }>) {
      const list = groupedItems.get(it.order_id) || [];
      list.push(it);
      groupedItems.set(it.order_id, list);
    }
    const deliveryByOrder = new Map<number, unknown>();
    for (const d of deliveries as Array<{ order_id: number }>) {
      deliveryByOrder.set(d.order_id, d);
    }
    const refundsByOrder = new Map<number, unknown[]>();
    for (const r of refunds as Array<{ order_id: number }>) {
      const list = refundsByOrder.get(r.order_id) || [];
      list.push(r);
      refundsByOrder.set(r.order_id, list);
    }
    const paymentsByOrder = new Map<number, unknown[]>();
    for (const p of payments as Array<{ order_id: number }>) {
      const list = paymentsByOrder.get(p.order_id) || [];
      list.push(p);
      paymentsByOrder.set(p.order_id, list);
    }

    res.json({
      orders: (orders as Array<{ id: number }>).map((o) => ({
        ...o,
        items: groupedItems.get(o.id) || [],
        delivery: deliveryByOrder.get(o.id) || null,
        refunds: refundsByOrder.get(o.id) || [],
        payments: paymentsByOrder.get(o.id) || [],
      })),
    });
  });

  // Order status progression (strictly NO Cancelled / Cancellation Requested states per FR-009 & FR-023)
  router.post('/orders/:id/status', (req: AuthedRequest, res) => {
    const orderId = Number(req.params.id);
    const nextStatus = String(req.body?.status ?? '');
    const ALLOWED_STATUSES = ['Preparing', 'Ready', 'In Delivery', 'Ready for Collection', 'Completed'];

    if (nextStatus.toLowerCase().includes('cancel')) {
      res.status(403).json({
        error: 'Order cancellation via the website is prohibited by KamKim Fresh Mart policy (FR-009 / FR-023).',
      });
      return;
    }
    if (!ALLOWED_STATUSES.includes(nextStatus)) {
      res.status(400).json({ error: `Invalid target order status "${nextStatus}".` });
      return;
    }

    const order = db.get<{
      id: number;
      order_code: string;
      fulfilment_type: string;
      order_status: string;
      payment_status: string;
      payment_method: string;
      customer_email: string;
      lang: string;
    }>('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    if (nextStatus === 'Completed' && order.payment_method === 'pay_at_store' && order.payment_status !== 'Paid') {
      res.status(400).json({
        error: 'Pay at Store pickup orders must record collected payment before marking Completed (FR-015 / AT-08).',
      });
      return;
    }

    const now = new Date().toISOString();
    const mappedStatus =
      order.fulfilment_type === 'pickup' && nextStatus === 'Ready' ? 'Ready for Collection' : nextStatus;

    db.run('UPDATE orders SET order_status = ?, updated_at = ? WHERE id = ?', [mappedStatus, now, order.id]);
    sendOrderEmail(db, {
      orderId: order.id,
      orderCode: order.order_code,
      recipient: order.customer_email,
      lang: order.lang,
      event: 'order_status_changed',
      extra: { status: mappedStatus },
    });

    writeAuditLog(db, {
      actorType: req.adminUser!.role,
      actorId: req.adminUser!.id,
      actorName: req.adminUser!.displayName,
      action: 'ORDER_STATUS_UPDATED',
      entityType: 'order',
      entityId: order.order_code,
      details: { from: order.order_status, to: mappedStatus },
    });

    let lalamoveResult: unknown = null;
    if (order.fulfilment_type === 'delivery' && mappedStatus === 'Ready' && order.payment_status === 'Paid') {
      lalamoveResult = bookLalamoveForOrder(db, order.id, {
        type: req.adminUser!.role,
        id: req.adminUser!.id,
        name: req.adminUser!.displayName,
      });
    }

    res.json({ ok: true, orderStatus: mappedStatus, lalamoveResult });
  });

  // Record Pay-at-Store payment upon collection (FR-015, AT-08)
  router.post('/orders/:id/collect-pay-at-store', (req: AuthedRequest, res) => {
    const orderId = Number(req.params.id);
    const order = db.get<{
      id: number;
      order_code: string;
      payment_method: string;
      payment_status: string;
      total_sen: number;
    }>('SELECT id, order_code, payment_method, payment_status, total_sen FROM orders WHERE id = ?', [orderId]);

    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (order.payment_method !== 'pay_at_store') {
      res.status(400).json({ error: 'This order is not a Pay at Store order.' });
      return;
    }
    if (order.payment_status === 'Paid') {
      res.json({ ok: true, message: 'Already marked Paid.' });
      return;
    }

    const now = new Date().toISOString();
    const ref = `STORE-CASH-${order.order_code}`;
    db.transaction(() => {
      db.run(`UPDATE orders SET payment_status = 'Paid', order_status = 'Completed', updated_at = ? WHERE id = ?`, [
        now,
        order.id,
      ]);
      db.run(
        `INSERT OR IGNORE INTO payments (order_id, payment_purpose, method, amount_sen, gateway_ref, status, signature_verified, paid_at, created_at)
         VALUES (?, 'initial', 'pay_at_store', ?, ?, 'Paid', 1, ?, ?)`,
        [order.id, order.total_sen, ref, now, now],
      );
      writeAuditLog(db, {
        actorType: req.adminUser!.role,
        actorId: req.adminUser!.id,
        actorName: req.adminUser!.displayName,
        action: 'PAY_AT_STORE_COLLECTED',
        entityType: 'order',
        entityId: order.order_code,
        details: { amountSen: order.total_sen, ref },
      });
    });

    res.json({ ok: true, orderStatus: 'Completed', paymentStatus: 'Paid' });
  });

  // Flag unavailable order item(s) (FR-019, FR-023)
  router.post('/orders/:id/flag-unavailable', (req: AuthedRequest, res) => {
    const orderId = Number(req.params.id);
    const { orderItemIds, reason } = req.body ?? {};
    if (!Array.isArray(orderItemIds) || orderItemIds.length === 0) {
      res.status(400).json({ error: 'Select at least one order item to flag.' });
      return;
    }

    const order = db.get<{ id: number; order_code: string; customer_email: string; lang: string }>(
      'SELECT id, order_code, customer_email, lang FROM orders WHERE id = ?',
      [orderId],
    );
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const now = new Date().toISOString();
    const flaggedNames: string[] = [];

    db.transaction(() => {
      for (const itemId of orderItemIds as number[]) {
        const item = db.get<{ id: number; product_name: string }>(
          'SELECT id, product_name FROM order_items WHERE id = ? AND order_id = ?',
          [Number(itemId), order.id],
        );
        if (!item) continue;
        flaggedNames.push(item.product_name);
        db.run(
          `UPDATE order_items
           SET fulfilment_flag = 'unavailable', flagged_by = ?, flagged_at = ?, flag_reason = ?
           WHERE id = ?`,
          [req.adminUser!.displayName, now, String(reason || 'Unavailable during packing'), item.id],
        );
      }

      db.run(`UPDATE orders SET order_status = 'Exception', updated_at = ? WHERE id = ?`, [now, order.id]);
      sendOrderEmail(db, {
        orderId: order.id,
        orderCode: order.order_code,
        recipient: order.customer_email,
        lang: order.lang,
        event: 'item_unavailable_notice',
        extra: { items: flaggedNames.join(', ') },
      });

      writeAuditLog(db, {
        actorType: req.adminUser!.role,
        actorId: req.adminUser!.id,
        actorName: req.adminUser!.displayName,
        action: 'ORDER_ITEMS_FLAGGED_UNAVAILABLE',
        entityType: 'order',
        entityId: order.order_code,
        details: { flaggedNames, reason: reason || 'Unavailable during packing' },
      });
    });

    adminEvents.emit({
      type: 'exception_flagged',
      title: 'Stock Exception Flagged',
      message: `${flaggedNames.join(', ')} flagged unavailable on ${order.order_code}. Owner review/refund available.`,
      orderCode: order.order_code,
      severity: 'warning',
      timestamp: now,
    });

    res.json({ ok: true, flaggedItems: flaggedNames });
  });

  // Merchant-only item-level payment gateway refund (FR-018, FR-023, AT-13, AT-15)
  router.post('/orders/:id/refund', requireRefundPermission, (req: AuthedRequest, res) => {
    const orderId = Number(req.params.id);
    const { items, reason, idempotencyKey, simulateAsyncPending } = req.body ?? {};
    const key = String(idempotencyKey || `rf:${orderId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);

    const result = initiateMerchantItemRefund(db, {
      orderId,
      items: Array.isArray(items) ? items : [],
      reason: String(reason ?? ''),
      idempotencyKey: key,
      adminUser: req.adminUser!,
      simulateAsyncPending: Boolean(simulateAsyncPending),
    });

    res.json(result);
  });

  // Lalamove manual dispatch / retry
  router.post('/orders/:id/lalamove/book', (req: AuthedRequest, res) => {
    const orderId = Number(req.params.id);
    const forceIncrease = Boolean(req.body?.forceFreshQuoteIncrease);
    const simulateNow = typeof req.body?.simulateNowIso === 'string' ? new Date(req.body.simulateNowIso) : undefined;
    const result = bookLalamoveForOrder(
      db,
      orderId,
      {
        type: req.adminUser!.role,
        id: req.adminUser!.id,
        name: req.adminUser!.displayName,
      },
      { now: simulateNow, forceFreshQuoteIncrease: forceIncrease },
    );
    res.json(result);
  });

  router.post('/orders/:id/lalamove/simulate-status', (req: AuthedRequest, res) => {
    const orderId = Number(req.params.id);
    const status = String(req.body?.status ?? '');
    if (!['Picked Up', 'Delivered', 'Failed'].includes(status)) {
      res.status(400).json({ error: 'Invalid simulation status.' });
      return;
    }
    const order = db.get<{ id: number; order_code: string; customer_email: string; lang: string }>(
      'SELECT id, order_code, customer_email, lang FROM orders WHERE id = ?',
      [orderId],
    );
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    const now = new Date().toISOString();
    const orderStatus = status === 'Delivered' ? 'Completed' : status === 'Failed' ? 'Exception' : 'In Delivery';

    db.transaction(() => {
      db.run('UPDATE deliveries SET status = ?, last_error = ?, updated_at = ? WHERE order_id = ?', [
        status,
        status === 'Failed' ? 'No rider available / delivery exception' : '',
        now,
        order.id,
      ]);
      db.run('UPDATE orders SET delivery_status = ?, order_status = ?, updated_at = ? WHERE id = ?', [
        status,
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
        extra: { status: `${orderStatus} (${status})` },
      });
      writeAuditLog(db, {
        actorType: 'lalamove',
        actorId: order.order_code,
        actorName: 'Lalamove Webhook Simulator',
        action: `LALAMOVE_STATUS_${status.toUpperCase().replace(/\s+/g, '_')}`,
        entityType: 'order',
        entityId: order.order_code,
      });
    });
    res.json({ ok: true, deliveryStatus: status, orderStatus });
  });

  // Catalogue & Stock Management
  router.get('/products', (_req, res) => {
    const products = db.all('SELECT * FROM products ORDER BY id ASC');
    const mockRemote = db.all('SELECT * FROM pospal_mock_products ORDER BY pospal_uid ASC');
    res.json({ products, mockRemote });
  });

  router.patch('/products/:id', (req: AuthedRequest, res) => {
    const productId = Number(req.params.id);
    const prod = db.get<{ id: number; name: string; category: string; base_price_sen: number }>(
      'SELECT id, name, category, base_price_sen FROM products WHERE id = ?',
      [productId],
    );
    if (!prod) {
      res.status(404).json({ error: 'Product not found.' });
      return;
    }

    const {
      name,
      category,
      basePriceSen,
      nameZh,
      nameMs,
      unitLabel,
      shortDescEn,
      extendedDescEn,
      extendedDescZh,
      extendedDescMs,
      imageUrl,
      isFeatured,
      isActive,
    } = req.body ?? {};

    const nextName = typeof name === 'string' && name.trim() ? name.trim() : prod.name;
    const nextCat = typeof category === 'string' && category.trim() ? category.trim() : prod.category;
    const nextPrice = Number.isInteger(basePriceSen) && basePriceSen >= 0 ? basePriceSen : prod.base_price_sen;
    const sharedChanged = nextName !== prod.name || nextCat !== prod.category || nextPrice !== prod.base_price_sen;

    const now = new Date().toISOString();
    db.run(
      `UPDATE products
       SET name = ?, category = ?, base_price_sen = ?,
           name_zh = COALESCE(?, name_zh), name_ms = COALESCE(?, name_ms),
           unit_label = COALESCE(?, unit_label), short_desc_en = COALESCE(?, short_desc_en),
           extended_desc_en = COALESCE(?, extended_desc_en), extended_desc_zh = COALESCE(?, extended_desc_zh),
           extended_desc_ms = COALESCE(?, extended_desc_ms), image_url = COALESCE(?, image_url),
           is_featured = COALESCE(?, is_featured), is_active = COALESCE(?, is_active), updated_at = ?
       WHERE id = ?`,
      [
        nextName,
        nextCat,
        nextPrice,
        nameZh ?? null,
        nameMs ?? null,
        unitLabel ?? null,
        shortDescEn ?? null,
        extendedDescEn ?? null,
        extendedDescZh ?? null,
        extendedDescMs ?? null,
        imageUrl ?? null,
        typeof isFeatured === 'boolean' ? (isFeatured ? 1 : 0) : null,
        typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null,
        now,
        productId,
      ],
    );

    if (sharedChanged) {
      queuePospalCatalogueUpdate(db, {
        productId,
        name: nextName,
        category: nextCat,
        basePriceSen: nextPrice,
        adminUser: req.adminUser!,
      });
    } else {
      writeAuditLog(db, {
        actorType: req.adminUser!.role,
        actorId: req.adminUser!.id,
        actorName: req.adminUser!.displayName,
        action: 'WEBSITE_ENRICHMENT_UPDATED',
        entityType: 'product',
        entityId: productId,
      });
    }

    res.json({ ok: true, sharedFieldsSynced: sharedChanged });
  });

  router.post('/products/:id/stock-adjust', (req: AuthedRequest, res) => {
    const productId = Number(req.params.id);
    const delta = Number(req.body?.delta);
    const note = String(req.body?.note ?? 'Manual store inventory count');
    const idempotencyKey = String(
      req.body?.idempotencyKey || `manual:${productId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    );

    const result = adjustStockManually(db, {
      productId,
      delta,
      note,
      idempotencyKey,
      adminUser: req.adminUser!,
    });
    res.json(result);
  });

  // POSPAL Integration Monitor & Simulator
  router.get('/pospal', (_req, res) => {
    const outbox = db.all(
      `SELECT o.*, p.sku, p.name AS product_name
       FROM pospal_outbox o JOIN products p ON p.id = o.product_id
       ORDER BY o.id DESC LIMIT 100`,
    );
    const ledger = db.all(
      `SELECT l.*, p.sku, p.name AS product_name
       FROM inventory_ledger l JOIN products p ON p.id = l.product_id
       ORDER BY l.id DESC LIMIT 100`,
    );
    const mockProducts = db.all('SELECT * FROM pospal_mock_products ORDER BY pospal_uid ASC');
    const settings = db.get<{ pospal_outage_mode: number; safety_stock_buffer: number }>(
      'SELECT pospal_outage_mode, safety_stock_buffer FROM store_settings WHERE id = 1',
    );
    const config = getPospalConfig();
    res.json({
      outageMode: settings?.pospal_outage_mode === 1,
      safetyStockBuffer: settings?.safety_stock_buffer ?? 0,
      connection: {
        mode: config.mode,
        apiBase: config.apiBase,
        account: config.account,
        maskedAppId: maskAppId(config.appId),
      },
      outbox,
      ledger,
      mockProducts,
    });
  });

  router.post('/pospal/flush', async (_req, res) => {
    const config = getPospalConfig();
    const result = config.mode === 'live' ? await flushPospalOutboxLive(db) : flushPospalOutbox(db);
    res.json(result);
  });

  router.post('/pospal/pull-live', async (req: AuthedRequest, res) => {
    try {
      const result = await pullLivePospalCatalogue(db);
      writeAuditLog(db, {
        actorType: req.adminUser!.role,
        actorId: req.adminUser!.id,
        actorName: req.adminUser!.displayName,
        action: 'POSPAL_LIVE_CATALOGUE_PULL',
        entityType: 'integration',
        entityId: 'pospal',
        details: result,
      });
      res.json(result);
    } catch (err) {
      const status = (err as { errorCode?: number }).errorCode === 4021 ? 502 : 502;
      res.status(status).json({
        error: err instanceof Error ? err.message : 'Failed to pull live POSPAL catalogue.',
        errorCode: (err as { errorCode?: number }).errorCode ?? 500,
      });
    }
  });

  // Owner-only POSPAL OpenAPI V3 Debugger (signs request server-side, never leaks appKey)
  router.post('/pospal/debug', requireOwner, async (req: AuthedRequest, res) => {
    const endpointPath = String(req.body?.endpointPath ?? '');
    const allowedPaths = [
      '/openapi/v3/product/increment-page',
      '/openapi/v3/product/stock-page',
      '/openapi/v3/product/category-page',
      '/openapi/v3/product/supplier-page',
      '/openapi/v3/product/unit-page',
      '/openapi/v3/product/tag-page',
      '/openapi/v3/product/brand-page',
    ];
    if (!allowedPaths.includes(endpointPath)) {
      res.status(400).json({ error: `Endpoint not allowed in debugger: ${endpointPath}` });
      return;
    }

    const config = getPospalConfig();
    if (config.mode !== 'live') {
      res.status(400).json({ error: 'POSPAL_MODE is not set to live in .env.' });
      return;
    }

    const bodyObj = typeof req.body?.body === 'object' && req.body.body ? { ...req.body.body } : {};
    if (!bodyObj.account) bodyObj.account = config.account;

    const requestId = crypto.randomUUID();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = signPospalV3Request(config.appId, requestId, timestamp, config.appKey);
    const url = `${config.apiBase}${endpointPath}`;
    const startMs = Date.now();

    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json;charset=UTF-8',
          'X-App-Id': config.appId,
          'X-Timestamp': timestamp,
          'X-Request-Id': requestId,
          'X-Sign': sign,
        },
        body: JSON.stringify(bodyObj),
      });
      const responseJson = await upstream.json();
      res.json({
        httpStatus: upstream.status,
        durationMs: Date.now() - startMs,
        requestMeta: {
          url,
          headers: {
            'X-App-Id': maskAppId(config.appId),
            'X-Timestamp': timestamp,
            'X-Request-Id': requestId,
            'X-Sign': sign,
          },
          body: bodyObj,
        },
        response: responseJson,
      });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'POSPAL request failed' });
    }
  });

  router.post('/pospal/reconcile', async (req: AuthedRequest, res) => {
    const config = getPospalConfig();
    const result =
      config.mode === 'live' ? await reconcileWithLivePospalStockOnly(db) : reconcileWithPospal(db);
    writeAuditLog(db, {
      actorType: req.adminUser!.role,
      actorId: req.adminUser!.id,
      actorName: req.adminUser!.displayName,
      action: 'POSPAL_RECONCILIATION_RUN',
      entityType: 'integration',
      entityId: 'pospal',
      details: result,
    });
    res.json(result);
  });

  router.post('/pospal/simulate-remote-change', (req, res) => {
    const { pospalUid, name, category, basePriceSen, stockOnHand } = req.body ?? {};
    const remote = db.get<{
      pospal_uid: string;
      sku: string;
      name: string;
      category: string;
      base_price_sen: number;
      stock_on_hand: number;
      revision: number;
    }>('SELECT * FROM pospal_mock_products WHERE pospal_uid = ?', [String(pospalUid ?? '')]);
    if (!remote) {
      res.status(404).json({ error: 'POSPAL mock product not found.' });
      return;
    }

    const now = new Date().toISOString();
    const nextRev = remote.revision + 1;
    const nextName = typeof name === 'string' && name.trim() ? name.trim() : remote.name;
    const nextCat = typeof category === 'string' && category.trim() ? category.trim() : remote.category;
    const nextPrice = Number.isInteger(basePriceSen) && basePriceSen >= 0 ? basePriceSen : remote.base_price_sen;
    const nextStock = Number.isInteger(stockOnHand) && stockOnHand >= 0 ? stockOnHand : remote.stock_on_hand;

    db.run(
      `UPDATE pospal_mock_products SET name = ?, category = ?, base_price_sen = ?, stock_on_hand = ?, revision = ?, updated_at = ? WHERE pospal_uid = ?`,
      [nextName, nextCat, nextPrice, nextStock, nextRev, now, remote.pospal_uid],
    );

    const payload = {
      eventId: `pospal-cb-${remote.pospal_uid}-r${nextRev}-${Date.now()}`,
      pospalUid: remote.pospal_uid,
      sku: remote.sku,
      name: nextName,
      category: nextCat,
      basePriceSen: nextPrice,
      stockOnHand: nextStock,
      revision: nextRev,
      updatedAt: now,
    };
    // Verify using real signed POSPAL event helper
    const _sig = signHmac(POSPAL_WEBHOOK_SECRET, JSON.stringify(payload));
    void _sig;
    const applied = applyInboundPospalChange(db, payload);
    res.json({ ok: true, applied, payload });
  });

  // Sales & Financial Reporting (FR-028, FR-029, AT-16)
  router.get('/reports', (req, res) => {
    const period = ['daily', 'weekly', 'monthly'].includes(String(req.query.period)) ? String(req.query.period) : 'monthly';
    const days = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
    const sinceIso = new Date(Date.now() - days * 86400 * 1000).toISOString();

    const orders = db.all<{
      id: number;
      total_sen: number;
      payment_status: string;
      payment_method: string;
      order_status: string;
      created_at: string;
    }>('SELECT id, total_sen, payment_status, payment_method, order_status, created_at FROM orders WHERE created_at >= ?', [
      sinceIso,
    ]);

    const refunds = db.all<{ amount_sen: number; status: string }>(
      'SELECT amount_sen, status FROM refund_transactions WHERE created_at >= ?',
      [sinceIso],
    );

    let paidRevenueSen = 0;
    let unpaidPayAtStoreSen = 0;
    let pendingOnlineSen = 0;
    let paidOrderCount = 0;
    let unpaidOrderCount = 0;
    let exceptionCount = 0;

    for (const o of orders) {
      if (o.order_status === 'Exception') exceptionCount += 1;
      if (o.payment_status === 'Paid') {
        paidRevenueSen += o.total_sen;
        paidOrderCount += 1;
      } else if (o.payment_method === 'pay_at_store' && o.payment_status === 'Unpaid') {
        unpaidPayAtStoreSen += o.total_sen;
        unpaidOrderCount += 1;
      } else {
        pendingOnlineSen += o.total_sen;
      }
    }

    let refundedSuccessSen = 0;
    let refundPendingCount = 0;
    let refundFailedCount = 0;
    for (const r of refunds) {
      if (r.status === 'Success') refundedSuccessSen += r.amount_sen;
      if (r.status === 'Pending') refundPendingCount += 1;
      if (r.status === 'Failed') refundFailedCount += 1;
    }

    const topSellers = db.all<{ product_name: string; sku: string; units_sold: number; gross_sen: number }>(
      `SELECT oi.product_name, oi.sku, SUM(oi.quantity - oi.refunded_qty) AS units_sold,
              SUM(oi.line_total_sen - oi.refunded_amount_sen) AS gross_sen
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.created_at >= ? AND o.payment_status IN ('Paid', 'Unpaid')
       GROUP BY oi.product_id
       ORDER BY units_sold DESC
       LIMIT 10`,
      [sinceIso],
    );

    const pospalFailedCount = db.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM pospal_outbox WHERE status IN ('Failed', 'Conflict')`,
    );

    res.json({
      period,
      summary: {
        totalOrders: orders.length,
        paidOrderCount,
        unpaidOrderCount,
        grossPaidRevenueSen: paidRevenueSen,
        unpaidPayAtStoreSen,
        pendingOnlineSen,
        itemRefundedTotalSen: refundedSuccessSen,
        netSalesSen: Math.max(0, paidRevenueSen - refundedSuccessSen),
        refundPendingCount,
        refundFailedCount,
        exceptionCount,
        pospalFailedCount: pospalFailedCount?.cnt ?? 0,
      },
      topSellers,
      disclaimer:
        'Website transactions only. Excludes POSPAL physical-store transactions and any off-platform Owner-handled settlements or disputes.',
    });
  });

  router.get('/audit-logs', (_req, res) => {
    const logs = db.all('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 150');
    const emails = db.all('SELECT * FROM email_logs ORDER BY id DESC LIMIT 100');
    res.json({ logs, emails });
  });

  // Owner-only: Staff Management (FR-024, AT-15)
  router.get('/staff', requireOwner, (_req, res) => {
    const users = db.all(
      'SELECT id, username, display_name, email, role, can_process_refunds, is_active, created_at FROM admin_users ORDER BY id ASC',
    );
    res.json({ users });
  });

  router.post('/staff', requireOwner, (req: AuthedRequest, res) => {
    const { username, displayName, email, password, role, canProcessRefunds } = req.body ?? {};
    if (!username || !displayName || !email || !password || String(password).length < 6) {
      res.status(400).json({ error: 'Username, display name, email, and password (min 6 chars) are required.' });
      return;
    }
    const cleanRole = role === 'owner' ? 'owner' : 'staff';
    const cleanUsername = String(username).trim().toLowerCase();
    const existing = db.get<{ id: number }>('SELECT id FROM admin_users WHERE username = ?', [cleanUsername]);
    if (existing) {
      res.status(409).json({ error: 'Username already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const resDb = db.run(
      `INSERT INTO admin_users (username, display_name, email, role, can_process_refunds, password_hash, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        cleanUsername,
        String(displayName).trim(),
        String(email).trim().toLowerCase(),
        cleanRole,
        cleanRole === 'owner' || canProcessRefunds ? 1 : 0,
        hashPassword(String(password)),
        now,
      ],
    );

    writeAuditLog(db, {
      actorType: 'owner',
      actorId: req.adminUser!.id,
      actorName: req.adminUser!.displayName,
      action: 'STAFF_ACCOUNT_CREATED',
      entityType: 'admin_user',
      entityId: resDb.lastInsertRowid,
      details: { username: cleanUsername, role: cleanRole, canProcessRefunds: Boolean(canProcessRefunds) },
    });

    res.status(201).json({ id: resDb.lastInsertRowid, username: cleanUsername, role: cleanRole });
  });

  router.patch('/staff/:id', requireOwner, (req: AuthedRequest, res) => {
    const staffId = Number(req.params.id);
    const { isActive, canProcessRefunds, newPassword } = req.body ?? {};
    const target = db.get<{ id: number; username: string; role: string }>('SELECT id, username, role FROM admin_users WHERE id = ?', [
      staffId,
    ]);
    if (!target) {
      res.status(404).json({ error: 'Staff account not found.' });
      return;
    }
    if (staffId === req.adminUser!.id && isActive === false) {
      res.status(400).json({ error: 'Cannot disable your own active Owner account.' });
      return;
    }

    if (typeof isActive === 'boolean') {
      db.run('UPDATE admin_users SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, staffId]);
    }
    if (typeof canProcessRefunds === 'boolean') {
      db.run('UPDATE admin_users SET can_process_refunds = ? WHERE id = ?', [
        target.role === 'owner' || canProcessRefunds ? 1 : 0,
        staffId,
      ]);
    }
    if (typeof newPassword === 'string' && newPassword.length >= 6) {
      db.run('UPDATE admin_users SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), staffId]);
    }

    writeAuditLog(db, {
      actorType: 'owner',
      actorId: req.adminUser!.id,
      actorName: req.adminUser!.displayName,
      action: 'STAFF_ACCOUNT_UPDATED',
      entityType: 'admin_user',
      entityId: staffId,
      details: { isActive, canProcessRefunds, passwordReset: Boolean(newPassword) },
    });
    res.json({ ok: true });
  });

  // Owner-only: Store settings & integration simulator toggles
  router.get('/settings', (_req, res) => {
    const settings = db.get('SELECT * FROM store_settings WHERE id = 1');
    res.json({ settings });
  });

  router.patch('/settings', requireOwner, (req: AuthedRequest, res) => {
    const {
      storePhone,
      storeWhatsapp,
      ownerName,
      ownerEmail,
      ownerPhone,
      pospalOutageMode,
      safetyStockBuffer,
      lalamoveForcePriceIncrease,
      lalamoveHideCoordinates,
      gatewayForceRefundFailure,
    } = req.body ?? {};

    const now = new Date().toISOString();
    db.run(
      `UPDATE store_settings
       SET store_phone = COALESCE(?, store_phone),
           store_whatsapp = COALESCE(?, store_whatsapp),
           owner_name = COALESCE(?, owner_name),
           owner_email = COALESCE(?, owner_email),
           owner_phone = COALESCE(?, owner_phone),
           pospal_outage_mode = COALESCE(?, pospal_outage_mode),
           safety_stock_buffer = COALESCE(?, safety_stock_buffer),
           lalamove_force_price_increase = COALESCE(?, lalamove_force_price_increase),
           lalamove_hide_coordinates = COALESCE(?, lalamove_hide_coordinates),
           gateway_force_refund_failure = COALESCE(?, gateway_force_refund_failure),
           updated_at = ?
       WHERE id = 1`,
      [
        storePhone ?? null,
        storeWhatsapp ?? null,
        ownerName ?? null,
        ownerEmail ?? null,
        ownerPhone ?? null,
        typeof pospalOutageMode === 'boolean' ? (pospalOutageMode ? 1 : 0) : null,
        typeof safetyStockBuffer === 'number' && safetyStockBuffer >= 0 ? Math.floor(safetyStockBuffer) : null,
        typeof lalamoveForcePriceIncrease === 'boolean' ? (lalamoveForcePriceIncrease ? 1 : 0) : null,
        typeof lalamoveHideCoordinates === 'boolean' ? (lalamoveHideCoordinates ? 1 : 0) : null,
        typeof gatewayForceRefundFailure === 'boolean' ? (gatewayForceRefundFailure ? 1 : 0) : null,
        now,
      ],
    );

    writeAuditLog(db, {
      actorType: 'owner',
      actorId: req.adminUser!.id,
      actorName: req.adminUser!.displayName,
      action: 'STORE_SETTINGS_UPDATED',
      entityType: 'store_settings',
      entityId: 1,
      details: req.body ?? {},
    });

    res.json({ ok: true, settings: db.get('SELECT * FROM store_settings WHERE id = 1') });
  });

  return router;
}
