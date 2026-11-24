import crypto from 'node:crypto';
import { POSPAL_WEBHOOK_SECRET } from './auth';

export interface PospalV3Config {
  mode: 'live' | 'mock';
  apiBase: string;
  account: string;
  appId: string;
  appKey: string;
  callbackSecret: string;
}

export function getPospalConfig(): PospalV3Config {
  const appId = process.env.POSPAL_APP_ID || '';
  const appKey = process.env.POSPAL_APP_KEY || '';
  const account = process.env.POSPAL_ACCOUNT || '';
  const modeEnv = (process.env.POSPAL_MODE || 'mock').toLowerCase();
  const mode: 'live' | 'mock' = modeEnv === 'live' && appId && appKey && account ? 'live' : 'mock';
  return {
    mode,
    apiBase: (process.env.POSPAL_API_BASE || 'https://platform.pospal.cn').replace(/\/+$/, ''),
    account,
    appId,
    appKey,
    callbackSecret: process.env.POSPAL_CALLBACK_SECRET ?? POSPAL_WEBHOOK_SECRET,
  };
}

export function maskAppId(appId: string): string {
  if (!appId) return 'Not configured';
  if (appId.length <= 8) return `${appId.slice(0, 2)}****`;
  return `${appId.slice(0, 4)}****${appId.slice(-4)}`;
}

/**
 * Official POSPAL OpenAPI V3 request signature:
 * stringToSign = appId + "|" + requestId + "|" + timestamp + "|" + appKey
 * sign = md5(stringToSign).toUpperCase()
 */
export function signPospalV3Request(appId: string, requestId: string, timestampSec: string, appKey: string): string {
  const raw = `${appId}|${requestId}|${timestampSec}|${appKey}`;
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex').toUpperCase();
}

/**
 * Official POSPAL OpenAPI V3 webhook callback signature:
 * stringToSign = callbackSecret + "|" + eventId + "|" + timestamp
 * sign = md5(stringToSign).toUpperCase()
 */
export function signPospalV3Callback(callbackSecret: string, eventId: string, timestampSec: string): string {
  const raw = `${callbackSecret}|${eventId}|${timestampSec}`;
  return crypto.createHash('md5').update(raw, 'utf8').digest('hex').toUpperCase();
}

export function verifyPospalV3Callback(
  callbackSecret: string,
  eventId: string,
  timestampSec: string,
  incomingSign: string,
): boolean {
  if (!eventId || !timestampSec || !incomingSign) return false;
  const expected = signPospalV3Callback(callbackSecret, eventId, timestampSec);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(incomingSign.toUpperCase(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface PospalApiEnvelope<T> {
  status: 'success' | 'error';
  errorCode: number;
  messages?: string[];
  result?: T;
}

export interface PospalV3Product {
  id: string;
  uid: string;
  categoryUid?: string;
  stock: number;
  name: string;
  barcode: string;
  sellPrice: number;
  enable: number;
  description?: string;
  sysUpdateTime?: string;
  category?: { uid: string; name: string };
  mainUnit?: { uid: string; name: string };
  images?: Array<{ path: string; isCover?: number; orderIndex?: number }>;
}

export class PospalApiError extends Error {
  errorCode: number;
  constructor(message: string, errorCode = 500) {
    super(message);
    this.errorCode = errorCode;
  }
}

export async function callPospalV3<T>(
  endpointPath: string,
  body: Record<string, unknown>,
  requestId: string = crypto.randomUUID(),
  config = getPospalConfig(),
): Promise<T> {
  if (config.mode !== 'live') {
    throw new PospalApiError('POSPAL live mode is not enabled.', 503);
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = signPospalV3Request(config.appId, requestId, timestamp, config.appKey);
  const url = `${config.apiBase}${endpointPath}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'X-App-Id': config.appId,
      'X-Timestamp': timestamp,
      'X-Request-Id': requestId,
      'X-Sign': sign,
    },
    body: JSON.stringify({
      account: config.account,
      ...body,
    }),
  });

  if (!res.ok) {
    throw new PospalApiError(`POSPAL HTTP ${res.status}`, res.status);
  }

  const json = (await res.json()) as PospalApiEnvelope<T>;
  if (json.status !== 'success' || json.errorCode !== 0) {
    const msg = json.messages?.join('; ') || `POSPAL API error ${json.errorCode}`;
    throw new PospalApiError(`[POSPAL ${json.errorCode}] ${msg}`, json.errorCode);
  }
  return json.result as T;
}

export async function fetchAllPospalV3Products(config = getPospalConfig()): Promise<PospalV3Product[]> {
  const all: PospalV3Product[] = [];
  let lastId: string | number = 0;
  let pages = 0;

  while (pages < 200) {
    pages += 1;
    const page: {
      list: PospalV3Product[];
      hasMore: boolean;
      nextLastId?: string;
    } = await callPospalV3<{
      list: PospalV3Product[];
      hasMore: boolean;
      nextLastId?: string;
    }>(
      '/openapi/v3/product/increment-page',
      {
        lastId,
        order: 'asc',
        limit: 100,
        needCategory: true,
        needImages: true,
        needMainUnit: true,
      },
      crypto.randomUUID(),
      config,
    );
    if (Array.isArray(page.list)) {
      all.push(...page.list);
    }
    if (!page.hasMore || !page.nextLastId) break;
    lastId = page.nextLastId;
  }

  return all;
}

/**
 * Lightweight stock-only pagination (`/openapi/v3/product/stock-page`).
 * Returns up to 1,000 items per call for 500 Tokens (~69% cheaper than full increment-page).
 */
export async function fetchAllPospalV3Stock(
  config = getPospalConfig(),
): Promise<Array<{ barcode: string; stock: number }>> {
  const all: Array<{ barcode: string; stock: number }> = [];
  let lastId: string | number = 0;
  let pages = 0;

  while (pages < 50) {
    pages += 1;
    const page: {
      list: Array<{ barcode: string; stock: number }>;
      hasMore: boolean;
      nextLastId?: string;
    } = await callPospalV3<{
      list: Array<{ barcode: string; stock: number }>;
      hasMore: boolean;
      nextLastId?: string;
    }>('/openapi/v3/product/stock-page', { lastId }, crypto.randomUUID(), config);
    if (Array.isArray(page.list)) {
      all.push(...page.list);
    }
    if (!page.hasMore || !page.nextLastId) break;
    lastId = page.nextLastId;
  }

  return all;
}

export async function pushPospalV3StockBatchAdjust(
  items: Array<{ barcode: string; changeStock: number }>,
  requestId: string,
  config = getPospalConfig(),
): Promise<{
  successCount: number;
  failCount: number;
  results: Array<{ barcode: string; success: boolean; message: string; stock: number | null }>;
}> {
  return callPospalV3(
    '/openapi/v3/product/stock-batch-adjust',
    { items },
    requestId,
    config,
  );
}

export async function pushPospalV3ProductUpdate(
  params: { barcode: string; name?: string; sellPriceYuan?: number },
  requestId: string,
  config = getPospalConfig(),
): Promise<{ uid: string; barcode: string; name: string; sysUpdateTime: string }> {
  const updateMask: string[] = [];
  const body: Record<string, unknown> = { barcode: params.barcode };
  if (typeof params.name === 'string') {
    updateMask.push('name');
    body.name = params.name;
  }
  if (typeof params.sellPriceYuan === 'number') {
    updateMask.push('sellPrice');
    body.sellPrice = params.sellPriceYuan;
  }
  body.updateMask = updateMask;
  return callPospalV3('/openapi/v3/product/update', body, requestId, config);
}
