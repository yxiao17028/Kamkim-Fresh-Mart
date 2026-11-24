import crypto from 'node:crypto';
import { DbClient } from '../db/database';
import { writeAuditLog } from './audit';
import { adminEvents } from './events';
import {
  fetchAllPospalV3Products,
  fetchAllPospalV3Stock,
  getPospalConfig,
  pushPospalV3ProductUpdate,
  pushPospalV3StockBatchAdjust,
} from './pospalClient';

export interface StockOrderItem {
  productId: number;
  sku: string;
  productName: string;
  quantity: number;
}

export function recomputeSellableStock(db: DbClient, productId: number): number {
  const settings = db.get<{ safety_stock_buffer: number }>(
    'SELECT safety_stock_buffer FROM store_settings WHERE id = 1',
  );
  const buffer = settings?.safety_stock_buffer ?? 0;
  const product = db.get<{ pospal_stock: number }>('SELECT pospal_stock FROM products WHERE id = ?', [productId]);
  if (!product) return 0;

  const unsent = db.get<{ total_delta: number | null }>(
    `SELECT COALESCE(SUM(delta), 0) AS total_delta
     FROM pospal_outbox
     WHERE product_id = ? AND event_type = 'stock_delta' AND status IN ('Pending', 'Failed', 'Conflict')`,
    [productId],
  );
  const pendingDelta = unsent?.total_delta ?? 0;
  const sellable = Math.max(0, product.pospal_stock + pendingDelta - buffer);
  db.run('UPDATE products SET sellable_stock = ?, updated_at = ? WHERE id = ?', [
    sellable,
    new Date().toISOString(),
    productId,
  ]);
  return sellable;
}

/**
 * Deducts local sellable stock atomically once for an order and queues a POSPAL inventory delta.
 * Never creates a sales order in POSPAL (FR-039).
 */
export function deductStockForOrder(
  db: DbClient,
  orderId: number,
  orderCode: string,
  items: StockOrderItem[],
  actor: { type: 'customer' | 'guest' | 'system' | 'gateway'; id: string; name: string },
): void {
  db.transaction(() => {
    const order = db.get<{ stock_deducted: number }>('SELECT stock_deducted FROM orders WHERE id = ?', [orderId]);
    if (!order || order.stock_deducted === 1) {
      return; // Idempotent guard
    }

    const now = new Date().toISOString();
    for (const item of items) {
      const prod = db.get<{ id: number; name: string; sellable_stock: number; pospal_uid: string; sku: string }>(
        'SELECT id, name, sellable_stock, pospal_uid, sku FROM products WHERE id = ?',
        [item.productId],
      );
      if (!prod) {
        throw Object.assign(new Error(`Product ${item.productName} not found.`), { statusCode: 400 });
      }
      if (prod.sellable_stock < item.quantity) {
        throw Object.assign(
          new Error(`Insufficient stock for ${prod.name}. Available: ${prod.sellable_stock}, requested: ${item.quantity}.`),
          { statusCode: 409 },
        );
      }
    }

    for (const item of items) {
      const prod = db.get<{ id: number; sellable_stock: number; pospal_uid: string; sku: string }>(
        'SELECT id, sellable_stock, pospal_uid, sku FROM products WHERE id = ?',
        [item.productId],
      )!;
      const newBalance = prod.sellable_stock - item.quantity;
      const ledgerKey = `order-deduct:${orderId}:${item.productId}`;
      const outboxKey = `pospal-order-delta:${orderId}:${item.productId}`;

      db.run('UPDATE products SET sellable_stock = ?, updated_at = ? WHERE id = ?', [newBalance, now, item.productId]);

      db.run(
        `INSERT OR IGNORE INTO inventory_ledger
         (product_id, delta, balance_after, reason, reference_type, reference_id, idempotency_key, actor_type, actor_id, note, created_at)
         VALUES (?, ?, ?, 'order_deduct', 'order', ?, ?, ?, ?, ?, ?)`,
        [
          item.productId,
          -item.quantity,
          newBalance,
          orderCode,
          ledgerKey,
          actor.type,
          actor.id,
          `Stock deducted for online order ${orderCode} (no POSPAL sales order created)`,
          now,
        ],
      );

      db.run(
        `INSERT OR IGNORE INTO pospal_outbox
         (event_type, product_id, delta, payload_json, idempotency_key, status, attempts, created_at, updated_at)
         VALUES ('stock_delta', ?, ?, ?, ?, 'Pending', 0, ?, ?)`,
        [
          item.productId,
          -item.quantity,
          JSON.stringify({ pospalUid: prod.pospal_uid, sku: prod.sku, delta: -item.quantity, sourceOrderCode: orderCode }),
          outboxKey,
          now,
          now,
        ],
      );
    }

    db.run(`UPDATE orders SET stock_deducted = 1, pos_sync_status = 'Queued', updated_at = ? WHERE id = ?`, [
      now,
      orderId,
    ]);

    writeAuditLog(db, {
      actorType: actor.type,
      actorId: actor.id,
      actorName: actor.name,
      action: 'STOCK_DEDUCTED_FOR_ORDER',
      entityType: 'order',
      entityId: orderCode,
      details: { itemCount: items.length },
    });
  });

  flushPospalOutbox(db);
}

