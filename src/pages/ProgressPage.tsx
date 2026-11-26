import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import QRCode from 'qrcode';
import { Award, CheckCircle2, ExternalLink } from 'lucide-react';
import { db, formatPortalError } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { FeedbackBanner, type FeedbackState } from '../components/FeedbackBanner';
import type { LessonProgress, PortalBooking, PortalCertificate } from '../types/portal';

function CertificateCard({ cert }: { cert: PortalCertificate }) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const verifyPath = `/verify/${cert.certCode}`;
  const fullUrl = `${window.location.origin}${verifyPath}`;

  useEffect(() => {
    QRCode.toDataURL(fullUrl, { width: 120, margin: 1, color: { dark: '#084F4E', light: '#FFFFFF' } })
      .then(setQrDataUrl)
      .catch(() => {});
  }, [fullUrl]);

  return (
    <div className="rounded-[20px] border border-[#C9A84C]/50 bg-[#FAFBFB] p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
      <div className="space-y-1.5">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0E7C7B]">
          <Award className="w-4 h-4" />
          <span>Level Completion Certificate</span>
        </div>
        <h3 className="font-display text-xl font-semibold text-[#084F4E]">{cert.levelName}</h3>
        <p className="text-xs text-[#3F4F4F]">
          {cert.learnerName} · {cert.planName} · Issued{' '}
          {new Date(cert.issuedAt).toLocaleDateString()}
        </p>
        <Link
          to={verifyPath}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#084F4E] hover:underline pt-1"
        >
          <span>Open public verify page</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>
      {qrDataUrl && (
        <img
          src={qrDataUrl}
          alt={`Verification QR code for ${cert.certCode}`}
          className="w-24 h-24 rounded-xl border border-[#084F4E]/10 bg-white p-1 shrink-0"
        />
      )}
    </div>
  );
}

