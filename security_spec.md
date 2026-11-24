# Ijwi Portal Firestore Security Specification

## 1. Data Invariants
1. **Identity & Role Integrity**: A user document in `users/{uid}` can only be created for `request.auth.uid` with `role == 'student'` and `accessActive == false` (unless bootstrap admin `kiny.study@gmail.com` with verified email). Non-admins cannot escalate `role`, `accessActive`, or `status`.
2. **PII Isolation**: User emails and invoices are readable only by their owner (`uid == request.auth.uid` / `payerId == request.auth.uid`), assigned teacher (for non-billing student profile), or admin. Public certificate verification (`/portal_certificates/{certCode}`) exposes only `learnerName`, `levelName`, `planName`, and `issuedAt` (no email, phone, or UID list queries).
3. **Immutable Invoice Snapshots**: Once created, `unitPriceCents`, `subtotalCents`, `teamDiscountPct`, `teamDiscountCents`, `couponDiscountCents`, `totalCents`, and `payerId` cannot be altered by students. Terminal states (`void`, `refunded`) cannot transition back to `paid` or `unpaid` by non-admins.
4. **Booking Integrity**: Only verified, active-access students may create bookings for their own `studentId`, and only the student (before cancel window) or assigned teacher/admin may update booking status.
5. **Resource Protection**: Firestore stores only metadata (`fileKey`, `title`, `level`, `topic`). Binary files are never publicly addressable and are streamed strictly through `/api/resources/:id/stream` after server-side Firebase token + paid-access verification.
6. **Zero Unbounded Lists & Strict Keys**: Every collection validates `hasAll` + `hasOnly`, string `.size()` limits, bounded array `.size()`, `isValidId()` on document path variables, and `request.time` on `createdAt`/`updatedAt`.

## 2. Dirty Dozen Payloads (Must All Return PERMISSION_DENIED)
1. **Privilege Escalation on Signup**: `create /users/{uid}` with `role: "admin"` or `accessActive: true` by a non-bootstrap user -> `PERMISSION_DENIED`.
2. **Self-Activation Update**: `update /users/{uid}` by student changing `accessActive: true` or `role: "teacher"` -> `PERMISSION_DENIED`.
3. **Shadow Field Injection**: `create /portal_bookings/{id}` with extra ghost field `isFree: true` -> `PERMISSION_DENIED`.
4. **Invoice Price Tampering**: `update /portal_invoices/{id}` by payer changing `totalCents: 100` -> `PERMISSION_DENIED`.
5. **Cross-Tenant Invoice Read**: `get /portal_invoices/{otherId}` where `payerId != request.auth.uid` by a student -> `PERMISSION_DENIED`.
6. **Unverified Email Write**: Any write where `request.auth.token.email_verified == false` -> `PERMISSION_DENIED`.
7. **Admin Spoof via Unverified Email**: Request with `email == 'kiny.study@gmail.com'` and `email_verified: false` -> `PERMISSION_DENIED`.
8. **ID Poisoning**: `create /portal_sessions/{longOrInvalidId}` with 200-char ID or `/` characters -> `PERMISSION_DENIED`.
9. **Resource Exhaustion String**: `create /portal_sessions/{id}` with `title` > 160 chars -> `PERMISSION_DENIED`.
10. **Blanket List Scraping**: `list /users` or `list /portal_invoices` by a non-admin student without owner constraint -> `PERMISSION_DENIED`.
11. **Terminal State Reopen**: `update /portal_invoices/{id}` by non-admin when `existing().status == 'refunded'` -> `PERMISSION_DENIED`.
12. **Teacher Feedback Snooping**: `get /portal_feedback/{id}` or `list /portal_feedback` by a teacher (feedback is admin-only after creation by student) -> `PERMISSION_DENIED`.
