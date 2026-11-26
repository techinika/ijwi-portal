import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { Calendar, BookOpen, Users, Award, ArrowRight, CheckCircle2, Target, PlayCircle } from 'lucide-react';
import { db, formatPortalError } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { DEFAULT_PLANS, fetchAllActivePlans } from '../lib/seed';
import { FeedbackBanner, type FeedbackState } from '../components/FeedbackBanner';
import type {
  GroupSession,
  LessonProgress,
  PortalBooking,
  PortalPlan,
  PortalResource,
  PortalTeam,
  StudyGroup,
  TeacherProfile,
} from '../types/portal';

export function DashboardPage() {
  const { portalUser } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const { data: queriedPlans = [] } = useQuery({
    queryKey: ['all_active_plans'],
    queryFn: fetchAllActivePlans,
  });
  const allPlans: PortalPlan[] = queriedPlans.length > 0 ? queriedPlans : DEFAULT_PLANS;

  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [team, setTeam] = useState<PortalTeam | null>(null);
  const [teacher, setTeacher] = useState<TeacherProfile | null>(null);
  const [group, setGroup] = useState<StudyGroup | null>(null);
  const [bookings, setBookings] = useState<PortalBooking[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, LessonProgress>>({});
  const [publicResources, setPublicResources] = useState<PortalResource[]>([]);
  const [planLinkedResources, setPlanLinkedResources] = useState<PortalResource[]>([]);
  const [upcomingSessions, setUpcomingSessions] = useState<GroupSession[]>([]);
  const [savingPlacement, setSavingPlacement] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const portalUid = portalUser?.uid || '';
  const portalTeamId = portalUser?.teamId || '';
  const portalTeacherId = portalUser?.teacherId || '';
  const portalGroupId = portalUser?.groupId || '';

  useEffect(() => {
    if (!portalUid) return;

    const onErr = (err: unknown) => {
      const msg = formatPortalError(err, 'Unable to load some dashboard data.');
      setFeedback({ type: 'error', text: msg });
      toastRef.current.error(msg);
    };

    if (portalTeamId) {
      getDoc(doc(db, 'portal_teams', portalTeamId))
        .then((snap) => {
          if (snap.exists()) {
            setTeam({ id: snap.id, ...(snap.data() as Omit<PortalTeam, 'id'>) });
          }
        })
        .catch(() => {});
    } else {
      setTeam(null);
    }

    if (portalTeacherId) {
      getDoc(doc(db, 'portal_teachers', portalTeacherId))
        .then((snap) => {
          if (snap.exists()) {
            setTeacher(snap.data() as TeacherProfile);
          } else {
            setTeacher(null);
          }
        })
        .catch(() => {});
    } else {
      setTeacher(null);
    }

    if (portalGroupId) {
      getDoc(doc(db, 'portal_groups', portalGroupId))
        .then((snap) => {
          if (snap.exists()) {
            setGroup({ id: snap.id, ...(snap.data() as Omit<StudyGroup, 'id'>) });
          }
        })
        .catch(() => {});
    } else {
      setGroup(null);
    }

    const unsubBookings = onSnapshot(
      query(collection(db, 'portal_bookings'), where('studentId', '==', portalUid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<PortalBooking, 'id'>) }))
          .filter((b) => b.status === 'confirmed' || b.status === 'rescheduled')
          .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
        setBookings(list);
      },
      onErr
    );

    const unsubProgress = onSnapshot(
      query(
        collection(db, 'portal_progress', portalUid, 'lessons'),
        where('studentId', '==', portalUid)
      ),
      (snap) => {
        const map: Record<string, LessonProgress> = {};
        snap.docs.forEach((d) => {
          const item = d.data() as LessonProgress;
          map[item.lessonId] = item;
        });
        setProgressMap(map);
      },
      onErr
    );

    const unsubResources = onSnapshot(
      query(collection(db, 'portal_resources'), where('publicToPaid', '==', true)),
      (snap) => {
        setPublicResources(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalResource, 'id'>) }))
        );
      },
      onErr
    );

    const unsubSessions = onSnapshot(
      query(collection(db, 'portal_sessions'), where('status', '==', 'upcoming')),
      (snap) => {
        setUpcomingSessions(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<GroupSession, 'id'>) }))
            .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
        );
      },
      onErr
    );

    return () => {
      unsubBookings();
      unsubProgress();
      unsubResources();
      unsubSessions();
    };
  }, [portalUid, portalTeamId, portalTeacherId, portalGroupId]);

  const userAssignedKey = (portalUser?.assignedPlanIds || []).join('|');
  const teamAssignedKey = (team?.assignedPlanIds || []).join('|');
  const teamPlanFallback = team?.planId || '';

  const appliedPlanIds = useMemo(() => {
    const ids = new Set<string>();
    if (userAssignedKey) userAssignedKey.split('|').forEach((id) => ids.add(id));
    if (teamAssignedKey) teamAssignedKey.split('|').forEach((id) => ids.add(id));
    if (teamPlanFallback) ids.add(teamPlanFallback);
    return Array.from(ids);
  }, [userAssignedKey, teamAssignedKey, teamPlanFallback]);

  const appliedPlanIdsKey = appliedPlanIds.join('|');

  useEffect(() => {
    if (!portalUid || !appliedPlanIdsKey) {
      setPlanLinkedResources([]);
      return;
    }
    const targetIds = appliedPlanIdsKey.split('|').slice(0, 10);
    const unsub = onSnapshot(
      query(
        collection(db, 'portal_resources'),
        where('planIds', 'array-contains-any', targetIds)
      ),
      (snap) => {
        setPlanLinkedResources(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalResource, 'id'>) }))
        );
      },
      (err) => {
        const msg = formatPortalError(err, 'Unable to load plan resources.');
        setFeedback({ type: 'error', text: msg });
        toastRef.current.error(msg);
      }
    );
    return () => unsub();
  }, [portalUid, appliedPlanIdsKey]);

  const appliedPlans = useMemo(() => {
    const matched = allPlans.filter((p) => appliedPlanIds.includes(p.id));
    return matched.length > 0 ? matched : allPlans.slice(0, 1);
  }, [allPlans, appliedPlanIds]);

  const plan =
    appliedPlans.find((p) => p.id === selectedPlanId) || appliedPlans[0] || DEFAULT_PLANS[0];

  const resourcesForSelectedPlan = useMemo(() => {
    const map = new Map<string, PortalResource>();
    [...planLinkedResources, ...publicResources].forEach((r) => map.set(r.id, r));
    return Array.from(map.values())
      .filter((r) => r.planIds?.includes(plan.id) || r.publicToPaid)
      .slice(0, 4);
  }, [planLinkedResources, publicResources, plan.id]);

  const sessionsForSelectedPlan = useMemo(() => {
    const linked = upcomingSessions.filter((s) => s.planIds?.includes(plan.id));
    return (linked.length > 0 ? linked : upcomingSessions).slice(0, 3);
  }, [upcomingSessions, plan.id]);

  if (!portalUser) return null;
  const firstName = portalUser.displayName.split(' ')[0];
  const nextBooking = bookings.find((b) => Date.parse(b.startUtc) > Date.now());
  const totalLessons = plan.learningPath.reduce((sum, lvl) => sum + lvl.lessons.length, 0);
  const doneLessons = plan.learningPath
    .flatMap((lvl) => lvl.lessons)
    .filter((l) => progressMap[l.id]?.status === 'done').length;
  const progressPercent = totalLessons > 0 ? Math.round((doneLessons / totalLessons) * 100) : 0;

  const nextIncompleteLesson = plan.learningPath
    .flatMap((lvl) => lvl.lessons.map((l) => ({ levelTitle: lvl.title, lesson: l })))
    .find(({ lesson }) => progressMap[lesson.id]?.status !== 'done');

  function jumpToLesson(lessonId: string) {
    const el = document.getElementById(`lesson-${lessonId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async function savePlacement(level: string) {
    if (!portalUser) return;
    setSavingPlacement(true);
    setFeedback(null);
    try {
      await updateDoc(doc(db, 'users', portalUser.uid), {
        placementLevel: level,
        updatedAt: serverTimestamp(),
      });
      setFeedback({ type: 'success', text: 'Starting level saved.' });
      toast.success('Starting level saved.');
    } catch (err) {
      const msg = formatPortalError(err, 'Unable to save placement level.');
      setFeedback({ type: 'error', text: msg });
      toast.error(msg);
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
    setBusyKey(`lesson-${lessonId}`);
    setFeedback(null);
    try {
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
      if (next === 'done') {
        toast.success(`Completed "${lessonTitle}".`);
      } else if (next === 'in_progress') {
        toast.info(`Marked "${lessonTitle}" as in progress.`);
      }
    } catch (err) {
      const msg = formatPortalError(err, 'Unable to update lesson status.');
      setFeedback({ type: 'error', text: msg });
      toast.error(msg);
    } finally {
      setBusyKey(null);
    }
  }

  async function claimLevelCertificate(levelId: string, levelTitle: string) {
    if (!portalUser) return;
    setBusyKey(`cert-${levelId}`);
    setFeedback(null);
    try {
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
      toast.success(`Certificate issued for ${levelTitle}!`);
      navigate('/progress');
    } catch (err) {
      const msg = formatPortalError(err, 'Unable to issue certificate.');
      setFeedback({ type: 'error', text: msg });
      toast.error(msg);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />
      {/* Welcome Card */}
      <section className="rounded-[24px] border border-[#084F4E]/15 bg-[#FAFBFB] p-6 sm:p-8 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <p className="text-sm font-medium text-[#0E7C7B]">
              Muraho, {firstName}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#084F4E]">
              Your Kinyarwanda learning space
            </h1>
            <p className="text-sm text-[#3F4F4F]">
              {plan.name} ·{' '}
              <span className="tabular-nums font-medium text-[#084F4E]">
                {doneLessons}/{totalLessons} lessons done ({progressPercent}%)
              </span>
              {team ? ` · Team: ${team.name}` : group ? ` · Study circle: ${group.name}` : ''}
            </p>
          </div>

          <div className="rounded-2xl border border-[#084F4E]/12 bg-white px-5 py-4 w-full lg:w-auto lg:min-w-[260px]">
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

        {/* Overall Plan Progress Bar + Continue CTA */}
        <div className="pt-4 border-t border-[#084F4E]/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-[#3F4F4F]">Plan completion</span>
              <span className="font-semibold text-[#084F4E] tabular-nums">{progressPercent}%</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-[#E6F4F4] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#084F4E] transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {nextIncompleteLesson && (
            <button
              type="button"
              onClick={() => jumpToLesson(nextIncompleteLesson.lesson.id)}
              className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#084F4E] text-white text-xs font-semibold hover:bg-[#0E7C7B] transition-colors whitespace-nowrap shrink-0"
            >
              <PlayCircle className="w-4 h-4" />
              <span>Continue: {nextIncompleteLesson.lesson.title}</span>
            </button>
          )}
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
                className="w-full sm:w-auto text-left sm:text-center px-4 py-2.5 rounded-xl border border-[#084F4E]/20 bg-white text-sm font-medium text-[#084F4E] hover:bg-[#E6F4F4] transition-colors"
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-semibold text-[#084F4E]">
                {appliedPlans.length > 1 ? 'My learning plans' : 'My learning plan'}
              </h2>
              {plan.teacherName && (
                <p className="text-xs text-[#3F4F4F] mt-0.5">
                  Designed by {plan.teacherName}
                  {plan.level ? ` · ${plan.level}` : ''}
                </p>
              )}
            </div>
            <Link to="/progress" className="text-sm font-medium text-[#0E7C7B] hover:underline">
              Full progress &amp; certificates
            </Link>
          </div>

          {appliedPlans.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {appliedPlans.map((p) => {
                const active = p.id === plan.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlanId(p.id)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-[#084F4E] text-white'
                        : 'border border-[#084F4E]/15 bg-white text-[#084F4E] hover:bg-[#E6F4F4]/60'
                    }`}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Plan Objective Callout */}
          {plan.objective && (
            <div className="rounded-[20px] border border-[#0E7C7B]/20 bg-[#E6F4F4]/55 p-5 flex items-start gap-3">
              <Target className="w-5 h-5 text-[#084F4E] shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-[#0E7C7B]">Plan objective</p>
                <p className="text-sm text-[#1F2A2A] mt-0.5 leading-relaxed">{plan.objective}</p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {plan.learningPath.map((level) => {
              const allDone =
                level.lessons.length > 0 &&
                level.lessons.every((l) => progressMap[l.id]?.status === 'done');
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
                        disabled={busyKey === `cert-${level.id}`}
                        onClick={() => void claimLevelCertificate(level.id, level.title)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E8C97A]/40 text-[#084F4E] text-xs font-semibold hover:bg-[#E8C97A]/60 transition-colors disabled:opacity-50"
                      >
                        <Award className="w-4 h-4" />
                        <span>
                          {busyKey === `cert-${level.id}` ? 'Issuing...' : 'Claim certificate'}
                        </span>
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
                        <div
                          key={lesson.id}
                          id={`lesson-${lesson.id}`}
                          className="py-3.5 first:pt-1 last:pb-1 scroll-mt-24"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
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
                              disabled={busyKey === `lesson-${lesson.id}`}
                              onClick={() =>
                                void cycleLessonStatus(level.title, lesson.id, lesson.title)
                              }
                              className={`self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors disabled:opacity-50 ${
                                status === 'done'
                                  ? 'bg-[#E6F4F4] text-[#084F4E]'
                                  : status === 'in_progress'
                                    ? 'bg-[#E8C97A]/30 text-[#1F2A2A]'
                                    : 'border border-[#084F4E]/15 text-[#3F4F4F] hover:bg-[#FAFBFB]'
                              }`}
                            >
                              {status === 'done' && <CheckCircle2 className="w-3.5 h-3.5" />}
                              <span>{busyKey === `lesson-${lesson.id}` ? 'Saving...' : statusLabel}</span>
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

        {/* Sidebar: My Teacher & Plan Links */}
        <aside className="lg:col-span-4 space-y-6">
          <div className="rounded-[20px] border border-[#084F4E]/12 bg-white p-6 space-y-4">
            <p className="text-xs font-semibold text-[#0E7C7B]">My teacher</p>
            {teacher ? (
              <>
                <div className="flex items-center gap-4">
                  {teacher.photoUrl ? (
                    <img
                      src={teacher.photoUrl}
                      alt={teacher.displayName}
                      referrerPolicy="no-referrer"
                      className="w-16 h-16 rounded-2xl object-cover border border-[#084F4E]/10"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-[#E6F4F4] text-[#084F4E] flex items-center justify-center font-display text-xl font-semibold">
                      {teacher.displayName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
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
              </>
            ) : (
              <div className="space-y-2">
                <h3 className="font-display text-lg font-semibold text-[#084F4E]">
                  Teacher assignment pending
                </h3>
                <p className="text-sm text-[#3F4F4F] leading-relaxed">
                  Our team is matching you with a Kinyarwanda teacher. You can also browse available teachers on the booking page.
                </p>
              </div>
            )}
            <Link
              to="/bookings"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] transition-colors"
            >
              <Calendar className="w-4 h-4" />
              <span>Book a lesson</span>
            </Link>
          </div>

          <div className="rounded-[20px] border border-[#084F4E]/12 bg-white p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-[#084F4E]">
                Resources for this plan
              </h3>
              <Link to="/resources" className="text-xs font-semibold text-[#0E7C7B] hover:underline">
                View all
              </Link>
            </div>
            {resourcesForSelectedPlan.length === 0 ? (
              <p className="text-xs text-[#3F4F4F]">No resources linked to this plan yet.</p>
            ) : (
              <div className="space-y-2">
                {resourcesForSelectedPlan.map((r) => (
                  <Link
                    key={r.id}
                    to="/resources"
                    className="flex items-center justify-between p-2.5 rounded-xl hover:bg-[#E6F4F4]/60 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <BookOpen className="w-4 h-4 text-[#0E7C7B] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#1F2A2A] truncate">{r.title}</p>
                        <p className="text-[11px] text-[#3F4F4F] truncate">
                          {r.type.toUpperCase()} · {r.topic}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-[#3F4F4F] shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[20px] border border-[#084F4E]/12 bg-white p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold text-[#084F4E]">
                Upcoming sessions
              </h3>
              <Link to="/sessions" className="text-xs font-semibold text-[#0E7C7B] hover:underline">
                View all
              </Link>
            </div>
            {sessionsForSelectedPlan.length === 0 ? (
              <p className="text-xs text-[#3F4F4F]">No upcoming group sessions scheduled yet.</p>
            ) : (
              <div className="space-y-2">
                {sessionsForSelectedPlan.map((s) => (
                  <Link
                    key={s.id}
                    to="/sessions"
                    className="flex items-center justify-between p-2.5 rounded-xl hover:bg-[#E6F4F4]/60 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Users className="w-4 h-4 text-[#0E7C7B] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#1F2A2A] truncate">{s.title}</p>
                        <p className="text-[11px] text-[#3F4F4F] truncate tabular-nums">
                          {new Intl.DateTimeFormat(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: portalUser.timezone,
                          }).format(new Date(s.startUtc))}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-[#3F4F4F] shrink-0" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
