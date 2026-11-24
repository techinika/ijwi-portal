import { useEffect, useMemo, useState } from 'react';
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
import { Calendar, Clock, Download, Star } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { DEFAULT_TEACHERS } from '../lib/seed';
import { dispatchPortalEmail, pushNotification } from '../lib/portalActions';
import { apiFetch } from '../lib/api';
import { canCancelWithoutPenalty, hasBookingConflict } from '../shared/pricing';
import type { PortalBooking, TeacherProfile } from '../types/portal';

const COMMON_TIMEZONES = [
  'Africa/Kigali',
  'UTC',
  'Europe/London',
  'Europe/Brussels',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Dubai',
];

export function BookingsPage() {
  const { portalUser } = useAuth();
  const [teacher, setTeacher] = useState<TeacherProfile>(DEFAULT_TEACHERS[0]);
  const [teacherBookings, setTeacherBookings] = useState<PortalBooking[]>([]);
  const [myBookings, setMyBookings] = useState<PortalBooking[]>([]);
  const [timezone, setTimezone] = useState<string>(
    portalUser?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );
  const [selectedSlotUtc, setSelectedSlotUtc] = useState<string>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ratingBookingId, setRatingBookingId] = useState<string | null>(null);
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingComment, setRatingComment] = useState('');

  useEffect(() => {
    if (!portalUser) return;
    setTimezone(portalUser.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

    const teacherId = portalUser.teacherId || DEFAULT_TEACHERS[0].uid;
    getDoc(doc(db, 'portal_teachers', teacherId)).then((snap) => {
      if (snap.exists()) setTeacher(snap.data() as TeacherProfile);
    });

    const unsubMine = onSnapshot(
      query(collection(db, 'portal_bookings'), where('studentId', '==', portalUser.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<PortalBooking, 'id'>) }))
          .sort((a, b) => Date.parse(b.startUtc) - Date.parse(a.startUtc));
        setMyBookings(list);
      }
    );

    const unsubTeacher = onSnapshot(
      query(collection(db, 'portal_bookings'), where('teacherId', '==', teacherId)),
      (snap) => {
        setTeacherBookings(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalBooking, 'id'>) }))
        );
      }
    );

    return () => {
      unsubMine();
      unsubTeacher();
    };
  }, [portalUser]);

  // Generate next 10 days of open teacher slots in UTC, displayed in user's local timezone
  const openSlots = useMemo(() => {
    const slots: Array<{ startUtc: string; endUtc: string; localLabel: string }> = [];
    const now = new Date();
    for (let dayOffset = 1; dayOffset <= 10; dayOffset++) {
      const d = new Date(now.getTime() + dayOffset * 86400_000);
      const yyyyMmDd = d.toISOString().slice(0, 10);
      if (teacher.daysOff.includes(yyyyMmDd)) continue;
      const dow = d.getUTCDay();
      const matching = teacher.availability.filter((s) => s.dayOfWeek === dow);
      for (const s of matching) {
        const start = new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), s.startHourUtc, s.startMinuteUtc, 0)
        );
        const end = new Date(start.getTime() + teacher.lessonLengthMin * 60_000);
        const startUtc = start.toISOString();
        const endUtc = end.toISOString();
        if (!hasBookingConflict(startUtc, endUtc, teacherBookings)) {
          const localLabel = new Intl.DateTimeFormat(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: timezone,
          }).format(start);
          slots.push({ startUtc, endUtc, localLabel });
        }
      }
    }
    return slots;
  }, [teacher, teacherBookings, timezone]);

  async function handleTimezoneChange(nextTz: string) {
    setTimezone(nextTz);
    if (portalUser) {
      await updateDoc(doc(db, 'users', portalUser.uid), {
        timezone: nextTz,
        updatedAt: serverTimestamp(),
      });
    }
  }

  async function handleConfirmBooking() {
    if (!portalUser || !selectedSlotUtc) return;
    const chosen = openSlots.find((s) => s.startUtc === selectedSlotUtc);
    if (!chosen) return;
    if (hasBookingConflict(chosen.startUtc, chosen.endUtc, teacherBookings)) {
      setMessage('That slot was just booked. Please pick another time.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const bookingId = `bkg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await setDoc(doc(db, 'portal_bookings', bookingId), {
        studentId: portalUser.uid,
        studentName: portalUser.displayName,
        teacherId: teacher.uid,
        teacherName: teacher.displayName,
        startUtc: chosen.startUtc,
        endUtc: chosen.endUtc,
        status: 'confirmed',
        ...(note.trim() ? { note: note.trim() } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await pushNotification({
        userId: portalUser.uid,
        title: 'Lesson booked',
        body: `Confirmed with ${teacher.displayName} for ${chosen.localLabel}.`,
        type: 'booking',
        link: '/bookings',
      });

      await dispatchPortalEmail({
        userId: portalUser.uid,
        to: portalUser.email,
        recipientName: portalUser.displayName,
        type: 'booking_confirmed',
        subject: `Lesson confirmed with ${teacher.displayName}`,
        headline: 'Your Kinyarwanda lesson is booked',
        bodyText: `Date & time (${timezone}): ${chosen.localLabel}\nTeacher: ${teacher.displayName}\n${note ? `Your note: ${note}` : ''}`,
        ctaLabel: 'Manage Booking',
        ctaUrl: '/bookings',
        essential: true,
      });

      setSelectedSlotUtc('');
      setNote('');
      setMessage('Lesson confirmed! You can download the calendar (.ics) file below.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelBooking(b: PortalBooking) {
    if (!portalUser) return;
    const freeCancel = canCancelWithoutPenalty(b.startUtc, 12);
    const nextStatus = freeCancel ? 'cancelled' : 'late_cancel';
    await updateDoc(doc(db, 'portal_bookings', b.id), {
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    if (!freeCancel) {
      await updateDoc(doc(db, 'users', portalUser.uid), {
        lateCancelCount: (portalUser.lateCancelCount || 0) + 1,
        updatedAt: serverTimestamp(),
      });
    }
    setMessage(
      freeCancel
        ? 'Lesson cancelled.'
        : 'Lesson cancelled within the 12-hour window and noted on your profile.'
    );
  }

  async function handleDownloadIcs(b: PortalBooking) {
    const res = await fetch('/api/bookings/ics', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await (await import('../lib/firebase')).auth.currentUser?.getIdToken()}`,
      },
      body: JSON.stringify({
        bookingId: b.id,
        title: `Ijwi Kinyarwanda Lesson with ${b.teacherName}`,
        description: b.note || '1-on-1 Kinyarwanda class',
        startUtc: b.startUtc,
        endUtc: b.endUtc,
      }),
    });
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ijwi-lesson-${b.id}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSubmitRating(b: PortalBooking) {
    if (!portalUser) return;
    const fbId = `fb-${b.id}`;
    await setDoc(doc(db, 'portal_feedback', fbId), {
      bookingId: b.id,
      studentId: portalUser.uid,
      studentName: portalUser.displayName,
      teacherId: b.teacherId,
      teacherName: b.teacherName,
      rating: ratingValue,
      ...(ratingComment.trim() ? { comment: ratingComment.trim() } : {}),
      createdAt: serverTimestamp(),
    });
    setRatingBookingId(null);
    setRatingComment('');
    setMessage('Thank you! Your feedback was shared privately with the Ijwi admin team.');
  }

  if (!portalUser) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-[#084F4E]">
            Book a lesson
          </h1>
          <p className="text-sm text-[#3F4F4F] mt-1">
            Open slots with {teacher.displayName} shown in your local time zone.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="tz-select" className="text-xs font-medium text-[#3F4F4F]">
            Time zone
          </label>
          <select
            id="tz-select"
            value={timezone}
            onChange={(e) => void handleTimezoneChange(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#084F4E]/20 bg-white text-sm text-[#084F4E]"
          >
            {Array.from(new Set([timezone, ...COMMON_TIMEZONES])).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
      </div>

      {message && (
        <div className="rounded-2xl border border-[#0E7C7B]/25 bg-[#E6F4F4] px-5 py-3.5 text-sm text-[#084F4E]">
          {message}
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-8 items-start">
        {/* Slot Picker */}
        <section className="lg:col-span-7 rounded-[24px] border border-[#084F4E]/12 bg-white p-6 sm:p-8 space-y-5">
          <h2 className="font-display text-xl font-semibold text-[#084F4E]">
            Available times ({teacher.lessonLengthMin} min)
          </h2>

          {openSlots.length === 0 ? (
            <p className="text-sm text-[#3F4F4F] py-6">
              No open slots in the next 10 days. Check back soon or contact learn@ijwi.me.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
              {openSlots.map((slot) => {
                const active = selectedSlotUtc === slot.startUtc;
                return (
                  <button
                    key={slot.startUtc}
                    type="button"
                    onClick={() => setSelectedSlotUtc(slot.startUtc)}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-left text-sm transition-colors ${
                      active
                        ? 'border-[#084F4E] bg-[#084F4E] text-white font-semibold'
                        : 'border-[#084F4E]/15 text-[#1F2A2A] hover:bg-[#E6F4F4]/50'
                    }`}
                  >
                    <Clock className="w-4 h-4 shrink-0" />
                    <span className="tabular-nums">{slot.localLabel}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div>
            <label htmlFor="booking-note" className="block text-sm font-medium text-[#1F2A2A] mb-1.5">
              Optional note for {teacher.displayName}
            </label>
            <textarea
              id="booking-note"
              rows={2}
              maxLength={400}
              placeholder="What would you like to practise in this lesson?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-[#084F4E]/20 text-sm"
            />
          </div>

          <button
            type="button"
            disabled={!selectedSlotUtc || saving}
            onClick={() => void handleConfirmBooking()}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] transition-colors disabled:opacity-50"
          >
            {saving ? 'Confirming...' : 'Confirm lesson booking'}
          </button>
        </section>

        {/* My Bookings */}
        <section className="lg:col-span-5 rounded-[24px] border border-[#084F4E]/12 bg-white p-6 sm:p-8 space-y-4">
          <h2 className="font-display text-xl font-semibold text-[#084F4E]">
            My lessons
          </h2>
          {myBookings.length === 0 ? (
            <p className="text-sm text-[#3F4F4F]">You have no booked lessons yet.</p>
          ) : (
            <div className="space-y-3">
              {myBookings.map((b) => {
                const local = new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: timezone,
                }).format(new Date(b.startUtc));
                const active = b.status === 'confirmed' || b.status === 'rescheduled';
                return (
                  <div
                    key={b.id}
                    className="p-4 rounded-2xl border border-[#084F4E]/12 bg-[#FAFBFB] space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[#084F4E] tabular-nums">{local}</p>
                        <p className="text-xs text-[#3F4F4F]">
                          with {b.teacherName} · Status: <strong className="capitalize">{b.status.replace('_', ' ')}</strong>
                        </p>
                      </div>
                      <Calendar className="w-4 h-4 text-[#0E7C7B] shrink-0" />
                    </div>

                    {b.teacherFeedback && (
                      <p className="text-xs text-[#084F4E] bg-white rounded-xl p-2.5 border border-[#084F4E]/10">
                        Teacher feedback: {b.teacherFeedback}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                      {active && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleDownloadIcs(b)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#084F4E]/20 bg-white text-xs font-medium text-[#084F4E] hover:bg-[#E6F4F4]"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Add to calendar (.ics)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCancelBooking(b)}
                            className="px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            Cancel
                          </button>
                        </>
                      )}

                      {b.status === 'completed' && ratingBookingId !== b.id && (
                        <button
                          type="button"
                          onClick={() => setRatingBookingId(b.id)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#E8C97A]/35 text-xs font-semibold text-[#084F4E]"
                        >
                          <Star className="w-3.5 h-3.5" />
                          <span>Rate lesson</span>
                        </button>
                      )}
                    </div>

                    {ratingBookingId === b.id && (
                      <div className="pt-2 border-t border-[#084F4E]/10 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">Rating:</span>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => setRatingValue(n)}
                              className={`px-2 py-1 rounded text-xs font-semibold ${
                                ratingValue === n ? 'bg-[#084F4E] text-white' : 'bg-white border'
                              }`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                        <input
                          type="text"
                          placeholder="Optional feedback for Ijwi team"
                          value={ratingComment}
                          onChange={(e) => setRatingComment(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-[#084F4E]/20 bg-white text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSubmitRating(b)}
                            className="px-3 py-1.5 rounded-lg bg-[#084F4E] text-white text-xs font-semibold"
                          >
                            Submit
                          </button>
                          <button
                            type="button"
                            onClick={() => setRatingBookingId(null)}
                            className="px-3 py-1.5 rounded-lg text-xs text-[#3F4F4F]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
