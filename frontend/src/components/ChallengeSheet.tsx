import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import { Check, ChevronDown, Download, Dumbbell, Flag, Lightbulb, Lock, Paperclip, Swords, Users, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';
import { useToast } from '../context/ToastContext';
import { useApi } from '../hooks/useApi';
import { ApiError, api, errorMessage } from '../services/api';
import type { ChallengeDetail, ChallengeSolve, Hint, SubmitResult } from '../services/types';
import { dateTime, fileSize } from '../utils/format';
import { Linkify } from './Linkify';
import { ConfirmDialog, DifficultyChip, ErrorNote, Modal, Spinner } from './ui';

const COINS = Array.from({ length: 14 }, (_, index) => {
  const angle = (index / 14) * Math.PI * 2;
  return { x: Math.cos(angle) * (90 + (index % 3) * 28), y: Math.sin(angle) * (70 + (index % 4) * 18), delay: (index % 5) * 0.03 };
});

/** Crews that claimed this challenge, in order. Loaded only when opened. */
function SolverList({ challengeId, count, refreshKey }: { challengeId: number; count: number; refreshKey: unknown }) {
  const [open, setOpen] = useState(false);
  const { data, error, loading, reload } = useApi<{ total: number; solves: ChallengeSolve[] }>(open ? `/challenges/${challengeId}/solves` : null, [refreshKey]);
  useEffect(() => setOpen(false), [challengeId]);
  if (count === 0) return null;
  return (
    <section className="mt-6" aria-label="Crews who claimed this treasure">
      <button
        type="button"
        className="flex items-center gap-2 font-display text-xs font-bold uppercase tracking-[0.24em] text-ink-500 hover:text-ink-900"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Users className="h-3.5 w-3.5" aria-hidden="true" /> Claimed by {count} crew{count === 1 ? '' : 's'}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open &&
        (loading && !data ? (
          <Spinner label="Reading the log…" />
        ) : error && !data ? (
          <ErrorNote message={error.message} onRetry={reload} />
        ) : (
          data && (
            <ol className="mt-2 max-h-56 divide-y divide-ink-900/20 overflow-y-auto rounded-md border border-ink-900/40 bg-parchment-50/70 text-sm">
              {data.solves.map((solve, index) => (
                <li key={`${solve.username}-${solve.solvedAt}`} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="tabular w-6 shrink-0 font-mono text-xs text-ink-500">{index + 1}.</span>
                    <span className="truncate font-semibold text-ink-900">{solve.username}</span>
                    {solve.player && <span className="truncate text-xs text-ink-700">· {solve.player}</span>}
                    {solve.firstBlood && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-blood-400">
                        <Swords className="h-3 w-3" aria-hidden="true" /> First blood
                      </span>
                    )}
                  </span>
                  <time dateTime={solve.solvedAt} className="shrink-0 font-mono text-xs text-ink-700">
                    {dateTime(solve.solvedAt)}
                  </time>
                </li>
              ))}
              {data.total > data.solves.length && <li className="px-3 py-2 text-xs text-ink-700">…and {data.total - data.solves.length} more</li>}
            </ol>
          )
        ))}
    </section>
  );
}

/** The "TREASURE CLAIMED!" celebration shown over the sheet after a correct flag. */
function TreasureClaimed({ result, onDone }: { result: SubmitResult; onDone: () => void }) {
  return (
    <motion.div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center overflow-hidden rounded-lg bg-navy-950/95 p-6 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="status"
      aria-live="assertive"
    >
      <div className="pointer-events-none absolute left-1/2 top-[42%]" aria-hidden="true">
        {COINS.map((coin, index) => (
          <motion.span
            key={index}
            className="absolute h-3 w-3 rounded-full bg-gradient-to-b from-blood-300 to-accent-600"
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
            animate={{ x: coin.x, y: coin.y, opacity: [0, 1, 1, 0], scale: 1 }}
            transition={{ duration: 1.1, delay: 0.15 + coin.delay, ease: 'easeOut' }}
          />
        ))}
      </div>

      <motion.p initial={{ scale: 0.4, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }} className="text-6xl" aria-hidden="true">
        🏴‍☠️
      </motion.p>
      <motion.h3 initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }} className="mt-4 text-3xl font-black uppercase tracking-[0.12em] text-accent-gradient sm:text-4xl">
        Treasure Claimed!
      </motion.h3>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-2 text-base text-slate-200">
        You discovered the hidden treasure!
      </motion.p>

      <motion.p
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.45, type: 'spring', stiffness: 200, damping: 12 }}
        className="tabular mt-6 font-display text-5xl font-black text-accent-200"
      >
        +{result.pointsAwarded} POINTS
      </motion.p>

      {result.firstBlood && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }} className="mt-5 rounded-lg border border-blood-400/60 bg-blood-600/20 px-5 py-3">
          <p className="flex items-center justify-center gap-2 font-display text-lg font-black uppercase tracking-[0.2em] text-blood-300">
            <Swords className="h-5 w-5" aria-hidden="true" /> First Blood
          </p>
          {(result.firstBloodBonus ?? 0) > 0 && (
            <p className="tabular mt-1 font-mono text-sm text-slate-200">
              Challenge: {result.basePoints} pts · First blood bonus: +{result.firstBloodBonus} · Total: {result.pointsAwarded}
            </p>
          )}
        </motion.div>
      )}

      {result.achievements && result.achievements.length > 0 && (
        <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }} className="mt-5 flex flex-wrap justify-center gap-2">
          {result.achievements.map((achievement) => (
            <li key={achievement.code} className="chip border-accent-400/60 bg-accent-500/10 text-accent-200">
              Achievement: {achievement.name}
            </li>
          ))}
        </motion.ul>
      )}

      <button type="button" className="btn-accent mt-8" onClick={onDone} autoFocus>
        Continue the voyage
      </button>
    </motion.div>
  );
}

