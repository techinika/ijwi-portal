# Ijwi Portal

Ijwi Portal is the enrolment, Pesapal payment, teacher booking, protected resource streaming, study circle, and progress platform for Kinyarwanda learners at **Ijwi**.

## Architecture
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS v4 (Fraunces + DM Sans, light palette), React Router, TanStack Query, `pdfjs-dist` (canvas PDF rendering), `jspdf` (invoice/receipt PDFs), `qrcode`.
- **Web Server / API**: Express (`server.ts`) verifying Firebase ID tokens via Google JWKS (`jose`), authoritative server-side pricing (`/api/pricing/quote`), Pesapal API v3 (`/api/payments/pesapal/*`), signed media stream tickets (`/api/resources/*`), and `.ics` calendar export.
- **Database & Auth**: Firebase Auth (Google) + Cloud Firestore (`firebase-applet-config.json` or `VITE_FIREBASE_*` overrides), hardened Eight-Pillars `firestore.rules` + `firestore.indexes.json`.
- **Cloudflare Worker (`/worker`)**: Handles private **Cloudflare R2** uploads and HTTP `Range` streaming, **Cloudflare Queue** retries for Resend emails, and **Cloudflare Cron Triggers** for hourly invoice expiry/reminders and Monday progress digests.

## Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in optional integration secrets (`PESAPAL_CONSUMER_KEY`, `PESAPAL_CONSUMER_SECRET`, `RESEND_API_KEY`, `CF_WORKER_URL`, `CF_WORKER_SHARED_SECRET`). Without Pesapal keys, the portal runs in `sandbox_demo` mode so you can test the full payment and activation flow immediately.
3. Run the full-stack server on port `3000`:
   ```bash
   npm run dev
   ```
4. Run unit tests:
   ```bash
   npm test
   ```

## Deploying the Cloudflare Worker (R2, Queues & Cron)

### Option A — No CLI (Cloudflare Dashboard Git Integration)
1. Push this repo to GitHub.
2. In **Cloudflare Dashboard → Workers & Pages → Create → Import a repository**:
   - Select your repo and set **Root directory** to `worker` and **Deploy command** to `npx wrangler deploy`.
3. In **R2 Object Storage**, create a private bucket named `ijwi-portal-private`.
4. In **Queues**, create a queue named `ijwi-email-queue`.
5. In your Worker's **Settings → Variables and Secrets**, add:
   - `CF_WORKER_SHARED_SECRET` (random 32+ char secret — copy the same value to Vercel)
   - `RESEND_API_KEY`
   - *(Optional for Cron invoice expiry)* `FIREBASE_CLIENT_EMAIL` & `FIREBASE_PRIVATE_KEY`
6. Copy the deployed `https://ijwi-portal-worker.<subdomain>.workers.dev` URL into `CF_WORKER_URL` in Vercel.

### Option B — One-Command Local Script
```bash
cd worker
bash deploy.sh
```
This installs dependencies, opens `wrangler login`, creates the R2 bucket & queue, prompts for `CF_WORKER_SHARED_SECRET`, and deploys.

### Option C — GitHub Actions
Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in **GitHub Repo → Settings → Secrets and variables → Actions** and run the **Deploy Cloudflare Worker** workflow (`.github/workflows/deploy-worker.yml`).

## Vercel Deployment Notes
- Add all `.env.example` secrets in **Vercel Dashboard → Settings → Environment Variables** (set `INTERNAL_SIGNING_SECRET` to a random 32+ char string).
- Add your Vercel domain (e.g. `your-app.vercel.app`) to **Firebase Console → Authentication → Settings → Authorized domains** for Google Sign-In.