export function adjustStockManually(
  db: DbClient,
  params: {
    productId: number;
    delta: number;
    note: string;
    idempotencyKey: string;
    adminUser: { id: number; displayName: string; role: 'owner' | 'staff' };
  },
): { sellableStock: number; outboxStatus: string } {
  if (!Number.isInteger(params.delta) || params.delta === 0) {
    throw Object.assign(new Error('Stock adjustment delta must be a non-zero integer.'), { statusCode: 400 });
  }

  const existingLedger = db.get<{ id: number; balance_after: number }>(
    'SELECT id, balance_after FROM inventory_ledger WHERE idempotency_key = ?',
    [params.idempotencyKey],
  );
  if (existingLedger) {
    return { sellableStock: existingLedger.balance_after, outboxStatus: 'Confirmed' };
  }

  const now = new Date().toISOString();
  let newBalance = 0;

  db.transaction(() => {
    const prod = db.get<{ id: number; name: string; sellable_stock: number; pospal_uid: string; sku: string }>(
      'SELECT id, name, sellable_stock, pospal_uid, sku FROM products WHERE id = ?',
      [params.productId],
    );
    if (!prod) {
      throw Object.assign(new Error('Product not found.'), { statusCode: 404 });
    }
    newBalance = prod.sellable_stock + params.delta;
    if (newBalance < 0) {
      throw Object.assign(new Error(`Adjustment would make ${prod.name} stock negative (${newBalance}).`), {
        statusCode: 400,
      });
    }

    db.run('UPDATE products SET sellable_stock = ?, updated_at = ? WHERE id = ?', [newBalance, now, prod.id]);

    db.run(
      `INSERT INTO inventory_ledger
       (product_id, delta, balance_after, reason, reference_type, reference_id, idempotency_key, actor_type, actor_id, note, created_at)
       VALUES (?, ?, ?, 'manual_adjustment', 'admin', ?, ?, ?, ?, ?, ?)`,
      [
        prod.id,
        params.delta,
        newBalance,
        String(params.adminUser.id),
        `ledger:${params.idempotencyKey}`,
        params.adminUser.role,
        String(params.adminUser.id),
        params.note || 'Manual audited stock adjustment',
        now,
      ],
    );

    db.run(
      `INSERT INTO pospal_outbox
       (event_type, product_id, delta, payload_json, idempotency_key, status, attempts, created_at, updated_at)
       VALUES ('stock_delta', ?, ?, ?, ?, 'Pending', 0, ?, ?)`,
      [
        prod.id,
        params.delta,
        JSON.stringify({ pospalUid: prod.pospal_uid, sku: prod.sku, delta: params.delta, note: params.note }),
        `outbox:${params.idempotencyKey}`,
        now,
        now,
      ],
    );

    writeAuditLog(db, {
      actorType: params.adminUser.role,
      actorId: params.adminUser.id,
      actorName: params.adminUser.displayName,
      action: 'MANUAL_STOCK_ADJUSTMENT',
      entityType: 'product',
      entityId: prod.id,
      details: { sku: prod.sku, delta: params.delta, newBalance, note: params.note },
    });
  });

  const flush = flushPospalOutbox(db);
  return {
    sellableStock: newBalance,
    outboxStatus: flush.failed > 0 ? 'Failed (Queued for retry)' : 'Confirmed',
  };
}

