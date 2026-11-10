import { Dumbbell, Eye, EyeOff, Flag, Paperclip, Pencil, Plus, Swords, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { SecretField } from '../../components/SecretField';
import { ConfirmDialog, DifficultyChip, EmptyState, ErrorNote, Modal, Spinner } from '../../components/ui';
import { useLive } from '../../context/LiveContext';
import { useToast } from '../../context/ToastContext';
import { useApi } from '../../hooks/useApi';
import { ApiError, api, errorMessage } from '../../services/api';
import type { AdminChallenge, AdminChallengeFlags, Category, Difficulty, Scoring } from '../../services/types';
import { fileSize } from '../../utils/format';
import { dynamicValue } from '../../utils/scoring';

const POINTS: Record<Difficulty, number> = { EASY: 100, MEDIUM: 200, HARD: 300, INSANE: 500 };

interface HintDraft {
  id?: number;
  content: string;
  cost: number;
}

interface Draft {
  title: string;
  description: string;
  categoryId: number;
  difficulty: Difficulty;
  points: number;
  scoring: Scoring;
  minimumPoints: number;
  decay: number;
  flag: string;
  enabled: boolean;
  practice: boolean;
  flagCaseInsensitive: boolean;
  /** New extra accepted flags, one per line (blank on edit = keep the saved ones). */
  extraFlagsText: string;
  /** On edit: remove the saved extra flags. */
  clearExtraFlags: boolean;
  hints: HintDraft[];
}

/** Defaults for a new dynamic challenge: drops to a fifth of its value over 10 solves. */
const defaultMinimum = (points: number) => Math.round(points / 5);
const DEFAULT_DECAY = 10;

const toDraft = (challenge: AdminChallenge): Draft => ({
  title: challenge.title,
  description: challenge.description,
  categoryId: challenge.category.id,
  difficulty: challenge.difficulty,
  points: challenge.points,
  scoring: challenge.scoring,
  minimumPoints: challenge.minimumPoints ?? defaultMinimum(challenge.points),
  decay: challenge.decay ?? DEFAULT_DECAY,
  flag: '',
  enabled: challenge.enabled,
  practice: challenge.practice,
  flagCaseInsensitive: challenge.flagCaseInsensitive,
  extraFlagsText: '',
  clearExtraFlags: false,
  hints: challenge.hints.map((hint) => ({ ...hint })),
});

function FlagsDialog({ challenge, onClose, onEdit }: { challenge: AdminChallenge | null; onClose: () => void; onEdit: (challenge: AdminChallenge) => void }) {
  const { data, error, loading, reload } = useApi<AdminChallengeFlags>(challenge ? `/admin/challenges/${challenge.id}/flags` : null);
  const current = data && challenge && data.id === challenge.id ? data : null;
  const missing = current ? (current.flag === null ? 1 : 0) + current.extraFlags.filter((flag) => flag === null).length : 0;

  return (
    <Modal open={challenge !== null} onClose={onClose} title={challenge ? `Flags — ${challenge.title}` : 'Flags'}>
      {loading && !current ? (
        <Spinner label="Opening the vault…" />
      ) : error ? (
        <ErrorNote message={error.message} onRetry={reload} />
      ) : (
        current &&
        challenge && (
          <div className="space-y-4">
            <div>
              <p className="field-label">Flag</p>
              {current.flag !== null ? <SecretField value={current.flag} label="Flag" /> : <p className="text-sm text-slate-400">Not viewable (saved before flags were viewable).</p>}
            </div>
            {current.extraFlags.length > 0 && (
              <div>
                <p className="field-label">Also accepted</p>
                <div className="space-y-2">
                  {current.extraFlags.map((flag, index) =>
                    flag !== null ? (
                      <SecretField key={index} value={flag} label={`Extra flag ${index + 1}`} />
                    ) : (
                      <p key={index} className="text-sm text-slate-400">
                        Extra flag {index + 1}: not viewable.
                      </p>
                    ),
                  )}
                </div>
              </div>
            )}
            <p className="text-xs text-slate-500">{current.flagCaseInsensitive ? 'Capitals are ignored when checking answers.' : 'Capitals must match exactly.'}</p>
            {missing > 0 && (
              <p className="rounded-md border border-accent-500/40 bg-accent-500/10 p-3 text-sm text-accent-200">
                Flags saved before this feature are stored only as hashes and cannot be recovered. Open <strong>Edit</strong> and type the flag
                {current.extraFlags.some((flag) => flag === null) ? ' and the extra flags' : ''} once more — after saving they can be viewed here.
              </p>
            )}
            <div className="flex justify-end gap-3 border-t border-navy-700 pt-4">
              <button type="button" className="btn-ghost" onClick={() => onEdit(challenge)}>
                <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
              </button>
              <button type="button" className="btn-accent" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        )
      )}
    </Modal>
  );
}

function ChallengeForm({
  challenge,
  categories,
  flagFormat,
  onSaved,
  onClose,
}: {
  challenge: AdminChallenge | null;
  categories: Category[];
  flagFormat: string;
  onSaved: (challenge: AdminChallenge, created: boolean) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>(() =>
    challenge
      ? toDraft(challenge)
      : {
          title: '',
          description: '',
          categoryId: categories[0]?.id ?? 0,
          difficulty: 'EASY',
          points: POINTS.EASY,
          scoring: 'STATIC',
          minimumPoints: defaultMinimum(POINTS.EASY),
          decay: DEFAULT_DECAY,
          flag: '',
          enabled: true,
          practice: false,
          flagCaseInsensitive: false,
          extraFlagsText: '',
          clearExtraFlags: false,
          hints: [],
        },
  );
  const [attachments, setAttachments] = useState(challenge?.attachments ?? []);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const updateHint = (index: number, patch: Partial<HintDraft>) => update('hints', draft.hints.map((hint, i) => (i === index ? { ...hint, ...patch } : hint)));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const dynamic = draft.scoring === 'DYNAMIC';
      const extraLines = draft.extraFlagsText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const { extraFlagsText: _text, clearExtraFlags: _clear, ...fields } = draft;
      const body = {
        ...fields,
        // New lines replace the saved extra flags; none given keeps them (unless removing).
        extraFlags: extraLines.length > 0 ? extraLines : draft.clearExtraFlags || !challenge ? [] : undefined,
        minimumPoints: dynamic ? draft.minimumPoints : null,
        decay: dynamic ? draft.decay : null,
        hints: draft.hints.filter((hint) => hint.content.trim() !== ''),
      };
      const result = challenge
        ? await api.put<{ challenge: AdminChallenge }>(`/admin/challenges/${challenge.id}`, body)
        : await api.post<{ challenge: AdminChallenge }>('/admin/challenges', body);
      toast('success', challenge ? 'Challenge updated' : 'Challenge created', result.challenge.title);
      onSaved(result.challenge, !challenge);
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!challenge || !files || files.length === 0) return;
    const form = new FormData();
    for (const file of Array.from(files)) form.append('files', file);
    setBusy(true);
    try {
      const result = await api.upload<{ attachments: AdminChallenge['attachments'] }>(`/admin/challenges/${challenge.id}/attachments`, form);
      setAttachments(result.attachments);
      toast('success', 'Attachment uploaded');
    } catch (err) {
      toast('error', 'Upload failed', errorMessage(err));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removeAttachment = async (id: number) => {
    try {
      await api.delete(`/admin/attachments/${id}`);
      setAttachments((list) => list.filter((file) => file.id !== id));
    } catch (err) {
      toast('error', 'Could not delete the file', errorMessage(err));
    }
  };

  const fieldError = (key: string) => fields[key] && <p className="field-error">{fields[key]}</p>;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {error && <ErrorNote message={error} />}

      <div>
        <label htmlFor="c-title" className="field-label">
          Title
        </label>
        <input id="c-title" className="field" value={draft.title} onChange={(e) => update('title', e.target.value)} maxLength={120} required autoFocus />
        {fieldError('title')}
      </div>

      <div>
        <label htmlFor="c-description" className="field-label">
          Description
        </label>
        <textarea id="c-description" className="field min-h-[8rem] font-mono text-xs leading-relaxed" value={draft.description} onChange={(e) => update('description', e.target.value)} maxLength={10000} required />
        <p className="mt-1 text-xs text-slate-500">Shown as plain text; line breaks are kept.</p>
        {fieldError('description')}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="c-category" className="field-label">
            Category
          </label>
          <select id="c-category" className="field" value={draft.categoryId} onChange={(e) => update('categoryId', Number(e.target.value))}>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="c-difficulty" className="field-label">
            Difficulty
          </label>
          <select
            id="c-difficulty"
            className="field"
            value={draft.difficulty}
            onChange={(e) => {
              const difficulty = e.target.value as Difficulty;
              // Follow the standard point scale unless the admin already customised it.
              setDraft((current) => ({ ...current, difficulty, points: current.points === POINTS[current.difficulty] ? POINTS[difficulty] : current.points }));
            }}
          >
            {(Object.keys(POINTS) as Difficulty[]).map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty.charAt(0) + difficulty.slice(1).toLowerCase()} → {POINTS[difficulty]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="c-points" className="field-label">
            {draft.scoring === 'DYNAMIC' ? 'Starting points' : 'Points'}
          </label>
          <input id="c-points" type="number" min={0} max={10000} className="field font-mono" value={draft.points} onChange={(e) => update('points', Number(e.target.value))} required />
          {fieldError('points')}
        </div>
      </div>

      <fieldset className="rounded-lg border border-navy-700 p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Scoring</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="c-scoring" className="field-label">
              Value
            </label>
            <select id="c-scoring" className="field" value={draft.scoring} onChange={(e) => update('scoring', e.target.value as Scoring)}>
              <option value="STATIC">Fixed points</option>
              <option value="DYNAMIC">Drops with each solve</option>
            </select>
          </div>
          {draft.scoring === 'DYNAMIC' && (
            <>
              <div>
                <label htmlFor="c-minimum" className="field-label">
                  Minimum points
                </label>
                <input id="c-minimum" type="number" min={0} max={draft.points} className="field font-mono" value={draft.minimumPoints} onChange={(e) => update('minimumPoints', Number(e.target.value))} required />
                {fieldError('minimumPoints')}
              </div>
              <div>
                <label htmlFor="c-decay" className="field-label">
                  Reaches the minimum after
                </label>
                <div className="flex items-center gap-2">
                  <input id="c-decay" type="number" min={1} max={10000} className="field font-mono" value={draft.decay} onChange={(e) => update('decay', Number(e.target.value))} required />
                  <span className="shrink-0 text-sm text-slate-400">more solves</span>
                </div>
                {fieldError('decay')}
              </div>
            </>
          )}
        </div>
        {draft.scoring === 'DYNAMIC' ? (
          <p className="mt-3 text-xs text-slate-400">
            Every crew that solved it holds the current value, so earlier solvers drop too. With these settings:{' '}
            {[1, 2, 3, Math.ceil(draft.decay / 2) + 1, draft.decay + 1]
              .filter((n, i, all) => n >= 1 && all.indexOf(n) === i)
              .map((n) => `${n === draft.decay + 1 ? `${n}+` : n} solve${n === 1 ? '' : 's'}: ${dynamicValue(draft.points, draft.minimumPoints, draft.decay, n)}`)
              .join(' · ')}{' '}
            points.
          </p>
        ) : (
          <p className="mt-3 text-xs text-slate-400">Every crew gets the same points, however many solve it.</p>
        )}
      </fieldset>

      <div>
        <label htmlFor="c-flag" className="field-label">
          Flag
        </label>
        <input
          id="c-flag"
          className="field font-mono"
          value={draft.flag}
          onChange={(e) => update('flag', e.target.value)}
          placeholder={challenge ? 'Leave blank to keep the current flag' : flagFormat.replace('...', 'hidden_treasure')}
          autoComplete="off"
          spellCheck={false}
          required={!challenge}
        />
        <p className="mt-1 text-xs text-slate-500">
          Must match {flagFormat}. Answers are checked against a salted hash; an encrypted copy lets admins view it later with the Flags button.
          {challenge && !challenge.flagViewable && <strong className="text-accent-300"> This flag was saved before flags were viewable — re-enter it once to make it viewable.</strong>}
        </p>
        {fieldError('flag')}
      </div>

      <div>
        <label htmlFor="c-extra-flags" className="field-label">
          Also accept these flags (optional, one per line)
        </label>
        <textarea
          id="c-extra-flags"
          rows={3}
          className="field font-mono"
          value={draft.extraFlagsText}
          onChange={(e) => update('extraFlagsText', e.target.value)}
          placeholder={challenge && challenge.extraFlagCount > 0 ? `${challenge.extraFlagCount} saved — type new ones to replace them` : `${flagFormat.replace('...', 'Other Answer')}`}
          spellCheck={false}
        />
        <p className="mt-1 text-xs text-slate-500">
          Other answers that also count, e.g. a short name or a spelling with spaces. Like the main flag, admins can view them later.
          {challenge && challenge.extraFlagCount > 0 && ' Leave empty to keep the saved ones.'}
        </p>
        {challenge && challenge.extraFlagCount > 0 && (
          <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" className="h-3.5 w-3.5 accent-accent-400" checked={draft.clearExtraFlags} onChange={(e) => update('clearExtraFlags', e.target.checked)} />
            Remove the {challenge.extraFlagCount} saved extra flag{challenge.extraFlagCount === 1 ? '' : 's'}
          </label>
        )}
        {fieldError('extraFlags')}
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" className="h-4 w-4 accent-accent-400" checked={draft.flagCaseInsensitive} onChange={(e) => update('flagCaseInsensitive', e.target.checked)} />
          Ignore capitals (NIKA{'{'}zoro{'}'} = NIKA{'{'}Zoro{'}'})
        </label>
        {challenge && draft.flagCaseInsensitive !== challenge.flagCaseInsensitive && (
          <p className="mt-1 text-xs text-accent-300">Re-enter the flag{challenge.extraFlagCount > 0 ? ' and the extra flags' : ''} to change this.</p>
        )}
      </div>

      <label className="flex items-start gap-2 rounded-lg border border-navy-700 p-3 text-sm text-slate-300">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent-400" checked={draft.practice} onChange={(e) => update('practice', e.target.checked)} />
        <span>
          <strong className="text-slate-100">Practice challenge</strong> — shown on the Practice page, open at any time (even before the CTF starts), gives no
          points and never appears on the scoreboard.
        </span>
      </label>

      <fieldset>
        <legend className="field-label">Hints</legend>
        <div className="space-y-2">
          {draft.hints.map((hint, index) => (
            <div key={hint.id ?? `new-${index}`} className="grid grid-cols-1 gap-2 rounded-md border border-navy-600 bg-navy-950/50 p-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
              <div>
                <label htmlFor={`hint-${index}`} className="sr-only">
                  Hint {index + 1} text
                </label>
                <input id={`hint-${index}`} className="field" value={hint.content} onChange={(e) => updateHint(index, { content: e.target.value })} placeholder={`Hint ${index + 1}`} maxLength={2000} />
              </div>
              <div>
                <label htmlFor={`hint-cost-${index}`} className="sr-only">
                  Hint {index + 1} cost in points
                </label>
                <input
                  id={`hint-cost-${index}`}
                  type="number"
                  min={0}
                  max={10000}
                  className="field font-mono"
                  value={hint.cost}
                  onChange={(e) => updateHint(index, { cost: Number(e.target.value) })}
                  title="Cost in points (0 = free)"
                />
              </div>
              <button type="button" className="btn-ghost btn-sm" onClick={() => update('hints', draft.hints.filter((_, i) => i !== index))} aria-label={`Remove hint ${index + 1}`}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn-ghost btn-sm mt-2" onClick={() => update('hints', [...draft.hints, { content: '', cost: 0 }])} disabled={draft.hints.length >= 10}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add hint
        </button>
        <p className="mt-1 text-xs text-slate-500">Cost is deducted from the pirate's bounty when they reveal the hint. 0 = free. Removing a paid hint refunds it.</p>
      </fieldset>

      <fieldset>
        <legend className="field-label">Attachments</legend>
        {challenge ? (
          <>
            {attachments.length > 0 && (
              <ul className="mb-2 space-y-1.5">
                {attachments.map((file) => (
                  <li key={file.id} className="flex items-center justify-between gap-3 rounded-md border border-navy-600 bg-navy-950/50 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <Paperclip className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                      <a href={`/api/challenges/${challenge.id}/attachments/${file.id}`} className="truncate rounded font-mono text-slate-100 hover:text-accent-200" download={file.name}>
                        {file.name}
                      </a>
                      <span className="shrink-0 text-xs text-slate-500">{fileSize(file.size)}</span>
                    </span>
                    <button type="button" className="rounded p-1 text-slate-400 hover:text-blood-300" onClick={() => removeAttachment(file.id)} aria-label={`Delete ${file.name}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="btn-ghost btn-sm cursor-pointer">
              <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Upload files
              <input ref={fileInput} type="file" multiple className="sr-only" onChange={(e) => upload(e.target.files)} disabled={busy} />
            </label>
            <p className="mt-1 text-xs text-slate-500">Up to 5 files per upload. Files are stored under random names and only served to logged-in pirates.</p>
          </>
        ) : (
          <p className="text-sm text-slate-400">Save the challenge first, then attach files.</p>
        )}
      </fieldset>

      <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-200">
        <input type="checkbox" className="h-4 w-4 accent-accent-400" checked={draft.enabled} onChange={(e) => update('enabled', e.target.checked)} />
        Enabled — visible to participants while the CTF is live
      </label>

      <div className="flex justify-end gap-3 border-t border-navy-700 pt-5">
        <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
          Close
        </button>
        <button type="submit" className="btn-accent" disabled={busy}>
          {busy ? 'Saving…' : challenge ? 'Save changes' : 'Create challenge'}
        </button>
      </div>
    </form>
  );
}

export default function AdminChallenges() {
  const { toast } = useToast();
  const { event, challengeVersion } = useLive();
  const challenges = useApi<{ challenges: AdminChallenge[] }>('/admin/challenges', [challengeVersion]);
  const categories = useApi<{ categories: Category[] }>('/categories');
  const [editing, setEditing] = useState<AdminChallenge | 'new' | null>(null);
  const [deleting, setDeleting] = useState<AdminChallenge | null>(null);
  const [viewingFlags, setViewingFlags] = useState<AdminChallenge | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep the open editor in step with reloaded data (e.g. after an upload).
  const list = challenges.data?.challenges;
  useEffect(() => {
    if (editing && editing !== 'new' && list) {
      const fresh = list.find((challenge) => challenge.id === editing.id);
      if (fresh && fresh.updatedAt !== editing.updatedAt) setEditing(fresh);
    }
  }, [list, editing]);

  const toggle = async (challenge: AdminChallenge) => {
    try {
      await api.put(`/admin/challenges/${challenge.id}`, { ...toDraft(challenge), enabled: !challenge.enabled });
      toast('success', challenge.enabled ? 'Challenge disabled' : 'Challenge enabled', challenge.title);
      challenges.reload();
    } catch (error) {
      toast('error', 'Could not update the challenge', errorMessage(error));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/admin/challenges/${deleting.id}`);
      toast('success', 'Challenge deleted', deleting.title);
      challenges.reload();
    } catch (error) {
      toast('error', 'Could not delete the challenge', errorMessage(error));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  if (challenges.loading && !challenges.data) return <Spinner label="Gathering the maps…" />;
  if (challenges.error && !challenges.data) return <ErrorNote message={challenges.error.message} onRetry={challenges.reload} />;

  const rows = list ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          {rows.length} challenge{rows.length === 1 ? '' : 's'} · {rows.filter((c) => c.enabled).length} enabled
        </p>
        <button type="button" className="btn-accent" onClick={() => setEditing('new')} disabled={!categories.data}>
          <Plus className="h-4 w-4" aria-hidden="true" /> Create Challenge
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={<Plus className="h-10 w-10" aria-hidden="true" />} title="No treasure has been discovered here yet." hint="Create the first challenge to chart the Grand Line." />
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table-kop min-w-[58rem]">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Category</th>
                <th scope="col">Difficulty</th>
                <th scope="col" className="text-right">
                  Points
                </th>
                <th scope="col" className="text-right">
                  Solves
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((challenge) => (
                <tr key={challenge.id} className="hover:bg-navy-800/40">
                  <td>
                    <p className="font-semibold text-slate-100">{challenge.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
                      <span>
                        {challenge.hints.length} hint{challenge.hints.length === 1 ? '' : 's'}
                      </span>
                      <span>
                        {challenge.attachments.length} file{challenge.attachments.length === 1 ? '' : 's'}
                      </span>
                      {challenge.firstBlood && (
                        <span className="inline-flex items-center gap-1 text-blood-300">
                          <Swords className="h-3 w-3" aria-hidden="true" /> {challenge.firstBlood}
                        </span>
                      )}
                    </p>
                  </td>
                  <td className="text-slate-300">{challenge.category.name}</td>
                  <td>
                    <DifficultyChip difficulty={challenge.difficulty} />
                  </td>
                  <td className="tabular text-right font-mono font-bold text-accent-200">
                    {challenge.scoring === 'DYNAMIC' ? (
                      <span title={`Dynamic: ${challenge.points} → ${challenge.minimumPoints} over ${challenge.decay} solves`}>
                        {challenge.currentValue}
                        <span className="block text-[11px] font-normal text-slate-500">
                          ↓ {challenge.points}→{challenge.minimumPoints}
                        </span>
                      </span>
                    ) : (
                      challenge.points
                    )}
                  </td>
                  <td className="tabular text-right font-mono text-slate-200">
                    {challenge.solves}
                    <span className="text-slate-500"> / {challenge.submissions}</span>
                  </td>
                  <td>
                    {challenge.practice && (
                      <span className="chip mb-1 border-ocean-300/50 bg-ocean-500/10 text-ocean-200">
                        <Dumbbell className="h-3 w-3" aria-hidden="true" /> Practice
                      </span>
                    )}
                    {challenge.enabled ? (
                      <span className="chip border-jade-400/50 bg-jade-500/10 text-jade-300">
                        <Eye className="h-3 w-3" aria-hidden="true" /> Enabled
                      </span>
                    ) : (
                      <span className="chip border-slate-500/50 bg-slate-500/10 text-slate-300">
                        <EyeOff className="h-3 w-3" aria-hidden="true" /> Disabled
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      <button type="button" className="btn-ghost btn-sm" onClick={() => toggle(challenge)}>
                        {challenge.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => setViewingFlags(challenge)}
                        aria-label={`View the flags of ${challenge.title}`}
                        title={challenge.flagViewable ? 'View the flags' : 'Saved before flags were viewable — re-enter it in Edit'}
                      >
                        <Flag className={`h-3.5 w-3.5 ${challenge.flagViewable ? '' : 'opacity-50'}`} aria-hidden="true" /> Flags
                      </button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(challenge)} aria-label={`Edit ${challenge.title}`}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                      </button>
                      <button type="button" className="btn-danger btn-sm" onClick={() => setDeleting(challenge)} aria-label={`Delete ${challenge.title}`}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Create Challenge' : 'Edit Challenge'} wide>
        {editing !== null && categories.data && (
          <ChallengeForm
            // Remount when switching challenge, and after "create" turns into "edit".
            key={editing === 'new' ? 'new' : editing.id}
            challenge={editing === 'new' ? null : editing}
            categories={categories.data.categories}
            flagFormat={event?.flagFormat ?? 'NIKA{...}'}
            onClose={() => setEditing(null)}
            onSaved={(saved, created) => {
              challenges.reload();
              // After creating, stay open in edit mode so files can be attached.
              setEditing(created ? saved : null);
            }}
          />
        )}
      </Modal>

      <FlagsDialog
        challenge={viewingFlags}
        onClose={() => setViewingFlags(null)}
        onEdit={(challenge) => {
          setViewingFlags(null);
          setEditing(challenge);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete challenge"
        message={
          deleting && (
            <>
              Delete <strong className="text-slate-100">{deleting.title}</strong>? Its {deleting.solves} solve{deleting.solves === 1 ? '' : 's'}, hints and attachments are removed and every
              pirate's score is recalculated. This cannot be undone.
            </>
          )
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
