import { Ban, Check, ChevronLeft, ChevronRight, Copy, Download, KeyRound, ListChecks, LogOut, MonitorSmartphone, Plus, Search, Shield, Trash2, UserCheck, Users, UsersRound, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { PlayerChips } from '../../components/Players';
import { SecretField } from '../../components/SecretField';
import { ConfirmDialog, EmptyState, ErrorNote, Modal, Spinner } from '../../components/ui';
import { useToast } from '../../context/ToastContext';
import { useApi } from '../../hooks/useApi';
import { ApiError, api, errorMessage } from '../../services/api';
import type { AdminSubmission, AdminUser } from '../../services/types';
import { dateTime, pirateNumber, timeAgo } from '../../utils/format';

interface UserPage {
  page: number;
  pageSize: number;
  total: number;
  maxTeamSize: number;
  users: AdminUser[];
}

interface TeamInput {
  name: string;
  password?: string;
  email?: string;
  members: string[];
}

interface CreatedTeam {
  id: number;
  username: string;
  participantNumber: number;
  /** Only present when the password was generated. */
  password?: string;
}

interface Problem {
  line: number;
  name: string;
  message: string;
}

function problemsOf(error: unknown): Problem[] {
  if (!(error instanceof ApiError)) return [];
  const details = error.details as { problems?: Problem[] } | undefined;
  return Array.isArray(details?.problems) ? details.problems : [];
}

/** CSV cell for the downloadable login sheet (formula-safe, like the server exports). */
function csvCell(value: string): string {
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadLoginSheet(teams: CreatedTeam[], typedPasswords: Map<string, string>) {
  const lines = [
    ['Team #', 'Team name', 'Password'],
    ...teams.map((team) => [String(team.participantNumber), team.username, team.password ?? typedPasswords.get(team.username.toLowerCase()) ?? '(set by you)']),
  ];
  const blob = new Blob([`﻿${lines.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `black-basta-team-logins-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/** "Team name, password, Member 1; Member 2" per line. Password and members are optional. */
function parseTeamList(text: string): TeamInput[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [name = '', password = '', ...rest] = line.split(',');
      const members = rest
        .join(',')
        .split(';')
        .map((member) => member.trim())
        .filter(Boolean);
      return { name: name.trim(), password: password.trim() || undefined, members };
    });
}

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-slate-400">
      <span>{total === 0 ? 'No results' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="tabular font-mono text-slate-200">
          {page} / {pages}
        </span>
        <button type="button" className="btn-ghost btn-sm" onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function SubmissionsDialog({ user, onClose }: { user: AdminUser | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [user?.id]);
  const { data, error, loading, reload } = useApi<{ page: number; pageSize: number; total: number; submissions: AdminSubmission[] }>(
    user ? `/admin/users/${user.id}/submissions?page=${page}&pageSize=15` : null,
  );

  return (
    <Modal open={user !== null} onClose={onClose} title={user ? `Submissions — ${user.username}` : 'Submissions'} wide>
      {loading && !data ? (
        <Spinner label="Reading the log…" />
      ) : error ? (
        <ErrorNote message={error.message} onRetry={reload} />
      ) : data && data.submissions.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">This team has not submitted any flags.</p>
      ) : (
        data && (
          <>
            <div className="overflow-x-auto">
              <table className="table-kop min-w-[36rem]">
                <thead>
                  <tr>
                    <th scope="col">Challenge</th>
                    <th scope="col">Player</th>
                    <th scope="col">Submitted flag</th>
                    <th scope="col">Result</th>
                    <th scope="col" className="text-right">
                      Time
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.submissions.map((row) => (
                    <tr key={row.id}>
                      <td className="text-slate-200">{row.challenge}</td>
                      <td className="text-slate-300">{row.player ?? '—'}</td>
                      <td className="max-w-[16rem] break-all font-mono text-xs text-slate-300">{row.submittedFlag}</td>
                      <td>
                        {row.correct ? (
                          <span className="chip border-jade-400/50 bg-jade-500/10 text-jade-300">
                            <Check className="h-3 w-3" aria-hidden="true" /> Correct
                          </span>
                        ) : (
                          <span className="chip border-blood-400/50 bg-blood-500/10 text-blood-300">
                            <X className="h-3 w-3" aria-hidden="true" /> Wrong
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-right text-slate-400">{dateTime(row.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
            <p className="text-xs text-slate-500">Correct flags are never written to the log; only wrong attempts are stored verbatim.</p>
          </>
        )
      )}
    </Modal>
  );
}

/** Member name inputs, one per player slot. */
function MemberInputs({ members, max, onChange, idPrefix }: { members: string[]; max: number; onChange: (members: string[]) => void; idPrefix: string }) {
  return (
    <fieldset>
      <legend className="field-label">Players (up to {max})</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: max }, (_, index) => (
          <div key={index}>
            <label htmlFor={`${idPrefix}-${index}`} className="sr-only">
              Player {index + 1}
            </label>
            <input
              id={`${idPrefix}-${index}`}
              className="field"
              placeholder={`Player ${index + 1}${index === 0 ? '' : ' (optional)'}`}
              maxLength={60}
              value={members[index] ?? ''}
              onChange={(event) => {
                const next = Array.from({ length: max }, (_, i) => members[i] ?? '');
                next[index] = event.target.value;
                onChange(next);
              }}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function AddTeamsDialog({ open, max, onClose, onCreated }: { open: boolean; max: number; onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<'one' | 'list'>('one');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [list, setList] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [created, setCreated] = useState<{ teams: CreatedTeam[]; typed: Map<string, string> } | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setPassword('');
    setEmail('');
    setMembers([]);
    setList('');
    setError(null);
    setProblems([]);
    setCreated(null);
  }, [open]);

  const parsed = mode === 'list' ? parseTeamList(list) : [];

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const teams: TeamInput[] =
      mode === 'one' ? [{ name, password: password || undefined, email: email || undefined, members: members.map((m) => m.trim()).filter(Boolean) }] : parsed;
    if (teams.length === 0) {
      setError('Add at least one team.');
      return;
    }
    setBusy(true);
    setError(null);
    setProblems([]);
    try {
      const result = await api.post<{ created: CreatedTeam[] }>('/admin/teams', { teams });
      const typed = new Map(teams.filter((team) => team.password).map((team) => [team.name.trim().replace(/\s+/g, ' ').toLowerCase(), team.password as string]));
      setCreated({ teams: result.created, typed });
      toast('success', `${result.created.length} team${result.created.length === 1 ? '' : 's'} added`);
      onCreated();
    } catch (err) {
      setProblems(problemsOf(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const generatedCount = created?.teams.filter((team) => team.password).length ?? 0;

  return (
    <Modal open={open} onClose={onClose} title={created ? 'Teams added' : 'Add teams'} wide>
      {created ? (
        <div>
          <p className="text-sm text-slate-300">
            {created.teams.length} team{created.teams.length === 1 ? '' : 's'} can now log in with their team name and password.
            {generatedCount > 0 && (
              <>
                {' '}
                Download the login sheet now; every password also stays viewable under <strong className="text-accent-200">Password</strong> in the team list.
              </>
            )}
          </p>
          <div className="mt-4 max-h-80 overflow-y-auto rounded-md border border-navy-600">
            <table className="table-kop">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Team name</th>
                  <th scope="col">Password</th>
                </tr>
              </thead>
              <tbody>
                {created.teams.map((team) => (
                  <tr key={team.id}>
                    <td className="tabular font-mono text-slate-400">{pirateNumber(team.participantNumber)}</td>
                    <td className="font-semibold text-slate-100">{team.username}</td>
                    <td className="font-mono text-accent-200">{team.password ?? <span className="text-slate-500">(the one you set)</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <button type="button" className="btn-ghost" onClick={() => downloadLoginSheet(created.teams, created.typed)}>
              <Download className="h-4 w-4" aria-hidden="true" /> Download login sheet (CSV)
            </button>
            <button type="button" className="btn-accent" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <div role="tablist" aria-label="How to add teams" className="flex gap-2">
            {(
              [
                ['one', 'One team'],
                ['list', 'Paste a list'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${mode === key ? 'border-accent-400 bg-accent-500/15 text-accent-100' : 'border-navy-500 text-slate-300 hover:border-accent-400'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && <ErrorNote message={error} />}
          {problems.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-blood-400/40 bg-blood-700/10 p-3 text-sm text-blood-300">
              {problems.map((problem, index) => (
                <li key={index}>
                  {mode === 'list' ? `Line ${problem.line}` : 'Team'} ({problem.name}): {problem.message}
                </li>
              ))}
            </ul>
          )}

          {mode === 'one' ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="team-name" className="field-label">
                    Team name
                  </label>
                  <input id="team-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required autoFocus />
                </div>
                <div>
                  <label htmlFor="team-password" className="field-label">
                    Password
                  </label>
                  <input
                    id="team-password"
                    className="field font-mono"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    maxLength={72}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Leave empty to generate one"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="team-email" className="field-label">
                  Contact email (optional)
                </label>
                <input id="team-email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
              </div>
              <MemberInputs members={members} max={max} onChange={setMembers} idPrefix="new-member" />
            </>
          ) : (
            <div>
              <label htmlFor="team-list" className="field-label">
                One team per line
              </label>
              <textarea
                id="team-list"
                className="field min-h-[12rem] font-mono text-xs leading-relaxed"
                value={list}
                onChange={(e) => setList(e.target.value)}
                spellCheck={false}
                placeholder={'Straw Hat Crew, Gomu-Gomu-2026, Luffy; Zoro; Nami; Sanji\nHeart Pirates, , Law; Bepo\nRed Hair Pirates'}
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Format: <code className="font-mono">Team name, password, Player 1; Player 2; …</code> — password and players are optional (an empty password is generated). Up to {max} players
                per team. Lines starting with # are ignored. {parsed.length > 0 && <strong className="text-slate-300">{parsed.length} team(s) ready.</strong>}
              </p>
            </div>
          )}

          <p className="text-xs text-slate-500">Passwords need at least 8 characters. A team can be logged in on at most {max} devices at the same time.</p>
          <div className="flex justify-end gap-3 border-t border-navy-700 pt-5">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-accent" disabled={busy || (mode === 'one' ? !name.trim() : parsed.length === 0)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> {busy ? 'Adding…' : mode === 'one' ? 'Add team' : `Add ${parsed.length || ''} teams`}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function MembersDialog({ user, max, onClose, onSaved }: { user: AdminUser | null; max: number; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMembers(user?.members ?? []);
    setError(null);
  }, [user]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/admin/users/${user.id}`, { members: members.map((m) => m.trim()).filter(Boolean) });
      toast('success', 'Players saved', user.username);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={user !== null} onClose={onClose} title={user ? `Players — ${user.username}` : 'Players'}>
      <form onSubmit={save} className="space-y-5" noValidate>
        {error && <ErrorNote message={error} />}
        <MemberInputs members={members} max={max} onChange={setMembers} idPrefix="edit-member" />
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-accent" disabled={busy}>
            {busy ? 'Saving…' : 'Save players'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: AdminUser | null; onClose: () => void; onDone: (generated: string | null) => void }) {
  const current = useApi<{ id: number; password: string | null }>(user ? `/admin/users/${user.id}/password` : null);
  const currentPassword = current.data && user && current.data.id === user.id ? current.data.password : undefined;
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPassword('');
    setError(null);
  }, [user]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.put<{ temporaryPassword?: string }>(`/admin/users/${user.id}`, { resetPassword: true, password });
      onDone(result.temporaryPassword ?? null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={user !== null} onClose={onClose} title={user ? `Password — ${user.username}` : 'Password'}>
      <div className="mb-5 border-b border-navy-700 pb-5">
        <p className="field-label">Current password</p>
        {current.error ? (
          <ErrorNote message={current.error.message} onRetry={current.reload} />
        ) : currentPassword === undefined ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : currentPassword !== null ? (
          <SecretField value={currentPassword} label={`Password of ${user?.username}`} />
        ) : (
          <p className="text-sm text-slate-400">
            Not viewable — it was chosen by the team at sign-up, or set before passwords were viewable. Set a new one below to make it viewable.
          </p>
        )}
      </div>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <ErrorNote message={error} />}
        <p className="text-sm text-slate-300">
          Or set a new password for <strong className="text-slate-100">{user?.username}</strong>. The old one stops working and the team is logged out on every device.
        </p>
        <div>
          <label htmlFor="reset-password" className="field-label">
            New password
          </label>
          <input
            id="reset-password"
            className="field font-mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={72}
            autoComplete="off"
            spellCheck={false}
            placeholder="Leave empty to generate one"
          />
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-accent" disabled={busy}>
            {busy ? 'Saving…' : password ? 'Set new password' : 'Generate new password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Permanent delete: the organizer must type the team name to confirm. */
function DeleteTeamDialog({ user, onClose, onDeleted }: { user: AdminUser | null; onClose: () => void; onDeleted: () => void }) {
  const { toast } = useToast();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTyped('');
    setError(null);
  }, [user]);

  const matches = user !== null && typed.trim().replace(/\s+/g, ' ').toLowerCase() === user.username.toLowerCase();

  const remove = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !matches) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/admin/users/${user.id}`);
      toast('success', 'Team deleted', user.username);
      onDeleted();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={user !== null} onClose={onClose} title="Delete team">
      {user && (
        <form onSubmit={remove} className="space-y-4" noValidate>
          {error && <ErrorNote message={error} />}
          <p className="text-sm leading-relaxed text-slate-300">
            Permanently delete <strong className="text-slate-100">{user.username}</strong>? Their login, players, solves ({user.solved}), score ({user.score}), flag attempts and bought
            hints are removed, and they disappear from the leaderboard. <strong className="text-blood-300">This cannot be undone.</strong>
          </p>
          <p className="text-xs text-slate-500">To keep their results but stop them playing, use Disable instead.</p>
          <div>
            <label htmlFor="delete-confirm" className="field-label">
              Type the team name to confirm
            </label>
            <input id="delete-confirm" className="field" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={user.username} autoComplete="off" autoFocus />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-danger" disabled={busy || !matches}>
              <Trash2 className="h-4 w-4" aria-hidden="true" /> {busy ? 'Deleting…' : 'Delete team'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function AdminUsers() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [editingMembers, setEditingMembers] = useState<AdminUser | null>(null);
  const [signingOut, setSigningOut] = useState<AdminUser | null>(null);
  const [toggling, setToggling] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const [viewing, setViewing] = useState<AdminUser | null>(null);
  const [temporary, setTemporary] = useState<{ username: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Debounced search.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data, error, loading, reload } = useApi<UserPage>(`/admin/users?page=${page}&pageSize=25${search ? `&search=${encodeURIComponent(search)}` : ''}`);
  const max = data?.maxTeamSize ?? 4;

  const update = async (user: AdminUser, body: object, success: string) => {
    setBusy(true);
    try {
      await api.put(`/admin/users/${user.id}`, body);
      toast('success', success, user.username);
      reload();
    } catch (err) {
      toast('error', 'Could not update the team', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('success', 'Copied to clipboard');
    } catch {
      toast('error', 'Could not copy', 'Select the password and copy it manually.');
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <label htmlFor="user-search" className="sr-only">
            Search teams
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input id="user-search" type="search" className="field pl-10" placeholder="Search team name or email" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          {data && <p className="text-sm text-slate-400">{data.total} account{data.total === 1 ? '' : 's'}</p>}
          <button type="button" className="btn-accent" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add teams
          </button>
        </div>
      </div>

      {loading && !data ? (
        <Spinner label="Mustering the crew…" />
      ) : error && !data ? (
        <ErrorNote message={error.message} onRetry={reload} />
      ) : data && data.users.length === 0 ? (
        <EmptyState icon={<Users className="h-10 w-10" aria-hidden="true" />} title="No teams found." hint={search ? 'Nothing matches that search.' : 'Add your first team with “Add teams”.'} />
      ) : (
        data && (
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-kop min-w-[74rem]">
                <thead>
                  <tr>
                    <th scope="col">Team</th>
                    <th scope="col">Email</th>
                    <th scope="col">Registered</th>
                    <th scope="col" className="text-right">
                      Score
                    </th>
                    <th scope="col" className="text-right">
                      Solved
                    </th>
                    <th scope="col">Devices</th>
                    <th scope="col">Last Activity</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((user) => {
                    const participant = user.role === 'participant';
                    return (
                      <tr key={user.id} className="hover:bg-navy-800/40">
                        <td>
                          <p className="flex items-center gap-2 font-semibold text-slate-100">
                            {user.username}
                            {user.role === 'admin' && (
                              <span className="chip border-blood-400/50 bg-blood-500/10 text-blood-300">
                                <Shield className="h-3 w-3" aria-hidden="true" /> Admin
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {[
                              user.fullName !== user.username ? user.fullName : null,
                              participant && user.members.length === 0 ? 'No players listed' : null,
                              user.participantNumber ? pirateNumber(user.participantNumber) : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                          {participant && <PlayerChips players={user.players} className="mt-1.5" />}
                        </td>
                        <td className="break-all text-slate-300">{user.email.endsWith('@teams.blackbasta.local') ? <span className="text-slate-500">—</span> : user.email}</td>
                        <td className="whitespace-nowrap text-slate-400">{dateTime(user.createdAt)}</td>
                        <td className="tabular text-right font-mono font-bold text-accent-200">{user.score}</td>
                        <td className="tabular text-right font-mono text-slate-200">{user.solved}</td>
                        <td>
                          {participant ? (
                            <span className={`tabular inline-flex items-center gap-1.5 font-mono text-sm ${user.devices >= max ? 'text-accent-300' : 'text-slate-300'}`} title="Devices logged in now">
                              <MonitorSmartphone className="h-3.5 w-3.5" aria-hidden="true" />
                              {user.devices}/{max}
                              {user.devices >= max && <span className="sr-only"> (full)</span>}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-slate-400" title={dateTime(user.lastActivity)}>
                          {user.lastActivity ? timeAgo(user.lastActivity) : 'never'}
                        </td>
                        <td>
                          {user.disabled ? (
                            <span className="chip border-blood-400/50 bg-blood-500/10 text-blood-300">
                              <Ban className="h-3 w-3" aria-hidden="true" /> Disabled
                            </span>
                          ) : (
                            <span className="chip border-jade-400/50 bg-jade-500/10 text-jade-300">
                              <Check className="h-3 w-3" aria-hidden="true" /> Active
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <button type="button" className="btn-ghost btn-sm" onClick={() => setViewing(user)} aria-label={`View submissions of ${user.username}`}>
                              <ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> Submissions
                            </button>
                            {participant && (
                              <>
                                <button type="button" className="btn-ghost btn-sm" onClick={() => setEditingMembers(user)} aria-label={`Edit players of ${user.username}`}>
                                  <UsersRound className="h-3.5 w-3.5" aria-hidden="true" /> Players
                                </button>
                                <button type="button" className="btn-ghost btn-sm" onClick={() => setResetting(user)} aria-label={`View or reset the password of ${user.username}`}>
                                  <KeyRound className={`h-3.5 w-3.5 ${user.passwordViewable ? 'text-accent-300' : ''}`} aria-hidden="true" /> Password
                                </button>
                                <button
                                  type="button"
                                  className="btn-ghost btn-sm"
                                  onClick={() => setSigningOut(user)}
                                  disabled={user.devices === 0}
                                  aria-label={`Sign ${user.username} out on every device`}
                                >
                                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
                                </button>
                                <button type="button" className={`${user.disabled ? 'btn-ghost' : 'btn-danger'} btn-sm`} onClick={() => setToggling(user)}>
                                  {user.disabled ? (
                                    <>
                                      <UserCheck className="h-3.5 w-3.5" aria-hidden="true" /> Enable
                                    </>
                                  ) : (
                                    <>
                                      <Ban className="h-3.5 w-3.5" aria-hidden="true" /> Disable
                                    </>
                                  )}
                                </button>
                                <button type="button" className="btn-danger btn-sm" onClick={() => setDeleting(user)} aria-label={`Delete ${user.username}`}>
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )
      )}

      <AddTeamsDialog open={adding} max={max} onClose={() => setAdding(false)} onCreated={reload} />
      <MembersDialog user={editingMembers} max={max} onClose={() => setEditingMembers(null)} onSaved={reload} />
      <SubmissionsDialog user={viewing} onClose={() => setViewing(null)} />
      <DeleteTeamDialog user={deleting} onClose={() => setDeleting(null)} onDeleted={reload} />

      <ResetPasswordDialog
        user={resetting}
        onClose={() => setResetting(null)}
        onDone={(generated) => {
          const target = resetting;
          setResetting(null);
          reload();
          if (generated && target) setTemporary({ username: target.username, password: generated });
          else toast('success', 'Password set', target?.username);
        }}
      />

      <ConfirmDialog
        open={signingOut !== null}
        title="Sign out everywhere"
        message={
          signingOut && (
            <>
              Log <strong className="text-slate-100">{signingOut.username}</strong> out on all {signingOut.devices} device{signingOut.devices === 1 ? '' : 's'}? Their password stays the same, so
              they can log back in straight away.
            </>
          )
        }
        confirmLabel="Sign out everywhere"
        busy={busy}
        onConfirm={async () => {
          if (signingOut) await update(signingOut, { signOutEverywhere: true }, 'Signed out everywhere');
          setSigningOut(null);
        }}
        onClose={() => setSigningOut(null)}
      />

      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.disabled ? 'Enable team' : 'Disable team'}
        message={
          toggling &&
          (toggling.disabled ? (
            <>
              Let <strong className="text-slate-100">{toggling.username}</strong> log in again and return to the leaderboard?
            </>
          ) : (
            <>
              Disable <strong className="text-slate-100">{toggling.username}</strong>? They are logged out on every device, cannot log in, and are removed from the leaderboard. Their
              solves are kept.
            </>
          ))
        }
        confirmLabel={toggling?.disabled ? 'Enable team' : 'Disable team'}
        danger={!toggling?.disabled}
        busy={busy}
        onConfirm={async () => {
          if (toggling) await update(toggling, { disabled: !toggling.disabled }, toggling.disabled ? 'Team enabled' : 'Team disabled');
          setToggling(null);
        }}
        onClose={() => setToggling(null)}
      />

      <Modal open={temporary !== null} onClose={() => setTemporary(null)} title="New password">
        {temporary && (
          <div>
            <p className="text-sm text-slate-300">
              New password for <strong className="text-slate-100">{temporary.username}</strong>. Hand it to the team — you can view it again any time under <strong className="text-accent-200">Password</strong>.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <code className="flex-1 select-all break-all rounded-md border border-accent-500/40 bg-navy-950 px-3.5 py-3 font-mono text-base text-accent-200">{temporary.password}</code>
              <button type="button" className="btn-ghost" onClick={() => copy(temporary.password)} aria-label="Copy password">
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-6 flex justify-end">
              <button type="button" className="btn-accent" onClick={() => setTemporary(null)}>
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
