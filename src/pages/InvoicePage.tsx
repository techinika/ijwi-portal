import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { Download, CreditCard, CheckCircle2, ArrowRight, RefreshCw } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { apiFetch } from '../lib/api';
import { activatePaidInvoice, createEnrolmentInvoice } from '../lib/portalActions';
import { downloadInvoicePdf } from '../lib/pdfInvoice';
import { useAuth } from '../contexts/AuthContext';
import { formatMoney, calculateEnrolmentQuote } from '../shared/pricing';
import { DEFAULT_PLANS } from '../lib/seed';
import type { PortalInvoice } from '../types/portal';

export function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { portalUser } = useAuth();
  const [invoice, setInvoice] = useState<PortalInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [sandboxOrder, setSandboxOrder] = useState<{
    trackingId: string;
    merchantRef: string;
  } | null>(null);
  const [sandboxMethod, setSandboxMethod] = useState('MTN Mobile Money');
  const [justPaid, setJustPaid] = useState(false);

  useEffect(() => {
    if (!id || !portalUser) return;
    const ref = doc(db, 'portal_invoices', id);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setInvoice({ id: snap.id, ...(snap.data() as Omit<PortalInvoice, 'id'>) });
        } else {
          setError('Invoice not found.');
        }
        setLoading(false);
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, `portal_invoices/${id}`);
      }
    );
    return () => unsub();
  }, [id, portalUser]);

  // Handle return redirect from Pesapal or sandbox checkout URL
  useEffect(() => {
    const trackingId = searchParams.get('OrderTrackingId');
    const merchantRef = searchParams.get('OrderMerchantReference');
    const checkoutMode = searchParams.get('pesapalCheckout');
    if (checkoutMode === 'sandbox' && trackingId && merchantRef) {
      setSandboxOrder({ trackingId, merchantRef });
      return;
    }

    if (trackingId && merchantRef && invoice && invoice.status === 'unpaid' && portalUser) {
      void verifyAndActivate(trackingId, merchantRef);
    }
  }, [searchParams, invoice, portalUser]);

  async function verifyAndActivate(
    trackingId: string,
    merchantRef: string,
    chosenSandboxMethod?: string
  ) {
    if (!invoice || !portalUser) return;
    setPaying(true);
    setError(null);
    try {
      const verification = await apiFetch<{
        verified: boolean;
        paymentMethod: string;
        trackingId: string;
        merchantRef: string;
      }>('/api/payments/pesapal/verify', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: invoice.id,
          trackingId,
          merchantRef,
          expectedAmountCents: invoice.totalCents,
          expectedCurrency: invoice.currency,
          sandboxMethod: chosenSandboxMethod,
        }),
      });

      if (verification.verified) {
        await activatePaidInvoice({
          invoice,
          payer: portalUser,
          trackingId: verification.trackingId,
          merchantRef: verification.merchantRef,
          paymentMethod: verification.paymentMethod,
        });
        setSandboxOrder(null);
        setJustPaid(true);
        setSearchParams({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to verify payment.');
    } finally {
      setPaying(false);
    }
  }

  async function handleStartPayment() {
    if (!invoice || !portalUser) return;
    setPaying(true);
    setError(null);
    try {
      const res = await apiFetch<{
        mode: string;
        merchantRef: string;
        trackingId: string;
        redirectUrl: string;
      }>('/api/payments/pesapal/order', {
        method: 'POST',
        body: JSON.stringify({
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          amountCents: invoice.totalCents,
          currency: invoice.currency,
          description: `${invoice.planName} (${invoice.seats} seats)`,
          payerEmail: invoice.payerEmail,
          payerName: invoice.payerName,
        }),
      });

      await setDoc(
        doc(db, 'portal_invoices', invoice.id),
        {
          pesapalOrderRef: res.merchantRef,
          pesapalTrackingId: res.trackingId,
          paymentUrl: res.redirectUrl,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (res.mode === 'sandbox_demo') {
        setSandboxOrder({ trackingId: res.trackingId, merchantRef: res.merchantRef });
      } else {
        window.location.href = res.redirectUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start Pesapal payment.');
    } finally {
      setPaying(false);
    }
  }

  async function handleRequestFreshInvoice() {
    if (!invoice || !portalUser) return;
    setPaying(true);
    try {
      const quote = calculateEnrolmentQuote({
        unitPriceCents: invoice.unitPriceCents,
        seats: invoice.seats,
        currency: invoice.currency,
      });
      const plan = DEFAULT_PLANS[0];
      const { invoiceId } = await createEnrolmentInvoice({
        user: portalUser,
        plan: { ...plan, id: invoice.planId, name: invoice.planName },
        mode: invoice.seats > 1 ? 'team' : 'individual',
        seats: invoice.seats,
        ownerIsLearner: invoice.ownerIsLearner,
        organisation: invoice.organisation,
        quote,
        existingTeamId: invoice.teamId,
      });
      window.location.href = `/invoices/${invoiceId}`;
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
        <div className="h-96 rounded-[24px] bg-[#FAFBFB] border border-[#084F4E]/10 animate-pulse" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center">
        <h1 className="font-display text-2xl text-[#084F4E] mb-3">Invoice unavailable</h1>
        <p className="text-sm text-[#3F4F4F] mb-6">{error || 'Please sign in as the invoice owner.'}</p>
        <Link
          to="/"
          className="inline-flex px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-medium"
        >
          Back to enrolment
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-14 space-y-6">
      {justPaid && invoice.status === 'paid' && (
        <div className="rounded-[20px] border border-[#0E7C7B]/30 bg-[#E6F4F4] p-5 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-[#084F4E] shrink-0 mt-0.5" />
            <div>
              <h2 className="font-display text-xl font-semibold text-[#084F4E]">
                Murakoze! Your portal is open
              </h2>
              <p className="text-sm text-[#3F4F4F] mt-1">
                We emailed your receipt and assigned your teacher. You are ready to begin.
              </p>
            </div>
          </div>
          <Link
            to={invoice.teamId ? '/team' : '/dashboard'}
            className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] whitespace-nowrap shrink-0"
          >
            <span>{invoice.teamId ? 'Manage Team' : 'Open Dashboard'}</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}

      <div className="rounded-[24px] border border-[#084F4E]/15 bg-white p-5 sm:p-10 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-6 border-b border-[#084F4E]/10">
          <div>
            <p className="text-xs font-medium text-[#0E7C7B] mb-1">
              Invoice {invoice.number}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#084F4E]">
              {invoice.status === 'paid' ? 'Payment Receipt' : 'Ijwi Enrolment Invoice'}
            </h1>
            <p className="text-sm text-[#3F4F4F] mt-1">
              Status:{' '}
              <strong className="font-semibold text-[#084F4E] capitalize">
                {invoice.status}
              </strong>{' '}
              · Due {new Date(invoice.dueAt).toLocaleDateString()}
            </p>
          </div>

          <button
            type="button"
            onClick={() => downloadInvoicePdf(invoice)}
            className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[#084F4E]/20 text-sm font-medium text-[#084F4E] hover:bg-[#E6F4F4] transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Download PDF</span>
          </button>
        </div>

        {/* Bill To */}
        <div className="grid sm:grid-cols-2 gap-6 py-6 border-b border-[#084F4E]/10 text-sm">
          <div>
            <p className="text-xs font-medium text-[#3F4F4F] mb-1">Bill to</p>
            <p className="font-semibold text-[#1F2A2A]">{invoice.payerName}</p>
            <p className="text-[#3F4F4F]">{invoice.payerEmail}</p>
            {invoice.organisation && (
              <p className="text-[#084F4E] mt-1">{invoice.organisation}</p>
            )}
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-medium text-[#3F4F4F] mb-1">Enrolment type</p>
            <p className="font-semibold text-[#1F2A2A]">
              {invoice.teamId
                ? invoice.isTopUp
                  ? `Team seat top-up (${invoice.seats} seats)`
                  : `Team account (${invoice.seats} seats)`
                : 'Individual learner'}
            </p>
            {invoice.paidAt && (
              <p className="text-[#0E7C7B] mt-1">
                Paid on {new Date(invoice.paidAt).toLocaleDateString()} · {invoice.paymentMethod}
              </p>
            )}
          </div>
        </div>

        {/* Line items */}
        <div className="py-6 space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <div>
              <p className="font-medium text-[#1F2A2A]">{invoice.planName}</p>
              <p className="text-xs text-[#3F4F4F] tabular-nums">
                {invoice.seats} {invoice.seats === 1 ? 'seat' : 'seats'} ×{' '}
                {formatMoney(invoice.unitPriceCents, invoice.currency)}
              </p>
            </div>
            <span className="font-medium text-[#1F2A2A] tabular-nums">
              {formatMoney(invoice.subtotalCents, invoice.currency)}
            </span>
          </div>

          {invoice.teamDiscountCents > 0 && (
            <div className="flex justify-between gap-4 text-[#0E7C7B] tabular-nums">
              <span>Team discount ({invoice.teamDiscountPct}%)</span>
              <span>-{formatMoney(invoice.teamDiscountCents, invoice.currency)}</span>
            </div>
          )}

          {invoice.couponDiscountCents > 0 && (
            <div className="flex justify-between gap-4 text-[#0E7C7B] tabular-nums">
              <span>Coupon ({invoice.couponCode})</span>
              <span>-{formatMoney(invoice.couponDiscountCents, invoice.currency)}</span>
            </div>
          )}

          <div className="pt-4 border-t border-[#084F4E]/15 flex items-baseline justify-between">
            <span className="text-base font-semibold text-[#1F2A2A]">
              {invoice.status === 'paid' ? 'Total Paid' : 'Total Due'}
            </span>
            <span className="font-display text-3xl font-semibold text-[#084F4E] tabular-nums">
              {formatMoney(invoice.totalCents, invoice.currency)}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Sandbox Pesapal Checkout Panel */}
        {sandboxOrder && invoice.status === 'unpaid' && (
          <div className="mb-6 rounded-2xl border border-[#C9A84C]/40 bg-[#E8C97A]/15 p-4 sm:p-5 space-y-4">
            <div>
              <p className="text-xs font-semibold text-[#084F4E]">
                Pesapal API v3 Sandbox Checkout
              </p>
              <p className="text-sm text-[#3F4F4F] mt-1 break-all">
                Order Ref: <span className="font-mono text-xs">{sandboxOrder.merchantRef}</span> ·
                Tracking ID: <span className="font-mono text-xs">{sandboxOrder.trackingId}</span>
              </p>
            </div>
            <div>
              <label
                htmlFor="sandbox-method"
                className="block text-xs font-medium text-[#1F2A2A] mb-1.5"
              >
                Select sandbox payment method
              </label>
              <select
                id="sandbox-method"
                value={sandboxMethod}
                onChange={(e) => setSandboxMethod(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-[#084F4E]/20 bg-white text-sm"
              >
                <option value="MTN Mobile Money">MTN Mobile Money (Rwanda)</option>
                <option value="Airtel Money">Airtel Money</option>
                <option value="Visa / Mastercard">Visa / Mastercard</option>
              </select>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                disabled={paying}
                onClick={() =>
                  void verifyAndActivate(
                    sandboxOrder.trackingId,
                    sandboxOrder.merchantRef,
                    sandboxMethod
                  )
                }
                className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] disabled:opacity-60"
              >
                {paying ? 'Confirming with server...' : 'Confirm Sandbox Payment'}
              </button>
              <button
                type="button"
                onClick={() => setSandboxOrder(null)}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 rounded-xl border border-[#084F4E]/20 text-sm text-[#3F4F4F]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Primary Action */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
          {invoice.status === 'unpaid' && !sandboxOrder && (
            <button
              type="button"
              disabled={paying}
              onClick={() => void handleStartPayment()}
              className="w-full sm:w-auto min-h-[46px] inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] transition-colors disabled:opacity-60"
            >
              <CreditCard className="w-4 h-4" />
              <span>{paying ? 'Preparing payment...' : 'Pay now with Pesapal'}</span>
            </button>
          )}

          {invoice.status === 'expired' && (
            <button
              type="button"
              disabled={paying}
              onClick={() => void handleRequestFreshInvoice()}
              className="w-full sm:w-auto min-h-[46px] inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B]"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Request fresh invoice</span>
            </button>
          )}

          {invoice.status === 'paid' && (
            <Link
              to={invoice.teamId ? '/team' : '/dashboard'}
              className="w-full sm:w-auto min-h-[46px] inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B]"
            >
              <span>{invoice.teamId ? 'Go to Team Workspace' : 'Go to Dashboard'}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          )}

          <Link
            to="/profile"
            className="text-center sm:text-left text-sm font-medium text-[#0E7C7B] hover:underline"
          >
            View all invoices in Profile
          </Link>
        </div>
      </div>
    </div>
  );
}
