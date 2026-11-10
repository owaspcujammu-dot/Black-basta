import { motion } from 'framer-motion';
import { Coins, Compass, Crosshair, Crown, Lock, Sailboat, Swords, Target, Trophy, User as UserIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CrewPanel } from '../components/Players';
import { DifficultyChip, EmptyState, ErrorNote, Page, PageHeader, Spinner, StatCard } from '../components/ui';
import { useLive } from '../context/LiveContext';
import { useApi } from '../hooks/useApi';
import { Container } from '../layouts/Shell';
import type { Profile as ProfileData } from '../services/types';
import { dateTime, pirateNumber } from '../utils/format';

const ACHIEVEMENT_ICONS: Record<string, ReactNode> = {
  sailboat: <Sailboat className="h-7 w-7" aria-hidden="true" />,
  swords: <Swords className="h-7 w-7" aria-hidden="true" />,
  coins: <Coins className="h-7 w-7" aria-hidden="true" />,
  compass: <Compass className="h-7 w-7" aria-hidden="true" />,
  crown: <Crown className="h-7 w-7" aria-hidden="true" />,
};

export default function Profile() {
  const { me, event } = useLive();
  const { data, error, loading, reload } = useApi<{ profile: ProfileData }>('/profile', [me?.score, me?.solved, event?.state]);

  if (loading && !data) return <Spinner label="Fetching your wanted poster…" />;
  if (error && !data)
    return (
      <Container>
        <ErrorNote message={error.message} onRetry={reload} />
      </Container>
    );
  if (!data) return null;

  const profile = data.profile;
  const rank = me?.rank ?? profile.rank;
  const isParticipant = profile.role === 'participant';

  return (
    <Page>
      <Container>
        <PageHeader title="Pirate Profile" subtitle="Profile — your record on the Grand Line" icon={<UserIcon className="h-5 w-5" aria-hidden="true" />} />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          {/* Wanted poster */}
          <section className="parchment self-start p-6 text-center" aria-label="Pirate">
            <p className="font-display text-2xl font-black uppercase tracking-[0.3em] text-ink-900">Wanted</p>
            <div className="mx-auto mt-4 grid h-32 w-32 place-items-center rounded border-2 border-ink-900/60 bg-parchment-300/60 font-display text-6xl font-black text-ink-700" aria-hidden="true">
              {profile.username.charAt(0).toUpperCase()}
            </div>
            <h2 className="mt-4 break-words text-2xl font-black text-ink-900">{profile.username}</h2>
            <p className="text-sm text-ink-700">{profile.fullName}</p>
            {profile.teamName && profile.teamName !== profile.username && <p className="mt-1 text-sm font-semibold text-ink-700">Crew: {profile.teamName}</p>}
            {profile.members.length > 0 && (
              <ul className="mt-2 flex flex-wrap justify-center gap-1.5" aria-label="Team members">
                {profile.members.map((member) => (
                  <li key={member} className="chip border-ink-900/40 bg-ink-900/[0.06] text-ink-700">
                    {member}
                  </li>
                ))}
              </ul>
            )}
            <p className="tabular mt-1 font-mono text-xs text-ink-500">{isParticipant ? `Pirate ${pirateNumber(profile.participantNumber)}` : 'Fleet Admiral (admin)'}</p>
            <div className="mt-5 border-y-2 border-ink-900/40 py-3">
              <p className="font-display text-[10px] font-bold uppercase tracking-[0.4em] text-ink-500">Bounty</p>
              <p className="tabular font-display text-4xl font-black text-ink-900">{me?.score ?? profile.score}</p>
            </div>
            <p className="mt-4 font-display text-xs font-bold uppercase tracking-[0.3em] text-blood-400">{me?.title ?? 'Deckhand'}</p>
          </section>

          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              <StatCard label="Pirate Rank" value={isParticipant ? `#${rank ?? '—'}` : '—'} icon={<Trophy className="h-5 w-5" aria-hidden="true" />} />
              <StatCard label="Score" value={me?.score ?? profile.score} hint={profile.hintSpend > 0 ? `${profile.hintSpend} spent on hints` : 'Bounty'} icon={<Coins className="h-5 w-5" aria-hidden="true" />} />
              <StatCard
                label="Challenges Solved"
                value={profile.solved}
                hint={profile.totalChallenges > 0 ? `of ${profile.totalChallenges}` : undefined}
                icon={<Target className="h-5 w-5" aria-hidden="true" />}
              />
              <StatCard
                label="Accuracy"
                value={profile.accuracy === null ? '—' : `${profile.accuracy}%`}
                hint={`${profile.submissions} submission${profile.submissions === 1 ? '' : 's'}`}
                icon={<Crosshair className="h-5 w-5" aria-hidden="true" />}
              />
              <StatCard label="First Bloods" value={profile.firstBloods} icon={<Swords className="h-5 w-5" aria-hidden="true" />} />
              <StatCard label="Pirate Name" value={<span className="break-all text-xl">{profile.username}</span>} hint={profile.email.endsWith('@teams.blackbasta.local') ? undefined : profile.email} icon={<UserIcon className="h-5 w-5" aria-hidden="true" />} />
            </div>

            {/* Achievements */}
            <section className="panel p-6" aria-label="Achievements">
              <h2 className="panel-title">Achievements</h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {profile.achievements.map((achievement, index) => (
                  <motion.li
                    key={achievement.code}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className={`flex gap-3 rounded-lg border p-4 ${achievement.earned ? 'border-accent-400/60 bg-accent-500/10' : 'border-navy-600 bg-navy-950/50'}`}
                  >
                    <span className={`shrink-0 ${achievement.earned ? 'text-accent-300' : 'text-slate-600'}`}>{ACHIEVEMENT_ICONS[achievement.icon] ?? <Trophy className="h-7 w-7" aria-hidden="true" />}</span>
                    <div className="min-w-0">
                      <p className={`font-sans text-sm font-bold ${achievement.earned ? 'text-accent-100' : 'text-slate-400'}`}>{achievement.name}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{achievement.description}</p>
                      <p className={`mt-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] ${achievement.earned ? 'text-jade-300' : 'text-slate-500'}`}>
                        {achievement.earned ? (
                          <>Earned · {dateTime(achievement.awardedAt)}</>
                        ) : (
                          <>
                            <Lock className="h-3 w-3" aria-hidden="true" /> Locked
                          </>
                        )}
                      </p>
                    </div>
                  </motion.li>
                ))}
              </ul>
            </section>

            {isParticipant && profile.players.length > 0 && <CrewPanel players={profile.players} me={profile.player} title="Crew — points per player" />}

            {/* Solve log */}
            <section className="panel p-6" aria-label="Solved challenges">
              <h2 className="panel-title">Captain's Log — Treasure Claimed</h2>
              {profile.solves.length === 0 ? (
                <div className="mt-4">
                  <EmptyState icon={<Target className="h-8 w-8" aria-hidden="true" />} title="No treasure claimed yet." hint="Your solved challenges will be listed here." />
                </div>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="table-kop min-w-[34rem]">
                    <thead>
                      <tr>
                        <th scope="col">Challenge</th>
                        <th scope="col">Category</th>
                        <th scope="col">Difficulty</th>
                        <th scope="col">Claimed by</th>
                        <th scope="col" className="text-right">
                          Bounty
                        </th>
                        <th scope="col" className="text-right">
                          Solved
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.solves.map((solve) => (
                        <tr key={solve.challengeId}>
                          <td>
                            <Link to={`/challenges/${solve.challengeId}`} className="rounded font-semibold text-slate-100 hover:text-accent-200">
                              {solve.title}
                            </Link>
                            {solve.firstBlood && (
                              <span className="ml-2 inline-flex items-center gap-1 text-xs font-bold text-blood-300">
                                <Swords className="h-3 w-3" aria-hidden="true" /> First blood
                              </span>
                            )}
                          </td>
                          <td className="text-slate-300">{solve.category}</td>
                          <td>
                            <DifficultyChip difficulty={solve.difficulty} />
                          </td>
                          <td className="text-slate-300">{solve.solvedBy ?? '—'}</td>
                          <td className="tabular text-right font-mono font-bold text-accent-200">+{solve.points}</td>
                          <td className="text-right text-slate-400">{dateTime(solve.solvedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      </Container>
    </Page>
  );
}
