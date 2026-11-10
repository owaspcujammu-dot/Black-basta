import { Prisma, type Event, type EventState } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { HttpError } from '../utils/errors';
import { FLAG_FORMAT } from '../utils/flags';
import { awardPirateKing } from './achievement.service';
import { broadcast, liveVersions } from './realtime.service';
import { getScoreboard, setPushableBoard, type Scoreboard } from './scoreboard.service';

export type EventAction = 'start' | 'pause' | 'end' | 'reset';

// The event row is read on almost every request, so it is cached in memory
// (the backend runs as a single instance).
let cachedEvent: Event | null = null;
let cachedParticipants: number | null = null;

export async function getEvent(): Promise<Event> {
  if (!cachedEvent) {
    cachedEvent = await prisma.event.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, name: config.eventName, startsAt: config.eventStartAt, endsAt: config.eventEndAt },
    });
  }
  return cachedEvent;
}

export async function participantCount(): Promise<number> {
  if (cachedParticipants === null) {
    cachedParticipants = await prisma.user.count({ where: { role: 'participant' } });
  }
  return cachedParticipants;
}

function invalidateParticipantCount() {
  cachedParticipants = null;
}

export function resetEventCache() {
  cachedEvent = null;
  cachedParticipants = null;
}

export async function publicEvent() {
  const [event, participants] = await Promise.all([getEvent(), participantCount()]);
  return {
    name: event.name,
    state: event.state,
    startsAt: event.startsAt?.toISOString() ?? null,
    endsAt: event.endsAt?.toISOString() ?? null,
    startedAt: event.startedAt?.toISOString() ?? null,
    endedAt: event.endedAt?.toISOString() ?? null,
    serverTime: new Date().toISOString(),
    participants,
    maxParticipants: config.maxParticipants,
    flagFormat: FLAG_FORMAT,
    firstBloodBonus: config.firstBloodBonus,
    demoMode: config.demoMode,
    registrationOpen: config.selfRegistration,
    versions: liveVersions(),
    maxTeamSize: config.maxTeamSize,
    /** Scoreboard freeze time (null: no freeze), and whether the board is frozen now. */
    freezeAt: event.freezeAt?.toISOString() ?? null,
    frozen: isFrozen(event),
  };
}


async function save(data: Prisma.EventUpdateInput): Promise<Event> {
  cachedEvent = await prisma.event.update({ where: { id: 1 }, data });
  broadcast('event', await publicEvent());
  return cachedEvent;
}

export async function broadcastParticipants() {
  invalidateParticipantCount();
  broadcast('participants', { participants: await participantCount(), maxParticipants: config.maxParticipants });
}

const ALLOWED: Record<EventAction, EventState[]> = {
  start: ['UPCOMING', 'PAUSED', 'ENDED'],
  pause: ['LIVE'],
  end: ['LIVE', 'PAUSED', 'UPCOMING'],
  reset: ['LIVE', 'PAUSED', 'ENDED'],
};

export async function applyEventAction(action: EventAction): Promise<Event> {
  const event = await getEvent();
  if (!ALLOWED[action].includes(event.state)) {
    throw new HttpError(409, 'INVALID_TRANSITION', `Cannot ${action} the CTF while it is ${event.state}.`);
  }
  const now = new Date();

  switch (action) {
    case 'start':
      return save({
        state: 'LIVE',
        startedAt: event.startedAt ?? now,
        endedAt: null,
        // A scheduled end in the past would end the event again immediately.
        endsAt: event.endsAt && event.endsAt <= now ? null : event.endsAt,
      });
    case 'pause':
      return save({ state: 'PAUSED' });
    case 'end': {
      const ended = await save({ state: 'ENDED', endedAt: now });
      await awardPirateKing();
      return ended;
    }
    case 'reset':
      // A start time already in the past would start the event again straight away (see the ticker).
      return save({
        state: 'UPCOMING',
        startedAt: null,
        endedAt: null,
        freezeAt: null,
        frozenScoreboard: Prisma.DbNull,
        startsAt: event.startsAt && event.startsAt <= now ? null : event.startsAt,
        endsAt: event.endsAt && event.endsAt <= now ? null : event.endsAt,
      });
  }
}

export async function updateSchedule(data: { name?: string; startsAt?: Date | null; endsAt?: Date | null; freezeAt?: Date | null }): Promise<Event> {
  const event = await getEvent();
  const startsAt = data.startsAt === undefined ? event.startsAt : data.startsAt;
  const endsAt = data.endsAt === undefined ? event.endsAt : data.endsAt;
  const freezeAt = data.freezeAt === undefined ? event.freezeAt : data.freezeAt;
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new HttpError(400, 'BAD_REQUEST', 'The end time must be after the start time.');
  }
  if (freezeAt && endsAt && freezeAt > endsAt) {
    throw new HttpError(400, 'BAD_REQUEST', 'The scoreboard freeze must be before the end time.');
  }
  const freezeChanged = (freezeAt?.getTime() ?? null) !== (event.freezeAt?.getTime() ?? null);
  const saved = await save({
    name: data.name ?? event.name,
    startsAt,
    endsAt,
    freezeAt,
    // A new freeze time takes a new snapshot when it arrives; clearing it reveals the live board.
    ...(freezeChanged ? { frozenScoreboard: Prisma.DbNull } : {}),
  });
  if (freezeChanged) {
    if (isFrozen(saved)) await ensureFrozenSnapshot();
    else broadcast('scoreboard', await getPublicScoreboard());
  }
  return saved;
}

