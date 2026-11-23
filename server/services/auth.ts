import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { DbClient } from '../db/database';

const SESSION_SECRET = process.env.SESSION_SECRET || 'kamkim-dev-session-secret-change-in-prod-2026';
export const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'kamkim-gateway-hmac-secret-2026';
export const POSPAL_WEBHOOK_SECRET = process.env.POSPAL_WEBHOOK_SECRET || 'kamkim-pospal-hmac-secret-2026';
export const LALAMOVE_WEBHOOK_SECRET = process.env.LALAMOVE_WEBHOOK_SECRET || 'kamkim-lalamove-hmac-secret-2026';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(keyHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function signHmac(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

export function verifyHmac(secret: string, data: string, signature: string): boolean {
  if (!signature) return false;
  const expected = signHmac(secret, data);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface SessionTokenPayload {
  sub: number;
  type: 'admin' | 'customer';
  role?: 'owner' | 'staff';
  exp: number;
}

export function createSessionToken(payload: Omit<SessionTokenPayload, 'exp'>, ttlHours = 12): string {
  const full: SessionTokenPayload = {
    ...payload,
    exp: Date.now() + ttlHours * 3600 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = signHmac(SESSION_SECRET, encoded);
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionTokenPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!verifyHmac(SESSION_SECRET, encoded, sig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionTokenPayload;
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface AdminSessionUser {
  id: number;
  username: string;
  displayName: string;
  email: string;
  role: 'owner' | 'staff';
  canProcessRefunds: boolean;
}

export interface CustomerSessionUser {
  id: number;
  email: string;
  name: string;
  phone: string;
  defaultAddress: string;
  defaultPostcode: string;
  preferredLang: string;
}

export interface AuthedRequest extends Request {
  adminUser?: AdminSessionUser;
  customerUser?: CustomerSessionUser;
}

// Simple sliding-window rate limiter for auth endpoints (NFR-01)
const loginAttempts = new Map<string, number[]>();

export function rateLimitAuth(maxAttempts = 20, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip || 'local'}:${req.path}`;
    const now = Date.now();
    const recent = (loginAttempts.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxAttempts) {
      res.status(429).json({ error: 'Too many login attempts. Please wait a minute and try again.' });
      return;
    }
    recent.push(now);
    loginAttempts.set(key, recent);
    next();
  };
}

export function attachCustomerIfPresent(db: DbClient) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    const token = req.cookies?.kk_customer_session as string | undefined;
    const payload = verifySessionToken(token);
    if (payload && payload.type === 'customer') {
      const row = db.get<{
        id: number;
        email: string;
        name: string;
        phone: string;
        default_address: string | null;
        default_postcode: string | null;
        preferred_lang: string;
      }>('SELECT id, email, name, phone, default_address, default_postcode, preferred_lang FROM customers WHERE id = ?', [
        payload.sub,
      ]);
      if (row) {
        req.customerUser = {
          id: row.id,
          email: row.email,
          name: row.name,
          phone: row.phone,
          defaultAddress: row.default_address || '',
          defaultPostcode: row.default_postcode || '',
          preferredLang: row.preferred_lang,
        };
      }
    }
    next();
  };
}

export function requireCustomer(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.customerUser) {
    res.status(401).json({ error: 'Customer authentication required.' });
    return;
  }
  next();
}

export function requireAdmin(db: DbClient) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const token = req.cookies?.kk_admin_session as string | undefined;
    const payload = verifySessionToken(token);
    if (!payload || payload.type !== 'admin') {
      res.status(401).json({ error: 'Admin password login required.' });
      return;
    }
    const row = db.get<{
      id: number;
      username: string;
      display_name: string;
      email: string;
      role: 'owner' | 'staff';
      can_process_refunds: number;
      is_active: number;
    }>(
      'SELECT id, username, display_name, email, role, can_process_refunds, is_active FROM admin_users WHERE id = ?',
      [payload.sub],
    );
    if (!row || row.is_active !== 1) {
      res.status(401).json({ error: 'Admin account disabled or not found.' });
      return;
    }
    req.adminUser = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      role: row.role,
      canProcessRefunds: row.role === 'owner' || row.can_process_refunds === 1,
    };
    next();
  };
}

export function requireOwner(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.adminUser || req.adminUser.role !== 'owner') {
    res.status(403).json({ error: 'Owner / Super Admin permission required.' });
    return;
  }
  next();
}

export function requireRefundPermission(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.adminUser || !req.adminUser.canProcessRefunds) {
    res.status(403).json({ error: 'Refund permission required (Owner or explicitly authorised merchant role).' });
    return;
  }
  next();
}
