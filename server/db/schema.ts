export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS store_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  store_name TEXT NOT NULL,
  store_address TEXT NOT NULL,
  store_phone TEXT NOT NULL,
  store_whatsapp TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  owner_phone TEXT NOT NULL,
  operating_hours_json TEXT NOT NULL,
  slots_json TEXT NOT NULL,
  pospal_outage_mode INTEGER NOT NULL DEFAULT 0,
  safety_stock_buffer INTEGER NOT NULL DEFAULT 0,
  lalamove_force_price_increase INTEGER NOT NULL DEFAULT 0,
  lalamove_hide_coordinates INTEGER NOT NULL DEFAULT 0,
  gateway_force_refund_failure INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  default_address TEXT,
  default_postcode TEXT,
  preferred_lang TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  can_process_refunds INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pospal_uid TEXT NOT NULL UNIQUE,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_zh TEXT NOT NULL DEFAULT '',
  name_ms TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  base_price_sen INTEGER NOT NULL,
  pospal_stock INTEGER NOT NULL DEFAULT 0,
  sellable_stock INTEGER NOT NULL DEFAULT 0,
  pospal_revision INTEGER NOT NULL DEFAULT 1,
  pospal_updated_at TEXT NOT NULL,
  unit_label TEXT NOT NULL DEFAULT '1 pack',
  short_desc_en TEXT NOT NULL DEFAULT '',
  extended_desc_en TEXT NOT NULL DEFAULT '',
  extended_desc_zh TEXT NOT NULL DEFAULT '',
  extended_desc_ms TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  seo_slug TEXT NOT NULL DEFAULT '',
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pospal_mock_products (
  pospal_uid TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  base_price_sen INTEGER NOT NULL,
  stock_on_hand INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pospal_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  delta INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Sent', 'Confirmed', 'Conflict', 'Failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE,
  guest_access_token TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'en',
  fulfilment_type TEXT NOT NULL CHECK (fulfilment_type IN ('delivery', 'pickup')),
  scheduled_slot_id TEXT NOT NULL,
  scheduled_slot_label TEXT NOT NULL,
  scheduled_start_iso TEXT NOT NULL,
  scheduled_end_iso TEXT NOT NULL,
  delivery_address TEXT NOT NULL DEFAULT '',
  delivery_postcode TEXT NOT NULL DEFAULT '',
  delivery_notes TEXT NOT NULL DEFAULT '',
  subtotal_sen INTEGER NOT NULL,
  delivery_fee_sen INTEGER NOT NULL DEFAULT 0,
  topup_fee_sen INTEGER NOT NULL DEFAULT 0,
  total_sen INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('fpx', 'card', 'tng', 'grabpay', 'pay_at_store')),
  order_status TEXT NOT NULL CHECK (order_status IN ('Placed', 'Preparing', 'Ready', 'In Delivery', 'Ready for Collection', 'Completed', 'Exception')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('Unpaid', 'Pending', 'Paid', 'Failed', 'Top-up Due')),
  pos_sync_status TEXT NOT NULL CHECK (pos_sync_status IN ('Not Required', 'Queued', 'Sent', 'Confirmed', 'Failed', 'Reconciling')),
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('Not Applicable', 'Not Booked', 'Waiting for Slot', 'Quote Expired', 'Top-up Required', 'Booking', 'Driver Assigned', 'Picked Up', 'Delivered', 'Failed')),
  stock_deducted INTEGER NOT NULL DEFAULT 0,
  policy_accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_label TEXT NOT NULL,
  unit_price_sen INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  line_total_sen INTEGER NOT NULL,
  fulfilment_flag TEXT NOT NULL DEFAULT 'normal' CHECK (fulfilment_flag IN ('normal', 'unavailable')),
  flagged_by TEXT,
  flagged_at TEXT,
  flag_reason TEXT NOT NULL DEFAULT '',
  refunded_qty INTEGER NOT NULL DEFAULT 0,
  refunded_amount_sen INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  payment_purpose TEXT NOT NULL CHECK (payment_purpose IN ('initial', 'topup')),
  method TEXT NOT NULL,
  amount_sen INTEGER NOT NULL,
  gateway_ref TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Paid', 'Failed')),
  signature_verified INTEGER NOT NULL DEFAULT 0,
  raw_callback_json TEXT NOT NULL DEFAULT '',
  paid_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refund_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  gateway_refund_id TEXT NOT NULL DEFAULT '',
  amount_sen INTEGER NOT NULL,
  items_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Success', 'Failed')),
  error_message TEXT NOT NULL DEFAULT '',
  initiated_by_id INTEGER NOT NULL,
  initiated_by_name TEXT NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  quote_id TEXT NOT NULL,
  quoted_fee_sen INTEGER NOT NULL,
  quote_expires_at TEXT NOT NULL,
  actual_fee_sen INTEGER NOT NULL DEFAULT 0,
  topup_required_sen INTEGER NOT NULL DEFAULT 0,
  lalamove_order_id TEXT UNIQUE,
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL,
  driver_name TEXT NOT NULL DEFAULT '',
  driver_phone TEXT NOT NULL DEFAULT '',
  driver_plate TEXT NOT NULL DEFAULT '',
  driver_lat REAL,
  driver_lng REAL,
  tracking_url TEXT NOT NULL DEFAULT '',
  schedule_at_iso TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  UNIQUE(provider, event_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES orders(id),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  lang TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at TEXT NOT NULL
);
`;
