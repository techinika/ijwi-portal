import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { RefreshCw, ZoomIn, ZoomOut } from 'lucide-react';
import { apiFetch } from '../lib/api';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface Props {
  fileKey: string;
  title: string;
  viewerEmail: string;
}

export function ProtectedPdfViewer({ fileKey, title, viewerEmail }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1.25);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function renderPdf() {
      setLoading(true);
      setError(null);
      try {
        const { streamUrl } = await apiFetch<{ streamUrl: string }>(
          '/api/resources/stream-ticket',
          {
            method: 'POST',
            body: JSON.stringify({ fileKey }),
          }
        );

        const loadingTask = pdfjsLib.getDocument({
          url: streamUrl,
          withCredentials: false,
        });
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        setPageCount(pdf.numPages);
        const host = containerRef.current;
        if (!host) return;
        host.innerHTML = '';

        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: zoom });

          const pageWrapper = document.createElement('div');
          pageWrapper.className =
            'relative mb-6 rounded-xl overflow-hidden border border-[#084F4E]/15 bg-white shadow-sm';

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className = 'block pointer-events-none select-none';

          if (context) {
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            await page.render({ canvasContext: context, viewport, canvas }).promise;
          }

          // Faint watermark of viewer email across page
          const watermark = document.createElement('div');
          watermark.className =
            'pointer-events-none select-none absolute inset-0 flex items-center justify-center overflow-hidden';
          watermark.innerHTML = `<span style="transform: rotate(-28deg); font-size: 18px; color: rgba(8,79,78,0.12); font-weight: 600; white-space: nowrap;">${viewerEmail.replace(/</g, '&lt;')} · Ijwi Private Study</span>`;

          pageWrapper.appendChild(canvas);
          pageWrapper.appendChild(watermark);
          host.appendChild(pageWrapper);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to open protected document.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void renderPdf();
    return () => {
      cancelled = true;
    };
  }, [fileKey, viewerEmail, zoom, reloadNonce]);

  return (
    <div
      className="select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 text-xs text-[#3F4F4F]">
        <div>
          <p className="font-medium text-[#084F4E]">{title}</p>
          <span>
            {pageCount > 0 ? `${pageCount} pages · View-only canvas` : 'Protected view'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={loading || zoom <= 0.75}
            onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.25).toFixed(2))))}
            aria-label="Zoom out"
            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-lg border border-[#084F4E]/20 bg-white text-[#084F4E] hover:bg-[#E6F4F4] disabled:opacity-40"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => setZoom(1.25)}
            className="min-h-[34px] px-2.5 rounded-lg border border-[#084F4E]/20 bg-white text-[#084F4E] font-medium tabular-nums hover:bg-[#E6F4F4] disabled:opacity-40"
          >
            {Math.round((zoom / 1.25) * 100)}%
          </button>
          <button
            type="button"
            disabled={loading || zoom >= 2}
            onClick={() => setZoom((z) => Math.min(2, Number((z + 0.25).toFixed(2))))}
            aria-label="Zoom in"
            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-lg border border-[#084F4E]/20 bg-white text-[#084F4E] hover:bg-[#E6F4F4] disabled:opacity-40"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {loading && (
        <div className="h-96 rounded-2xl border border-[#084F4E]/10 bg-[#FAFBFB] flex items-center justify-center text-sm text-[#3F4F4F]">
          Rendering protected pages...
        </div>
      )}
      {error && (
        <div className="p-6 rounded-2xl border border-red-200 bg-red-50 text-sm text-red-800 space-y-3">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-red-300 text-xs font-semibold text-red-800 hover:bg-red-100"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry document</span>
          </button>
        </div>
      )}
      <div ref={containerRef} className={loading ? 'hidden' : 'block'} />
    </div>
  );
}