export function queuePospalCatalogueUpdate(
  db: DbClient,
  params: {
    productId: number;
    name: string;
    category: string;
    basePriceSen: number;
    adminUser: { id: number; displayName: string; role: 'owner' | 'staff' };
  },
): void {
  const now = new Date().toISOString();
  const prod = db.get<{ pospal_uid: string; sku: string }>('SELECT pospal_uid, sku FROM products WHERE id = ?', [
    params.productId,
  ]);
  if (!prod) return;

  const key = `pospal-cat-upd:${params.productId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  db.run(
    `INSERT INTO pospal_outbox
     (event_type, product_id, delta, payload_json, idempotency_key, status, attempts, created_at, updated_at)
     VALUES ('product_update', ?, 0, ?, ?, 'Pending', 0, ?, ?)`,
    [
      params.productId,
      JSON.stringify({
        pospalUid: prod.pospal_uid,
        sku: prod.sku,
        name: params.name,
        category: params.category,
        basePriceSen: params.basePriceSen,
      }),
      key,
      now,
      now,
    ],
  );

  writeAuditLog(db, {
    actorType: params.adminUser.role,
    actorId: params.adminUser.id,
    actorName: params.adminUser.displayName,
    action: 'CATALOGUE_SHARED_FIELD_UPDATE',
    entityType: 'product',
    entityId: params.productId,
    details: { name: params.name, category: params.category, basePriceSen: params.basePriceSen },
  });

  flushPospalOutbox(db);
}

/**
 * Flushes pending/failed POSPAL outbox items against the simulated POSPAL V3 API.
 * When pospal_outage_mode = 1, fails gracefully without dropping queue items.
 */
export function flushPospalOutbox(db: DbClient): { processed: number; confirmed: number; failed: number } {
  const config = getPospalConfig();
  if (config.mode === 'live') {
    // Live HTTP calls are async; trigger background flush and let caller await flushPospalOutboxLive if needed.
    void flushPospalOutboxLive(db);
    return { processed: 0, confirmed: 0, failed: 0 };
  }
  const settings = db.get<{ pospal_outage_mode: number }>(
    'SELECT pospal_outage_mode FROM store_settings WHERE id = 1',
  );
  const isOutage = settings?.pospal_outage_mode === 1;
  const jobs = db.all<{
    id: number;
    event_type: string;
    product_id: number;
    delta: number;
    payload_json: string;
    attempts: number;
  }>(`SELECT id, event_type, product_id, delta, payload_json, attempts FROM pospal_outbox WHERE status IN ('Pending', 'Failed') ORDER BY id ASC`);

  let confirmed = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (const job of jobs) {
    if (isOutage) {
      failed += 1;
      const retryAt = new Date(Date.now() + 60_000).toISOString();
      db.run(
        `UPDATE pospal_outbox SET status = 'Failed', attempts = ?, last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`,
        [job.attempts + 1, 'POSPAL_API_UNREACHABLE: Outage mode active (queued for safe retry)', retryAt, now, job.id],
      );
      const payload = JSON.parse(job.payload_json) as { sourceOrderCode?: string };
      if (payload.sourceOrderCode) {
        db.run(`UPDATE orders SET pos_sync_status = 'Failed', updated_at = ? WHERE order_code = ?`, [
          now,
          payload.sourceOrderCode,
        ]);
      }
      continue;
    }

    db.transaction(() => {
      const payload = JSON.parse(job.payload_json) as {
        pospalUid: string;
        name?: string;
        category?: string;
        basePriceSen?: number;
        sourceOrderCode?: string;
      };
      const mockProd = db.get<{
        pospal_uid: string;
        stock_on_hand: number;
        revision: number;
      }>('SELECT pospal_uid, stock_on_hand, revision FROM pospal_mock_products WHERE pospal_uid = ?', [
        payload.pospalUid,
      ]);

      if (!mockProd) {
        failed += 1;
        db.run(
          `UPDATE pospal_outbox SET status = 'Failed', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          [job.attempts + 1, `POSPAL product ${payload.pospalUid} missing in remote catalogue`, now, job.id],
        );
        return;
      }

      if (job.event_type === 'stock_delta') {
        const nextStock = Math.max(0, mockProd.stock_on_hand + job.delta);
        const nextRev = mockProd.revision + 1;
        db.run(
          'UPDATE pospal_mock_products SET stock_on_hand = ?, revision = ?, updated_at = ? WHERE pospal_uid = ?',
          [nextStock, nextRev, now, mockProd.pospal_uid],
        );
        db.run(
          'UPDATE products SET pospal_stock = ?, pospal_revision = ?, pospal_updated_at = ?, updated_at = ? WHERE id = ?',
          [nextStock, nextRev, now, now, job.product_id],
        );
      } else if (job.event_type === 'product_update') {
        const nextRev = mockProd.revision + 1;
        db.run(
          `UPDATE pospal_mock_products
           SET name = COALESCE(?, name), category = COALESCE(?, category), base_price_sen = COALESCE(?, base_price_sen),
               revision = ?, updated_at = ?
           WHERE pospal_uid = ?`,
          [payload.name ?? null, payload.category ?? null, payload.basePriceSen ?? null, nextRev, now, mockProd.pospal_uid],
        );
        db.run('UPDATE products SET pospal_revision = ?, pospal_updated_at = ?, updated_at = ? WHERE id = ?', [
          nextRev,
          now,
          now,
          job.product_id,
        ]);
      }

      db.run(`UPDATE pospal_outbox SET status = 'Confirmed', attempts = ?, last_error = '', updated_at = ? WHERE id = ?`, [
        job.attempts + 1,
        now,
        job.id,
      ]);
      recomputeSellableStock(db, job.product_id);

      if (payload.sourceOrderCode) {
        // Mark order POS sync confirmed if no other failed/pending outbox jobs remain for that order
        const remaining = db.get<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM pospal_outbox WHERE status IN ('Pending', 'Failed') AND payload_json LIKE ?`,
          [`%${payload.sourceOrderCode}%`],
        );
        if ((remaining?.cnt ?? 0) === 0) {
          db.run(`UPDATE orders SET pos_sync_status = 'Confirmed', updated_at = ? WHERE order_code = ?`, [
            now,
            payload.sourceOrderCode,
          ]);
        }
      }
      confirmed += 1;
    });
  }

  if (failed > 0) {
    adminEvents.emit({
      type: 'pospal_sync',
      title: 'POSPAL Sync Degraded',
      message: `${failed} POSPAL sync job(s) queued for retry due to outage.`,
      severity: 'warning',
      timestamp: now,
    });
  }

  return { processed: jobs.length, confirmed, failed };
}

/**
 * Processes an inbound POSPAL product.change callback or reconciliation refresh.
 * Applies POSPAL conflict authority on shared fields while preserving website-only images & descriptions,
 * suppressing echo loops, and keeping unsent local outbox deltas intact.
 */
export function applyInboundPospalChange(
  db: DbClient,
  event: {
    eventId: string;
    pospalUid: string;
    sku: string;
    name: string;
    category: string;
    basePriceSen: number;
    stockOnHand: number;
    revision: number;
    updatedAt: string;
  },
): { applied: boolean; reason: string; conflictDetected: boolean } {
  const existingWebhook = db.get<{ id: number }>(
    `SELECT id FROM processed_webhooks WHERE provider = 'pospal' AND event_id = ?`,
    [event.eventId],
  );
  if (existingWebhook) {
    return { applied: false, reason: 'duplicate_event_ignored', conflictDetected: false };
  }

  const now = new Date().toISOString();
  let conflictDetected = false;
  let resultReason = 'updated_from_pospal';

  db.transaction(() => {
    db.run(`INSERT INTO processed_webhooks (provider, event_id, processed_at) VALUES ('pospal', ?, ?)`, [
      event.eventId,
      now,
    ]);

    const local = db.get<{
      id: number;
      name: string;
      category: string;
      base_price_sen: number;
      pospal_stock: number;
      sellable_stock: number;
      pospal_revision: number;
    }>(
      'SELECT id, name, category, base_price_sen, pospal_stock, sellable_stock, pospal_revision FROM products WHERE pospal_uid = ?',
      [event.pospalUid],
    );

    if (!local) {
      // New product imported from POSPAL
      const res = db.run(
        `INSERT INTO products
         (pospal_uid, sku, name, category, base_price_sen, pospal_stock, sellable_stock, pospal_revision, pospal_updated_at, seo_slug, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.pospalUid,
          event.sku,
          event.name,
          event.category,
          event.basePriceSen,
          event.stockOnHand,
          event.stockOnHand,
          event.revision,
          event.updatedAt,
          event.sku.toLowerCase(),
          now,
        ],
      );
      writeAuditLog(db, {
        actorType: 'pospal',
        actorId: event.pospalUid,
        actorName: 'POSPAL OpenAPI V3',
        action: 'POSPAL_PRODUCT_IMPORTED',
        entityType: 'product',
        entityId: res.lastInsertRowid,
        details: { sku: event.sku, name: event.name, stockOnHand: event.stockOnHand },
      });
      resultReason = 'imported_new_product';
      return;
    }

    // Echo loop suppression: if incoming revision <= local revision AND all values already match
    if (
      event.revision <= local.pospal_revision &&
      event.name === local.name &&
      event.category === local.category &&
      event.basePriceSen === local.base_price_sen &&
      event.stockOnHand === local.pospal_stock
    ) {
      resultReason = 'echo_loop_suppressed';
      return;
    }

    // Check if there are unsent/failed website outbox updates for this product (concurrent conflict!)
    const unsentOutbox = db.all<{ id: number; event_type: string; delta: number }>(
      `SELECT id, event_type, delta FROM pospal_outbox WHERE product_id = ? AND status IN ('Pending', 'Failed')`,
      [local.id],
    );
    if (unsentOutbox.length > 0) {
      conflictDetected = true;
      // Supersede unsent product_update jobs since POSPAL wins on conflict for shared metadata;
      // keep unsent stock_delta jobs so real order deductions are NOT lost!
      for (const job of unsentOutbox) {
        if (job.event_type === 'product_update') {
          db.run(
            `UPDATE pospal_outbox SET status = 'Conflict', last_error = 'Superseded by POSPAL authority during conflict resolution', updated_at = ? WHERE id = ?`,
            [now, job.id],
          );
        }
      }
    }

    // Apply POSPAL authoritative shared fields ONLY — NEVER touch image_url or extended_desc_*!
    db.run(
      `UPDATE products
       SET sku = ?, name = ?, category = ?, base_price_sen = ?, pospal_stock = ?, pospal_revision = ?, pospal_updated_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        event.sku,
        event.name,
        event.category,
        event.basePriceSen,
        event.stockOnHand,
        event.revision,
        event.updatedAt,
        now,
        local.id,
      ],
    );

    const newSellable = recomputeSellableStock(db, local.id);

    if (event.stockOnHand !== local.pospal_stock) {
      db.run(
        `INSERT OR IGNORE INTO inventory_ledger
         (product_id, delta, balance_after, reason, reference_type, reference_id, idempotency_key, actor_type, actor_id, note, created_at)
         VALUES (?, ?, ?, 'pospal_sync_in', 'pospal_event', ?, ?, 'pospal', ?, ?, ?)`,
        [
          local.id,
          event.stockOnHand - local.pospal_stock,
          newSellable,
          event.eventId,
          `pospal-in:${event.eventId}`,
          event.pospalUid,
          `POSPAL product.change revision ${event.revision}${conflictDetected ? ' (conflict resolved: POSPAL authority)' : ''}`,
          now,
        ],
      );
    }

    writeAuditLog(db, {
      actorType: 'pospal',
      actorId: event.pospalUid,
      actorName: 'POSPAL OpenAPI V3',
      action: conflictDetected ? 'POSPAL_CONFLICT_RESOLVED' : 'POSPAL_PRODUCT_CHANGE_APPLIED',
      entityType: 'product',
      entityId: local.id,
      details: {
        sku: event.sku,
        pospalStock: event.stockOnHand,
        recomputedSellableStock: newSellable,
        revision: event.revision,
        preservedWebsiteFields: ['image_url', 'extended_desc_en', 'extended_desc_zh', 'extended_desc_ms'],
      },
    });
  });

  if (conflictDetected) {
    adminEvents.emit({
      type: 'pospal_sync',
      title: 'POSPAL Conflict Resolved',
      message: `Concurrent change on ${event.sku} resolved using POSPAL authority while keeping website media & pending stock deltas.`,
      severity: 'warning',
      timestamp: now,
    });
  }

  return { applied: resultReason !== 'echo_loop_suppressed', reason: resultReason, conflictDetected };
}

export function reconcileWithPospal(db: DbClient): {
  outboxFlushed: { processed: number; confirmed: number; failed: number };
  productsReconciled: number;
  conflictsResolved: number;
} {
  const settings = db.get<{ pospal_outage_mode: number }>(
    'SELECT pospal_outage_mode FROM store_settings WHERE id = 1',
  );
  if (settings?.pospal_outage_mode === 1) {
    throw Object.assign(new Error('Cannot complete POSPAL reconciliation while POSPAL outage mode is active.'), {
      statusCode: 503,
    });
  }

  const outboxFlushed = flushPospalOutbox(db);
  const remoteProducts = db.all<{
    pospal_uid: string;
    sku: string;
    name: string;
    category: string;
    base_price_sen: number;
    stock_on_hand: number;
    revision: number;
    updated_at: string;
  }>('SELECT pospal_uid, sku, name, category, base_price_sen, stock_on_hand, revision, updated_at FROM pospal_mock_products');

  let conflictsResolved = 0;
  for (const rp of remoteProducts) {
    const res = applyInboundPospalChange(db, {
      eventId: `reconcile-${rp.pospal_uid}-r${rp.revision}-${Date.now()}`,
      pospalUid: rp.pospal_uid,
      sku: rp.sku,
      name: rp.name,
      category: rp.category,
      basePriceSen: rp.base_price_sen,
      stockOnHand: rp.stock_on_hand,
      revision: rp.revision,
      updatedAt: rp.updated_at,
    });
    if (res.conflictDetected) conflictsResolved += 1;
  }

  return {
    outboxFlushed,
    productsReconciled: remoteProducts.length,
    conflictsResolved,
  };
}

/**
 * Live async outbox flush against POSPAL OpenAPI V3 (`https://platform.pospal.cn`).
 * Uses each outbox job's idempotency_key as `X-Request-Id` so retries never duplicate adjustments.
 */
export async function flushPospalOutboxLive(
  db: DbClient,
): Promise<{ processed: number; confirmed: number; failed: number; lastError?: string }> {
  const config = getPospalConfig();
  if (config.mode !== 'live') {
    return flushPospalOutbox(db);
  }

  const settings = db.get<{ pospal_outage_mode: number }>(
    'SELECT pospal_outage_mode FROM store_settings WHERE id = 1',
  );
  const isOutage = settings?.pospal_outage_mode === 1;
  const jobs = db.all<{
    id: number;
    event_type: string;
    product_id: number;
    delta: number;
    payload_json: string;
    idempotency_key: string;
    attempts: number;
  }>(
    `SELECT id, event_type, product_id, delta, payload_json, idempotency_key, attempts
     FROM pospal_outbox WHERE status IN ('Pending', 'Failed') ORDER BY id ASC`,
  );

  let confirmed = 0;
  let failed = 0;
  let lastError: string | undefined;
  const now = new Date().toISOString();

  if (isOutage) {
    for (const job of jobs) {
      failed += 1;
      lastError = 'POSPAL_API_UNREACHABLE: Simulated outage mode active';
      db.run(
        `UPDATE pospal_outbox SET status = 'Failed', attempts = ?, last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`,
        [job.attempts + 1, lastError, new Date(Date.now() + 60_000).toISOString(), now, job.id],
      );
    }
    return { processed: jobs.length, confirmed, failed, lastError };
  }

  // Batch up to 100 unique barcodes per stock-batch-adjust call to save POSPAL API Tokens
  const stockJobs = jobs.filter((j) => j.event_type === 'stock_delta');
  const otherJobs = jobs.filter((j) => j.event_type !== 'stock_delta');

  const markOrderSyncStatus = (orderCode?: string) => {
    if (!orderCode) return;
    const remaining = db.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM pospal_outbox WHERE status IN ('Pending', 'Failed') AND payload_json LIKE ?`,
      [`%${orderCode}%`],
    );
    db.run(`UPDATE orders SET pos_sync_status = ?, updated_at = ? WHERE order_code = ?`, [
      (remaining?.cnt ?? 0) === 0 ? 'Confirmed' : 'Failed',
      now,
      orderCode,
    ]);
  };

  // Group stock_delta jobs by SKU/barcode (POSPAL forbids duplicate barcodes in one batch request)
  const groupedByBarcode = new Map<
    string,
    { productId: number; totalDelta: number; jobs: typeof stockJobs; orderCodes: Set<string> }
  >();
  for (const job of stockJobs) {
    const payload = JSON.parse(job.payload_json) as { sku: string; sourceOrderCode?: string };
    const existing = groupedByBarcode.get(payload.sku) || {
      productId: job.product_id,
      totalDelta: 0,
      jobs: [],
      orderCodes: new Set<string>(),
    };
    existing.totalDelta += job.delta;
    existing.jobs.push(job);
    if (payload.sourceOrderCode) existing.orderCodes.add(payload.sourceOrderCode);
    groupedByBarcode.set(payload.sku, existing);
  }

  const barcodeEntries = Array.from(groupedByBarcode.entries());
  for (let i = 0; i < barcodeEntries.length; i += 100) {
    const chunk = barcodeEntries.slice(i, i + 100);
    const batchItems = chunk.map(([barcode, grp]) => ({ barcode, changeStock: grp.totalDelta }));
    const batchReqId =
      chunk.length === 1 && chunk[0][1].jobs.length === 1
        ? chunk[0][1].jobs[0].idempotency_key
        : crypto
            .createHash('sha256')
            .update(chunk.flatMap(([, g]) => g.jobs.map((j) => j.idempotency_key)).join('|'))
            .digest('hex');

    try {
      const batchRes = await pushPospalV3StockBatchAdjust(batchItems, batchReqId, config);
      const resultByBarcode = new Map((batchRes.results || []).map((r) => [r.barcode, r]));

      db.transaction(() => {
        for (const [barcode, grp] of chunk) {
          const itemRes = resultByBarcode.get(barcode);
          if (itemRes?.success) {
            if (typeof itemRes.stock === 'number') {
              db.run('UPDATE products SET pospal_stock = ?, pospal_updated_at = ?, updated_at = ? WHERE id = ?', [
                Math.round(itemRes.stock),
                now,
                now,
                grp.productId,
              ]);
            }
            for (const j of grp.jobs) {
              db.run(
                `UPDATE pospal_outbox SET status = 'Confirmed', attempts = ?, last_error = '', updated_at = ? WHERE id = ?`,
                [j.attempts + 1, now, j.id],
              );
              confirmed += 1;
            }
            recomputeSellableStock(db, grp.productId);
          } else {
            const msg = itemRes?.message || 'POSPAL rejected stock adjustment';
            lastError = msg;
            for (const j of grp.jobs) {
              db.run(
                `UPDATE pospal_outbox SET status = 'Failed', attempts = ?, last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`,
                [j.attempts + 1, msg, new Date(Date.now() + 60_000).toISOString(), now, j.id],
              );
              failed += 1;
            }
          }
          for (const oc of grp.orderCodes) markOrderSyncStatus(oc);
        }
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'POSPAL V3 batch stock request failed';
      for (const [, grp] of chunk) {
        for (const j of grp.jobs) {
          db.run(
            `UPDATE pospal_outbox SET status = 'Failed', attempts = ?, last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`,
            [j.attempts + 1, lastError, new Date(Date.now() + 60_000).toISOString(), now, j.id],
          );
          failed += 1;
        }
        for (const oc of grp.orderCodes) markOrderSyncStatus(oc);
      }
    }
  }

  for (const job of otherJobs) {
    const payload = JSON.parse(job.payload_json) as {
      sku: string;
      name?: string;
      basePriceSen?: number;
      sourceOrderCode?: string;
    };
    try {
      await pushPospalV3ProductUpdate(
        {
          barcode: payload.sku,
          name: payload.name,
          sellPriceYuan: typeof payload.basePriceSen === 'number' ? payload.basePriceSen / 100 : undefined,
        },
        job.idempotency_key,
        config,
      );
      db.run(`UPDATE pospal_outbox SET status = 'Confirmed', attempts = ?, last_error = '', updated_at = ? WHERE id = ?`, [
        job.attempts + 1,
        now,
        job.id,
      ]);
      confirmed += 1;
    } catch (err) {
      failed += 1;
      lastError = err instanceof Error ? err.message : 'POSPAL V3 request failed';
      db.run(
        `UPDATE pospal_outbox SET status = 'Failed', attempts = ?, last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`,
        [job.attempts + 1, lastError, new Date(Date.now() + 60_000).toISOString(), now, job.id],
      );
    }
    markOrderSyncStatus(payload.sourceOrderCode);
  }

  if (failed > 0) {
    adminEvents.emit({
      type: 'pospal_sync',
      title: 'POSPAL Live Sync Attention Needed',
      message: `${failed} outbox job(s) failed: ${lastError}`,
      severity: 'warning',
      timestamp: now,
    });
  }

  return { processed: jobs.length, confirmed, failed, lastError };
}

/**
 * Token-efficient reconciliation in live mode:
 * 1) Flushes batched outbound stock adjustments,
 * 2) Pulls lightweight `/openapi/v3/product/stock-page` (500 Tokens per 1,000 items) to reconcile inventory.
 */
export async function reconcileWithLivePospalStockOnly(db: DbClient): Promise<{
  outboxFlushed: { processed: number; confirmed: number; failed: number; lastError?: string };
  productsReconciled: number;
  conflictsResolved: number;
}> {
  const settings = db.get<{ pospal_outage_mode: number }>(
    'SELECT pospal_outage_mode FROM store_settings WHERE id = 1',
  );
  if (settings?.pospal_outage_mode === 1) {
    throw Object.assign(new Error('Cannot complete POSPAL reconciliation while POSPAL outage mode is active.'), {
      statusCode: 503,
    });
  }

  const outboxFlushed = await flushPospalOutboxLive(db);
  const stockList = await fetchAllPospalV3Stock();
  const now = new Date().toISOString();
  let updatedCount = 0;

  db.transaction(() => {
    for (const row of stockList) {
      if (!row.barcode) continue;
      const local = db.get<{ id: number; pospal_stock: number }>(
        'SELECT id, pospal_stock FROM products WHERE sku = ?',
        [row.barcode],
      );
      if (!local) continue;
      const remoteStock = Math.max(0, Math.round(Number(row.stock || 0)));
      if (remoteStock !== local.pospal_stock) {
        db.run('UPDATE products SET pospal_stock = ?, pospal_updated_at = ?, updated_at = ? WHERE id = ?', [
          remoteStock,
          now,
          now,
          local.id,
        ]);
        const newSellable = recomputeSellableStock(db, local.id);
        db.run(
          `INSERT OR IGNORE INTO inventory_ledger
           (product_id, delta, balance_after, reason, reference_type, reference_id, idempotency_key, actor_type, actor_id, note, created_at)
           VALUES (?, ?, ?, 'reconciliation_correction', 'pospal_stock_page', ?, ?, 'pospal', 'stock-page', ?, ?)`,
          [
            local.id,
            remoteStock - local.pospal_stock,
            newSellable,
            row.barcode,
            `stock-reconcile:${local.id}:${now}`,
            'Live stock-page reconciliation',
            now,
          ],
        );
        updatedCount += 1;
      }
    }
  });

  return {
    outboxFlushed,
    productsReconciled: stockList.length,
    conflictsResolved: updatedCount,
  };
}

export async function pullLivePospalCatalogue(db: DbClient): Promise<{
  fetched: number;
  importedOrUpdated: number;
  activeCount: number;
  conflictsResolved: number;
}> {
  const config = getPospalConfig();
  const list = await fetchAllPospalV3Products(config);
  let importedOrUpdated = 0;
  let activeCount = 0;
  let conflictsResolved = 0;

  db.transaction(() => {
    for (const item of list) {
      if (item.enable === -1) continue;
      const sku = item.barcode || `PP-${item.uid}`;
      const pospalUid = String(item.uid);
      const basePriceSen = Math.round(Number(item.sellPrice || 0) * 100);
      const stockOnHand = Math.max(0, Math.round(Number(item.stock || 0)));
      const category = item.category?.name || 'General';
      const updatedAt = item.sysUpdateTime || new Date().toISOString();
      const isActive = item.enable === 1 ? 1 : 0;
      if (isActive === 1) activeCount += 1;

      const existing = db.get<{ pospal_revision: number; image_url: string }>(
        'SELECT pospal_revision, image_url FROM products WHERE pospal_uid = ?',
        [pospalUid],
      );
      const nextRev = (existing?.pospal_revision ?? 0) + 1;

      db.run(
        `INSERT INTO pospal_mock_products (pospal_uid, sku, name, category, base_price_sen, stock_on_hand, revision, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(pospal_uid) DO UPDATE SET
           sku = excluded.sku,
           name = excluded.name,
           category = excluded.category,
           base_price_sen = excluded.base_price_sen,
           stock_on_hand = excluded.stock_on_hand,
           revision = excluded.revision,
           updated_at = excluded.updated_at`,
        [pospalUid, sku, item.name, category, basePriceSen, stockOnHand, nextRev, updatedAt],
      );

      const applied = applyInboundPospalChange(db, {
        eventId: `live-pull:${pospalUid}:${updatedAt}:${Date.now()}`,
        pospalUid,
        sku,
        name: item.name,
        category,
        basePriceSen,
        stockOnHand,
        revision: nextRev,
        updatedAt,
      });
      if (applied.applied) importedOrUpdated += 1;
      if (applied.conflictDetected) conflictsResolved += 1;

      db.run('UPDATE products SET is_active = ? WHERE pospal_uid = ?', [isActive, pospalUid]);

      // Only populate initial website media/unit/short-desc if website has not enriched them yet (FR-032)
      const coverImg = item.images?.find((img) => img.isCover === 1)?.path || item.images?.[0]?.path || '';
      if (coverImg) {
        db.run(`UPDATE products SET image_url = ? WHERE pospal_uid = ? AND image_url = ''`, [coverImg, pospalUid]);
      }
      if (item.mainUnit?.name) {
        db.run(`UPDATE products SET unit_label = ? WHERE pospal_uid = ? AND unit_label = '1 pack'`, [
          item.mainUnit.name,
          pospalUid,
        ]);
      }
      if (!existing && item.description) {
        db.run(`UPDATE products SET short_desc_en = ? WHERE pospal_uid = ? AND short_desc_en = ''`, [
          item.description,
          pospalUid,
        ]);
      }
    }
  });

  return { fetched: list.length, importedOrUpdated, activeCount, conflictsResolved };
}
