export interface Env {
  R2_BUCKET: R2Bucket;
  EMAIL_QUEUE?: Queue<EmailQueueMessage>;
  CF_WORKER_SHARED_SECRET: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  FIREBASE_PROJECT_ID?: string;
  FIRESTORE_DATABASE_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
}

export interface EmailQueueMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const SAFE_KEY_REGEX = /^[a-zA-Z0-9._\-]{1,200}$/;
const ALLOWED_MIME = new Set(['application/pdf', 'video/mp4', 'video/webm']);
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isAuthorized(request: Request, env: Env): boolean {
  const secret = env.CF_WORKER_SHARED_SECRET;
  if (!secret || secret.length < 16) return false;
  const provided = request.headers.get('X-Ijwi-Worker-Secret') || '';
  return constantTimeEqual(provided, secret);
}

async function sendViaResend(msg: EmailQueueMessage, env: Env): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log('Resend not configured; email logged:', msg.to, msg.subject);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'Ijwi <noreply@mail.ijwi.me>',
      reply_to: env.EMAIL_REPLY_TO || 'learn@ijwi.me',
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend failed (${res.status}): ${errText}`);
  }
}

// Create Google OAuth2 access token from Service Account for Firestore REST API (Cron jobs)
async function getGoogleAccessToken(env: Env): Promise<string | null> {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const claim = btoa(
    JSON.stringify({
      iss: env.FIREBASE_CLIENT_EMAIL,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binaryDer = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const unsigned = `${header}.${claim}`;
  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  if (!tokenRes.ok) return null;
  const json = (await tokenRes.json()) as { access_token?: string };
  return json.access_token || null;
}

async function runScheduledJobs(cron: string, env: Env): Promise<void> {
  const accessToken = await getGoogleAccessToken(env);
  if (!accessToken || !env.FIREBASE_PROJECT_ID) {
    console.log('Cron skipped: Firebase service account not configured on Worker.');
    return;
  }

  const dbId = env.FIRESTORE_DATABASE_ID || '(default)';
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/${dbId}/documents`;

  // Hourly check: expire overdue unpaid invoices
  const invRes = await fetch(`${base}:runQuery`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'portal_invoices' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'status' },
            op: 'EQUAL',
            value: { stringValue: 'unpaid' },
          },
        },
        limit: 100,
      },
    }),
  });

  if (invRes.ok) {
    const rows = (await invRes.json()) as Array<{
      document?: { name: string; fields?: Record<string, { stringValue?: string }> };
    }>;
    const nowMs = Date.now();
    for (const row of rows) {
      const doc = row.document;
      if (!doc?.fields) continue;
      const dueAt = doc.fields.dueAt?.stringValue;
      if (dueAt && nowMs > Date.parse(dueAt)) {
        await fetch(`https://firestore.googleapis.com/v1/${doc.name}?updateMask.fieldPaths=status`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: { status: { stringValue: 'expired' } } }),
        });
      }
    }
  }

  // Weekly Monday digest (0 6 * * 1)
  if (cron === '0 6 * * 1' && env.EMAIL_QUEUE) {
    console.log('Weekly Monday digest cron triggered.');
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, r2Bound: Boolean(env.R2_BUCKET) });
    }

    if (!isAuthorized(request, env)) {
      return Response.json({ error: 'Unauthorized worker call.' }, { status: 401 });
    }

    // R2 Object operations: /r2/objects/:key
    if (url.pathname.startsWith('/r2/objects/')) {
      const key = decodeURIComponent(url.pathname.slice('/r2/objects/'.length));
      if (!SAFE_KEY_REGEX.test(key)) {
        return Response.json({ error: 'Invalid object key.' }, { status: 400 });
      }

      if (request.method === 'PUT') {
        const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
        if (!ALLOWED_MIME.has(contentType)) {
          return Response.json({ error: 'Unsupported MIME type.' }, { status: 400 });
        }
        const buf = await request.arrayBuffer();
        if (buf.byteLength === 0 || buf.byteLength > MAX_UPLOAD_BYTES) {
          return Response.json({ error: 'Invalid file size.' }, { status: 400 });
        }
        await env.R2_BUCKET.put(key, buf, { httpMetadata: { contentType } });
        return Response.json({ ok: true, key, sizeBytes: buf.byteLength });
      }

      if (request.method === 'HEAD') {
        const head = await env.R2_BUCKET.head(key);
        if (!head) return Response.json({ error: 'Not found' }, { status: 404 });
        return new Response(null, {
          status: 200,
          headers: {
            'Content-Length': String(head.size),
            'Content-Type':
              head.httpMetadata?.contentType ||
              (key.endsWith('.pdf')
                ? 'application/pdf'
                : key.endsWith('.webm')
                  ? 'video/webm'
                  : 'video/mp4'),
          },
        });
      }

      if (request.method === 'GET') {
        const rangeHeader = request.headers.get('Range');
        let object: R2ObjectBody | null = null;
        let status = 200;
        const headers = new Headers();

        if (rangeHeader) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
          if (!match) {
            return new Response('Invalid Range', { status: 416 });
          }
          const head = await env.R2_BUCKET.head(key);
          if (!head) return Response.json({ error: 'Not found' }, { status: 404 });

          const start = Number(match[1]);
          const end = match[2] ? Math.min(Number(match[2]), head.size - 1) : head.size - 1;
          if (start >= head.size || start > end) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${head.size}` },
            });
          }
          const length = end - start + 1;
          object = await env.R2_BUCKET.get(key, { range: { offset: start, length } });
          if (!object) return Response.json({ error: 'Not found' }, { status: 404 });
          status = 206;
          headers.set('Content-Range', `bytes ${start}-${end}/${head.size}`);
          headers.set('Content-Length', String(length));
        } else {
          object = await env.R2_BUCKET.get(key);
          if (!object) return Response.json({ error: 'Not found' }, { status: 404 });
          headers.set('Content-Length', String(object.size));
        }

        headers.set(
          'Content-Type',
          object.httpMetadata?.contentType ||
            (key.endsWith('.pdf')
              ? 'application/pdf'
              : key.endsWith('.webm')
                ? 'video/webm'
                : 'video/mp4')
        );
        headers.set('Content-Disposition', 'inline');
        headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('Accept-Ranges', 'bytes');

        return new Response(object.body, { status, headers });
      }

      if (request.method === 'DELETE') {
        await env.R2_BUCKET.delete(key);
        return Response.json({ ok: true });
      }
    }

    // Enqueue Resend email via Cloudflare Queue
    if (url.pathname === '/emails/enqueue' && request.method === 'POST') {
      const payload = (await request.json()) as EmailQueueMessage;
      if (!payload.to || !payload.subject || (!payload.html && !payload.text)) {
        return Response.json({ error: 'Invalid email message.' }, { status: 400 });
      }
      if (env.EMAIL_QUEUE) {
        await env.EMAIL_QUEUE.send(payload);
        return Response.json({ status: 'queued' });
      }
      await sendViaResend(payload, env);
      return Response.json({ status: env.RESEND_API_KEY ? 'sent' : 'logged' });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },

  async queue(batch: MessageBatch<EmailQueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await sendViaResend(message.body, env);
        message.ack();
      } catch (err) {
        console.error('Queue email retry scheduled:', err);
        message.retry();
      }
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledJobs(controller.cron, env));
  },
};
