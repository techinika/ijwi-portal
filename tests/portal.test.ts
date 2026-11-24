import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEnrolmentQuote,
  canCancelWithoutPenalty,
  getTeamDiscountPct,
  hasBookingConflict,
  validateCouponForQuote,
} from '../src/shared/pricing.ts';

test('discount tiers cover boundary headcounts 1, 2, 5, 6, 15, 16, 20', () => {
  assert.equal(getTeamDiscountPct(1), 0);
  assert.equal(getTeamDiscountPct(2), 30);
  assert.equal(getTeamDiscountPct(5), 30);
  assert.equal(getTeamDiscountPct(6), 40);
  assert.equal(getTeamDiscountPct(15), 40);
  assert.equal(getTeamDiscountPct(16), 50);
  assert.equal(getTeamDiscountPct(20), 50);
});

test('acceptance checklist pricing examples at $40/person', () => {
  const one = calculateEnrolmentQuote({ unitPriceCents: 4000, seats: 1 });
  assert.equal(one.totalCents, 4000); // $40

  const four = calculateEnrolmentQuote({ unitPriceCents: 4000, seats: 4 });
  assert.equal(four.totalCents, 11200); // $112

  const eight = calculateEnrolmentQuote({ unitPriceCents: 4000, seats: 8 });
  assert.equal(eight.totalCents, 19200); // $192

  const twenty = calculateEnrolmentQuote({ unitPriceCents: 4000, seats: 20 });
  assert.equal(twenty.totalCents, 40000); // $400
});

test('coupon applies AFTER team discount', () => {
  const quote = calculateEnrolmentQuote({
    unitPriceCents: 4000,
    seats: 4, // $160 -> 30% team off = $112 (11200 cents)
    coupon: { code: 'MURAHO10', type: 'percent', value: 10, active: true },
  });
  assert.equal(quote.teamDiscountCents, 4800);
  assert.equal(quote.couponDiscountCents, 1120); // 10% of 11200
  assert.equal(quote.totalCents, 10080);
});

test('top-up seats uses new total headcount tier minus already paid', () => {
  // Bought 4 seats ($112 = 11200 cents), adding 4 more -> 8 total seats (40% tier = $192 = 19200 cents)
  // Incremental amount = 19200 - 11200 = 8000 cents ($80)
  const topUp = calculateEnrolmentQuote({
    unitPriceCents: 4000,
    seats: 4,
    existingSeats: 4,
    alreadyPaidCents: 11200,
  });
  assert.equal(topUp.newTotalSeats, 8);
  assert.equal(topUp.teamDiscountPct, 40);
  assert.equal(topUp.totalCents, 8000);
});

test('coupon validation checks active, expiry, plan, and per-person limits', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  assert.equal(
    validateCouponForQuote(
      { code: 'EXPIRED', type: 'percent', value: 10, active: true, endsAt: '2026-11-01T00:00:00Z' },
      'kinyarwanda-core',
      now
    ).valid,
    false
  );
  assert.equal(
    validateCouponForQuote(
      { code: 'PLANONLY', type: 'percent', value: 10, active: true, planId: 'other-plan' },
      'kinyarwanda-core',
      now
    ).valid,
    false
  );
  assert.equal(
    validateCouponForQuote(
      { code: 'ONCE', type: 'percent', value: 10, active: true, perPersonLimit: 1 },
      'kinyarwanda-core',
      now,
      1
    ).valid,
    false
  );
});

test('booking conflict detection and 12-hour cancellation window', () => {
  const existing = [
    { startUtc: '2026-12-01T10:00:00Z', endUtc: '2026-12-01T10:45:00Z', status: 'confirmed' },
    { startUtc: '2026-12-01T12:00:00Z', endUtc: '2026-12-01T12:45:00Z', status: 'cancelled' },
  ];
  assert.equal(
    hasBookingConflict('2026-12-01T10:15:00Z', '2026-12-01T11:00:00Z', existing),
    true
  );
  assert.equal(
    hasBookingConflict('2026-12-01T12:00:00Z', '2026-12-01T12:45:00Z', existing),
    false
  );

  const now = Date.parse('2026-12-01T00:00:00Z');
  assert.equal(canCancelWithoutPenalty('2026-12-01T13:00:00Z', 12, now), true);
  assert.equal(canCancelWithoutPenalty('2026-12-01T06:00:00Z', 12, now), false);
});
