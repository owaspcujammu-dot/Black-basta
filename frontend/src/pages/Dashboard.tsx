import { motion } from 'framer-motion';
import { Coins, Flag, Map as MapIcon, Megaphone, Swords, Timer, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CrewPanel } from '../components/Players';
import { EmptyState, ErrorNote, EventBadge, MiniClock, Modal, Page, PageHeader, ProgressBar, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';
import { useApi } from '../hooks/useApi';
import { useEventCountdown } from '../hooks/useCountdown';
import { Container } from '../layouts/Shell';
import type { Announcement, Profile } from '../services/types';
import { dateTime, pad, pirateNumber, timeAgo } from '../utils/format';

const STATE_TEXT = {
  UPCOMING: 'The voyage has not begun. Challenges unlock when the CTF goes live.',
  LIVE: 'The CTF is live. Flag submission is open.',
  PAUSED: 'The CTF is paused. You can look around, but flags cannot be submitted.',
  ENDED: 'The CTF has ended. The leaderboard is final.',
} as const;

function WelcomeDialog() {
  const { welcome, dismissWelcome, user } = useAuth();
  return (
    <Modal open={Boolean(welcome)} onClose={dismissWelcome} title="Welcome aboard" tone="parchment">
      {welcome && (
        <div className="text-center">
          <p className="text-base text-ink-700">Your name is in the ship's log, {user?.username}.</p>
          <p className="tabular mt-5 font-display text-4xl font-black text-ink-900">
            Pirate #{pad(welcome.participantNumber, 3)} <span className="text-ink-500">/ {welcome.maxParticipants}</span>
          </p>
          <p className="mt-4 text-sm text-ink-700">Read the rules, study the map, and claim your first treasure.</p>
          <button type="button" className="btn-ink mt-7" onClick={dismissWelcome}>
            To the deck
          </button>
        </div>
      )}
    </Modal>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { event, me, announcementVersion } = useLive();
  const countdown = useEventCountdown();
  // Refetch when the pirate's own score moves (a solve, a hint, an admin re-score).
  const profile = useApi<{ profile: Profile }>('/profile', [me?.score, me?.solved, event?.state]);
  const announcements = useApi<{ announcements: Announcement[] }>('/announcements', [announcementVersion]);

  if (!user || !event) return <Spinner />;
  const data = profile.data?.profile;
  const score = me?.score ?? user.score;
  const rank = me?.rank ?? user.rank;
  const solved = me?.solved ?? user.solved;

  return (
    <Page>
      <WelcomeDialog />
      <Container>
        <PageHeader title="Captain's Deck" subtitle="Dashboard — your voyage at a glance" icon={<Flag className="h-5 w-5" aria-hidden="true" />} />

        <div className="grid gap-5 lg:grid-cols-3">
          {/* Player card */}
          <section className="parchment p-6 lg:row-span-2" aria-label="Player card">
            <p className="text-center font-display text-xs font-bold uppercase tracking-[0.4em] text-ink-500">Pirate</p>
            <h2 className="mt-1 break-words text-center text-3xl font-black text-ink-900">{user.username}</h2>
            <p className="tabular mt-1 text-center font-mono text-sm text-ink-700">
              {user.role === 'participant' ? `Pirate ${pirateNumber(user.participantNumber)} / ${event.maxParticipants}` : 'Fleet Admiral (admin)'}
            </p>
            {user.teamName && user.teamName !== user.username && <p className="mt-1 text-center text-sm font-semibold text-ink-700">Crew: {user.teamName}</p>}
            {user.player && (
              <p className="mt-1 text-center text-sm font-semibold text-ink-700">
                Playing as <span className="text-blood-500">{user.player}</span>
              </p>
            )}

            <dl className="mt-6 divide-y divide-ink-900/20 border-y-2 border-ink-900/40">
              {[
                ['Pirate Name', user.username],
                ['Rank', user.role === 'participant' ? `#${rank ?? '—'}` : '—'],
                ['Score', String(score)],
                ['Solved', String(solved)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-4 py-3">
                  <dt className="font-display text-xs font-bold uppercase tracking-[0.2em] text-ink-500">{label}</dt>
                  <dd className="tabular truncate font-mono text-lg font-bold text-ink-900">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-center font-display text-xs font-bold uppercase tracking-[0.3em] text-blood-400">{me?.title ?? 'Deckhand'}</p>
            <Link to="/challenges" className="btn-ink mt-5 w-full">
              <MapIcon className="h-4 w-4" aria-hidden="true" /> Open the Treasure Map
            </Link>
          </section>

          {/* Event status */}
          <section className="panel p-6" aria-label="Event status">
            <div className="flex items-center justify-between">
              <span className="panel-title">Event Status</span>
              <Timer className="h-5 w-5 text-accent-400/80" aria-hidden="true" />
            </div>
            <div className="mt-4">
              <EventBadge state={event.state} />
            </div>
            <p className="mt-2 text-sm text-slate-400">{STATE_TEXT[event.state]}</p>
            <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.22em] text-ocean-200">{countdown.label}</p>
            <MiniClock className="mt-1 block text-4xl font-bold text-accent-200" />
          </section>

          {/* Rank + score */}
          <section className="panel p-6" aria-label="Current rank">
            <div className="flex items-center justify-between">
              <span className="panel-title">Current Rank</span>
              <Trophy className="h-5 w-5 text-accent-400/80" aria-hidden="true" />
            </div>
            <motion.p key={rank ?? 'none'} initial={{ scale: 1.25, opacity: 0.4 }} animate={{ scale: 1, opacity: 1 }} className="tabular mt-3 w-fit origin-left font-display text-6xl font-black text-accent-gradient">
              #{user.role === 'participant' ? (rank ?? '—') : '—'}
            </motion.p>
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-300">
              <Coins className="h-4 w-4 text-accent-300" aria-hidden="true" />
              <span className="tabular font-mono font-bold text-accent-200">{score}</span> bounty
            </p>
          </section>

          {/* Progress */}
          <section className="panel p-6 lg:col-span-2" aria-label="Progress">
            <span className="panel-title">Progress</span>
            <div className="mt-4">
              {data ? (
                data.totalChallenges > 0 ? (
                  <ProgressBar value={Math.min(data.solved, data.totalChallenges)} max={data.totalChallenges} label="Challenges Solved" />
                ) : (
                  <p className="text-sm text-slate-400">Challenges will appear here once the voyage begins.</p>
                )
              ) : profile.error ? (
                <ErrorNote message={profile.error.message} onRetry={profile.reload} />
              ) : (
                <Spinner label="Reading the log…" />
              )}
            </div>
            {data && (
              <dl className="mt-6 grid grid-cols-3 gap-4 text-center">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ocean-200">Accuracy</dt>
                  <dd className="tabular mt-1 font-mono text-xl font-bold text-slate-100">{data.accuracy === null ? '—' : `${data.accuracy}%`}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ocean-200">First Bloods</dt>
                  <dd className="tabular mt-1 font-mono text-xl font-bold text-slate-100">{data.firstBloods}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ocean-200">Submissions</dt>
                  <dd className="tabular mt-1 font-mono text-xl font-bold text-slate-100">{data.submissions}</dd>
                </div>
              </dl>
            )}
          </section>
        </div>

        {user.role === 'participant' && data && data.players.length > 0 && (
          <div className="mt-5">
            <CrewPanel players={data.players} me={user.player} title="Your Crew — points per player" />
          </div>
        )}

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {/* Announcements */}
          <section className="panel p-6" aria-label="Announcements">
            <div className="mb-4 flex items-center justify-between">
              <span className="panel-title">Messages from the Captain</span>
              <Megaphone className="h-5 w-5 text-accent-400/80" aria-hidden="true" />
            </div>
            {announcements.loading && !announcements.data ? (
              <Spinner label="Unrolling the scrolls…" />
            ) : announcements.error ? (
              <ErrorNote message={announcements.error.message} onRetry={announcements.reload} />
            ) : announcements.data && announcements.data.announcements.length > 0 ? (
              <ul className="max-h-96 space-y-3 overflow-y-auto pr-1">
                {announcements.data.announcements.map((item) => (
                  <li key={item.id} className="rounded-lg border border-navy-600 bg-navy-950/60 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-sans text-sm font-bold tracking-normal text-accent-200">📢 {item.title}</h3>
                      <time dateTime={item.createdAt} className="text-xs text-slate-500">
                        {dateTime(item.createdAt)}
                      </time>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300">{item.message}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Megaphone className="h-8 w-8" aria-hidden="true" />} title="No messages from the captain." />
            )}
          </section>

          {/* Recent solves */}
          <section className="panel p-6" aria-label="Recent treasure">
            <div className="mb-4 flex items-center justify-between">
              <span className="panel-title">Treasure Claimed</span>
              <Coins className="h-5 w-5 text-accent-400/80" aria-hidden="true" />
            </div>
            {data && data.solves.length > 0 ? (
              <ul className="max-h-96 divide-y divide-navy-700 overflow-y-auto pr-1">
                {data.solves.slice(0, 8).map((solve) => (
                  <li key={solve.challengeId} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <Link to={`/challenges/${solve.challengeId}`} className="block truncate rounded text-sm font-semibold text-slate-100 hover:text-accent-200">
                        {solve.title}
                      </Link>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                        {solve.category} · {timeAgo(solve.solvedAt)}
                        {solve.solvedBy && <> · by {solve.solvedBy}</>}
                        {solve.firstBlood && (
                          <span className="inline-flex items-center gap-1 font-bold text-blood-300">
                            <Swords className="h-3 w-3" aria-hidden="true" /> First blood
                          </span>
                        )}
                      </p>
                    </div>
                    <span className="tabular shrink-0 font-mono text-sm font-bold text-accent-200">+{solve.points}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<MapIcon className="h-8 w-8" aria-hidden="true" />} title="No treasure claimed yet." hint="Solve a challenge and it will be logged here." />
            )}
          </section>
        </div>
      </Container>
    </Page>
  );
}
