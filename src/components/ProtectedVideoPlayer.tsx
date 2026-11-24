import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Props {
  fileKey: string;
  title: string;
  viewerEmail: string;
}

export function ProtectedVideoPlayer({ fileKey, title, viewerEmail }: Props) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setStreamUrl(null);
    setError(null);
    apiFetch<{ streamUrl: string }>('/api/resources/stream-ticket', {
      method: 'POST',
      body: JSON.stringify({ fileKey }),
    })
      .then((res) => {
        if (active) setStreamUrl(res.streamUrl);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to stream video.');
      });
    return () => {
      active = false;
    };
  }, [fileKey]);

  if (error) {
    return (
      <div className="p-6 rounded-2xl border border-red-200 bg-red-50 text-sm text-red-800">
        {error}
      </div>
    );
  }

  if (!streamUrl) {
    return (
      <div className="aspect-video rounded-2xl border border-[#084F4E]/10 bg-[#FAFBFB] flex items-center justify-center text-sm text-[#3F4F4F]">
        Preparing private video stream...
      </div>
    );
  }

  return (
    <div
      className="relative rounded-2xl overflow-hidden border border-[#084F4E]/15 bg-black select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        src={streamUrl}
        controls
        controlsList="nodownload noplaybackrate"
        disablePictureInPicture
        playsInline
        title={title}
        onError={() =>
          setError('This video stream could not be loaded. Please refresh or try again later.')
        }
        className="w-full aspect-video"
      />
      <div className="pointer-events-none select-none absolute top-3 right-3 text-xs text-white/35 font-medium">
        {viewerEmail}
      </div>
    </div>
  );
}