interface Props {
  challengeId: number | null;
  onClose: () => void;
  /** Called after anything that changes the list (a solve). */
  onChanged: () => void;
}

/** Challenge details, attachments, hints and flag submission, on a parchment sheet. */
export function ChallengeSheet({ challengeId, onClose, onChanged }: Props) {
  const { user, patchUser } = useAuth();
  const { event, challengeVersion } = useLive();
  const { toast } = useToast();
  const { data, error, loading, reload } = useApi<{ challenge: ChallengeDetail }>(challengeId === null ? null : `/challenges/${challengeId}`, [challengeVersion]);

  const [flag, setFlag] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<SubmitResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<SubmitResult | null>(null);
  const [hintToBuy, setHintToBuy] = useState<Hint | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const [rejections, setRejections] = useState(0);
  const shake = useAnimationControls();
  const flagInput = useRef<HTMLInputElement>(null);

  // A fresh sheet for every challenge.
  useEffect(() => {
    setFlag('');
    setWrong(null);
    setNotice(null);
    setClaimed(null);
    setHintToBuy(null);
  }, [challengeId]);

  const challenge = data && data.challenge.id === challengeId ? data.challenge : null;
  const isAdmin = user?.role === 'admin';
  const live = event?.state === 'LIVE';
  // Practice challenges take flags at any time.
  const canSubmit = isAdmin || live || Boolean(challenge?.practice);
  const flagFormat = event?.flagFormat ?? 'NIKA{...}';
  const prefix = flagFormat.split('{')[0];

  // After a wrong flag (once the input is enabled again): focus it with the text selected.
  useEffect(() => {
    if (rejections > 0) flagInput.current?.select();
  }, [rejections]);

  const onSubmit = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!challenge || !flag.trim()) return;
    setBusy(true);
    setWrong(null);
    setNotice(null);
    try {
      const result = await api.post<SubmitResult>(`/challenges/${challenge.id}/submit`, { flag });
      if (result.correct && result.test) {
        setNotice(result.message);
      } else if (result.correct && result.practice) {
        setNotice(result.message);
        setFlag('');
        reload();
        onChanged();
      } else if (result.correct && result.alreadySolved) {
        setNotice(result.message);
        reload();
      } else if (result.correct) {
        setClaimed(result);
        setFlag('');
        if (result.newScore !== undefined) patchUser({ score: result.newScore, solved: (user?.solved ?? 0) + 1 });
        reload();
        onChanged();
      } else {
        setWrong(result);
        // Wrong flag: keep it (to fix a typo) but select it, so typing replaces it.
        setRejections((count) => count + 1);
        void shake.start({ x: [0, -9, 9, -6, 6, 0], transition: { duration: 0.35 } });
      }
    } catch (err) {
      setNotice(null);
      setWrong({ correct: false, message: errorMessage(err) });
      if (err instanceof ApiError && err.status === 404) onChanged();
    } finally {
      setBusy(false);
    }
  };

  const revealHint = async (hint: Hint) => {
    if (!challenge) return;
    setHintBusy(true);
    try {
      const result = await api.post<{ hint: { charged: number; newScore: number | null } }>(`/challenges/${challenge.id}/hints/${hint.id}/unlock`);
      if (result.hint.newScore !== null) patchUser({ score: result.hint.newScore });
      if (result.hint.charged > 0) toast('info', 'Hint revealed', `-${result.hint.charged} bounty`);
      reload();
    } catch (err) {
      toast('error', 'Could not reveal the hint', errorMessage(err));
    } finally {
      setHintBusy(false);
      setHintToBuy(null);
    }
  };

  return (
    <>
      <Modal open={challengeId !== null} onClose={onClose} title={challenge?.title ?? 'Challenge'} wide tone="parchment">
        {!challenge ? (
          loading ? (
            <Spinner label="Opening the chest…" />
          ) : (
            <ErrorNote message={error?.status === 404 ? 'This challenge is not available.' : (error?.message ?? 'This challenge is not available.')} onRetry={reload} />
          )
        ) : (
          <div className="relative">
            <AnimatePresence>{claimed && <TreasureClaimed result={claimed} onDone={() => setClaimed(null)} />}</AnimatePresence>

            {/* Facts */}
            <dl className="grid grid-cols-2 gap-3 border-y-2 border-ink-900/30 py-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="font-display text-[10px] font-bold uppercase tracking-[0.24em] text-ink-500">Category</dt>
                <dd className="mt-1 font-semibold text-ink-900">{challenge.category.name}</dd>
              </div>
              <div>
                <dt className="font-display text-[10px] font-bold uppercase tracking-[0.24em] text-ink-500">Difficulty</dt>
                <dd className="mt-1">
                  <DifficultyChip difficulty={challenge.difficulty} />
                </dd>
              </div>
              <div>
                <dt className="font-display text-[10px] font-bold uppercase tracking-[0.24em] text-ink-500">Points</dt>
                <dd className="tabular mt-1 font-mono text-lg font-bold text-ink-900">
                  {challenge.practice ? <span className="font-sans text-base">Practice — none</span> : challenge.points}
                  {challenge.scoring === 'DYNAMIC' && (
                    <span className="block font-sans text-[11px] font-semibold leading-tight text-ink-700">
                      ↓ from {challenge.initialPoints}, min {challenge.minimumPoints}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-display text-[10px] font-bold uppercase tracking-[0.24em] text-ink-500">Solves</dt>
                <dd className="tabular mt-1 flex items-center gap-1.5 font-mono text-lg font-bold text-ink-900">
                  <Users className="h-4 w-4" aria-hidden="true" /> {challenge.solves}
                </dd>
              </div>
            </dl>

            {challenge.practice ? (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-700">
                <Dumbbell className="h-4 w-4" aria-hidden="true" /> Practice challenge — open any time, no points, never on the scoreboard. Hints are free.
              </p>
            ) : (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <Swords className="h-4 w-4 text-blood-400" aria-hidden="true" />
              {challenge.firstBlood ? (
                <span className="text-ink-900">
                  <strong className="text-blood-400">First blood:</strong> {challenge.firstBlood.username} · {dateTime(challenge.firstBlood.at)}
                  {challenge.firstBlood.bonus > 0 && <span className="text-ink-700"> · +{challenge.firstBlood.bonus} bonus</span>}
                </span>
              ) : (
                <span className="text-ink-700">
                  No first blood yet — be the first.
                  {(event?.firstBloodBonus ?? 0) > 0 && <strong className="text-blood-400"> +{event?.firstBloodBonus} bonus</strong>}
                </span>
              )}
            </p>
            )}

            {/* Description */}
            <section className="mt-5" aria-label="Description">
              <h3 className="font-display text-xs font-bold uppercase tracking-[0.24em] text-ink-500">Description</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-base leading-relaxed text-ink-900">
                <Linkify text={challenge.description} />
              </p>
            </section>

            <SolverList challengeId={challenge.id} count={challenge.solves} refreshKey={challengeVersion} />

            {/* Attachments */}
            {challenge.attachments.length > 0 && (
              <section className="mt-6" aria-label="Attachments">
                <h3 className="flex items-center gap-2 font-display text-xs font-bold uppercase tracking-[0.24em] text-ink-500">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden="true" /> Attachments
                </h3>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {challenge.attachments.map((file) => (
                    <li key={file.id}>
                      <a
                        href={`/api/challenges/${challenge.id}/attachments/${file.id}`}
                        download={file.name}
                        className="flex items-center justify-between gap-3 rounded-md border border-ink-900/40 bg-parchment-50/70 px-3 py-2 text-sm font-semibold text-ink-900 hover:bg-parchment-50"
                      >
                        <span className="min-w-0 truncate font-mono">{file.name}</span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-ink-700">
                          {fileSize(file.size)}
                          <Download className="h-4 w-4" aria-hidden="true" />
                          <span className="sr-only">Download</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Hints */}
            {challenge.hints.length > 0 && (
              <section className="mt-6" aria-label="Hints">
                <h3 className="flex items-center gap-2 font-display text-xs font-bold uppercase tracking-[0.24em] text-ink-500">
                  <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Hints
                </h3>
                <ul className="mt-2 space-y-2">
                  {challenge.hints.map((hint) => (
                    <li key={hint.id} className="rounded-md border border-ink-900/40 bg-parchment-50/70 px-3.5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-display text-xs font-bold uppercase tracking-[0.2em] text-ink-700">Hint {hint.number}</span>
                        {!hint.unlocked && (
                          <button type="button" className="btn-ink btn-sm" onClick={() => setHintToBuy(hint)} disabled={hintBusy || (!live && !isAdmin)}>
                            <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Reveal hint · Cost: -{hint.cost} points
                          </button>
                        )}
                      </div>
                      {hint.unlocked ? (
                        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-900">
                          <Linkify text={hint.content ?? ''} />
                        </p>
                      ) : (
                        <p className="mt-1.5 text-sm italic text-ink-500">Locked. Revealing it costs {hint.cost} bounty.</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Flag submission */}
            <section className="mt-7 rounded-lg border-2 border-ink-900/50 bg-ink-900/[0.06] p-4 sm:p-5" aria-label="Submit flag">
              <h3 className="flex items-center gap-2 font-display text-sm font-black uppercase tracking-[0.24em] text-ink-900">
                <Flag className="h-4 w-4" aria-hidden="true" /> Submit Flag
              </h3>

              {challenge.solved ? (
                <p className="mt-3 flex items-center gap-2 font-display text-lg font-black uppercase tracking-[0.16em] text-jade-500">
                  <Check className="h-5 w-5" aria-hidden="true" /> {challenge.practice ? 'Cracked in practice' : 'Treasure claimed'}
                  <span className="tabular font-mono text-base normal-case tracking-normal text-ink-700">
                    {challenge.practice ? 'no points' : `+${challenge.pointsAwarded} pts`}{challenge.solvedBy && <> · by {challenge.solvedBy}</>} · {dateTime(challenge.solvedAt)}
                  </span>
                </p>
              ) : (
                <form onSubmit={onSubmit} className="mt-3">
                  <label htmlFor="flag" className="sr-only">
                    Flag, in the format {flagFormat}
                  </label>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <motion.input
                      ref={flagInput}
                      id="flag"
                      animate={shake}
                      className="w-full rounded-md border-2 border-ink-900/60 bg-parchment-50 px-3.5 py-2.5 font-mono text-sm text-ink-900 placeholder:text-ink-500/70 disabled:opacity-60"
                      placeholder={`${prefix}{________________________}`}
                      value={flag}
                      onChange={(inputEvent) => setFlag(inputEvent.target.value)}
                      autoComplete="off"
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={500}
                      disabled={!canSubmit || busy}
                      aria-describedby="flag-feedback"
                    />
                    <button type="submit" className="btn-ink shrink-0 px-5" disabled={!canSubmit || busy || !flag.trim()}>
                      {busy ? 'Checking…' : 'Claim the Treasure'}
                    </button>
                  </div>

                  <div id="flag-feedback" aria-live="polite" className="mt-3 min-h-[1.5rem] text-sm">
                    {!canSubmit && event && (
                      <p className="flex items-center gap-2 font-semibold text-ink-700">
                        <Lock className="h-4 w-4" aria-hidden="true" />
                        {event.state === 'PAUSED' && 'The CTF is paused. Flag submission is temporarily disabled.'}
                        {event.state === 'ENDED' && 'The CTF has ended. Flag submission is closed.'}
                        {event.state === 'UPCOMING' && 'Flag submission opens when the CTF goes live.'}
                      </p>
                    )}
                    {wrong && (
                      <p className="flex items-start gap-2 font-semibold text-blood-400">
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>
                          {wrong.message}
                          {wrong.formatHint && <span className="block font-normal text-ink-700">{wrong.formatHint}</span>}
                        </span>
                      </p>
                    )}
                    {notice && (
                      <p className="flex items-center gap-2 font-semibold text-jade-500">
                        <Check className="h-4 w-4" aria-hidden="true" /> {notice}
                      </p>
                    )}
                  </div>
                </form>
              )}
            </section>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={hintToBuy !== null}
        title="Reveal hint"
        message={
          hintToBuy && hintToBuy.cost > 0 ? (
            <>
              Reveal this hint for <strong className="text-accent-200">{hintToBuy.cost} points</strong>? The cost is deducted from your bounty and cannot be undone.
            </>
          ) : (
            'Reveal this hint?'
          )
        }
        confirmLabel={hintToBuy ? `Reveal (-${hintToBuy.cost})` : 'Reveal'}
        busy={hintBusy}
        onConfirm={() => hintToBuy && revealHint(hintToBuy)}
        onClose={() => setHintToBuy(null)}
      />
    </>
  );
}
