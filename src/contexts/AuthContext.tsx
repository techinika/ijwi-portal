import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db, formatPortalError, googleProvider } from '../lib/firebase';
import {
  DEFAULT_WEEKLY_AVAILABILITY,
  ensurePortalSeeded,
  teacherInviteDocId,
} from '../lib/seed';
import { createEnrolmentInvoice, dispatchPortalEmail } from '../lib/portalActions';
import { apiFetch } from '../lib/api';
import { calculateEnrolmentQuote, type PriceQuote } from '../shared/pricing';
import { useToast } from './ToastContext';
import type {
  Announcement,
  NotificationItem,
  PortalInvoice,
  PortalPlan,
  PortalUser,
  TeacherInvite,
} from '../types/portal';

export interface PendingEnrolment {
  plan: PortalPlan;
  mode: 'individual' | 'team';
  seats: number;
  ownerIsLearner: boolean;
  organisation?: string;
  couponCode?: string;
  quote: PriceQuote;
}

const PENDING_ENROLMENT_KEY = 'ijwi_pending_enrolment';

export function savePendingEnrolment(data: PendingEnrolment): void {
  sessionStorage.setItem(PENDING_ENROLMENT_KEY, JSON.stringify(data));
}

export function loadPendingEnrolment(): PendingEnrolment | null {
  try {
    const raw = sessionStorage.getItem(PENDING_ENROLMENT_KEY);
    return raw ? (JSON.parse(raw) as PendingEnrolment) : null;
  } catch {
    return null;
  }
}

export function clearPendingEnrolment(): void {
  sessionStorage.removeItem(PENDING_ENROLMENT_KEY);
}

