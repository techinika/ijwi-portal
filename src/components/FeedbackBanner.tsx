import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export interface FeedbackState {
  type: 'success' | 'error';
  text: string;
}

export function FeedbackBanner({
  feedback,
  onDismiss,
  action,
  className = '',
}: {
  feedback: FeedbackState | null;
  onDismiss?: () => void;
  action?: React.ReactNode;
  className?: string;
}) {
  if (!feedback) return null;
  const isError = feedback.type === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`rounded-2xl border px-4 py-3 text-sm flex items-start justify-between gap-3 ${
        isError
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-[#0E7C7B]/25 bg-[#E6F4F4] text-[#084F4E]'
      } ${className}`}
    >
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        {isError ? (
          <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-[#0E7C7B] shrink-0 mt-0.5" />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="leading-snug">{feedback.text}</p>
          {action && <div>{action}</div>}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="p-1 rounded-lg opacity-70 hover:opacity-100 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
