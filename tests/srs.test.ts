import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { createDbClient, DbClient } from '../server/db/database';
import {
  LALAMOVE_WEBHOOK_SECRET,
  PAYMENT_WEBHOOK_SECRET,
  POSPAL_WEBHOOK_SECRET,
  signHmac,
} from '../server/services/auth';
import { bookLalamoveForOrder } from '../server/services/lalamove';
import { signPospalV3Callback, signPospalV3Request } from '../server/services/pospalClient';

describe('KamKim Fresh Mart SRS v1.3 End-to-End Acceptance Tests', () => {
  let db: DbClient;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = await createDbClient(':memory:');
    app = createApp(db, { serveStatic: false });
  });

  async function loginAdmin(username: string, password: string): Promise<string[]> {
    const res = await request(app).post('/api/admin/auth/login').send({ username, password });
    expect(res.status).toBe(200);
    return res.headers['set-cookie'] as unknown as string[];
  }

  it('AT-15 / Admin Password Protection: requires password login and enforces Owner vs Staff RBAC', async () => {
    const unauth = await request(app).get('/api/admin/orders');
    expect(unauth.status).toBe(401);

    const badPass = await request(app).post('/api/admin/auth/login').send({ username: 'owner', password: 'wrong' });
    expect(badPass.status).toBe(401);

    const staffCookies = await loginAdmin('staff', 'kk1314');
    const staffOrders = await request(app).get('/api/admin/orders').set('Cookie', staffCookies);
    expect(staffOrders.status).toBe(200);

    // Staff blocked from Owner-only staff management & settings
    const staffManageBlocked = await request(app).get('/api/admin/staff').set('Cookie', staffCookies);
    expect(staffManageBlocked.status).toBe(403);

    const settingsBlocked = await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', staffCookies)
      .send({ pospalOutageMode: true });
    expect(settingsBlocked.status).toBe(403);

    const ownerCookies = await loginAdmin('owner', 'kamkim1314');
    const ownerStaff = await request(app).get('/api/admin/staff').set('Cookie', ownerCookies);
    expect(ownerStaff.status).toBe(200);
  });

  it('AT-02, AT-07, AT-14, AT-17: guest delivery checkout, signed webhook idempotency, stock deduction, and blocked cancellation', async () => {
    const quoteRes = await request(app)
      .post('/api/delivery/quote')
      .send({ address: '12 Jalan SL 1/4', postcode: '43000' });
    expect(quoteRes.status).toBe(200);
    expect(quoteRes.body.quote.feeSen).toBe(900);

    const orderRes = await request(app)
      .post('/api/orders')
      .send({
        customerName: 'Lim Siew Lan',
        customerPhone: '+60123456789',
        customerEmail: 'lim@example.com',
        lang: 'zh-CN',
        fulfilmentType: 'delivery',
        slotId: 'immediate',
        deliveryAddress: '12 Jalan SL 1/4',
        deliveryPostcode: '43000',
        paymentMethod: 'fpx',
        policyAccepted: true,
        items: [{ productId: 1, quantity: 2 }],
      });
    expect(orderRes.status).toBe(201);
    const { orderCode, guestAccessToken, gatewayRef, amountSen } = orderRes.body;

    // Guest access token required
    const denied = await request(app).get(`/api/orders/${orderCode}`);
    expect(denied.status).toBe(403);

    const allowed = await request(app).get(`/api/orders/${orderCode}?token=${guestAccessToken}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.order.order_status).toBe('Placed');

    // Invalid webhook signature rejected (AT-17)
    const webhookBody = JSON.stringify({
      eventId: 'evt-pay-1',
      gatewayRef,
      orderCode,
      status: 'Paid',
      amountSen,
    });
    const badSig = await request(app)
      .post('/api/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('x-gateway-signature', 'bad')
      .send(webhookBody);
    expect(badSig.status).toBe(401);

    // Valid signed webhook settles once and deducts stock once
    const sig = signHmac(PAYMENT_WEBHOOK_SECRET, webhookBody);
    const okHook = await request(app)
      .post('/api/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('x-gateway-signature', sig)
      .send(webhookBody);
    expect(okHook.status).toBe(200);
    expect(okHook.body.duplicate).toBe(false);

    // Replay same webhook does not duplicate stock deduction
    const replayHook = await request(app)
      .post('/api/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('x-gateway-signature', sig)
      .send(webhookBody);
    expect(replayHook.status).toBe(200);
    expect(replayHook.body.duplicate).toBe(true);

    const prodAfter = db.get<{ sellable_stock: number }>('SELECT sellable_stock FROM products WHERE id = 1');
    expect(prodAfter?.sellable_stock).toBe(40); // 42 - 2 = 40

    // Cancellation endpoints and status transitions blocked (AT-14)
    const cancelRes = await request(app).post(`/api/orders/${orderCode}/cancel`).send({});
    expect(cancelRes.status).toBe(404);

    const ownerCookies = await loginAdmin('owner', 'kamkim1314');
    const adminCancelRes = await request(app)
      .post(`/api/admin/orders/${orderRes.body.orderId}/status`)
      .set('Cookie', ownerCookies)
      .send({ status: 'Cancelled' });
    expect(adminCancelRes.status).toBe(403);
  });

  it('AT-08 & AT-09: Pay at Store only for self-pickup, stays Unpaid until collection; zero-stock rejected', async () => {
    // Pay at Store rejected for delivery
    const badPayAtStore = await request(app)
      .post('/api/orders')
      .send({
        customerName: 'Ali',
        customerPhone: '+60120001111',
        customerEmail: 'ali@example.com',
        fulfilmentType: 'delivery',
        slotId: 'immediate',
        deliveryAddress: '1 Jalan SL',
        deliveryPostcode: '43000',
        paymentMethod: 'pay_at_store',
        policyAccepted: true,
        items: [{ productId: 1, quantity: 1 }],
      });
    expect(badPayAtStore.status).toBe(400);

    // Zero-stock item rejected (product 11 has 0 stock)
    const zeroStock = await request(app)
      .post('/api/orders')
      .send({
        customerName: 'Ali',
        customerPhone: '+60120001111',
        customerEmail: 'ali@example.com',
        fulfilmentType: 'pickup',
        slotId: 'immediate',
        paymentMethod: 'pay_at_store',
        policyAccepted: true,
        items: [{ productId: 11, quantity: 1 }],
      });
    expect(zeroStock.status).toBe(409);

    // Valid Pay at Store pickup enters Preparing & Unpaid
    const pickupRes = await request(app)
      .post('/api/orders')
      .send({
        customerName: 'Ali',
        customerPhone: '+60120001111',
        customerEmail: 'ali@example.com',
        fulfilmentType: 'pickup',
        slotId: 'immediate',
        paymentMethod: 'pay_at_store',
        policyAccepted: true,
        items: [{ productId: 2, quantity: 3 }],
      });
    expect(pickupRes.status).toBe(201);

    const detail = await request(app).get(
      `/api/orders/${pickupRes.body.orderCode}?token=${pickupRes.body.guestAccessToken}`,
    );
    expect(detail.body.order.order_status).toBe('Preparing');
    expect(detail.body.order.payment_status).toBe('Unpaid');

    const staffCookies = await loginAdmin('staff', 'kk1314');
    // Cannot mark Completed before recording Pay at Store payment
    const blockComplete = await request(app)
      .post(`/api/admin/orders/${pickupRes.body.orderId}/status`)
      .set('Cookie', staffCookies)
      .send({ status: 'Completed' });
    expect(blockComplete.status).toBe(400);

    const collectRes = await request(app)
      .post(`/api/admin/orders/${pickupRes.body.orderId}/collect-pay-at-store`)
      .set('Cookie', staffCookies);
    expect(collectRes.status).toBe(200);
    expect(collectRes.body.paymentStatus).toBe('Paid');
  });

  it('AT-03, AT-05, AT-06: POSPAL inbound change preserves website media, outage queues retries, conflict preserves order deltas', async () => {
    const ownerCookies = await loginAdmin('owner', 'kamkim1314');
    const beforeProd = db.get<{ image_url: string; extended_desc_en: string }>(
      'SELECT image_url, extended_desc_en FROM products WHERE id = 1',
    )!;

    // Enable POSPAL outage mode
    await request(app).patch('/api/admin/settings').set('Cookie', ownerCookies).send({ pospalOutageMode: true });

    // Place Pay-at-Store pickup order during outage -> accepted, local stock drops, outbox Failed/Queued
    const orderRes = await request(app)
      .post('/api/orders')
      .send({
        customerName: 'Outage Tester',
        customerPhone: '+60121112222',
        customerEmail: 'outage@example.com',
        fulfilmentType: 'pickup',
        slotId: 'immediate',
        paymentMethod: 'pay_at_store',
        policyAccepted: true,
        items: [{ productId: 1, quantity: 4 }],
      });
    expect(orderRes.status).toBe(201);
    const localAfterOrder = db.get<{ sellable_stock: number }>('SELECT sellable_stock FROM products WHERE id = 1')!;
    expect(localAfterOrder.sellable_stock).toBe(38);

    // Inbound POSPAL product.change while unsent outbox exists -> conflict resolved with POSPAL price/name/stock + unsent delta preserved + website media untouched!
    const inboundPayload = JSON.stringify({
      eventId: 'pp-evt-conflict-1',
      pospalUid: 'PP-1001',
      sku: 'KK-VEG-001',
      name: 'Cameron Organic Spinach POSPAL v2',
      category: 'Fresh Produce',
      basePriceSen: 520,
      stockOnHand: 50,
      revision: 3,
      updatedAt: new Date().toISOString(),
    });
    const ppSig = signHmac(POSPAL_WEBHOOK_SECRET, inboundPayload);
    const ppRes = await request(app)
      .post('/api/webhooks/pospal')
      .set('Content-Type', 'application/json')
      .set('x-pospal-signature', ppSig)
      .send(inboundPayload);
    expect(ppRes.status).toBe(200);
    expect(ppRes.body.conflictDetected).toBe(true);

    const updatedProd = db.get<{
      name: string;
      base_price_sen: number;
      pospal_stock: number;
      sellable_stock: number;
      image_url: string;
      extended_desc_en: string;
    }>('SELECT * FROM products WHERE id = 1')!;
    expect(updatedProd.name).toBe('Cameron Organic Spinach POSPAL v2');
    expect(updatedProd.base_price_sen).toBe(520);
    expect(updatedProd.pospal_stock).toBe(50);
    expect(updatedProd.sellable_stock).toBe(46); // 50 + (-4 unsent order delta)
    expect(updatedProd.image_url).toBe(beforeProd.image_url);
    expect(updatedProd.extended_desc_en).toBe(beforeProd.extended_desc_en);

    // Recover from outage and flush outbox
    await request(app).patch('/api/admin/settings').set('Cookie', ownerCookies).send({ pospalOutageMode: false });
    const flushRes = await request(app).post('/api/admin/pospal/flush').set('Cookie', ownerCookies);
    expect(flushRes.status).toBe(200);
    expect(flushRes.body.confirmed).toBeGreaterThanOrEqual(1);
    const finalProd = db.get<{ pospal_stock: number; sellable_stock: number }>('SELECT pospal_stock, sellable_stock FROM products WHERE id = 1')!;
    expect(finalProd.sellable_stock).toBe(finalProd.pospal_stock);
  });

  it('AT-10, AT-11, AT-12, AT-18: Scheduled slot wait, expired quote top-up gate, idempotent booking, and coordinate fallback', async () => {
    const ownerCookies = await loginAdmin('owner', 'kamkim1314');
    const infoRes = await request(app).get('/api/store/info');
    // Pick the farthest future slot (tomorrow)
    const futureSlot = infoRes.body.availableSlots[infoRes.body.availableSlots.length - 1];

    const orderRes = await request(app)
      .post('/api/orders')
      .send({
        customerName: 'Scheduled Buyer',
        customerPhone: '+60198887777',
        customerEmail: 'sched@example.com',
        fulfilmentType: 'delivery',
        slotId: futureSlot.slotId,
        deliveryAddress: '88 Jalan SL 9/1',
        deliveryPostcode: '43000',
        paymentMethod: 'card',
        policyAccepted: true,
        items: [{ productId: 4, quantity: 1 }],
      });
    expect(orderRes.status).toBe(201);
    const { orderId, orderCode, guestAccessToken, gatewayRef } = orderRes.body;

    // Settle initial payment
    await request(app)
      .post('/api/sandbox/gateway/complete')
      .send({ gatewayRef, orderCode, outcome: 'Paid', channel: 'card' });

    // Mark Ready early -> must wait in Waiting for Slot (AT-10)
    const readyRes = await request(app)
      .post(`/api/admin/orders/${orderId}/status`)
      .set('Cookie', ownerCookies)
      .send({ status: 'Ready' });
    expect(readyRes.body.lalamoveResult.status).toBe('Waiting for Slot');

    // Simulate time reaching eligible window AND Lalamove rate surge -> blocked in Top-up Required (AT-11)
    const slotStartMs = new Date(futureSlot.startIso).getTime();
    const topupGate = bookLalamoveForOrder(
      db,
      orderId,
      { type: 'owner', id: 1, name: 'Owner' },
      { now: new Date(slotStartMs - 10 * 60 * 1000), forceFreshQuoteIncrease: true },
    );
    expect(topupGate.status).toBe('Top-up Required');
    expect(topupGate.topupRequiredSen).toBe(600);

    // Customer initiates & completes top-up payment
    const topupInit = await request(app)
      .post(`/api/orders/${orderCode}/topup/initiate`)
      .send({ token: guestAccessToken, method: 'fpx' });
    expect(topupInit.status).toBe(200);
    const topupPayRes = await request(app)
      .post('/api/sandbox/gateway/complete')
      .send({ gatewayRef: topupInit.body.gatewayRef, orderCode, outcome: 'Paid', channel: 'fpx' });
    expect(topupPayRes.status).toBe(200);

    // Hide coordinates to test AT-18 fallback, then book once + test idempotent repeat (AT-12)
    await request(app).patch('/api/admin/settings').set('Cookie', ownerCookies).send({ lalamoveHideCoordinates: true });
    const booked1 = bookLalamoveForOrder(
      db,
      orderId,
      { type: 'owner', id: 1, name: 'Owner' },
      { now: new Date(slotStartMs - 5 * 60 * 1000) },
    );
    expect(booked1.status).toBe('Driver Assigned');
    const booked2 = bookLalamoveForOrder(
      db,
      orderId,
      { type: 'owner', id: 1, name: 'Owner' },
      { now: new Date(slotStartMs - 5 * 60 * 1000) },
    );
    expect(booked2.lalamoveOrderId).toBe(booked1.lalamoveOrderId);

    // Verify Lalamove webhook updates Delivered
    const llmHook = JSON.stringify({
      eventId: 'llm-evt-1',
      lalamoveOrderId: booked1.lalamoveOrderId,
      status: 'Delivered',
    });
    const llmSig = signHmac(LALAMOVE_WEBHOOK_SECRET, llmHook);
    const llmRes = await request(app)
      .post('/api/webhooks/lalamove')
      .set('Content-Type', 'application/json')
      .set('x-lalamove-signature', llmSig)
      .send(llmHook);
    expect(llmRes.status).toBe(200);

    const tracked = await request(app).get(`/api/orders/${orderCode}?token=${guestAccessToken}`);
    expect(tracked.body.order.order_status).toBe('Completed');
    expect(tracked.body.delivery.driver_lat).toBeNull();
    expect(tracked.body.delivery.tracking_url).toContain('lalamove.com');
  });

  it('AT-13 & AT-16: Merchant item-level gateway refund succeeds without auto-restock; Staff blocked unless authorised; failure stays Failed; net report updates', async () => {
    const staffCookies = await loginAdmin('staff', 'kk1314');
    const ownerCookies = await loginAdmin('owner', 'kamkim1314');

    const orderRes = await request(app)
      .post('/api/orders')
      .send({
        customerName: 'Refund Case',
        customerPhone: '+60134445555',
        customerEmail: 'refund@example.com',
        fulfilmentType: 'pickup',
        slotId: 'immediate',
        paymentMethod: 'tng',
        policyAccepted: true,
        items: [
          { productId: 5, quantity: 2 }, // Eggs RM7.80 x 2 = RM15.60
          { productId: 4, quantity: 1 }, // Milk RM8.90 x 1
        ],
      });
    const { orderId, orderCode, gatewayRef } = orderRes.body;
    await request(app)
      .post('/api/sandbox/gateway/complete')
      .send({ gatewayRef, orderCode, outcome: 'Paid', channel: 'tng' });

    const stockBeforeFlag = db.get<{ sellable_stock: number }>('SELECT sellable_stock FROM products WHERE id = 5')!.sellable_stock;
    const itemRow = db.get<{ id: number }>('SELECT id FROM order_items WHERE order_id = ? AND product_id = 5', [orderId])!;

    // Staff flags item unavailable (allowed)
    const flagRes = await request(app)
      .post(`/api/admin/orders/${orderId}/flag-unavailable`)
      .set('Cookie', staffCookies)
      .send({ orderItemIds: [itemRow.id], reason: 'Damaged carton' });
    expect(flagRes.status).toBe(200);

    // Unauthorised staff cannot trigger gateway refund (403)
    const staffRefundBlocked = await request(app)
      .post(`/api/admin/orders/${orderId}/refund`)
      .set('Cookie', staffCookies)
      .send({ items: [{ orderItemId: itemRow.id, quantity: 1 }], reason: 'Unavailable' });
    expect(staffRefundBlocked.status).toBe(403);

    // Simulate gateway refund failure -> remains Failed, item refunded_qty remains 0
    await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', ownerCookies)
      .send({ gatewayForceRefundFailure: true });
    const failRefund = await request(app)
      .post(`/api/admin/orders/${orderId}/refund`)
      .set('Cookie', ownerCookies)
      .send({
        items: [{ orderItemId: itemRow.id, quantity: 1 }],
        reason: '1 damaged egg tray',
        idempotencyKey: 'rf-fail-1',
      });
    expect(failRefund.status).toBe(200);
    expect(failRefund.body.status).toBe('Failed');

    // Recover gateway and execute partial refund for 1 unit (780 sen)
    await request(app)
      .patch('/api/admin/settings')
      .set('Cookie', ownerCookies)
      .send({ gatewayForceRefundFailure: false });
    const okRefund = await request(app)
      .post(`/api/admin/orders/${orderId}/refund`)
      .set('Cookie', ownerCookies)
      .send({
        items: [{ orderItemId: itemRow.id, quantity: 1 }],
        reason: '1 damaged egg tray',
        idempotencyKey: 'rf-ok-1',
      });
    expect(okRefund.status).toBe(200);
    expect(okRefund.body.status).toBe('Success');
    expect(okRefund.body.amountSen).toBe(780);

    // Excessive refund (trying 2 more when only 1 left) must be rejected
    const excessRefund = await request(app)
      .post(`/api/admin/orders/${orderId}/refund`)
      .set('Cookie', ownerCookies)
      .send({
        items: [{ orderItemId: itemRow.id, quantity: 2 }],
        reason: 'Duplicate attempt',
        idempotencyKey: 'rf-excess-1',
      });
    expect(excessRefund.status).toBe(400);

    // Physical stock MUST NOT have increased on refund (FR-037 / AT-13)
    const stockAfterRefund = db.get<{ sellable_stock: number }>('SELECT sellable_stock FROM products WHERE id = 5')!.sellable_stock;
    expect(stockAfterRefund).toBe(stockBeforeFlag);

    // Online sales report reflects gross, refunded, net, and exclusion disclaimer (AT-16)
    const reportRes = await request(app).get('/api/admin/reports?period=daily').set('Cookie', ownerCookies);
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.summary.grossPaidRevenueSen).toBe(1560 + 890);
    expect(reportRes.body.summary.itemRefundedTotalSen).toBe(780);
    expect(reportRes.body.summary.netSalesSen).toBe(1560 + 890 - 780);
    expect(reportRes.body.disclaimer).toContain('Excludes POSPAL physical-store transactions');
  });

  it('POSPAL OpenAPI V3: signs requests per V3 spec and verifies V3 product.change callbacks', async () => {
    const reqSign = signPospalV3Request('app123', 'req-1', '1700000000', 'secret456');
    expect(reqSign).toMatch(/^[A-F0-9]{32}$/);

    const eventId = 'evt_v3_test_1001';
    const ts = String(Math.floor(Date.now() / 1000));
    const secret = process.env.POSPAL_CALLBACK_SECRET || POSPAL_WEBHOOK_SECRET;
    const validSign = signPospalV3Callback(secret, eventId, ts);

    const payload = JSON.stringify({
      eventId,
      eventType: 'product.change',
      account: 'KAMKIM',
      eventTime: '2026-11-23 20:45:00',
      data: {
        uid: 'PP-1002',
        barcode: 'KK-VEG-002',
        name: 'Japanese Sweet Corn Twin Pack V3',
        sellPrice: 6.9,
        stock: 35,
        enable: 1,
        sysUpdateTime: '2026-11-23 20:45:00',
      },
    });

    const badRes = await request(app)
      .post('/api/webhooks/pospal')
      .set('Content-Type', 'application/json')
      .set('X-Event-Id', eventId)
      .set('X-Timestamp', ts)
      .set('X-Sign', 'INVALID')
      .send(payload);
    expect(badRes.status).toBe(401);

    const okRes = await request(app)
      .post('/api/webhooks/pospal')
      .set('Content-Type', 'application/json')
      .set('X-Event-Id', eventId)
      .set('X-Timestamp', ts)
      .set('X-Sign', validSign)
      .send(payload);
    expect(okRes.status).toBe(200);
    expect(okRes.body.applied).toBe(true);

    const updated = db.get<{
      name: string;
      category: string;
      base_price_sen: number;
      sellable_stock: number;
      is_active: number;
      image_url: string;
    }>(
      'SELECT name, category, base_price_sen, sellable_stock, is_active, image_url FROM products WHERE pospal_uid = ?',
      ['PP-1002'],
    )!;
    expect(updated.name).toBe('Japanese Sweet Corn Twin Pack V3');
    expect(updated.category).toBe('Fresh Produce');
    expect(updated.base_price_sen).toBe(690);
    expect(updated.sellable_stock).toBe(35);
    expect(updated.is_active).toBe(1);
    expect(updated.image_url).toContain('unsplash.com');
  });

  it('Customer Account Profile: basic info updates, max 5 addresses, and last-order address checkout priority', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'customer@example.com', password: 'customer123' });
    expect(loginRes.status).toBe(200);
    const custCookies = loginRes.headers['set-cookie'] as unknown as string[];
    expect(loginRes.body.customer.addresses.length).toBe(1);

    // Update basic info (name, gmail, phone)
    const updRes = await request(app)
      .put('/api/customer/profile')
      .set('Cookie', custCookies)
      .send({
        name: 'Tan Wei Ming Updated',
        email: 'weiming.kamkim@gmail.com',
        phone: '+6014-9314390',
        preferredLang: 'zh-CN',
      });
    expect(updRes.status).toBe(200);
    expect(updRes.body.customer.email).toBe('weiming.kamkim@gmail.com');
    expect(updRes.body.customer.phone).toBe('+6014-9314390');

    // Add 4 more addresses (reaching 5/5 max)
    for (let i = 2; i <= 5; i++) {
      const addRes = await request(app)
        .post('/api/customer/addresses')
        .set('Cookie', custCookies)
        .send({
          label: `Office ${i}`,
          address: `${i * 10}, Jalan SL ${i}/1, Sungai Long`,
          postcode: '43000',
        });
      expect(addRes.status).toBe(201);
      expect(addRes.body.customer.addresses.length).toBe(i);
    }

    // 6th address must be rejected cleanly
    const sixthRes = await request(app)
      .post('/api/customer/addresses')
      .set('Cookie', custCookies)
      .send({
        label: 'Extra 6th',
        address: '99, Jalan Excess, Cheras',
        postcode: '43200',
      });
    expect(sixthRes.status).toBe(400);

    // Place a delivery order using Address #4
    const orderRes = await request(app)
      .post('/api/orders')
      .set('Cookie', custCookies)
      .send({
        customerName: 'Tan Wei Ming Updated',
        customerPhone: '+6014-9314390',
        customerEmail: 'weiming.kamkim@gmail.com',
        lang: 'zh-CN',
        fulfilmentType: 'delivery',
        slotId: 'immediate',
        deliveryAddress: '40, Jalan SL 4/1, Sungai Long',
        deliveryPostcode: '43000',
        paymentMethod: 'fpx',
        policyAccepted: true,
        items: [{ productId: 1, quantity: 1 }],
      });
    expect(orderRes.status).toBe(201);

    // Next profile fetch must prioritize the last historical order's delivery address
    const meRes = await request(app).get('/api/auth/me').set('Cookie', custCookies);
    expect(meRes.status).toBe(200);
    expect(meRes.body.customer.preferredCheckoutAddress).toMatchObject({
      address: '40, Jalan SL 4/1, Sungai Long',
      postcode: '43000',
      source: 'last_order',
    });

    // Delete 1 address cleanly
    const addrIdToDelete = meRes.body.customer.addresses[4].id;
    const delRes = await request(app)
      .delete(`/api/customer/addresses/${addrIdToDelete}`)
      .set('Cookie', custCookies);
    expect(delRes.status).toBe(200);
    expect(delRes.body.customer.addresses.length).toBe(4);
  });

  it('Customer Forgot Password: sends 6-digit auth code, rejects wrong code, and resets password', async () => {
    const forgotRes = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'customer@example.com', lang: 'zh-CN' });
    expect(forgotRes.status).toBe(200);
    expect(forgotRes.body.deliveryMode).toBe('demo');
    expect(forgotRes.body.demoCode).toMatch(/^\d{6}$/);

    // Wrong code rejected
    const badReset = await request(app).post('/api/auth/reset-password').send({
      email: 'customer@example.com',
      code: '000000',
      newPassword: 'newpassword99',
    });
    expect(badReset.status).toBe(400);

    // Valid code resets password and issues authenticated session
    const okReset = await request(app).post('/api/auth/reset-password').send({
      email: 'customer@example.com',
      code: forgotRes.body.demoCode,
      newPassword: 'newpassword99',
    });
    expect(okReset.status).toBe(200);
    expect(okReset.body.ok).toBe(true);

    // Old password rejected, new password accepted
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'customer@example.com', password: 'customer123' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'customer@example.com', password: 'newpassword99' });
    expect(newLogin.status).toBe(200);
  });
});
