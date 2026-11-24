import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
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
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { ensurePortalSeeded } from '../lib/seed';
import { createEnrolmentInvoice, dispatchPortalEmail } from '../lib/portalActions';
import { apiFetch } from '../lib/api';
import type {
  Announcement,
  NotificationItem,
  PortalInvoice,
  PortalPlan,
  PortalUser,
} from '../types/portal';
import type { PriceQuote } from '../shared/pricing';

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
  unpaidInvoices: PortalInvoice[];
  notifications: NotificationItem[];
  announcements: Announcement[];
  signInWithGoogle: () => Promise<PortalUser | null>;
  logout: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const BOOTSTRAP_ADMIN_EMAIL = 'kiny.study@gmail.com';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [portalUser, setPortalUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [unpaidInvoices, setUnpaidInvoices] = useState<PortalInvoice[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  useEffect(() => {
    let unsubUser: (() => void) | undefined;
    let unsubInvoices: (() => void) | undefined;
    let unsubNotifications: (() => void) | undefined;
    let unsubAnnouncements: (() => void) | undefined;

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

      const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const isBootstrapAdmin =
        fbUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL && fbUser.emailVerified;

      const userRef = doc(db, 'users', fbUser.uid);
      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const newProfile: Omit<PortalUser, 'createdAt' | 'updatedAt'> = {
            uid: fbUser.uid,
            email: fbUser.email || '',
            displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Learner',
            photoUrl: fbUser.photoURL || '',
            role: isBootstrapAdmin ? 'admin' : 'student',
            timezone: detectedTz,
            status: 'active',
            accessActive: isBootstrapAdmin,
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
            subject: 'Muraho! Welcome to Ijwi Portal',
            headline: 'Welcome to Ijwi',
            bodyText:
              'Your account is ready. Complete your enrolment or pay your waiting invoice to meet your Kinyarwanda teacher and study circle.',
            ctaLabel: 'Open Ijwi Portal',
            ctaUrl: '/',
            essential: true,
          });
        } else if (isBootstrapAdmin && snap.data().role !== 'admin') {
          await updateDoc(userRef, {
            role: 'admin',
            accessActive: true,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.error('Error ensuring user profile:', err);
      }

      if (isBootstrapAdmin) {
        void ensurePortalSeeded(true);
      }

      unsubUser = onSnapshot(
        userRef,
        (docSnap) => {
          if (docSnap.exists()) {
            setPortalUser(docSnap.data() as PortalUser);
          }
          setLoading(false);
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, `users/${fbUser.uid}`);
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
          handleFirestoreError(error, OperationType.LIST, 'portal_invoices');
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
    const cred = await signInWithPopup(auth, googleProvider);
    const fbUser = cred.user;
    const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const isBootstrapAdmin =
      fbUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL && fbUser.emailVerified;

    const userRef = doc(db, 'users', fbUser.uid);
    let userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      const profile: PortalUser = {
        uid: fbUser.uid,
        email: fbUser.email || '',
        displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Learner',
        photoUrl: fbUser.photoURL || '',
        role: isBootstrapAdmin ? 'admin' : 'student',
        timezone: detectedTz,
        status: 'active',
        accessActive: isBootstrapAdmin,
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
        ...profile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      userSnap = await getDoc(userRef);
    }

    const activeProfile = userSnap.data() as PortalUser;
    if (isBootstrapAdmin) {
      await ensurePortalSeeded(true);
    }

    // Check if visitor queued an enrolment before signing in
    const pending = loadPendingEnrolment();
    if (pending) {
      clearPendingEnrolment();
      // Re-verify quote on server before creating invoice
      let verifiedQuote = pending.quote;
      try {
        const res = await apiFetch<{ quote: PriceQuote }>('/api/pricing/quote', {
          method: 'POST',
          body: JSON.stringify({
            planId: pending.plan.id,
            unitPriceCents: pending.plan.unitPriceCents,
            seats: pending.seats,
            currency: pending.plan.currency,
          }),
        });
        verifiedQuote = res.quote;
      } catch {
        // use pending server-calculated quote
      }

      const { invoiceId } = await createEnrolmentInvoice({
        user: activeProfile,
        plan: pending.plan,
        mode: pending.mode,
        seats: pending.seats,
        ownerIsLearner: pending.ownerIsLearner,
        organisation: pending.organisation,
        couponCode: pending.couponCode,
        quote: pending.quote || verifiedQuote,
      });
      window.history.pushState({}, '', `/invoices/${invoiceId}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }

    return activeProfile;
  }

  async function logout() {
    await signOut(auth);
  }

  async function markNotificationRead(id: string) {
    if (!firebaseUser) return;
    await updateDoc(doc(db, 'portal_notifications', firebaseUser.uid, 'items', id), {
      read: true,
    });
  }

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        portalUser,
        loading,
        unpaidInvoices,
        notifications,
        announcements,
        signInWithGoogle,
        logout,
        markNotificationRead,
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
