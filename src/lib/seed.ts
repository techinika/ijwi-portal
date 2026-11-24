import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import type { PortalPlan, TeacherProfile, PortalSettings } from '../types/portal';

export const DEFAULT_PLANS: Array<Omit<PortalPlan, 'createdAt' | 'updatedAt'>> = [
  {
    id: 'kinyarwanda-core',
    name: 'Kinyarwanda Foundations & Conversation',
    objective:
      'Hold warm everyday conversations in Kinyarwanda, master polite greetings, navigate daily life in Rwanda, and understand core noun-class patterns.',
    description:
      'Learn real-world Kinyarwanda with a dedicated Rwandan teacher, a structured level path, private study resources, and a supportive cohort.',
    level: 'All levels',
    teacherId: 'ijwi-curriculum',
    teacherName: 'Ijwi Teaching Team',
    unitPriceCents: 4000, // USD 40 per person
    currency: 'USD',
    included: [
      'Dedicated Kinyarwanda teacher & 1-on-1 lesson bookings',
      'Structured 3-level learning path with personal notes',
      'Curated audio, video, and reading guides',
      'Study group cohort (up to 8) or private team workspace',
      'Level completion certificate with public verification',
    ],
    learningPath: [
      {
        id: 'level-1',
        title: 'Level 1 · Warm Greetings & Everyday Politeness',
        description: 'Greet respectfully across times of day, introduce yourself, and ask about family.',
        lessons: [
          { id: 'l1-greetings', title: '1.1 Muraho, Mwaramutse & Mwiriwe', summary: 'Morning, afternoon, and polite forms of greeting.' },
          { id: 'l1-intro', title: '1.2 Introducing Yourself & Origins', summary: 'Names, where you live, and what you do.' },
          { id: 'l1-numbers', title: '1.3 Numbers, Time & Market Basics', summary: 'Counting, telling time, and asking prices.' },
        ],
      },
      {
        id: 'level-2',
        title: 'Level 2 · Daily Life, Verbs & Conversations',
        description: 'Build natural present, past, and future sentences for work, travel, and community.',
        lessons: [
          { id: 'l2-verbs', title: '2.1 Everyday Verbs & Present Tense', summary: 'Going, working, speaking, eating, and learning.' },
          { id: 'l2-directions', title: '2.2 Navigating Kigali & Giving Directions', summary: 'Asking how to get places and describing neighbourhoods.' },
          { id: 'l2-food', title: '2.3 Food, Hospitality & Sharing a Meal', summary: 'Ordering, thanking hosts, and polite requests.' },
        ],
      },
      {
        id: 'level-3',
        title: 'Level 3 · Noun Classes & Storytelling',
        description: 'Speak fluidly using agreement patterns, proverbs, and natural stories.',
        lessons: [
          { id: 'l3-noun-classes', title: '3.1 Core Noun Classes (umu-/aba-, iki-/ibi-)', summary: 'Connecting adjectives, verbs, and possessives.' },
          { id: 'l3-past-future', title: '3.2 Past & Future Storytelling', summary: 'Recounting your week and making plans.' },
          { id: 'l3-proverbs', title: '3.3 Idioms, Proverbs & Cultural Nuance', summary: 'Expressions used in everyday Rwandan life.' },
        ],
      },
    ],
    isPublicEnrolment: true,
    active: true,
  },
];

export const DEFAULT_WEEKLY_AVAILABILITY = [
  { dayOfWeek: 1, startHourUtc: 9, startMinuteUtc: 0 },
  { dayOfWeek: 1, startHourUtc: 14, startMinuteUtc: 0 },
  { dayOfWeek: 2, startHourUtc: 9, startMinuteUtc: 0 },
  { dayOfWeek: 2, startHourUtc: 15, startMinuteUtc: 0 },
  { dayOfWeek: 3, startHourUtc: 10, startMinuteUtc: 0 },
  { dayOfWeek: 4, startHourUtc: 9, startMinuteUtc: 0 },
  { dayOfWeek: 5, startHourUtc: 10, startMinuteUtc: 0 },
];

export function teacherInviteDocId(email: string): string {
  return email.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
}

export const DEFAULT_SETTINGS: Omit<PortalSettings, 'updatedAt'> = {
  currency: 'USD',
  invoiceExpiryDays: 30,
  cancelWindowHours: 12,
  groupSize: 8,
  emailSender: 'noreply@mail.ijwi.me',
  maxUploadMb: 60,
  weeklyFlierNote: 'Muraho! Celebrate every small conversation you had in Kinyarwanda this week.',
};

let seedPromise: Promise<void> | null = null;

export async function ensurePortalSeeded(isAdminUser: boolean): Promise<void> {
  if (!isAdminUser) return;
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    try {
      const settingsRef = doc(db, 'portal_settings', 'portal');
      const settingsSnap = await getDoc(settingsRef);
      if (!settingsSnap.exists()) {
        await setDoc(settingsRef, {
          ...DEFAULT_SETTINGS,
          updatedAt: serverTimestamp(),
        });
      }

      const counterRef = doc(db, 'portal_settings', 'counters');
      const counterSnap = await getDoc(counterRef);
      if (!counterSnap.exists()) {
        await setDoc(counterRef, {
          invoiceSeq: 0,
          updatedAt: serverTimestamp(),
        });
      }

      const couponRef = doc(db, 'portal_coupons', 'MURAHO10');
      const couponSnap = await getDoc(couponRef);
      if (!couponSnap.exists()) {
        await setDoc(couponRef, {
          code: 'MURAHO10',
          type: 'percent',
          value: 10,
          usageLimit: 100,
          usedCount: 0,
          perPersonLimit: 1,
          active: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.warn('Seed step skipped or partial:', err);
    }
  })();

  return seedPromise;
}

export async function fetchPublicPlans(): Promise<PortalPlan[]> {
  try {
    const q = query(collection(db, 'portal_plans'), where('active', '==', true));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const livePlans = snap.docs
        .map((d) => ({ ...d.data(), id: d.id } as PortalPlan))
        .filter((p) => p.isPublicEnrolment !== false);
      if (livePlans.length > 0) return livePlans;
    }
  } catch {
    // Fallback to starter plan if offline or unpopulated yet
  }
  return DEFAULT_PLANS;
}

export async function fetchAllActivePlans(): Promise<PortalPlan[]> {
  try {
    const q = query(collection(db, 'portal_plans'), where('active', '==', true));
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs.map((d) => ({ ...d.data(), id: d.id } as PortalPlan));
    }
  } catch {
    // ignore
  }
  return [];
}

export async function fetchActiveTeachers(): Promise<TeacherProfile[]> {
  try {
    const q = query(collection(db, 'portal_teachers'), where('active', '==', true));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as TeacherProfile);
  } catch {
    return [];
  }
}