interface AuthContextValue {
  firebaseUser: User | null;
  portalUser: PortalUser | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  pendingRedirectPath: string | null;
  clearPendingRedirectPath: () => void;
  unpaidInvoices: PortalInvoice[];
  notifications: NotificationItem[];
  announcements: Announcement[];
  signInWithGoogle: () => Promise<PortalUser | null>;
  logout: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const BOOTSTRAP_ADMIN_EMAIL = 'kiny.study@gmail.com';

function normalizePortalUser(
  raw: Partial<PortalUser> & Record<string, unknown>,
  fbUser: User
): PortalUser {
  const isBootstrapAdmin =
    fbUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL && fbUser.emailVerified;
  const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const role =
    isBootstrapAdmin
      ? 'admin'
      : raw.role === 'admin' || raw.role === 'teacher' || raw.role === 'student'
        ? raw.role
        : 'student';

  return {
    uid: (typeof raw.uid === 'string' && raw.uid) || fbUser.uid,
    email: (typeof raw.email === 'string' && raw.email) || fbUser.email || '',
    displayName:
      (typeof raw.displayName === 'string' && raw.displayName) ||
      (typeof raw.name === 'string' && raw.name) ||
      fbUser.displayName ||
      fbUser.email?.split('@')[0] ||
      'Learner',
    photoUrl:
      (typeof raw.photoUrl === 'string' && raw.photoUrl) ||
      (typeof raw.photoURL === 'string' && raw.photoURL) ||
      fbUser.photoURL ||
      '',
    role,
    timezone: (typeof raw.timezone === 'string' && raw.timezone) || detectedTz,
    organisation: typeof raw.organisation === 'string' ? raw.organisation : undefined,
    status: raw.status === 'suspended' ? 'suspended' : 'active',
    teamId: typeof raw.teamId === 'string' ? raw.teamId : undefined,
    groupId: typeof raw.groupId === 'string' ? raw.groupId : undefined,
    teacherId: typeof raw.teacherId === 'string' ? raw.teacherId : undefined,
    assignedPlanIds: Array.isArray(raw.assignedPlanIds)
      ? raw.assignedPlanIds.filter((x): x is string => typeof x === 'string')
      : undefined,
    accessActive: isBootstrapAdmin ? true : Boolean(raw.accessActive),
    isTeamOwner: Boolean(raw.isTeamOwner),
    placementLevel: typeof raw.placementLevel === 'string' ? raw.placementLevel : undefined,
    noShowCount: typeof raw.noShowCount === 'number' ? raw.noShowCount : 0,
    lateCancelCount: typeof raw.lateCancelCount === 'number' ? raw.lateCancelCount : 0,
    emailPrefs:
      raw.emailPrefs && typeof raw.emailPrefs === 'object'
        ? (raw.emailPrefs as PortalUser['emailPrefs'])
        : {
            reminders: true,
            weeklyDigest: true,
            community: true,
            announcements: true,
          },
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function formatFirebaseAuthError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';

  switch (code) {
    case 'auth/unauthorized-domain':
      return `Google sign-in is not yet authorized for "${host}". Add "${host}" in Firebase Console → Authentication → Settings → Authorized domains.`;
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in popup. Please allow popups for this site and try again.';
    case 'auth/popup-closed-by-user':
      return 'Sign-in was cancelled before completing.';
    case 'auth/cancelled-popup-request':
      return 'A sign-in popup is already open. Please finish signing in there.';
    case 'auth/network-request-failed':
      return 'Network error contacting Google sign-in. Check your connection and try again.';
    case 'auth/invalid-api-key':
    case 'auth/configuration-not-found':
      return 'Firebase configuration is invalid or incomplete on this deployment. Verify your VITE_FIREBASE_* environment variables.';
    default:
      return err instanceof Error ? err.message : 'Unable to sign in with Google right now.';
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [portalUser, setPortalUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingRedirectPath, setPendingRedirectPath] = useState<string | null>(null);
  const [unpaidInvoices, setUnpaidInvoices] = useState<PortalInvoice[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  // Single-flight lock per uid so onAuthStateChanged & signInWithGoogle never race on setDoc
  const profileInFlight = useRef<Map<string, Promise<PortalUser>>>(new Map());

  async function ensureUserProfile(fbUser: User): Promise<PortalUser> {
    const existingPromise = profileInFlight.current.get(fbUser.uid);
    if (existingPromise) return existingPromise;

    const task = (async (): Promise<PortalUser> => {
      const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const isBootstrapAdmin =
        fbUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL && fbUser.emailVerified;
      const userRef = doc(db, 'users', fbUser.uid);

      try {
        // Check if this Google user has an admin-issued pending teacher invite
        let claimedTeacherInvite: TeacherInvite | null = null;
        if (fbUser.email && fbUser.emailVerified) {
          try {
            const inviteKey = teacherInviteDocId(fbUser.email);
            const invSnap = await getDoc(doc(db, 'portal_teacher_invites', inviteKey));
            if (invSnap.exists()) {
              const inv = { id: invSnap.id, ...(invSnap.data() as Omit<TeacherInvite, 'id'>) };
              if (
                !inv.revoked &&
                inv.email.toLowerCase() === fbUser.email.toLowerCase() &&
                (!inv.claimedBy || inv.claimedBy === fbUser.uid)
              ) {
                claimedTeacherInvite = inv;
              }
            }
          } catch {
            // ignore if no invite
          }
        }

        const snap = await getDoc(userRef);
        let ensuredProfile: PortalUser;

        if (!snap.exists()) {
          const initialRole = isBootstrapAdmin
            ? 'admin'
            : claimedTeacherInvite
              ? 'teacher'
              : 'student';
          const initialAccess = isBootstrapAdmin || Boolean(claimedTeacherInvite);

          const newProfile: Omit<PortalUser, 'createdAt' | 'updatedAt'> = {
            uid: fbUser.uid,
            email: fbUser.email || '',
            displayName:
              claimedTeacherInvite?.displayName ||
              fbUser.displayName ||
              fbUser.email?.split('@')[0] ||
              'Learner',
            photoUrl: fbUser.photoURL || claimedTeacherInvite?.photoUrl || '',
            role: initialRole,
            timezone: detectedTz,
            status: 'active',
            accessActive: initialAccess,
            isTeamOwner: false,
            noShowCount: 0,
            lateCancelCount: 0,
            emailPrefs: {
              reminders: true,
              weeklyDigest: true,
              community: true,
              announcements: true,
            },
          };
          await setDoc(userRef, {
            ...newProfile,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          void dispatchPortalEmail({
            userId: fbUser.uid,
            to: newProfile.email,
            recipientName: newProfile.displayName,
            type: 'welcome',
            subject: claimedTeacherInvite
              ? 'Muraho! Your Ijwi Teacher Desk is ready'
              : 'Muraho! Welcome to Ijwi Portal',
            headline: claimedTeacherInvite ? 'Welcome to the Ijwi Teaching Team' : 'Welcome to Ijwi',
            bodyText: claimedTeacherInvite
              ? 'Your teacher account is active. Open your Teacher Desk to set your weekly hours, create learning plans, and share resources.'
              : 'Your account is ready. Complete your enrolment or pay your waiting invoice to meet your Kinyarwanda teacher and study circle.',
            ctaLabel: claimedTeacherInvite ? 'Open Teacher Desk' : 'Open Ijwi Portal',
            ctaUrl: claimedTeacherInvite ? '/teacher' : '/',
            essential: true,
          });

          ensuredProfile = normalizePortalUser(newProfile as Record<string, unknown>, fbUser);
        } else {
          const rawData = snap.data() as Record<string, unknown>;
          if (isBootstrapAdmin && rawData.role !== 'admin') {
            await updateDoc(userRef, {
              role: 'admin',
              accessActive: true,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          } else if (claimedTeacherInvite && rawData.role !== 'teacher' && rawData.role !== 'admin') {
            await updateDoc(userRef, {
              role: 'teacher',
              accessActive: true,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
            rawData.role = 'teacher';
            rawData.accessActive = true;
          }
          ensuredProfile = normalizePortalUser(rawData, fbUser);
        }

        // Complete claiming the teacher profile if a valid invite matched
        if (claimedTeacherInvite) {
          try {
            const teacherRef = doc(db, 'portal_teachers', fbUser.uid);
            const tSnap = await getDoc(teacherRef);
            if (!tSnap.exists()) {
              await setDoc(teacherRef, {
                uid: fbUser.uid,
                email: fbUser.email || claimedTeacherInvite.email,
                displayName: claimedTeacherInvite.displayName || ensuredProfile.displayName,
                photoUrl: fbUser.photoURL || claimedTeacherInvite.photoUrl || '',
                bio: claimedTeacherInvite.bio || 'Kinyarwanda teacher at Ijwi.',
                availability: DEFAULT_WEEKLY_AVAILABILITY,
                daysOff: [],
                lessonLengthMin: claimedTeacherInvite.lessonLengthMin || 45,
                bufferMin: claimedTeacherInvite.bufferMin ?? 15,
                maxPerDay: claimedTeacherInvite.maxPerDay || 6,
                active: true,
                pendingClaim: false,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
            if (!claimedTeacherInvite.claimedBy) {
              await updateDoc(doc(db, 'portal_teacher_invites', claimedTeacherInvite.id), {
                claimedBy: fbUser.uid,
                updatedAt: serverTimestamp(),
              });
            }
            if (
              claimedTeacherInvite.teacherProfileId &&
              claimedTeacherInvite.teacherProfileId !== fbUser.uid
            ) {
              await updateDoc(doc(db, 'portal_teachers', claimedTeacherInvite.teacherProfileId), {
                active: false,
                pendingClaim: false,
                updatedAt: serverTimestamp(),
              }).catch(() => {});
            }
          } catch (claimErr) {
            console.warn('Teacher invite claim step skipped:', claimErr);
          }
        }

        return ensuredProfile;
      } catch (err) {
        console.error('Error ensuring user profile in Firestore:', err);
        return normalizePortalUser({}, fbUser);
      }
    })();

    profileInFlight.current.set(fbUser.uid, task);
    try {
      return await task;
    } finally {
      profileInFlight.current.delete(fbUser.uid);
    }
  }

  async function processPendingEnrolment(activeProfile: PortalUser): Promise<string | null> {
    const pending = loadPendingEnrolment();
    if (!pending) return null;

    let verifiedQuote = pending.quote;
    if (!verifiedQuote) {
      verifiedQuote = calculateEnrolmentQuote({
        unitPriceCents: pending.plan.unitPriceCents,
        seats: pending.seats,
        currency: pending.plan.currency,
      });
      try {
        const res = await apiFetch<{ quote: PriceQuote }>('/api/pricing/quote', {
          method: 'POST',
          timeoutMs: 6_000,
          body: JSON.stringify({
            planId: pending.plan.id,
            unitPriceCents: pending.plan.unitPriceCents,
            seats: pending.seats,
            currency: pending.plan.currency,
          }),
        });
        verifiedQuote = res.quote;
      } catch {
        // Fallback to local quote
      }
    }

    try {
      const { invoiceId } = await createEnrolmentInvoice({
        user: activeProfile,
        plan: pending.plan,
        mode: pending.mode,
        seats: pending.seats,
        ownerIsLearner: pending.ownerIsLearner,
        organisation: pending.organisation,
        couponCode: pending.couponCode,
        quote: verifiedQuote,
      });
      clearPendingEnrolment();
      const targetPath = `/invoices/${invoiceId}`;
      setPendingRedirectPath(targetPath);
      toast.success('Invoice created! Opening your payment details.');
      return targetPath;
    } catch (err) {
      const msg = formatPortalError(err, 'Unable to create your enrolment invoice.');
      toast.error(msg);
      throw new Error(msg);
    }
  }

  useEffect(() => {
    let unsubUser: (() => void) | undefined;
    let unsubInvoices: (() => void) | undefined;
    let unsubNotifications: (() => void) | undefined;
    let unsubAnnouncements: (() => void) | undefined;

    // Complete redirect sign-in flow if a mobile/popup-blocked browser used signInWithRedirect
    void getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          const profile = await ensureUserProfile(result.user);
          setPortalUser(profile);
          await processPendingEnrolment(profile);
        }
      })
      .catch((err) => {
        setAuthError(formatPortalError(err, formatFirebaseAuthError(err)));
      });

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (unsubUser) unsubUser();
      if (unsubInvoices) unsubInvoices();
      if (unsubNotifications) unsubNotifications();
      if (unsubAnnouncements) unsubAnnouncements();

      if (!fbUser) {
        setPortalUser(null);
        setUnpaidInvoices([]);
        setNotifications([]);
        setAnnouncements([]);
        setLoading(false);
        return;
      }

      setAuthError(null);

      // Immediately set an optimistic normalized profile so the navbar updates at once
      setPortalUser((prev) => prev && prev.uid === fbUser.uid ? prev : normalizePortalUser({}, fbUser));
      setLoading(false);

      const ensured = await ensureUserProfile(fbUser);
      setPortalUser(ensured);

      const isBootstrapAdmin =
        fbUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL && fbUser.emailVerified;
      if (isBootstrapAdmin) {
        void ensurePortalSeeded(true);
      }

      const userRef = doc(db, 'users', fbUser.uid);
      unsubUser = onSnapshot(
        userRef,
        (docSnap) => {
          if (docSnap.exists()) {
            setPortalUser(normalizePortalUser(docSnap.data() as Record<string, unknown>, fbUser));
          }
          setLoading(false);
        },
        (error) => {
          console.warn('User snapshot error:', error);
          setLoading(false);
        }
      );

      const invQuery = query(
        collection(db, 'portal_invoices'),
        where('payerId', '==', fbUser.uid)
      );
      unsubInvoices = onSnapshot(
        invQuery,
        (snap) => {
          const list = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<PortalInvoice, 'id'>) }))
            .filter((i) => i.status === 'unpaid');
          setUnpaidInvoices(list);
        },
        (error) => {
          console.warn('Invoice listener error:', error);
        }
      );

      const notifQuery = query(
        collection(db, 'portal_notifications', fbUser.uid, 'items'),
        where('userId', '==', fbUser.uid),
        orderBy('createdAt', 'desc')
      );
      unsubNotifications = onSnapshot(
        notifQuery,
        (snap) => {
          setNotifications(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }))
          );
        },
        () => {
          // ignore index lag on first boot
        }
      );

      const annQuery = query(
        collection(db, 'portal_announcements'),
        where('active', '==', true)
      );
      unsubAnnouncements = onSnapshot(
        annQuery,
        (snap) => {
          setAnnouncements(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Announcement, 'id'>) }))
          );
        },
        () => {
          // ignore
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubUser) unsubUser();
      if (unsubInvoices) unsubInvoices();
      if (unsubNotifications) unsubNotifications();
      if (unsubAnnouncements) unsubAnnouncements();
    };
  }, []);

  async function signInWithGoogle(): Promise<PortalUser | null> {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const fbUser = cred.user;
      setFirebaseUser(fbUser);

      const activeProfile = await ensureUserProfile(fbUser);
      setPortalUser(activeProfile);
      setLoading(false);

      const isBootstrapAdmin =
        fbUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL && fbUser.emailVerified;
      if (isBootstrapAdmin) {
        await ensurePortalSeeded(true);
      }

      await processPendingEnrolment(activeProfile);
      return activeProfile;
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';

      // If browser blocked popup and we are in a top-level window (e.g. Vercel / mobile), fall back to redirect
      if (code === 'auth/popup-blocked' && typeof window !== 'undefined' && window.self === window.top) {
        await signInWithRedirect(auth, googleProvider);
        return null;
      }

      const msg = formatPortalError(err, formatFirebaseAuthError(err));
      setAuthError(msg);
      toast.error(msg);
      throw new Error(msg);
    }
  }

  async function logout() {
    setAuthError(null);
    await signOut(auth);
    toast.info('Signed out of Ijwi Portal.');
  }

  async function markNotificationRead(id: string) {
    if (!firebaseUser) return;
    await updateDoc(doc(db, 'portal_notifications', firebaseUser.uid, 'items', id), {
      read: true,
    });
  }

  async function markAllNotificationsRead() {
    if (!firebaseUser) return;
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    await Promise.allSettled(
      unread.map((n) =>
        updateDoc(doc(db, 'portal_notifications', firebaseUser.uid, 'items', n.id), {
          read: true,
        })
      )
    );
  }

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        portalUser,
        loading,
        authError,
        clearAuthError: () => setAuthError(null),
        pendingRedirectPath,
        clearPendingRedirectPath: () => setPendingRedirectPath(null),
        unpaidInvoices,
        notifications,
        announcements,
        signInWithGoogle,
        logout,
        markNotificationRead,
        markAllNotificationsRead,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
