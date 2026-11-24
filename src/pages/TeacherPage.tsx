import { useEffect, useState } from 'react';
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
  deleteDoc,
} from 'firebase/firestore';
import { Upload, CheckCircle2, Trash2, Calendar, Award } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import { DEFAULT_PLANS, DEFAULT_TEACHERS } from '../lib/seed';
import { dispatchPortalEmail, pushNotification } from '../lib/portalActions';
import type {
  PortalBooking,
  PortalResource,
  PortalUser,
  TeacherProfile,
} from '../types/portal';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function TeacherPage() {
  const { portalUser } = useAuth();
  const [tab, setTab] = useState<'today' | 'availability' | 'students' | 'resources'>('today');
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile>(DEFAULT_TEACHERS[0]);
  const [bookings, setBookings] = useState<PortalBooking[]>([]);
  const [students, setStudents] = useState<PortalUser[]>([]);
  const [resources, setResources] = useState<PortalResource[]>([]);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  // Availability form state
  const [newDay, setNewDay] = useState(1);
  const [newHour, setNewHour] = useState(10);
  const [newDayOff, setNewDayOff] = useState('');

  // Resource upload form state
  const [resTitle, setResTitle] = useState('');
  const [resType, setResType] = useState<'pdf' | 'video' | 'link'>('pdf');
  const [resLevel, setResLevel] = useState('Level 1');
  const [resTopic, setResTopic] = useState('Greetings');
  const [resDesc, setResDesc] = useState('');
  const [resUrl, setResUrl] = useState('');
  const [resFile, setResFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!portalUser) return;
    const teacherUid =
      portalUser.role === 'teacher' ? portalUser.uid : DEFAULT_TEACHERS[0].uid;

    getDoc(doc(db, 'portal_teachers', teacherUid)).then((snap) => {
      if (snap.exists()) setTeacherProfile(snap.data() as TeacherProfile);
    });

    const unsubB = onSnapshot(
      query(collection(db, 'portal_bookings'), where('teacherId', '==', teacherUid)),
      (snap) => {
        setBookings(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<PortalBooking, 'id'>) }))
            .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
        );
      }
    );

    const unsubS = onSnapshot(
      query(collection(db, 'users'), where('teacherId', '==', teacherUid)),
      (snap) => setStudents(snap.docs.map((d) => d.data() as PortalUser))
    );

    const unsubR = onSnapshot(
      query(collection(db, 'portal_resources'), where('uploaderId', '==', portalUser.uid)),
      (snap) =>
        setResources(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalResource, 'id'>) }))
        )
    );

    return () => {
      unsubB();
      unsubS();
      unsubR();
    };
  }, [portalUser]);

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
    const feedback = (feedbackDrafts[b.id] || '').trim();
    await updateDoc(doc(db, 'portal_bookings', b.id), {
      status,
      ...(feedback ? { teacherFeedback: feedback } : {}),
      updatedAt: serverTimestamp(),
    });

    if (status === 'no_show') {
      const stuSnap = await getDoc(doc(db, 'users', b.studentId));
      if (stuSnap.exists()) {
        await updateDoc(doc(db, 'users', b.studentId), {
          noShowCount: Number(stuSnap.data().noShowCount || 0) + 1,
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (feedback) {
      await pushNotification({
        userId: b.studentId,
        title: `Feedback from ${b.teacherName}`,
        body: feedback.slice(0, 140),
        type: 'feedback',
        link: '/progress',
      });
    }
    setMessage(`Marked lesson with ${b.studentName} as ${status.replace('_', ' ')}.`);
  }

  async function saveAvailabilityProfile(next: TeacherProfile) {
    setTeacherProfile(next);
    await setDoc(
      doc(db, 'portal_teachers', next.uid),
      {
        ...next,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    setMessage('Availability updated.');
  }

  async function handleUploadResource(e: React.FormEvent) {
    e.preventDefault();
    if (!portalUser || !resTitle.trim()) return;
    setUploading(true);
    setMessage(null);
    try {
      let fileKey = '';
      if (resType !== 'link') {
        if (!resFile) {
          setMessage('Please choose a PDF or MP4 file.');
          setUploading(false);
          return;
        }
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(resFile);
        });
        const uploaded = await apiFetch<{ fileKey: string }>('/api/resources/upload', {
          method: 'POST',
          body: JSON.stringify({
            filename: resFile.name,
            mimeType: resFile.type || (resType === 'pdf' ? 'application/pdf' : 'video/mp4'),
            base64Data,
          }),
        });
        fileKey = uploaded.fileKey;
      }

      const id = `res-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await setDoc(doc(db, 'portal_resources', id), {
        type: resType,
        title: resTitle.trim(),
        ...(resDesc.trim() ? { description: resDesc.trim() } : {}),
        ...(fileKey ? { fileKey } : {}),
        ...(resType === 'link' && resUrl.trim() ? { url: resUrl.trim() } : {}),
        level: resLevel,
        topic: resTopic,
        uploaderId: portalUser.uid,
        uploaderName: portalUser.displayName,
        publicToPaid: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setResTitle('');
      setResDesc('');
      setResUrl('');
      setResFile(null);
      setMessage('Resource published privately to paid learners.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function issueCertificateForStudent(stu: PortalUser, levelTitle: string) {
    const certCode = `IJW-${stu.uid.slice(0, 4).toUpperCase()}-${Date.now()
      .toString(36)
      .toUpperCase()}`;
    await setDoc(doc(db, 'portal_certificates', certCode), {
      certCode,
      userId: stu.uid,
      learnerName: stu.displayName,
      levelName: levelTitle,
      planName: DEFAULT_PLANS[0].name,
      issuedAt: new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
    await dispatchPortalEmail({
      userId: stu.uid,
      to: stu.email,
      recipientName: stu.displayName,
      type: 'certificate',
      subject: `Congratulations! Your Ijwi ${levelTitle} certificate`,
      headline: `You completed ${levelTitle}`,
      bodyText: `Your teacher ${portalUser?.displayName} issued your verified completion certificate.`,
      ctaLabel: 'View Certificate',
      ctaUrl: `/verify/${certCode}`,
    });
    setMessage(`Certificate ${certCode} issued to ${stu.displayName}.`);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-[#084F4E]">Teacher Desk</h1>
          <p className="text-sm text-[#3F4F4F]">
            Manage today&apos;s classes, weekly availability, student progress, and study resources.
          </p>
        </div>

        <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-[#E6F4F4]">
          {(
            [
              ['today', 'Today'],
              ['availability', 'Availability'],
              ['students', 'My Students'],
              ['resources', 'Resources'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
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
                        className="flex-1 px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => void markAttendance(b, 'completed')}
                        className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-[#084F4E] text-white text-xs font-semibold"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Mark completed</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void markAttendance(b, 'no_show')}
                        className="px-4 py-2 rounded-xl border border-amber-300 text-xs font-medium text-amber-800"
                      >
                        No-show
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === 'availability' && (
        <section className="rounded-[24px] border border-[#084F4E]/12 bg-white p-6 sm:p-8 space-y-6">
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
                  setTeacherProfile({ ...teacherProfile, bufferMin: Number(e.target.value) || 15 })
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
                  setTeacherProfile({ ...teacherProfile, maxPerDay: Number(e.target.value) || 6 })
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
            <div className="flex gap-2">
              <input
                type="date"
                value={newDayOff}
                onChange={(e) => setNewDayOff(e.target.value)}
                className="px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs"
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
                className="px-4 py-2 rounded-xl border border-[#084F4E]/20 text-xs font-semibold text-[#084F4E]"
              >
                Add day off
              </button>
            </div>
          </div>
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
              {students.map((stu) => (
                <div
                  key={stu.uid}
                  className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 space-y-3"
                >
                  <div>
                    <p className="font-semibold text-[#084F4E]">{stu.displayName}</p>
                    <p className="text-xs text-[#3F4F4F]">
                      {stu.timezone} · Level: {stu.placementLevel || 'Not set'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {DEFAULT_PLANS[0].learningPath.map((lvl) => (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() => void issueCertificateForStudent(stu, lvl.title)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E] hover:bg-[#E6F4F4]"
                      >
                        <Award className="w-3.5 h-3.5" />
                        <span>Certify {lvl.title.split('·')[0].trim()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
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
              Uploaded PDFs and videos are never given public URLs and stream only inside the portal.
            </p>
            <input
              required
              placeholder="Resource title"
              value={resTitle}
              onChange={(e) => setResTitle(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />
            <div className="grid grid-cols-3 gap-2">
              <select
                value={resType}
                onChange={(e) => setResType(e.target.value as 'pdf' | 'video' | 'link')}
                className="px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs"
              >
                <option value="pdf">PDF (Canvas)</option>
                <option value="video">Video (MP4)</option>
                <option value="link">External Link</option>
              </select>
              <input
                value={resLevel}
                onChange={(e) => setResLevel(e.target.value)}
                placeholder="Level"
                className="px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs"
              />
              <input
                value={resTopic}
                onChange={(e) => setResTopic(e.target.value)}
                placeholder="Topic"
                className="px-3 py-2 rounded-xl border border-[#084F4E]/20 text-xs"
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
              <input
                type="file"
                accept={resType === 'pdf' ? 'application/pdf' : 'video/mp4,video/webm'}
                onChange={(e) => setResFile(e.target.files?.[0] || null)}
                className="w-full text-xs"
              />
            )}

            <textarea
              rows={2}
              placeholder="Short description..."
              value={resDesc}
              onChange={(e) => setResDesc(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />

            <button
              type="submit"
              disabled={uploading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold"
            >
              <Upload className="w-4 h-4" />
              <span>{uploading ? 'Uploading...' : 'Publish resource'}</span>
            </button>
          </form>

          <div className="lg:col-span-6 space-y-3">
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">My uploads</h2>
            {resources.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl border border-[#084F4E]/12 bg-white p-4 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="font-semibold text-sm text-[#084F4E]">{r.title}</p>
                  <p className="text-xs text-[#3F4F4F]">
                    {r.type.toUpperCase()} · {r.level} · {r.topic}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void deleteDoc(doc(db, 'portal_resources', r.id))}
                  className="p-2 rounded-lg text-red-700 hover:bg-red-50"
                  aria-label="Delete resource"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
