# Ijwi Portal

Ijwi Portal is the enrolment, Pesapal payment, teacher booking, protected resource streaming, study circle, and progress platform for Kinyarwanda learners at **Ijwi**.

## Stack
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS v4 (Fraunces + DM Sans, light palette), React Router, TanStack Query, `pdfjs-dist` (canvas PDF rendering), `jspdf` (invoice/receipt PDFs), `qrcode`.
- **Backend API**: Express (`server.ts`) verifying Firebase ID tokens via Google JWKS (`jose`), authoritative server-side pricing (`/api/pricing/quote`), Pesapal API v3 (`/api/payments/pesapal/*`), Resend email dispatch (`/api/emails/dispatch`), private resource upload/streaming with HTTP `Range` support (`/api/resources/*`), and `.ics` calendar export.
- **Database & Auth**: Firebase Auth (Google) + Cloud Firestore (`firebase-applet-config.json`), hardened Eight-Pillars `firestore.rules` + `firestore.indexes.json`.

## Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in optional integration secrets (`PESAPAL_CONSUMER_KEY`, `PESAPAL_CONSUMER_SECRET`, `RESEND_API_KEY`). Without Pesapal keys, the portal runs in `sandbox_demo` mode so you can test the full payment and activation flow immediately.
3. Run the full-stack server on port `3000`:
   ```bash
   npm run dev
   ```
4. Run unit tests:
   ```bash
   npm test
   ```

## Security & Resource Streaming Notes
- Firestore rules reject unverified emails, privilege escalation, shadow fields, and blanket list scraping.
- Uploaded PDFs and videos are stored privately outside the public webroot and streamed via short-lived HMAC tickets with `Content-Disposition: inline`, `Cache-Control: private, no-store`, and viewer email watermarks.
- As noted in Admin > Settings & Help, this prevents casual downloading and link sharing, while screen recording remains outside browser control.
