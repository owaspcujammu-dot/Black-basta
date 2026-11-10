import { motion } from 'framer-motion';
import { Crown, LineChart, Radio, Snowflake, Trophy, Waves } from 'lucide-react';
import { PlayerChips } from '../components/Players';
import { ScoreGraph } from '../components/ScoreGraph';
import { EmptyState, Page, PageHeader, Spinner } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';
import { useServerNow } from '../hooks/useCountdown';
import { Container } from '../layouts/Shell';
import type { ScoreboardEntry } from '../services/types';
import { dateTime, timeAgo } from '../utils/format';

const PLACE_BADGE = ['border-accent-300 bg-accent-500 text-white', 'border-slate-300 bg-slate-200 text-navy-950', 'border-slate-500 bg-navy-700 text-slate-100'];

/** 1 / 2 / 3 place marker (decorative: the rank is always written out as text too). */
function PlaceBadge({ place, large = false }: { place: number; large?: boolean }) {
  return (
    <span aria-hidden="true" className={`inline-grid place-items-center rounded-full border-2 font-display font-black ${large ? 'h-12 w-12 text-xl' : 'mr-2 h-6 w-6 align-middle text-xs'} ${PLACE_BADGE[place - 1]}`}>
      {place}
    </span>
  );
}
const PODIUM_STYLE = [
  'border-accent-400/70 shadow-glow md:order-2 md:-translate-y-4',
  'border-slate-300/50 md:order-1',
  'border-slate-600/70 md:order-3',
];

function Podium({ entries, selfId, me }: { entries: ScoreboardEntry[]; selfId: number | null; me: string | null }) {
  return (
    <ol className="mb-8 grid gap-4 md:grid-cols-3" aria-label="Top three pirates">
      {entries.map((entry, index) => (
        <motion.li
          key={entry.userId}
          layout
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: index * 0.08 }}
          className={`panel list-none border-2 p-5 text-center ${PODIUM_STYLE[index]}`}
        >
          <p className="flex justify-center">
            <PlaceBadge place={index + 1} large />
          </p>
          <p className="sr-only">Rank {entry.rank}</p>
          <p className="mt-2 flex items-center justify-center gap-2 break-all text-xl font-black text-slate-50">
            {index === 0 && <Crown className="h-5 w-5 shrink-0 text-accent-300" aria-hidden="true" />}
            {entry.username}
            {entry.userId === selfId && <span className="chip border-accent-400/60 bg-accent-500/15 text-accent-200">You</span>}
          </p>
          <p className="mt-0.5 font-display text-[11px] font-bold uppercase tracking-[0.24em] text-ocean-200">{entry.title}</p>
          <p className="tabular mt-3 font-mono text-sm text-slate-300">{entry.solved} solved</p>
          <p className="tabular font-display text-3xl font-black text-accent-gradient">{entry.score} pts</p>
          <PlayerChips players={entry.players} highlight={entry.userId === selfId ? me : null} className="mt-3 justify-center" />
        </motion.li>
      ))}
    </ol>
  );
}

