import { AnimatePresence, motion } from 'framer-motion';
import { Skull, X } from 'lucide-react';
import { Emblem } from './Brand';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useEventCountdown } from '../hooks/useCountdown';
import { useLive } from '../context/LiveContext';
import type { Difficulty, EventState } from '../services/types';
import { DIFFICULTY, EVENT_STATE, clock, pad, splitDuration } from '../utils/format';
import { ShipWheelMark } from './Scenery';

/** Fades and lifts a page in on navigation. */
export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: 'easeOut' }} className={className}>
      {children}
    </motion.div>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="group flex items-center gap-2.5 rounded-md" aria-label="Black Basta — home">
      <Emblem className="h-10 w-10 shrink-0 drop-shadow-[0_0_10px_rgba(232,40,28,0.55)] transition group-hover:scale-105" />
      <span className={compact ? 'hidden sm:block' : 'block'}>
        <span className="block font-display text-base font-black leading-none tracking-[0.2em] text-accent-gradient">BLACK BASTA</span>
        <span className="mt-1 block text-[10px] font-semibold uppercase leading-none tracking-[0.34em] text-ocean-200">Cybersecurity CTF</span>
      </span>
    </Link>
  );
}

export function PageHeader({ title, subtitle, icon, actions }: { title: string; subtitle?: string; icon?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3">
        {icon && <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-accent-500/30 bg-navy-900/80 text-accent-300">{icon}</span>}
        <div>
          <h1 className="text-2xl font-black uppercase tracking-[0.12em] text-accent-gradient sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Spinner({ label = 'Charting the course…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-accent-300" role="status">
      <ShipWheelMark className="h-10 w-10 animate-spin [animation-duration:2.4s]" />
      <span className="text-sm text-slate-400">{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-navy-500 px-6 py-14 text-center">
      <span className="text-accent-400/70">{icon}</span>
      <p className="font-display text-lg text-slate-200">{title}</p>
      {hint && <p className="max-w-md text-sm text-slate-400">{hint}</p>}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blood-400/50 bg-blood-700/20 px-4 py-3 text-sm text-blood-300">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn-ghost btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Event state with a dot AND a text label — never colour alone. */
export function EventBadge({ state }: { state: EventState }) {
  const style = EVENT_STATE[state];
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap font-display text-xs font-bold tracking-[0.18em] ${style.text}`}>
      <span className="relative flex h-2.5 w-2.5">
        {state === 'LIVE' && <span className={`absolute inline-flex h-full w-full animate-pulse-dot rounded-full ${style.dot}`} />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${style.dot}`} />
      </span>
      {style.label}
    </span>
  );
}

export function DifficultyChip({ difficulty }: { difficulty: Difficulty }) {
  const style = DIFFICULTY[difficulty];
  return (
    <span className={`chip ${style.className}`}>
      <span aria-hidden="true" className="flex gap-0.5">
        {[1, 2, 3, 4].map((pip) => (
          <span key={pip} className={`h-1.5 w-1.5 rounded-full ${pip <= style.pips ? 'bg-current' : 'bg-current opacity-25'}`} />
        ))}
      </span>
      {style.label}
    </span>
  );
}

/** Large DAYS : HOURS : MINUTES : SECONDS countdown for the landing page. */
export function BigCountdown() {
  const { event } = useLive();
  const { label, remaining } = useEventCountdown();
  if (!event) return null;

  if (remaining === null || event.state === 'ENDED') {
    const text: Record<EventState, string> = {
      UPCOMING: 'The voyage begins soon',
      LIVE: 'The voyage is underway',
      PAUSED: 'The voyage is paused',
      ENDED: 'The voyage has ended',
    };
    return (
      <div className="text-center">
        <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-accent-300">{text[event.state]}</p>
        <div className="mt-3 flex justify-center">
          <EventBadge state={event.state} />
        </div>
      </div>
    );
  }

  const parts = splitDuration(remaining);
  const cells: [string, number][] = [
    ['Days', parts.days],
    ['Hours', parts.hours],
    ['Minutes', parts.minutes],
    ['Seconds', parts.seconds],
  ];
  return (
    <div className="text-center" role="timer" aria-label={`${label}: ${parts.days} days, ${parts.hours} hours, ${parts.minutes} minutes`}>
      <p className="font-display text-sm font-bold uppercase tracking-[0.3em] text-accent-300">{label}</p>
      <div className="mt-4 flex items-start justify-center gap-2 sm:gap-4" aria-hidden="true">
        {cells.map(([unit, value], index) => (
          <div key={unit} className="flex items-start gap-2 sm:gap-4">
            <div>
              <div className="panel tabular min-w-[4rem] px-3 py-3 font-mono text-3xl font-bold text-accent-200 sm:min-w-[5.5rem] sm:text-5xl">{pad(value)}</div>
              <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.26em] text-ocean-200 sm:text-xs">{unit}</div>
            </div>
            {index < cells.length - 1 && <span className="pt-3 font-mono text-3xl font-bold text-accent-500/60 sm:text-5xl">:</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact HH:MM:SS clock for the header and dashboard. */
export function MiniClock({ className = '' }: { className?: string }) {
  const { remaining } = useEventCountdown();
  return <span className={`tabular font-mono ${className}`}>{remaining === null ? '--:--:--' : clock(remaining)}</span>;
}

/** Open dialogs, bottom to top. */
const openModals: symbol[] = [];

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  /** Parchment (challenge sheet) or dark deck panel. */
  tone?: 'deck' | 'parchment';
}

/** Accessible dialog: focus moves in, Escape closes, focus returns on close. */
export function Modal({ open, onClose, title, children, wide = false, tone = 'deck' }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Held in a ref so re-renders of the parent never re-run the focus logic
  // (which would pull focus out of an input while the user is typing).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = Symbol('modal');
    openModals.push(id);
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      // With stacked dialogs (a confirm over the challenge sheet) only the top one reacts.
      if (openModals[openModals.length - 1] !== id) return;
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab' || !panelRef.current) return;
      // Keep Tab inside the dialog.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      openModals.splice(openModals.indexOf(id), 1);
      if (openModals.length === 0) document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [open]);

  const surface = tone === 'parchment' ? 'parchment' : 'panel';
  const closeColor = tone === 'parchment' ? 'text-ink-700 hover:bg-ink-900/10' : 'text-slate-400 hover:bg-navy-700 hover:text-white';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-abyss/80 p-3 backdrop-blur-sm sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(event) => event.target === event.currentTarget && onClose()}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className={`${surface} relative my-auto w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} p-5 outline-none sm:p-7`}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 id={titleId} className={`text-xl font-black uppercase tracking-[0.1em] sm:text-2xl ${tone === 'parchment' ? 'text-ink-900' : 'text-accent-gradient'}`}>
                {title}
              </h2>
              <button type="button" onClick={onClose} className={`-mr-1 -mt-1 rounded-md p-1.5 ${closeColor}`} aria-label="Close dialog">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-sm leading-relaxed text-slate-300">{message}</div>
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={danger ? 'btn-danger' : 'btn-accent'} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function StatCard({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="panel min-w-0 p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="panel-title">{label}</span>
        {icon && <span className="text-accent-400/80">{icon}</span>}
      </div>
      <div className="tabular mt-3 font-display text-3xl font-black text-slate-50 [overflow-wrap:anywhere]">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400 [overflow-wrap:anywhere]">{hint}</div>}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="tabular font-mono font-semibold text-accent-200">
          {value} / {max} · {percent}%
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full border border-navy-500 bg-navy-950" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-accent-700 via-accent-500 to-accent-300"
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="relative z-10 mt-16 border-t border-accent-500/15 bg-navy-950/70 px-4 pb-24 pt-8 text-center backdrop-blur-sm">
      <p className="flex items-center justify-center gap-2 font-display text-sm font-bold tracking-[0.22em] text-accent-300">
        <Skull className="h-4 w-4" aria-hidden="true" /> BLACK BASTA CTF
      </p>
      <p className="mt-2 text-sm text-slate-400">Set sail. Hack responsibly. Claim the treasure.</p>
      <p className="mt-3 text-xs text-slate-500">© 2026 Black Basta</p>
    </footer>
  );
}
