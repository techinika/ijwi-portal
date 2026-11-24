import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { Download, Link2, CheckCircle2, Ban, Megaphone } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import {
  activatePaidInvoice,
  dispatchPortalEmail,
  logAudit,
} from '../lib/portalActions';
import { formatMoney, normalizeOrganisationName } from '../shared/pricing';
import { DEFAULT_PLANS, DEFAULT_SETTINGS, DEFAULT_TEACHERS } from '../lib/seed';
import type {
  LessonFeedback,
  PortalBooking,
  PortalCoupon,
  PortalInvoice,
  PortalPlan,
  PortalSettings,
  PortalTeam,
  PortalUser,
  StudyGroup,
} from '../types/portal';

type AdminTab =
  | 'overview'
  | 'people'
  | 'invoices'
  | 'coupons'
  | 'plans'
  | 'groups'
  | 'comms'
  | 'logs';

export function AdminPage() {
  const { portalUser } = useAuth();
  const [tab, setTab] = useState<AdminTab>('overview');

  const [users, setUsers] = useState<PortalUser[]>([]);
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [coupons, setCoupons] = useState<PortalCoupon[]>([]);
  const [plans, setPlans] = useState<PortalPlan[]>([]);
  const [teams, setTeams] = useState<PortalTeam[]>([]);
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [bookings, setBookings] = useState<PortalBooking[]>([]);
  const [feedbackList, setFeedbackList] = useState<LessonFeedback[]>([]);
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; actorEmail: string; action: string; summary: string }>>([]);
  const [emailLogs, setEmailLogs] = useState<Array<{ id: string; to: string; subject: string; status: string }>>([]);
  const [settings, setSettings] = useState<PortalSettings>(DEFAULT_SETTINGS);

  const [peopleSearch, setPeopleSearch] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('all');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  // Coupon form
  const [cCode, setCCode] = useState('');
  const [cType, setCType] = useState<'percent' | 'fixed'>('percent');
  const [cValue, setCValue] = useState(15);
  const [cLimit, setCLimit] = useState(50);

  // Plan form
  const [pName, setPName] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pPriceUsd, setPPriceUsd] = useState(40);

  // Announcement form
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');

  useEffect(() => {
    if (!portalUser || portalUser.role !== 'admin') return;

    const unsubs = [
      onSnapshot(collection(db, 'users'), (s) =>
        setUsers(s.docs.map((d) => d.data() as PortalUser))
      ),
      onSnapshot(collection(db, 'portal_invoices'), (s) =>
        setInvoices(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalInvoice, 'id'>) })))
      ),
      onSnapshot(collection(db, 'portal_coupons'), (s) =>
        setCoupons(s.docs.map((d) => d.data() as PortalCoupon))
      ),
      onSnapshot(collection(db, 'portal_plans'), (s) =>
        setPlans(s.docs.map((d) => d.data() as PortalPlan))
      ),
      onSnapshot(collection(db, 'portal_teams'), (s) =>
        setTeams(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalTeam, 'id'>) })))
      ),
      onSnapshot(collection(db, 'portal_groups'), (s) =>
        setGroups(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudyGroup, 'id'>) })))
      ),
      onSnapshot(collection(db, 'portal_bookings'), (s) =>
        setBookings(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalBooking, 'id'>) })))
      ),
      onSnapshot(collection(db, 'portal_feedback'), (s) =>
        setFeedbackList(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LessonFeedback, 'id'>) })))
      ),
      onSnapshot(collection(db, 'portal_auditLog'), (s) =>
        setAuditLogs(
          s.docs.map((d) => ({
            id: d.id,
            ...(d.data() as { actorEmail: string; action: string; summary: string }),
          }))
        )
      ),
      onSnapshot(collection(db, 'portal_emailLog'), (s) =>
        setEmailLogs(
          s.docs.map((d) => ({
            id: d.id,
            ...(d.data() as { to: string; subject: string; status: string }),
          }))
        )
      ),
      onSnapshot(doc(db, 'portal_settings', 'portal'), (s) => {
        if (s.exists()) setSettings(s.data() as PortalSettings);
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [portalUser]);

  const filteredUsers = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase();
    return users.filter(
      (u) =>
        !q ||
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.organisation || '').toLowerCase().includes(q)
    );
  }, [users, peopleSearch]);

  const filteredInvoices = useMemo(() => {
    const q = invoiceSearch.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (invoiceStatusFilter !== 'all' && inv.status !== invoiceStatusFilter) return false;
      if (!q) return true;
      return (
        inv.number.toLowerCase().includes(q) ||
        inv.payerName.toLowerCase().includes(q) ||
        inv.payerEmail.toLowerCase().includes(q) ||
        (inv.organisation || '').toLowerCase().includes(q)
      );
    });
  }, [invoices, invoiceStatusFilter, invoiceSearch]);

  const orgSummary = useMemo(() => {
    const map = new Map<string, { name: string; learners: number; paidCents: number }>();
    for (const u of users) {
      if (!u.organisation) continue;
      const clean = normalizeOrganisationName(u.organisation);
      const cur = map.get(clean.toLowerCase()) || { name: clean, learners: 0, paidCents: 0 };
      cur.learners += 1;
      map.set(clean.toLowerCase(), cur);
    }
    for (const inv of invoices) {
      if (inv.status !== 'paid' || !inv.organisation) continue;
      const clean = normalizeOrganisationName(inv.organisation);
      const cur = map.get(clean.toLowerCase()) || { name: clean, learners: 0, paidCents: 0 };
      cur.paidCents += inv.totalCents;
      map.set(clean.toLowerCase(), cur);
    }
    return Array.from(map.values());
  }, [users, invoices]);

  if (!portalUser || portalUser.role !== 'admin') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-2xl text-[#084F4E]">Admin access required</h1>
      </div>
    );
  }

  const paidRevenueCents = invoices
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.totalCents, 0);
  const unpaidCount = invoices.filter((i) => i.status === 'unpaid').length;
  const activeStudents = users.filter((u) => u.accessActive && u.role === 'student').length;
  const lessonsThisWeek = bookings.filter((b) => b.status === 'completed').length;

  async function handleGenerateNewPaymentLink(inv: PortalInvoice) {
    const res = await apiFetch<{
      merchantRef: string;
      trackingId: string;
      redirectUrl: string;
    }>('/api/payments/pesapal/order', {
      method: 'POST',
      body: JSON.stringify({
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        amountCents: inv.totalCents,
        currency: inv.currency,
        description: `${inv.planName} (${inv.seats} seats)`,
        payerEmail: inv.payerEmail,
        payerName: inv.payerName,
      }),
    });

    await updateDoc(doc(db, 'portal_invoices', inv.id), {
      pesapalOrderRef: res.merchantRef,
      pesapalTrackingId: res.trackingId,
      paymentUrl: res.redirectUrl,
      updatedAt: serverTimestamp(),
    });

    await dispatchPortalEmail({
      userId: inv.payerId,
      to: inv.payerEmail,
      recipientName: inv.payerName,
      type: 'new_payment_link',
      subject: `New payment link for invoice ${inv.number}`,
      headline: `Your updated payment link for ${inv.number}`,
      bodyText: `We created a fresh payment link for ${formatMoney(inv.totalCents, inv.currency)}. The previous link has been voided.`,
      ctaLabel: 'Pay Invoice Now',
      ctaUrl: res.redirectUrl,
      essential: true,
    });

    await logAudit({
      actorId: portalUser!.uid,
      actorEmail: portalUser!.email,
      action: 'admin_new_payment_link',
      targetType: 'invoice',
      targetId: inv.id,
      summary: `Generated and emailed new payment link for ${inv.number}`,
    });
    setMessage(`New payment link generated and emailed to ${inv.payerEmail}.`);
  }

  async function handleMarkPaidManual(inv: PortalInvoice) {
    const reason = window.prompt('Reason for manual payment (e.g. Bank transfer ref):');
    if (!reason) return;
    const payer = users.find((u) => u.uid === inv.payerId) || portalUser!;
    await activatePaidInvoice({
      invoice: inv,
      payer,
      trackingId: `MANUAL-${Date.now()}`,
      merchantRef: inv.number,
      paymentMethod: 'Manual (Bank / Cash)',
      manualReason: reason,
    });
    setMessage(`Invoice ${inv.number} marked paid manually.`);
  }

  async function handleRefundInvoice(inv: PortalInvoice) {
    const reason = window.prompt('Refund reason:');
    if (!reason) return;
    await updateDoc(doc(db, 'portal_invoices', inv.id), {
      status: 'refunded',
      refundReason: reason,
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'users', inv.payerId), {
      accessActive: false,
      updatedAt: serverTimestamp(),
    });
    await logAudit({
      actorId: portalUser!.uid,
      actorEmail: portalUser!.email,
      action: 'invoice_refunded',
      targetType: 'invoice',
      targetId: inv.id,
      summary: `Refunded ${inv.number}: ${reason}`,
    });
    setMessage(`Invoice ${inv.number} refunded and access revoked.`);
  }

  function exportInvoicesCsv() {
    const rows = [
      ['Number', 'Payer', 'Email', 'Organisation', 'Seats', 'Total', 'Currency', 'Status'],
      ...filteredInvoices.map((i) => [
        i.number,
        i.payerName,
        i.payerEmail,
        i.organisation || '',
        String(i.seats),
        (i.totalCents / 100).toFixed(2),
        i.currency,
        i.status,
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ijwi-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleCreateCoupon(e: React.FormEvent) {
    e.preventDefault();
    const code = cCode.trim().toUpperCase();
    if (!code) return;
    await setDoc(doc(db, 'portal_coupons', code), {
      code,
      type: cType,
      value: cType === 'fixed' ? cValue * 100 : cValue,
      usageLimit: cLimit,
      usedCount: 0,
      perPersonLimit: 1,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await logAudit({
      actorId: portalUser!.uid,
      actorEmail: portalUser!.email,
      action: 'coupon_created',
      targetType: 'coupon',
      targetId: code,
      summary: `Created coupon ${code} (${cValue}${cType === 'percent' ? '%' : ' USD'})`,
    });
    setCCode('');
    setMessage(`Coupon ${code} created.`);
  }

  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!pName.trim()) return;
    const id = pName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 48);
    await setDoc(doc(db, 'portal_plans', id), {
      id,
      name: pName.trim(),
      description: pDesc.trim() || 'Guided Kinyarwanda plan with teacher support.',
      unitPriceCents: Math.round(pPriceUsd * 100),
      currency: settings.currency || 'USD',
      included: DEFAULT_PLANS[0].included,
      learningPath: DEFAULT_PLANS[0].learningPath,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setPName('');
    setPDesc('');
    setMessage(`Plan ${pName} added.`);
  }

  async function handlePublishAnnouncement(e: React.FormEvent) {
    e.preventDefault();
    if (!annTitle.trim() || !annBody.trim()) return;
    const id = `ann-${Date.now()}`;
    await setDoc(doc(db, 'portal_announcements', id), {
      title: annTitle.trim(),
      body: annBody.trim(),
      audienceType: 'all',
      authorId: portalUser!.uid,
      active: true,
      createdAt: serverTimestamp(),
    });
    await logAudit({
      actorId: portalUser!.uid,
      actorEmail: portalUser!.email,
      action: 'announcement_published',
      targetType: 'announcement',
      targetId: id,
      summary: `Published banner: ${annTitle.trim()}`,
    });
    setAnnTitle('');
    setAnnBody('');
    setMessage('Announcement published across the portal.');
  }

  const weeklyFlierText = `This week at Ijwi: ${activeStudents} active learners, ${users.length} total sign-ups, and ${lessonsThisWeek} completed lessons. ${settings.weeklyFlierNote || ''}`;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-[#084F4E]">
            Admin Console
          </h1>
          <p className="text-sm text-[#3F4F4F]">
            Manage learners, invoices, coupons, plans, teams, announcements, and audit trails.
          </p>
        </div>

        <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-[#E6F4F4]">
          {(
            [
              ['overview', 'Overview'],
              ['people', 'People'],
              ['invoices', 'Invoices'],
              ['coupons', 'Coupons'],
              ['plans', 'Plans'],
              ['groups', 'Teams & Orgs'],
              ['comms', 'Settings & Help'],
              ['logs', 'Audit & Email'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === key ? 'bg-[#084F4E] text-white' : 'text-[#3F4F4F] hover:text-[#084F4E]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div className="rounded-2xl border border-[#0E7C7B]/25 bg-[#E6F4F4] px-5 py-3 text-sm text-[#084F4E]">
          {message}
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: 'Sign-ups', value: String(users.length) },
              { label: 'Paid revenue', value: formatMoney(paidRevenueCents, settings.currency) },
              { label: 'Unpaid invoices', value: String(unpaidCount) },
              { label: 'Active students', value: String(activeStudents) },
              { label: 'Lessons done', value: String(lessonsThisWeek) },
            ].map((k) => (
              <div key={k.label} className="rounded-2xl border border-[#084F4E]/12 bg-white p-5">
                <p className="text-xs text-[#3F4F4F] mb-1">{k.label}</p>
                <p className="font-display text-2xl font-semibold text-[#084F4E] tabular-nums">
                  {k.value}
                </p>
              </div>
            ))}
          </div>

          {/* Weekly Milestone Flier */}
          <section className="rounded-[24px] border border-[#C9A84C]/40 bg-[#FAFBFB] p-6 space-y-3">
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">
              This week at Ijwi (Milestone Flier)
            </h2>
            <p className="text-sm text-[#1F2A2A]">{weeklyFlierText}</p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(weeklyFlierText);
                setMessage('Weekly milestone flier text copied.');
              }}
              className="px-4 py-2 rounded-xl border border-[#084F4E]/20 bg-white text-xs font-semibold text-[#084F4E]"
            >
              Copy flier text
            </button>
          </section>

          {/* Student Ratings (Admin-only) */}
          <section className="rounded-[24px] border border-[#084F4E]/12 bg-white p-6 space-y-3">
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">
              Student lesson ratings (Admin only)
            </h2>
            {feedbackList.length === 0 ? (
              <p className="text-sm text-[#3F4F4F]">No student ratings submitted yet.</p>
            ) : (
              <div className="divide-y divide-[#084F4E]/10">
                {feedbackList.map((f) => (
                  <div key={f.id} className="py-3 text-sm">
                    <p className="font-medium text-[#084F4E]">
                      {f.rating}/5 · {f.studentName} → {f.teacherName}
                    </p>
                    {f.comment && <p className="text-xs text-[#3F4F4F] mt-0.5">{f.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'people' && (
        <section className="space-y-4">
          <input
            type="search"
            placeholder="Search people by name, email, or organisation..."
            value={peopleSearch}
            onChange={(e) => setPeopleSearch(e.target.value)}
            className="w-full max-w-md px-4 py-2.5 rounded-xl border border-[#084F4E]/20 text-sm"
          />

          <div className="rounded-[20px] border border-[#084F4E]/12 bg-white overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#084F4E]/10 text-xs text-[#3F4F4F]">
                <tr>
                  <th className="p-4">Person</th>
                  <th className="p-4">Role</th>
                  <th className="p-4">Access</th>
                  <th className="p-4">Teacher</th>
                  <th className="p-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#084F4E]/10">
                {filteredUsers.map((u) => (
                  <tr key={u.uid}>
                    <td className="p-4">
                      <p className="font-semibold text-[#084F4E]">{u.displayName}</p>
                      <p className="text-xs text-[#3F4F4F]">
                        {u.email}
                        {u.organisation ? ` · ${u.organisation}` : ''}
                      </p>
                      <p className="text-xs text-[#3F4F4F] tabular-nums">
                        No-shows: {u.noShowCount || 0} · Late cancels: {u.lateCancelCount || 0}
                      </p>
                    </td>
                    <td className="p-4">
                      <select
                        value={u.role}
                        onChange={async (e) => {
                          const nextRole = e.target.value as PortalUser['role'];
                          await updateDoc(doc(db, 'users', u.uid), {
                            role: nextRole,
                            updatedAt: serverTimestamp(),
                          });
                          if (nextRole === 'teacher') {
                            await setDoc(
                              doc(db, 'portal_teachers', u.uid),
                              {
                                ...DEFAULT_TEACHERS[0],
                                uid: u.uid,
                                displayName: u.displayName,
                                photoUrl: u.photoUrl || DEFAULT_TEACHERS[0].photoUrl,
                                createdAt: serverTimestamp(),
                                updatedAt: serverTimestamp(),
                              },
                              { merge: true }
                            );
                          }
                          await logAudit({
                            actorId: portalUser.uid,
                            actorEmail: portalUser.email,
                            action: 'role_changed',
                            targetType: 'user',
                            targetId: u.uid,
                            summary: `Changed ${u.email} role to ${nextRole}`,
                          });
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs"
                      >
                        <option value="student">student</option>
                        <option value="teacher">teacher</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="p-4 text-xs">
                      {u.status === 'suspended'
                        ? 'Suspended'
                        : u.accessActive
                          ? 'Active'
                          : 'Locked'}
                    </td>
                    <td className="p-4">
                      <select
                        value={u.teacherId || ''}
                        onChange={async (e) => {
                          await updateDoc(doc(db, 'users', u.uid), {
                            teacherId: e.target.value,
                            updatedAt: serverTimestamp(),
                          });
                          await logAudit({
                            actorId: portalUser.uid,
                            actorEmail: portalUser.email,
                            action: 'teacher_assigned',
                            targetType: 'user',
                            targetId: u.uid,
                            summary: `Assigned teacher ${e.target.value} to ${u.email}`,
                          });
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs"
                      >
                        <option value="">Unassigned</option>
                        {DEFAULT_TEACHERS.map((t) => (
                          <option key={t.uid} value={t.uid}>
                            {t.displayName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-4">
                      <button
                        type="button"
                        onClick={async () => {
                          const nextStatus = u.status === 'suspended' ? 'active' : 'suspended';
                          await updateDoc(doc(db, 'users', u.uid), {
                            status: nextStatus,
                            updatedAt: serverTimestamp(),
                          });
                          await logAudit({
                            actorId: portalUser.uid,
                            actorEmail: portalUser!.email,
                            action: 'user_status_changed',
                            targetType: 'user',
                            targetId: u.uid,
                            summary: `Set ${u.email} status to ${nextStatus}`,
                          });
                        }}
                        className="px-3 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E]"
                      >
                        {u.status === 'suspended' ? 'Restore' : 'Suspend'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'invoices' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <input
                type="search"
                placeholder="Search invoice #, name, org..."
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                className="px-4 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
              />
              <select
                value={invoiceStatusFilter}
                onChange={(e) => setInvoiceStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
              >
                <option value="all">All statuses</option>
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
                <option value="expired">Expired</option>
                <option value="void">Void</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>
            <button
              type="button"
              onClick={exportInvoicesCsv}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#084F4E]/20 text-xs font-semibold text-[#084F4E]"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="space-y-3">
            {filteredInvoices.map((inv) => (
              <div
                key={inv.id}
                className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 flex flex-wrap items-center justify-between gap-4"
              >
                <div>
                  <p className="font-semibold text-[#084F4E] tabular-nums">
                    {inv.number} · {formatMoney(inv.totalCents, inv.currency)} ·{' '}
                    <span className="capitalize">{inv.status}</span>
                  </p>
                  <p className="text-xs text-[#3F4F4F]">
                    {inv.payerName} ({inv.payerEmail}) · {inv.seats} seats
                    {inv.organisation ? ` · ${inv.organisation}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {inv.status === 'unpaid' && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleGenerateNewPaymentLink(inv)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#084F4E] text-white text-xs font-semibold"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        <span>New payment link</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMarkPaidManual(inv)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E]"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Mark paid</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await updateDoc(doc(db, 'portal_invoices', inv.id), {
                            status: 'void',
                            updatedAt: serverTimestamp(),
                          });
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-xs text-red-700"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Void</span>
                      </button>
                    </>
                  )}
                  {inv.status === 'paid' && (
                    <button
                      type="button"
                      onClick={() => void handleRefundInvoice(inv)}
                      className="px-3 py-1.5 rounded-lg border border-red-200 text-xs text-red-700"
                    >
                      Refund
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'coupons' && (
        <div className="grid lg:grid-cols-12 gap-8 items-start">
          <form
            onSubmit={(e) => void handleCreateCoupon(e)}
            className="lg:col-span-5 rounded-2xl border border-[#084F4E]/12 bg-white p-6 space-y-4"
          >
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">Create coupon</h2>
            <input
              required
              placeholder="CODE (e.g. KIGALI20)"
              value={cCode}
              onChange={(e) => setCCode(e.target.value.toUpperCase())}
              className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm uppercase"
            />
            <div className="grid grid-cols-3 gap-2">
              <select
                value={cType}
                onChange={(e) => setCType(e.target.value as 'percent' | 'fixed')}
                className="px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs"
              >
                <option value="percent">% Off</option>
                <option value="fixed">USD Off</option>
              </select>
              <input
                type="number"
                min={1}
                value={cValue}
                onChange={(e) => setCValue(Number(e.target.value) || 10)}
                className="px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs tabular-nums"
              />
              <input
                type="number"
                min={1}
                value={cLimit}
                onChange={(e) => setCLimit(Number(e.target.value) || 50)}
                className="px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs tabular-nums"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold"
            >
              Save coupon
            </button>
          </form>

          <div className="lg:col-span-7 space-y-3">
            {coupons.map((c) => (
              <div
                key={c.code}
                className="rounded-2xl border border-[#084F4E]/12 bg-white p-4 flex items-center justify-between gap-3 text-sm"
              >
                <div>
                  <p className="font-semibold text-[#084F4E]">
                    {c.code} · {c.type === 'percent' ? `${c.value}% off` : formatMoney(c.value)}
                  </p>
                  <p className="text-xs text-[#3F4F4F] tabular-nums">
                    Used {c.usedCount}/{c.usageLimit}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void updateDoc(doc(db, 'portal_coupons', c.code), {
                      active: !c.active,
                      updatedAt: serverTimestamp(),
                    })
                  }
                  className="px-3 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E]"
                >
                  {c.active ? 'Active (Pause)' : 'Inactive (Enable)'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'plans' && (
        <div className="grid lg:grid-cols-12 gap-8 items-start">
          <form
            onSubmit={(e) => void handleCreatePlan(e)}
            className="lg:col-span-5 rounded-2xl border border-[#084F4E]/12 bg-white p-6 space-y-4"
          >
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">Add plan</h2>
            <input
              required
              placeholder="Plan name"
              value={pName}
              onChange={(e) => setPName(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />
            <textarea
              rows={2}
              placeholder="Description"
              value={pDesc}
              onChange={(e) => setPDesc(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />
            <input
              type="number"
              min={1}
              value={pPriceUsd}
              onChange={(e) => setPPriceUsd(Number(e.target.value) || 40)}
              className="w-32 px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm tabular-nums"
            />
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold"
            >
              Create plan
            </button>
          </form>

          <div className="lg:col-span-7 space-y-3">
            {plans.map((pl) => (
              <div
                key={pl.id}
                className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="font-semibold text-[#084F4E]">
                    {pl.name} · {formatMoney(pl.unitPriceCents, pl.currency)}
                  </p>
                  <p className="text-xs text-[#3F4F4F]">{pl.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void updateDoc(doc(db, 'portal_plans', pl.id), {
                      active: !pl.active,
                      updatedAt: serverTimestamp(),
                    })
                  }
                  className="px-3 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E]"
                >
                  {pl.active ? 'Active' : 'Archived'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'groups' && (
        <div className="grid md:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 space-y-3">
            <h2 className="font-display text-lg font-semibold text-[#084F4E]">Teams ({teams.length})</h2>
            {teams.map((t) => (
              <div key={t.id} className="text-sm border-b border-[#084F4E]/10 pb-2">
                <p className="font-medium text-[#084F4E]">{t.name}</p>
                <p className="text-xs text-[#3F4F4F] tabular-nums">
                  Owner: {t.ownerName} · {t.seatsUsed}/{t.seatsTotal} seats
                </p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 space-y-3">
            <h2 className="font-display text-lg font-semibold text-[#084F4E]">
              Study Groups ({groups.length})
            </h2>
            {groups.map((g) => (
              <div key={g.id} className="text-sm border-b border-[#084F4E]/10 pb-2">
                <p className="font-medium text-[#084F4E]">{g.name}</p>
                <p className="text-xs text-[#3F4F4F] tabular-nums">
                  {g.memberIds.length}/{g.capacity} learners · {g.teacherName}
                </p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 space-y-3">
            <h2 className="font-display text-lg font-semibold text-[#084F4E]">
              Organisations ({orgSummary.length})
            </h2>
            {orgSummary.map((o) => (
              <div key={o.name} className="text-sm border-b border-[#084F4E]/10 pb-2">
                <p className="font-medium text-[#084F4E]">{o.name}</p>
                <p className="text-xs text-[#3F4F4F] tabular-nums">
                  {o.learners} learners · {formatMoney(o.paidCents, settings.currency)} paid
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'comms' && (
        <div className="grid lg:grid-cols-12 gap-8 items-start">
          <form
            onSubmit={(e) => void handlePublishAnnouncement(e)}
            className="lg:col-span-6 rounded-2xl border border-[#084F4E]/12 bg-white p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-[#0E7C7B]" />
              <h2 className="font-display text-xl font-semibold text-[#084F4E]">
                Portal announcement
              </h2>
            </div>
            <input
              required
              placeholder="Banner headline"
              value={annTitle}
              onChange={(e) => setAnnTitle(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />
            <textarea
              required
              rows={3}
              placeholder="Message to learners..."
              value={annBody}
              onChange={(e) => setAnnBody(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold"
            >
              Publish announcement
            </button>
          </form>

          <div className="lg:col-span-6 rounded-2xl border border-[#084F4E]/12 bg-[#FAFBFB] p-6 space-y-3">
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">
              Admin help: Protected Resources
            </h2>
            <p className="text-sm text-[#3F4F4F] leading-relaxed">
              PDFs are drawn onto a canvas with the viewer&apos;s email watermarked and right-click
              disabled. Videos stream privately through authenticated tickets with download and
              picture-in-picture controls turned off.
            </p>
            <p className="text-sm text-[#084F4E] font-medium">
              Honest note: This stops casual downloading and direct link sharing, though a determined
              person can still screen-record their own display.
            </p>
          </div>
        </div>
      )}

      {tab === 'logs' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-[#084F4E]/12 bg-white p-6 space-y-3">
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">Audit Log</h2>
            <div className="divide-y divide-[#084F4E]/10 max-h-96 overflow-y-auto">
              {auditLogs.map((a) => (
                <div key={a.id} className="py-2.5 text-xs">
                  <p className="font-semibold text-[#084F4E]">
                    {a.action} · {a.actorEmail}
                  </p>
                  <p className="text-[#3F4F4F]">{a.summary}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#084F4E]/12 bg-white p-6 space-y-3">
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">Email Log</h2>
            <div className="divide-y divide-[#084F4E]/10 max-h-96 overflow-y-auto">
              {emailLogs.map((e) => (
                <div key={e.id} className="py-2.5 text-xs">
                  <p className="font-semibold text-[#084F4E]">
                    {e.subject} · <span className="uppercase">{e.status}</span>
                  </p>
                  <p className="text-[#3F4F4F]">To: {e.to}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
