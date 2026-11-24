import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
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

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1.35 });

          const pageWrapper = document.createElement('div');
          pageWrapper.className = 'relative mb-6 rounded-xl overflow-hidden border border-[#084F4E]/15 bg-white shadow-sm';

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'w-full h-auto block pointer-events-none select-none';

          if (context) {
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
  }, [fileKey, viewerEmail]);

  return (
    <div
      className="select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between mb-4 text-xs text-[#3F4F4F]">
        <span>{title}</span>
        <span>
          {pageCount > 0 ? `${pageCount} pages · View-only canvas` : 'Protected view'}
        </span>
      </div>

      {loading && (
        <div className="h-96 rounded-2xl border border-[#084F4E]/10 bg-[#FAFBFB] flex items-center justify-center text-sm text-[#3F4F4F]">
          Rendering protected pages...
        </div>
      )}
      {error && (
        <div className="p-6 rounded-2xl border border-red-200 bg-red-50 text-sm text-red-800">
          {error}
        </div>
      )}
      <div ref={containerRef} className={loading ? 'hidden' : 'block'} />
    </div>
  );
}
