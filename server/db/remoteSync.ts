import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let backupTimer: NodeJS.Timeout | null = null;
let inFlightUpload: Promise<void> | null = null;
let queuedBytes: Uint8Array | null = null;

function getPool(): pg.Pool | null {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!pool) {
    const useSsl = !url.includes('localhost') && !url.includes('127.0.0.1');
    pool = new Pool({
      connectionString: url,
      max: 2,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export function isRemotePersistenceEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/**
 * Restores the gzipped SQLite snapshot from PostgreSQL on cold boot (if DATABASE_URL is set)
 * so registered users, addresses, orders, and sync state persist across Render restarts/redeploys.
 */
export async function restoreSqliteFromRemote(dbPath: string): Promise<boolean> {
  const p = getPool();
  if (!p) return false;

  await p.query(`
    CREATE TABLE IF NOT EXISTS kamkim_db_snapshot (
      id INTEGER PRIMARY KEY,
      data_gz BYTEA NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const res = await p.query<{ data_gz: Buffer }>('SELECT data_gz FROM kamkim_db_snapshot WHERE id = 1');
  const row = res.rows[0];
  if (!row?.data_gz) return false;

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const raw = zlib.gunzipSync(row.data_gz);
  fs.writeFileSync(dbPath, raw);
  return true;
}

async function uploadSnapshotBytes(bytes: Uint8Array): Promise<void> {
  const p = getPool();
  if (!p) return;
  const gz = zlib.gzipSync(Buffer.from(bytes));
  const now = new Date().toISOString();
  await p.query(
    `INSERT INTO kamkim_db_snapshot (id, data_gz, updated_at)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET data_gz = EXCLUDED.data_gz, updated_at = EXCLUDED.updated_at`,
    [gz, now],
  );
}

async function drainUploadQueue(): Promise<void> {
  if (inFlightUpload) {
    await inFlightUpload;
    return;
  }
  while (queuedBytes) {
    const next = queuedBytes;
    queuedBytes = null;
    inFlightUpload = uploadSnapshotBytes(next).finally(() => {
      inFlightUpload = null;
    });
    await inFlightUpload;
  }
}

export function scheduleRemoteBackup(exportFn: () => Uint8Array): void {
  if (!isRemotePersistenceEnabled()) return;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupTimer = null;
    try {
      queuedBytes = exportFn();
      void drainUploadQueue().catch((err) => {
        console.warn('Remote Postgres SQLite backup error:', err instanceof Error ? err.message : err);
      });
    } catch (err) {
      console.warn('Remote Postgres snapshot export failed:', err instanceof Error ? err.message : err);
    }
  }, 400);
}

export async function flushRemoteBackup(exportFn?: () => Uint8Array): Promise<void> {
  if (!isRemotePersistenceEnabled()) return;
  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }
  if (exportFn) {
    queuedBytes = exportFn();
  }
  await drainUploadQueue();
  if (pool) {
    await pool.end();
    pool = null;
  }
}
