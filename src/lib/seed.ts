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
    description:
      'Learn real-world Kinyarwanda with a dedicated Rwandan teacher, a structured level path, private study resources, and a supportive cohort.',
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
    active: true,
  },
];

export const DEFAULT_TEACHERS: Array<Omit<TeacherProfile, 'createdAt' | 'updatedAt'>> = [
  {
    uid: 'teacher-aline-mukamana',
    displayName: 'Aline Mukamana',
    photoUrl: '/src/assets/images/teacher_aline_portrait_1795519554005.jpg',
    bio: 'Born and raised in Kigali with 8 years teaching Kinyarwanda to international professionals, NGO teams, and families.',
    availability: [
      { dayOfWeek: 1, startHourUtc: 8, startMinuteUtc: 0 },
      { dayOfWeek: 1, startHourUtc: 10, startMinuteUtc: 0 },
      { dayOfWeek: 1, startHourUtc: 15, startMinuteUtc: 0 },
      { dayOfWeek: 2, startHourUtc: 9, startMinuteUtc: 0 },
      { dayOfWeek: 2, startHourUtc: 14, startMinuteUtc: 0 },
      { dayOfWeek: 3, startHourUtc: 8, startMinuteUtc: 0 },
      { dayOfWeek: 3, startHourUtc: 16, startMinuteUtc: 0 },
      { dayOfWeek: 4, startHourUtc: 10, startMinuteUtc: 0 },
      { dayOfWeek: 4, startHourUtc: 15, startMinuteUtc: 0 },
      { dayOfWeek: 5, startHourUtc: 9, startMinuteUtc: 0 },
    ],
    daysOff: [],
    lessonLengthMin: 45,
    bufferMin: 15,
    maxPerDay: 6,
    active: true,
  },
  {
    uid: 'teacher-jean-habimana',
    displayName: 'Jean-Paul Habimana',
    photoUrl: '/src/assets/images/teacher_jean_portrait_1795519554698.jpg',
    bio: 'Applied linguist and conversation coach specialising in tone, noun-class fluency, and workplace Kinyarwanda.',
    availability: [
      { dayOfWeek: 1, startHourUtc: 11, startMinuteUtc: 0 },
      { dayOfWeek: 1, startHourUtc: 17, startMinuteUtc: 0 },
      { dayOfWeek: 2, startHourUtc: 10, startMinuteUtc: 0 },
      { dayOfWeek: 2, startHourUtc: 16, startMinuteUtc: 0 },
      { dayOfWeek: 3, startHourUtc: 12, startMinuteUtc: 0 },
      { dayOfWeek: 4, startHourUtc: 9, startMinuteUtc: 0 },
      { dayOfWeek: 4, startHourUtc: 17, startMinuteUtc: 0 },
      { dayOfWeek: 5, startHourUtc: 11, startMinuteUtc: 0 },
      { dayOfWeek: 6, startHourUtc: 9, startMinuteUtc: 0 },
    ],
    daysOff: [],
    lessonLengthMin: 45,
    bufferMin: 15,
    maxPerDay: 6,
    active: true,
  },
];

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

      for (const plan of DEFAULT_PLANS) {
        const planRef = doc(db, 'portal_plans', plan.id);
        const snap = await getDoc(planRef);
        if (!snap.exists()) {
          await setDoc(planRef, {
            ...plan,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      for (const teacher of DEFAULT_TEACHERS) {
        const teacherRef = doc(db, 'portal_teachers', teacher.uid);
        const snap = await getDoc(teacherRef);
        if (!snap.exists()) {
          await setDoc(teacherRef, {
            ...teacher,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
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

      const resRef = doc(db, 'portal_resources', 'res-starter-guide');
      const resSnap = await getDoc(resRef);
      if (!resSnap.exists()) {
        await setDoc(resRef, {
          type: 'pdf',
          title: 'Kinyarwanda Foundations: Greetings & Noun Classes',
          description: 'Essential Level 1 reference sheet with dialogues and noun class patterns.',
          fileKey: 'kinyarwanda-foundations-guide.pdf',
          level: 'Level 1',
          topic: 'Greetings',
          uploaderId: 'teacher-aline-mukamana',
          uploaderName: 'Aline Mukamana',
          publicToPaid: true,
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
      return snap.docs.map((d) => d.data() as PortalPlan);
    }
  } catch {
    // Fallback to seeded default plan before first admin login populates Firestore
  }
  return DEFAULT_PLANS;
}
