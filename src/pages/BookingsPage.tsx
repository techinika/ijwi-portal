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
import { Calendar, Clock, Download, RefreshCw, Star } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { fetchActiveTeachers } from '../lib/seed';
import { dispatchPortalEmail, pushNotification } from '../lib/portalActions';
import { canCancelWithoutPenalty, hasBookingConflict } from '../shared/pricing';
import type { BusySlot, PortalBooking, TeacherProfile } from '../types/portal';

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
  const [teachers, setTeachers] = useState<TeacherProfile[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [assignedTeacher, setAssignedTeacher] = useState<TeacherProfile | null>(null);
  const [busySlots, setBusySlots] = useState<BusySlot[]>([]);
  const [myBookings, setMyBookings] = useState<PortalBooking[]>([]);
  const [timezone, setTimezone] = useState<string>(
    portalUser?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );
  const [selectedSlotUtc, setSelectedSlotUtc] = useState<string>('');
  const [reschedulingBooking, setReschedulingBooking] = useState<PortalBooking | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ratingBookingId, setRatingBookingId] = useState<string | null>(null);
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingComment, setRatingComment] = useState('');

  useEffect(() => {
    if (!portalUser) return;
    setTimezone(portalUser.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

    void fetchActiveTeachers().then((activeList) => {
      setTeachers(activeList);
      setSelectedTeacherId((prev) => {
        if (prev && activeList.some((t) => t.uid === prev)) return prev;
        if (portalUser.teacherId && activeList.some((t) => t.uid === portalUser.teacherId)) {
          return portalUser.teacherId;
        }
        return activeList[0]?.uid || portalUser.teacherId || '';
      });
    });

    if (portalUser.teacherId) {
      getDoc(doc(db, 'portal_teachers', portalUser.teacherId)).then((snap) => {
        if (snap.exists()) {
          setAssignedTeacher(snap.data() as TeacherProfile);
        }
      });
    }

    const unsubMine = onSnapshot(
      query(collection(db, 'portal_bookings'), where('studentId', '==', portalUser.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<PortalBooking, 'id'>) }))
          .sort((a, b) => Date.parse(b.startUtc) - Date.parse(a.startUtc));
        setMyBookings(list);
      }
    );

    return () => unsubMine();
  }, [portalUser]);

  const teacher = useMemo(() => {
    const fromList = teachers.find((t) => t.uid === selectedTeacherId);
    if (fromList) return fromList;
    if (assignedTeacher && (!selectedTeacherId || assignedTeacher.uid === selectedTeacherId)) {
      return assignedTeacher;
    }
    return teachers[0] || assignedTeacher || null;
  }, [teachers, selectedTeacherId, assignedTeacher]);

  const activeBusyTeacherId = reschedulingBooking?.teacherId || teacher?.uid || '';

  useEffect(() => {
    if (!activeBusyTeacherId) {
      setBusySlots([]);
      return;
    }
    const unsubBusy = onSnapshot(
      collection(db, 'portal_teachers', activeBusyTeacherId, 'busySlots'),
      (snap) => {
        setBusySlots(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BusySlot, 'id'>) }))
        );
      }
    );
    return () => unsubBusy();
  }, [activeBusyTeacherId]);

  const effectiveConflicts = useMemo(() => {
    const filteredBusy = busySlots.filter((s) => s.id !== reschedulingBooking?.id);
    const mine = myBookings
      .filter((b) => b.teacherId === activeBusyTeacherId && b.id !== reschedulingBooking?.id)
      .map((b) => ({ startUtc: b.startUtc, endUtc: b.endUtc, status: b.status }));
    return [...filteredBusy, ...mine];
  }, [busySlots, myBookings, activeBusyTeacherId, reschedulingBooking]);

  const bookingTeacher = useMemo(() => {
    if (reschedulingBooking) {
      return (
        teachers.find((t) => t.uid === reschedulingBooking.teacherId) ||
        (assignedTeacher?.uid === reschedulingBooking.teacherId ? assignedTeacher : teacher)
      );
    }
    return teacher;
  }, [reschedulingBooking, teachers, assignedTeacher, teacher]);

  // Generate next 10 days of open teacher slots in UTC, displayed in user's local timezone
  const openSlots = useMemo(() => {
    if (!bookingTeacher) return [];
    const slots: Array<{ startUtc: string; endUtc: string; localLabel: string }> = [];
    const now = new Date();
    for (let dayOffset = 1; dayOffset <= 10; dayOffset++) {
      const d = new Date(now.getTime() + dayOffset * 86400_000);
      const yyyyMmDd = d.toISOString().slice(0, 10);
      if (bookingTeacher.daysOff.includes(yyyyMmDd)) continue;
      const dow = d.getUTCDay();
      const matching = bookingTeacher.availability.filter((s) => s.dayOfWeek === dow);
      for (const s of matching) {
        const start = new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), s.startHourUtc, s.startMinuteUtc, 0)
        );
        const end = new Date(start.getTime() + bookingTeacher.lessonLengthMin * 60_000);
        const startUtc = start.toISOString();
        const endUtc = end.toISOString();
        if (!hasBookingConflict(startUtc, endUtc, effectiveConflicts)) {
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
  }, [bookingTeacher, effectiveConflicts, timezone]);

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
    if (!portalUser || !selectedSlotUtc || !bookingTeacher) return;
    const chosen = openSlots.find((s) => s.startUtc === selectedSlotUtc);
    if (!chosen) return;
    if (hasBookingConflict(chosen.startUtc, chosen.endUtc, effectiveConflicts)) {
      setMessage('That slot was just booked. Please pick another time.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      if (reschedulingBooking) {
        await updateDoc(doc(db, 'portal_bookings', reschedulingBooking.id), {
          startUtc: chosen.startUtc,
          endUtc: chosen.endUtc,
          status: 'rescheduled',
          updatedAt: serverTimestamp(),
        });

        await setDoc(
          doc(db, 'portal_teachers', reschedulingBooking.teacherId, 'busySlots', reschedulingBooking.id),
          {
            startUtc: chosen.startUtc,
            endUtc: chosen.endUtc,
            status: 'rescheduled',
            updatedAt: serverTimestamp(),
          }
        );

        await pushNotification({
          userId: portalUser.uid,
          title: 'Lesson rescheduled',
          body: `Moved to ${chosen.localLabel} with ${reschedulingBooking.teacherName}.`,
          type: 'booking',
          link: '/bookings',
        });

        setReschedulingBooking(null);
        setSelectedSlotUtc('');
        setMessage('Lesson rescheduled!');
        return;
      }

      const bookingId = `bkg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await setDoc(doc(db, 'portal_bookings', bookingId), {
        studentId: portalUser.uid,
        studentName: portalUser.displayName,
        teacherId: bookingTeacher.uid,
        teacherName: bookingTeacher.displayName,
        startUtc: chosen.startUtc,
        endUtc: chosen.endUtc,
        status: 'confirmed',
        ...(note.trim() ? { note: note.trim() } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'portal_teachers', bookingTeacher.uid, 'busySlots', bookingId), {
        startUtc: chosen.startUtc,
        endUtc: chosen.endUtc,
        status: 'confirmed',
        updatedAt: serverTimestamp(),
      });

      await pushNotification({
        userId: portalUser.uid,
        title: 'Lesson booked',
        body: `Confirmed with ${bookingTeacher.displayName} for ${chosen.localLabel}.`,
        type: 'booking',
        link: '/bookings',
      });

      await dispatchPortalEmail({
        userId: portalUser.uid,
        to: portalUser.email,
        recipientName: portalUser.displayName,
        type: 'booking_confirmed',
        subject: `Lesson confirmed with ${bookingTeacher.displayName}`,
        headline: 'Your Kinyarwanda lesson is booked',
        bodyText: `Date & time (${timezone}): ${chosen.localLabel}\nTeacher: ${bookingTeacher.displayName}\n${note ? `Your note: ${note}` : ''}`,
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
    await setDoc(doc(db, 'portal_teachers', b.teacherId, 'busySlots', b.id), {
      startUtc: b.startUtc,
      endUtc: b.endUtc,
      status: nextStatus,
      updatedAt: serverTimestamp(),
    });
    if (!freeCancel) {
      await updateDoc(doc(db, 'users', portalUser.uid), {
        lateCancelCount: (portalUser.lateCancelCount || 0) + 1,
        updatedAt: serverTimestamp(),
      });
    }
    if (reschedulingBooking?.id === b.id) {
      setReschedulingBooking(null);
      setSelectedSlotUtc('');
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
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-12 space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#084F4E]">
            Book a lesson
          </h1>
          <p className="text-sm text-[#3F4F4F] mt-1">
            {bookingTeacher
              ? `Open slots with ${bookingTeacher.displayName} shown in your local time zone.`
              : 'Pick an active teacher and book in your local time zone.'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-3 w-full md:w-auto">
          {teachers.length > 1 && !reschedulingBooking && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
              <label htmlFor="teacher-select" className="text-xs font-medium text-[#3F4F4F]">
                Teacher
              </label>
              <select
                id="teacher-select"
                value={teacher?.uid || ''}
                onChange={(e) => {
                  setSelectedTeacherId(e.target.value);
                  setSelectedSlotUtc('');
                }}
                className="w-full sm:w-auto min-h-[42px] px-3 py-2 rounded-xl border border-[#084F4E]/20 bg-white text-sm text-[#084F4E]"
              >
                {teachers.map((t) => (
                  <option key={t.uid} value={t.uid}>
                    {t.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
            <label htmlFor="tz-select" className="text-xs font-medium text-[#3F4F4F]">
              Time zone
            </label>
            <select
              id="tz-select"
              value={timezone}
              onChange={(e) => void handleTimezoneChange(e.target.value)}
              className="w-full sm:w-auto min-h-[42px] px-3 py-2 rounded-xl border border-[#084F4E]/20 bg-white text-sm text-[#084F4E]"
            >
              {Array.from(new Set([timezone, ...COMMON_TIMEZONES])).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {message && (
        <div className="rounded-2xl border border-[#0E7C7B]/25 bg-[#E6F4F4] px-5 py-3.5 text-sm text-[#084F4E]">
          {message}
        </div>
      )}

      {reschedulingBooking && (
        <div className="rounded-2xl border border-[#C9A84C]/50 bg-[#E8C97A]/20 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-sm text-[#084F4E]">
          <span>
            Rescheduling your lesson with <strong>{reschedulingBooking.teacherName}</strong>. Choose a new time below.
          </span>
          <button
            type="button"
            onClick={() => {
              setReschedulingBooking(null);
              setSelectedSlotUtc('');
            }}
            className="text-xs font-semibold underline"
          >
            Cancel reschedule
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-12 gap-6 sm:gap-8 items-start">
        {/* Slot Picker */}
        <section className="lg:col-span-7 rounded-[24px] border border-[#084F4E]/12 bg-white p-5 sm:p-8 space-y-5">
          {!bookingTeacher ? (
            <div className="py-8 text-center space-y-2">
              <h2 className="font-display text-xl font-semibold text-[#084F4E]">
                No teachers available yet
              </h2>
              <p className="text-sm text-[#3F4F4F]">
                Our teaching team is setting up availability. Check back soon or email learn@ijwi.me.
              </p>
            </div>
          ) : (
            <>
              <h2 className="font-display text-xl font-semibold text-[#084F4E]">
                Available times ({bookingTeacher.lessonLengthMin} min)
              </h2>

              {openSlots.length === 0 ? (
                <p className="text-sm text-[#3F4F4F] py-6">
                  No open slots in the next 10 days. Check back soon or contact learn@ijwi.me.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
                  {openSlots.map((slot) => {
                    const active = selectedSlotUtc === slot.startUtc;
                    return (
                      <button
                        key={slot.startUtc}
                        type="button"
                        onClick={() => setSelectedSlotUtc(slot.startUtc)}
                        className={`min-h-[44px] flex items-center gap-2.5 px-4 py-3 rounded-xl border text-left text-sm transition-colors ${
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

              {!reschedulingBooking && (
                <div>
                  <label htmlFor="booking-note" className="block text-sm font-medium text-[#1F2A2A] mb-1.5">
                    Optional note for {bookingTeacher.displayName}
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
              )}

              <button
                type="button"
                disabled={!selectedSlotUtc || saving}
                onClick={() => void handleConfirmBooking()}
                className="w-full sm:w-auto min-h-[46px] px-6 py-3 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] transition-colors disabled:opacity-50"
              >
                {saving
                  ? 'Saving...'
                  : reschedulingBooking
                    ? 'Confirm new time'
                    : 'Confirm lesson booking'}
              </button>
            </>
          )}
        </section>

        {/* My Bookings */}
        <section className="lg:col-span-5 rounded-[24px] border border-[#084F4E]/12 bg-white p-5 sm:p-8 space-y-4">
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
                            <span>.ics</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setReschedulingBooking(b);
                              setSelectedSlotUtc('');
                              setMessage(null);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#0E7C7B]/30 bg-white text-xs font-medium text-[#0E7C7B] hover:bg-[#E6F4F4]"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Reschedule</span>
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
