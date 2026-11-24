import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
  deleteDoc,
} from 'firebase/firestore';
import { Upload, CheckCircle2, Trash2, Calendar, Award, BookOpen, Plus } from 'lucide-react';
import { db, formatPortalError } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import { DEFAULT_WEEKLY_AVAILABILITY } from '../lib/seed';
import { dispatchPortalEmail, pushNotification } from '../lib/portalActions';
import { FeedbackBanner, type FeedbackState } from '../components/FeedbackBanner';
import type {
  LearningLevel,
  PortalBooking,
  PortalPlan,
  PortalResource,
  PortalTeam,
  PortalUser,
  TeacherProfile,
} from '../types/portal';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type TeacherTab = 'today' | 'plans' | 'availability' | 'students' | 'resources';

function createBlankLevels(): LearningLevel[] {
  return [
    {
      id: `lvl-${Date.now().toString(36)}`,
      title: 'Module 1 · Foundations',
      description: 'Core vocabulary and respectful everyday structures.',
      lessons: [
        {
          id: `lsn-${Date.now().toString(36)}-1`,
          title: '1.1 Essential Greetings & Tone',
          summary: 'Natural greetings across times of day and contexts.',
        },
        {
          id: `lsn-${Date.now().toString(36)}-2`,
          title: '1.2 Guided Dialogue Practice',
          summary: 'Roleplay and listening confidence.',
        },
      ],
    },
  ];
}