// --- scoreboard freeze ---------------------------------------------------------------

/** Frozen from freezeAt until the organizers clear it ("reveal"). */
export function isFrozen(event: Event): boolean {
  return event.freezeAt !== null && event.freezeAt.getTime() <= Date.now();
}

let snapshotting: Promise<void> | null = null;

/**
 * Captures the board once the freeze time arrives. Runs before any score change
 * after that time (see currentEvent) and from the ticker, so the snapshot holds
 * exactly the scores at the freeze.
 */
function ensureFrozenSnapshot(): Promise<void> {
  snapshotting ??= (async () => {
    const event = await getEvent();
    if (!isFrozen(event) || event.frozenScoreboard !== null) return;
    const frozen: Scoreboard = { ...(await getScoreboard()), frozenAt: event.freezeAt!.toISOString() };
    cachedEvent = await prisma.event.update({ where: { id: 1 }, data: { frozenScoreboard: frozen as unknown as Prisma.InputJsonValue } });
    broadcast('event', await publicEvent());
    broadcast('scoreboard', frozen);
    console.log('[event] scoreboard frozen.');
  })().finally(() => {
    snapshotting = null;
  });
  return snapshotting;
}

/** The scoreboard everyone sees: the frozen snapshot while frozen, otherwise live. */
export async function getPublicScoreboard(): Promise<Scoreboard> {
  const event = await currentEvent();
  if (isFrozen(event) && event.frozenScoreboard !== null) return event.frozenScoreboard as unknown as Scoreboard;
  return { ...(await getScoreboard()), frozenAt: null };
}

/** A crew's rank as everyone sees it (the frozen rank while frozen). */
export async function getPublicRank(userId: number): Promise<number | null> {
  const board = await getPublicScoreboard();
  return board.entries.find((entry) => entry.userId === userId)?.rank ?? null;
}

// Score changes during a freeze push nothing: the frozen board does not change.
setPushableBoard(async () => (isFrozen(await getEvent()) ? null : { ...(await getScoreboard()), frozenAt: null }));

const isPast = (date: Date | null) => date !== null && date.getTime() <= Date.now();

let scheduling: Promise<void> | null = null;

/**
 * Applies the schedule: starts an UPCOMING event at its start time and ends a LIVE
 * one at its end time. Concurrent callers share one run, so the switch happens once.
 */
function applySchedule(): Promise<void> {
  scheduling ??= runSchedule().finally(() => {
    scheduling = null;
  });
  return scheduling;
}

async function runSchedule(): Promise<void> {
  const event = await getEvent();
  if (event.state === 'UPCOMING' && isPast(event.startsAt) && !isPast(event.endsAt)) {
    await applyEventAction('start');
    console.log('[event] scheduled start time reached — CTF is live.');
  } else if (event.state === 'LIVE' && isPast(event.endsAt)) {
    await applyEventAction('end');
    console.log('[event] scheduled end time reached — CTF ended.');
  }
  const latest = await getEvent();
  if (isFrozen(latest) && latest.frozenScoreboard === null) await ensureFrozenSnapshot();
}

/** Checks the schedule every few seconds (score-changing actions also check it themselves). */
export function startEventTicker(): NodeJS.Timeout {
  const timer = setInterval(() => {
    applySchedule().catch((error) => console.error('[event] ticker failed', error));
  }, 5000);
  timer.unref();
  return timer;
}

/**
 * The event with its schedule applied right now: a request arriving between the
 * scheduled time and the next tick still sees the correct state (no flag is ever
 * accepted after the end time, and challenges open exactly at the start time).
 */
export async function currentEvent(): Promise<Event> {
  const event = await getEvent();
  const due = (event.state === 'LIVE' && isPast(event.endsAt)) || (event.state === 'UPCOMING' && isPast(event.startsAt) && !isPast(event.endsAt));
  if (due) await applySchedule();
  // Before any score change after the freeze time, the frozen board is captured.
  if (isFrozen(event) && event.frozenScoreboard === null) await ensureFrozenSnapshot();
  return getEvent();
}

/** Guards participant actions that change scores. Admins are exempt (testing). */
export async function assertEventLive(): Promise<void> {
  const event = await currentEvent();
  if (event.state === 'LIVE') return;
  const reason: Record<Exclude<EventState, 'LIVE'>, string> = {
    UPCOMING: 'The voyage has not begun yet. Flag submission opens when the CTF goes live.',
    PAUSED: 'The CTF is paused. Flag submission is temporarily disabled.',
    ENDED: 'The CTF has ended. Flag submission is closed.',
  };
  throw new HttpError(403, `EVENT_${event.state}`, reason[event.state]);
}
