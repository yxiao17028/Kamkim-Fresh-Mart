import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DbClient } from './database';

interface SnapshotProductRow {
  pospal_uid: string;
  sku: string;
  name: string;
  name_zh: string;
  name_ms: string;
  category: string;
  base_price_sen: number;
  pospal_stock: number;
  sellable_stock: number;
  pospal_revision: number;
  pospal_updated_at: string;
  unit_label: string;
  short_desc_en: string;
  extended_desc_en: string;
  extended_desc_zh: string;
  extended_desc_ms: string;
  image_url: string;
  seo_slug: string;
  is_featured: number;
  is_active: number;
  updated_at: string;
}

const DEFAULT_SNAPSHOT_PATH = path.resolve(process.cwd(), 'server', 'db', 'catalogue-snapshot.json.gz');

/**
 * Loads the tracked POSPAL product catalogue snapshot into an empty products table
 * so ephemeral deployments (such as Render) boot immediately with full inventory.
 */
export function loadCatalogueSnapshotIfEmpty(db: DbClient, snapshotPath = DEFAULT_SNAPSHOT_PATH): number {
  const existing = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM products');
  if ((existing?.c ?? 0) > 0) return 0;
  if (!fs.existsSync(snapshotPath)) return 0;

  const compressed = fs.readFileSync(snapshotPath);
  const rows = JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) as SnapshotProductRow[];
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  let inserted = 0;
  db.transaction(() => {
    for (const p of rows) {
      const res = db.run(
        `INSERT OR IGNORE INTO products
         (pospal_uid, sku, name, name_zh, name_ms, category, base_price_sen, pospal_stock, sellable_stock,
          pospal_revision, pospal_updated_at, unit_label, short_desc_en, extended_desc_en, extended_desc_zh,
          extended_desc_ms, image_url, seo_slug, is_featured, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.pospal_uid,
          p.sku,
          p.name,
          p.name_zh ?? '',
          p.name_ms ?? '',
          p.category ?? 'General',
          p.base_price_sen,
          p.pospal_stock ?? 0,
          p.sellable_stock ?? 0,
          p.pospal_revision ?? 1,
          p.pospal_updated_at ?? p.updated_at,
          p.unit_label ?? '1 pack',
          p.short_desc_en ?? '',
          p.extended_desc_en ?? '',
          p.extended_desc_zh ?? '',
          p.extended_desc_ms ?? '',
          p.image_url ?? '',
          p.seo_slug ?? p.sku,
          p.is_featured ?? 0,
          p.is_active ?? 1,
          p.updated_at,
        ],
      );
      inserted += res.changes;
    }
  });

  return inserted;
}
