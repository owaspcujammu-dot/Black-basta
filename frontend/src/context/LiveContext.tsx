import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import type { Announcement, EventInfo, Scoreboard, ScoreboardEntry } from '../services/types';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

interface LiveState {
  event: EventInfo | null;
  scoreboard: Scoreboard | null;
  /** The logged-in pirate's own row, kept current by server pushes. */
  me: ScoreboardEntry | null;
  /** Milliseconds to add to Date.now() to get server time. */
  clockOffset: number;
  connected: boolean;
  /** Bumps when challenges are released, changed or removed. */
  challengeVersion: number;
  /** Bumps when announcements change. */
  announcementVersion: number;
  /** Things that happened while this tab was open (newest first), for the notification bell. */
  notices: LiveNotice[];
}

export interface LiveNotice {
  id: string;
  kind: 'event' | 'challenge' | 'blood';
  title: string;
  message: string;
  /** Server time, ISO-8601. */
  at: string;
}

const MAX_NOTICES = 30;
/** No first frame from the stream within this time = the network blocks streaming. */
const STREAM_SILENCE_MS = 8_000;
/** How often to check for updates when streaming is unavailable. */
const POLL_INTERVAL_MS = 15_000;

const LiveContext = createContext<LiveState | null>(null);

/**
 * One Server-Sent Events connection for the whole app. The server pushes the
 * scoreboard, event state, participant count, announcements and challenge
 * releases — nothing here polls.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const { toast } = useToast();
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [connected, setConnected] = useState(false);
  const [challengeVersion, setChallengeVersion] = useState(0);
  const [announcementVersion, setAnnouncementVersion] = useState(0);
  const [notices, setNotices] = useState<LiveNotice[]>([]);
  const offsetRef = useRef(0);
  const noticeSeq = useRef(0);

  // Latest values for use inside the long-lived stream handlers.
  const userRef = useRef(user);
  userRef.current = user;
  const eventRef = useRef(event);
  eventRef.current = event;

  const userId = user?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    const applyEvent = (next: EventInfo) => {
      offsetRef.current = new Date(next.serverTime).getTime() - Date.now();
      setClockOffset(offsetRef.current);
      setEvent(next);
    };
    // Shows a toast now and keeps the same message in the notification bell.
    const notify = (kind: LiveNotice['kind'], title: string, message: string) => {
      toast('info', title, message);
      const notice: LiveNotice = { id: `live-${++noticeSeq.current}`, kind, title, message, at: new Date(Date.now() + offsetRef.current).toISOString() };
      setNotices((list) => [notice, ...list].slice(0, MAX_NOTICES));
    };
    // A different pirate (or nobody) is at the helm: their notices are not ours.
    setNotices([]);

    // First paint does not wait for the stream.
    api.get<{ event: EventInfo }>('/event').then((res) => !cancelled && applyEvent(res.event)).catch(() => undefined);
    api.get<Scoreboard>('/scoreboard').then((res) => !cancelled && setScoreboard(res)).catch(() => undefined);

    // Event state changes (start / pause / end) are announced the same way in both modes.
    const handleEvent = (next: EventInfo) => {
      const previous = eventRef.current?.state;
      const wasFrozen = eventRef.current?.frozen;
      applyEvent(next);
      if (wasFrozen !== undefined && wasFrozen !== next.frozen && userRef.current) {
        if (next.frozen) notify('event', 'Scoreboard frozen', 'The leaderboard now stays as it is. Keep hunting — your points still count.');
        else notify('event', 'Scoreboard revealed!', 'The live standings are back on the leaderboard.');
        setChallengeVersion((v) => v + 1);
      }
      if (previous && previous !== next.state && userRef.current) {
        const text: Record<EventInfo['state'], [string, string]> = {
          LIVE: ['The CTF is LIVE!', 'Set sail — flag submission is open.'],
          PAUSED: ['The CTF is paused', 'Flag submission is temporarily disabled.'],
          ENDED: ['The CTF has ended', next.frozen ? 'Flag submission is closed. The final standings will be revealed by the organizers.' : 'Flag submission is closed. The leaderboard is final.'],
          UPCOMING: ['The CTF has been reset', 'The voyage has not begun yet.'],
        };
        notify('event', ...text[next.state]);
        setChallengeVersion((v) => v + 1);
      }
    };

    // Reconnects automatically (EventSource) and re-authenticates when the user changes.
    const source = new EventSource('/api/stream');
    let streamWorks = false;
    let pollTimer: number | undefined;
    const on = <T,>(name: string, handler: (data: T) => void) =>
      source.addEventListener(name, (message) => {
        streamWorks = true;
        try {
          handler(JSON.parse((message as MessageEvent<string>).data) as T);
        } catch {
          // Ignore a malformed frame rather than break the stream.
        }
      });

    source.onopen = () => setConnected(true);
    source.onerror = () => {
      if (pollTimer === undefined) setConnected(false);
    };

    /*
     * Fallback for networks that cannot stream (e.g. a Cloudflare quick tunnel,
     * which buffers the stream completely): the server always sends a first
     * frame at once, so silence means the stream is blocked. Close it — a stuck
     * request also counts against the tunnel's concurrency limit — and poll.
     */
    const lastVersions = { challenges: -1, announcements: -1, scoreboard: '' };
    const poll = async () => {
      try {
        const [{ event: next }, board] = await Promise.all([api.get<{ event: EventInfo }>('/event'), api.get<Scoreboard>('/scoreboard')]);
        if (cancelled) return;
        handleEvent(next);
        const versions = next.versions;
        if (versions) {
          if (lastVersions.challenges !== -1 && versions.challenges !== lastVersions.challenges) {
            setChallengeVersion((v) => v + 1);
            if (userRef.current?.role === 'participant') notify('challenge', 'Challenges updated', 'The Treasure Map has changed — check for new challenges.');
          }
          if (lastVersions.announcements !== -1 && versions.announcements !== lastVersions.announcements) setAnnouncementVersion((v) => v + 1);
          lastVersions.challenges = versions.challenges;
          lastVersions.announcements = versions.announcements;
        }
        if (lastVersions.scoreboard && board.generatedAt !== lastVersions.scoreboard) setChallengeVersion((v) => v + 1);
        lastVersions.scoreboard = board.generatedAt;
        setScoreboard(board);
        setConnected(true);
      } catch {
        if (!cancelled) setConnected(false);
      }
    };
    const fallback = window.setTimeout(() => {
      if (streamWorks || cancelled) return;
      source.close();
      void poll();
      pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    }, STREAM_SILENCE_MS);

    on<EventInfo>('event', handleEvent);
    on<Scoreboard>('scoreboard', setScoreboard);
    on<{ participants: number; maxParticipants: number }>('participants', (data) => setEvent((current) => (current ? { ...current, ...data } : current)));
    on<Announcement>('announcement', (announcement) => {
      setAnnouncementVersion((v) => v + 1);
      toast('info', `📢 ${announcement.title}`, announcement.message);
    });
    on('announcement-removed', () => setAnnouncementVersion((v) => v + 1));
    on<{ type: string; title?: string; category?: string }>('challenge', (data) => {
      setChallengeVersion((v) => v + 1);
      if (data.type === 'released' && userRef.current?.role === 'participant') {
        notify('challenge', 'New challenge released!', `A new ${data.category} challenge has appeared on the Grand Line: ${data.title}`);
      }
    });
    on<{ username: string; player?: string | null; challenge: string; firstBlood: boolean }>('solve', (data) => {
      setChallengeVersion((v) => v + 1);
      const self = userRef.current;
      if (data.username !== self?.username) {
        if (data.firstBlood) notify('blood', 'First blood!', `${data.username} drew first blood on ${data.challenge}.`);
      } else {
        // Our crew scored (here or on a teammate's device): while the scoreboard is
        // frozen the board does not move, so fetch our own live score directly.
        if (eventRef.current?.frozen) void refresh();
        if (!data.player || data.player === self.player) return;
        // A teammate on another device claimed a treasure for the crew.
        notify('challenge', 'Crew treasure!', `${data.player} claimed ${data.challenge} for your crew.`);
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
      source.close();
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Our row on the board. While frozen, the rank and title stay as frozen, but our own
  // score and solves are live (a crew always sees its own progress).
  const userScore = user?.score;
  const userSolved = user?.solved;
  const me = useMemo(() => {
    const entry = userId === null ? null : (scoreboard?.entries.find((row) => row.userId === userId) ?? null);
    if (!entry || !scoreboard?.frozenAt || userScore === undefined || userSolved === undefined) return entry;
    return { ...entry, score: userScore, solved: userSolved };
  }, [scoreboard, userId, userScore, userSolved]);

  // Keep the auth user (score in the header) in step with admin-side changes.
  const myScore = me?.score;
  useEffect(() => {
    if (myScore !== undefined && userRef.current && myScore !== userRef.current.score) void refresh();
  }, [myScore, refresh]);

  const value = useMemo(
    () => ({ event, scoreboard, me, clockOffset, connected, challengeVersion, announcementVersion, notices }),
    [event, scoreboard, me, clockOffset, connected, challengeVersion, announcementVersion, notices],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  const context = useContext(LiveContext);
  if (!context) throw new Error('useLive must be used inside <LiveProvider>');
  return context;
}
