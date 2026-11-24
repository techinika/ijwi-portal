import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Menu, X, LogOut, User as UserIcon, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { formatMoney } from '../shared/pricing';

export function Layout({ children }: { children: React.ReactNode }) {
  const {
    portalUser,
    loading,
    unpaidInvoices,
    notifications,
    announcements,
    signInWithGoogle,
    logout,
    markNotificationRead,
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const isAdmin = portalUser?.role === 'admin';
  const isTeacher = portalUser?.role === 'teacher';
  const hasAccess = Boolean(portalUser?.accessActive) || isAdmin || isTeacher;

  const isBillingOrPublicRoute =
    location.pathname === '/' ||
    location.pathname.startsWith('/invoices/') ||
    location.pathname.startsWith('/profile') ||
    location.pathname.startsWith('/invite/') ||
    location.pathname.startsWith('/verify/');

  const shouldGateUnpaid =
    !loading && portalUser && !hasAccess && !isBillingOrPublicRoute;

  const navLinks = (() => {
    if (!portalUser) {
      return [
        { to: '/', label: 'Enrol' },
        { to: '/#plans', label: 'Plans' },
        { to: '/#team-pricing', label: 'Teams' },
      ];
    }
    if (!hasAccess) {
      return [
        { to: '/', label: 'Enrol' },
        ...(unpaidInvoices[0]
          ? [{ to: `/invoices/${unpaidInvoices[0].id}`, label: 'My Invoice' }]
          : []),
        { to: '/profile', label: 'Billing' },
      ];
    }
    if (isAdmin) {
      return [
        { to: '/admin', label: 'Admin' },
        { to: '/teacher', label: 'Teaching' },
        { to: '/dashboard', label: 'Portal' },
        { to: '/resources', label: 'Resources' },
        { to: '/sessions', label: 'Sessions' },
      ];
    }
    if (isTeacher) {
      return [
        { to: '/teacher', label: 'Teacher Desk' },
        { to: '/resources', label: 'Resources' },
        { to: '/sessions', label: 'Sessions' },
        { to: '/profile', label: 'Profile' },
      ];
    }
    return [
      { to: '/dashboard', label: 'Dashboard' },
      { to: '/bookings', label: 'Lessons' },
      { to: '/resources', label: 'Resources' },
      { to: '/sessions', label: 'Community' },
      ...(portalUser.isTeamOwner || portalUser.teamId
        ? [{ to: '/team', label: 'Team' }]
        : [{ to: '/progress', label: 'Progress' }]),
    ];
  })();

  async function handleSignIn() {
    setSigningIn(true);
    try {
      const user = await signInWithGoogle();
      if (user && !window.location.pathname.startsWith('/invoices/')) {
        if (user.role === 'admin') navigate('/admin');
        else if (user.role === 'teacher') navigate('/teacher');
        else if (user.accessActive) navigate('/dashboard');
        else navigate('/profile');
      }
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#1F2A2A]">
      {/* Strict 3-zone Top Bar */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#084F4E]/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand wordmark in Fraunces only */}
          <Link
            to="/"
            className="font-display text-2xl font-bold tracking-tight text-[#084F4E] whitespace-nowrap shrink-0"
          >
            Ijwi
          </Link>

          {/* Zone 2: Concise single-line navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#3F4F4F]">
            {navLinks.map((item) => {
              const active =
                item.to === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(item.to.replace('/#', '/'));
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`whitespace-nowrap shrink-0 py-1 transition-colors ${
                    active
                      ? 'text-[#084F4E] border-b-2 border-[#C9A84C]'
                      : 'hover:text-[#084F4E]'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action or user profile controls */}
          <div className="flex items-center gap-3 shrink-0">
            {portalUser ? (
              <>
                <div className="relative">
                  <button
                    type="button"
                    aria-label="Notifications"
                    onClick={() => setNotifOpen((v) => !v)}
                    className="relative p-2 rounded-xl border border-[#084F4E]/12 text-[#084F4E] hover:bg-[#E6F4F4] transition-colors"
                  >
                    <Bell className="w-4 h-4" />
                    {unreadCount > 0 && (
                      <span className="ml-1 text-xs font-semibold tabular-nums text-[#084F4E]">
                        {unreadCount}
                      </span>
                    )}
                  </button>
                  {notifOpen && (
                    <div className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-2xl border border-[#084F4E]/15 bg-white shadow-lg p-4 z-50">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-display font-semibold text-sm text-[#084F4E]">
                          Notifications
                        </span>
                        <button
                          type="button"
                          onClick={() => setNotifOpen(false)}
                          className="text-xs text-[#3F4F4F] hover:text-[#084F4E]"
                        >
                          Close
                        </button>
                      </div>
                      {notifications.length === 0 ? (
                        <p className="text-sm text-[#3F4F4F] py-4 text-center">
                          All caught up.
                        </p>
                      ) : (
                        <ul className="space-y-2 max-h-72 overflow-y-auto">
                          {notifications.slice(0, 8).map((n) => (
                            <li
                              key={n.id}
                              className={`p-3 rounded-xl border ${
                                n.read
                                  ? 'border-transparent bg-[#FAFBFB]'
                                  : 'border-[#0E7C7B]/20 bg-[#E6F4F4]/60'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  void markNotificationRead(n.id);
                                  setNotifOpen(false);
                                  if (n.link) navigate(n.link);
                                }}
                                className="text-left w-full"
                              >
                                <p className="text-xs font-semibold text-[#084F4E]">{n.title}</p>
                                <p className="text-xs text-[#3F4F4F] mt-0.5">{n.body}</p>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                <Link
                  to="/profile"
                  className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#084F4E]/12 text-sm font-medium text-[#084F4E] hover:bg-[#E6F4F4] transition-colors whitespace-nowrap shrink-0"
                >
                  {portalUser.photoUrl ? (
                    <img
                      src={portalUser.photoUrl}
                      alt={portalUser.displayName}
                      referrerPolicy="no-referrer"
                      className="w-5 h-5 rounded-full object-cover"
                    />
                  ) : (
                    <UserIcon className="w-4 h-4" />
                  )}
                  <span className="max-w-[120px] truncate">
                    {portalUser.displayName.split(' ')[0]}
                  </span>
                </Link>

                <button
                  type="button"
                  onClick={() => void logout()}
                  title="Sign out"
                  aria-label="Sign out"
                  className="hidden sm:inline-flex p-2 rounded-xl text-[#3F4F4F] hover:text-[#084F4E] hover:bg-[#E6F4F4] transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={signingIn}
                onClick={() => void handleSignIn()}
                className="px-4 py-2 rounded-xl bg-[#084F4E] text-white text-sm font-medium hover:bg-[#0E7C7B] transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                {signingIn ? 'Signing in...' : 'Sign in'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle menu"
              className="md:hidden p-2 rounded-xl border border-[#084F4E]/12 text-[#084F4E]"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-[#084F4E]/10 bg-white px-4 py-4 space-y-2">
            {navLinks.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className="block px-3 py-2.5 rounded-xl text-sm font-medium text-[#1F2A2A] hover:bg-[#E6F4F4]"
              >
                {item.label}
              </Link>
            ))}
            {portalUser && (
              <>
                <Link
                  to="/profile"
                  onClick={() => setMobileOpen(false)}
                  className="block px-3 py-2.5 rounded-xl text-sm font-medium text-[#1F2A2A] hover:bg-[#E6F4F4]"
                >
                  Profile &amp; Billing
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    void logout();
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium text-[#3F4F4F] hover:bg-[#E6F4F4]"
                >
                  Sign out
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {/* Unpaid invoice banner */}
      {!loading && portalUser && !hasAccess && unpaidInvoices.length > 0 && (
        <div className="bg-[#E8C97A]/35 border-b border-[#C9A84C]/40">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm text-[#1F2A2A]">
              <AlertCircle className="w-4 h-4 text-[#084F4E] shrink-0" />
              <span>
                <strong className="font-semibold">Your invoice is waiting.</strong>{' '}
                Complete payment for {unpaidInvoices[0].number} (
                <span className="tabular-nums">
                  {formatMoney(unpaidInvoices[0].totalCents, unpaidInvoices[0].currency)}
                </span>
                ) to unlock your teacher, classes, and resources.
              </span>
            </div>
            <Link
              to={`/invoices/${unpaidInvoices[0].id}`}
              className="px-4 py-2 rounded-xl bg-[#084F4E] text-white text-xs font-semibold hover:bg-[#0E7C7B] transition-colors whitespace-nowrap shrink-0"
            >
              Pay invoice now
            </Link>
          </div>
        </div>
      )}

      {/* Active portal announcements */}
      {hasAccess && announcements.length > 0 && (
        <div className="bg-[#E6F4F4] border-b border-[#0E7C7B]/15">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 text-sm text-[#084F4E] flex flex-wrap items-center gap-2">
            <span className="font-semibold">{announcements[0].title}:</span>
            <span className="text-[#3F4F4F]">{announcements[0].body}</span>
          </div>
        </div>
      )}

      {/* Main Content or Unpaid Gate */}
      <main className="flex-1">
        {shouldGateUnpaid ? (
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
            <div className="rounded-3xl border border-[#084F4E]/15 bg-[#FAFBFB] p-8 sm:p-10 text-center">
              <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#084F4E] mb-3">
                {unpaidInvoices.length > 0
                  ? 'Your invoice is waiting'
                  : 'Complete your enrolment to enter the portal'}
              </h1>
              <p className="text-[#3F4F4F] text-base leading-relaxed mb-8">
                {unpaidInvoices.length > 0
                  ? 'Portal access begins as soon as your invoice is paid. You can review your invoice or check your billing history anytime.'
                  : 'Choose a Kinyarwanda plan or open your team invite link to unlock lessons, study groups, and resources.'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                {unpaidInvoices.length > 0 ? (
                  <Link
                    to={`/invoices/${unpaidInvoices[0].id}`}
                    className="px-6 py-3 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] transition-colors"
                  >
                    Open Invoice {unpaidInvoices[0].number}
                  </Link>
                ) : (
                  <Link
                    to="/"
                    className="px-6 py-3 rounded-xl bg-[#084F4E] text-white text-sm font-semibold hover:bg-[#0E7C7B] transition-colors"
                  >
                    Choose a Plan
                  </Link>
                )}
                <Link
                  to="/profile"
                  className="px-6 py-3 rounded-xl border border-[#084F4E]/20 text-[#084F4E] text-sm font-medium hover:bg-[#E6F4F4] transition-colors"
                >
                  Profile &amp; Billing
                </Link>
              </div>
            </div>
          </div>
        ) : (
          children
        )}
      </main>

      <footer className="border-t border-[#084F4E]/10 bg-white py-8 mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[#3F4F4F]">
          <div className="flex items-center gap-3">
            <span className="font-display font-semibold text-[#084F4E]">Ijwi</span>
            <span aria-hidden="true">·</span>
            <span>Kinyarwanda Language Academy</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="mailto:learn@ijwi.me" className="hover:text-[#084F4E] transition-colors">
              learn@ijwi.me
            </a>
            <span aria-hidden="true">·</span>
            <Link to="/" className="hover:text-[#084F4E] transition-colors">
              Plans
            </Link>
            <span aria-hidden="true">·</span>
            <Link to="/profile" className="hover:text-[#084F4E] transition-colors">
              Billing
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
