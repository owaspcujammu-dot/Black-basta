import { Swords, Users } from 'lucide-react';
import type { PlayerScore } from '../services/types';

/** Compact "Luffy 300 · Zoro 150" list of a team's players, for leaderboard rows. */
export function PlayerChips({ players, highlight, className = '' }: { players: PlayerScore[]; highlight?: string | null; className?: string }) {
  if (players.length === 0) return null;
  const me = highlight?.toLowerCase();
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`} aria-label="Points per player">
      {players.map((player) => {
        const self = player.name.toLowerCase() === me;
        return (
          <li
            key={player.name}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] ${
              self ? 'border-accent-400/60 bg-accent-500/15 text-accent-100' : 'border-navy-600 bg-navy-900/60 text-slate-300'
            }`}
          >
            <span className="max-w-[9rem] truncate font-semibold">{player.name}</span>
            <span className="tabular font-mono text-slate-400">{player.score}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The team's players with their own points, as a ranked list with a share bar. */
export function CrewPanel({ players, me, title = 'Your Crew' }: { players: PlayerScore[]; me?: string | null; title?: string }) {
  const best = Math.max(1, ...players.map((player) => player.score));
  const mine = me?.toLowerCase();
  return (
    <section className="panel p-5" aria-labelledby="crew-heading">
      <h2 id="crew-heading" className="mb-4 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.2em] text-slate-200">
        <Users className="h-4 w-4 text-accent-300" aria-hidden="true" /> {title}
      </h2>
      {players.length === 0 ? (
        <p className="text-sm text-slate-400">No players listed yet. Each player's name is added when they log in.</p>
      ) : (
        <ol className="space-y-3">
          {players.map((player, index) => {
            const self = player.name.toLowerCase() === mine;
            return (
              <li key={player.name}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="tabular w-5 shrink-0 font-mono text-xs text-slate-500">{index + 1}.</span>
                    <span className={`truncate font-semibold ${self ? 'text-accent-200' : 'text-slate-100'}`}>{player.name}</span>
                    {self && (
                      <span className="chip shrink-0 border-accent-400/60 bg-accent-500/15 text-accent-200">
                        <Swords className="h-3 w-3" aria-hidden="true" /> You
                      </span>
                    )}
                  </span>
                  <span className="tabular shrink-0 font-mono text-slate-300">
                    <span className="font-bold text-accent-200">{player.score}</span> pts · {player.solved} solved
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-navy-800" aria-hidden="true">
                  <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.max(0, (player.score / best) * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
