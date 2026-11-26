import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { FileText, Video, ExternalLink, Search } from 'lucide-react';
import { db, formatPortalError } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { fetchAllActivePlans } from '../lib/seed';
import { FeedbackBanner, type FeedbackState } from '../components/FeedbackBanner';
import { ProtectedPdfViewer } from '../components/ProtectedPdfViewer';
import { ProtectedVideoPlayer } from '../components/ProtectedVideoPlayer';
import type { PortalResource, PortalTeam } from '../types/portal';

export function ResourcesPage() {
  const { portalUser } = useAuth();
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const { data: plans = [] } = useQuery({
    queryKey: ['all_active_plans'],
    queryFn: fetchAllActivePlans,
  });

  const viewerRef = useRef<HTMLDivElement>(null);
  const [publicResources, setPublicResources] = useState<PortalResource[]>([]);
  const [planResources, setPlanResources] = useState<PortalResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [team, setTeam] = useState<PortalTeam | null>(null);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [selected, setSelected] = useState<PortalResource | null>(null);

  const portalUid = portalUser?.uid || '';
  const portalRole = portalUser?.role || 'student';
  const portalTeamId = portalUser?.teamId || '';
  const userAssignedKey = (portalUser?.assignedPlanIds || []).join('|');

  useEffect(() => {
    if (!portalUid) return;
    setLoading(true);

    if (portalTeamId) {
      getDoc(doc(db, 'portal_teams', portalTeamId))
        .then((snap) => {
          if (snap.exists()) setTeam({ id: snap.id, ...(snap.data() as Omit<PortalTeam, 'id'>) });
        })
        .catch(() => {});
    } else {
      setTeam(null);
    }

    const onErr = (err: unknown) => {
      const msg = formatPortalError(err, 'Unable to load study resources.');
      setFeedback({ type: 'error', text: msg });
      toastRef.current.error(msg);
      setLoading(false);
    };

    if (portalRole === 'teacher' || portalRole === 'admin') {
      const unsubAll = onSnapshot(
        collection(db, 'portal_resources'),
        (snap) => {
          setPublicResources(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalResource, 'id'>) }))
          );
          setLoading(false);
        },
        onErr
      );
      return () => unsubAll();
    }

    const unsubPublic = onSnapshot(
      query(collection(db, 'portal_resources'), where('publicToPaid', '==', true)),
      (snap) => {
        setPublicResources(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalResource, 'id'>) }))
        );
        setLoading(false);
      },
      onErr
    );
    return () => unsubPublic();
  }, [portalUid, portalRole, portalTeamId]);

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
    if (
      !portalUid ||
      portalRole === 'teacher' ||
      portalRole === 'admin' ||
      !appliedPlanIdsKey
    ) {
      setPlanResources([]);
      return;
    }
    const targetIds = appliedPlanIdsKey.split('|').slice(0, 10);
    const unsubPlan = onSnapshot(
      query(
        collection(db, 'portal_resources'),
        where('planIds', 'array-contains-any', targetIds)
      ),
      (snap) => {
        setPlanResources(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalResource, 'id'>) }))
        );
      },
      (err) => {
        const msg = formatPortalError(err, 'Unable to load plan resources.');
        setFeedback({ type: 'error', text: msg });
        toastRef.current.error(msg);
      }
    );
    return () => unsubPlan();
  }, [portalUid, portalRole, appliedPlanIdsKey]);

  const resources = useMemo(() => {
    const map = new Map<string, PortalResource>();
    [...planResources, ...publicResources].forEach((r) => map.set(r.id, r));
    return Array.from(map.values());
  }, [planResources, publicResources]);

  const planNameMap = useMemo(() => {
    const m = new Map<string, string>();
    plans.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [plans]);

  const levels = useMemo(
    () => ['all', ...Array.from(new Set(resources.map((r) => r.level)))],
    [resources]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resources.filter((r) => {
      if (levelFilter !== 'all' && r.level !== levelFilter) return false;
      if (planFilter === 'my-plans') {
        if (!r.planIds?.some((pid) => appliedPlanIds.includes(pid))) return false;
      } else if (planFilter !== 'all') {
        if (!r.planIds?.includes(planFilter)) return false;
      }
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.topic.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
      );
    });
  }, [resources, search, levelFilter, planFilter, appliedPlanIds]);

  async function handleOpenResource(res: PortalResource) {
    setSelected(res);
    if (window.innerWidth < 1024) {
      setTimeout(() => {
        viewerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    }
    if (!portalUser) return;
    try {
      const viewId = `view-${Date.now()}-${portalUser.uid.slice(0, 6)}`;
      await setDoc(doc(db, 'portal_resources', res.id, 'views', viewId), {
        viewerId: portalUser.uid,
        viewerName: portalUser.displayName,
        viewedAt: serverTimestamp(),
      });
    } catch {
      // non-blocking view log
    }
  }

  if (!portalUser) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
      <div>
        <h1 className="font-display text-3xl font-semibold text-[#084F4E]">
          Study resources
        </h1>
        <p className="text-sm text-[#3F4F4F] mt-1">
          Guides, videos, and links shared by your teachers for active Ijwi learners and plans.
        </p>
      </div>

      <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} />

      {/* Search, Plan Filter & Level Filter */}
      <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#3F4F4F] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder="Search by title or topic..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#084F4E]/20 text-sm bg-white"
            />
          </div>

          {plans.length > 0 && (
            <select
              aria-label="Filter by learning plan"
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
              className="px-3.5 py-2.5 rounded-xl border border-[#084F4E]/20 text-sm bg-white text-[#084F4E]"
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
        </div>

        <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-[#E6F4F4]/60">
          {levels.map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setLevelFilter(lvl)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                levelFilter === lvl
                  ? 'bg-[#084F4E] text-white'
                  : 'text-[#3F4F4F] hover:text-[#084F4E]'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-8 items-start">
        {/* Resource list */}
        <div className="lg:col-span-5 space-y-3">
          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-24 rounded-2xl bg-white border border-[#084F4E]/10" />
              <div className="h-24 rounded-2xl bg-white border border-[#084F4E]/10" />
              <div className="h-24 rounded-2xl bg-white border border-[#084F4E]/10" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-[#084F4E]/12 bg-[#FAFBFB] p-8 text-center text-sm text-[#3F4F4F]">
              No resources match your filters yet.
            </div>
          ) : (
            filtered.map((res) => {
              const active = selected?.id === res.id;
              const Icon =
                res.type === 'pdf' ? FileText : res.type === 'video' ? Video : ExternalLink;
              const linkedNames = (res.planIds || [])
                .map((pid) => planNameMap.get(pid))
                .filter((name): name is string => Boolean(name));

              return (
                <button
                  key={res.id}
                  type="button"
                  onClick={() => void handleOpenResource(res)}
                  className={`w-full text-left p-5 rounded-2xl border transition-colors ${
                    active
                      ? 'border-[#084F4E] bg-[#E6F4F4]/50'
                      : 'border-[#084F4E]/12 bg-white hover:border-[#0E7C7B]/40'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className="w-5 h-5 text-[#0E7C7B] shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-xs text-[#3F4F4F]">
                        {res.level} · {res.topic} · {res.type.toUpperCase()}
                      </p>
                      <h2 className="font-display text-lg font-semibold text-[#084F4E]">
                        {res.title}
                      </h2>
                      {linkedNames.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {linkedNames.map((name) => (
                            <span
                              key={name}
                              className="inline-block px-2 py-0.5 rounded-md bg-[#E6F4F4] text-[11px] font-medium text-[#084F4E]"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                      {res.description && (
                        <p className="text-xs text-[#3F4F4F] mt-1 line-clamp-2">
                          {res.description}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Viewer pane */}
        <div
          ref={viewerRef}
          className="lg:col-span-7 rounded-[24px] border border-[#084F4E]/12 bg-[#FAFBFB] p-5 sm:p-8 min-h-[360px] sm:min-h-[420px] scroll-mt-20"
        >
          {!selected ? (
            <div className="h-80 flex flex-col items-center justify-center text-center px-4">
              <FileText className="w-8 h-8 text-[#0E7C7B] mb-3" />
              <p className="font-display text-xl text-[#084F4E] mb-1">
                Select a study guide or video
              </p>
              <p className="text-sm text-[#3F4F4F] max-w-sm">
                PDFs and videos stream securely inside this window for your personal practice.
              </p>
            </div>
          ) : selected.type === 'pdf' && selected.fileKey ? (
            <ProtectedPdfViewer
              fileKey={selected.fileKey}
              title={selected.title}
              viewerEmail={portalUser.email}
            />
          ) : selected.type === 'video' && selected.fileKey ? (
            <div className="space-y-3">
              <h2 className="font-display text-xl font-semibold text-[#084F4E]">
                {selected.title}
              </h2>
              <ProtectedVideoPlayer
                fileKey={selected.fileKey}
                title={selected.title}
                viewerEmail={portalUser.email}
              />
            </div>
          ) : selected.url ? (
            <div className="space-y-4">
              <h2 className="font-display text-xl font-semibold text-[#084F4E]">
                {selected.title}
              </h2>
              <p className="text-sm text-[#3F4F4F]">{selected.description}</p>
              <a
                href={selected.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B]"
              >
                <span>Open external link</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
