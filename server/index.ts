import 'dotenv/config';
import path from 'node:path';
import { createApp } from './app';
import { createDbClient } from './db/database';

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'kamkim.sqlite');

async function start() {
  const db = await createDbClient(DB_PATH);
  const app = createApp(db, { serveStatic: true });

  app.listen(PORT, () => {
    console.log(`KamKim Fresh Mart server listening on http://localhost:${PORT}`);
    console.log(`Storefront: http://localhost:${PORT}/`);
    console.log(`Admin Portal (Password Required): http://localhost:${PORT}/admin`);
  });
}

start().catch((err) => {
  console.error('Failed to start KamKim Fresh Mart server:', err);
  process.exit(1);
});
