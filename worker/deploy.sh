#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "1/5 Installing Worker dependencies..."
npm install

echo "2/5 Checking Cloudflare authentication..."
if ! npx wrangler whoami >/dev/null 2>&1; then
  npx wrangler login
fi

echo "3/5 Ensuring R2 bucket (ijwi-portal-private) and Queue (ijwi-email-queue) exist..."
npx wrangler r2 bucket create ijwi-portal-private >/dev/null 2>&1 || echo "  - R2 bucket already exists (ok)"
npx wrangler queues create ijwi-email-queue >/dev/null 2>&1 || echo "  - Email queue already exists (ok)"

echo "4/5 Checking Worker secrets..."
EXISTING_SECRETS=$(npx wrangler secret list 2>/dev/null || true)

if ! echo "$EXISTING_SECRETS" | grep -q "CF_WORKER_SHARED_SECRET"; then
  echo "  -> Setting CF_WORKER_SHARED_SECRET (paste a 32+ char secret; save the same value for Vercel):"
  npx wrangler secret put CF_WORKER_SHARED_SECRET
fi

if ! echo "$EXISTING_SECRETS" | grep -q "RESEND_API_KEY"; then
  read -r -p "Set RESEND_API_KEY now? [y/N] " SET_RESEND
  if [[ "$SET_RESEND" =~ ^[Yy]$ ]]; then
    npx wrangler secret put RESEND_API_KEY
  fi
fi

echo "5/5 Deploying ijwi-portal-worker..."
npx wrangler deploy

echo ""
echo "Done! Set CF_WORKER_URL (the workers.dev URL printed above) and CF_WORKER_SHARED_SECRET in Vercel."
