import crypto from 'node:crypto';
import { Router } from 'express';
import { DbClient } from '../db/database';
import {
  AuthedRequest,
  PAYMENT_WEBHOOK_SECRET,
  createSessionToken,
  hashPassword,
  hashResetCode,
  rateLimitAuth,
  requireCustomer,
  signHmac,
  verifyPassword,
  verifyResetCode,
} from '../services/auth';
import { writeAuditLog } from '../services/audit';
import {
  MAX_SAVED_ADDRESSES,
  getCustomerProfilePayload,
  recordOrderAddressForCustomer,
  syncCustomerDefaultFields,
} from '../services/customerProfile';
import { isSmtpEmailConfigured, sendOrderEmail, sendPasswordResetCodeEmail } from '../services/email';
import { adminEvents } from '../services/events';
import { getLalamoveQuote } from '../services/lalamove';
import { handleGatewayPaymentWebhook } from '../services/paymentGateway';
import { deductStockForOrder } from '../services/pospal';

function buildUpcomingSlots(slotsJson: string): Array<{
  slotId: string;
  label: string;
  dateLabel: string;
  startIso: string;
  endIso: string;
  isImmediate?: boolean;
}> {
  const configured = JSON.parse(slotsJson) as Array<{
    id: string;
    label: string;
    startHour: number;
    endHour: number;
  }>;

  const now = new Date();
  const result: Array<{
    slotId: string;
    label: string;
    dateLabel: string;
    startIso: string;
    endIso: string;
    isImmediate?: boolean;
  }> = [
    {
      slotId: 'immediate',
      label: 'Express / Next Available (Within 60-90 mins)',
      dateLabel: 'Today (ASAP)',
      startIso: now.toISOString(),
      endIso: new Date(now.getTime() + 90 * 60 * 1000).toISOString(),
      isImmediate: true,
    },
  ];

  // Build today + tomorrow slots in Asia/Kuala_Lumpur (+08:00)
  const klOffsetMs = 8 * 3600 * 1000;
  const klNow = new Date(now.getTime() + klOffsetMs);

  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    const base = new Date(Date.UTC(klNow.getUTCFullYear(), klNow.getUTCMonth(), klNow.getUTCDate() + dayOffset));
    const yyyy = base.getUTCFullYear();
    const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(base.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    for (const s of configured) {
      const startIso = new Date(`${dateStr}T${String(s.startHour).padStart(2, '0')}:00:00+08:00`).toISOString();
      const endIso = new Date(`${dateStr}T${String(s.endHour).padStart(2, '0')}:00:00+08:00`).toISOString();
      if (new Date(startIso).getTime() > now.getTime() + 30 * 60 * 1000) {
        result.push({
          slotId: `${dateStr}:${s.id}`,
          label: s.label,
          dateLabel: dayOffset === 0 ? `Today (${dateStr})` : `Tomorrow (${dateStr})`,
          startIso,
          endIso,
        });
      }
    }
  }

  return result;
}

