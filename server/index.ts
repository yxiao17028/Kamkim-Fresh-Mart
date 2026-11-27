import 'dotenv/config';
import path from 'node:path';
import { createApp } from './app';
import { createDbClient } from './db/database';
import {
  flushRemoteBackup,
  isRemotePersistenceEnabled,
  restoreSqliteFromRemote,
  scheduleRemoteBackup,
} from './db/remoteSync';
import { loadCatalogueSnapshotIfEmpty } from './db/snapshot';
import { pullLivePospalCatalogue } from './services/pospal';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'kamkim.sqlite');

async function start() {
  if (isRemotePersistenceEnabled()) {
    try {
      const restored = await restoreSqliteFromRemote(DB_PATH);
      console.log(
        restored
          ? 'Restored SQLite database snapshot from remote PostgreSQL.'
          : 'Remote PostgreSQL connected (no prior snapshot yet; will backup automatically).',
      );
    } catch (err) {
      console.warn('Failed to restore remote PostgreSQL snapshot:', err instanceof Error ? err.message : err);
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.warn(
      'WARNING: DATABASE_URL is not configured. SQLite writes to ephemeral disk will be lost on Render restarts/redeploys.',
    );
  }

  let dbRef: Awaited<ReturnType<typeof createDbClient>> | null = null;
  const db = await createDbClient(DB_PATH, {
    onPersist: () => {
      if (dbRef) {
        scheduleRemoteBackup(() => dbRef!.exportBytes());
      }
    },
  });
  dbRef = db;

  if (process.env.SEED_DEMO_PRODUCTS !== 'true') {
    const loaded = loadCatalogueSnapshotIfEmpty(db);
    if (loaded > 0) {
      console.log(`Loaded ${loaded} products from bundled catalogue snapshot.`);
    }
  }
  const app = createApp(db, { serveStatic: true });

  // Flush remote backup cleanly on shutdown signals (e.g. Render redeploy/spin-down)
  const shutdown = async () => {
    try {
      await flushRemoteBackup(() => db.exportBytes());
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  app.listen(PORT, HOST, () => {
    console.log(`KamKim Fresh Mart server listening on http://${HOST}:${PORT}`);
    console.log(`Storefront: http://localhost:${PORT}/`);
    console.log(`Admin Portal (Password Required): http://localhost:${PORT}/admin`);

    if (process.env.POSPAL_MODE === 'live' && process.env.AUTO_PULL_POSPAL_ON_EMPTY === 'true') {
      const countRow = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM products');
      if ((countRow?.c ?? 0) === 0) {
        console.log('Empty product database detected in live POSPAL mode; pulling catalogue in background...');
        pullLivePospalCatalogue(db)
          .then((res) => console.log('Auto-pulled POSPAL catalogue:', res))
          .catch((err) => console.warn('Auto-pull POSPAL skipped/failed:', err instanceof Error ? err.message : err));
      }
    }
  });
}

start().catch((err) => {
  console.error('Failed to start KamKim Fresh Mart server:', err);
  process.exit(1);
});
