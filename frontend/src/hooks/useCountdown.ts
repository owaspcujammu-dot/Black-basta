import { useEffect, useState } from 'react';
import { useLive } from '../context/LiveContext';

/** Server-synchronised "now", ticking once per second. */
export function useServerNow(): number {
  const { clockOffset } = useLive();
  const [now, setNow] = useState(() => Date.now() + clockOffset);

  useEffect(() => {
    const tick = () => setNow(Date.now() + clockOffset);
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [clockOffset]);

  return now;
}

export interface EventCountdown {
  /** What the clock is counting towards. */
  label: string;
  /** Milliseconds remaining, or null when there is nothing to count down to. */
  remaining: number | null;
}

/** The right countdown for the current event state. */
export function useEventCountdown(): EventCountdown {
  const { event } = useLive();
  const now = useServerNow();
  if (!event) return { label: '', remaining: null };

  const until = (iso: string | null) => (iso ? Math.max(0, new Date(iso).getTime() - now) : null);

  switch (event.state) {
    case 'UPCOMING':
      return { label: 'The voyage begins in', remaining: until(event.startsAt) };
    case 'LIVE':
      return { label: 'Time remaining', remaining: until(event.endsAt) };
    case 'PAUSED':
      return { label: 'Paused', remaining: until(event.endsAt) };
    case 'ENDED':
      return { label: 'The voyage has ended', remaining: 0 };
  }
}
