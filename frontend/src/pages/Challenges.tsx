import { motion } from 'framer-motion';
import { Check, Dumbbell, EyeOff, Lock, Map as MapIcon, Skull, Swords, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChallengeSheet } from '../components/ChallengeSheet';
import { BigCountdown, DifficultyChip, EmptyState, ErrorNote, Page, PageHeader, Spinner } from '../components/ui';
import { useLive } from '../context/LiveContext';
import { useApi } from '../hooks/useApi';
import { Container } from '../layouts/Shell';
import type { ChallengeCard } from '../services/types';

/** A challenge drawn as a wanted poster: the bounty is the point value. */
function Poster({ challenge, index, onOpen }: { challenge: ChallengeCard; index: number; onOpen: () => void }) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 22, rotate: -1.2 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.5) }}
      whileHover={{ y: -5 }}
      className="list-none"
    >
      <article className={`parchment flex h-full flex-col p-5 ${challenge.solved ? 'saturate-[0.85]' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.28em] text-ink-500">{challenge.category.name}</p>
          {!challenge.enabled && (
            <span className="chip border-ink-900/50 bg-ink-900/10 text-ink-700">
              <EyeOff className="h-3 w-3" aria-hidden="true" /> Disabled
            </span>
          )}
        </div>

        <h3 className="mt-2 flex items-start gap-2 text-xl font-black uppercase leading-tight tracking-[0.04em] text-ink-900">
          <Skull className="mt-1 h-4 w-4 shrink-0 text-ink-700" aria-hidden="true" />
          <span className="break-words">{challenge.title}</span>
        </h3>

        <dl className="mt-4 space-y-1.5 text-sm text-ink-700">
          <div className="flex justify-between gap-3">
            <dt>Category</dt>
            <dd className="font-semibold text-ink-900">{challenge.category.name}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt>Difficulty</dt>
            <dd>
              <DifficultyChip difficulty={challenge.difficulty} />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Solves</dt>
            <dd className="tabular flex items-center gap-1.5 font-mono font-semibold text-ink-900">
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> {challenge.solves}
            </dd>
          </div>
          {challenge.firstBlood && (
            <div className="flex justify-between gap-3">
              <dt className="flex items-center gap-1.5">
                <Swords className="h-3.5 w-3.5 text-blood-400" aria-hidden="true" /> First blood
              </dt>
              <dd className="truncate font-semibold text-blood-400">{challenge.firstBlood}</dd>
            </div>
          )}
        </dl>

        <div className="mt-4 border-y-2 border-ink-900/40 py-2.5 text-center">
          <p className="font-display text-[10px] font-bold uppercase tracking-[0.4em] text-ink-500">{challenge.practice ? 'Training' : 'Bounty'}</p>
          {challenge.practice ? (
            <p className={`font-display text-xl font-black uppercase tracking-[0.2em] ${challenge.solved ? 'text-jade-500' : 'text-ink-900'}`}>Practice</p>
          ) : (
            <p className={`tabular font-display text-3xl font-black ${challenge.solved ? 'text-jade-500' : 'text-ink-900'}`}>
              {challenge.points}
              <span className="ml-1.5 text-sm font-bold tracking-[0.2em]">PTS</span>
            </p>
          )}
          {challenge.scoring === 'DYNAMIC' && (
            <p className="text-[11px] font-semibold text-ink-700" title="The value drops as more crews solve it — for every crew that solved it.">
              ↓ Drops as crews solve · min {challenge.minimumPoints}
            </p>
          )}
        </div>

        {/* Status is always stated in words and with an icon, not by colour alone. */}
        <p className="mt-3 flex items-center justify-center gap-2 font-display text-sm font-black uppercase tracking-[0.22em]">
          {challenge.solved ? (
            <>
              <span className="inline-flex -rotate-2 items-center gap-1.5 rounded border-2 border-jade-500 px-3 py-0.5 text-jade-500">
                <Check className="h-4 w-4" aria-hidden="true" /> Claimed
              </span>
              {challenge.solvedBy && <span className="text-xs normal-case tracking-normal text-ink-700">by {challenge.solvedBy}</span>}
            </>
          ) : (
            <span className="text-ink-700">Status: Unsolved</span>
          )}
        </p>

        <button type="button" className="btn-ink mt-4 w-full" onClick={onOpen} aria-label={`${challenge.solved ? 'View' : 'Board'} ${challenge.title}`}>
          {challenge.solved ? 'View challenge' : 'Board this challenge'}
        </button>
      </article>
    </motion.li>
  );
}

/**
 * The treasure map (competition challenges) or, with `practice`, the practice
 * grounds: practice challenges are open at any time and never scored.
 */
export default function Challenges({ practice = false }: { practice?: boolean }) {
  const { event, challengeVersion, me } = useLive();
  const navigate = useNavigate();
  const params = useParams();
  const openId = params.id && /^\d+$/.test(params.id) ? Number(params.id) : null;
  const base = practice ? '/practice' : '/challenges';

  const { data, error, loading, reload } = useApi<{ locked: boolean; challenges: ChallengeCard[] }>(practice ? '/practice' : '/challenges', [
    challengeVersion,
    event?.state,
    me?.solved,
  ]);
  const [category, setCategory] = useState<string>('all');
  const [hideSolved, setHideSolved] = useState(false);

  const challenges = useMemo(() => data?.challenges ?? [], [data]);
  const categories = useMemo(() => {
    const counts = new Map<string, { name: string; total: number; solved: number }>();
    for (const challenge of challenges) {
      const entry = counts.get(challenge.category.slug) ?? { name: challenge.category.name, total: 0, solved: 0 };
      entry.total += 1;
      if (challenge.solved) entry.solved += 1;
      counts.set(challenge.category.slug, entry);
    }
    return [...counts.entries()];
  }, [challenges]);

  const visible = challenges.filter((challenge) => (category === 'all' || challenge.category.slug === category) && !(hideSolved && challenge.solved));
  const solvedCount = challenges.filter((challenge) => challenge.solved).length;

  const tab = (key: string, label: string, count: string) => (
    <button
      key={key}
      type="button"
      role="tab"
      aria-selected={category === key}
      onClick={() => setCategory(key)}
      className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition ${
        category === key ? 'border-accent-400 bg-accent-500/15 text-accent-100' : 'border-navy-500 bg-navy-900/60 text-slate-300 hover:border-ocean-400 hover:text-white'
      }`}
    >
      {label}
      <span className="tabular rounded-full bg-navy-950/80 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">{count}</span>
    </button>
  );

  return (
    <Page>
      <Container>
        <PageHeader
          title={practice ? 'Practice Grounds' : 'Treasure Map'}
          subtitle={
            practice
              ? `Practice — open any time, no points · ${solvedCount} of ${challenges.length} cracked`
              : data && !data.locked
                ? `Challenges — ${solvedCount} of ${challenges.length} claimed`
                : 'Challenges'
          }
          icon={practice ? <Dumbbell className="h-5 w-5" aria-hidden="true" /> : <MapIcon className="h-5 w-5" aria-hidden="true" />}
          actions={
            data &&
            !data.locked &&
            challenges.length > 0 && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" className="h-4 w-4 rounded border-navy-500 bg-navy-950 accent-accent-400" checked={hideSolved} onChange={(event) => setHideSolved(event.target.checked)} />
                Hide claimed
              </label>
            )
          }
        />

        {loading && !data ? (
          <Spinner label="Unrolling the map…" />
        ) : error && !data ? (
          <ErrorNote message={error.message} onRetry={reload} />
        ) : data?.locked ? (
          <div className="panel flex flex-col items-center gap-6 px-6 py-16 text-center">
            <Lock className="h-12 w-12 text-accent-400/80" aria-hidden="true" />
            <div>
              <h2 className="text-2xl font-black uppercase tracking-[0.1em] text-slate-100">The map is sealed</h2>
              <p className="mt-2 text-sm text-slate-400">Challenges are revealed the moment the CTF goes live. This page updates by itself.</p>
            </div>
            <BigCountdown />
          </div>
        ) : challenges.length === 0 ? (
          <EmptyState
            icon={<MapIcon className="h-10 w-10" aria-hidden="true" />}
            title={practice ? 'No practice challenges yet.' : 'No treasure has been discovered here yet.'}
            hint={practice ? 'The organizers have not added any practice challenges.' : 'The organizers have not released any challenges.'}
          />
        ) : (
          <>
            {practice && (
              <p className="panel mb-6 px-5 py-4 text-sm text-slate-300">
                Warm up before the real voyage. Practice challenges are open at any time — before, during and after the CTF — and give no points, so
                they never change the scoreboard. Hints here are free.
              </p>
            )}
            <div role="tablist" aria-label="Challenge categories" className="mb-6 flex gap-2 overflow-x-auto pb-2">
              {tab('all', 'All', `${solvedCount}/${challenges.length}`)}
              {categories.map(([slug, info]) => tab(slug, info.name, `${info.solved}/${info.total}`))}
            </div>

            {visible.length === 0 ? (
              <EmptyState icon={<MapIcon className="h-10 w-10" aria-hidden="true" />} title="No treasure has been discovered here yet." hint="Nothing matches this filter." />
            ) : (
              <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visible.map((challenge, index) => (
                  <Poster key={challenge.id} challenge={challenge} index={index} onOpen={() => navigate(`${base}/${challenge.id}`)} />
                ))}
              </ul>
            )}
          </>
        )}
      </Container>

      <ChallengeSheet challengeId={openId} onClose={() => navigate(base)} onChanged={reload} />
    </Page>
  );
}
