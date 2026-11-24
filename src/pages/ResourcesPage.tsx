import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { FileText, Video, ExternalLink, Search } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { ProtectedPdfViewer } from '../components/ProtectedPdfViewer';
import { ProtectedVideoPlayer } from '../components/ProtectedVideoPlayer';
import type { PortalResource } from '../types/portal';

export function ResourcesPage() {
  const { portalUser } = useAuth();
  const [resources, setResources] = useState<PortalResource[]>([]);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [selected, setSelected] = useState<PortalResource | null>(null);

  useEffect(() => {
    if (!portalUser) return;
    const unsub = onSnapshot(
      query(collection(db, 'portal_resources'), where('publicToPaid', '==', true)),
      (snap) => {
        setResources(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PortalResource, 'id'>) }))
        );
      }
    );
    return () => unsub();
  }, [portalUser]);

  const levels = useMemo(
    () => ['all', ...Array.from(new Set(resources.map((r) => r.level)))],
    [resources]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return resources.filter((r) => {
      if (levelFilter !== 'all' && r.level !== levelFilter) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.topic.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q)
      );
    });
  }, [resources, search, levelFilter]);

  async function handleOpenResource(res: PortalResource) {
    setSelected(res);
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
          Guides, videos, and links shared by your teachers for active Ijwi learners.
        </p>
      </div>

      {/* Search & Level Filter */}
      <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center justify-between">
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
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-[#084F4E]/12 bg-[#FAFBFB] p-8 text-center text-sm text-[#3F4F4F]">
              No resources match your search yet.
            </div>
          ) : (
            filtered.map((res) => {
              const active = selected?.id === res.id;
              const Icon =
                res.type === 'pdf' ? FileText : res.type === 'video' ? Video : ExternalLink;
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
                    <div>
                      <p className="text-xs text-[#3F4F4F] mb-1">
                        {res.level} · {res.topic} · {res.type.toUpperCase()}
                      </p>
                      <h2 className="font-display text-lg font-semibold text-[#084F4E]">
                        {res.title}
                      </h2>
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
        <div className="lg:col-span-7 rounded-[24px] border border-[#084F4E]/12 bg-[#FAFBFB] p-6 sm:p-8 min-h-[420px]">
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
