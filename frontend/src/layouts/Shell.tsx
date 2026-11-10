import { AnimatePresence, motion } from 'framer-motion';
import { Coins, Dumbbell, LayoutDashboard, LogOut, Map as MapIcon, Menu, ScrollText, Shield, Timer, Trophy, User as UserIcon, WifiOff, X } from 'lucide-react';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { NotificationBell } from '../components/NotificationBell';
import { OceanBackground } from '../components/Scenery';
import { EventBadge, Footer, Logo, MiniClock, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';
import { useToast } from '../context/ToastContext';
import { preloadPages } from '../pages/loaders';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const PARTICIPANT_NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> },
  { to: '/challenges', label: 'Challenges', icon: <MapIcon className="h-4 w-4" aria-hidden="true" /> },
  { to: '/practice', label: 'Practice', icon: <Dumbbell className="h-4 w-4" aria-hidden="true" /> },
  { to: '/scoreboard', label: 'Scoreboard', icon: <Trophy className="h-4 w-4" aria-hidden="true" /> },
  { to: '/rules', label: 'Rules', icon: <ScrollText className="h-4 w-4" aria-hidden="true" /> },
  { to: '/profile', label: 'Profile', icon: <UserIcon className="h-4 w-4" aria-hidden="true" /> },
];

const GUEST_NAV: NavItem[] = [
  { to: '/scoreboard', label: 'Scoreboard', icon: <Trophy className="h-4 w-4" aria-hidden="true" /> },
  { to: '/rules', label: 'Rules', icon: <ScrollText className="h-4 w-4" aria-hidden="true" /> },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${
    isActive ? 'bg-accent-500/15 text-accent-200 shadow-[inset_0_-2px_0_0_#e8281c]' : 'text-slate-300 hover:bg-navy-800 hover:text-white'
  }`;

/** Event strip shown on every authenticated page: state, clock, bounty, rank. */
function EventStrip() {
  const { user } = useAuth();
  const { event, me } = useLive();
  if (!event || !user) return null;
  const score = me?.score ?? user.score;
  const rank = me?.rank ?? user.rank;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
      <EventBadge state={event.state} />
      <span className="flex items-center gap-1.5 text-slate-200" title="Time remaining">
        <Timer className="h-4 w-4 text-ocean-300" aria-hidden="true" />
        <span className="sr-only">Time remaining</span>
        <MiniClock className="font-semibold" />
      </span>
      {user.role === 'participant' ? (
        <>
          <span className="flex items-center gap-1.5 font-semibold text-accent-200">
            <Coins className="h-4 w-4" aria-hidden="true" />
            <motion.span key={score} initial={{ scale: 1.35, color: '#ff5c50' }} animate={{ scale: 1, color: '#f4ecec' }} transition={{ duration: 0.5 }} className="tabular inline-block font-mono">
              {score}
            </motion.span>
            <span className="text-xs tracking-[0.14em] text-accent-300/80">BOUNTY</span>
          </span>
          <span className="tabular rounded-md border border-accent-500/40 bg-accent-500/10 px-2 py-0.5 font-mono font-bold text-accent-200" title="Pirate rank">
            <span className="sr-only">Rank </span>#{rank ?? '—'}
          </span>
        </>
      ) : (
        <span className="chip border-blood-400/50 bg-blood-500/10 text-blood-300">
          <Shield className="h-3 w-3" aria-hidden="true" /> Admin
        </span>
      )}
    </div>
  );
}

export function Shell() {
  const { user, logout } = useAuth();
  const { event, connected } = useLive();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  // A new page starts at the top. Opening a challenge (/challenges/5) keeps the list where it was.
  const section = location.pathname.replace(/\/\d+\/?$/, '');
  const lastSection = useRef(section);
  useEffect(() => {
    if (section === lastSection.current) return;
    lastSection.current = section;
    if (!location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [section, location.hash]);

  // Fetch the other pages in the background so moving between them is instant.
  const role = user?.role ?? 'guest';
  useEffect(() => preloadPages(role), [role]);

  const nav = user ? [...PARTICIPANT_NAV, ...(user.role === 'admin' ? [{ to: '/admin', label: 'Admin', icon: <Shield className="h-4 w-4" aria-hidden="true" /> }] : [])] : GUEST_NAV;

  const onLogout = async () => {
    // Leave the members-only page first; otherwise its login redirect wins over the home page.
    navigate('/');
    await logout();
    toast('info', 'You have left the ship', 'Fair winds, pirate.');
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <OceanBackground />

      {event?.demoMode && (
        <div className="relative z-40 bg-blood-600 px-4 py-1.5 text-center text-xs font-bold uppercase tracking-[0.2em] text-white">
          Demo mode — local test instance. Not for a real event.
        </div>
      )}

      <header className="sticky top-0 z-50 border-b border-accent-500/20 bg-navy-950/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Logo compact={Boolean(user)} />

          <div className="hidden lg:block">
            <EventStrip />
          </div>

          <div className="flex items-center gap-2">
            {!user && (
              <div className="hidden items-center gap-2 sm:flex">
                <NavLink to="/login" className="btn-ghost btn-sm">
                  Board the Ship
                </NavLink>
                {event?.registrationOpen && (
                  <NavLink to="/register" className="btn-accent btn-sm">
                    Join the Crew
                  </NavLink>
                )}
              </div>
            )}
            <NotificationBell />
            {user && (
              <button type="button" onClick={onLogout} className="btn-ghost btn-sm hidden md:inline-flex">
                <LogOut className="h-4 w-4" aria-hidden="true" /> Logout
              </button>
            )}
            <button
              type="button"
              className="rounded-md border border-navy-500 p-2 text-slate-200 hover:bg-navy-800 md:hidden"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>

        {user && (
          <div className="border-t border-navy-700/70 px-4 py-2 lg:hidden">
            <div className="mx-auto max-w-7xl">
              <EventStrip />
            </div>
          </div>
        )}

        <nav aria-label="Main" className="hidden border-t border-navy-700/70 md:block">
          <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-1.5">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass}>
                {item.icon}
                {item.label}
              </NavLink>
            ))}
            {user && !connected && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-accent-300" role="status">
                <WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> Live updates reconnecting…
              </span>
            )}
          </div>
        </nav>

        <AnimatePresence>
          {menuOpen && (
            <motion.nav
              id="mobile-nav"
              aria-label="Main"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-navy-700/70 md:hidden"
            >
              <div className="flex flex-col gap-1 px-4 py-3">
                {nav.map((item) => (
                  <NavLink key={item.to} to={item.to} className={linkClass}>
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))}
                {user ? (
                  <button type="button" onClick={onLogout} className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-navy-800">
                    <LogOut className="h-4 w-4" aria-hidden="true" /> Logout
                  </button>
                ) : (
                  <div className={`mt-2 grid gap-2 ${event?.registrationOpen ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <NavLink to="/login" className="btn-ghost btn-sm">
                      Board the Ship
                    </NavLink>
                    {event?.registrationOpen && (
                      <NavLink to="/register" className="btn-accent btn-sm">
                        Join the Crew
                      </NavLink>
                    )}
                  </div>
                )}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <main id="main" className="relative z-10 flex-1">
        {/* Only the page area waits for a page to load; the header and background stay put. */}
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}

/** Standard content width for inner pages. */
export function Container({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <div className={`mx-auto w-full px-4 py-8 sm:py-10 ${narrow ? 'max-w-3xl' : 'max-w-7xl'}`}>{children}</div>;
}
