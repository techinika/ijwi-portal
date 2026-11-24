import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { Check, ArrowRight, Users, User } from 'lucide-react';
import { db } from '../lib/firebase';
import { fetchPublicPlans } from '../lib/seed';
import { apiFetch } from '../lib/api';
import { createEnrolmentInvoice } from '../lib/portalActions';
import { savePendingEnrolment, useAuth } from '../contexts/AuthContext';
import {
  calculateEnrolmentQuote,
  formatMoney,
  type CouponInput,
  type PriceQuote,
} from '../shared/pricing';
import type { PortalCoupon, PortalPlan } from '../types/portal';

export function HomePage() {
  const { portalUser, firebaseUser, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ['public_plans'],
    queryFn: fetchPublicPlans,
  });

  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [mode, setMode] = useState<'individual' | 'team'>('individual');
  const [seats, setSeats] = useState<number>(4);
  const [ownerIsLearner, setOwnerIsLearner] = useState<boolean>(true);
  const [organisation, setOrganisation] = useState<string>('');
  const [couponInput, setCouponInput] = useState<string>('');
  const [appliedCoupon, setAppliedCoupon] = useState<CouponInput | null>(null);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [serverQuoteState, setServerQuoteState] = useState<{
    key: string;
    quote: PriceQuote;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPlan: PortalPlan | undefined =
    plans.find((p) => p.id === selectedPlanId) || plans[0];

  const effectiveSeats = mode === 'individual' ? 1 : Math.max(2, seats);

  const localQuote = useMemo<PriceQuote | null>(() => {
    if (!selectedPlan) return null;
    return calculateEnrolmentQuote({
      unitPriceCents: selectedPlan.unitPriceCents,
      seats: effectiveSeats,
      currency: selectedPlan.currency,
      coupon: appliedCoupon,
    });
  }, [selectedPlan, effectiveSeats, appliedCoupon]);

  const quoteKey = selectedPlan
    ? `${selectedPlan.id}:${selectedPlan.unitPriceCents}:${effectiveSeats}:${appliedCoupon?.code || ''}`
    : '';

  const quote: PriceQuote | null =
    serverQuoteState && serverQuoteState.key === quoteKey
      ? serverQuoteState.quote
      : localQuote;

  useEffect(() => {
    if (!selectedPlanId && plans.length > 0) {
      setSelectedPlanId(plans[0].id);
    }
  }, [plans, selectedPlanId]);

  useEffect(() => {
    if (!selectedPlan) return;
    let cancelled = false;
    const currentKey = `${selectedPlan.id}:${selectedPlan.unitPriceCents}:${effectiveSeats}:${appliedCoupon?.code || ''}`;

    apiFetch<{ quote: PriceQuote; couponError?: string }>('/api/pricing/quote', {
      method: 'POST',
      body: JSON.stringify({
        planId: selectedPlan.id,
        unitPriceCents: selectedPlan.unitPriceCents,
        seats: effectiveSeats,
        currency: selectedPlan.currency,
        coupon: appliedCoupon,
      }),
    })
      .then((res) => {
        if (!cancelled) {
          setServerQuoteState({ key: currentKey, quote: res.quote });
          if (res.couponError) setCouponMessage(res.couponError);
        }
      })
      .catch(() => {
        // Local calculation remains rendered cleanly if API server is unreachable
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPlan, effectiveSeats, appliedCoupon]);

  async function handleApplyCoupon() {
    setCouponMessage(null);
    const code = couponInput.trim().toUpperCase();
    if (!code) {
      setAppliedCoupon(null);
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'portal_coupons', code));
      if (!snap.exists()) {
        setAppliedCoupon(null);
        setCouponMessage('Coupon code not found.');
        return;
      }
      const data = snap.data() as PortalCoupon;
      setAppliedCoupon({
        code: data.code,
        type: data.type,
        value: data.value,
        active: data.active,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        usageLimit: data.usageLimit,
        usedCount: data.usedCount,
        perPersonLimit: data.perPersonLimit,
        planId: data.planId,
      });
      setCouponMessage(
        data.active
          ? `Coupon ${data.code} applied (${data.type === 'percent' ? `${data.value}% off` : formatMoney(data.value)}).`
          : 'This coupon is inactive.'
      );
    } catch {
      setCouponMessage('Sign in first or check the code spelling.');
    }
  }

  async function handleProceed() {
    if (!selectedPlan || !quote) return;
    setError(null);
    setSubmitting(true);

    try {
      if (!portalUser && !firebaseUser) {
        savePendingEnrolment({
          plan: selectedPlan,
          mode,
          seats: effectiveSeats,
          ownerIsLearner: mode === 'individual' ? true : ownerIsLearner,
          organisation: organisation.trim() || undefined,
          couponCode: appliedCoupon?.code,
          quote,
        });
        const signedInProfile = await signInWithGoogle();
        if (signedInProfile) {
          const pendingStillQueued = sessionStorage.getItem('ijwi_pending_enrolment');
          if (!pendingStillQueued) {
            return;
          }
        }
        return;
      }

      const activeUser =
        portalUser ||
        ({
          uid: firebaseUser!.uid,
          email: firebaseUser!.email || '',
          displayName: firebaseUser!.displayName || firebaseUser!.email?.split('@')[0] || 'Learner',
          role: 'student',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          status: 'active',
          accessActive: false,
        } as const);

      const { invoiceId } = await createEnrolmentInvoice({
        user: activeUser,
        plan: selectedPlan,
        mode,
        seats: effectiveSeats,
        ownerIsLearner: mode === 'individual' ? true : ownerIsLearner,
        organisation: organisation.trim() || undefined,
        couponCode: appliedCoupon?.code,
        quote,
      });
      navigate(`/invoices/${invoiceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start enrolment.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white">
      {/* Hero section — 2-column balanced split */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-12 sm:pt-14 sm:pb-16">
        <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
          <div className="lg:col-span-7 flex flex-col justify-center">
            <p className="text-sm font-medium text-[#0E7C7B] mb-3">
              Muraho · Kinyarwanda Classes at Ijwi
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold text-[#084F4E] tracking-tight leading-[1.12] [text-wrap:balance] mb-5">
              Learn Kinyarwanda with a dedicated teacher and warm study circle.
            </h1>
            <p className="text-base sm:text-lg text-[#3F4F4F] leading-relaxed max-w-xl mb-8">
              Choose your plan below, enrol for yourself or your team, and receive an instant invoice you can pay now or later from your profile.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <a
                href="#enrol"
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] transition-colors"
              >
                <span>Start enrolment</span>
                <ArrowRight className="w-4 h-4" />
              </a>
              <span className="text-sm text-[#3F4F4F]">
                From $40 per person · Team discounts up to 50%
              </span>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="h-full min-h-[260px] rounded-[24px] overflow-hidden border border-[#084F4E]/10 bg-[#E6F4F4]">
              <img
                src="/src/assets/images/hero_kinyarwanda_study_1795519553630.jpg"
                alt="Sunlit study desk overlooking green Rwandan hills with Kinyarwanda notes"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Enrolment Flow */}
      <section id="enrol" className="border-t border-[#084F4E]/10 bg-[#FAFBFB] py-12 sm:py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-12 gap-8 items-start">
            {/* Left 7 columns: Steps 1 to 3 */}
            <div className="lg:col-span-7 space-y-8">
              {/* Step 1: Plan selection */}
              <div id="plans" className="rounded-[20px] border border-[#084F4E]/12 bg-white p-6 sm:p-8">
                <p className="text-xs font-semibold text-[#0E7C7B] mb-1">Step 1</p>
                <h2 className="font-display text-2xl font-semibold text-[#084F4E] mb-5">
                  Choose your learning plan
                </h2>

                {plansLoading ? (
                  <div className="h-44 rounded-2xl bg-[#E6F4F4]/50 animate-pulse" />
                ) : (
                  <div className="space-y-4">
                    {plans.map((plan) => {
                      const active = selectedPlan?.id === plan.id;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setSelectedPlanId(plan.id)}
                          className={`w-full text-left rounded-2xl border p-6 transition-colors ${
                            active
                              ? 'border-[#084F4E] bg-[#E6F4F4]/45'
                              : 'border-[#084F4E]/15 bg-white hover:border-[#0E7C7B]/50'
                          }`}
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                            <h3 className="font-display text-xl font-semibold text-[#084F4E]">
                              {plan.name}
                            </h3>
                            <span className="text-xl font-semibold text-[#084F4E] tabular-nums">
                              {formatMoney(plan.unitPriceCents, plan.currency)}{' '}
                              <span className="text-sm font-normal text-[#3F4F4F]">/ person</span>
                            </span>
                          </div>
                          <p className="text-sm text-[#3F4F4F] mb-4 leading-relaxed">
                            {plan.description}
                          </p>
                          <ul className="grid sm:grid-cols-2 gap-2 text-sm text-[#1F2A2A]">
                            {plan.included.map((item) => (
                              <li key={item} className="flex items-start gap-2">
                                <Check className="w-4 h-4 text-[#0E7C7B] shrink-0 mt-0.5" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Step 2: Individual or Team */}
              <div id="team-pricing" className="rounded-[20px] border border-[#084F4E]/12 bg-white p-6 sm:p-8">
                <p className="text-xs font-semibold text-[#0E7C7B] mb-1">Step 2</p>
                <h2 className="font-display text-2xl font-semibold text-[#084F4E] mb-5">
                  Who is enrolling?
                </h2>

                <div className="grid sm:grid-cols-2 gap-3 mb-6">
                  <button
                    type="button"
                    onClick={() => setMode('individual')}
                    className={`flex items-center gap-3 p-4 rounded-2xl border text-left transition-colors ${
                      mode === 'individual'
                        ? 'border-[#084F4E] bg-[#E6F4F4]/50 text-[#084F4E]'
                        : 'border-[#084F4E]/15 text-[#3F4F4F] hover:border-[#0E7C7B]/40'
                    }`}
                  >
                    <User className="w-5 h-5 shrink-0" />
                    <div>
                      <div className="font-semibold text-sm">Just me</div>
                      <div className="text-xs text-[#3F4F4F]">
                        Assigned a teacher &amp; study group (up to 8)
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setMode('team')}
                    className={`flex items-center gap-3 p-4 rounded-2xl border text-left transition-colors ${
                      mode === 'team'
                        ? 'border-[#084F4E] bg-[#E6F4F4]/50 text-[#084F4E]'
                        : 'border-[#084F4E]/15 text-[#3F4F4F] hover:border-[#0E7C7B]/40'
                    }`}
                  >
                    <Users className="w-5 h-5 shrink-0" />
                    <div>
                      <div className="font-semibold text-sm">A team</div>
                      <div className="text-xs text-[#3F4F4F]">
                        Save 30%–50% · Invite members later
                      </div>
                    </div>
                  </button>
                </div>

                {mode === 'team' && (
                  <div className="space-y-5 pt-2 border-t border-[#084F4E]/10">
                    <div>
                      <label
                        htmlFor="team-seats"
                        className="block text-sm font-medium text-[#1F2A2A] mb-2"
                      >
                        Number of people to enrol
                      </label>
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          id="team-seats"
                          type="number"
                          min={2}
                          max={500}
                          value={seats}
                          onChange={(e) =>
                            setSeats(Math.max(2, Math.min(500, Number(e.target.value) || 2)))
                          }
                          className="w-32 px-4 py-2.5 rounded-xl border border-[#084F4E]/20 text-base font-semibold tabular-nums text-[#084F4E]"
                        />
                        <div className="flex items-center gap-2 text-xs text-[#3F4F4F]">
                          {[4, 8, 20].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setSeats(preset)}
                              className={`px-3 py-1.5 rounded-lg border text-xs font-medium tabular-nums transition-colors ${
                                seats === preset
                                  ? 'border-[#084F4E] bg-[#084F4E] text-white'
                                  : 'border-[#084F4E]/15 text-[#3F4F4F] hover:bg-[#E6F4F4]'
                              }`}
                            >
                              {preset} seats
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-[#3F4F4F] mt-2">
                        Team discounts: 2–5 seats save 30% · 6–15 seats save 40% · 16+ seats save 50%.
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <span className="block text-sm font-medium text-[#1F2A2A]">
                          I am one of the learners
                        </span>
                        <span className="text-xs text-[#3F4F4F]">
                          Choose No if you are paying on behalf of a team only.
                        </span>
                      </div>
                      <div className="flex items-center gap-1 p-1 rounded-xl bg-[#E6F4F4]">
                        <button
                          type="button"
                          onClick={() => setOwnerIsLearner(true)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            ownerIsLearner ? 'bg-[#084F4E] text-white' : 'text-[#3F4F4F]'
                          }`}
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setOwnerIsLearner(false)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            !ownerIsLearner ? 'bg-[#084F4E] text-white' : 'text-[#3F4F4F]'
                          }`}
                        >
                          No
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 3: Organisation & Coupon */}
              <div className="rounded-[20px] border border-[#084F4E]/12 bg-white p-6 sm:p-8 space-y-5">
                <div>
                  <p className="text-xs font-semibold text-[#0E7C7B] mb-1">Step 3</p>
                  <h2 className="font-display text-2xl font-semibold text-[#084F4E]">
                    Optional details
                  </h2>
                </div>

                <div>
                  <label
                    htmlFor="org-name"
                    className="block text-sm font-medium text-[#1F2A2A] mb-1.5"
                  >
                    Are you part of an organisation or company? (optional)
                  </label>
                  <input
                    id="org-name"
                    type="text"
                    maxLength={120}
                    placeholder="e.g. Kigali Health Partners"
                    value={organisation}
                    onChange={(e) => setOrganisation(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#084F4E]/20 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="coupon-code"
                    className="block text-sm font-medium text-[#1F2A2A] mb-1.5"
                  >
                    Coupon code (optional)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="coupon-code"
                      type="text"
                      maxLength={40}
                      placeholder="e.g. MURAHO10"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-[#084F4E]/20 text-sm uppercase"
                    />
                    <button
                      type="button"
                      onClick={() => void handleApplyCoupon()}
                      className="px-4 py-2.5 rounded-xl border border-[#084F4E]/25 text-sm font-medium text-[#084F4E] hover:bg-[#E6F4F4] transition-colors whitespace-nowrap shrink-0"
                    >
                      Apply
                    </button>
                  </div>
                  {couponMessage && (
                    <p className="text-xs text-[#0E7C7B] mt-2">{couponMessage}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Right 5 columns: Sticky Summary & Primary CTA */}
            <div className="lg:col-span-5 lg:sticky lg:top-24">
              <div className="rounded-[24px] border border-[#084F4E]/15 bg-white p-6 sm:p-8 shadow-sm">
                <h2 className="font-display text-2xl font-semibold text-[#084F4E] mb-4">
                  Enrolment summary
                </h2>

                {selectedPlan && quote ? (
                  <div className="space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-[#3F4F4F]">Plan</span>
                      <span className="font-medium text-[#1F2A2A] text-right">
                        {selectedPlan.name}
                      </span>
                    </div>

                    <div className="flex justify-between text-sm tabular-nums">
                      <span className="text-[#3F4F4F]">
                        {quote.seats} {quote.seats === 1 ? 'person' : 'people'} ×{' '}
                        {formatMoney(quote.unitPriceCents, quote.currency)}
                      </span>
                      <span className="font-medium text-[#1F2A2A]">
                        {formatMoney(quote.subtotalCents, quote.currency)}
                      </span>
                    </div>

                    {quote.teamDiscountCents > 0 && (
                      <div className="flex justify-between text-sm text-[#0E7C7B] tabular-nums">
                        <span>Team discount ({quote.teamDiscountPct}%)</span>
                        <span>-{formatMoney(quote.teamDiscountCents, quote.currency)}</span>
                      </div>
                    )}

                    {quote.couponDiscountCents > 0 && (
                      <div className="flex justify-between text-sm text-[#0E7C7B] tabular-nums">
                        <span>Coupon ({quote.couponCode})</span>
                        <span>-{formatMoney(quote.couponDiscountCents, quote.currency)}</span>
                      </div>
                    )}

                    <div className="border-t border-[#084F4E]/12 pt-4 flex items-baseline justify-between">
                      <span className="text-base font-semibold text-[#1F2A2A]">Total</span>
                      <span className="font-display text-3xl font-semibold text-[#084F4E] tabular-nums">
                        {formatMoney(quote.totalCents, quote.currency)}
                      </span>
                    </div>

                    {quote.totalSavingsCents > 0 && (
                      <div className="rounded-xl bg-[#E8C97A]/25 border border-[#C9A84C]/35 px-4 py-2.5 text-xs font-medium text-[#084F4E] tabular-nums">
                        You save {formatMoney(quote.totalSavingsCents, quote.currency)} on this enrolment.
                      </div>
                    )}

                    {error && (
                      <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-800">
                        {error}
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleProceed()}
                      className="w-full py-3.5 px-5 rounded-2xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] transition-colors disabled:opacity-60"
                    >
                      {submitting
                        ? 'Creating your invoice...'
                        : portalUser || firebaseUser
                          ? 'Create invoice & continue'
                          : 'Continue with Google'}
                    </button>

                    <p className="text-xs text-[#3F4F4F] text-center leading-relaxed">
                      Final amounts are calculated on our server. Your invoice can be paid immediately or saved in your profile.
                    </p>
                  </div>
                ) : (
                  <div className="h-48 rounded-2xl bg-[#FAFBFB] animate-pulse" />
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
