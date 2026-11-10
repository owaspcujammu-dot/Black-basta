import type { Difficulty, EventState } from '../services/types';

export const DIFFICULTY: Record<Difficulty, { label: string; className: string; pips: number }> = {
  EASY: { label: 'Easy', className: 'text-jade-300 border-jade-400/50 bg-jade-500/10', pips: 1 },
  MEDIUM: { label: 'Medium', className: 'text-slate-100 border-slate-400/60 bg-slate-400/10', pips: 2 },
  HARD: { label: 'Hard', className: 'text-blood-300 border-blood-400/50 bg-blood-500/10', pips: 3 },
  INSANE: { label: 'Insane', className: 'text-white border-blood-400 bg-blood-600/70', pips: 4 },
};

export const EVENT_STATE: Record<EventState, { label: string; dot: string; text: string }> = {
  UPCOMING: { label: 'CTF UPCOMING', dot: 'bg-ocean-300', text: 'text-ocean-200' },
  LIVE: { label: 'CTF LIVE', dot: 'bg-jade-400', text: 'text-jade-300' },
  PAUSED: { label: 'CTF PAUSED', dot: 'bg-slate-200', text: 'text-slate-100' },
  ENDED: { label: 'CTF ENDED', dot: 'bg-blood-400', text: 'text-blood-300' },
};

export const pad = (value: number, length = 2) => String(Math.max(0, Math.floor(value))).padStart(length, '0');

/** "Pirate #047" */
export const pirateNumber = (n: number | null | undefined) => (n ? `#${pad(n, 3)}` : '—');

export function splitDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    totalHours: Math.floor(total / 3600),
  };
}

/** "02:31:45" (hours can exceed 24). */
export function clock(ms: number): string {
  const d = splitDuration(ms);
  return `${pad(d.totalHours)}:${pad(d.minutes)}:${pad(d.seconds)}`;
}

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

export function dateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Value for <input type="datetime-local"> in the viewer's own timezone. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
