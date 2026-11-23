import 'dotenv/config';
import path from 'node:path';
import { createApp } from './app';
import { createDbClient } from './db/database';
import { pullLivePospalCatalogue } from './services/pospal';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'kamkim.sqlite');

async function start() {
  const db = await createDbClient(DB_PATH);
  const app = createApp(db, { serveStatic: true });

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