export function createStorefrontRouter(db: DbClient): Router {
  const router = Router();

  router.get('/store/info', (_req, res) => {
    const settings = db.get<{
      store_name: string;
      store_address: string;
      store_phone: string;
      store_whatsapp: string;
      store_map_url: string;
      store_facebook_url: string;
      owner_name: string;
      owner_email: string;
      owner_phone: string;
      operating_hours_json: string;
      slots_json: string;
      pospal_outage_mode: number;
    }>(
      `SELECT store_name, store_address, store_phone, store_whatsapp, store_map_url, store_facebook_url, owner_name, owner_email, owner_phone, operating_hours_json, slots_json, pospal_outage_mode
       FROM store_settings WHERE id = 1`,
    );
    if (!settings) {
      res.status(500).json({ error: 'Store settings not initialized.' });
      return;
    }

    res.json({
      storeName: settings.store_name,
      storeAddress: settings.store_address,
      storePhone: settings.store_phone,
      storeWhatsapp: settings.store_whatsapp,
      storeMapUrl: settings.store_map_url,
      storeFacebookUrl: settings.store_facebook_url,
      ownerName: settings.owner_name,
      ownerEmail: settings.owner_email,
      ownerPhone: settings.owner_phone,
      operatingHours: JSON.parse(settings.operating_hours_json),
      availableSlots: buildUpcomingSlots(settings.slots_json),
      currency: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
      noMinimumOrder: true,
    });
  });

  router.get('/products', (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
    const inStockOnly = req.query.inStock === 'true';

    const rows = db.all<{
      id: number;
      sku: string;
      name: string;
      name_zh: string;
      name_ms: string;
      category: string;
      base_price_sen: number;
      sellable_stock: number;
      unit_label: string;
      short_desc_en: string;
      extended_desc_en: string;
      extended_desc_zh: string;
      extended_desc_ms: string;
      image_url: string;
      seo_slug: string;
      is_featured: number;
    }>(
      `SELECT id, sku, name, name_zh, name_ms, category, base_price_sen, sellable_stock, unit_label,
              short_desc_en, extended_desc_en, extended_desc_zh, extended_desc_ms, image_url, seo_slug, is_featured
       FROM products WHERE is_active = 1 ORDER BY is_featured DESC, id ASC`,
    );

    const filtered = rows.filter((p) => {
      if (category && category !== 'All' && p.category !== category) return false;
      if (inStockOnly && p.sellable_stock <= 0) return false;
      if (search) {
        const hay = `${p.name} ${p.name_zh} ${p.name_ms} ${p.sku} ${p.category} ${p.short_desc_en}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    res.json({
      products: filtered.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        nameZh: p.name_zh,
        nameMs: p.name_ms,
        category: p.category,
        priceSen: p.base_price_sen,
        sellableStock: p.sellable_stock,
        outOfStock: p.sellable_stock <= 0,
        unitLabel: p.unit_label,
        shortDescEn: p.short_desc_en,
        extendedDescEn: p.extended_desc_en,
        extendedDescZh: p.extended_desc_zh,
        extendedDescMs: p.extended_desc_ms,
        imageUrl: p.image_url,
        seoSlug: p.seo_slug,
        isFeatured: p.is_featured === 1,
      })),
    });
  });

  router.post('/cart/validate', (req, res) => {
    const items = Array.isArray(req.body?.items) ? (req.body.items as Array<{ productId: number; quantity: number }>) : [];
    const validated: Array<{
      productId: number;
      sku: string;
      name: string;
      nameZh: string;
      nameMs: string;
      unitLabel: string;
      unitPriceSen: number;
      requestedQty: number;
      availableStock: number;
      valid: boolean;
      issue?: string;
      lineTotalSen: number;
    }> = [];

    let subtotalSen = 0;
    let allValid = items.length > 0;

    for (const item of items) {
      const qty = Number(item.quantity);
      const prod = db.get<{
        id: number;
        sku: string;
        name: string;
        name_zh: string;
        name_ms: string;
        unit_label: string;
        base_price_sen: number;
        sellable_stock: number;
        is_active: number;
      }>(
        'SELECT id, sku, name, name_zh, name_ms, unit_label, base_price_sen, sellable_stock, is_active FROM products WHERE id = ?',
        [Number(item.productId)],
      );
      if (!prod || prod.is_active !== 1) {
        allValid = false;
        validated.push({
          productId: Number(item.productId),
          sku: '',
          name: 'Unavailable Product',
          nameZh: '商品不可用',
          nameMs: 'Produk Tidak Tersedia',
          unitLabel: '',
          unitPriceSen: 0,
          requestedQty: qty,
          availableStock: 0,
          valid: false,
          issue: 'Product is no longer active.',
          lineTotalSen: 0,
        });
        continue;
      }
      const validQty = Number.isInteger(qty) && qty > 0 && qty <= prod.sellable_stock;
      if (!validQty) allValid = false;
      const lineTotalSen = prod.base_price_sen * (Number.isInteger(qty) && qty > 0 ? qty : 0);
      subtotalSen += lineTotalSen;

      validated.push({
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        nameZh: prod.name_zh,
        nameMs: prod.name_ms,
        unitLabel: prod.unit_label,
        unitPriceSen: prod.base_price_sen,
        requestedQty: qty,
        availableStock: prod.sellable_stock,
        valid: validQty,
        issue: prod.sellable_stock <= 0 ? 'Out of stock' : qty > prod.sellable_stock ? `Only ${prod.sellable_stock} left` : undefined,
        lineTotalSen,
      });
    }

    res.json({ allValid, subtotalSen, items: validated });
  });

  // Customer auth
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  router.post('/auth/register', rateLimitAuth(15, 60_000), (req, res) => {
    const { email, name, phone, password, defaultAddress, defaultPostcode, preferredLang } = req.body ?? {};
    const cleanEmail = String(email ?? '')
      .trim()
      .toLowerCase();
    const cleanName = String(name ?? '').trim();
    const cleanPhone = String(phone ?? '').trim();
    const rawPassword = String(password ?? '');

    if (!EMAIL_REGEX.test(cleanEmail) || !cleanName || !cleanPhone || rawPassword.length < 6) {
      res.status(400).json({ error: 'Valid email, full name, phone number, and password (min 6 chars) are required.' });
      return;
    }
    const existing = db.get<{ id: number }>('SELECT id FROM customers WHERE LOWER(TRIM(email)) = ?', [cleanEmail]);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const now = new Date().toISOString();
    const cleanAddr = defaultAddress ? String(defaultAddress).trim() : '';
    const cleanPost = defaultPostcode ? String(defaultPostcode).trim() : '43000';
    const cleanLang = ['en', 'zh-CN', 'ms-MY'].includes(preferredLang) ? preferredLang : 'en';

    const result = db.transaction(() => {
      const custRes = db.run(
        `INSERT INTO customers (email, name, phone, password_hash, default_address, default_postcode, preferred_lang, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [cleanEmail, cleanName, cleanPhone, hashPassword(rawPassword), cleanAddr, cleanPost, cleanLang, now],
      );
      if (cleanAddr) {
        db.run(
          `INSERT INTO customer_addresses (customer_id, label, recipient_name, phone, address, postcode, is_default, created_at)
           VALUES (?, 'Home', ?, ?, ?, ?, 1, ?)`,
          [custRes.lastInsertRowid, cleanName, cleanPhone, cleanAddr, cleanPost, now],
        );
      }
      return custRes;
    });

    const token = createSessionToken({ sub: result.lastInsertRowid, type: 'customer' }, 72);
    res.cookie('kk_customer_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: 72 * 3600 * 1000,
    });
    res.status(201).json({
      customer: getCustomerProfilePayload(db, result.lastInsertRowid),
    });
  });

  router.post('/auth/login', rateLimitAuth(20, 60_000), (req, res) => {
    const { email, password } = req.body ?? {};
    const cleanEmail = String(email ?? '')
      .trim()
      .toLowerCase();
    const rawPassword = String(password ?? '');
    if (!cleanEmail || !rawPassword) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }
    const user = db.get<{
      id: number;
      password_hash: string;
    }>('SELECT id, password_hash FROM customers WHERE LOWER(TRIM(email)) = ?', [cleanEmail]);

    if (!user || !verifyPassword(rawPassword, user.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = createSessionToken({ sub: user.id, type: 'customer' }, 72);
    res.cookie('kk_customer_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: 72 * 3600 * 1000,
    });
    res.json({
      customer: getCustomerProfilePayload(db, user.id),
    });
  });

  router.post('/auth/logout', (_req, res) => {
    res.clearCookie('kk_customer_session');
    res.json({ ok: true });
  });

  router.get('/auth/me', (req: AuthedRequest, res) => {
    if (!req.customerUser) {
      res.json({ customer: null });
      return;
    }
    res.json({ customer: getCustomerProfilePayload(db, req.customerUser.id) });
  });

  router.post('/auth/forgot-password', rateLimitAuth(8, 60_000), async (req, res) => {
    const cleanEmail = String(req.body?.email ?? '')
      .trim()
      .toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }

    const user = db.get<{ id: number; email: string; name: string; preferred_lang: string }>(
      'SELECT id, email, name, preferred_lang FROM customers WHERE LOWER(TRIM(email)) = ?',
      [cleanEmail],
    );

    const smtpConfigured = isSmtpEmailConfigured();
    if (!user) {
      if (smtpConfigured) {
        // Avoid enumerating accounts when real email delivery is active
        res.json({
          ok: true,
          deliveryMode: 'email',
          message: 'If an account matches that email, a 6-digit authentication code has been sent.',
        });
        return;
      }
      res.status(404).json({ error: 'No registered account found for that email address.' });
      return;
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    db.transaction(() => {
      db.run('UPDATE password_reset_codes SET used_at = ? WHERE customer_id = ? AND used_at IS NULL', [
        nowIso,
        user.id,
      ]);
      db.run(
        `INSERT INTO password_reset_codes (customer_id, email, code_hash, expires_at, attempts, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
        [user.id, user.email, hashResetCode(user.email, code), expiresAt, nowIso],
      );
    });

    const lang = ['en', 'zh-CN', 'ms-MY'].includes(String(req.body?.lang))
      ? String(req.body.lang)
      : user.preferred_lang || 'en';

    try {
      const emailRes = await sendPasswordResetCodeEmail(db, {
        recipient: user.email,
        customerName: user.name,
        code,
        lang,
      });
      res.json({
        ok: true,
        deliveryMode: emailRes.deliveryMode,
        ...(emailRes.deliveryMode === 'demo' ? { demoCode: code } : {}),
        message:
          emailRes.deliveryMode === 'email'
            ? `A 6-digit authentication code has been sent to ${user.email}.`
            : `Gmail SMTP is not configured on this server yet. Use verification code ${code} (expires in 15 minutes).`,
      });
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? `Failed to send verification email: ${err.message}` : 'Failed to send email.',
      });
    }
  });

  router.post('/auth/reset-password', rateLimitAuth(15, 60_000), (req, res) => {
    const cleanEmail = String(req.body?.email ?? '')
      .trim()
      .toLowerCase();
    const code = String(req.body?.code ?? '').trim();
    const newPassword = String(req.body?.newPassword ?? '');

    if (!cleanEmail || !code || newPassword.length < 6) {
      res.status(400).json({ error: 'Email, 6-digit code, and new password (min 6 chars) are required.' });
      return;
    }

    const row = db.get<{
      id: number;
      customer_id: number;
      email: string;
      code_hash: string;
      expires_at: string;
      attempts: number;
    }>(
      `SELECT id, customer_id, email, code_hash, expires_at, attempts
       FROM password_reset_codes
       WHERE LOWER(TRIM(email)) = ? AND used_at IS NULL
       ORDER BY id DESC LIMIT 1`,
      [cleanEmail],
    );

    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      res.status(400).json({ error: 'Verification code is invalid or has expired. Please request a new code.' });
      return;
    }
    if (row.attempts >= 5) {
      res.status(429).json({ error: 'Too many invalid code attempts. Please request a new verification code.' });
      return;
    }
    if (!verifyResetCode(cleanEmail, code, row.code_hash)) {
      db.run('UPDATE password_reset_codes SET attempts = attempts + 1 WHERE id = ?', [row.id]);
      res.status(400).json({ error: 'Incorrect authentication code. Please check and try again.' });
      return;
    }

    const now = new Date().toISOString();
    db.transaction(() => {
      db.run('UPDATE password_reset_codes SET used_at = ? WHERE id = ?', [now, row.id]);
      db.run('UPDATE customers SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), row.customer_id]);
      writeAuditLog(db, {
        actorType: 'customer',
        actorId: row.customer_id,
        actorName: cleanEmail,
        action: 'CUSTOMER_PASSWORD_RESET',
        entityType: 'customer',
        entityId: row.customer_id,
        details: { method: 'email_auth_code' },
      });
    });

    const token = createSessionToken({ sub: row.customer_id, type: 'customer' }, 72);
    res.cookie('kk_customer_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      maxAge: 72 * 3600 * 1000,
    });
    res.json({ ok: true, customer: getCustomerProfilePayload(db, row.customer_id) });
  });

  router.post('/delivery/quote', (req, res) => {
    const { address, postcode } = req.body ?? {};
    const quote = getLalamoveQuote(db, String(address ?? ''), String(postcode ?? ''));
    res.json({ quote });
  });

  // Order creation (Guest or Registered)
  router.post('/orders', (req: AuthedRequest, res) => {
    const {
      customerName,
      customerPhone,
      customerEmail,
      lang,
      fulfilmentType,
      slotId,
      deliveryAddress,
      deliveryPostcode,
      deliveryNotes,
      saveAddress,
      addressLabel,
      paymentMethod,
      policyAccepted,
      items,
      quoteId,
    } = req.body ?? {};

    if (!policyAccepted) {
      res.status(400).json({ error: 'You must acknowledge the Delivery & No-Cancellation Order Policy before submitting.' });
      return;
    }
    if (!customerName || !customerPhone || !customerEmail) {
      res.status(400).json({ error: 'Name, phone, and email are required.' });
      return;
    }
    if (!['delivery', 'pickup'].includes(fulfilmentType)) {
      res.status(400).json({ error: 'Invalid fulfilment type.' });
      return;
    }
    if (!['fpx', 'card', 'tng', 'grabpay', 'pay_at_store'].includes(paymentMethod)) {
      res.status(400).json({ error: 'Unsupported payment method.' });
      return;
    }
    if (paymentMethod === 'pay_at_store' && fulfilmentType !== 'pickup') {
      res.status(400).json({ error: 'Pay at Store is only available for Self-Pickup orders (FR-015).' });
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Cart cannot be empty.' });
      return;
    }

    const settings = db.get<{ slots_json: string }>('SELECT slots_json FROM store_settings WHERE id = 1');
    const availableSlots = buildUpcomingSlots(settings?.slots_json || '[]');
    const chosenSlot = availableSlots.find((s) => s.slotId === slotId) ?? availableSlots[0];

    let deliveryFeeSen = 0;
    let lalamoveQuote: ReturnType<typeof getLalamoveQuote> | null = null;
    if (fulfilmentType === 'delivery') {
      lalamoveQuote = getLalamoveQuote(db, String(deliveryAddress ?? ''), String(deliveryPostcode ?? ''));
      if (quoteId && typeof quoteId === 'string') {
        // Keep server authoritative fee from fresh/current Lalamove quote
      }
      deliveryFeeSen = lalamoveQuote.feeSen;
    }

    const orderLang = ['en', 'zh-CN', 'ms-MY'].includes(lang) ? lang : 'en';
    const now = new Date().toISOString();
    const orderCode = `KK-${now.slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const guestAccessToken = crypto.randomBytes(16).toString('hex');

    let orderId = 0;
    let subtotalSen = 0;
    let totalSen = 0;
    let gatewayRef = '';
    const resolvedItems: Array<{
      productId: number;
      sku: string;
      productName: string;
      unitLabel: string;
      unitPriceSen: number;
      quantity: number;
      lineTotalSen: number;
    }> = [];

    db.transaction(() => {
      for (const reqItem of items as Array<{ productId: number; quantity: number }>) {
        const qty = Number(reqItem.quantity);
        if (!Number.isInteger(qty) || qty <= 0) {
          throw Object.assign(new Error('Invalid item quantity.'), { statusCode: 400 });
        }
        const prod = db.get<{
          id: number;
          sku: string;
          name: string;
          unit_label: string;
          base_price_sen: number;
          sellable_stock: number;
          is_active: number;
        }>(
          'SELECT id, sku, name, unit_label, base_price_sen, sellable_stock, is_active FROM products WHERE id = ?',
          [Number(reqItem.productId)],
        );
        if (!prod || prod.is_active !== 1) {
          throw Object.assign(new Error('One or more products are unavailable.'), { statusCode: 400 });
        }
        if (prod.sellable_stock < qty) {
          throw Object.assign(
            new Error(`Insufficient stock for "${prod.name}". Available: ${prod.sellable_stock}.`),
            { statusCode: 409 },
          );
        }
        const lineTotalSen = prod.base_price_sen * qty;
        subtotalSen += lineTotalSen;
        resolvedItems.push({
          productId: prod.id,
          sku: prod.sku,
          productName: prod.name,
          unitLabel: prod.unit_label,
          unitPriceSen: prod.base_price_sen,
          quantity: qty,
          lineTotalSen,
        });
      }

      totalSen = subtotalSen + deliveryFeeSen;
      const isPayAtStore = paymentMethod === 'pay_at_store';

      const orderRes = db.run(
        `INSERT INTO orders
         (order_code, guest_access_token, customer_id, customer_name, customer_phone, customer_email, lang,
          fulfilment_type, scheduled_slot_id, scheduled_slot_label, scheduled_start_iso, scheduled_end_iso,
          delivery_address, delivery_postcode, delivery_notes,
          subtotal_sen, delivery_fee_sen, topup_fee_sen, total_sen, payment_method,
          order_status, payment_status, pos_sync_status, delivery_status, stock_deducted, policy_accepted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'Not Required', ?, 0, ?, ?, ?)`,
        [
          orderCode,
          guestAccessToken,
          req.customerUser?.id ?? null,
          String(customerName).trim(),
          String(customerPhone).trim(),
          String(customerEmail).trim().toLowerCase(),
          orderLang,
          fulfilmentType,
          chosenSlot.slotId,
          `${chosenSlot.dateLabel} · ${chosenSlot.label}`,
          chosenSlot.startIso,
          chosenSlot.endIso,
          fulfilmentType === 'delivery' ? String(deliveryAddress ?? '').trim() : '',
          fulfilmentType === 'delivery' ? String(deliveryPostcode ?? '').trim() : '',
          deliveryNotes ? String(deliveryNotes).trim() : '',
          subtotalSen,
          deliveryFeeSen,
          totalSen,
          paymentMethod,
          isPayAtStore ? 'Preparing' : 'Placed',
          isPayAtStore ? 'Unpaid' : 'Pending',
          fulfilmentType === 'delivery' ? 'Not Booked' : 'Not Applicable',
          now,
          now,
          now,
        ],
      );
      orderId = orderRes.lastInsertRowid;

      for (const line of resolvedItems) {
        db.run(
          `INSERT INTO order_items
           (order_id, product_id, sku, product_name, unit_label, unit_price_sen, quantity, line_total_sen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            line.productId,
            line.sku,
            line.productName,
            line.unitLabel,
            line.unitPriceSen,
            line.quantity,
            line.lineTotalSen,
          ],
        );
      }

      if (lalamoveQuote) {
        db.run(
          `INSERT INTO deliveries
           (order_id, quote_id, quoted_fee_sen, quote_expires_at, status, schedule_at_iso, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Not Booked', ?, ?, ?)`,
          [orderId, lalamoveQuote.quoteId, lalamoveQuote.feeSen, lalamoveQuote.expiresAt, chosenSlot.startIso, now, now],
        );
      }

      if (!isPayAtStore) {
        gatewayRef = `GW-PAY-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
        db.run(
          `INSERT INTO payments (order_id, payment_purpose, method, amount_sen, gateway_ref, status, created_at)
           VALUES (?, 'initial', ?, ?, ?, 'Pending', ?)`,
          [orderId, paymentMethod, totalSen, gatewayRef, now],
        );
      }

      writeAuditLog(db, {
        actorType: req.customerUser ? 'customer' : 'guest',
        actorId: req.customerUser?.id ?? customerEmail,
        actorName: String(customerName).trim(),
        action: 'ORDER_CREATED',
        entityType: 'order',
        entityId: orderCode,
        details: { fulfilmentType, paymentMethod, totalSen, itemCount: resolvedItems.length },
      });

      if (req.customerUser && fulfilmentType === 'delivery' && deliveryAddress) {
        recordOrderAddressForCustomer(db, req.customerUser.id, {
          address: String(deliveryAddress),
          postcode: String(deliveryPostcode || '43000'),
          recipientName: String(customerName),
          phone: String(customerPhone),
          saveAddress: Boolean(saveAddress),
          label: typeof addressLabel === 'string' ? addressLabel : undefined,
        });
      }
    });

    if (paymentMethod === 'pay_at_store') {
      deductStockForOrder(
        db,
        orderId,
        orderCode,
        resolvedItems.map((i) => ({
          productId: i.productId,
          sku: i.sku,
          productName: i.productName,
          quantity: i.quantity,
        })),
        {
          type: req.customerUser ? 'customer' : 'guest',
          id: String(req.customerUser?.id ?? customerEmail),
          name: String(customerName).trim(),
        },
      );
      sendOrderEmail(db, {
        orderId,
        orderCode,
        recipient: String(customerEmail).trim(),
        lang: orderLang,
        event: 'order_placed_pay_at_store',
      });
      adminEvents.emit({
        type: 'new_order',
        title: 'New Pay-at-Store Pickup Order',
        message: `Order ${orderCode} (${customerName}) placed for Self-Pickup (Unpaid - Pay at Store).`,
        orderCode,
        severity: 'info',
        timestamp: now,
      });

      res.status(201).json({
        orderId,
        orderCode,
        guestAccessToken,
        paymentRequired: false,
        totalSen,
      });
      return;
    }

    res.status(201).json({
      orderId,
      orderCode,
      guestAccessToken,
      paymentRequired: true,
      gatewayRef,
      method: paymentMethod,
      amountSen: totalSen,
    });
  });

  // Sandbox Hosted Gateway bridge (signs webhook server-side so secret never leaves backend)
  router.post('/sandbox/gateway/complete', (req, res) => {
    const { gatewayRef, orderCode, outcome, channel } = req.body ?? {};
    const payment = db.get<{ amount_sen: number; method: string }>(
      'SELECT amount_sen, method FROM payments WHERE gateway_ref = ?',
      [String(gatewayRef ?? '')],
    );
    if (!payment) {
      res.status(404).json({ error: 'Payment session not found.' });
      return;
    }
    const payloadObj = {
      eventId: `gw-evt-${gatewayRef}-${outcome}-${Date.now()}`,
      gatewayRef: String(gatewayRef),
      orderCode: String(orderCode),
      status: outcome === 'Failed' ? ('Failed' as const) : ('Paid' as const),
      amountSen: payment.amount_sen,
      channel: channel || payment.method,
    };
    const rawBody = JSON.stringify(payloadObj);
    const sig = signHmac(PAYMENT_WEBHOOK_SECRET, rawBody);
    const result = handleGatewayPaymentWebhook(db, rawBody, sig);
    res.json(result);
  });

  router.get('/customer/profile', requireCustomer, (req: AuthedRequest, res) => {
    res.json({ customer: getCustomerProfilePayload(db, req.customerUser!.id) });
  });

  router.put('/customer/profile', requireCustomer, (req: AuthedRequest, res) => {
    const customerId = req.customerUser!.id;
    const { name, email, phone, preferredLang } = req.body ?? {};
    const cleanName = String(name ?? '').trim();
    const cleanEmail = String(email ?? '')
      .trim()
      .toLowerCase();
    const cleanPhone = String(phone ?? '').trim();

    if (!cleanName || !EMAIL_REGEX.test(cleanEmail) || !cleanPhone) {
      res.status(400).json({ error: 'Name, valid email/Gmail, and phone number are required.' });
      return;
    }

    const dup = db.get<{ id: number }>('SELECT id FROM customers WHERE LOWER(TRIM(email)) = ? AND id != ?', [
      cleanEmail,
      customerId,
    ]);
    if (dup) {
      res.status(409).json({ error: 'Another account already uses that email address.' });
      return;
    }

    const langVal = ['en', 'zh-CN', 'ms-MY'].includes(String(preferredLang))
      ? String(preferredLang)
      : req.customerUser!.preferredLang;

    db.run('UPDATE customers SET name = ?, email = ?, phone = ?, preferred_lang = ? WHERE id = ?', [
      cleanName,
      cleanEmail,
      cleanPhone,
      langVal,
      customerId,
    ]);
    writeAuditLog(db, {
      actorType: 'customer',
      actorId: customerId,
      actorName: cleanName,
      action: 'CUSTOMER_PROFILE_UPDATED',
      entityType: 'customer',
      entityId: customerId,
      details: { email: cleanEmail, phone: cleanPhone },
    });

    res.json({ customer: getCustomerProfilePayload(db, customerId) });
  });

  router.post('/customer/change-password', requireCustomer, (req: AuthedRequest, res) => {
    const customerId = req.customerUser!.id;
    const currentPassword = String(req.body?.currentPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');
    if (!currentPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'Current password and new password (min 6 chars) are required.' });
      return;
    }

    const row = db.get<{ password_hash: string; name: string }>('SELECT password_hash, name FROM customers WHERE id = ?', [
      customerId,
    ]);
    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    db.run('UPDATE customers SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), customerId]);
    writeAuditLog(db, {
      actorType: 'customer',
      actorId: customerId,
      actorName: row.name,
      action: 'CUSTOMER_PASSWORD_CHANGED',
      entityType: 'customer',
      entityId: customerId,
      details: {},
    });
    res.json({ ok: true });
  });

  router.post('/customer/addresses', requireCustomer, (req: AuthedRequest, res) => {
    const customerId = req.customerUser!.id;
    const { label, recipientName, phone, address, postcode, isDefault } = req.body ?? {};
    const cleanAddress = String(address ?? '').trim();
    const cleanPostcode = String(postcode ?? '').trim() || '43000';
    if (!cleanAddress) {
      res.status(400).json({ error: 'Street address is required.' });
      return;
    }

    // Migrate legacy default_address first so limit counts consistently
    const before = getCustomerProfilePayload(db, customerId);
    const currentCount = before?.addresses.length ?? 0;
    if (currentCount >= MAX_SAVED_ADDRESSES) {
      res.status(400).json({
        error: `You can save up to ${MAX_SAVED_ADDRESSES} addresses. Please delete an existing address first.`,
      });
      return;
    }

    const now = new Date().toISOString();
    const cleanLabel = String(label ?? '').trim() || `Address ${currentCount + 1}`;
    const cleanRecipient = String(recipientName ?? '').trim() || req.customerUser!.name;
    const cleanPhone = String(phone ?? '').trim() || req.customerUser!.phone;
    const makeDefault = Boolean(isDefault) || currentCount === 0;

    db.transaction(() => {
      if (makeDefault) {
        db.run('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?', [customerId]);
      }
      db.run(
        `INSERT INTO customer_addresses (customer_id, label, recipient_name, phone, address, postcode, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [customerId, cleanLabel, cleanRecipient, cleanPhone, cleanAddress, cleanPostcode, makeDefault ? 1 : 0, now],
      );
      syncCustomerDefaultFields(db, customerId);
    });

    res.status(201).json({ customer: getCustomerProfilePayload(db, customerId) });
  });

  router.patch('/customer/addresses/:id', requireCustomer, (req: AuthedRequest, res) => {
    const customerId = req.customerUser!.id;
    const addrId = Number(req.params.id);
    const existing = db.get<{
      id: number;
      label: string;
      recipient_name: string;
      phone: string;
      address: string;
      postcode: string;
      is_default: number;
    }>('SELECT * FROM customer_addresses WHERE id = ? AND customer_id = ?', [addrId, customerId]);
    if (!existing) {
      res.status(404).json({ error: 'Address not found.' });
      return;
    }

    const { label, recipientName, phone, address, postcode, isDefault } = req.body ?? {};
    const nextAddress = address !== undefined ? String(address).trim() : existing.address;
    if (!nextAddress) {
      res.status(400).json({ error: 'Address cannot be empty.' });
      return;
    }

    db.transaction(() => {
      if (isDefault === true) {
        db.run('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?', [customerId]);
      }
      db.run(
        `UPDATE customer_addresses
         SET label = ?, recipient_name = ?, phone = ?, address = ?, postcode = ?, is_default = ?
         WHERE id = ? AND customer_id = ?`,
        [
          label !== undefined ? String(label).trim() || existing.label : existing.label,
          recipientName !== undefined ? String(recipientName).trim() : existing.recipient_name,
          phone !== undefined ? String(phone).trim() : existing.phone,
          nextAddress,
          postcode !== undefined ? String(postcode).trim() || '43000' : existing.postcode,
          isDefault === true ? 1 : isDefault === false ? 0 : existing.is_default,
          addrId,
          customerId,
        ],
      );
      syncCustomerDefaultFields(db, customerId);
    });

    res.json({ customer: getCustomerProfilePayload(db, customerId) });
  });

  router.delete('/customer/addresses/:id', requireCustomer, (req: AuthedRequest, res) => {
    const customerId = req.customerUser!.id;
    const addrId = Number(req.params.id);
    const existing = db.get<{ id: number; is_default: number }>(
      'SELECT id, is_default FROM customer_addresses WHERE id = ? AND customer_id = ?',
      [addrId, customerId],
    );
    if (!existing) {
      res.status(404).json({ error: 'Address not found.' });
      return;
    }

    db.transaction(() => {
      db.run('DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?', [addrId, customerId]);
      if (existing.is_default === 1) {
        const firstLeft = db.get<{ id: number }>(
          'SELECT id FROM customer_addresses WHERE customer_id = ? ORDER BY id ASC LIMIT 1',
          [customerId],
        );
        if (firstLeft) {
          db.run('UPDATE customer_addresses SET is_default = 1 WHERE id = ?', [firstLeft.id]);
        }
      }
      syncCustomerDefaultFields(db, customerId);
    });

    res.json({ customer: getCustomerProfilePayload(db, customerId) });
  });

  router.get('/customer/orders', requireCustomer, (req: AuthedRequest, res) => {
    const orders = db.all(
      `SELECT id, order_code, guest_access_token, fulfilment_type, scheduled_slot_label, total_sen,
              payment_method, order_status, payment_status, delivery_status, created_at
       FROM orders WHERE customer_id = ? ORDER BY id DESC`,
      [req.customerUser!.id],
    );
    res.json({ orders });
  });

  // Secured order view (Customer owner OR valid guest access token)
  router.get('/orders/:orderCode', (req: AuthedRequest, res) => {
    const orderCode = String(req.params.orderCode);
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const order = db.get<Record<string, unknown>>('SELECT * FROM orders WHERE order_code = ?', [orderCode]);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const ownsViaCustomer = req.customerUser && order.customer_id === req.customerUser.id;
    const ownsViaToken = token && token === order.guest_access_token;
    if (!ownsViaCustomer && !ownsViaToken) {
      res.status(403).json({ error: 'Valid order access token or customer login required to view this order.' });
      return;
    }

    const items = db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC', [order.id as number]);
    const payments = db.all(
      'SELECT id, payment_purpose, method, amount_sen, gateway_ref, status, paid_at, created_at FROM payments WHERE order_id = ? ORDER BY id ASC',
      [order.id as number],
    );
    const refunds = db.all(
      `SELECT id, gateway_refund_id, amount_sen, items_json, reason, status, confirmed_at, created_at
       FROM refund_transactions WHERE order_id = ? AND status IN ('Pending', 'Success') ORDER BY id DESC`,
      [order.id as number],
    );
    const delivery = db.get('SELECT * FROM deliveries WHERE order_id = ?', [order.id as number]);
    const emails = db.all('SELECT id, subject, body, lang, created_at FROM email_logs WHERE order_id = ? ORDER BY id DESC', [
      order.id as number,
    ]);
    const ownerContact = db.get(
      'SELECT store_name, store_address, store_phone, store_whatsapp, store_map_url, store_facebook_url, owner_name, owner_email, owner_phone FROM store_settings WHERE id = 1',
    );

    res.json({
      order,
      items,
      payments,
      refunds,
      delivery: delivery ?? null,
      emails,
      ownerContact,
    });
  });

  // Reorder with live price & stock revalidation (FR-007)
  router.post('/orders/:orderCode/reorder', (req: AuthedRequest, res) => {
    const orderCode = String(req.params.orderCode);
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const order = db.get<{ id: number; customer_id: number | null; guest_access_token: string }>(
      'SELECT id, customer_id, guest_access_token FROM orders WHERE order_code = ?',
      [orderCode],
    );
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    const owns = (req.customerUser && order.customer_id === req.customerUser.id) || (token && token === order.guest_access_token);
    if (!owns) {
      res.status(403).json({ error: 'Not authorised to reorder this order.' });
      return;
    }

    const oldItems = db.all<{ product_id: number; product_name: string; unit_price_sen: number; quantity: number }>(
      'SELECT product_id, product_name, unit_price_sen, quantity FROM order_items WHERE order_id = ?',
      [order.id],
    );

    const cartItems: Array<{ productId: number; quantity: number }> = [];
    const notices: string[] = [];

    for (const old of oldItems) {
      const prod = db.get<{ id: number; name: string; base_price_sen: number; sellable_stock: number; is_active: number }>(
        'SELECT id, name, base_price_sen, sellable_stock, is_active FROM products WHERE id = ?',
        [old.product_id],
      );
      if (!prod || prod.is_active !== 1 || prod.sellable_stock <= 0) {
        notices.push(`${old.product_name} is currently out of stock and was skipped.`);
        continue;
      }
      const qty = Math.min(old.quantity, prod.sellable_stock);
      if (qty < old.quantity) {
        notices.push(`${prod.name} quantity adjusted from ${old.quantity} to ${qty} due to available stock.`);
      }
      if (prod.base_price_sen !== old.unit_price_sen) {
        notices.push(
          `${prod.name} price updated from RM ${(old.unit_price_sen / 100).toFixed(2)} to RM ${(prod.base_price_sen / 100).toFixed(2)}.`,
        );
      }
      cartItems.push({ productId: prod.id, quantity: qty });
    }

    res.json({ cartItems, notices });
  });

  // Delivery top-up initiation (FR-045, AT-11)
  router.post('/orders/:orderCode/topup/initiate', (req: AuthedRequest, res) => {
    const orderCode = String(req.params.orderCode);
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const method = ['fpx', 'card', 'tng', 'grabpay'].includes(req.body?.method) ? req.body.method : 'fpx';
    const order = db.get<{
      id: number;
      order_code: string;
      customer_id: number | null;
      guest_access_token: string;
      payment_status: string;
    }>('SELECT id, order_code, customer_id, guest_access_token, payment_status FROM orders WHERE order_code = ?', [
      orderCode,
    ]);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    const owns = (req.customerUser && order.customer_id === req.customerUser.id) || (token && token === order.guest_access_token);
    if (!owns) {
      res.status(403).json({ error: 'Access denied.' });
      return;
    }
    if (order.payment_status !== 'Top-up Due') {
      res.status(400).json({ error: 'No delivery top-up is due for this order.' });
      return;
    }

    const delivery = db.get<{ topup_required_sen: number }>('SELECT topup_required_sen FROM deliveries WHERE order_id = ?', [
      order.id,
    ]);
    if (!delivery || delivery.topup_required_sen <= 0) {
      res.status(400).json({ error: 'Top-up amount is zero.' });
      return;
    }

    // Reuse pending topup payment if exists
    const existingPending = db.get<{ gateway_ref: string; amount_sen: number }>(
      `SELECT gateway_ref, amount_sen FROM payments WHERE order_id = ? AND payment_purpose = 'topup' AND status = 'Pending'`,
      [order.id],
    );
    if (existingPending) {
      res.json({ gatewayRef: existingPending.gateway_ref, amountSen: existingPending.amount_sen, method });
      return;
    }

    const gatewayRef = `GW-TOP-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
    db.run(
      `INSERT INTO payments (order_id, payment_purpose, method, amount_sen, gateway_ref, status, created_at)
       VALUES (?, 'topup', ?, ?, ?, 'Pending', ?)`,
      [order.id, method, delivery.topup_required_sen, gatewayRef, new Date().toISOString()],
    );

    res.json({ gatewayRef, amountSen: delivery.topup_required_sen, method });
  });

  return router;
}
