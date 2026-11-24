import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { Download, Trash2 } from 'lucide-react';
import { db, formatPortalError } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { downloadInvoicePdf } from '../lib/pdfInvoice';
import { FeedbackBanner, type FeedbackState } from '../components/FeedbackBanner';
import { formatMoney } from '../shared/pricing';
import type { PortalInvoice, PortalTeam } from '../types/portal';

export function ProfilePage() {
  const { portalUser, logout } = useAuth();
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [team, setTeam] = useState<PortalTeam | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [organisation, setOrganisation] = useState('');
  const [emailPrefs, setEmailPrefs] = useState({
    reminders: true,
    weeklyDigest: true,
    community: true,
    announcements: true,
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!portalUser) return;
    setDisplayName(portalUser.displayName);
    setTimezone(portalUser.timezone);
    setOrganisation(portalUser.organisation || '');
    if (portalUser.emailPrefs) setEmailPrefs(portalUser.emailPrefs);

    if (portalUser.teamId) {
      getDoc(doc(db, 'portal_teams', portalUser.teamId))
        .then((snap) => {
          if (snap.exists()) setTeam({ id: snap.id, ...(snap.data() as Omit<PortalTeam, 'id'>) });
        })
        .catch(() => {});
    }

    const unsub = onSnapshot(
      query(collection(db, 'portal_invoices'), where('payerId', '==', portalUser.uid)),
      (snap) => {
        setInvoices(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<PortalInvoice, 'id'>) }))
            .sort((a, b) => Date.parse(b.dueAt) - Date.parse(a.dueAt))
        );
      },
      (err) => {
        setFeedback({
          type: 'error',
          text: formatPortalError(err, 'Unable to load your billing history.'),
        });
      }
    );
    return () => unsub();
  }, [portalUser]);

  if (!portalUser) return null;

  const isTeamMemberNotOwner = Boolean(
    portalUser.teamId && team && team.ownerId !== portalUser.uid
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!portalUser) return;
    setSaving(true);
    setFeedback(null);
    try {
      await updateDoc(doc(db, 'users', portalUser.uid), {
        displayName: displayName.trim() || portalUser.displayName,
        timezone,
        organisation: organisation.trim(),
        emailPrefs,
        updatedAt: serverTimestamp(),
      });
      setFeedback({ type: 'success', text: 'Profile preferences saved.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: formatPortalError(err, 'Unable to save profile preferences.'),
      });
    } finally {
      setSaving(false);
    }
  }

  function handleExportData() {
    if (!portalUser) return;
    const payload = {
      profile: portalUser,
      invoices,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ijwi-data-${portalUser.uid.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDeleteAccount() {
    if (!portalUser) return;
    setDeleting(true);
    setFeedback(null);
    try {
      await deleteDoc(doc(db, 'users', portalUser.uid));
      await logout();
      navigate('/');
    } catch (err) {
      setFeedback({
        type: 'error',
        text: formatPortalError(err, 'Unable to delete account.'),
      });
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-12 space-y-6 sm:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {portalUser.photoUrl && (
          <img
            src={portalUser.photoUrl}
            alt={portalUser.displayName}
            referrerPolicy="no-referrer"
            className="w-16 h-16 rounded-2xl object-cover border border-[#084F4E]/15 shrink-0"
          />
        )}
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#084F4E]">
            Profile &amp; Billing
          </h1>
          <p className="text-sm text-[#3F4F4F] break-all">
            {portalUser.email} · Role: <span className="capitalize">{portalUser.role}</span>
          </p>
        </div>
      </div>

      <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />

      {/* Profile Settings */}
      <form
        onSubmit={(e) => void handleSave(e)}
        className="rounded-[24px] border border-[#084F4E]/12 bg-white p-5 sm:p-8 space-y-5"
      >
        <h2 className="font-display text-xl font-semibold text-[#084F4E]">
          Personal details &amp; email preferences
        </h2>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="prof-name" className="block text-xs font-medium text-[#1F2A2A] mb-1">
              Full name
            </label>
            <input
              id="prof-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />
          </div>
          <div>
            <label htmlFor="prof-tz" className="block text-xs font-medium text-[#1F2A2A] mb-1">
              Time zone
            </label>
            <input
              id="prof-tz"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="prof-org" className="block text-xs font-medium text-[#1F2A2A] mb-1">
            Organisation (optional)
          </label>
          <input
            id="prof-org"
            value={organisation}
            onChange={(e) => setOrganisation(e.target.value)}
            className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-[#084F4E]/20 text-sm"
          />
        </div>

        <div className="pt-2 border-t border-[#084F4E]/10 space-y-2.5">
          <p className="text-xs font-semibold text-[#084F4E]">Optional emails (receipts always send)</p>
          {(
            [
              ['reminders', 'Lesson & session reminders'],
              ['weeklyDigest', 'Monday weekly progress digest'],
              ['community', 'Group session updates'],
              ['announcements', 'Academy announcements'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 text-sm text-[#3F4F4F] py-0.5">
              <input
                type="checkbox"
                checked={emailPrefs[key]}
                onChange={(e) => setEmailPrefs({ ...emailPrefs, [key]: e.target.checked })}
                className="w-4 h-4 rounded border-[#084F4E]/30 text-[#084F4E]"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B]"
        >
          {saving ? 'Saving...' : 'Save profile'}
        </button>
      </form>

      {/* Billing */}
      <section className="rounded-[24px] border border-[#084F4E]/12 bg-white p-5 sm:p-8 space-y-4">
        <h2 className="font-display text-xl font-semibold text-[#084F4E]">Billing</h2>

        {isTeamMemberNotOwner && team && (
          <div className="rounded-2xl bg-[#E6F4F4]/70 border border-[#0E7C7B]/20 p-4 text-sm text-[#084F4E]">
            <strong>Paid by {team.ownerName}</strong> · Your seat in {team.name} is covered by your
            team owner.
          </div>
        )}

        {invoices.length === 0 ? (
          <p className="text-sm text-[#3F4F4F]">
            No invoices on your account.{' '}
            <Link to="/" className="text-[#084F4E] font-semibold underline">
              Enrol in a plan
            </Link>
          </p>
        ) : (
          <div className="divide-y divide-[#084F4E]/10">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm"
              >
                <div>
                  <p className="font-semibold text-[#084F4E] tabular-nums">
                    {inv.number} · {formatMoney(inv.totalCents, inv.currency)}
                  </p>
                  <p className="text-xs text-[#3F4F4F]">
                    {inv.planName} ({inv.seats} {inv.seats === 1 ? 'seat' : 'seats'}) · Status:{' '}
                    <strong className="capitalize">{inv.status}</strong>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => downloadInvoicePdf(inv)}
                    className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#084F4E]/20 text-xs font-medium text-[#084F4E] hover:bg-[#E6F4F4]"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>PDF</span>
                  </button>
                  <Link
                    to={`/invoices/${inv.id}`}
                    className="min-h-[38px] inline-flex items-center px-3.5 py-1.5 rounded-lg bg-[#084F4E] text-white text-xs font-semibold hover:bg-[#0E7C7B]"
                  >
                    {inv.status === 'unpaid' ? 'Pay now' : 'View'}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Privacy: Export & Delete */}
      <section className="rounded-[24px] border border-[#084F4E]/12 bg-[#FAFBFB] p-5 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#084F4E]">
            Your data &amp; account
          </h2>
          <p className="text-xs text-[#3F4F4F]">
            Download a JSON copy of your profile and invoices, or delete your portal record.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={handleExportData}
            className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-xl border border-[#084F4E]/20 bg-white text-xs font-medium text-[#084F4E]"
          >
            Export my data
          </button>
          {!confirmDelete ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="w-full sm:w-auto min-h-[40px] inline-flex items-center justify-center gap-1 px-4 py-2 rounded-xl border border-red-200 bg-white text-xs font-medium text-red-700"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete account</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleDeleteAccount()}
              className="w-full sm:w-auto min-h-[40px] px-4 py-2 rounded-xl bg-red-700 text-white text-xs font-semibold disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Confirm permanent delete'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
