import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  Download,
  Link2,
  CheckCircle2,
  Ban,
  Megaphone,
  UserPlus,
  BookOpen,
  ShieldCheck,
  Pencil,
  Trash2,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import {
  activatePaidInvoice,
  dispatchPortalEmail,
  logAudit,
} from '../lib/portalActions';
import { formatMoney, normalizeOrganisationName } from '../shared/pricing';
import {
  DEFAULT_PLANS,
  DEFAULT_SETTINGS,
  DEFAULT_WEEKLY_AVAILABILITY,
  teacherInviteDocId,
} from '../lib/seed';
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
  TeacherInvite,
  TeacherProfile,
  UserRole,
} from '../types/portal';

type AdminTab =
  | 'overview'
  | 'teachers'
  | 'people'
  | 'invoices'
  | 'coupons'
  | 'plans'
  | 'groups'
  | 'comms'
  | 'logs';

export function AdminPage() {
  const { portalUser, loading: authLoading, signInWithGoogle } = useAuth();
  const [tab, setTab] = useState<AdminTab>('overview');

  const [users, setUsers] = useState<PortalUser[]>([]);
  const [teachers, setTeachers] = useState<TeacherProfile[]>([]);
  const [teacherInvites, setTeacherInvites] = useState<TeacherInvite[]>([]);
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [coupons, setCoupons] = useState<PortalCoupon[]>([]);
  const [plans, setPlans] = useState<PortalPlan[]>([]);
  const [teams, setTeams] = useState<PortalTeam[]>([]);
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [bookings, setBookings] = useState<PortalBooking[]>([]);
  const [feedbackList, setFeedbackList] = useState<LessonFeedback[]>([]);
  const [auditLogs, setAuditLogs] = useState<
    Array<{ id: string; actorEmail: string; action: string; summary: string }>
  >([]);
  const [emailLogs, setEmailLogs] = useState<
    Array<{ id: string; to: string; subject: string; status: string }>
  >([]);
  const [settings, setSettings] = useState<PortalSettings>(DEFAULT_SETTINGS);

  const [peopleSearch, setPeopleSearch] = useState('');
  const [peopleRoleFilter, setPeopleRoleFilter] = useState<'all' | UserRole>('all');
  const [adminAssignSearch, setAdminAssignSearch] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('all');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  // Create teacher form
  const [tName, setTName] = useState('');
  const [tEmail, setTEmail] = useState('');
  const [tBio, setTBio] = useState('');
  const [tPhotoUrl, setTPhotoUrl] = useState('');
  const [tLessonMin, setTLessonMin] = useState(45);
  const [tBufferMin, setTBufferMin] = useState(15);
  const [tMaxPerDay, setTMaxPerDay] = useState(6);
  const [tGrantAdmin, setTGrantAdmin] = useState(false);
  const [creatingTeacher, setCreatingTeacher] = useState(false);

  // Inline edit / delete teacher profile
  const [editingTeacherId, setEditingTeacherId] = useState<string | null>(null);
  const [editTName, setEditTName] = useState('');
  const [editTBio, setEditTBio] = useState('');
  const [editTPhotoUrl, setEditTPhotoUrl] = useState('');
  const [editTLessonMin, setEditTLessonMin] = useState(45);
  const [editTBufferMin, setEditTBufferMin] = useState(15);
  const [editTMaxPerDay, setEditTMaxPerDay] = useState(6);
  const [confirmDeleteTeacherId, setConfirmDeleteTeacherId] = useState<string | null>(null);

  // Inline invoice action modal/drawer (avoids window.prompt on mobile/iframe)
  const [invoiceAction, setInvoiceAction] = useState<{
    id: string;
    kind: 'manual_paid' | 'refund';
    reason: string;
  } | null>(null);

  // Coupon form
  const [cCode, setCCode] = useState('');
  const [cType, setCType] = useState<'percent' | 'fixed'>('percent');
  const [cValue, setCValue] = useState(15);
  const [cLimit, setCLimit] = useState(50);

  // Plan form
  const [pName, setPName] = useState('');
  const [pObjective, setPObjective] = useState('');
  const [pDesc, setPDesc] = useState('');
  const [pLevel, setPLevel] = useState('Beginner');
  const [pPriceUsd, setPPriceUsd] = useState(40);
  const [pPublicEnrol, setPPublicEnrol] = useState(true);

  // Announcement form
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');

  useEffect(() => {
    if (!portalUser || portalUser.role !== 'admin') return;

    const unsubs = [
      onSnapshot(collection(db, 'users'), (s) =>
        setUsers(s.docs.map((d) => d.data() as PortalUser))
      ),
      onSnapshot(collection(db, 'portal_teachers'), (s) =>
        setTeachers(s.docs.map((d) => d.data() as TeacherProfile))
      ),
      onSnapshot(collection(db, 'portal_teacher_invites'), (s) =>
        setTeacherInvites(
          s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TeacherInvite, 'id'>) }))
        )
      ),
      onSnapshot(collection(db, 'portal_invoices'), (s) =>
        setInvoices(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalInvoice, 'id'>) })))
      ),
      onSnapshot(collection(db, 'portal_coupons'), (s) =>
        setCoupons(s.docs.map((d) => d.data() as PortalCoupon))
      ),
      onSnapshot(collection(db, 'portal_plans'), (s) =>
        setPlans(s.docs.map((d) => ({ ...(d.data() as PortalPlan), id: d.id })))
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

  const activeTeachers = useMemo(() => teachers.filter((t) => t.active), [teachers]);
  const activePlans = useMemo(() => plans.filter((p) => p.active), [plans]);
  const adminUsers = useMemo(() => users.filter((u) => u.role === 'admin'), [users]);

  const filteredUsers = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase();
    return users.filter((u) => {
      if (peopleRoleFilter !== 'all' && u.role !== peopleRoleFilter) return false;
      if (!q) return true;
      return (
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.organisation || '').toLowerCase().includes(q)
      );
    });
  }, [users, peopleSearch, peopleRoleFilter]);

  const assignableRoleCandidates = useMemo(() => {
    const q = adminAssignSearch.trim().toLowerCase();
    if (!q) return users.filter((u) => u.role !== 'admin').slice(0, 6);
    return users
      .filter(
        (u) =>
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [users, adminAssignSearch]);

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

  if (authLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="h-48 rounded-[24px] bg-[#FAFBFB] border border-[#084F4E]/10 animate-pulse" />
      </div>
    );
  }

  if (!portalUser || portalUser.role !== 'admin') {
    return (
      <div className="max-w-xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="rounded-[24px] border border-[#084F4E]/15 bg-[#FAFBFB] p-6 sm:p-10 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#E6F4F4] text-[#084F4E] flex items-center justify-center mx-auto">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="font-display text-2xl font-semibold text-[#084F4E]">
            Admin-only access
          </h1>
          <p className="text-sm text-[#3F4F4F]">
            {portalUser
              ? 'This area is restricted to Ijwi Portal administrators.'
              : 'Sign in with an administrator Google account to manage teachers, roles, and portal operations.'}
          </p>
          {portalUser ? (
            <Link
              to={portalUser.role === 'teacher' ? '/teacher' : portalUser.accessActive ? '/dashboard' : '/'}
              className="inline-flex px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B]"
            >
              Return to your workspace
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void signInWithGoogle()}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B]"
            >
              Continue with Google
            </button>
          )}
        </div>
      </div>
    );
  }

  const paidRevenueCents = invoices
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + i.totalCents, 0);
  const unpaidCount = invoices.filter((i) => i.status === 'unpaid').length;
  const activeStudents = users.filter((u) => u.accessActive && u.role === 'student').length;
  const lessonsThisWeek = bookings.filter((b) => b.status === 'completed').length;

  async function changeUserRole(targetUser: PortalUser, nextRole: UserRole) {
    if (!portalUser) return;
    if (targetUser.uid === portalUser.uid && nextRole !== 'admin') {
      setMessage('You cannot remove your own administrator role while signed in.');
      return;
    }

    await updateDoc(doc(db, 'users', targetUser.uid), {
      role: nextRole,
      ...(nextRole === 'teacher' || nextRole === 'admin' ? { accessActive: true } : {}),
      updatedAt: serverTimestamp(),
    });

    if (nextRole === 'teacher') {
      await setDoc(
        doc(db, 'portal_teachers', targetUser.uid),
        {
          uid: targetUser.uid,
          email: targetUser.email,
          displayName: targetUser.displayName,
          photoUrl: targetUser.photoUrl || '',
          bio: 'Dedicated Kinyarwanda teacher at Ijwi.',
          availability: DEFAULT_WEEKLY_AVAILABILITY,
          daysOff: [],
          lessonLengthMin: 45,
          bufferMin: 15,
          maxPerDay: 6,
          active: true,
          pendingClaim: false,
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
      targetId: targetUser.uid,
      summary: `Changed ${targetUser.email} role to ${nextRole}`,
    });
    setMessage(`Updated ${targetUser.displayName}'s role to ${nextRole}.`);
  }

  async function handleCreateTeacher(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = tEmail.trim().toLowerCase();
    const cleanName = tName.trim();
    if (!cleanEmail || !cleanName) return;

    setCreatingTeacher(true);
    setMessage(null);
    try {
      const existingUser = users.find((u) => u.email.toLowerCase() === cleanEmail);

      if (existingUser) {
        const assignedRole: UserRole = tGrantAdmin ? 'admin' : 'teacher';
        await updateDoc(doc(db, 'users', existingUser.uid), {
          role: assignedRole,
          accessActive: true,
          updatedAt: serverTimestamp(),
        });
        await setDoc(
          doc(db, 'portal_teachers', existingUser.uid),
          {
            uid: existingUser.uid,
            email: cleanEmail,
            displayName: cleanName,
            photoUrl: tPhotoUrl.trim() || existingUser.photoUrl || '',
            bio: tBio.trim() || 'Dedicated Kinyarwanda teacher at Ijwi.',
            availability: DEFAULT_WEEKLY_AVAILABILITY,
            daysOff: [],
            lessonLengthMin: tLessonMin,
            bufferMin: tBufferMin,
            maxPerDay: tMaxPerDay,
            active: true,
            pendingClaim: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        await dispatchPortalEmail({
          userId: existingUser.uid,
          to: cleanEmail,
          recipientName: cleanName,
          type: 'teacher_invited',
          subject: 'Your Ijwi Teacher Desk is now active',
          headline: 'You have been added as an Ijwi teacher',
          bodyText:
            'Your Teacher Desk is live. Sign in with Google to manage your weekly schedule, create learning plans with objectives, and upload resources.',
          ctaLabel: 'Open Teacher Desk',
          ctaUrl: '/teacher',
          essential: true,
        });
        await logAudit({
          actorId: portalUser!.uid,
          actorEmail: portalUser!.email,
          action: 'teacher_created',
          targetType: 'teacher',
          targetId: existingUser.uid,
          summary: `Configured teacher ${cleanName} (${cleanEmail}) with role ${assignedRole}`,
        });
        setMessage(
          `${cleanName} is now an active teacher${tGrantAdmin ? ' with Admin role' : ''} and can open the Teacher Desk immediately.`
        );
      } else {
        const inviteId = teacherInviteDocId(cleanEmail);
        const placeholderUid = `tch-${inviteId.slice(0, 28)}-${Date.now().toString(36)}`;
        await setDoc(doc(db, 'portal_teachers', placeholderUid), {
          uid: placeholderUid,
          email: cleanEmail,
          displayName: cleanName,
          photoUrl: tPhotoUrl.trim(),
          bio: tBio.trim() || 'Dedicated Kinyarwanda teacher at Ijwi.',
          availability: DEFAULT_WEEKLY_AVAILABILITY,
          daysOff: [],
          lessonLengthMin: tLessonMin,
          bufferMin: tBufferMin,
          maxPerDay: tMaxPerDay,
          active: true,
          pendingClaim: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'portal_teacher_invites', inviteId), {
          email: cleanEmail,
          displayName: cleanName,
          photoUrl: tPhotoUrl.trim(),
          bio: tBio.trim() || 'Dedicated Kinyarwanda teacher at Ijwi.',
          teacherProfileId: placeholderUid,
          lessonLengthMin: tLessonMin,
          bufferMin: tBufferMin,
          maxPerDay: tMaxPerDay,
          createdBy: portalUser!.uid,
          revoked: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await dispatchPortalEmail({
          userId: portalUser!.uid,
          to: cleanEmail,
          recipientName: cleanName,
          type: 'teacher_invited',
          subject: 'Invitation to teach Kinyarwanda on Ijwi Portal',
          headline: `Muraho ${cleanName}, welcome to the Ijwi Teaching Team`,
          bodyText:
            'An admin has set up your teacher profile. Sign in with your Google account matching this email address to unlock your Teacher Desk, create learning plans, and manage your students.',
          ctaLabel: 'Sign in to Teacher Desk',
          ctaUrl: '/teacher',
          essential: true,
        });
        await logAudit({
          actorId: portalUser!.uid,
          actorEmail: portalUser!.email,
          action: 'teacher_invited',
          targetType: 'teacher_invite',
          targetId: inviteId,
          summary: `Created teacher profile & invite for ${cleanName} (${cleanEmail})`,
        });
        setMessage(
          `Teacher profile created for ${cleanName}. When they sign in with Google (${cleanEmail}), they will automatically enter the Teacher Desk.`
        );
      }

      setTName('');
      setTEmail('');
      setTBio('');
      setTPhotoUrl('');
      setTGrantAdmin(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to create teacher.');
    } finally {
      setCreatingTeacher(false);
    }
  }

  function startEditTeacher(t: TeacherProfile) {
    setEditingTeacherId(t.uid);
    setEditTName(t.displayName);
    setEditTBio(t.bio);
    setEditTPhotoUrl(t.photoUrl || '');
    setEditTLessonMin(t.lessonLengthMin);
    setEditTBufferMin(t.bufferMin);
    setEditTMaxPerDay(t.maxPerDay);
  }

  async function saveEditTeacher(t: TeacherProfile) {
    if (!editTName.trim()) return;
    await updateDoc(doc(db, 'portal_teachers', t.uid), {
      displayName: editTName.trim(),
      bio: editTBio.trim() || 'Dedicated Kinyarwanda teacher at Ijwi.',
      photoUrl: editTPhotoUrl.trim(),
      lessonLengthMin: Math.max(15, Math.min(180, editTLessonMin)),
      bufferMin: Math.max(0, Math.min(60, editTBufferMin)),
      maxPerDay: Math.max(1, Math.min(20, editTMaxPerDay)),
      updatedAt: serverTimestamp(),
    });
    await logAudit({
      actorId: portalUser!.uid,
      actorEmail: portalUser!.email,
      action: 'teacher_updated',
      targetType: 'teacher',
      targetId: t.uid,
      summary: `Updated profile details for teacher ${editTName.trim()}`,
    });
    setEditingTeacherId(null);
    setMessage(`Updated teacher profile for ${editTName.trim()}.`);
  }

  async function handleDeleteTeacher(t: TeacherProfile) {
    await deleteDoc(doc(db, 'portal_teachers', t.uid));
    setConfirmDeleteTeacherId(null);
    await logAudit({
      actorId: portalUser!.uid,
      actorEmail: portalUser!.email,
      action: 'teacher_deleted',
      targetType: 'teacher',
      targetId: t.uid,
      summary: `Removed teacher profile ${t.displayName}`,
    });
    setMessage(`Removed teacher profile for ${t.displayName}.`);
  }

  async function toggleUserPlan(user: PortalUser, planId: string) {
    const current = user.assignedPlanIds || [];
    const next = current.includes(planId)
      ? current.filter((id) => id !== planId)
      : [...current, planId];
    await updateDoc(doc(db, 'users', user.uid), {
      assignedPlanIds: next,
      updatedAt: serverTimestamp(),
    });
    await logAudit({
      actorId: portalUser!.uid,
      actorEmail: portalUser!.email,
      action: 'learner_plans_updated',
      targetType: 'user',
      targetId: user.uid,
      summary: `Updated learning plans for ${user.email} (${next.join(', ') || 'none'})`,
    });
  }

  async function toggleTeamPlan(team: PortalTeam, planId: string) {
    const current = team.assignedPlanIds || (team.planId ? [team.planId] : []);
    const next = current.includes(planId)
      ? current.filter((id) => id !== planId)
      : [...current, planId];
    await updateDoc(doc(db, 'portal_teams', team.id), {
      assignedPlanIds: next,
      updatedAt: serverTimestamp(),
    });
    await logAudit({
      actorId: portalUser!.uid,
      actorEmail: portalUser!.email,
      action: 'team_plans_updated',
      targetType: 'team',
      targetId: team.id,
      summary: `Updated learning plans for team ${team.name} (${next.join(', ') || 'none'})`,
    });
  }

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

  async function submitInvoiceAction(inv: PortalInvoice) {
    if (!invoiceAction || invoiceAction.id !== inv.id) return;
    const reason = invoiceAction.reason.trim();
    if (!reason) return;

    if (invoiceAction.kind === 'manual_paid') {
      const payer = users.find((u) => u.uid === inv.payerId) || portalUser!;
      await activatePaidInvoice({
        invoice: inv,
        payer,
        trackingId: `MANUAL-${Date.now()}`,
        merchantRef: inv.number,
        paymentMethod: 'Manual (Bank / Cash)',
        manualReason: reason,
      });
      setInvoiceAction(null);
      setMessage(`Invoice ${inv.number} marked paid manually.`);
    } else {
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
      setInvoiceAction(null);
      setMessage(`Invoice ${inv.number} refunded and access revoked.`);
    }
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
    if (!pName.trim() || !pObjective.trim()) return;
    const slug = pName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
    const id = `${slug || 'plan'}-${Date.now().toString(36)}`;
    await setDoc(doc(db, 'portal_plans', id), {
      id,
      name: pName.trim(),
      objective: pObjective.trim(),
      description: pDesc.trim() || 'Guided Kinyarwanda plan with teacher support.',
      level: pLevel,
      teacherId: portalUser!.uid,
      teacherName: portalUser!.displayName,
      unitPriceCents: Math.round(pPriceUsd * 100),
      currency: settings.currency || 'USD',
      included: DEFAULT_PLANS[0].included,
      learningPath: DEFAULT_PLANS[0].learningPath,
      isPublicEnrolment: pPublicEnrol,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setPName('');
    setPObjective('');
    setPDesc('');
    setMessage(`Plan "${pName.trim()}" added.`);
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
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-12 space-y-6 sm:space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#084F4E]">
            Admin Console
          </h1>
          <p className="text-sm text-[#3F4F4F] mt-1">
            Manage teachers, assign administrative roles, oversee learners, and review billing.
          </p>
        </div>

        <div className="flex overflow-x-auto sm:flex-wrap gap-1.5 p-1.5 rounded-2xl bg-[#E6F4F4] w-full lg:w-auto">
          {(
            [
              ['overview', 'Overview'],
              ['teachers', 'Teachers & Roles'],
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
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                tab === key ? 'bg-[#084F4E] text-white' : 'text-[#3F4F4F] hover:text-[#084F4E]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <div className="rounded-2xl border border-[#0E7C7B]/25 bg-[#E6F4F4] px-4 sm:px-5 py-3 text-sm text-[#084F4E]">
          {message}
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-6 sm:space-y-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            {[
              { label: 'Sign-ups', value: String(users.length) },
              { label: 'Active teachers', value: String(activeTeachers.length) },
              { label: 'Administrators', value: String(adminUsers.length) },
              { label: 'Paid revenue', value: formatMoney(paidRevenueCents, settings.currency) },
              { label: 'Unpaid invoices', value: String(unpaidCount) },
            ].map((k, idx) => (
              <div
                key={k.label}
                className={`rounded-2xl border border-[#084F4E]/12 bg-white p-4 sm:p-5 ${
                  idx === 4 ? 'col-span-2 sm:col-span-1' : ''
                }`}
              >
                <p className="text-xs text-[#3F4F4F] mb-1">{k.label}</p>
                <p className="font-display text-xl sm:text-2xl font-semibold text-[#084F4E] tabular-nums">
                  {k.value}
                </p>
              </div>
            ))}
          </div>

          <section className="rounded-[24px] border border-[#C9A84C]/40 bg-[#FAFBFB] p-5 sm:p-6 space-y-3">
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
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-[#084F4E]/20 bg-white text-xs font-semibold text-[#084F4E]"
            >
              Copy flier text
            </button>
          </section>

          <section className="rounded-[24px] border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-3">
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

      {tab === 'teachers' && (
        <div className="grid lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Left Column: Create Teacher Profile + Assign Admin Role */}
          <div className="lg:col-span-5 space-y-6">
            <form
              onSubmit={(e) => void handleCreateTeacher(e)}
              className="rounded-[20px] border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-4"
            >
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-[#0E7C7B]" />
                <h2 className="font-display text-xl font-semibold text-[#084F4E]">
                  Add a teacher profile
                </h2>
              </div>
              <p className="text-xs text-[#3F4F4F] leading-relaxed">
                Add a teacher by Google email. Existing accounts unlock immediately; new accounts unlock automatically on their first Google sign-in.
              </p>
              <div>
                <label className="block text-xs font-medium text-[#1F2A2A] mb-1">Full name</label>
                <input
                  required
                  maxLength={120}
                  placeholder="e.g. Diane Uwimana"
                  value={tName}
                  onChange={(e) => setTName(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#1F2A2A] mb-1">Google email</label>
                <input
                  required
                  type="email"
                  maxLength={254}
                  placeholder="teacher@gmail.com"
                  value={tEmail}
                  onChange={(e) => setTEmail(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#1F2A2A] mb-1">Teaching bio</label>
                <textarea
                  rows={3}
                  maxLength={600}
                  placeholder="Specialties, years of experience, and teaching approach..."
                  value={tBio}
                  onChange={(e) => setTBio(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#1F2A2A] mb-1">
                  Photo URL (optional)
                </label>
                <input
                  type="url"
                  maxLength={512}
                  placeholder="https://..."
                  value={tPhotoUrl}
                  onChange={(e) => setTPhotoUrl(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-[#3F4F4F] mb-1">
                    Lesson (min)
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={180}
                    value={tLessonMin}
                    onChange={(e) => setTLessonMin(Number(e.target.value) || 45)}
                    className="w-full min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#3F4F4F] mb-1">
                    Buffer (min)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={tBufferMin}
                    onChange={(e) => setTBufferMin(Number(e.target.value) || 15)}
                    className="w-full min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#3F4F4F] mb-1">
                    Max / day
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={tMaxPerDay}
                    onChange={(e) => setTMaxPerDay(Number(e.target.value) || 6)}
                    className="w-full min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs tabular-nums"
                  />
                </div>
              </div>
              <label className="flex items-start gap-2.5 text-xs text-[#3F4F4F] pt-1">
                <input
                  type="checkbox"
                  checked={tGrantAdmin}
                  onChange={(e) => setTGrantAdmin(e.target.checked)}
                  className="mt-0.5"
                />
                <span>Also assign Administrator role if user account already exists</span>
              </label>
              <button
                type="submit"
                disabled={creatingTeacher}
                className="w-full min-h-[44px] px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] disabled:opacity-60"
              >
                {creatingTeacher ? 'Creating teacher...' : 'Create teacher & send invite'}
              </button>
            </form>

            {/* Assign Administrative Roles Panel */}
            <div className="rounded-[20px] border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#0E7C7B]" />
                <h2 className="font-display text-xl font-semibold text-[#084F4E]">
                  Assign administrative roles
                </h2>
              </div>
              <p className="text-xs text-[#3F4F4F]">
                Promote or manage portal administrators. Admins retain full access to Admin Console and Teacher Desk.
              </p>

              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-[#0E7C7B]">
                  Current administrators ({adminUsers.length})
                </p>
                {adminUsers.map((adm) => (
                  <div
                    key={adm.uid}
                    className="rounded-xl border border-[#084F4E]/12 bg-[#FAFBFB] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[#084F4E] truncate">{adm.displayName}</p>
                      <p className="text-[#3F4F4F] truncate">{adm.email}</p>
                    </div>
                    {adm.uid === portalUser.uid ? (
                      <span className="text-[11px] font-medium text-[#0E7C7B] shrink-0">
                        You (Active Admin)
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => void changeUserRole(adm, 'teacher')}
                          className="px-2.5 py-1.5 rounded-lg border border-[#084F4E]/20 bg-white text-[11px] font-medium text-[#084F4E]"
                        >
                          Set Teacher
                        </button>
                        <button
                          type="button"
                          onClick={() => void changeUserRole(adm, 'student')}
                          className="px-2.5 py-1.5 rounded-lg border border-red-200 bg-white text-[11px] font-medium text-red-700"
                        >
                          Revoke Admin
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="pt-2 border-t border-[#084F4E]/10 space-y-2.5">
                <label className="block text-xs font-medium text-[#1F2A2A]">
                  Search signed-up accounts to assign role
                </label>
                <input
                  type="search"
                  placeholder="Search name or email..."
                  value={adminAssignSearch}
                  onChange={(e) => setAdminAssignSearch(e.target.value)}
                  className="w-full min-h-[40px] px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-xs"
                />
                {assignableRoleCandidates.length > 0 && (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {assignableRoleCandidates.map((cand) => (
                      <div
                        key={cand.uid}
                        className="rounded-xl border border-[#084F4E]/12 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-[#084F4E] truncate">
                            {cand.displayName}{' '}
                            <span className="font-normal text-[#0E7C7B] capitalize">
                              ({cand.role})
                            </span>
                          </p>
                          <p className="text-[#3F4F4F] truncate">{cand.email}</p>
                        </div>
                        <select
                          aria-label={`Role for ${cand.displayName}`}
                          value={cand.role}
                          onChange={(e) => void changeUserRole(cand, e.target.value as UserRole)}
                          className="min-h-[36px] px-2.5 py-1 rounded-lg border border-[#084F4E]/20 bg-white text-xs text-[#084F4E]"
                        >
                          <option value="student">student</option>
                          <option value="teacher">teacher</option>
                          <option value="admin">admin</option>
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Teacher Profiles Directory */}
          <div className="lg:col-span-7 space-y-4">
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">
              Teacher profiles ({teachers.length})
            </h2>
            {teachers.length === 0 ? (
              <div className="rounded-2xl border border-[#084F4E]/12 bg-[#FAFBFB] p-6 sm:p-8 text-sm text-[#3F4F4F]">
                No teachers have been created yet. Create your first teacher profile to get started.
              </div>
            ) : (
              <div className="space-y-3">
                {teachers.map((t) => {
                  const teacherPlans = plans.filter((p) => p.teacherId === t.uid);
                  const assignedStudentsCount = users.filter((u) => u.teacherId === t.uid).length;
                  const linkedUser = users.find(
                    (u) =>
                      u.uid === t.uid ||
                      (t.email && u.email.toLowerCase() === t.email.toLowerCase())
                  );
                  const isEditing = editingTeacherId === t.uid;

                  return (
                    <div
                      key={t.uid}
                      className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 space-y-4"
                    >
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-medium mb-1">Display name</label>
                              <input
                                value={editTName}
                                onChange={(e) => setEditTName(e.target.value)}
                                className="w-full px-3 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium mb-1">Photo URL</label>
                              <input
                                value={editTPhotoUrl}
                                onChange={(e) => setEditTPhotoUrl(e.target.value)}
                                className="w-full px-3 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium mb-1">Bio</label>
                            <textarea
                              rows={2}
                              value={editTBio}
                              onChange={(e) => setEditTBio(e.target.value)}
                              className="w-full px-3 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[11px] font-medium mb-1">Lesson (min)</label>
                              <input
                                type="number"
                                min={15}
                                max={180}
                                value={editTLessonMin}
                                onChange={(e) => setEditTLessonMin(Number(e.target.value) || 45)}
                                className="w-full px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs tabular-nums"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium mb-1">Buffer (min)</label>
                              <input
                                type="number"
                                min={0}
                                max={60}
                                value={editTBufferMin}
                                onChange={(e) => setEditTBufferMin(Number(e.target.value) || 15)}
                                className="w-full px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs tabular-nums"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium mb-1">Max / day</label>
                              <input
                                type="number"
                                min={1}
                                max={20}
                                value={editTMaxPerDay}
                                onChange={(e) => setEditTMaxPerDay(Number(e.target.value) || 6)}
                                className="w-full px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs tabular-nums"
                              />
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void saveEditTeacher(t)}
                              className="px-4 py-2 rounded-xl bg-[#084F4E] text-white text-xs font-semibold"
                            >
                              Save changes
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingTeacherId(null)}
                              className="px-4 py-2 rounded-xl border border-[#084F4E]/20 text-xs text-[#3F4F4F]"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-semibold text-[#084F4E]">{t.displayName}</p>
                                <span className="text-[11px] px-2 py-0.5 rounded-md bg-[#E6F4F4] text-[#084F4E]">
                                  {t.pendingClaim
                                    ? 'Awaiting first sign-in'
                                    : t.active
                                      ? 'Active'
                                      : 'Paused'}
                                </span>
                                {linkedUser && (
                                  <span
                                    className={`text-[11px] px-2 py-0.5 rounded-md capitalize ${
                                      linkedUser.role === 'admin'
                                        ? 'bg-[#E8C97A]/40 text-[#084F4E] font-semibold'
                                        : 'bg-[#FAFBFB] border border-[#084F4E]/15 text-[#3F4F4F]'
                                    }`}
                                  >
                                    Role: {linkedUser.role}
                                  </span>
                                )}
                              </div>
                              {t.email && <p className="text-xs text-[#0E7C7B]">{t.email}</p>}
                              <p className="text-xs text-[#3F4F4F]">{t.bio}</p>
                              <p className="text-xs text-[#3F4F4F] tabular-nums pt-1">
                                {t.lessonLengthMin} min lessons · {assignedStudentsCount} learners ·{' '}
                                {teacherPlans.length} plans created
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#084F4E]/10">
                            <button
                              type="button"
                              onClick={() =>
                                void updateDoc(doc(db, 'portal_teachers', t.uid), {
                                  active: !t.active,
                                  updatedAt: serverTimestamp(),
                                })
                              }
                              className="px-3 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E] hover:bg-[#E6F4F4]"
                            >
                              {t.active ? 'Pause' : 'Activate'}
                            </button>

                            <button
                              type="button"
                              onClick={() => startEditTeacher(t)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E] hover:bg-[#E6F4F4]"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Edit</span>
                            </button>

                            {linkedUser && linkedUser.uid !== portalUser.uid && (
                              <button
                                type="button"
                                onClick={() =>
                                  void changeUserRole(
                                    linkedUser,
                                    linkedUser.role === 'admin' ? 'teacher' : 'admin'
                                  )
                                }
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#C9A84C]/50 bg-[#E8C97A]/20 text-xs font-semibold text-[#084F4E]"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>
                                  {linkedUser.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                                </span>
                              </button>
                            )}

                            {confirmDeleteTeacherId === t.uid ? (
                              <div className="flex items-center gap-1.5 ml-auto">
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteTeacher(t)}
                                  className="px-3 py-1.5 rounded-lg bg-red-700 text-white text-xs font-semibold"
                                >
                                  Confirm remove
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteTeacherId(null)}
                                  className="px-2 py-1.5 text-xs text-[#3F4F4F]"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteTeacherId(t.uid)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50 sm:ml-auto"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Remove</span>
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {teacherInvites.filter((inv) => !inv.claimedBy && !inv.revoked).length > 0 && (
              <div className="rounded-2xl border border-[#C9A84C]/35 bg-[#FAFBFB] p-5 space-y-2">
                <h3 className="text-sm font-semibold text-[#084F4E]">
                  Pending Google sign-in invitations
                </h3>
                {teacherInvites
                  .filter((inv) => !inv.claimedBy && !inv.revoked)
                  .map((inv) => (
                    <div
                      key={inv.id}
                      className="flex flex-wrap items-center justify-between gap-3 text-xs py-1.5 border-b border-[#084F4E]/10 last:border-b-0"
                    >
                      <span>
                        <strong>{inv.displayName}</strong> ({inv.email})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void updateDoc(doc(db, 'portal_teacher_invites', inv.id), {
                            revoked: true,
                            updatedAt: serverTimestamp(),
                          })
                        }
                        className="text-red-700 hover:underline"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'people' && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <input
              type="search"
              placeholder="Search people by name, email, or organisation..."
              value={peopleSearch}
              onChange={(e) => setPeopleSearch(e.target.value)}
              className="w-full sm:max-w-md min-h-[42px] px-4 py-2.5 rounded-xl border border-[#084F4E]/20 text-sm"
            />

            <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-[#E6F4F4]">
              {(['all', 'admin', 'teacher', 'student'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setPeopleRoleFilter(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                    peopleRoleFilter === r
                      ? 'bg-[#084F4E] text-white'
                      : 'text-[#3F4F4F] hover:text-[#084F4E]'
                  }`}
                >
                  {r === 'all' ? `All (${users.length})` : `${r}s`}
                </button>
              ))}
            </div>
          </div>

          {/* Mobile-first Cards (< lg) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:hidden">
            {filteredUsers.map((u) => (
              <div
                key={u.uid}
                className="rounded-[20px] border border-[#084F4E]/12 bg-white p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-[#084F4E] truncate">{u.displayName}</p>
                    <p className="text-xs text-[#3F4F4F] truncate">
                      {u.email}
                      {u.organisation ? ` · ${u.organisation}` : ''}
                    </p>
                    <p className="text-xs text-[#3F4F4F] tabular-nums mt-0.5">
                      No-shows: {u.noShowCount || 0} · Late cancels: {u.lateCancelCount || 0}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-[#E6F4F4] text-[11px] font-semibold text-[#084F4E] shrink-0">
                    {u.status === 'suspended' ? 'Suspended' : u.accessActive ? 'Active' : 'Locked'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-[#3F4F4F] mb-1">
                      Role
                    </label>
                    <select
                      value={u.role}
                      onChange={(e) => void changeUserRole(u, e.target.value as UserRole)}
                      className="w-full min-h-[40px] px-2.5 py-1.5 rounded-xl border border-[#084F4E]/20 text-xs bg-white"
                    >
                      <option value="student">student</option>
                      <option value="teacher">teacher</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[#3F4F4F] mb-1">
                      Teacher
                    </label>
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
                      className="w-full min-h-[40px] px-2.5 py-1.5 rounded-xl border border-[#084F4E]/20 text-xs bg-white"
                    >
                      <option value="">Unassigned</option>
                      {activeTeachers.map((t) => (
                        <option key={t.uid} value={t.uid}>
                          {t.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-[#3F4F4F] mb-1.5">Applied plans</p>
                  {activePlans.length === 0 ? (
                    <span className="text-xs text-[#3F4F4F]">No active plans</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {activePlans.map((pl) => {
                        const selected = (u.assignedPlanIds || []).includes(pl.id);
                        return (
                          <button
                            key={pl.id}
                            type="button"
                            onClick={() => void toggleUserPlan(u, pl.id)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                              selected
                                ? 'bg-[#084F4E] text-white border-[#084F4E]'
                                : 'bg-white text-[#3F4F4F] border-[#084F4E]/20 hover:bg-[#E6F4F4]'
                            }`}
                          >
                            {pl.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

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
                      actorEmail: portalUser.email,
                      action: 'user_status_changed',
                      targetType: 'user',
                      targetId: u.uid,
                      summary: `Set ${u.email} status to ${nextStatus}`,
                    });
                  }}
                  className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-[#084F4E]/20 text-xs font-medium text-[#084F4E]"
                >
                  {u.status === 'suspended' ? 'Restore account' : 'Suspend account'}
                </button>
              </div>
            ))}
          </div>

          {/* Desktop Table (lg+) */}
          <div className="hidden lg:block rounded-[20px] border border-[#084F4E]/12 bg-white overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#084F4E]/10 text-xs text-[#3F4F4F]">
                <tr>
                  <th className="p-4">Person</th>
                  <th className="p-4">Role</th>
                  <th className="p-4">Access</th>
                  <th className="p-4">Teacher</th>
                  <th className="p-4">Applied Plans</th>
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
                        onChange={(e) => void changeUserRole(u, e.target.value as UserRole)}
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
                        {activeTeachers.map((t) => (
                          <option key={t.uid} value={t.uid}>
                            {t.displayName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-4">
                      {activePlans.length === 0 ? (
                        <span className="text-xs text-[#3F4F4F]">No active plans</span>
                      ) : (
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {activePlans.map((pl) => {
                            const selected = (u.assignedPlanIds || []).includes(pl.id);
                            return (
                              <button
                                key={pl.id}
                                type="button"
                                onClick={() => void toggleUserPlan(u, pl.id)}
                                className={`px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                                  selected
                                    ? 'bg-[#084F4E] text-white border-[#084F4E]'
                                    : 'bg-white text-[#3F4F4F] border-[#084F4E]/20 hover:bg-[#E6F4F4]'
                                }`}
                              >
                                {pl.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
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
                            actorEmail: portalUser.email,
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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <input
                type="search"
                placeholder="Search invoice #, name, org..."
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                className="w-full sm:w-64 min-h-[40px] px-4 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
              />
              <select
                value={invoiceStatusFilter}
                onChange={(e) => setInvoiceStatusFilter(e.target.value)}
                className="w-full sm:w-auto min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-sm bg-white"
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
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 min-h-[40px] px-4 py-2 rounded-xl border border-[#084F4E]/20 text-xs font-semibold text-[#084F4E]"
            >
              <Download className="w-4 h-4" />
              <span>Export CSV</span>
            </button>
          </div>

          <div className="space-y-3">
            {filteredInvoices.map((inv) => {
              const actingHere = invoiceAction?.id === inv.id;
              return (
                <div
                  key={inv.id}
                  className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
                            className="inline-flex items-center gap-1 min-h-[36px] px-3 py-1.5 rounded-lg bg-[#084F4E] text-white text-xs font-semibold"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                            <span>New payment link</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setInvoiceAction({
                                id: inv.id,
                                kind: 'manual_paid',
                                reason: '',
                              })
                            }
                            className="inline-flex items-center gap-1 min-h-[36px] px-3 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E]"
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
                            className="inline-flex items-center gap-1 min-h-[36px] px-3 py-1.5 rounded-lg border border-red-200 text-xs text-red-700"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>Void</span>
                          </button>
                        </>
                      )}
                      {inv.status === 'paid' && (
                        <button
                          type="button"
                          onClick={() =>
                            setInvoiceAction({
                              id: inv.id,
                              kind: 'refund',
                              reason: '',
                            })
                          }
                          className="min-h-[36px] px-3 py-1.5 rounded-lg border border-red-200 text-xs text-red-700"
                        >
                          Refund
                        </button>
                      )}
                    </div>
                  </div>

                  {actingHere && invoiceAction && (
                    <div className="pt-3 border-t border-[#084F4E]/10 flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        placeholder={
                          invoiceAction.kind === 'manual_paid'
                            ? 'Reference or reason (e.g. Bank transfer ref #123)'
                            : 'Refund reason'
                        }
                        value={invoiceAction.reason}
                        onChange={(e) =>
                          setInvoiceAction({ ...invoiceAction, reason: e.target.value })
                        }
                        className="flex-1 min-h-[38px] px-3 py-1.5 rounded-xl border border-[#084F4E]/20 text-xs"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={!invoiceAction.reason.trim()}
                          onClick={() => void submitInvoiceAction(inv)}
                          className="px-4 py-1.5 rounded-xl bg-[#084F4E] text-white text-xs font-semibold disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setInvoiceAction(null)}
                          className="px-3 py-1.5 rounded-xl border border-[#084F4E]/20 text-xs text-[#3F4F4F]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === 'coupons' && (
        <div className="grid lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          <form
            onSubmit={(e) => void handleCreateCoupon(e)}
            className="lg:col-span-5 rounded-2xl border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-4"
          >
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">Create coupon</h2>
            <input
              required
              placeholder="CODE (e.g. KIGALI20)"
              value={cCode}
              onChange={(e) => setCCode(e.target.value.toUpperCase())}
              className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm uppercase"
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                value={cType}
                onChange={(e) => setCType(e.target.value as 'percent' | 'fixed')}
                className="min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs bg-white"
              >
                <option value="percent">% Off</option>
                <option value="fixed">USD Off</option>
              </select>
              <input
                type="number"
                min={1}
                value={cValue}
                onChange={(e) => setCValue(Number(e.target.value) || 10)}
                className="min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs tabular-nums"
              />
              <input
                type="number"
                min={1}
                value={cLimit}
                onChange={(e) => setCLimit(Number(e.target.value) || 50)}
                className="min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs tabular-nums"
              />
            </div>
            <button
              type="submit"
              className="w-full sm:w-auto min-h-[42px] px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold"
            >
              Save coupon
            </button>
          </form>

          <div className="lg:col-span-7 space-y-3">
            {coupons.map((c) => (
              <div
                key={c.code}
                className="rounded-2xl border border-[#084F4E]/12 bg-white p-4 flex flex-wrap items-center justify-between gap-3 text-sm"
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
        <div className="grid lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          <form
            onSubmit={(e) => void handleCreatePlan(e)}
            className="lg:col-span-5 rounded-2xl border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#0E7C7B]" />
              <h2 className="font-display text-xl font-semibold text-[#084F4E]">Add learning plan</h2>
            </div>
            <p className="text-xs text-[#3F4F4F]">
              Teachers create plans from their Teacher Desk, and admins can also manage all plans here.
            </p>
            <input
              required
              maxLength={120}
              placeholder="Plan name"
              value={pName}
              onChange={(e) => setPName(e.target.value)}
              className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />
            <textarea
              required
              rows={2}
              maxLength={600}
              placeholder="Plan objective (e.g. Speak confidently in medical & community settings)"
              value={pObjective}
              onChange={(e) => setPObjective(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />
            <textarea
              rows={2}
              maxLength={600}
              placeholder="Description"
              value={pDesc}
              onChange={(e) => setPDesc(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                value={pLevel}
                onChange={(e) => setPLevel(e.target.value)}
                className="min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-sm bg-white"
              >
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
                <option value="All levels">All levels</option>
              </select>
              <input
                type="number"
                min={0}
                value={pPriceUsd}
                onChange={(e) => setPPriceUsd(Math.max(0, Number(e.target.value) || 0))}
                className="min-h-[40px] px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm tabular-nums"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-[#3F4F4F]">
              <input
                type="checkbox"
                checked={pPublicEnrol}
                onChange={(e) => setPPublicEnrol(e.target.checked)}
              />
              <span>Show on public enrolment storefront</span>
            </label>
            <button
              type="submit"
              className="w-full sm:w-auto min-h-[42px] px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold"
            >
              Create plan
            </button>
          </form>

          <div className="lg:col-span-7 space-y-3">
            {plans.map((pl) => (
              <div
                key={pl.id}
                className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
              >
                <div className="space-y-1">
                  <p className="font-semibold text-[#084F4E]">
                    {pl.name} · {formatMoney(pl.unitPriceCents, pl.currency)}
                    {pl.level ? ` · ${pl.level}` : ''}
                  </p>
                  {pl.teacherName && (
                    <p className="text-xs text-[#0E7C7B]">Created by {pl.teacherName}</p>
                  )}
                  {pl.objective && (
                    <p className="text-xs text-[#1F2A2A]">
                      <strong>Objective:</strong> {pl.objective}
                    </p>
                  )}
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
                  className="self-start px-3 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E] shrink-0"
                >
                  {pl.active ? 'Active' : 'Archived'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'groups' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 space-y-3">
            <h2 className="font-display text-lg font-semibold text-[#084F4E]">Teams ({teams.length})</h2>
            {teams.map((t) => {
              const applied = t.assignedPlanIds || (t.planId ? [t.planId] : []);
              return (
                <div key={t.id} className="text-sm border-b border-[#084F4E]/10 pb-3 space-y-2">
                  <div>
                    <p className="font-medium text-[#084F4E]">{t.name}</p>
                    <p className="text-xs text-[#3F4F4F] tabular-nums">
                      Owner: {t.ownerName} · {t.seatsUsed}/{t.seatsTotal} seats
                    </p>
                  </div>
                  {activePlans.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {activePlans.map((pl) => {
                        const has = applied.includes(pl.id);
                        return (
                          <button
                            key={pl.id}
                            type="button"
                            onClick={() => void toggleTeamPlan(t, pl.id)}
                            className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors ${
                              has
                                ? 'bg-[#084F4E] text-white border-[#084F4E]'
                                : 'bg-white text-[#3F4F4F] border-[#084F4E]/20 hover:bg-[#E6F4F4]'
                            }`}
                          >
                            {pl.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
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
        <div className="grid lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          <form
            onSubmit={(e) => void handlePublishAnnouncement(e)}
            className="lg:col-span-6 rounded-2xl border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-4"
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
              className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
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
              className="w-full sm:w-auto min-h-[42px] px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold"
            >
              Publish announcement
            </button>
          </form>

          <div className="lg:col-span-6 rounded-2xl border border-[#084F4E]/12 bg-[#FAFBFB] p-5 sm:p-6 space-y-3">
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-3">
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

          <div className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-3">
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
