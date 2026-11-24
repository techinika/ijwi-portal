import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { Calendar, BookOpen, Users, Award, ArrowRight, CheckCircle2 } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { DEFAULT_PLANS, DEFAULT_TEACHERS } from '../lib/seed';
import type {
  LessonProgress,
  PortalBooking,
  PortalPlan,
  StudyGroup,
  TeacherProfile,
} from '../types/portal';

export function DashboardPage() {
  const { portalUser } = useAuth();
  const [plan, setPlan] = useState<PortalPlan>(DEFAULT_PLANS[0]);
  const [teacher, setTeacher] = useState<TeacherProfile>(DEFAULT_TEACHERS[0]);
  const [group, setGroup] = useState<StudyGroup | null>(null);
  const [bookings, setBookings] = useState<PortalBooking[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, LessonProgress>>({});
  const [savingPlacement, setSavingPlacement] = useState(false);

  useEffect(() => {
    if (!portalUser) return;

    // Load active plan
    getDocs(query(collection(db, 'portal_plans'), where('active', '==', true))).then((snap) => {
      if (!snap.empty) {
        setPlan(snap.docs[0].data() as PortalPlan);
      }
    });

    // Load assigned teacher
    if (portalUser.teacherId) {
      getDoc(doc(db, 'portal_teachers', portalUser.teacherId)).then((snap) => {
        if (snap.exists()) setTeacher(snap.data() as TeacherProfile);
      });
    }

    // Load study group if individual
    if (portalUser.groupId) {
      getDoc(doc(db, 'portal_groups', portalUser.groupId)).then((snap) => {
        if (snap.exists()) {
          setGroup({ id: snap.id, ...(snap.data() as Omit<StudyGroup, 'id'>) });
        }
      });
    }

    const unsubBookings = onSnapshot(
      query(collection(db, 'portal_bookings'), where('studentId', '==', portalUser.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<PortalBooking, 'id'>) }))
          .filter((b) => b.status === 'confirmed' || b.status === 'rescheduled')
          .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
        setBookings(list);
      }
    );

    const unsubProgress = onSnapshot(
      query(
        collection(db, 'portal_progress', portalUser.uid, 'lessons'),
        where('studentId', '==', portalUser.uid)
      ),
      (snap) => {
        const map: Record<string, LessonProgress> = {};
        snap.docs.forEach((d) => {
          const item = d.data() as LessonProgress;
          map[item.lessonId] = item;
        });
        setProgressMap(map);
      }
    );

    return () => {
      unsubBookings();
      unsubProgress();
    };
  }, [portalUser]);

  if (!portalUser) return null;
  const firstName = portalUser.displayName.split(' ')[0];
  const nextBooking = bookings.find((b) => Date.parse(b.startUtc) > Date.now());
  const totalLessons = plan.learningPath.reduce((sum, lvl) => sum + lvl.lessons.length, 0);
  const doneLessons = Object.values(progressMap).filter((p) => p.status === 'done').length;

  async function savePlacement(level: string) {
    if (!portalUser) return;
    setSavingPlacement(true);
    try {
      await updateDoc(doc(db, 'users', portalUser.uid), {
        placementLevel: level,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSavingPlacement(false);
    }
  }

  async function cycleLessonStatus(
    levelTitle: string,
    lessonId: string,
    lessonTitle: string
  ) {
    if (!portalUser) return;
    const current = progressMap[lessonId]?.status || 'not_started';
    const next =
      current === 'not_started' ? 'in_progress' : current === 'in_progress' ? 'done' : 'not_started';

    await setDoc(doc(db, 'portal_progress', portalUser.uid, 'lessons', lessonId), {
      studentId: portalUser.uid,
      lessonId,
      lessonTitle,
      levelTitle,
      status: next,
      ...(progressMap[lessonId]?.teacherNote
        ? { teacherNote: progressMap[lessonId].teacherNote }
        : {}),
      ...(next === 'done' ? { completedAt: new Date().toISOString() } : {}),
      updatedAt: serverTimestamp(),
    });
  }

  async function claimLevelCertificate(levelTitle: string) {
    if (!portalUser) return;
    const certCode = `IJW-${portalUser.uid.slice(0, 4).toUpperCase()}-${Date.now()
      .toString(36)
      .toUpperCase()}`;
    await setDoc(doc(db, 'portal_certificates', certCode), {
      certCode,
      userId: portalUser.uid,
      learnerName: portalUser.displayName,
      levelName: levelTitle,
      planName: plan.name,
      issuedAt: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
    window.location.href = '/progress';
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      {/* Welcome Card */}
      <section className="rounded-[24px] border border-[#084F4E]/15 bg-[#FAFBFB] p-6 sm:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-[#0E7C7B] mb-1">
              Muraho, {firstName}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#084F4E]">
              Your Kinyarwanda learning space
            </h1>
            <p className="text-sm text-[#3F4F4F] mt-2">
              {plan.name} ·{' '}
              <span className="tabular-nums font-medium text-[#084F4E]">
                {doneLessons}/{totalLessons} lessons done
              </span>
              {group ? ` · Study circle: ${group.name}` : ''}
            </p>
          </div>

          <div className="rounded-2xl border border-[#084F4E]/12 bg-white px-5 py-4 min-w-[260px]">
            <p className="text-xs font-medium text-[#3F4F4F] mb-1">Next lesson</p>
            {nextBooking ? (
              <div>
                <p className="font-semibold text-sm text-[#084F4E]">
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: portalUser.timezone,
                  }).format(new Date(nextBooking.startUtc))}
                </p>
                <p className="text-xs text-[#3F4F4F] mt-0.5">
                  with {nextBooking.teacherName} ({portalUser.timezone})
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[#3F4F4F]">No lesson booked yet</span>
                <Link
                  to="/bookings"
                  className="text-xs font-semibold text-[#084F4E] hover:underline whitespace-nowrap"
                >
                  Book now
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Placement Check (if unset) */}
      {!portalUser.placementLevel && (
        <section className="rounded-[20px] border border-[#C9A84C]/40 bg-[#E8C97A]/15 p-6">
          <h2 className="font-display text-xl font-semibold text-[#084F4E] mb-1">
            Quick placement check
          </h2>
          <p className="text-sm text-[#3F4F4F] mb-4">
            Help your teacher tailor your first lesson by sharing your starting comfort in Kinyarwanda.
          </p>
          <div className="flex flex-wrap gap-3">
            {[
              'Complete beginner (starting from Muraho)',
              'Elementary (know greetings & basics)',
              'Conversational (practising fluency)',
            ].map((level) => (
              <button
                key={level}
                type="button"
                disabled={savingPlacement}
                onClick={() => void savePlacement(level)}
                className="px-4 py-2 rounded-xl border border-[#084F4E]/20 bg-white text-sm font-medium text-[#084F4E] hover:bg-[#E6F4F4] transition-colors"
              >
                {level}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Main Grid: Learning Plan + My Teacher */}
      <div className="grid lg:grid-cols-12 gap-8 items-start">
        {/* Learning Plan */}
        <section className="lg:col-span-8 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-semibold text-[#084F4E]">
              My learning plan
            </h2>
            <Link to="/progress" className="text-sm font-medium text-[#0E7C7B] hover:underline">
              Full progress &amp; certificates
            </Link>
          </div>

          <div className="space-y-4">
            {plan.learningPath.map((level) => {
              const allDone = level.lessons.every(
                (l) => progressMap[l.id]?.status === 'done'
              );
              return (
                <div
                  key={level.id}
                  className="rounded-[20px] border border-[#084F4E]/12 bg-white p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-xl font-semibold text-[#084F4E]">
                        {level.title}
                      </h3>
                      <p className="text-sm text-[#3F4F4F] mt-1">{level.description}</p>
                    </div>
                    {allDone && (
                      <button
                        type="button"
                        onClick={() => void claimLevelCertificate(level.title)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E8C97A]/40 text-[#084F4E] text-xs font-semibold hover:bg-[#E8C97A]/60 transition-colors"
                      >
                        <Award className="w-4 h-4" />
                        <span>Claim certificate</span>
                      </button>
                    )}
                  </div>

                  <div className="divide-y divide-[#084F4E]/10">
                    {level.lessons.map((lesson) => {
                      const prog = progressMap[lesson.id];
                      const status = prog?.status || 'not_started';
                      const statusLabel =
                        status === 'done'
                          ? 'Done'
                          : status === 'in_progress'
                            ? 'In progress'
                            : 'Not started';

                      return (
                        <div key={lesson.id} className="py-3.5 first:pt-1 last:pb-1">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-sm font-semibold text-[#1F2A2A]">
                                {lesson.title}
                              </p>
                              <p className="text-xs text-[#3F4F4F] mt-0.5">{lesson.summary}</p>
                              {prog?.teacherNote && (
                                <p className="text-xs text-[#0E7C7B] mt-1.5">
                                  Teacher practice note: {prog.teacherNote}
                                </p>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                void cycleLessonStatus(level.title, lesson.id, lesson.title)
                              }
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                                status === 'done'
                                  ? 'bg-[#E6F4F4] text-[#084F4E]'
                                  : status === 'in_progress'
                                    ? 'bg-[#E8C97A]/30 text-[#1F2A2A]'
                                    : 'border border-[#084F4E]/15 text-[#3F4F4F] hover:bg-[#FAFBFB]'
                              }`}
                            >
                              {status === 'done' && <CheckCircle2 className="w-3.5 h-3.5" />}
                              <span>{statusLabel}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Sidebar: My Teacher & Quick Navigation */}
        <aside className="lg:col-span-4 space-y-6">
          <div className="rounded-[20px] border border-[#084F4E]/12 bg-white p-6 space-y-4">
            <p className="text-xs font-semibold text-[#0E7C7B]">My teacher</p>
            <div className="flex items-center gap-4">
              <img
                src={teacher.photoUrl}
                alt={teacher.displayName}
                referrerPolicy="no-referrer"
                className="w-16 h-16 rounded-2xl object-cover border border-[#084F4E]/10"
              />
              <div>
                <h3 className="font-display text-lg font-semibold text-[#084F4E]">
                  {teacher.displayName}
                </h3>
                <p className="text-xs text-[#3F4F4F]">
                  {teacher.lessonLengthMin} min lessons
                </p>
              </div>
            </div>
            <p className="text-sm text-[#3F4F4F] leading-relaxed">{teacher.bio}</p>
            <Link
              to="/bookings"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] transition-colors"
            >
              <Calendar className="w-4 h-4" />
              <span>Book a lesson</span>
            </Link>
          </div>

          <div className="rounded-[20px] border border-[#084F4E]/12 bg-white p-6 space-y-3">
            <h3 className="font-display text-lg font-semibold text-[#084F4E]">
              Explore your portal
            </h3>
            <Link
              to="/resources"
              className="flex items-center justify-between p-3 rounded-xl hover:bg-[#E6F4F4]/60 transition-colors"
            >
              <div className="flex items-center gap-3">
                <BookOpen className="w-4 h-4 text-[#0E7C7B]" />
                <span className="text-sm font-medium text-[#1F2A2A]">Study resources</span>
              </div>
              <ArrowRight className="w-4 h-4 text-[#3F4F4F]" />
            </Link>
            <Link
              to="/sessions"
              className="flex items-center justify-between p-3 rounded-xl hover:bg-[#E6F4F4]/60 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-[#0E7C7B]" />
                <span className="text-sm font-medium text-[#1F2A2A]">
                  Study group &amp; sessions
                </span>
              </div>
              <ArrowRight className="w-4 h-4 text-[#3F4F4F]" />
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
}