export function TeacherPage() {
  const { portalUser } = useAuth();
  const [tab, setTab] = useState<TeacherTab>('today');
  const [allTeachers, setAllTeachers] = useState<TeacherProfile[]>([]);
  const [selectedTeacherUid, setSelectedTeacherUid] = useState<string>('');
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(null);

  const [bookings, setBookings] = useState<PortalBooking[]>([]);
  const [students, setStudents] = useState<PortalUser[]>([]);
  const [teams, setTeams] = useState<PortalTeam[]>([]);
  const [plans, setPlans] = useState<PortalPlan[]>([]);
  const [resources, setResources] = useState<PortalResource[]>([]);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Availability form state
  const [newDay, setNewDay] = useState(1);
  const [newHour, setNewHour] = useState(10);
  const [newDayOff, setNewDayOff] = useState('');

  // Create Learning Plan form state
  const [planName, setPlanName] = useState('');
  const [planObjective, setPlanObjective] = useState('');
  const [planDescription, setPlanDescription] = useState('');
  const [planLevel, setPlanLevel] = useState('Beginner');
  const [planPriceUsd, setPlanPriceUsd] = useState(40);
  const [planPublicEnrol, setPlanPublicEnrol] = useState(true);
  const [planLevels, setPlanLevels] = useState<LearningLevel[]>(createBlankLevels);
  const [savingPlan, setSavingPlan] = useState(false);
  const [planFeedback, setPlanFeedback] = useState<FeedbackState | null>(null);

  // Resource upload form state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [resTitle, setResTitle] = useState('');
  const [resType, setResType] = useState<'pdf' | 'video' | 'link'>('pdf');
  const [resLevel, setResLevel] = useState('Level 1');
  const [resTopic, setResTopic] = useState('Greetings');
  const [resDesc, setResDesc] = useState('');
  const [resUrl, setResUrl] = useState('');
  const [resFile, setResFile] = useState<File | null>(null);
  const [resPublicToPaid, setResPublicToPaid] = useState(true);
  const [resPlanIds, setResPlanIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState<FeedbackState | null>(null);

  // Load dynamic teachers list so admins can view any teacher and teachers see their own record
  useEffect(() => {
    if (!portalUser) return;
    if (portalUser.role === 'teacher') {
      setSelectedTeacherUid(portalUser.uid);
      return;
    }
    const unsubT = onSnapshot(
      collection(db, 'portal_teachers'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as TeacherProfile);
        setAllTeachers(list);
        setSelectedTeacherUid((prev) => prev || list[0]?.uid || '');
      },
      (err) => {
        setFeedback({ type: 'error', text: formatPortalError(err, 'Unable to load teachers.') });
      }
    );
    return () => unsubT();
  }, [portalUser]);

  const activeTeacherUid =
    portalUser?.role === 'teacher' ? portalUser.uid : selectedTeacherUid;

  // Load selected teacher's profile, bookings, students, teams, plans, and resources
  useEffect(() => {
    if (!portalUser) return;

    const unsubPlans = onSnapshot(
      collection(db, 'portal_plans'),
      (snap) => {
        setPlans(snap.docs.map((d) => ({ ...(d.data() as PortalPlan), id: d.id })));
      },
      (err) => {
        setFeedback({ type: 'error', text: formatPortalError(err, 'Unable to load learning plans.') });
      }
    );

    const unsubTeams = onSnapshot(
      collection(db, 'portal_teams'),
      (snap) => {
        setTeams(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalTeam, 'id'>) })));
      },
      (err) => {
        setFeedback({ type: 'error', text: formatPortalError(err, 'Unable to load teams.') });
      }
    );

    const unsubR = onSnapshot(
      query(collection(db, 'portal_resources'), where('uploaderId', '==', portalUser.uid)),
      (snap) =>
        setResources(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalResource, 'id'>) }))
        ),
      (err) => {
        setFeedback({ type: 'error', text: formatPortalError(err, 'Unable to load resources.') });
      }
    );

    if (!activeTeacherUid) {
      setTeacherProfile(null);
      setBookings([]);
      setStudents([]);
      return () => {
        unsubPlans();
        unsubTeams();
        unsubR();
      };
    }

    getDoc(doc(db, 'portal_teachers', activeTeacherUid))
      .then(async (snap) => {
        if (snap.exists()) {
          setTeacherProfile(snap.data() as TeacherProfile);
        } else if (portalUser.role === 'teacher' && activeTeacherUid === portalUser.uid) {
          const starter: TeacherProfile = {
            uid: portalUser.uid,
            email: portalUser.email,
            displayName: portalUser.displayName,
            photoUrl: portalUser.photoUrl || '',
            bio: 'Kinyarwanda teacher at Ijwi.',
            availability: DEFAULT_WEEKLY_AVAILABILITY,
            daysOff: [],
            lessonLengthMin: 45,
            bufferMin: 15,
            maxPerDay: 6,
            active: true,
          };
          await setDoc(doc(db, 'portal_teachers', portalUser.uid), {
            ...starter,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
          setTeacherProfile(starter);
        } else {
          setTeacherProfile(null);
        }
      })
      .catch((err) => {
        setFeedback({ type: 'error', text: formatPortalError(err, 'Unable to load teacher profile.') });
      });

    const unsubB = onSnapshot(
      query(collection(db, 'portal_bookings'), where('teacherId', '==', activeTeacherUid)),
      (snap) => {
        setBookings(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<PortalBooking, 'id'>) }))
            .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
        );
      },
      (err) => {
        setFeedback({ type: 'error', text: formatPortalError(err, 'Unable to load bookings.') });
      }
    );

    const unsubS = onSnapshot(
      query(collection(db, 'users'), where('teacherId', '==', activeTeacherUid)),
      (snap) => setStudents(snap.docs.map((d) => d.data() as PortalUser)),
      (err) => {
        setFeedback({ type: 'error', text: formatPortalError(err, 'Unable to load students.') });
      }
    );

    return () => {
      unsubPlans();
      unsubTeams();
      unsubR();
      unsubB();
      unsubS();
    };
  }, [portalUser, activeTeacherUid]);

  const myCreatedPlans = useMemo(
    () =>
      plans.filter(
        (p) =>
          portalUser?.role === 'admin' ||
          p.teacherId === activeTeacherUid ||
          p.teacherId === portalUser?.uid
      ),
    [plans, portalUser, activeTeacherUid]
  );

  const assignablePlans = useMemo(() => plans.filter((p) => p.active), [plans]);

  if (!portalUser || (portalUser.role !== 'teacher' && portalUser.role !== 'admin')) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <h1 className="font-display text-2xl text-[#084F4E]">Teacher access required</h1>
      </div>
    );
  }

  async function markAttendance(
    b: PortalBooking,
    status: 'completed' | 'no_show'
  ) {
    setBusyKey(`booking:${b.id}`);
    setFeedback(null);
    try {
      const feedbackNote = (feedbackDrafts[b.id] || '').trim();
      await updateDoc(doc(db, 'portal_bookings', b.id), {
        status,
        ...(feedbackNote ? { teacherFeedback: feedbackNote } : {}),
        updatedAt: serverTimestamp(),
      });

      if (b.teacherId) {
        await setDoc(
          doc(db, 'portal_teachers', b.teacherId, 'busySlots', b.id),
          {
            startUtc: b.startUtc,
            endUtc: b.endUtc,
            status,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        ).catch(() => {});
      }

      if (status === 'no_show') {
        const stuSnap = await getDoc(doc(db, 'users', b.studentId));
        if (stuSnap.exists()) {
          await updateDoc(doc(db, 'users', b.studentId), {
            noShowCount: Number(stuSnap.data().noShowCount || 0) + 1,
            updatedAt: serverTimestamp(),
          });
        }
      }

      if (feedbackNote) {
        void pushNotification({
          userId: b.studentId,
          title: `Feedback from ${b.teacherName}`,
          body: feedbackNote.slice(0, 140),
          type: 'feedback',
          link: '/progress',
        });
      }
      setFeedback({
        type: 'success',
        text: `Marked lesson with ${b.studentName} as ${status.replace('_', ' ')}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: formatPortalError(err, 'Unable to update lesson status.'),
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function saveAvailabilityProfile(next: TeacherProfile) {
    const previous = teacherProfile;
    setTeacherProfile(next);
    setBusyKey('availability');
    setFeedback(null);
    try {
      await setDoc(
        doc(db, 'portal_teachers', next.uid),
        {
          ...next,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setFeedback({ type: 'success', text: 'Availability updated.' });
    } catch (err) {
      if (previous) setTeacherProfile(previous);
      setFeedback({
        type: 'error',
        text: formatPortalError(err, 'Unable to save availability.'),
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!portalUser || !planName.trim() || !planObjective.trim()) return;

    const cleanLevels = planLevels
      .filter((l) => l.title.trim())
      .map((l) => ({
        ...l,
        title: l.title.trim(),
        description: l.description.trim() || 'Structured module milestones.',
        lessons: l.lessons
          .filter((ls) => ls.title.trim())
          .map((ls) => ({
            ...ls,
            title: ls.title.trim(),
            summary: ls.summary.trim() || 'Guided teacher practice.',
          })),
      }));

    if (cleanLevels.length === 0) {
      const msg = 'Add at least one module with a title.';
      setPlanFeedback({ type: 'error', text: msg });
      setFeedback({ type: 'error', text: msg });
      return;
    }

    setSavingPlan(true);
    setFeedback(null);
    setPlanFeedback(null);
    try {
      const savedName = planName.trim();
      const slug = savedName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 40);
      const id = `${slug || 'plan'}-${Date.now().toString(36)}`;
      const creatorName = teacherProfile?.displayName || portalUser.displayName;
      const creatorUid = activeTeacherUid || portalUser.uid;

      await setDoc(doc(db, 'portal_plans', id), {
        id,
        name: savedName,
        objective: planObjective.trim(),
        description:
          planDescription.trim() ||
          'Custom Kinyarwanda learning plan with dedicated teacher support.',
        level: planLevel,
        teacherId: creatorUid,
        teacherName: creatorName,
        unitPriceCents: Math.max(0, Math.round(planPriceUsd * 100)),
        currency: 'USD',
        included: [
          `Objective: ${planObjective.trim().slice(0, 90)}`,
          `Guided by ${creatorName}`,
          '1-on-1 teacher bookings & progress notes',
          'Plan-aligned guides, videos, and study sessions',
        ],
        learningPath: cleanLevels,
        isPublicEnrolment: planPublicEnrol,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setPlanName('');
      setPlanObjective('');
      setPlanDescription('');
      setPlanLevels(createBlankLevels());
      const successText = `Learning plan "${savedName}" published! You can now apply it to learners or teams.`;
      setPlanFeedback({ type: 'success', text: successText });
      setFeedback({ type: 'success', text: successText });
    } catch (err) {
      const errText = formatPortalError(err, 'Unable to save learning plan.');
      setPlanFeedback({ type: 'error', text: errText });
      setFeedback({ type: 'error', text: errText });
    } finally {
      setSavingPlan(false);
    }
  }

  async function togglePlanActive(pl: PortalPlan) {
    setBusyKey(`plan-active:${pl.id}`);
    setFeedback(null);
    try {
      await updateDoc(doc(db, 'portal_plans', pl.id), {
        active: !pl.active,
        updatedAt: serverTimestamp(),
      });
      setFeedback({
        type: 'success',
        text: pl.active ? `Archived "${pl.name}".` : `Activated "${pl.name}".`,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: formatPortalError(err, 'Unable to update plan status.') });
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleStudentPlan(student: PortalUser, targetPlanId: string) {
    setBusyKey(`stu-plan:${student.uid}:${targetPlanId}`);
    setFeedback(null);
    try {
      const current = student.assignedPlanIds || [];
      const next = current.includes(targetPlanId)
        ? current.filter((id) => id !== targetPlanId)
        : [...current, targetPlanId];

      await updateDoc(doc(db, 'users', student.uid), {
        assignedPlanIds: next,
        updatedAt: serverTimestamp(),
      });
      const planLabel = plans.find((p) => p.id === targetPlanId)?.name || targetPlanId;
      setFeedback({
        type: 'success',
        text: next.includes(targetPlanId)
          ? `Applied "${planLabel}" to ${student.displayName}.`
          : `Removed "${planLabel}" from ${student.displayName}.`,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: formatPortalError(err, 'Unable to update student plans.') });
    } finally {
      setBusyKey(null);
    }
  }

  async function toggleTeamPlan(team: PortalTeam, targetPlanId: string) {
    setBusyKey(`team-plan:${team.id}:${targetPlanId}`);
    setFeedback(null);
    try {
      const current = team.assignedPlanIds || (team.planId ? [team.planId] : []);
      const next = current.includes(targetPlanId)
        ? current.filter((id) => id !== targetPlanId)
        : [...current, targetPlanId];

      await updateDoc(doc(db, 'portal_teams', team.id), {
        assignedPlanIds: next,
        updatedAt: serverTimestamp(),
      });
      const planLabel = plans.find((p) => p.id === targetPlanId)?.name || targetPlanId;
      setFeedback({
        type: 'success',
        text: next.includes(targetPlanId)
          ? `Applied "${planLabel}" to team ${team.name}.`
          : `Removed "${planLabel}" from team ${team.name}.`,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: formatPortalError(err, 'Unable to update team plans.') });
    } finally {
      setBusyKey(null);
    }
  }

  async function handleUploadResource(e: React.FormEvent) {
    e.preventDefault();
    if (!portalUser || !resTitle.trim()) return;
    setUploadFeedback(null);
    setFeedback(null);

    if (resType === 'link' && !resUrl.trim()) {
      const msg = 'Please enter a valid external URL.';
      setUploadFeedback({ type: 'error', text: msg });
      setFeedback({ type: 'error', text: msg });
      return;
    }

    if (resType !== 'link') {
      if (!resFile) {
        const msg = 'Please choose a PDF, MP4, or WebM file.';
        setUploadFeedback({ type: 'error', text: msg });
        setFeedback({ type: 'error', text: msg });
        return;
      }
      if (resFile.size > 60 * 1024 * 1024) {
        const msg = 'File size exceeds the 60 MB limit. Please choose a smaller file.';
        setUploadFeedback({ type: 'error', text: msg });
        setFeedback({ type: 'error', text: msg });
        return;
      }
    }

    setUploading(true);
    try {
      let fileKey = '';
      if (resType !== 'link' && resFile) {
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Failed to read the selected file.'));
          reader.readAsDataURL(resFile);
        });
        const uploaded = await apiFetch<{ fileKey: string }>('/api/resources/upload', {
          method: 'POST',
          timeoutMs: 60_000,
          body: JSON.stringify({
            filename: resFile.name,
            mimeType: resFile.type || (resType === 'pdf' ? 'application/pdf' : 'video/mp4'),
            base64Data,
          }),
        });
        fileKey = uploaded.fileKey;
      }

      const savedTitle = resTitle.trim();
      const id = `res-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await setDoc(doc(db, 'portal_resources', id), {
        type: resType,
        title: savedTitle,
        ...(resDesc.trim() ? { description: resDesc.trim() } : {}),
        ...(fileKey ? { fileKey } : {}),
        ...(resType === 'link' && resUrl.trim() ? { url: resUrl.trim() } : {}),
        level: resLevel,
        topic: resTopic,
        uploaderId: portalUser.uid,
        uploaderName: teacherProfile?.displayName || portalUser.displayName,
        publicToPaid: resPublicToPaid,
        ...(resPlanIds.length > 0 ? { planIds: resPlanIds } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setResTitle('');
      setResDesc('');
      setResUrl('');
      setResFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setResPlanIds([]);
      const successText = `Resource "${savedTitle}" published to your study library!`;
      setUploadFeedback({ type: 'success', text: successText });
      setFeedback({ type: 'success', text: successText });
    } catch (err) {
      const errText = formatPortalError(err, 'Resource upload failed. Please try again.');
      setUploadFeedback({ type: 'error', text: errText });
      setFeedback({ type: 'error', text: errText });
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteResource(r: PortalResource) {
    setBusyKey(`del-res:${r.id}`);
    setFeedback(null);
    try {
      if (r.fileKey) {
        await apiFetch(`/api/resources/file/${encodeURIComponent(r.fileKey)}`, {
          method: 'DELETE',
        }).catch(() => {});
      }
      await deleteDoc(doc(db, 'portal_resources', r.id));
      setFeedback({ type: 'success', text: `Deleted resource "${r.title}".` });
    } catch (err) {
      setFeedback({ type: 'error', text: formatPortalError(err, 'Unable to delete resource.') });
    } finally {
      setBusyKey(null);
    }
  }

  async function issueCertificateForStudent(
    stu: PortalUser,
    levelTitle: string,
    planTitle: string
  ) {
    setBusyKey(`cert:${stu.uid}:${levelTitle}`);
    setFeedback(null);
    try {
      const certCode = `IJW-${stu.uid.slice(0, 4).toUpperCase()}-${Date.now()
        .toString(36)
        .toUpperCase()}`;
      await setDoc(doc(db, 'portal_certificates', certCode), {
        certCode,
        userId: stu.uid,
        learnerName: stu.displayName,
        levelName: levelTitle,
        planName: planTitle,
        issuedAt: new Date().toISOString(),
        createdAt: serverTimestamp(),
      });
      void dispatchPortalEmail({
        userId: stu.uid,
        to: stu.email,
        recipientName: stu.displayName,
        type: 'certificate',
        subject: `Congratulations! Your Ijwi ${levelTitle} certificate`,
        headline: `You completed ${levelTitle}`,
        bodyText: `Your teacher ${portalUser?.displayName} issued your verified completion certificate for ${planTitle}.`,
        ctaLabel: 'View Certificate',
        ctaUrl: `/verify/${certCode}`,
      });
      setFeedback({
        type: 'success',
        text: `Certificate ${certCode} issued to ${stu.displayName}.`,
      });
    } catch (err) {
      setFeedback({ type: 'error', text: formatPortalError(err, 'Unable to issue certificate.') });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#084F4E]">Teacher Desk</h1>
          <p className="text-sm text-[#3F4F4F] mt-1">
            Create learning plans with objectives, apply them to learners or teams, manage classes, and share resources.
          </p>
          {portalUser.role === 'admin' && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-[#084F4E]">Viewing teacher:</span>
              {allTeachers.length === 0 ? (
                <Link to="/admin" className="text-[#0E7C7B] underline">
                  No teachers created yet — create one in Admin Console
                </Link>
              ) : (
                <select
                  value={selectedTeacherUid}
                  onChange={(e) => setSelectedTeacherUid(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg border border-[#084F4E]/20 bg-white text-xs text-[#084F4E]"
                >
                  {allTeachers.map((t) => (
                    <option key={t.uid} value={t.uid}>
                      {t.displayName} {t.active ? '' : '(Paused)'}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        <div className="flex overflow-x-auto sm:flex-wrap gap-1.5 p-1.5 rounded-2xl bg-[#E6F4F4] w-full lg:w-auto">
          {(
            [
              ['today', 'Today'],
              ['plans', 'Learning Plans'],
              ['availability', 'Availability'],
              ['students', 'My Students'],
              ['resources', 'Resources'],
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

      <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />

      {tab === 'today' && (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold text-[#084F4E]">
            Upcoming &amp; recent lessons
          </h2>
          {bookings.length === 0 ? (
            <div className="rounded-2xl border border-[#084F4E]/12 bg-[#FAFBFB] p-8 text-sm text-[#3F4F4F]">
              No lessons scheduled yet.
            </div>
          ) : (
            <div className="space-y-4">
              {bookings.map((b) => (
                <div
                  key={b.id}
                  className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[#084F4E]">{b.studentName}</p>
                      <p className="text-xs text-[#3F4F4F] tabular-nums">
                        {new Date(b.startUtc).toLocaleString()} · Status:{' '}
                        <strong className="capitalize">{b.status}</strong>
                      </p>
                      {b.note && <p className="text-xs text-[#0E7C7B] mt-1">Student note: {b.note}</p>}
                    </div>
                    <Calendar className="w-4 h-4 text-[#0E7C7B]" />
                  </div>

                  {(b.status === 'confirmed' || b.status === 'rescheduled') && (
                    <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-[#084F4E]/10">
                      <input
                        type="text"
                        placeholder="Short feedback or homework note for student..."
                        value={feedbackDrafts[b.id] || ''}
                        onChange={(e) =>
                          setFeedbackDrafts((prev) => ({ ...prev, [b.id]: e.target.value }))
                        }
                        className="flex-1 min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs"
                      />
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          disabled={busyKey === `booking:${b.id}`}
                          onClick={() => void markAttendance(b, 'completed')}
                          className="w-full sm:w-auto inline-flex items-center justify-center gap-1 min-h-[40px] px-4 py-2 rounded-xl bg-[#084F4E] text-white text-xs font-semibold disabled:opacity-60"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{busyKey === `booking:${b.id}` ? 'Saving...' : 'Mark completed'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={busyKey === `booking:${b.id}`}
                          onClick={() => void markAttendance(b, 'no_show')}
                          className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-xl border border-amber-300 text-xs font-medium text-amber-800 disabled:opacity-60"
                        >
                          No-show
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'plans' && (
        <div className="grid lg:grid-cols-12 gap-8 items-start">
          <form
            onSubmit={(e) => void handleCreatePlan(e)}
            className="lg:col-span-6 rounded-[20px] border border-[#084F4E]/12 bg-white p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#0E7C7B]" />
              <h2 className="font-display text-xl font-semibold text-[#084F4E]">
                Create a learning plan
              </h2>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#1F2A2A] mb-1">Plan title</label>
              <input
                required
                maxLength={120}
                placeholder="e.g. Everyday Conversational Kinyarwanda"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#1F2A2A] mb-1">
                Plan objective (required)
              </label>
              <textarea
                required
                rows={2}
                maxLength={600}
                placeholder="What will the learner or team be able to do after finishing this plan?"
                value={planObjective}
                onChange={(e) => setPlanObjective(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#1F2A2A] mb-1">Description</label>
              <textarea
                rows={2}
                maxLength={600}
                placeholder="Overview of how lessons and practice are structured..."
                value={planDescription}
                onChange={(e) => setPlanDescription(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#1F2A2A] mb-1">Level</label>
                <select
                  value={planLevel}
                  onChange={(e) => setPlanLevel(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
                >
                  <option value="Beginner">Beginner</option>
                  <option value="Elementary">Elementary</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                  <option value="All levels">All levels</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#1F2A2A] mb-1">
                  Price per learner (USD)
                </label>
                <input
                  type="number"
                  min={0}
                  value={planPriceUsd}
                  onChange={(e) => setPlanPriceUsd(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm tabular-nums"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-[#3F4F4F]">
              <input
                type="checkbox"
                checked={planPublicEnrol}
                onChange={(e) => setPlanPublicEnrol(e.target.checked)}
              />
              <span>List this plan for public enrolment on the homepage</span>
            </label>

            {/* Curriculum Modules & Lessons Builder */}
            <div className="space-y-3 pt-2 border-t border-[#084F4E]/10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#084F4E]">
                  Curriculum modules &amp; lessons
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setPlanLevels((prev) => [
                      ...prev,
                      {
                        id: `lvl-${Date.now().toString(36)}`,
                        title: `Module ${prev.length + 1}`,
                        description: '',
                        lessons: [
                          {
                            id: `lsn-${Date.now().toString(36)}`,
                            title: `${prev.length + 1}.1 Practice Lesson`,
                            summary: '',
                          },
                        ],
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#0E7C7B] hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add module</span>
                </button>
              </div>

              {planLevels.map((lvl, lIdx) => (
                <div
                  key={lvl.id}
                  className="rounded-xl border border-[#084F4E]/15 bg-[#FAFBFB] p-3.5 space-y-2.5"
                >
                  <div className="flex items-center gap-2">
                    <input
                      value={lvl.title}
                      onChange={(e) =>
                        setPlanLevels((prev) =>
                          prev.map((x, idx) =>
                            idx === lIdx ? { ...x, title: e.target.value } : x
                          )
                        )
                      }
                      placeholder="Module title"
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-[#084F4E]/20 bg-white text-xs font-semibold"
                    />
                    {planLevels.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setPlanLevels((prev) => prev.filter((_, idx) => idx !== lIdx))
                        }
                        className="text-xs text-red-700 px-2"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="space-y-2 sm:pl-2">
                    {lvl.lessons.map((lsn, sIdx) => (
                      <div key={lsn.id} className="grid grid-cols-1 sm:grid-cols-12 gap-1.5">
                        <input
                          value={lsn.title}
                          onChange={(e) =>
                            setPlanLevels((prev) =>
                              prev.map((x, idx) =>
                                idx === lIdx
                                  ? {
                                      ...x,
                                      lessons: x.lessons.map((item, j) =>
                                        j === sIdx ? { ...item, title: e.target.value } : item
                                      ),
                                    }
                                  : x
                              )
                            )
                          }
                          placeholder="Lesson title"
                          className="sm:col-span-5 px-2.5 py-1.5 rounded-lg border border-[#084F4E]/15 bg-white text-xs"
                        />
                        <input
                          value={lsn.summary}
                          onChange={(e) =>
                            setPlanLevels((prev) =>
                              prev.map((x, idx) =>
                                idx === lIdx
                                  ? {
                                      ...x,
                                      lessons: x.lessons.map((item, j) =>
                                        j === sIdx ? { ...item, summary: e.target.value } : item
                                      ),
                                    }
                                  : x
                              )
                            )
                          }
                          placeholder="Lesson focus"
                          className="sm:col-span-6 px-2.5 py-1.5 rounded-lg border border-[#084F4E]/15 bg-white text-xs"
                        />
                        {lvl.lessons.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setPlanLevels((prev) =>
                                prev.map((x, idx) =>
                                  idx === lIdx
                                    ? {
                                        ...x,
                                        lessons: x.lessons.filter((_, j) => j !== sIdx),
                                      }
                                    : x
                                )
                              )
                            }
                            className="sm:col-span-1 text-left sm:text-center text-xs text-red-700 py-1"
                          >
                            Remove ×
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setPlanLevels((prev) =>
                          prev.map((x, idx) =>
                            idx === lIdx
                              ? {
                                  ...x,
                                  lessons: [
                                    ...x.lessons,
                                    {
                                      id: `lsn-${Date.now().toString(36)}-${x.lessons.length}`,
                                      title: `${lIdx + 1}.${x.lessons.length + 1} New lesson`,
                                      summary: '',
                                    },
                                  ],
                                }
                              : x
                          )
                        )
                      }
                      className="text-[11px] font-medium text-[#0E7C7B] hover:underline"
                    >
                      + Add lesson
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <FeedbackBanner
              feedback={planFeedback}
              onDismiss={() => setPlanFeedback(null)}
            />

            <button
              type="submit"
              disabled={savingPlan}
              className="w-full py-2.5 px-5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] disabled:opacity-60"
            >
              {savingPlan ? 'Saving plan...' : 'Publish learning plan'}
            </button>
          </form>

          <div className="lg:col-span-6 space-y-4">
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">
              My learning plans ({myCreatedPlans.length})
            </h2>
            {myCreatedPlans.length === 0 ? (
              <div className="rounded-2xl border border-[#084F4E]/12 bg-[#FAFBFB] p-8 text-sm text-[#3F4F4F]">
                You haven&apos;t created any learning plans yet. Create multiple plans for different levels, objectives, learners, or teams.
              </div>
            ) : (
              myCreatedPlans.map((pl) => (
                <div
                  key={pl.id}
                  className="rounded-[20px] border border-[#084F4E]/12 bg-white p-5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-lg font-semibold text-[#084F4E]">
                        {pl.name}
                      </p>
                      <p className="text-xs text-[#0E7C7B]">
                        {pl.level || 'All levels'} · ${(pl.unitPriceCents / 100).toFixed(0)} USD ·{' '}
                        {pl.isPublicEnrolment !== false ? 'Public enrolment' : 'Assigned only'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busyKey === `plan-active:${pl.id}`}
                      onClick={() => void togglePlanActive(pl)}
                      className="px-3 py-1 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E] disabled:opacity-60"
                    >
                      {busyKey === `plan-active:${pl.id}`
                        ? 'Saving...'
                        : pl.active
                          ? 'Active'
                          : 'Archived'}
                    </button>
                  </div>

                  <p className="text-xs text-[#1F2A2A] bg-[#FAFBFB] rounded-xl p-3 border border-[#084F4E]/10">
                    <strong>Objective:</strong> {pl.objective || pl.description}
                  </p>

                  {/* Apply this plan to Students or Teams */}
                  <div className="space-y-2 pt-2 border-t border-[#084F4E]/10">
                    <div>
                      <p className="text-[11px] font-semibold text-[#3F4F4F] mb-1">
                        Apply to my learners:
                      </p>
                      {students.length === 0 ? (
                        <p className="text-xs text-[#3F4F4F]">No learners assigned to you yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {students.map((stu) => {
                            const has = (stu.assignedPlanIds || []).includes(pl.id);
                            return (
                              <button
                                key={stu.uid}
                                type="button"
                                onClick={() => void toggleStudentPlan(stu, pl.id)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                  has
                                    ? 'bg-[#084F4E] text-white border-[#084F4E]'
                                    : 'bg-white text-[#3F4F4F] border-[#084F4E]/20 hover:bg-[#E6F4F4]'
                                }`}
                              >
                                {has ? '✓ ' : '+ '}
                                {stu.displayName}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold text-[#3F4F4F] mb-1">
                        Apply to teams:
                      </p>
                      {teams.length === 0 ? (
                        <p className="text-xs text-[#3F4F4F]">No active teams yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {teams.map((tm) => {
                            const applied = tm.assignedPlanIds || (tm.planId ? [tm.planId] : []);
                            const has = applied.includes(pl.id);
                            return (
                              <button
                                key={tm.id}
                                type="button"
                                onClick={() => void toggleTeamPlan(tm, pl.id)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                  has
                                    ? 'bg-[#0E7C7B] text-white border-[#0E7C7B]'
                                    : 'bg-white text-[#3F4F4F] border-[#084F4E]/20 hover:bg-[#E6F4F4]'
                                }`}
                              >
                                {has ? '✓ ' : '+ '}
                                {tm.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'availability' && (
        <section className="rounded-[24px] border border-[#084F4E]/12 bg-white p-6 sm:p-8 space-y-6">
          {!teacherProfile ? (
            <p className="text-sm text-[#3F4F4F]">
              Select or create a teacher profile first to configure weekly availability.
            </p>
          ) : (
            <>
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Lesson length (min)</label>
                  <input
                    type="number"
                    value={teacherProfile.lessonLengthMin}
                    onChange={(e) =>
                      setTeacherProfile({
                        ...teacherProfile,
                        lessonLengthMin: Number(e.target.value) || 45,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[#084F4E]/20 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Buffer time (min)</label>
                  <input
                    type="number"
                    value={teacherProfile.bufferMin}
                    onChange={(e) =>
                      setTeacherProfile({
                        ...teacherProfile,
                        bufferMin: Number(e.target.value) || 15,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[#084F4E]/20 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Max lessons per day</label>
                  <input
                    type="number"
                    value={teacherProfile.maxPerDay}
                    onChange={(e) =>
                      setTeacherProfile({
                        ...teacherProfile,
                        maxPerDay: Number(e.target.value) || 6,
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[#084F4E]/20 text-sm tabular-nums"
                  />
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[#084F4E] mb-2">Weekly UTC slots</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {teacherProfile.availability.map((s, idx) => (
                    <button
                      key={`${s.dayOfWeek}-${s.startHourUtc}-${idx}`}
                      type="button"
                      onClick={() =>
                        void saveAvailabilityProfile({
                          ...teacherProfile,
                          availability: teacherProfile.availability.filter((_, i) => i !== idx),
                        })
                      }
                      className="px-3 py-1.5 rounded-xl bg-[#E6F4F4] text-xs font-medium text-[#084F4E] hover:bg-red-50 hover:text-red-700"
                    >
                      {WEEKDAYS[s.dayOfWeek]} {String(s.startHourUtc).padStart(2, '0')}:
                      {String(s.startMinuteUtc).padStart(2, '0')} UTC ×
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={newDay}
                    onChange={(e) => setNewDay(Number(e.target.value))}
                    className="px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs"
                  >
                    {WEEKDAYS.map((d, idx) => (
                      <option key={d} value={idx}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={newHour}
                    onChange={(e) => setNewHour(Number(e.target.value))}
                    className="w-24 px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void saveAvailabilityProfile({
                        ...teacherProfile,
                        availability: [
                          ...teacherProfile.availability,
                          { dayOfWeek: newDay, startHourUtc: newHour, startMinuteUtc: 0 },
                        ],
                      })
                    }
                    className="px-4 py-2 rounded-xl bg-[#084F4E] text-white text-xs font-semibold"
                  >
                    Add slot
                  </button>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[#084F4E] mb-2">Days off</h3>
                <div className="flex flex-wrap gap-2 mb-2">
                  {teacherProfile.daysOff.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() =>
                        void saveAvailabilityProfile({
                          ...teacherProfile,
                          daysOff: teacherProfile.daysOff.filter((x) => x !== d),
                        })
                      }
                      className="px-3 py-1 rounded-lg bg-[#FAFBFB] border text-xs"
                    >
                      {d} ×
                    </button>
                  ))}
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="date"
                    value={newDayOff}
                    onChange={(e) => setNewDayOff(e.target.value)}
                    className="w-full sm:w-auto min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newDayOff) return;
                      void saveAvailabilityProfile({
                        ...teacherProfile,
                        daysOff: Array.from(new Set([...teacherProfile.daysOff, newDayOff])),
                      });
                      setNewDayOff('');
                    }}
                    className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-xl border border-[#084F4E]/20 text-xs font-semibold text-[#084F4E]"
                  >
                    Add day off
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {tab === 'students' && (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold text-[#084F4E]">My students</h2>
          {students.length === 0 ? (
            <div className="rounded-2xl border border-[#084F4E]/12 bg-[#FAFBFB] p-8 text-sm text-[#3F4F4F]">
              No students assigned to you yet.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {students.map((stu) => {
                const stuPlans = plans.filter((p) => (stu.assignedPlanIds || []).includes(p.id));
                const certSourcePlans = stuPlans.length > 0 ? stuPlans : assignablePlans.slice(0, 1);
                return (
                  <div
                    key={stu.uid}
                    className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 space-y-4"
                  >
                    <div>
                      <p className="font-semibold text-[#084F4E]">{stu.displayName}</p>
                      <p className="text-xs text-[#3F4F4F]">
                        {stu.timezone} · Level: {stu.placementLevel || 'Not set'}
                      </p>
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold text-[#3F4F4F] mb-1.5">
                        Applied learning plans:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {assignablePlans.map((pl) => {
                          const has = (stu.assignedPlanIds || []).includes(pl.id);
                          return (
                            <button
                              key={pl.id}
                              type="button"
                              onClick={() => void toggleStudentPlan(stu, pl.id)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                                has
                                  ? 'bg-[#084F4E] text-white border-[#084F4E]'
                                  : 'bg-white text-[#3F4F4F] border-[#084F4E]/20 hover:bg-[#E6F4F4]'
                              }`}
                            >
                              {has ? '✓ ' : '+ '}
                              {pl.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {certSourcePlans.length > 0 && (
                      <div className="pt-2 border-t border-[#084F4E]/10 space-y-2">
                        <p className="text-[11px] font-semibold text-[#3F4F4F]">
                          Issue level completion certificate:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {certSourcePlans.flatMap((pl) =>
                            pl.learningPath.map((lvl) => (
                              <button
                                key={`${pl.id}-${lvl.id}`}
                                type="button"
                                onClick={() =>
                                  void issueCertificateForStudent(stu, lvl.title, pl.name)
                                }
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E] hover:bg-[#E6F4F4]"
                              >
                                <Award className="w-3.5 h-3.5" />
                                <span>{lvl.title.split('·')[0].trim()}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {tab === 'resources' && (
        <div className="grid lg:grid-cols-12 gap-8 items-start">
          <form
            onSubmit={(e) => void handleUploadResource(e)}
            className="lg:col-span-6 rounded-[20px] border border-[#084F4E]/12 bg-white p-6 space-y-4"
          >
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">
              Upload private resource
            </h2>
            <p className="text-xs text-[#3F4F4F]">
              Uploaded PDFs and videos are never given public URLs and stream only inside the portal (max 60 MB; keep under 4 MB on serverless deployments).
            </p>
            <input
              required
              placeholder="Resource title"
              value={resTitle}
              onChange={(e) => setResTitle(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                value={resType}
                onChange={(e) => {
                  setResType(e.target.value as 'pdf' | 'video' | 'link');
                  setResFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                  setUploadFeedback(null);
                }}
                className="min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs bg-white"
              >
                <option value="pdf">PDF (Canvas)</option>
                <option value="video">Video (MP4)</option>
                <option value="link">External Link</option>
              </select>
              <input
                value={resLevel}
                onChange={(e) => setResLevel(e.target.value)}
                placeholder="Level"
                className="min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs"
              />
              <input
                value={resTopic}
                onChange={(e) => setResTopic(e.target.value)}
                placeholder="Topic"
                className="min-h-[40px] px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs"
              />
            </div>

            {resType === 'link' ? (
              <input
                type="url"
                required
                placeholder="https://youtube.com/..."
                value={resUrl}
                onChange={(e) => setResUrl(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
              />
            ) : (
              <div className="space-y-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={resType === 'pdf' ? 'application/pdf' : 'video/mp4,video/webm'}
                  onChange={(e) => {
                    setResFile(e.target.files?.[0] || null);
                    setUploadFeedback(null);
                  }}
                  className="w-full text-xs"
                />
                {resFile && (
                  <p className="text-[11px] text-[#0E7C7B] tabular-nums">
                    Selected: {resFile.name} ({(resFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </p>
                )}
              </div>
            )}

            <textarea
              rows={2}
              placeholder="Short description..."
              value={resDesc}
              onChange={(e) => setResDesc(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />

            {/* Apply resource to specific learning plans */}
            <div className="space-y-2 pt-2 border-t border-[#084F4E]/10">
              <p className="text-xs font-semibold text-[#084F4E]">
                Apply resource to learning plans
              </p>
              {assignablePlans.length === 0 ? (
                <p className="text-xs text-[#3F4F4F]">Create a learning plan first to link resources directly to it.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {assignablePlans.map((pl) => {
                    const selected = resPlanIds.includes(pl.id);
                    return (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() =>
                          setResPlanIds((prev) =>
                            prev.includes(pl.id)
                              ? prev.filter((id) => id !== pl.id)
                              : [...prev, pl.id]
                          )
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                          selected
                            ? 'bg-[#084F4E] text-white border-[#084F4E]'
                            : 'bg-white text-[#3F4F4F] border-[#084F4E]/20 hover:bg-[#E6F4F4]'
                        }`}
                      >
                        {selected ? '✓ ' : '+ '}
                        {pl.name}
                      </button>
                    );
                  })}
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-[#3F4F4F] pt-1">
                <input
                  type="checkbox"
                  checked={resPublicToPaid}
                  onChange={(e) => setResPublicToPaid(e.target.checked)}
                />
                <span>Also visible to all paid learners across plans</span>
              </label>
            </div>

            <FeedbackBanner
              feedback={uploadFeedback}
              onDismiss={() => setUploadFeedback(null)}
              action={
                uploadFeedback?.type === 'success' ? (
                  <Link
                    to="/resources"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#084F4E] underline"
                  >
                    Open Study Resources
                  </Link>
                ) : undefined
              }
            />

            <button
              type="submit"
              disabled={uploading}
              className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] disabled:opacity-60"
            >
              <Upload className="w-4 h-4" />
              <span>{uploading ? 'Uploading resource...' : 'Publish resource'}</span>
            </button>
          </form>

          <div className="lg:col-span-6 space-y-3">
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">My uploads ({resources.length})</h2>
            {resources.length === 0 ? (
              <div className="rounded-2xl border border-[#084F4E]/12 bg-[#FAFBFB] p-6 text-sm text-[#3F4F4F]">
                No resources uploaded yet.
              </div>
            ) : (
              resources.map((r) => {
                const linkedNames = (r.planIds || [])
                  .map((pid) => plans.find((p) => p.id === pid)?.name || pid)
                  .join(', ');
                return (
                  <div
                    key={r.id}
                    className="rounded-2xl border border-[#084F4E]/12 bg-white p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-[#084F4E] truncate">{r.title}</p>
                      <p className="text-xs text-[#3F4F4F]">
                        {r.type.toUpperCase()} · {r.level} · {r.topic}
                      </p>
                      {linkedNames && (
                        <p className="text-[11px] text-[#0E7C7B] mt-0.5">
                          Applied to: {linkedNames}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busyKey === `del-res:${r.id}`}
                      onClick={() => void handleDeleteResource(r)}
                      className="p-2 rounded-lg text-red-700 hover:bg-red-50 disabled:opacity-50 shrink-0"
                      aria-label="Delete resource"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
