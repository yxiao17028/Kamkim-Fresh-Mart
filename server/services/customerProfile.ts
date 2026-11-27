import { DbClient } from '../db/database';

export const MAX_SAVED_ADDRESSES = 5;

export interface SavedAddressRecord {
  id: number;
  label: string;
  recipientName: string;
  phone: string;
  address: string;
  postcode: string;
  isDefault: boolean;
  lastUsedAt: string | null;
}

export interface PreferredCheckoutAddress {
  address: string;
  postcode: string;
  label?: string;
  source: 'last_order' | 'default' | 'saved';
}

export interface CustomerProfilePayload {
  id: number;
  email: string;
  name: string;
  phone: string;
  defaultAddress: string;
  defaultPostcode: string;
  preferredLang: string;
  addresses: SavedAddressRecord[];
  preferredCheckoutAddress: PreferredCheckoutAddress | null;
}

interface AddressDbRow {
  id: number;
  customer_id: number;
  label: string;
  recipient_name: string;
  phone: string;
  address: string;
  postcode: string;
  is_default: number;
  last_used_at: string | null;
}

function mapAddressRow(row: AddressDbRow): SavedAddressRecord {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipient_name,
    phone: row.phone,
    address: row.address,
    postcode: row.postcode,
    isDefault: row.is_default === 1,
    lastUsedAt: row.last_used_at,
  };
}

export function ensureInitialAddressMigrated(db: DbClient, customerId: number): void {
  const countRow = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM customer_addresses WHERE customer_id = ?', [
    customerId,
  ]);
  if ((countRow?.c ?? 0) > 0) return;

  const cust = db.get<{
    name: string;
    phone: string;
    default_address: string | null;
    default_postcode: string | null;
  }>('SELECT name, phone, default_address, default_postcode FROM customers WHERE id = ?', [customerId]);
  if (!cust || !cust.default_address?.trim()) return;

  const now = new Date().toISOString();
  db.run(
    `INSERT INTO customer_addresses (customer_id, label, recipient_name, phone, address, postcode, is_default, created_at)
     VALUES (?, 'Home', ?, ?, ?, ?, 1, ?)`,
    [customerId, cust.name, cust.phone, cust.default_address.trim(), cust.default_postcode?.trim() || '43000', now],
  );
}

export function syncCustomerDefaultFields(db: DbClient, customerId: number): void {
  const top = db.get<{ address: string; postcode: string }>(
    `SELECT address, postcode FROM customer_addresses
     WHERE customer_id = ? ORDER BY is_default DESC, id ASC LIMIT 1`,
    [customerId],
  );
  db.run('UPDATE customers SET default_address = ?, default_postcode = ? WHERE id = ?', [
    top?.address || '',
    top?.postcode || '',
    customerId,
  ]);
}

export function getCustomerProfilePayload(db: DbClient, customerId: number): CustomerProfilePayload | null {
  ensureInitialAddressMigrated(db, customerId);

  const cust = db.get<{
    id: number;
    email: string;
    name: string;
    phone: string;
    default_address: string | null;
    default_postcode: string | null;
    preferred_lang: string;
  }>('SELECT id, email, name, phone, default_address, default_postcode, preferred_lang FROM customers WHERE id = ?', [
    customerId,
  ]);
  if (!cust) return null;

  const addrRows = db.all<AddressDbRow>(
    `SELECT id, customer_id, label, recipient_name, phone, address, postcode, is_default, last_used_at
     FROM customer_addresses
     WHERE customer_id = ?
     ORDER BY is_default DESC, COALESCE(last_used_at, '') DESC, id ASC`,
    [customerId],
  );
  const addresses = addrRows.map(mapAddressRow);

  // Prioritize the delivery address used in the customer's most recent order
  const lastOrder = db.get<{ delivery_address: string; delivery_postcode: string }>(
    `SELECT delivery_address, delivery_postcode
     FROM orders
     WHERE customer_id = ? AND TRIM(delivery_address) != ''
     ORDER BY id DESC LIMIT 1`,
    [customerId],
  );

  let preferredCheckoutAddress: PreferredCheckoutAddress | null = null;
  if (lastOrder && lastOrder.delivery_address.trim()) {
    const matchedSaved = addresses.find(
      (a) => a.address.trim().toLowerCase() === lastOrder.delivery_address.trim().toLowerCase(),
    );
    preferredCheckoutAddress = {
      address: lastOrder.delivery_address.trim(),
      postcode: lastOrder.delivery_postcode.trim() || matchedSaved?.postcode || '43000',
      label: matchedSaved?.label,
      source: 'last_order',
    };
  } else if (addresses.length > 0) {
    const def = addresses.find((a) => a.isDefault) ?? addresses[0];
    preferredCheckoutAddress = {
      address: def.address,
      postcode: def.postcode || '43000',
      label: def.label,
      source: def.isDefault ? 'default' : 'saved',
    };
  } else if (cust.default_address?.trim()) {
    preferredCheckoutAddress = {
      address: cust.default_address.trim(),
      postcode: cust.default_postcode?.trim() || '43000',
      source: 'default',
    };
  }

  return {
    id: cust.id,
    email: cust.email,
    name: cust.name,
    phone: cust.phone,
    defaultAddress: cust.default_address || '',
    defaultPostcode: cust.default_postcode || '',
    preferredLang: cust.preferred_lang,
    addresses,
    preferredCheckoutAddress,
  };
}

export function recordOrderAddressForCustomer(
  db: DbClient,
  customerId: number,
  params: {
    address: string;
    postcode: string;
    recipientName: string;
    phone: string;
    saveAddress?: boolean;
    label?: string;
  },
): void {
  const cleanAddr = params.address.trim();
  const cleanPost = params.postcode.trim() || '43000';
  if (!cleanAddr) return;

  ensureInitialAddressMigrated(db, customerId);
  const now = new Date().toISOString();

  const existingRows = db.all<AddressDbRow>(
    'SELECT id, customer_id, label, recipient_name, phone, address, postcode, is_default, last_used_at FROM customer_addresses WHERE customer_id = ?',
    [customerId],
  );
  const match = existingRows.find((r) => r.address.trim().toLowerCase() === cleanAddr.toLowerCase());
  if (match) {
    db.run('UPDATE customer_addresses SET last_used_at = ?, postcode = ? WHERE id = ?', [now, cleanPost, match.id]);
    return;
  }

  if (params.saveAddress && existingRows.length < MAX_SAVED_ADDRESSES) {
    const isDefault = existingRows.length === 0 ? 1 : 0;
    db.run(
      `INSERT INTO customer_addresses (customer_id, label, recipient_name, phone, address, postcode, is_default, last_used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customerId,
        params.label?.trim() || `Address ${existingRows.length + 1}`,
        params.recipientName.trim(),
        params.phone.trim(),
        cleanAddr,
        cleanPost,
        isDefault,
        now,
        now,
      ],
    );
    syncCustomerDefaultFields(db, customerId);
  }
}
