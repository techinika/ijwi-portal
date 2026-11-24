import React from 'react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'Something went wrong.' };
  }

  render() {
    if (this.state.hasError) {
      let friendlyMessage = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string; path?: string };
        if (parsed.error) {
          friendlyMessage = `Permission or data error (${parsed.path || 'portal'}): ${parsed.error}`;
        }
      } catch {
        // non-JSON error
      }

      return (
        <div className="min-h-screen bg-white flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-[#084F4E]/15 bg-[#FAFBFB] p-8 text-center">
            <p className="font-display text-2xl font-semibold text-[#084F4E] mb-2">Ijwi</p>
            <h1 className="font-display text-xl text-[#1F2A2A] mb-3">
              We hit an unexpected pause
            </h1>
            <p className="text-sm text-[#3F4F4F] mb-6 leading-relaxed">{friendlyMessage}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-[#084F4E] text-white text-sm font-medium hover:bg-[#0E7C7B] transition-colors"
            >
              Reload portal
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
