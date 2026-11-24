import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { jsPDF } from 'jspdf';
import {
  calculateEnrolmentQuote,
  validateCouponForQuote,
  type CouponInput,
  type DiscountTier,
} from './src/shared/pricing.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const firebaseConfigPath = path.resolve(__dirname, 'firebase-applet-config.json');
let fileProjectId = 'gen-lang-client-0294173474';
try {
  if (fs.existsSync(firebaseConfigPath)) {
    const parsedCfg = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf-8')) as {
      projectId?: string;
    };
    if (parsedCfg.projectId) fileProjectId = parsedCfg.projectId;
  }
} catch {
  // fall back to environment variables
}
const FIREBASE_PROJECT_ID = (
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  fileProjectId
).trim();

function getWorkerConfig(): { baseUrl: string; sharedSecret: string } | null {
  const rawUrl = process.env.CF_WORKER_URL?.trim();
  const sharedSecret = process.env.CF_WORKER_SHARED_SECRET?.trim();
  if (!rawUrl || !sharedSecret || sharedSecret.length < 16) return null;
  try {
    const parsed = new URL(rawUrl);
    const isProd = process.env.NODE_ENV === 'production';
    if (parsed.protocol !== 'https:' && (isProd || parsed.protocol !== 'http:')) {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === '169.254.169.254' ||
      host === 'metadata.google.internal' ||
      host.startsWith('169.254.') ||
      (isProd && (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'))
    ) {
      return null;
    }
    return {
      baseUrl: parsed.origin + parsed.pathname.replace(/\/+$/, ''),
      sharedSecret,
    };
  } catch {
    return null;
  }
}

const PORT = Number(process.env.PORT || 3000);
const SIGNING_SECRET =
  process.env.INTERNAL_SIGNING_SECRET && process.env.INTERNAL_SIGNING_SECRET.length >= 16
    ? process.env.INTERNAL_SIGNING_SECRET
    : crypto.randomBytes(32).toString('hex');

const PRIVATE_UPLOAD_DIR = process.env.VERCEL
  ? '/tmp/.private_uploads'
  : path.resolve(__dirname, '.private_uploads');
try {
  if (!fs.existsSync(PRIVATE_UPLOAD_DIR)) {
    fs.mkdirSync(PRIVATE_UPLOAD_DIR, { recursive: true });
  }
} catch {
  // ignore read-only FS in serverless environments
}

// Seed a real multi-page Kinyarwanda Study Guide PDF into private storage so the protected viewer works out of the box
function ensureStarterPdf() {
  try {
    if (!fs.existsSync(PRIVATE_UPLOAD_DIR)) {
      fs.mkdirSync(PRIVATE_UPLOAD_DIR, { recursive: true });
    }
    const starterPdfPath = path.join(PRIVATE_UPLOAD_DIR, 'kinyarwanda-foundations-guide.pdf');
    if (fs.existsSync(starterPdfPath)) return;

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFillColor(8, 79, 78);
  doc.rect(0, 0, 595, 110, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('times', 'bold');
  doc.setFontSize(28);
  doc.text('Ijwi — Kinyarwanda Foundations', 44, 58);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.text('Level 1 Study Guide · Greetings, Respectful Forms & Noun Classes', 44, 84);

  doc.setTextColor(31, 42, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('1. Everyday Greetings (Indamutso)', 44, 154);

  const lines = [
    ['Muraho', 'Hello (formal / polite to one or more people)'],
    ['Mwaramutse', 'Good morning'],
    ['Mwiriwe', 'Good afternoon / good evening'],
    ['Amakuru?', 'How are you? (Literally: What is the news?)'],
    ['Ni meza, murakoze', 'I am fine, thank you'],
    ['Amakuru yanyu?', 'How are you? (polite plural / respectful)'],
    ['Nitwa...', 'My name is...'],
    ['Murabeho', 'Goodbye'],
  ];

  let y = 184;
  doc.setFontSize(11);
  for (const [rw, en] of lines) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(8, 79, 78);
    doc.text(rw, 52, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(63, 79, 79);
    doc.text(en, 210, y);
    y += 24;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(31, 42, 42);
  doc.text('2. Practice Dialogue', 44, y + 26);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Aline: Muraho neza! Nitwa Aline. Amakuru yanyu?', 52, y + 54);
  doc.text('Learner: Muraho Aline! Amakuru ni meza cyane. Murakoze.', 52, y + 76);
  doc.text('Aline: Mwishimiye kwiga Ikinyarwanda? (Are you enjoying learning Kinyarwanda?)', 52, y + 98);
  doc.text('Learner: Yego, ndishimye cyane!', 52, y + 120);

  doc.addPage();
  doc.setFillColor(230, 244, 244);
  doc.rect(0, 0, 595, 72, 'F');
  doc.setTextColor(8, 79, 78);
  doc.setFont('times', 'bold');
  doc.setFontSize(20);
  doc.text('Page 2 · Core Noun Classes (Imiterere y’Amazina)', 44, 44);

  doc.setTextColor(31, 42, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const notes = [
    'Class 1 & 2 (umu- / aba-): People — umuntu (person), abantu (people), umwarimu (teacher).',
    'Class 3 & 4 (umu- / imi-): Trees & natural things — umusozi (hill), imisozi (hills).',
    'Class 5 & 6 (i- / ama-): Liquids & pairs — amazi (water), amata (milk), amahoro (peace).',
    'Class 7 & 8 (iki- / ibi-): Things & languages — ikinyarwanda, igitabo (book), ibitabo (books).',
    'Class 9 & 10 (in- / in-): Animals & everyday nouns — inzu (house), inka (cow), inzira (path).',
  ];
  let py = 112;
  for (const line of notes) {
    doc.text(line, 44, py, { maxWidth: 505 });
    py += 34;
  }

    const buffer = Buffer.from(doc.output('arraybuffer'));
    fs.writeFileSync(starterPdfPath, buffer);
  } catch (err) {
    console.warn('Starter PDF generation skipped:', err);
  }
}

ensureStarterPdf();

// Firebase ID Token verification via Google's public JWKS (no IAM required)
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

interface AuthedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

interface AuthedRequest extends Request {
  user?: AuthedUser;
}

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization Bearer token.' });
      return;
    }
    const token = authHeader.slice(7).trim();
    const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    });
    const uid = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email : '';
    const emailVerified = Boolean(payload.email_verified);
    if (!uid || !email || !emailVerified) {
      res.status(403).json({ error: 'Verified Google account required.' });
      return;
    }
    req.user = {
      uid,
      email,
      emailVerified,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

// Simple sliding-window rate limiter per IP + route bucket
const rateBuckets = new Map<string, number[]>();
function rateLimit(bucket: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${bucket}:${ip}`;
    const now = Date.now();
    const hits = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    next();
  };
}

function signPayload(data: unknown): string {
  return crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(JSON.stringify(data))
    .digest('hex');
}

// Idempotent tracking store for Pesapal IPNs & Sandbox confirmations
const processedPesapalTrackings = new Map<
  string,
  {
    merchantRef: string;
    trackingId: string;
    status: 'PAID';
    paymentMethod: string;
    amountCents: number;
    currency: string;
    paidAt: string;
  }
>();

const pesapalOrders = new Map<
  string,
  {
    invoiceId: string;
    merchantRef: string;
    amountCents: number;
    currency: string;
    trackingId: string;
    redirectUrl: string;
    voided: boolean;
  }
>();

function getPesapalBaseUrl() {
  return process.env.PESAPAL_MODE === 'live'
    ? 'https://pay.pesapal.com/v3'
    : 'https://cybqa.pesapal.com/pesapalv3';
}

async function getPesapalToken(): Promise<string | null> {
  const key = process.env.PESAPAL_CONSUMER_KEY;
  const secret = process.env.PESAPAL_CONSUMER_SECRET;
  if (!key || !secret) return null;

  const res = await fetch(`${getPesapalBaseUrl()}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ consumer_key: key, consumer_secret: secret }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Pesapal auth failed (${res.status})`);
  }
  const data = (await res.json()) as { token?: string; error?: { message?: string } };
  if (!data.token) {
    throw new Error(data.error?.message || 'Pesapal did not return a token');
  }
  return data.token;
}

function getPublicBaseUrl(req: Request): string {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const proto = forwardedProto || req.protocol || 'https';
  const host = String(req.get('x-forwarded-host') || req.get('host') || '');
  if (host) {
    return `${proto}://${host}`;
  }
  const configured = process.env.APP_URL?.trim();
  if (configured && configured !== 'MY_APP_URL') {
    try {
      return new URL(configured).origin;
    } catch {
      // ignore invalid APP_URL
    }
  }
  return `http://localhost:${PORT}`;
}

export function createApiApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '110mb' }));

  // Strict CORS for authenticated endpoints (same-origin or configured APP_URL)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    const appUrl = process.env.APP_URL;
    const allowedOrigins = new Set<string>();
    if (host) {
      allowedOrigins.add(`https://${host}`);
      allowedOrigins.add(`http://${host}`);
    }
    if (appUrl && appUrl !== 'MY_APP_URL') {
      try {
        allowedOrigins.add(new URL(appUrl).origin);
      } catch {
        // ignore invalid APP_URL
      }
    }
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      pesapalConfigured: Boolean(process.env.PESAPAL_CONSUMER_KEY && process.env.PESAPAL_CONSUMER_SECRET),
      pesapalMode: process.env.PESAPAL_MODE === 'live' ? 'live' : 'sandbox',
      resendConfigured: Boolean(process.env.RESEND_API_KEY),
      workerConfigured: Boolean(getWorkerConfig()),
    });
  });

  // Authoritative server-side pricing quote
  const quoteSchema = z.object({
    planId: z.string().min(1).max(128),
    unitPriceCents: z.number().int().min(0).max(10_000_000),
    seats: z.number().int().min(1).max(500),
    currency: z.string().min(3).max(8).default('USD'),
    tiers: z
      .array(z.object({ min: z.number().int(), max: z.number().int(), pct: z.number().int() }))
      .optional(),
    coupon: z
      .object({
        code: z.string().max(40),
        type: z.enum(['percent', 'fixed']),
        value: z.number().int().min(1),
        active: z.boolean(),
        startsAt: z.string().optional(),
        endsAt: z.string().optional(),
        usageLimit: z.number().int().optional(),
        usedCount: z.number().int().optional(),
        perPersonLimit: z.number().int().optional(),
        planId: z.string().optional(),
      })
      .nullable()
      .optional(),
    userRedemptions: z.number().int().min(0).optional(),
    existingSeats: z.number().int().min(0).max(500).optional(),
    alreadyPaidCents: z.number().int().min(0).optional(),
  });

  app.post('/api/pricing/quote', rateLimit('pricing', 60, 60_000), (req, res) => {
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid pricing payload.' });
      return;
    }
    const input = parsed.data;
    let validCoupon: CouponInput | null = null;
    let couponError: string | undefined;

    if (input.coupon) {
      const check = validateCouponForQuote(
        input.coupon,
        input.planId,
        Date.now(),
        input.userRedemptions || 0
      );
      if (check.valid) {
        validCoupon = input.coupon;
      } else {
        couponError = check.reason;
      }
    }

    const quote = calculateEnrolmentQuote({
      unitPriceCents: input.unitPriceCents,
      seats: input.seats,
      currency: input.currency,
      tiers: input.tiers as DiscountTier[] | undefined,
      coupon: validCoupon,
      existingSeats: input.existingSeats,
      alreadyPaidCents: input.alreadyPaidCents,
    });

    const signature = signPayload({
      planId: input.planId,
      seats: quote.seats,
      totalCents: quote.totalCents,
      currency: quote.currency,
    });

    res.json({ quote, couponError, signature });
  });

  // Generate cryptographic single-use invite token + SHA-256 hash
  app.post('/api/invites/generate', requireAuth, rateLimit('invites', 30, 60_000), (_req, res) => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    res.json({ rawToken, tokenHash });
  });

  // Create Pesapal Order (or sandbox payment link when Pesapal keys are unset)
  const pesapalOrderSchema = z.object({
    invoiceId: z.string().min(1).max(128),
    invoiceNumber: z.string().min(3).max(40),
    amountCents: z.number().int().min(0),
    currency: z.string().min(3).max(8),
    description: z.string().min(1).max(120),
    payerEmail: z.string().email(),
    payerName: z.string().min(1).max(120),
    callbackUrl: z.string().url().optional(),
  });

  app.post(
    '/api/payments/pesapal/order',
    requireAuth,
    rateLimit('payment', 20, 60_000),
    async (req: AuthedRequest, res: Response) => {
      const parsed = pesapalOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid payment order request.' });
        return;
      }
      const data = parsed.data;

      // Void any previous order for this invoice
      for (const [ref, order] of pesapalOrders.entries()) {
        if (order.invoiceId === data.invoiceId) {
          pesapalOrders.set(ref, { ...order, voided: true });
        }
      }

      const merchantRef = `${data.invoiceNumber}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      try {
        const token = await getPesapalToken();
        if (token) {
          const baseUrl = getPublicBaseUrl(req);
          const origin =
            data.callbackUrl ||
            process.env.PESAPAL_CALLBACK_URL ||
            `${baseUrl}/invoices/${data.invoiceId}`;
          let ipnId = process.env.PESAPAL_IPN_ID || '';
          if (!ipnId) {
            const ipnRes = await fetch(`${getPesapalBaseUrl()}/api/URLSetup/RegisterIPN`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                url: `${baseUrl}/api/payments/pesapal/ipn`,
                ipn_notification_type: 'POST',
              }),
              signal: AbortSignal.timeout(15_000),
            });
            const ipnJson = (await ipnRes.json()) as { ipn_id?: string };
            ipnId = ipnJson.ipn_id || '';
          }

          const [firstName, ...rest] = data.payerName.trim().split(/\s+/);
          const submitRes = await fetch(`${getPesapalBaseUrl()}/api/Transactions/SubmitOrderRequest`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              id: merchantRef,
              currency: data.currency,
              amount: Number((data.amountCents / 100).toFixed(2)),
              description: data.description.slice(0, 100),
              callback_url: origin,
              notification_id: ipnId,
              billing_address: {
                email_address: data.payerEmail,
                first_name: firstName || 'Learner',
                last_name: rest.join(' ') || 'Ijwi',
              },
            }),
            signal: AbortSignal.timeout(15_000),
          });
          const submitData = (await submitRes.json()) as {
            order_tracking_id?: string;
            redirect_url?: string;
            error?: { message?: string };
          };
          if (!submitData.redirect_url || !submitData.order_tracking_id) {
            throw new Error(submitData.error?.message || 'Pesapal order submission failed');
          }

          pesapalOrders.set(merchantRef, {
            invoiceId: data.invoiceId,
            merchantRef,
            amountCents: data.amountCents,
            currency: data.currency,
            trackingId: submitData.order_tracking_id,
            redirectUrl: submitData.redirect_url,
            voided: false,
          });

          res.json({
            mode: process.env.PESAPAL_MODE === 'live' ? 'live' : 'sandbox',
            merchantRef,
            trackingId: submitData.order_tracking_id,
            redirectUrl: submitData.redirect_url,
          });
          return;
        }

        // Sandbox demo mode when Pesapal credentials are not yet configured in environment
        const trackingId = `PSP-SBX-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
        const redirectUrl = `/invoices/${data.invoiceId}?pesapalCheckout=sandbox&OrderTrackingId=${trackingId}&OrderMerchantReference=${merchantRef}`;
        pesapalOrders.set(merchantRef, {
          invoiceId: data.invoiceId,
          merchantRef,
          amountCents: data.amountCents,
          currency: data.currency,
          trackingId,
          redirectUrl,
          voided: false,
        });

        res.json({
          mode: 'sandbox_demo',
          merchantRef,
          trackingId,
          redirectUrl,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to create payment link';
        res.status(502).json({ error: msg });
      }
    }
  );

  // Idempotent Pesapal IPN endpoint
  async function handlePesapalIpn(req: Request, res: Response) {
    const trackingId = String(req.body?.OrderTrackingId || req.query?.OrderTrackingId || '');
    const merchantRef = String(
      req.body?.OrderMerchantReference || req.query?.OrderMerchantReference || ''
    );
    if (!trackingId || !merchantRef) {
      res.status(400).json({ error: 'Missing OrderTrackingId or OrderMerchantReference' });
      return;
    }

    // Idempotent check
    if (processedPesapalTrackings.has(trackingId)) {
      res.json({
        orderNotificationType: 'IPNCHANGE',
        orderTrackingId: trackingId,
        orderMerchantReference: merchantRef,
        status: 200,
        idempotent: true,
      });
      return;
    }

    const order = pesapalOrders.get(merchantRef);
    const token = await getPesapalToken().catch(() => null);
    if (token && order) {
      const statusRes = await fetch(
        `${getPesapalBaseUrl()}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(
          trackingId
        )}`,
        {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(15_000),
        }
      );
      const statusJson = (await statusRes.json()) as {
        status_code?: number;
        amount?: number;
        currency?: string;
        payment_method?: string;
      };
      const paidCents = Math.round(Number(statusJson.amount || 0) * 100);
      if (
        statusJson.status_code === 1 &&
        paidCents === order.amountCents &&
        statusJson.currency === order.currency
      ) {
        processedPesapalTrackings.set(trackingId, {
          merchantRef,
          trackingId,
          status: 'PAID',
          paymentMethod: statusJson.payment_method || 'Pesapal',
          amountCents: paidCents,
          currency: statusJson.currency,
          paidAt: new Date().toISOString(),
        });
      }
    }

    res.json({
      orderNotificationType: 'IPNCHANGE',
      orderTrackingId: trackingId,
      orderMerchantReference: merchantRef,
      status: 200,
    });
  }

  app.post('/api/payments/pesapal/ipn', handlePesapalIpn);
  app.get('/api/payments/pesapal/ipn', handlePesapalIpn);

  // Verify transaction status from server before client marks invoice paid
  const verifySchema = z.object({
    invoiceId: z.string().min(1),
    trackingId: z.string().min(1),
    merchantRef: z.string().min(1),
    expectedAmountCents: z.number().int().min(0),
    expectedCurrency: z.string().min(3).max(8),
    sandboxMethod: z.string().max(64).optional(),
  });

  app.post(
    '/api/payments/pesapal/verify',
    requireAuth,
    rateLimit('payment', 30, 60_000),
    async (req: AuthedRequest, res: Response) => {
      const parsed = verifySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid verification payload.' });
        return;
      }
      const { trackingId, merchantRef, expectedAmountCents, expectedCurrency, sandboxMethod } =
        parsed.data;

      // Return cached idempotent confirmation if already verified
      const existing = processedPesapalTrackings.get(trackingId);
      if (existing) {
        res.json({ verified: true, alreadyProcessed: true, ...existing });
        return;
      }

      const order = pesapalOrders.get(merchantRef);
      if (order && order.voided) {
        res.status(409).json({ error: 'This payment link was voided. Please use the latest link.' });
        return;
      }

      const token = await getPesapalToken().catch(() => null);
      if (token) {
        const statusRes = await fetch(
          `${getPesapalBaseUrl()}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(
            trackingId
          )}`,
          {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(15_000),
          }
        );
        const statusJson = (await statusRes.json()) as {
          status_code?: number;
          payment_status_description?: string;
          amount?: number;
          currency?: string;
          payment_method?: string;
        };
        const paidCents = Math.round(Number(statusJson.amount || 0) * 100);
        if (statusJson.status_code !== 1) {
          res.status(402).json({
            verified: false,
            error: `Payment not completed yet (${statusJson.payment_status_description || 'Pending'}).`,
          });
          return;
        }
        if (paidCents !== expectedAmountCents || statusJson.currency !== expectedCurrency) {
          res.status(400).json({
            verified: false,
            error: 'Paid amount or currency does not match invoice.',
          });
          return;
        }

        const record = {
          merchantRef,
          trackingId,
          status: 'PAID' as const,
          paymentMethod: statusJson.payment_method || 'Pesapal',
          amountCents: paidCents,
          currency: statusJson.currency,
          paidAt: new Date().toISOString(),
        };
        processedPesapalTrackings.set(trackingId, record);
        res.json({ verified: true, alreadyProcessed: false, ...record });
        return;
      }

      // Sandbox demo verification (only when Pesapal API keys are not configured and trackingId is sandbox)
      if (!trackingId.startsWith('PSP-SBX-')) {
        res.status(400).json({ error: 'Pesapal live credentials not configured for non-sandbox tracking.' });
        return;
      }

      const record = {
        merchantRef,
        trackingId,
        status: 'PAID' as const,
        paymentMethod: sandboxMethod || 'Pesapal Sandbox (Mobile Money / Card)',
        amountCents: expectedAmountCents,
        currency: expectedCurrency,
        paidAt: new Date().toISOString(),
      };
      processedPesapalTrackings.set(trackingId, record);
      res.json({ verified: true, alreadyProcessed: false, ...record });
    }
  );

  // Email dispatcher via Resend API (falls back cleanly to logged status if RESEND_API_KEY unset)
  const emailSchema = z.object({
    to: z.string().email(),
    recipientName: z.string().max(120).optional(),
    type: z.string().min(1).max(64),
    subject: z.string().min(1).max(200),
    headline: z.string().min(1).max(180),
    bodyText: z.string().min(1).max(2000),
    ctaLabel: z.string().max(60).optional(),
    ctaUrl: z.string().max(512).optional(),
    essential: z.boolean().default(false),
  });

  app.post(
    '/api/emails/dispatch',
    requireAuth,
    rateLimit('email', 40, 60_000),
    async (req: AuthedRequest, res: Response) => {
      const parsed = emailSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid email payload.' });
        return;
      }
      const emailData = parsed.data;
      const firstName = (emailData.recipientName || 'Learner').split(' ')[0];
      const baseUrl = getPublicBaseUrl(req);
      const safeCtaUrl =
        emailData.ctaUrl && /^https?:\/\//i.test(emailData.ctaUrl)
          ? emailData.ctaUrl
          : `${baseUrl}${emailData.ctaUrl || '/'}`;

      const plainText = [
        `Muraho, ${firstName}`,
        '',
        emailData.headline,
        '',
        emailData.bodyText,
        emailData.ctaLabel ? `\n${emailData.ctaLabel}: ${safeCtaUrl}` : '',
        '',
        '---',
        'Ijwi Kinyarwanda Academy · learn@ijwi.me',
        emailData.essential
          ? 'This is an essential account or receipt message.'
          : `Manage email preferences: ${baseUrl}/profile`,
      ]
        .filter(Boolean)
        .join('\n');

      const escapeHtml = (s: string) =>
        s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');

      const html = `
        <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1F2A2A; padding: 32px 24px; background: #ffffff;">
          <div style="font-family: Georgia, serif; font-size: 26px; font-weight: 700; color: #084F4E; margin-bottom: 24px;">Ijwi</div>
          <p style="font-size: 15px; color: #0E7C7B; margin: 0 0 8px;">Muraho, ${escapeHtml(firstName)}</p>
          <h1 style="font-family: Georgia, serif; font-size: 22px; color: #084F4E; margin: 0 0 16px;">${escapeHtml(emailData.headline)}</h1>
          <p style="font-size: 15px; line-height: 1.65; color: #3F4F4F; white-space: pre-line;">${escapeHtml(emailData.bodyText)}</p>
          ${
            emailData.ctaLabel
              ? `<p style="margin: 28px 0;"><a href="${escapeHtml(safeCtaUrl)}" style="display:inline-block; background:#084F4E; color:#ffffff; text-decoration:none; padding:12px 24px; border-radius:12px; font-weight:600; font-size:14px;">${escapeHtml(emailData.ctaLabel)}</a></p>`
              : ''
          }
          <hr style="border:none; border-top:1px solid #E6F4F4; margin: 28px 0;" />
          <p style="font-size: 12px; color: #3F4F4F; line-height: 1.5;">
            Ijwi Kinyarwanda Academy · Kigali & Online · Reply to learn@ijwi.me<br/>
            ${
              emailData.essential
                ? 'Essential billing or account security notice.'
                : `You can adjust notification preferences anytime in your <a href="${escapeHtml(`${baseUrl}/profile`)}" style="color:#0E7C7B;">Profile settings</a>.`
            }
          </p>
        </div>
      `;

      const worker = getWorkerConfig();
      if (worker) {
        try {
          const wRes = await fetch(`${worker.baseUrl}/emails/enqueue`, {
            method: 'POST',
            headers: {
              'X-Ijwi-Worker-Secret': worker.sharedSecret,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              to: emailData.to,
              subject: emailData.subject,
              html,
              text: plainText,
            }),
            signal: AbortSignal.timeout(6_000),
          });
          if (wRes.ok) {
            const wJson = (await wRes.json().catch(() => ({}))) as { status?: string };
            res.json({
              status: wJson.status === 'logged' ? 'logged' : 'sent',
              delivery: wJson.status || 'queued',
              subject: emailData.subject,
              previewText: plainText.slice(0, 480),
            });
            return;
          }
        } catch {
          // Fall through to direct Resend or logged mode if Worker is temporarily unreachable
        }
      }

      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        try {
          const rRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: process.env.EMAIL_FROM || 'Ijwi <noreply@mail.ijwi.me>',
              reply_to: process.env.EMAIL_REPLY_TO || 'learn@ijwi.me',
              to: [emailData.to],
              subject: emailData.subject,
              html,
              text: plainText,
            }),
            signal: AbortSignal.timeout(8_000),
          });
          if (!rRes.ok) {
            const errTxt = await rRes.text();
            res.json({
              status: 'failed',
              subject: emailData.subject,
              previewText: plainText.slice(0, 480),
              error: errTxt,
            });
            return;
          }
          res.json({
            status: 'sent',
            subject: emailData.subject,
            previewText: plainText.slice(0, 480),
          });
          return;
        } catch {
          res.json({
            status: 'failed',
            subject: emailData.subject,
            previewText: plainText.slice(0, 480),
          });
          return;
        }
      }

      res.json({
        status: 'logged',
        subject: emailData.subject,
        previewText: plainText.slice(0, 480),
      });
    }
  );

  // Private resource upload (teachers & admins) -> saved outside public/ with sanitized key
  const uploadSchema = z.object({
    filename: z.string().min(1).max(160),
    mimeType: z.enum(['application/pdf', 'video/mp4', 'video/webm']),
    base64Data: z.string().min(1),
  });

  app.post('/api/resources/upload', requireAuth, async (req: AuthedRequest, res: Response) => {
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Only PDF and MP4/WebM video uploads are supported.' });
      return;
    }

    const { mimeType, base64Data } = parsed.data;
    const rawBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const buf = Buffer.from(rawBase64, 'base64');
    const maxBytes = 60 * 1024 * 1024; // 60 MB default cap
    if (buf.length === 0 || buf.length > maxBytes) {
      res.status(400).json({ error: 'File size exceeds allowed limit (60 MB).' });
      return;
    }

    const ext = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'video/mp4' ? '.mp4' : '.webm';
    const fileKey = `res-${crypto.randomUUID()}${ext}`;

    const worker = getWorkerConfig();
    if (worker) {
      try {
        const wRes = await fetch(`${worker.baseUrl}/r2/objects/${encodeURIComponent(fileKey)}`, {
          method: 'PUT',
          headers: {
            'X-Ijwi-Worker-Secret': worker.sharedSecret,
            'Content-Type': mimeType,
          },
          body: new Uint8Array(buf),
          signal: AbortSignal.timeout(45_000),
        });
        if (!wRes.ok) {
          const detail = await wRes.text();
          res.status(502).json({ error: `R2 upload failed: ${detail}` });
          return;
        }
        res.json({ fileKey, sizeBytes: buf.length, storage: 'r2' });
        return;
      } catch (err) {
        const msg =
          err instanceof Error && err.name === 'TimeoutError'
            ? 'Resource upload to storage timed out. Please try a smaller file or retry.'
            : err instanceof Error
              ? err.message
              : 'Cloudflare Worker upload error.';
        res.status(504).json({ error: msg });
        return;
      }
    }

    const resolved = path.resolve(PRIVATE_UPLOAD_DIR, fileKey);
    if (!resolved.startsWith(PRIVATE_UPLOAD_DIR + path.sep)) {
      res.status(400).json({ error: 'Invalid upload destination.' });
      return;
    }

    fs.writeFileSync(resolved, buf);
    res.json({ fileKey, sizeBytes: buf.length, storage: 'local' });
  });

  // Issue short-lived signed stream ticket for authenticated users
  const ticketSchema = z.object({
    fileKey: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9._\-]+$/),
  });

  app.post('/api/resources/stream-ticket', requireAuth, async (req: AuthedRequest, res: Response) => {
    const parsed = ticketSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid file key.' });
      return;
    }
    const { fileKey } = parsed.data;
    const resolved = path.resolve(PRIVATE_UPLOAD_DIR, fileKey);
    const existsLocally = resolved.startsWith(PRIVATE_UPLOAD_DIR + path.sep) && fs.existsSync(resolved);

    let existsInR2 = false;
    const worker = getWorkerConfig();
    if (!existsLocally && worker) {
      try {
        const headRes = await fetch(`${worker.baseUrl}/r2/objects/${encodeURIComponent(fileKey)}`, {
          method: 'HEAD',
          headers: { 'X-Ijwi-Worker-Secret': worker.sharedSecret },
          signal: AbortSignal.timeout(8_000),
        });
        existsInR2 = headRes.ok;
      } catch {
        existsInR2 = false;
      }
    }

    if (!existsLocally && !existsInR2) {
      res.status(404).json({ error: 'Resource file not found.' });
      return;
    }
    const exp = Date.now() + 10 * 60 * 1000;
    const uid = req.user!.uid;
    const sig = signPayload({ fileKey, uid, exp });
    res.json({
      streamUrl: `/api/resources/stream/${encodeURIComponent(fileKey)}?uid=${encodeURIComponent(
        uid
      )}&exp=${exp}&sig=${sig}`,
    });
  });

  // Protected private streaming with HTTP Range support (no download, no public URLs)
  app.get('/api/resources/stream/:fileKey', async (req, res) => {
    const fileKey = String(req.params.fileKey || '');
    const uid = String(req.query.uid || '');
    const exp = Number(req.query.exp || 0);
    const sig = String(req.query.sig || '');

    if (!/^[a-zA-Z0-9._\-]+$/.test(fileKey) || !uid || !exp || Date.now() > exp) {
      res.status(403).json({ error: 'Stream ticket expired or invalid.' });
      return;
    }

    const expectedSig = signPayload({ fileKey, uid, exp });
    if (
      sig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
    ) {
      res.status(403).json({ error: 'Invalid stream signature.' });
      return;
    }

    const resolved = path.resolve(PRIVATE_UPLOAD_DIR, fileKey);
    const existsLocally = resolved.startsWith(PRIVATE_UPLOAD_DIR + path.sep) && fs.existsSync(resolved);

    const worker = getWorkerConfig();
    if (!existsLocally && worker) {
      try {
        const forwardHeaders: Record<string, string> = {
          'X-Ijwi-Worker-Secret': worker.sharedSecret,
        };
        if (req.headers.range) {
          forwardHeaders.Range = req.headers.range;
        }
        const wRes = await fetch(`${worker.baseUrl}/r2/objects/${encodeURIComponent(fileKey)}`, {
          method: 'GET',
          headers: forwardHeaders,
          signal: AbortSignal.timeout(30_000),
        });
        if (!wRes.ok && wRes.status !== 206) {
          res.status(wRes.status === 416 ? 416 : 404).json({ error: 'File not found.' });
          return;
        }
        res.status(wRes.status);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Accept-Ranges', 'bytes');
        const passHeaders = ['content-type', 'content-length', 'content-range'];
        for (const h of passHeaders) {
          const val = wRes.headers.get(h);
          if (val) res.setHeader(h, val);
        }
        if (wRes.body) {
          const reader = wRes.body.getReader();
          const pump = async () => {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                res.end();
                break;
              }
              if (value) res.write(Buffer.from(value));
            }
          };
          await pump();
          return;
        }
        const buf = Buffer.from(await wRes.arrayBuffer());
        res.send(buf);
        return;
      } catch {
        res.status(502).json({ error: 'Failed to stream resource from storage.' });
        return;
      }
    }

    if (!existsLocally) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    const stat = fs.statSync(resolved);
    const fileSize = stat.size;
    const contentType = fileKey.endsWith('.pdf')
      ? 'application/pdf'
      : fileKey.endsWith('.webm')
        ? 'video/webm'
        : 'video/mp4';

    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (Number.isNaN(start) || start >= fileSize || end >= fileSize || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', String(end - start + 1));
      res.setHeader('Content-Type', contentType);
      fs.createReadStream(resolved, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Content-Length', String(fileSize));
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(resolved).pipe(res);
  });

  // Delete a private uploaded resource file (authenticated teacher/admin)
  app.delete('/api/resources/file/:fileKey', requireAuth, async (req: AuthedRequest, res: Response) => {
    const fileKey = String(req.params.fileKey || '');
    if (!/^[a-zA-Z0-9._\-]+$/.test(fileKey)) {
      res.status(400).json({ error: 'Invalid file key.' });
      return;
    }

    const worker = getWorkerConfig();
    if (worker) {
      try {
        await fetch(`${worker.baseUrl}/r2/objects/${encodeURIComponent(fileKey)}`, {
          method: 'DELETE',
          headers: { 'X-Ijwi-Worker-Secret': worker.sharedSecret },
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        // continue local cleanup as well
      }
    }

    const resolved = path.resolve(PRIVATE_UPLOAD_DIR, fileKey);
    if (resolved.startsWith(PRIVATE_UPLOAD_DIR + path.sep) && fs.existsSync(resolved)) {
      try {
        fs.unlinkSync(resolved);
      } catch {
        // ignore if already removed
      }
    }

    res.json({ ok: true, deleted: fileKey });
  });

  // Calendar .ics generator for bookings
  const icsSchema = z.object({
    bookingId: z.string().min(1).max(128),
    title: z.string().min(1).max(160),
    description: z.string().max(400).optional(),
    startUtc: z.string().min(1),
    endUtc: z.string().min(1),
  });

  app.post('/api/bookings/ics', requireAuth, (req, res) => {
    const parsed = icsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid calendar payload.' });
      return;
    }
    const { bookingId, title, description, startUtc, endUtc } = parsed.data;
    const fmt = (iso: string) =>
      new Date(iso)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
    const clean = (s: string) => s.replace(/[\r\n]/g, ' ');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Ijwi Portal//Kinyarwanda Classes//EN',
      'BEGIN:VEVENT',
      `UID:${clean(bookingId)}@ijwi.me`,
      `DTSTAMP:${fmt(new Date().toISOString())}`,
      `DTSTART:${fmt(startUtc)}`,
      `DTEND:${fmt(endUtc)}`,
      `SUMMARY:${clean(title)}`,
      `DESCRIPTION:${clean(description || 'Kinyarwanda lesson via Ijwi Portal')}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ijwi-lesson-${bookingId}.ics"`);
    res.send(ics);
  });

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (
      typeof err === 'object' &&
      err !== null &&
      'type' in err &&
      (err as { type?: string }).type === 'entity.too.large'
    ) {
      res.status(413).json({ error: 'File exceeds the maximum upload size limit.' });
      return;
    }
    next(err);
  });

  return app;
}

async function startServer() {
  const app = createApiApp();

  // Vite middleware in development, static dist in production
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Ijwi Portal running on http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
