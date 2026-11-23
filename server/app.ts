import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Express, NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DbClient } from './db/database';
import { seedDatabase } from './db/seed';
import { createAdminRouter } from './routes/admin';
import { createStorefrontRouter } from './routes/storefront';
import { createWebhooksRouter } from './routes/webhooks';
import { attachCustomerIfPresent } from './services/auth';

export function createApp(db: DbClient, options?: { serveStatic?: boolean }): Express {
  seedDatabase(db);

  const app = express();
  app.set('trust proxy', 1);
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(cookieParser());

  // Capture raw body string for webhook signature verification while still parsing JSON cleanly
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    }),
  );

  // Override webhook body handling to pass rawBody if available
  app.use('/api/webhooks', (req, _res, next) => {
    const raw = (req as Request & { rawBody?: string }).rawBody;
    if (raw && typeof req.body === 'object') {
      // Keep parsed JSON accessible, but also attach rawBody if needed
      (req as Request & { rawBody?: string }).rawBody = raw;
    }
    next();
  });

  app.use(attachCustomerIfPresent(db));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'KamKim Fresh Mart Platform', timestamp: new Date().toISOString() });
  });

  app.use('/api', createStorefrontRouter(db));
  app.use('/api/admin', createAdminRouter(db));
  app.use('/api/webhooks', createWebhooksRouter(db));

  // Explicitly return 404 JSON on any cancellation/customer refund attempt (AT-14)
  app.use('/api/orders', (req, res, next) => {
    if (/\/cancel|\/refund-request/i.test(req.path)) {
      res.status(404).json({
        error: 'Order cancellation is not supported on KamKim Fresh Mart. Please contact the Store Owner directly.',
      });
      return;
    }
    next();
  });

  if (options?.serveStatic) {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api')) {
          next();
          return;
        }
        res.sendFile('index.html', { root: distDir, dotfiles: 'allow' });
      });
    }
  }

  // Centralized error handler
  app.use((err: Error & { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    res.status(status).json({ error: err.message || 'Internal server error.' });
  });

  return app;
}
