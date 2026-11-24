export interface DiscountTier {
  min: number;
  max: number;
  pct: number;
}

export const DEFAULT_DISCOUNT_TIERS: DiscountTier[] = [
  { min: 1, max: 1, pct: 0 },
  { min: 2, max: 5, pct: 30 },
  { min: 6, max: 15, pct: 40 },
  { min: 16, max: 10000, pct: 50 },
];

export interface CouponInput {
  code: string;
  type: 'percent' | 'fixed';
  value: number; // percent (1-100) or fixed cents
  active: boolean;
  startsAt?: string;
  endsAt?: string;
  usageLimit?: number;
  usedCount?: number;
  perPersonLimit?: number;
  planId?: string;
}

export interface PriceQuote {
  seats: number;
  unitPriceCents: number;
  subtotalCents: number;
  teamDiscountPct: number;
  teamDiscountCents: number;
  afterTeamCents: number;
  couponCode?: string;
  couponDiscountCents: number;
  totalCents: number;
  totalSavingsCents: number;
  currency: string;
  isTopUp: boolean;
  alreadyPaidCents: number;
  newTotalSeats: number;
}

export function getTeamDiscountPct(
  seats: number,
  tiers: DiscountTier[] = DEFAULT_DISCOUNT_TIERS
): number {
  const safeSeats = Math.max(1, Math.floor(seats));
  for (const tier of tiers) {
    if (safeSeats >= tier.min && safeSeats <= tier.max) {
      return tier.pct;
    }
  }
  return safeSeats >= 16 ? 50 : 0;
}

export function validateCouponForQuote(
  coupon: CouponInput | null | undefined,
  planId: string,
  nowMs: number = Date.now(),
  userRedemptions: number = 0
): { valid: boolean; reason?: string } {
  if (!coupon) {
    return { valid: false, reason: 'Coupon code not found.' };
  }
  if (!coupon.active) {
    return { valid: false, reason: 'This coupon is no longer active.' };
  }
  if (coupon.planId && coupon.planId !== planId) {
    return { valid: false, reason: 'This coupon does not apply to the selected plan.' };
  }
  if (coupon.startsAt && nowMs < Date.parse(coupon.startsAt)) {
    return { valid: false, reason: 'This coupon is not active yet.' };
  }
  if (coupon.endsAt && nowMs > Date.parse(coupon.endsAt)) {
    return { valid: false, reason: 'This coupon has expired.' };
  }
  if (
    typeof coupon.usageLimit === 'number' &&
    typeof coupon.usedCount === 'number' &&
    coupon.usedCount >= coupon.usageLimit
  ) {
    return { valid: false, reason: 'This coupon has reached its usage limit.' };
  }
  if (
    typeof coupon.perPersonLimit === 'number' &&
    userRedemptions >= coupon.perPersonLimit
  ) {
    return { valid: false, reason: 'You have already used this coupon the maximum number of times.' };
  }
  return { valid: true };
}

export function calculateEnrolmentQuote(params: {
  unitPriceCents: number;
  seats: number;
  currency?: string;
  tiers?: DiscountTier[];
  coupon?: CouponInput | null;
  existingSeats?: number;
  alreadyPaidCents?: number;
}): PriceQuote {
  const unitPriceCents = Math.max(0, Math.round(params.unitPriceCents));
  const seats = Math.max(1, Math.floor(params.seats));
  const existingSeats = Math.max(0, Math.floor(params.existingSeats || 0));
  const alreadyPaidCents = Math.max(0, Math.round(params.alreadyPaidCents || 0));
  const isTopUp = existingSeats > 0;
  const newTotalSeats = existingSeats + seats;
  const currency = params.currency || 'USD';

  const subtotalCents = unitPriceCents * newTotalSeats;
  const teamDiscountPct = getTeamDiscountPct(newTotalSeats, params.tiers);
  const fullTeamDiscountCents = Math.round(subtotalCents * (teamDiscountPct / 100));
  const fullAfterTeamCents = Math.max(0, subtotalCents - fullTeamDiscountCents);

  // For top-ups, calculate the incremental cost based on the new total headcount minus already paid
  const incrementalBaseCents = isTopUp
    ? Math.max(0, fullAfterTeamCents - alreadyPaidCents)
    : fullAfterTeamCents;

  const incrementalSubtotalCents = unitPriceCents * seats;
  const incrementalTeamDiscountCents = isTopUp
    ? Math.max(0, incrementalSubtotalCents - incrementalBaseCents)
    : fullTeamDiscountCents;

  let couponDiscountCents = 0;
  let couponCode: string | undefined;

  if (params.coupon && params.coupon.active) {
    couponCode = params.coupon.code.trim().toUpperCase();
    if (params.coupon.type === 'percent') {
      const pct = Math.min(100, Math.max(0, params.coupon.value));
      couponDiscountCents = Math.round(incrementalBaseCents * (pct / 100));
    } else {
      couponDiscountCents = Math.min(incrementalBaseCents, Math.max(0, params.coupon.value));
    }
  }

  const totalCents = Math.max(0, incrementalBaseCents - couponDiscountCents);
  const totalSavingsCents = incrementalTeamDiscountCents + couponDiscountCents;

  return {
    seats,
    unitPriceCents,
    subtotalCents: incrementalSubtotalCents,
    teamDiscountPct,
    teamDiscountCents: incrementalTeamDiscountCents,
    afterTeamCents: incrementalBaseCents,
    couponCode,
    couponDiscountCents,
    totalCents,
    totalSavingsCents,
    currency,
    isTopUp,
    alreadyPaidCents,
    newTotalSeats,
  };
}

export function formatMoney(cents: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function canCancelWithoutPenalty(
  startUtc: string,
  cancelWindowHours: number = 12,
  nowMs: number = Date.now()
): boolean {
  const startMs = Date.parse(startUtc);
  if (Number.isNaN(startMs)) return false;
  return startMs - nowMs >= cancelWindowHours * 60 * 60 * 1000;
}

export function hasBookingConflict(
  candidateStartUtc: string,
  candidateEndUtc: string,
  existingBookings: Array<{ startUtc: string; endUtc: string; status: string }>
): boolean {
  const cStart = Date.parse(candidateStartUtc);
  const cEnd = Date.parse(candidateEndUtc);
  if (Number.isNaN(cStart) || Number.isNaN(cEnd) || cEnd <= cStart) return true;

  return existingBookings.some((b) => {
    if (b.status === 'cancelled' || b.status === 'late_cancel') return false;
    const bStart = Date.parse(b.startUtc);
    const bEnd = Date.parse(b.endUtc);
    return cStart < bEnd && cEnd > bStart;
  });
}

export function normalizeOrganisationName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/,\s*(inc|ltd|llc|sarl)\.?$/i, '')
    .trim();
}
