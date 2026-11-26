import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { Users, CheckCircle2, AlertCircle } from 'lucide-react';
import { db, formatPortalError } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  dispatchPortalEmail,
  hashInviteToken,
  pickTeacherForLearner,
  pushNotification,
} from '../lib/portalActions';
import type { PortalInvite, PortalTeam } from '../types/portal';

export function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const { portalUser, signInWithGoogle } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const redirectTimerRef = useRef<number | null>(null);

  const [invite, setInvite] = useState<PortalInvite | null>(null);
  const [team, setTeam] = useState<PortalTeam | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinedSuccess, setJoinedSuccess] = useState(false);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    async function load() {
      if (!token) {
        setError('Missing invite token.');
        setLoading(false);
        return;
      }
      try {
        const tokenHash = await hashInviteToken(token);
        const snap = await getDoc(doc(db, 'portal_invites', tokenHash));
        if (!snap.exists()) {
          setError('This invite link is invalid or does not exist.');
          setLoading(false);
          return;
        }
        const inv = { id: snap.id, ...(snap.data() as Omit<PortalInvite, 'id'>) };
        setInvite(inv);

        if (inv.revoked) {
          setError('This invite has been revoked by the team owner.');
        } else if (inv.acceptedBy) {
          setError('This invite link has already been used.');
        } else if (Date.now() > Date.parse(inv.expiresAt)) {
          setError('This invite link has expired.');
        }
      } catch {
        setError('Unable to load invite details.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [token]);

  async function handleAccept() {
    if (!invite) return;
    setJoining(true);
    setError(null);
    try {
      let activeUser = portalUser;
      if (!activeUser) {
        activeUser = await signInWithGoogle();
      }
      if (!activeUser) {
        setJoining(false);
        return;
      }

      const teamRef = doc(db, 'portal_teams', invite.teamId);
      const teamSnap = await getDoc(teamRef);
      if (!teamSnap.exists()) {
        const msg = 'The invited team no longer exists.';
        setError(msg);
        toast.error(msg);
        setJoining(false);
        return;
      }
      const teamData = { id: teamSnap.id, ...(teamSnap.data() as Omit<PortalTeam, 'id'>) };
      setTeam(teamData);

      if (teamData.seatsUsed >= teamData.seatsTotal) {
        const msg = 'All seats in this team are currently filled. Ask the owner to add more seats.';
        setError(msg);
        toast.error(msg);
        setJoining(false);
        return;
      }

      const teacher = await pickTeacherForLearner();

      // Add member record
      await setDoc(doc(db, 'portal_teams', invite.teamId, 'members', activeUser.uid), {
        uid: activeUser.uid,
        ownerId: invite.ownerId,
        displayName: activeUser.displayName,
        email: activeUser.email,
        status: 'joined',
        joinedAt: serverTimestamp(),
      });

      // Mark invite single-use dead
      await updateDoc(doc(db, 'portal_invites', invite.id), {
        acceptedBy: activeUser.uid,
        acceptedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });

      // Update team seat count
      await updateDoc(teamRef, {
        seatsUsed: teamData.seatsUsed + 1,
        updatedAt: serverTimestamp(),
      });

      // Activate learner if owner's invoice is paid and inherit team's applied plans
      const teamPlanIds =
        teamData.assignedPlanIds && teamData.assignedPlanIds.length > 0
          ? teamData.assignedPlanIds
          : [teamData.planId];

      await updateDoc(doc(db, 'users', activeUser.uid), {
        teamId: invite.teamId,
        ...(teacher.uid ? { teacherId: teacher.uid } : {}),
        assignedPlanIds: teamPlanIds,
        accessActive: Boolean(teamData.accessActive),
        updatedAt: serverTimestamp(),
      });

      // Notify team owner & send welcome email non-blocking so redirect never stalls
      void Promise.allSettled([
        pushNotification({
          userId: invite.ownerId,
          title: `${activeUser.displayName} joined your team`,
          body: `${activeUser.displayName} claimed a seat in ${invite.teamName}.`,
          type: 'team',
          link: '/team',
        }),
        dispatchPortalEmail({
          userId: activeUser.uid,
          to: activeUser.email,
          recipientName: activeUser.displayName,
          type: 'invite_accepted',
          subject: `Welcome to ${invite.teamName} on Ijwi`,
          headline: `You joined ${invite.teamName}`,
          bodyText: teamData.accessActive
            ? `Your seat is active and your teacher ${teacher.displayName} is ready.`
            : `You claimed your seat in ${invite.teamName}. Your access will open as soon as ${invite.ownerName} completes invoice payment.`,
          ctaLabel: 'Open Ijwi Portal',
          ctaUrl: '/dashboard',
          essential: true,
        }),
      ]);

      setJoinedSuccess(true);
      toast.success(`Muraho! Welcome to ${teamData.name}.`);
      redirectTimerRef.current = window.setTimeout(() => {
        navigate(teamData.accessActive ? '/dashboard' : '/profile');
      }, 1500);
    } catch (err) {
      const msg = formatPortalError(err, 'Could not accept invite.');
      setError(msg);
      toast.error(msg);
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-8 sm:py-16">
      <div className="rounded-[24px] border border-[#084F4E]/15 bg-white p-6 sm:p-10 shadow-sm text-center">
        <div className="w-12 h-12 rounded-2xl bg-[#E6F4F4] text-[#084F4E] flex items-center justify-center mx-auto mb-5">
          <Users className="w-6 h-6" />
        </div>

        {loading ? (
          <p className="text-sm text-[#3F4F4F]">Checking invite link...</p>
        ) : joinedSuccess ? (
          <div className="space-y-3">
            <CheckCircle2 className="w-8 h-8 text-[#0E7C7B] mx-auto" />
            <h1 className="font-display text-2xl font-semibold text-[#084F4E]">
              Muraho! You are in
            </h1>
            <p className="text-sm text-[#3F4F4F]">
              {team?.accessActive
                ? 'Redirecting you to your Kinyarwanda dashboard...'
                : 'Your seat is reserved while the team owner completes payment.'}
            </p>
          </div>
        ) : error ? (
          <div className="space-y-4">
            <AlertCircle className="w-7 h-7 text-amber-700 mx-auto" />
            <h1 className="font-display text-2xl font-semibold text-[#084F4E]">
              Invite cannot be used
            </h1>
            <p className="text-sm text-[#3F4F4F]">{error}</p>
          </div>
        ) : invite ? (
          <div className="space-y-5">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#084F4E]">
              Join {invite.teamName}
            </h1>
            <p className="text-sm text-[#3F4F4F] leading-relaxed">
              <strong className="text-[#1F2A2A]">{invite.ownerName}</strong> invited you to learn
              Kinyarwanda together on Ijwi. Your seat is covered by your team — you will never be
              charged.
            </p>
            <p className="text-xs text-[#3F4F4F]">
              Expires {new Date(invite.expiresAt).toLocaleDateString()} · Single-use link
            </p>
            <button
              type="button"
              disabled={joining}
              onClick={() => void handleAccept()}
              className="w-full min-h-[46px] py-3.5 px-6 rounded-2xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] transition-colors disabled:opacity-60"
            >
              {joining
                ? 'Joining team...'
                : portalUser
                  ? `Accept seat as ${portalUser.displayName}`
                  : 'Continue with Google to join'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
