import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  deleteDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { apiFetch } from './api';
import type {
  PortalInvoice,
  PortalPlan,
  PortalTeam,
  PortalUser,
  StudyGroup,
  TeacherProfile,
} from '../types/portal';
import type { PriceQuote } from '../shared/pricing';

export async function logAudit(params: {
  actorId: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}): Promise<void> {
  const id = `aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await setDoc(doc(db, 'portal_auditLog', id), {
      ...params,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Audit log write skipped:', err);
  }
}

export async function pushNotification(params: {
  userId: string;
  title: string;
  body: string;
  type: string;
  link?: string;
}): Promise<void> {
  const id = `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await setDoc(doc(db, 'portal_notifications', params.userId, 'items', id), {
      userId: params.userId,
      title: params.title,
      body: params.body,
      type: params.type,
      ...(params.link ? { link: params.link } : {}),
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Notification push skipped:', err);
  }
}

export async function dispatchPortalEmail(params: {
  userId: string;
  to: string;
  recipientName?: string;
  type: string;
  subject: string;
  headline: string;
  bodyText: string;
  ctaLabel?: string;
  ctaUrl?: string;
  essential?: boolean;
  userPrefs?: PortalUser['emailPrefs'];
}): Promise<void> {
  if (!params.essential && params.userPrefs) {
    if (params.type === 'booking_reminder' && !params.userPrefs.reminders) return;
    if (params.type === 'weekly_digest' && !params.userPrefs.weeklyDigest) return;
    if (params.type === 'session_update' && !params.userPrefs.community) return;
    if (params.type === 'announcement' && !params.userPrefs.announcements) return;
  }

  try {
    const result = await apiFetch<{ status: 'sent' | 'logged' | 'failed'; subject: string; previewText: string }>(
      '/api/emails/dispatch',
      {
        method: 'POST',
        body: JSON.stringify({
          to: params.to,
          recipientName: params.recipientName,
          type: params.type,
          subject: params.subject,
          headline: params.headline,
          bodyText: params.bodyText,
          ctaLabel: params.ctaLabel,
          ctaUrl: params.ctaUrl,
          essential: Boolean(params.essential),
        }),
      }
    );

    const logId = `eml-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await setDoc(doc(db, 'portal_emailLog', logId), {
      userId: params.userId,
      to: params.to,
      subject: result.subject,
      type: params.type,
      status: result.status,
      previewText: result.previewText,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Email dispatch error:', err);
  }
}

export async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const counterRef = doc(db, 'portal_settings', 'counters');
  try {
    const seq = await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const current = snap.exists() ? Number(snap.data().invoiceSeq || 0) : 0;
      const next = current + 1;
      if (snap.exists()) {
        tx.update(counterRef, { invoiceSeq: next, updatedAt: serverTimestamp() });
      } else {
        tx.set(counterRef, { invoiceSeq: next, updatedAt: serverTimestamp() });
      }
      return next;
    });
    return `IJW-${year}-${String(seq).padStart(4, '0')}`;
  } catch {
    return `IJW-${year}-${String(Math.floor(1000 + Math.random() * 8999))}`;
  }
}

export async function createEnrolmentInvoice(params: {
  user: PortalUser;
  plan: PortalPlan;
  mode: 'individual' | 'team';
  seats: number;
  ownerIsLearner: boolean;
  organisation?: string;
  couponCode?: string;
  quote: PriceQuote;
  expiryDays?: number;
  existingTeamId?: string;
}): Promise<{ invoiceId: string; teamId?: string }> {
  const { user, plan, mode, seats, ownerIsLearner, organisation, couponCode, quote } = params;
  const invoiceId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const invoiceNumber = await nextInvoiceNumber();
  const dueAt = new Date(Date.now() + (params.expiryDays || 30) * 86400_000).toISOString();

  let teamId = params.existingTeamId || '';
  if (mode === 'team' && !teamId) {
    teamId = `team-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const teamName = organisation?.trim() || `${user.displayName.split(' ')[0]}'s Team`;
    const teamPayload: Omit<PortalTeam, 'id'> = {
      ownerId: user.uid,
      ownerName: user.displayName,
      name: teamName,
      planId: plan.id,
      assignedPlanIds: [plan.id],
      seatsTotal: seats,
      seatsUsed: ownerIsLearner ? 1 : 0,
      invoiceIds: [invoiceId],
      accessActive: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, 'portal_teams', teamId), teamPayload);
      if (ownerIsLearner) {
        await setDoc(doc(db, 'portal_teams', teamId, 'members', user.uid), {
          uid: user.uid,
          ownerId: user.uid,
          displayName: user.displayName,
          email: user.email,
          status: 'joined',
          joinedAt: serverTimestamp(),
        });
      }
      await updateDoc(doc(db, 'users', user.uid), {
        teamId,
        isTeamOwner: true,
        ...(organisation ? { organisation } : {}),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `portal_teams/${teamId}`);
    }
  } else if (organisation) {
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        organisation,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }
  }

  const invoicePayload = {
    number: invoiceNumber,
    payerId: user.uid,
    payerName: user.displayName,
    payerEmail: user.email,
    ...(organisation ? { organisation } : {}),
    ...(teamId ? { teamId } : {}),
    isTopUp: Boolean(params.existingTeamId),
    planId: plan.id,
    planName: plan.name,
    seats,
    ownerIsLearner,
    unitPriceCents: quote.unitPriceCents,
    subtotalCents: quote.subtotalCents,
    teamDiscountPct: quote.teamDiscountPct,
    teamDiscountCents: quote.teamDiscountCents,
    ...(couponCode && quote.couponDiscountCents > 0 ? { couponCode: couponCode.toUpperCase() } : {}),
    couponDiscountCents: quote.couponDiscountCents,
    totalCents: quote.totalCents,
    currency: quote.currency,
    status: 'unpaid',
    dueAt,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'portal_invoices', invoiceId), invoicePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `portal_invoices/${invoiceId}`);
  }

  if (couponCode && quote.couponDiscountCents > 0) {
    try {
      const code = couponCode.trim().toUpperCase();
      const cRef = doc(db, 'portal_coupons', code);
      const cSnap = await getDoc(cRef);
      if (cSnap.exists()) {
        await updateDoc(cRef, {
          usedCount: Number(cSnap.data().usedCount || 0) + 1,
          updatedAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'portal_coupons', code, 'redemptions', user.uid), {
          uid: user.uid,
          invoiceId,
          count: 1,
          redeemedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.warn('Coupon redemption update skipped:', err);
    }
  }

  await pushNotification({
    userId: user.uid,
    title: `Invoice ${invoiceNumber} created`,
    body: `Your ${plan.name} invoice is ready to pay.`,
    type: 'invoice',
    link: `/invoices/${invoiceId}`,
  });

  await dispatchPortalEmail({
    userId: user.uid,
    to: user.email,
    recipientName: user.displayName,
    type: 'invoice_created',
    subject: `Your Ijwi invoice ${invoiceNumber}`,
    headline: `Invoice ${invoiceNumber} is ready`,
    bodyText: `We prepared your invoice for ${plan.name} (${seats} ${seats === 1 ? 'seat' : 'seats'}).\nYou can pay now or return anytime from Profile > Billing.`,
    ctaLabel: 'View & Pay Invoice',
    ctaUrl: `/invoices/${invoiceId}`,
    essential: true,
  });

  await logAudit({
    actorId: user.uid,
    actorEmail: user.email,
    action: 'invoice_created',
    targetType: 'invoice',
    targetId: invoiceId,
    summary: `Created ${invoiceNumber} (${seats} seats, total ${quote.totalCents} ${quote.currency})`,
  });

  return { invoiceId, teamId: teamId || undefined };
}

export async function pickTeacherForLearner(preferredTeacherId?: string): Promise<{ uid: string; displayName: string }> {
  try {
    const q = query(collection(db, 'portal_teachers'), where('active', '==', true));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => d.data() as TeacherProfile);
    if (preferredTeacherId) {
      const match = list.find((t) => t.uid === preferredTeacherId);
      if (match) return { uid: match.uid, displayName: match.displayName };
    }
    const claimed = list.filter((t) => !t.pendingClaim);
    const pool = claimed.length > 0 ? claimed : list;
    if (pool.length > 0) {
      const picked = pool[Math.floor(Math.random() * pool.length)];
      return { uid: picked.uid, displayName: picked.displayName };
    }
  } catch {
    // no active teachers created by admin yet
  }
  return { uid: '', displayName: 'Teacher pending assignment' };
}

export async function assignIndividualStudyGroup(params: {
  user: PortalUser;
  planId: string;
  teacher: { uid: string; displayName: string };
  groupSize?: number;
}): Promise<string> {
  const maxCapacity = params.groupSize || 8;
  const firstName = params.user.displayName.split(' ')[0] || 'Learner';
  try {
    const q = query(collection(db, 'portal_groups'), where('capacity', '<=', 12));
    const snap = await getDocs(q);
    const openGroups = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<StudyGroup, 'id'>) }))
      .filter((g) => g.planId === params.planId && g.memberIds.length < g.capacity);

    if (openGroups.length > 0) {
      const chosen = openGroups[Math.floor(Math.random() * openGroups.length)];
      if (!chosen.memberIds.includes(params.user.uid)) {
        await updateDoc(doc(db, 'portal_groups', chosen.id), {
          memberIds: [...chosen.memberIds, params.user.uid],
          memberFirstNames: [...chosen.memberFirstNames, firstName],
          updatedAt: serverTimestamp(),
        });
      }
      return chosen.id;
    }
  } catch (err) {
    console.warn('Study group lookup fallback:', err);
  }

  const groupId = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const groupNumber = Math.floor(10 + Math.random() * 89);
  await setDoc(doc(db, 'portal_groups', groupId), {
    name: `Kigali Circle ${groupNumber}`,
    planId: params.planId,
    teacherId: params.teacher.uid,
    teacherName: params.teacher.displayName,
    capacity: maxCapacity,
    memberIds: [params.user.uid],
    memberFirstNames: [firstName],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return groupId;
}

export async function activatePaidInvoice(params: {
  invoice: PortalInvoice;
  payer: PortalUser;
  trackingId: string;
  merchantRef: string;
  paymentMethod: string;
  manualReason?: string;
}): Promise<void> {
  const { invoice, payer, trackingId, merchantRef, paymentMethod, manualReason } = params;
  if (invoice.status === 'paid') return; // Idempotent guard

  const paidAt = new Date().toISOString();
  const invRef = doc(db, 'portal_invoices', invoice.id);

  await updateDoc(invRef, {
    status: 'paid',
    paidAt,
    pesapalOrderRef: merchantRef,
    pesapalTrackingId: trackingId,
    paymentMethod,
    ...(manualReason ? { manualReason } : {}),
    updatedAt: serverTimestamp(),
  });

  const payId = `pay-${Date.now()}`;
  await setDoc(doc(db, 'portal_invoices', invoice.id, 'payments', payId), {
    trackingId,
    merchantRef,
    status: 'PAID',
    amountCents: invoice.totalCents,
    currency: invoice.currency,
    method: paymentMethod,
    rawSummary: manualReason ? `Manual verification: ${manualReason}` : `Pesapal verified (${trackingId})`,
    createdAt: serverTimestamp(),
  });

  // Assign teacher if payer doesn't have one yet (check plan's creator teacher first if active)
  let planTeacherId: string | undefined;
  try {
    const pSnap = await getDoc(doc(db, 'portal_plans', invoice.planId));
    if (pSnap.exists()) {
      planTeacherId = (pSnap.data() as PortalPlan).teacherId;
    }
  } catch {
    // ignore
  }

  const teacher = payer.teacherId
    ? { uid: payer.teacherId, displayName: 'Your Ijwi Teacher' }
    : await pickTeacherForLearner(planTeacherId);

  const mergedUserPlanIds = Array.from(new Set([...(payer.assignedPlanIds || []), invoice.planId].filter(Boolean)));

  // If team invoice: activate team & owner (and existing members) without mixing into random groups
  if (invoice.teamId) {
    const teamRef = doc(db, 'portal_teams', invoice.teamId);
    const teamSnap = await getDoc(teamRef);
    if (teamSnap.exists()) {
      const teamData = teamSnap.data() as PortalTeam;
      const newSeatsTotal = invoice.isTopUp
        ? teamData.seatsTotal + invoice.seats
        : teamData.seatsTotal;
      const mergedTeamPlans = Array.from(
        new Set([...(teamData.assignedPlanIds || []), teamData.planId, invoice.planId].filter(Boolean))
      );
      await updateDoc(teamRef, {
        accessActive: true,
        seatsTotal: newSeatsTotal,
        assignedPlanIds: mergedTeamPlans,
        invoiceIds: Array.from(new Set([...(teamData.invoiceIds || []), invoice.id])),
        updatedAt: serverTimestamp(),
      });
    }

    await updateDoc(doc(db, 'users', invoice.payerId), {
      accessActive: invoice.ownerIsLearner || payer.accessActive,
      teamId: invoice.teamId,
      isTeamOwner: true,
      ...(teacher.uid ? { teacherId: teacher.uid } : {}),
      assignedPlanIds: mergedUserPlanIds,
      updatedAt: serverTimestamp(),
    });
  } else {
    // Individual enrolment: assign random study group up to 8 people & teacher
    const groupId =
      payer.groupId ||
      (await assignIndividualStudyGroup({
        user: payer,
        planId: invoice.planId,
        teacher,
      }));

    await updateDoc(doc(db, 'users', invoice.payerId), {
      accessActive: true,
      ...(teacher.uid ? { teacherId: teacher.uid } : {}),
      assignedPlanIds: mergedUserPlanIds,
      groupId,
      updatedAt: serverTimestamp(),
    });
  }

  await pushNotification({
    userId: invoice.payerId,
    title: 'Payment confirmed — Akaze!',
    body: `Invoice ${invoice.number} is paid. Your Kinyarwanda portal is now open.`,
    type: 'payment',
    link: '/dashboard',
  });

  await dispatchPortalEmail({
    userId: invoice.payerId,
    to: invoice.payerEmail,
    recipientName: invoice.payerName,
    type: 'payment_receipt',
    subject: `Receipt for Ijwi invoice ${invoice.number}`,
    headline: 'Murakoze! Your payment is confirmed',
    bodyText: `We received your payment for ${invoice.planName} (${invoice.number}).\nYour teacher ${teacher.displayName} is ready, and you can now book lessons, explore resources, and join sessions.`,
    ctaLabel: 'Open Your Portal',
    ctaUrl: '/dashboard',
    essential: true,
  });

  await logAudit({
    actorId: payer.uid,
    actorEmail: payer.email,
    action: manualReason ? 'invoice_marked_paid_manual' : 'invoice_paid',
    targetType: 'invoice',
    targetId: invoice.id,
    summary: `Invoice ${invoice.number} marked paid (${paymentMethod})`,
  });
}

export async function hashInviteToken(rawToken: string): Promise<string> {
  const data = new TextEncoder().encode(rawToken);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function removeTeamMember(params: {
  teamId: string;
  memberUid: string;
  actor: PortalUser;
}): Promise<void> {
  const { teamId, memberUid, actor } = params;
  await deleteDoc(doc(db, 'portal_teams', teamId, 'members', memberUid));
  const teamRef = doc(db, 'portal_teams', teamId);
  const teamSnap = await getDoc(teamRef);
  if (teamSnap.exists()) {
    const used = Math.max(0, Number(teamSnap.data().seatsUsed || 1) - 1);
    await updateDoc(teamRef, { seatsUsed: used, updatedAt: serverTimestamp() });
  }
  await updateDoc(doc(db, 'users', memberUid), {
    teamId: '',
    accessActive: false,
    updatedAt: serverTimestamp(),
  });
  await logAudit({
    actorId: actor.uid,
    actorEmail: actor.email,
    action: 'team_member_removed',
    targetType: 'team',
    targetId: teamId,
    summary: `Removed member ${memberUid} from team ${teamId}`,
  });
}
