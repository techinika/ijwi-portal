import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Copy, Plus, Trash2, UserPlus, Mail, Target } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../lib/api';
import {
  createEnrolmentInvoice,
  dispatchPortalEmail,
  removeTeamMember,
} from '../lib/portalActions';
import { DEFAULT_PLANS, fetchAllActivePlans } from '../lib/seed';
import { calculateEnrolmentQuote, formatMoney, type PriceQuote } from '../shared/pricing';
import type { PortalInvite, PortalInvoice, PortalPlan, PortalTeam, TeamMember } from '../types/portal';

export function TeamPage() {
  const { portalUser } = useAuth();
  const navigate = useNavigate();
  const [team, setTeam] = useState<PortalTeam | null>(null);
  const [allPlans, setAllPlans] = useState<PortalPlan[]>(DEFAULT_PLANS);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<PortalInvite[]>([]);
  const [latestLinks, setLatestLinks] = useState<Record<string, string>>({});
  const [inviteEmail, setInviteEmail] = useState('');
  const [creatingInvite, setCreatingInvite] = useState(false);

  const [addSeatsCount, setAddSeatsCount] = useState(2);
  const [serverTopUpQuote, setServerTopUpQuote] = useState<PriceQuote | null>(null);
  const [alreadyPaidCents, setAlreadyPaidCents] = useState(0);
  const [creatingTopUp, setCreatingTopUp] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchAllActivePlans().then((list) => {
      if (list.length > 0) setAllPlans(list);
    });
  }, []);

  useEffect(() => {
    if (!portalUser?.teamId) return;
    const teamId = portalUser.teamId;

    const unsubTeam = onSnapshot(doc(db, 'portal_teams', teamId), (snap) => {
      if (snap.exists()) {
        setTeam({ id: snap.id, ...(snap.data() as Omit<PortalTeam, 'id'>) });
      }
    });

    const unsubMembers = onSnapshot(
      query(collection(db, 'portal_teams', teamId, 'members'), where('ownerId', '==', portalUser.uid)),
      (snap) => {
        setMembers(snap.docs.map((d) => d.data() as TeamMember));
      }
    );

    const unsubInvites = onSnapshot(
      query(collection(db, 'portal_invites'), where('ownerId', '==', portalUser.uid)),
      (snap) => {
        setInvites(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<PortalInvite, 'id'>) }))
            .filter((i) => i.teamId === teamId)
        );
      }
    );

    // Sum already paid team invoices for accurate top-up pricing
    getDocs(query(collection(db, 'portal_invoices'), where('payerId', '==', portalUser.uid))).then(
      (snap) => {
        const paidTotal = snap.docs
          .map((d) => d.data() as PortalInvoice)
          .filter((inv) => inv.teamId === teamId && inv.status === 'paid')
          .reduce((sum, inv) => sum + inv.totalCents, 0);
        setAlreadyPaidCents(paidTotal);
      }
    );

    return () => {
      unsubTeam();
      unsubMembers();
      unsubInvites();
    };
  }, [portalUser]);

  const isOwner = Boolean(portalUser && team && team.ownerId === portalUser.uid);

  const primaryTeamPlan = useMemo(() => {
    if (!team) return DEFAULT_PLANS[0];
    return allPlans.find((p) => p.id === team.planId) || allPlans[0] || DEFAULT_PLANS[0];
  }, [team, allPlans]);

  const appliedTeamPlans = useMemo(() => {
    if (!team) return [];
    const ids = new Set<string>(team.assignedPlanIds || []);
    if (team.planId) ids.add(team.planId);
    return allPlans.filter((p) => ids.has(p.id));
  }, [team, allPlans]);

  const localTopUpQuote = useMemo<PriceQuote | null>(() => {
    if (!team || !isOwner) return null;
    return calculateEnrolmentQuote({
      unitPriceCents: primaryTeamPlan.unitPriceCents,
      seats: addSeatsCount,
      currency: primaryTeamPlan.currency,
      existingSeats: team.seatsTotal,
      alreadyPaidCents,
    });
  }, [team, isOwner, primaryTeamPlan, addSeatsCount, alreadyPaidCents]);

  useEffect(() => {
    if (!team || !isOwner) return;
    let cancelled = false;
    apiFetch<{ quote: PriceQuote }>('/api/pricing/quote', {
      method: 'POST',
      body: JSON.stringify({
        planId: team.planId,
        unitPriceCents: primaryTeamPlan.unitPriceCents,
        seats: addSeatsCount,
        currency: primaryTeamPlan.currency,
        existingSeats: team.seatsTotal,
        alreadyPaidCents,
      }),
    })
      .then((res) => {
        if (!cancelled) setServerTopUpQuote(res.quote);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [team, isOwner, primaryTeamPlan, addSeatsCount, alreadyPaidCents]);

  const topUpQuote = serverTopUpQuote || localTopUpQuote;

  if (!portalUser) return null;

  if (!portalUser.teamId || !team) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
        <h1 className="font-display text-2xl font-semibold text-[#084F4E] mb-2">
          No active team
        </h1>
        <p className="text-sm text-[#3F4F4F]">
          You are currently enrolled as an individual learner.
        </p>
      </div>
    );
  }

  async function handleCreateInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!portalUser || !team) return;
    setCreatingInvite(true);
    setMessage(null);
    try {
      const { rawToken, tokenHash } = await apiFetch<{ rawToken: string; tokenHash: string }>(
        '/api/invites/generate',
        { method: 'POST' }
      );
      const expiresAt = new Date(Date.now() + 14 * 86400_000).toISOString();
      await setDoc(doc(db, 'portal_invites', tokenHash), {
        teamId: team.id,
        teamName: team.name,
        ownerId: portalUser.uid,
        ownerName: portalUser.displayName,
        planId: team.planId,
        tokenHash,
        ...(inviteEmail.trim() ? { email: inviteEmail.trim() } : {}),
        expiresAt,
        revoked: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const link = `${window.location.origin}/invite/${rawToken}`;
      setLatestLinks((prev) => ({ ...prev, [tokenHash]: link }));

      if (inviteEmail.trim()) {
        await dispatchPortalEmail({
          userId: portalUser.uid,
          to: inviteEmail.trim(),
          recipientName: 'Friend',
          type: 'team_invite',
          subject: `${portalUser.displayName} invited you to learn Kinyarwanda at Ijwi`,
          headline: `Join ${team.name} on Ijwi`,
          bodyText: `${portalUser.displayName} reserved a seat for you to learn Kinyarwanda. Open your single-use link below and sign in with Google.`,
          ctaLabel: 'Accept Your Seat',
          ctaUrl: link,
          essential: true,
        });
      }

      setInviteEmail('');
      setMessage('Single-use invite link created. Copy and share it with your teammate.');
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    await updateDoc(doc(db, 'portal_invites', inviteId), {
      revoked: true,
      updatedAt: serverTimestamp(),
    });
  }

  async function handleAddSeatsInvoice() {
    if (!portalUser || !team || !topUpQuote) return;
    setCreatingTopUp(true);
    try {
      let plan: PortalPlan = primaryTeamPlan;
      const pSnap = await getDoc(doc(db, 'portal_plans', team.planId));
      if (pSnap.exists()) plan = pSnap.data() as PortalPlan;

      const { invoiceId } = await createEnrolmentInvoice({
        user: portalUser,
        plan,
        mode: 'team',
        seats: addSeatsCount,
        ownerIsLearner: false,
        quote: topUpQuote,
        existingTeamId: team.id,
      });
      navigate(`/invoices/${invoiceId}`);
    } finally {
      setCreatingTopUp(false);
    }
  }

  async function handleLeaveTeam() {
    if (!portalUser || !team) return;
    await removeTeamMember({ teamId: team.id, memberUid: portalUser.uid, actor: portalUser });
    navigate('/profile');
  }

  const emptySeats = Math.max(0, team.seatsTotal - team.seatsUsed);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-12 space-y-6 sm:space-y-8">
      <div className="rounded-[24px] border border-[#084F4E]/15 bg-[#FAFBFB] p-5 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-[#0E7C7B] mb-1">Team Workspace</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#084F4E]">{team.name}</h1>
          <p className="text-sm text-[#3F4F4F] mt-1 tabular-nums">
            {team.seatsUsed} of {team.seatsTotal} seats used ·{' '}
            {team.accessActive ? 'Active' : 'Waiting for owner invoice payment'}
          </p>
        </div>

        {!isOwner && (
          <div className="sm:text-right space-y-2 w-full sm:w-auto">
            <p className="text-xs font-medium text-[#0E7C7B]">Paid by {team.ownerName}</p>
            <button
              type="button"
              onClick={() => void handleLeaveTeam()}
              className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-xl border border-red-200 bg-white text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Leave team
            </button>
          </div>
        )}
      </div>

      {/* Applied Team Learning Plans */}
      {appliedTeamPlans.length > 0 && (
        <section className="rounded-[20px] border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-[#0E7C7B]" />
            <h2 className="font-display text-lg font-semibold text-[#084F4E]">
              Team learning {appliedTeamPlans.length === 1 ? 'plan' : 'plans'}
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {appliedTeamPlans.map((tp) => (
              <div
                key={tp.id}
                className="rounded-2xl border border-[#084F4E]/12 bg-[#FAFBFB] p-4 space-y-1.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-sm text-[#084F4E]">{tp.name}</h3>
                  <span className="text-[11px] text-[#3F4F4F] tabular-nums">
                    {tp.learningPath.length} modules
                  </span>
                </div>
                {tp.objective && (
                  <p className="text-xs text-[#3F4F4F] leading-relaxed">
                    <strong className="text-[#084F4E]">Objective:</strong> {tp.objective}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {isOwner && emptySeats > 0 && (
        <div className="rounded-2xl border border-[#C9A84C]/40 bg-[#E8C97A]/15 px-5 py-3.5 text-sm text-[#084F4E]">
          You still have <strong className="tabular-nums">{emptySeats}</strong> open{' '}
          {emptySeats === 1 ? 'seat' : 'seats'} ready to invite.
        </div>
      )}

      {message && (
        <div className="rounded-2xl border border-[#0E7C7B]/25 bg-[#E6F4F4] px-5 py-3.5 text-sm text-[#084F4E]">
          {message}
        </div>
      )}

      {isOwner && (
        <div className="grid lg:grid-cols-12 gap-6 sm:gap-8 items-start">
          {/* Invite & Members */}
          <div className="lg:col-span-7 space-y-6">
            <form
              onSubmit={(e) => void handleCreateInvite(e)}
              className="rounded-[20px] border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-4"
            >
              <h2 className="font-display text-xl font-semibold text-[#084F4E]">
                Invite a teammate
              </h2>
              <p className="text-xs text-[#3F4F4F]">
                Each link is single-use, expires in 14 days, and lets any Google account join a seat.
              </p>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="email"
                  placeholder="Teammate email (optional — sends invite email)"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="flex-1 min-h-[42px] px-4 py-2.5 rounded-xl border border-[#084F4E]/20 text-sm"
                />
                <button
                  type="submit"
                  disabled={creatingInvite || emptySeats === 0}
                  className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] disabled:opacity-50 whitespace-nowrap"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{creatingInvite ? 'Creating...' : 'Create invite link'}</span>
                </button>
              </div>
            </form>

            {/* Active Invites */}
            {invites.length > 0 && (
              <div className="rounded-[20px] border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-3">
                <h3 className="font-display text-lg font-semibold text-[#084F4E]">
                  Invite links
                </h3>
                <div className="divide-y divide-[#084F4E]/10">
                  {invites.map((inv) => {
                    const status = inv.revoked
                      ? 'Revoked'
                      : inv.acceptedBy
                        ? 'Used'
                        : Date.now() > Date.parse(inv.expiresAt)
                          ? 'Expired'
                          : 'Active';
                    const rawLink = latestLinks[inv.id];
                    return (
                      <div key={inv.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                        <div>
                          <p className="font-medium text-[#1F2A2A]">
                            {inv.email || 'Shareable single-use link'} ·{' '}
                            <span className="text-xs text-[#0E7C7B]">{status}</span>
                          </p>
                          <p className="text-xs text-[#3F4F4F]">
                            Expires {new Date(inv.expiresAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {rawLink && status === 'Active' && (
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard.writeText(rawLink);
                                setMessage('Invite link copied to clipboard.');
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E] hover:bg-[#E6F4F4]"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy link</span>
                            </button>
                          )}
                          {status === 'Active' && (
                            <button
                              type="button"
                              onClick={() => void handleRevokeInvite(inv.id)}
                              className="px-3 py-1.5 rounded-lg border border-red-200 text-xs text-red-700 hover:bg-red-50"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Members List */}
            <div className="rounded-[20px] border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-3">
              <h3 className="font-display text-lg font-semibold text-[#084F4E]">
                Team members
              </h3>
              {members.length === 0 ? (
                <p className="text-sm text-[#3F4F4F]">No members have joined yet.</p>
              ) : (
                <div className="divide-y divide-[#084F4E]/10">
                  {members.map((m) => (
                    <div key={m.uid} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-[#1F2A2A] truncate">{m.displayName}</p>
                        <p className="text-xs text-[#3F4F4F] truncate">
                          {m.email} · {m.status}
                        </p>
                      </div>
                      {m.uid !== portalUser.uid && (
                        <button
                          type="button"
                          onClick={() =>
                            void removeTeamMember({
                              teamId: team.id,
                              memberUid: m.uid,
                              actor: portalUser,
                            })
                          }
                          className="self-start sm:self-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-xs text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Add seats top-up */}
          <div className="lg:col-span-5 rounded-[20px] border border-[#084F4E]/12 bg-white p-5 sm:p-6 space-y-4">
            <h2 className="font-display text-xl font-semibold text-[#084F4E]">
              Add seats later
            </h2>
            <p className="text-xs text-[#3F4F4F] leading-relaxed">
              Your new total headcount determines your team discount tier (up to 50%), minus what you already paid.
            </p>
            <div>
              <label htmlFor="add-seats" className="block text-xs font-medium text-[#1F2A2A] mb-1">
                Extra seats to add
              </label>
              <input
                id="add-seats"
                type="number"
                min={1}
                max={200}
                value={addSeatsCount}
                onChange={(e) => setAddSeatsCount(Math.max(1, Number(e.target.value) || 1))}
                className="w-full sm:w-32 min-h-[42px] px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm font-semibold tabular-nums"
              />
            </div>

            {topUpQuote && (
              <div className="rounded-2xl bg-[#FAFBFB] border border-[#084F4E]/10 p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[#3F4F4F]">New total team size</span>
                  <span className="font-semibold tabular-nums">{topUpQuote.newTotalSeats} seats</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#3F4F4F]">Tier discount at {topUpQuote.newTotalSeats}</span>
                  <span className="font-semibold text-[#0E7C7B] tabular-nums">
                    {topUpQuote.teamDiscountPct}% off
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#3F4F4F]">Already paid</span>
                  <span className="tabular-nums">
                    -{formatMoney(topUpQuote.alreadyPaidCents, topUpQuote.currency)}
                  </span>
                </div>
                <div className="pt-2 border-t border-[#084F4E]/10 flex justify-between text-sm font-semibold text-[#084F4E]">
                  <span>Top-up total</span>
                  <span className="tabular-nums">
                    {formatMoney(topUpQuote.totalCents, topUpQuote.currency)}
                  </span>
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={creatingTopUp || !topUpQuote}
              onClick={() => void handleAddSeatsInvoice()}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>{creatingTopUp ? 'Creating invoice...' : 'Create top-up invoice'}</span>
            </button>

            <div className="flex items-center gap-2 text-xs text-[#3F4F4F] pt-1">
              <Mail className="w-3.5 h-3.5 text-[#0E7C7B]" />
              <span>Receipts and invites send from noreply@mail.ijwi.me</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
