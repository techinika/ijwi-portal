import { useEffect, useMemo, useState } from 'react';
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
} from 'firebase/firestore';
import { Users, Plus, Calendar } from 'lucide-react';
import { db, formatPortalError } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { fetchAllActivePlans } from '../lib/seed';
import { FeedbackBanner, type FeedbackState } from '../components/FeedbackBanner';
import type { GroupSession, PortalPlan, PortalTeam, StudyGroup } from '../types/portal';

export function SessionsAndGroupPage() {
  const { portalUser } = useAuth();
  const [group, setGroup] = useState<StudyGroup | null>(null);
  const [team, setTeam] = useState<PortalTeam | null>(null);
  const [plans, setPlans] = useState<PortalPlan[]>([]);
  const [sessions, setSessions] = useState<GroupSession[]>([]);
  const [planFilter, setPlanFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('Conversation practice');
  const [startLocal, setStartLocal] = useState('');
  const [capacity, setCapacity] = useState(6);
  const [locationType, setLocationType] = useState<'platform' | 'external'>('platform');
  const [meetingLink, setMeetingLink] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  useEffect(() => {
    if (!portalUser) return;
    void fetchAllActivePlans().then(setPlans);

    if (portalUser.groupId) {
      getDoc(doc(db, 'portal_groups', portalUser.groupId))
        .then((snap) => {
          if (snap.exists()) setGroup({ id: snap.id, ...(snap.data() as Omit<StudyGroup, 'id'>) });
        })
        .catch(() => {});
    }

    if (portalUser.teamId) {
      getDoc(doc(db, 'portal_teams', portalUser.teamId))
        .then((snap) => {
          if (snap.exists()) setTeam({ id: snap.id, ...(snap.data() as Omit<PortalTeam, 'id'>) });
        })
        .catch(() => {});
    } else {
      setTeam(null);
    }

    const unsub = onSnapshot(
      query(collection(db, 'portal_sessions'), where('status', '==', 'upcoming')),
      (snap) => {
        setSessions(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<GroupSession, 'id'>) }))
            .sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc))
        );
      },
      (err) => {
        setFeedback({
          type: 'error',
          text: formatPortalError(err, 'Unable to load group sessions.'),
        });
      }
    );
    return () => unsub();
  }, [portalUser]);

  const appliedPlanIds = useMemo(() => {
    const ids = new Set<string>();
    (portalUser?.assignedPlanIds || []).forEach((id) => ids.add(id));
    (team?.assignedPlanIds || []).forEach((id) => ids.add(id));
    if (team?.planId) ids.add(team.planId);
    return Array.from(ids);
  }, [portalUser, team]);

  const planMap = useMemo(() => {
    const m = new Map<string, PortalPlan>();
    plans.forEach((p) => m.set(p.id, p));
    return m;
  }, [plans]);

  const filteredSessions = useMemo(() => {
    if (planFilter === 'all') return sessions;
    if (planFilter === 'my-plans') {
      return sessions.filter((s) => s.planIds?.some((pid) => appliedPlanIds.includes(pid)));
    }
    return sessions.filter((s) => s.planIds?.includes(planFilter));
  }, [sessions, planFilter, appliedPlanIds]);

  if (!portalUser) return null;

  function toggleSelectedPlan(planId: string) {
    setSelectedPlanIds((prev) =>
      prev.includes(planId) ? prev.filter((id) => id !== planId) : [...prev, planId]
    );
  }

  async function handleCreateSession(e: React.FormEvent) {
    e.preventDefault();
    if (!portalUser || !title.trim() || !startLocal) return;
    setSaving(true);
    setFeedback(null);
    try {
      const id = `ses-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await setDoc(doc(db, 'portal_sessions', id), {
        creatorId: portalUser.uid,
        creatorName: portalUser.displayName,
        title: title.trim(),
        topic: topic.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        startUtc: new Date(startLocal).toISOString(),
        capacity: Math.max(2, Math.min(30, capacity)),
        locationType,
        ...(locationType === 'external' && meetingLink.trim()
          ? { meetingLink: meetingLink.trim() }
          : {}),
        ...(selectedPlanIds.length > 0 ? { planIds: selectedPlanIds } : {}),
        status: 'upcoming',
        attendeeIds: [portalUser.uid],
        attendeeNames: [portalUser.displayName.split(' ')[0]],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setShowCreate(false);
      setTitle('');
      setStartLocal('');
      setDescription('');
      setMeetingLink('');
      setSelectedPlanIds([]);
      setFeedback({ type: 'success', text: 'Group practice session published.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: formatPortalError(err, 'Unable to publish group session.'),
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleJoin(session: GroupSession) {
    if (!portalUser) return;
    setBusySessionId(`join-${session.id}`);
    setFeedback(null);
    try {
      const isJoined = session.attendeeIds.includes(portalUser.uid);
      const firstName = portalUser.displayName.split(' ')[0];
      if (isJoined) {
        const idx = session.attendeeIds.indexOf(portalUser.uid);
        const nextIds = session.attendeeIds.filter((id) => id !== portalUser.uid);
        const nextNames = session.attendeeNames.filter((_, i) => i !== idx);
        await updateDoc(doc(db, 'portal_sessions', session.id), {
          attendeeIds: nextIds,
          attendeeNames: nextNames,
          updatedAt: serverTimestamp(),
        });
        setFeedback({ type: 'success', text: `You left "${session.title}".` });
      } else if (session.attendeeIds.length < session.capacity) {
        await updateDoc(doc(db, 'portal_sessions', session.id), {
          attendeeIds: [...session.attendeeIds, portalUser.uid],
          attendeeNames: [...session.attendeeNames, firstName],
          updatedAt: serverTimestamp(),
        });
        setFeedback({ type: 'success', text: `You joined "${session.title}".` });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: formatPortalError(err, 'Unable to update session attendance.'),
      });
    } finally {
      setBusySessionId(null);
    }
  }

  async function cancelSession(session: GroupSession) {
    setBusySessionId(`cancel-${session.id}`);
    setFeedback(null);
    try {
      await updateDoc(doc(db, 'portal_sessions', session.id), {
        status: 'cancelled',
        updatedAt: serverTimestamp(),
      });
      setFeedback({ type: 'success', text: `Cancelled session "${session.title}".` });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: formatPortalError(err, 'Unable to cancel session.'),
      });
    } finally {
      setBusySessionId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-12 space-y-8 sm:space-y-10">
      {/* Study Group or Team summary */}
      <section className="rounded-[24px] border border-[#084F4E]/15 bg-[#FAFBFB] p-5 sm:p-8">
        <div className="grid md:grid-cols-12 gap-5 sm:gap-6 items-center">
          <div className="md:col-span-8 space-y-2">
            <p className="text-xs font-semibold text-[#0E7C7B]">
              {portalUser.teamId ? 'My Team' : 'My Study Group'}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#084F4E]">
              {group ? group.name : portalUser.teamId ? 'Learning with your team' : 'Your Ijwi Study Circle'}
            </h1>
            {group ? (
              <p className="text-sm text-[#3F4F4F]">
                Teacher: <strong className="text-[#084F4E]">{group.teacherName}</strong> · Members:{' '}
                {group.memberFirstNames.join(', ')} ({group.memberIds.length}/{group.capacity})
              </p>
            ) : portalUser.teamId ? (
              <p className="text-sm text-[#3F4F4F]">
                You are enrolled with a private team.{' '}
                <Link to="/team" className="text-[#084F4E] font-semibold underline">
                  Open Team Workspace
                </Link>
              </p>
            ) : (
              <p className="text-sm text-[#3F4F4F]">
                Practise speaking Kinyarwanda with peers in open study sessions below.
              </p>
            )}
          </div>
          <div className="md:col-span-4">
            <img
              src="/src/assets/images/study_circle_session_1795519555566.jpg"
              alt="Learners practising Kinyarwanda together in a study circle"
              referrerPolicy="no-referrer"
              className="w-full h-36 object-cover rounded-2xl border border-[#084F4E]/10"
            />
          </div>
        </div>
      </section>

      {/* Peer Group Sessions */}
      <section className="space-y-6">
        <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl font-semibold text-[#084F4E]">
              Group practice sessions
            </h2>
            <p className="text-sm text-[#3F4F4F]">
              Host a topic meetup or join a session linked to your learning plan.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
            {plans.length > 0 && (
              <select
                aria-label="Filter sessions by learning plan"
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                className="w-full sm:w-auto min-h-[42px] px-3.5 py-2.5 rounded-xl border border-[#084F4E]/20 text-sm bg-white text-[#084F4E]"
              >
                <option value="all">All learning plans</option>
                {appliedPlanIds.length > 0 && (
                  <option value="my-plans">Only my applied plans</option>
                )}
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B]"
            >
              <Plus className="w-4 h-4" />
              <span>Create session</span>
            </button>
          </div>
        </div>

        {showCreate && (
          <form
            onSubmit={(e) => void handleCreateSession(e)}
            className="rounded-[20px] border border-[#084F4E]/15 bg-white p-5 sm:p-6 space-y-4"
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#1F2A2A] mb-1">
                  Session title
                </label>
                <input
                  required
                  maxLength={160}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Morning Greetings & Market Roleplay"
                  className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#1F2A2A] mb-1">Topic</label>
                <input
                  required
                  maxLength={100}
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#1F2A2A] mb-1">
                  Date &amp; time (your local timezone)
                </label>
                <input
                  required
                  type="datetime-local"
                  value={startLocal}
                  onChange={(e) => setStartLocal(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#1F2A2A] mb-1">
                  Max people
                </label>
                <input
                  type="number"
                  min={2}
                  max={30}
                  value={capacity}
                  onChange={(e) => setCapacity(Number(e.target.value) || 6)}
                  className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm tabular-nums"
                />
              </div>
            </div>

            {plans.length > 0 && (
              <div>
                <p className="text-xs font-medium text-[#1F2A2A] mb-2">
                  Apply to learning plan(s) (optional)
                </p>
                <div className="flex flex-wrap gap-2">
                  {plans.map((p) => {
                    const active = selectedPlanIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleSelectedPlan(p.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          active
                            ? 'bg-[#084F4E] text-white'
                            : 'border border-[#084F4E]/20 text-[#3F4F4F] hover:bg-[#E6F4F4]/60'
                        }`}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4">
              <label className="text-xs font-medium text-[#1F2A2A]">Where:</label>
              <button
                type="button"
                onClick={() => setLocationType('platform')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  locationType === 'platform'
                    ? 'bg-[#084F4E] text-white'
                    : 'border border-[#084F4E]/20 text-[#3F4F4F]'
                }`}
              >
                On the platform
              </button>
              <button
                type="button"
                onClick={() => setLocationType('external')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                  locationType === 'external'
                    ? 'bg-[#084F4E] text-white'
                    : 'border border-[#084F4E]/20 text-[#3F4F4F]'
                }`}
              >
                Custom meeting link
              </button>
            </div>

            {locationType === 'external' && (
              <input
                type="url"
                placeholder="https://meet.google.com/..."
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
              />
            )}

            <textarea
              rows={2}
              maxLength={500}
              placeholder="Short description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="submit"
                disabled={saving}
                className="w-full sm:w-auto min-h-[42px] px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold"
              >
                {saving ? 'Publishing...' : 'Publish session'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="w-full sm:w-auto min-h-[42px] px-4 py-2.5 rounded-xl text-sm text-[#3F4F4F] border border-[#084F4E]/15 sm:border-0"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {filteredSessions.length === 0 ? (
          <div className="rounded-[20px] border border-[#084F4E]/12 bg-white p-8 sm:p-10 text-center text-sm text-[#3F4F4F]">
            No upcoming group sessions match this filter yet.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-5">
            {filteredSessions.map((s) => {
              const joined = s.attendeeIds.includes(portalUser.uid);
              const isCreator = s.creatorId === portalUser.uid;
              const isFull = s.attendeeIds.length >= s.capacity;
              const when = new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: portalUser.timezone,
              }).format(new Date(s.startUtc));
              const linkedPlans = (s.planIds || [])
                .map((pid) => planMap.get(pid))
                .filter((p): p is PortalPlan => Boolean(p));

              return (
                <div
                  key={s.id}
                  className="rounded-[20px] border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-[#0E7C7B]">
                        {s.topic} · Hosted by {s.creatorName}
                      </p>
                      <h3 className="font-display text-xl font-semibold text-[#084F4E] mt-1">
                        {s.title}
                      </h3>
                    </div>
                    <Calendar className="w-4 h-4 text-[#0E7C7B] shrink-0" />
                  </div>

                  {linkedPlans.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {linkedPlans.map((lp) => (
                        <span
                          key={lp.id}
                          title={lp.objective}
                          className="inline-block px-2.5 py-0.5 rounded-md bg-[#E6F4F4] text-[11px] font-medium text-[#084F4E]"
                        >
                          {lp.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <p className="text-sm text-[#1F2A2A] tabular-nums">{when}</p>
                  {s.description && <p className="text-sm text-[#3F4F4F]">{s.description}</p>}

                  <div className="flex items-center gap-2 text-xs text-[#3F4F4F]">
                    <Users className="w-4 h-4 text-[#0E7C7B]" />
                    <span className="tabular-nums">
                      {s.attendeeIds.length}/{s.capacity} going: {s.attendeeNames.join(', ')}
                    </span>
                  </div>

                  {joined && s.meetingLink && (
                    <a
                      href={s.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-xs font-semibold text-[#0E7C7B] underline"
                    >
                      Join meeting link
                    </a>
                  )}

                  <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 pt-2">
                    {!isCreator && (
                      <button
                        type="button"
                        disabled={(!joined && isFull) || busySessionId === `join-${s.id}`}
                        onClick={() => void toggleJoin(s)}
                        className={`w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${
                          joined
                            ? 'border border-[#084F4E]/20 text-[#084F4E] hover:bg-[#FAFBFB]'
                            : 'bg-[#084F4E] text-white hover:bg-[#0E7C7B]'
                        }`}
                      >
                        {busySessionId === `join-${s.id}`
                          ? 'Updating...'
                          : joined
                            ? 'Leave session'
                            : isFull
                              ? 'Session full'
                              : 'Join session'}
                      </button>
                    )}

                    {isCreator && (
                      <button
                        type="button"
                        disabled={busySessionId === `cancel-${s.id}`}
                        onClick={() => void cancelSession(s)}
                        className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-xl border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {busySessionId === `cancel-${s.id}` ? 'Cancelling...' : 'Cancel session'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
