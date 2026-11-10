import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { Bell, BellRing, Flag, Megaphone, Radio, Swords } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';
import { useApi } from '../hooks/useApi';
import { useServerNow } from '../hooks/useCountdown';
import type { Announcement } from '../services/types';
import { timeAgo } from '../utils/format';

type Kind = 'announcement' | 'event' | 'challenge' | 'blood';

interface Item {
  id: string;
  kind: Kind;
  title: string;
  message: string;
  at: string;
}

const KIND: Record<Kind, { label: string; icon: ReactNode }> = {
  announcement: { label: 'Announcement', icon: <Megaphone className="h-4 w-4" aria-hidden="true" /> },
  event: { label: 'Event', icon: <Radio className="h-4 w-4" aria-hidden="true" /> },
  challenge: { label: 'New challenge', icon: <Flag className="h-4 w-4" aria-hidden="true" /> },
  blood: { label: 'First blood', icon: <Swords className="h-4 w-4" aria-hidden="true" /> },
};

const MAX_ITEMS = 30;

/** "Last read" timestamp, remembered per account in this browser. */
function useLastRead(userId: number): [number, (value: number) => void] {
  const key = `kop:notifications:read:${userId}`;
  const [value, setValue] = useState(() => {
    try {
      return Number(window.localStorage.getItem(key)) || 0;
    } catch {
      return 0; // Storage blocked (private window): everything simply shows as unread once.
    }
  });
  const update = useCallback(
    (next: number) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Not persisted; still correct for this page view.
      }
    },
    [key],
  );
  return [value, update];
}

/**
 * Header bell: captain's announcements plus what happened live in this
 * session (challenge releases, first bloods, event state changes), with an
 * unread count. Opening the panel marks everything as read.
 */
export function NotificationBell() {
  const { user } = useAuth();
  if (!user) return null;
  return <BellForUser userId={user.id} />;
}

function BellForUser({ userId }: { userId: number }) {
  const { notices, announcementVersion } = useLive();
  const now = useServerNow();
  const announcements = useApi<{ announcements: Announcement[] }>('/announcements', [announcementVersion]);
  const [lastRead, setLastRead] = useLastRead(userId);
  const [open, setOpen] = useState(false);
  // What counted as "new" at the moment the panel was opened, so those rows stay highlighted while it is open.
  const [newSince, setNewSince] = useState(lastRead);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const ring = useAnimationControls();

  const items = useMemo<Item[]>(() => {
    const fromCaptain: Item[] = (announcements.data?.announcements ?? []).map((announcement) => ({
      id: `announcement-${announcement.id}`,
      kind: 'announcement',
      title: announcement.title,
      message: announcement.message,
      at: announcement.createdAt,
    }));
    return [...fromCaptain, ...notices].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_ITEMS);
  }, [announcements.data, notices]);

  const unread = items.filter((item) => new Date(item.at).getTime() > lastRead).length;

  // Ring the bell when something new arrives.
  const previousUnread = useRef(unread);
  useEffect(() => {
    if (unread > previousUnread.current) void ring.start({ rotate: [0, -18, 16, -12, 8, 0], transition: { duration: 0.6 } });
    previousUnread.current = unread;
  }, [unread, ring]);

  const newestAt = items.length > 0 ? new Date(items[0].at).getTime() : 0;

  const toggle = () => {
    if (!open) {
      setNewSince(lastRead);
      setLastRead(Math.max(now, newestAt));
    }
    setOpen((value) => !value);
  };

  // Anything that arrives while the panel is open has been seen.
  useEffect(() => {
    if (open && newestAt > lastRead) setLastRead(newestAt);
  }, [open, newestAt, lastRead, setLastRead]);

  // Close on outside click and on Escape (returning focus to the bell).
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        className={`relative rounded-md border p-2 transition ${
          open ? 'border-accent-400 bg-accent-500/15 text-white' : 'border-navy-500 text-slate-200 hover:border-accent-400/70 hover:bg-navy-800'
        }`}
      >
        <motion.span animate={ring} className="block origin-top">
          {unread > 0 ? <BellRing className="h-5 w-5 text-accent-300" aria-hidden="true" /> : <Bell className="h-5 w-5" aria-hidden="true" />}
        </motion.span>
        {unread > 0 && (
          <motion.span
            key={unread}
            initial={{ scale: 0.4 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            className="tabular absolute -right-1.5 -top-1.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full border-2 border-navy-950 bg-accent-400 px-1 font-mono text-[11px] font-bold leading-none text-white"
            aria-hidden="true"
          >
            {unread > 9 ? '9+' : unread}
          </motion.span>
        )}
      </button>

      {/* Announces new arrivals to screen readers without stealing focus. */}
      <span className="sr-only" role="status" aria-live="polite">
        {unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}` : ''}
      </span>

      <AnimatePresence>
        {open && (
          <motion.section
            id={panelId}
            aria-label="Notifications"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className="panel absolute right-0 top-full z-[60] mt-2 w-[min(22rem,calc(100vw-2rem))] origin-top-right overflow-hidden border-accent-500/40 bg-navy-900/[0.98]"
          >
            <header className="flex items-center justify-between gap-3 border-b border-navy-700 px-4 py-3">
              <h2 className="panel-title">Notifications</h2>
              <span className="text-xs text-slate-400">{items.length === 0 ? 'Nothing yet' : `${items.length} latest`}</span>
            </header>

            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <Bell className="h-8 w-8 text-accent-400/60" aria-hidden="true" />
                <p className="font-display text-base text-slate-200">No messages from the captain.</p>
                <p className="text-xs text-slate-400">Announcements, new challenges and first bloods show up here.</p>
              </div>
            ) : (
              <ul className="max-h-[min(26rem,70vh)] divide-y divide-navy-700/80 overflow-y-auto">
                {items.map((item) => {
                  const fresh = new Date(item.at).getTime() > newSince;
                  return (
                    <li key={item.id} className={`flex gap-3 px-4 py-3 ${fresh ? 'bg-accent-500/10' : ''}`}>
                      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border ${fresh ? 'border-accent-400/70 text-accent-300' : 'border-navy-500 text-slate-400'}`}>
                        {KIND[item.kind].icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                          {KIND[item.kind].label}
                          {/* "New" is written out, not signalled by the tint alone. */}
                          {fresh && <span className="rounded-full bg-accent-400 px-1.5 py-px text-[10px] tracking-[0.1em] text-white">New</span>}
                        </p>
                        <p className="mt-0.5 break-words text-sm font-semibold text-slate-100">{item.title}</p>
                        <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-snug text-slate-300">{item.message}</p>
                        <time dateTime={item.at} className="mt-1 block text-xs text-slate-500">
                          {timeAgo(item.at, now)}
                        </time>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <footer className="border-t border-navy-700 px-4 py-2.5 text-center">
              <Link to="/dashboard" onClick={() => setOpen(false)} className="rounded text-xs font-semibold text-accent-300 underline-offset-4 hover:underline">
                View all announcements on the Captain's Deck
              </Link>
            </footer>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