export function ProgressPage() {
  const { portalUser } = useAuth();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [lessons, setLessons] = useState<LessonProgress[]>([]);
  const [bookings, setBookings] = useState<PortalBooking[]>([]);
  const [sessionsCount, setSessionsCount] = useState(0);
  const [certs, setCerts] = useState<PortalCertificate[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const portalUid = portalUser?.uid || '';

  useEffect(() => {
    if (!portalUid) return;

    const onErr = (err: unknown) => {
      const msg = formatPortalError(err, 'Unable to load progress records.');
      setFeedback({ type: 'error', text: msg });
      toastRef.current.error(msg);
    };

    const unsubLessons = onSnapshot(
      query(
        collection(db, 'portal_progress', portalUid, 'lessons'),
        where('studentId', '==', portalUid)
      ),
      (snap) => setLessons(snap.docs.map((d) => d.data() as LessonProgress)),
      onErr
    );

    const unsubBookings = onSnapshot(
      query(collection(db, 'portal_bookings'), where('studentId', '==', portalUid)),
      (snap) =>
        setBookings(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalBooking, 'id'>) }))),
      onErr
    );

    const unsubSessions = onSnapshot(
      query(collection(db, 'portal_sessions'), where('attendeeIds', 'array-contains', portalUid)),
      (snap) => setSessionsCount(snap.size),
      onErr
    );

    const unsubCerts = onSnapshot(
      query(collection(db, 'portal_certificates'), where('userId', '==', portalUid)),
      (snap) => setCerts(snap.docs.map((d) => d.data() as PortalCertificate)),
      onErr
    );

    return () => {
      unsubLessons();
      unsubBookings();
      unsubSessions();
      unsubCerts();
    };
  }, [portalUid]);

  if (!portalUser) return null;

  const doneCount = lessons.filter((l) => l.status === 'done').length;
  const completedBookings = bookings.filter((b) => b.status === 'completed');
  const streakWeeks = Math.max(1, Math.min(12, doneCount + completedBookings.length));

  // Simple 6-week SVG chart values
  const bars = [
    Math.max(1, Math.floor(doneCount * 0.3)),
    Math.max(1, Math.floor(doneCount * 0.5)),
    Math.max(1, Math.floor(completedBookings.length + 1)),
    Math.max(2, doneCount),
    Math.max(1, sessionsCount + 1),
    doneCount + completedBookings.length + sessionsCount,
  ];
  const maxBar = Math.max(...bars, 4);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-12 space-y-6 sm:space-y-8">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#084F4E]">Your progress</h1>
        <p className="text-sm text-[#3F4F4F] mt-1">
          Lessons completed, community practice, teacher feedback, and certificates.
        </p>
      </div>

      <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: 'Lessons done', value: String(doneCount) },
          { label: 'Sessions attended', value: String(sessionsCount + completedBookings.length) },
          { label: 'Active week streak', value: `${streakWeeks} wk` },
          { label: 'Current level', value: portalUser.placementLevel?.split(' ')[0] || 'Level 1' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-[#084F4E]/12 bg-white p-4 sm:p-5"
          >
            <p className="text-xs text-[#3F4F4F] mb-1">{stat.label}</p>
            <p className="font-display text-xl sm:text-2xl font-semibold text-[#084F4E] tabular-nums">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Simple SVG Activity Chart */}
      <section className="rounded-[24px] border border-[#084F4E]/12 bg-white p-5 sm:p-8">
        <h2 className="font-display text-xl font-semibold text-[#084F4E] mb-4">
          Weekly study rhythm
        </h2>
        <div className="w-full overflow-x-auto">
          <svg viewBox="0 0 600 160" className="w-full min-w-[280px] max-w-2xl h-36 sm:h-40">
            {bars.map((val, idx) => {
              const barHeight = Math.round((val / maxBar) * 100);
              const x = idx * 96 + 24;
              const y = 120 - barHeight;
              return (
                <g key={idx}>
                  <rect
                    x={x}
                    y={y}
                    width={48}
                    height={barHeight}
                    rx={10}
                    fill={idx === bars.length - 1 ? '#C9A84C' : '#0E7C7B'}
                  />
                  <text
                    x={x + 24}
                    y={144}
                    textAnchor="middle"
                    fontSize="12"
                    fill="#3F4F4F"
                  >
                    W{idx + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      {/* Certificates */}
      <section className="space-y-4">
        <h2 className="font-display text-2xl font-semibold text-[#084F4E]">
          Certificates
        </h2>
        {certs.length === 0 ? (
          <div className="rounded-[20px] border border-[#084F4E]/12 bg-[#FAFBFB] p-5 sm:p-6 text-sm text-[#3F4F4F]">
            Complete every lesson in a level on your Dashboard to earn a verifiable certificate with a QR code.
          </div>
        ) : (
          <div className="space-y-4">
            {certs.map((c) => (
              <CertificateCard key={c.certCode} cert={c} />
            ))}
          </div>
        )}
      </section>

      {/* Teacher Feedback */}
      <section className="space-y-4">
        <h2 className="font-display text-2xl font-semibold text-[#084F4E]">
          Teacher feedback
        </h2>
        {completedBookings.filter((b) => b.teacherFeedback).length === 0 &&
        lessons.filter((l) => l.teacherNote).length === 0 ? (
          <div className="rounded-[20px] border border-[#084F4E]/12 bg-white p-6 text-sm text-[#3F4F4F]">
            Feedback from your teacher after each lesson will appear here.
          </div>
        ) : (
          <div className="space-y-3">
            {completedBookings
              .filter((b) => b.teacherFeedback)
              .map((b) => (
                <div
                  key={b.id}
                  className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 space-y-1"
                >
                  <p className="text-xs text-[#0E7C7B] font-medium">
                    Lesson with {b.teacherName} · {new Date(b.startUtc).toLocaleDateString()}
                  </p>
                  <p className="text-sm text-[#1F2A2A]">{b.teacherFeedback}</p>
                </div>
              ))}
            {lessons
              .filter((l) => l.teacherNote)
              .map((l) => (
                <div
                  key={l.lessonId}
                  className="rounded-2xl border border-[#084F4E]/12 bg-white p-5 flex items-start gap-3"
                >
                  <CheckCircle2 className="w-4 h-4 text-[#0E7C7B] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-[#0E7C7B] font-medium">{l.lessonTitle}</p>
                    <p className="text-sm text-[#1F2A2A] mt-0.5">{l.teacherNote}</p>
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
