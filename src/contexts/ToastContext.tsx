import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  to?: string;
  onClick?: () => void;
}

export interface ToastOptions {
  variant?: ToastVariant;
  title?: string;
  durationMs?: number;
  action?: ToastAction;
}

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title?: string;
  message: string;
  durationMs: number;
  action?: ToastAction;
}

interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => string;
  dismissToast: (id: string) => void;
  toast: {
    success: (message: string, options?: Omit<ToastOptions, 'variant'>) => string;
    error: (message: string, options?: Omit<ToastOptions, 'variant'>) => string;
    info: (message: string, options?: Omit<ToastOptions, 'variant'>) => string;
  };
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 4;

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const timerRef = useRef<number | null>(null);
  const remainingRef = useRef<number>(item.durationMs);
  const startedAtRef = useRef<number>(Date.now());

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    if (remainingRef.current <= 0) return;
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => {
      onDismiss(item.id);
    }, remainingRef.current);
  }, [clearTimer, item.id, onDismiss]);

  const pauseTimer = useCallback(() => {
    clearTimer();
    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(800, remainingRef.current - elapsed);
  }, [clearTimer]);

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, clearTimer]);

  const isError = item.variant === 'error';
  const isInfo = item.variant === 'info';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
      onFocus={pauseTimer}
      onBlur={startTimer}
      className={`pointer-events-auto w-full rounded-2xl border p-3.5 shadow-lg backdrop-blur-md transition-all flex items-start gap-3 ${
        isError
          ? 'border-red-200 bg-red-50/95 text-red-950'
          : isInfo
            ? 'border-[#084F4E]/20 bg-white/95 text-[#1F2A2A]'
            : 'border-[#0E7C7B]/30 bg-[#E6F4F4]/95 text-[#084F4E]'
      }`}
    >
      <div className="shrink-0 mt-0.5">
        {isError ? (
          <AlertCircle className="w-4 h-4 text-red-700" />
        ) : isInfo ? (
          <Info className="w-4 h-4 text-[#0E7C7B]" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-[#0E7C7B]" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        {item.title && (
          <p className="text-xs font-semibold tracking-tight leading-snug">
            {item.title}
          </p>
        )}
        <p className="text-xs sm:text-sm leading-snug break-words">{item.message}</p>
        {item.action && (
          <div className="pt-1">
            {item.action.to ? (
              <Link
                to={item.action.to}
                onClick={() => onDismiss(item.id)}
                className={`inline-flex items-center text-xs font-semibold underline underline-offset-2 ${
                  isError ? 'text-red-800' : 'text-[#084F4E]'
                }`}
              >
                {item.action.label}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => {
                  item.action?.onClick?.();
                  onDismiss(item.id);
                }}
                className={`inline-flex items-center text-xs font-semibold underline underline-offset-2 ${
                  isError ? 'text-red-800' : 'text-[#084F4E]'
                }`}
              >
                {item.action.label}
              </button>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
        className="shrink-0 min-h-[28px] min-w-[28px] flex items-center justify-center rounded-lg opacity-70 hover:opacity-100 hover:bg-black/5 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, options: ToastOptions = {}) => {
    const variant: ToastVariant = options.variant || 'info';
    const id = `tst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const durationMs =
      options.durationMs ?? (variant === 'error' ? 6500 : 4500);

    setToasts((prev) => {
      const next: ToastItem[] = [
        ...prev,
        {
          id,
          variant,
          title: options.title,
          message,
          durationMs,
          action: options.action,
        },
      ];
      return next.slice(-MAX_TOASTS);
    });
    return id;
  }, []);

  const toast = useMemo(
    () => ({
      success: (message: string, options?: Omit<ToastOptions, 'variant'>) =>
        showToast(message, { ...options, variant: 'success' }),
      error: (message: string, options?: Omit<ToastOptions, 'variant'>) =>
        showToast(message, { ...options, variant: 'error' }),
      info: (message: string, options?: Omit<ToastOptions, 'variant'>) =>
        showToast(message, { ...options, variant: 'info' }),
    }),
    [showToast]
  );

  return (
    <ToastContext.Provider
      value={{
        showToast,
        dismissToast,
        toast,
      }}
    >
      {children}

      {/* Global Toast Viewport — positioned cleanly above mobile bottom bars & sticky checkout */}
      {toasts.length > 0 && (
        <div
          aria-label="Notifications"
          className="pointer-events-none fixed bottom-24 lg:bottom-6 right-4 left-4 sm:left-auto sm:w-96 z-50 flex flex-col gap-2.5"
        >
          {toasts.map((item) => (
            <ToastCard key={item.id} item={item} onDismiss={dismissToast} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