export default function Scoreboard() {
  const { user } = useAuth();
  const { scoreboard, connected, event } = useLive();
  const now = useServerNow();
  const selfId = user?.role === 'participant' ? user.id : null;
  const me = user?.player ?? null;

  const entries = scoreboard?.entries ?? [];
  const scored = entries.filter((entry) => entry.score > 0);
  const podium = scored.slice(0, 3);

  return (
    <Page>
      <Container>
        <PageHeader
          title="Grand Line Leaderboard"
          subtitle="Scoreboard — higher bounty ranks higher; ties go to whoever reached the score first"
          icon={<Trophy className="h-5 w-5" aria-hidden="true" />}
          actions={
            scoreboard?.frozenAt ? (
              <span className="chip border-ocean-300/50 bg-ocean-500/10 text-ocean-200" role="status">
                <Snowflake className="h-3 w-3" aria-hidden="true" /> Frozen
              </span>
            ) : (
              <span className={`chip ${connected ? 'border-jade-400/50 bg-jade-500/10 text-jade-300' : 'border-accent-400/50 bg-accent-500/10 text-accent-300'}`} role="status">
                <Radio className="h-3 w-3" aria-hidden="true" /> {connected ? 'Live' : 'Reconnecting…'}
              </span>
            )
          }
        />

        {scoreboard?.frozenAt && (
          <div className="panel mb-6 flex items-start gap-3 border-ocean-300/30 px-5 py-4 text-sm" role="note">
            <Snowflake className="mt-0.5 h-5 w-5 shrink-0 text-ocean-200" aria-hidden="true" />
            <div>
              <p className="font-semibold text-slate-100">The scoreboard is frozen as of {dateTime(scoreboard.frozenAt)}.</p>
              <p className="mt-0.5 text-slate-400">
                Flags still count, but the standings below no longer change. The final results will be revealed by the organizers.
                {selfId !== null && " Your own up-to-date bounty is on your Captain's Deck."}
              </p>
            </div>
          </div>
        )}

        {!scoreboard ? (
          <Spinner label="Counting the bounties…" />
        ) : entries.length === 0 ? (
          <EmptyState icon={<Waves className="h-10 w-10" aria-hidden="true" />} title="The Grand Line is waiting for its first pirates..." hint="Register and claim a treasure to put your name on the board." />
        ) : (
          <>
            {podium.length > 0 ? (
              <Podium entries={podium} selfId={selfId} me={me} />
            ) : (
              <p className="panel mb-6 px-5 py-4 text-center text-sm text-slate-300">
                The Grand Line is waiting for its first pirates... {event?.state === 'LIVE' ? 'No treasure has been claimed yet.' : 'Bounties appear once the voyage begins.'}
              </p>
            )}

            {scored.length > 0 && (
              <section className="panel mb-6 p-5" aria-labelledby="graph-heading">
                <h2 id="graph-heading" className="panel-title mb-3 flex items-center gap-2">
                  <LineChart className="h-4 w-4" aria-hidden="true" /> Bounty over time — top crews{scoreboard.frozenAt && ' (until the freeze)'}
                </h2>
                {/* Refetched at most every 15 s while scores are changing. */}
                <ScoreGraph refreshKey={Math.floor(Date.parse(scoreboard.generatedAt) / 15_000)} />
              </section>
            )}

            <div className="panel overflow-x-auto">
              <table className="table-kop min-w-[40rem]">
                <caption className="sr-only">Leaderboard: rank, pirate with points per player, challenges solved, score and time of last capture</caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-28">
                      Rank
                    </th>
                    <th scope="col">Pirate</th>
                    <th scope="col" className="text-right">
                      Solved
                    </th>
                    <th scope="col" className="text-right">
                      Score
                    </th>
                    <th scope="col" className="text-right">
                      Last Capture
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const self = entry.userId === selfId;
                    return (
                      // `layout` animates rows to their new position when ranks change.
                      <motion.tr
                        key={entry.userId}
                        layout
                        transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                        className={self ? 'bg-accent-500/10 outline outline-1 -outline-offset-1 outline-accent-400/60' : 'hover:bg-navy-800/50'}
                        aria-current={self ? 'true' : undefined}
                      >
                        <td className="tabular whitespace-nowrap font-mono font-bold text-slate-100">
                          {entry.score > 0 && entry.rank <= 3 && <PlaceBadge place={entry.rank} />}#{entry.rank}
                        </td>
                        <td>
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <span className="break-all font-semibold text-slate-50">{entry.username}</span>
                            {self && <span className="chip border-accent-400/60 bg-accent-500/15 text-accent-200">You</span>}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-400">
                            {entry.title}
                            {entry.teamName && entry.teamName !== entry.username && <> · {entry.teamName}</>}
                          </div>
                          <PlayerChips players={entry.players} highlight={self ? me : null} className="mt-1.5" />
                        </td>
                        <td className="tabular text-right font-mono text-slate-200">{entry.solved}</td>
                        <td className="tabular text-right font-mono text-base font-bold text-accent-200">{entry.score}</td>
                        <td className="text-right text-slate-400">{timeAgo(entry.lastCapture, now)}</td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Container>
    </Page>
  );
}
