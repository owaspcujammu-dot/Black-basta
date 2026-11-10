import { Activity, Check, Download, Eye, Flag, ListChecks, Map as MapIcon, Pause, Play, RefreshCw, RotateCcw, Snowflake, Square, Swords, Target, Trophy, Users, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ConfirmDialog, ErrorNote, EventBadge, MiniClock, Spinner, StatCard } from '../../components/ui';
import { useLive } from '../../context/LiveContext';
import { useToast } from '../../context/ToastContext';
import { useApi } from '../../hooks/useApi';
import { api, errorMessage } from '../../services/api';
import type { AdminDashboard as DashboardData, EventInfo, EventState } from '../../services/types';
import { dateTime, fromLocalInput, timeAgo, toLocalInput } from '../../utils/format';

type Action = 'start' | 'pause' | 'end' | 'reset';

const ACTIONS: { action: Action; label: string; icon: typeof Play; className: string; allowed: EventState[]; confirm?: string }[] = [
  { action: 'start', label: 'Start CTF', icon: Play, className: 'btn-accent', allowed: ['UPCOMING', 'PAUSED', 'ENDED'] },
  { action: 'pause', label: 'Pause CTF', icon: Pause, className: 'btn-ghost', allowed: ['LIVE'] },
  {
    action: 'end',
    label: 'End CTF',
    icon: Square,
    className: 'btn-danger',
    allowed: ['LIVE', 'PAUSED', 'UPCOMING'],
    confirm: 'Ending the CTF closes flag submission for everyone and crowns the pirate at the top of the leaderboard. The leaderboard stays visible.',
  },
  {
    action: 'reset',
    label: 'Reset to upcoming',
    icon: RotateCcw,
    className: 'btn-ghost',
    allowed: ['LIVE', 'PAUSED', 'ENDED'],
    confirm: 'This returns the event to UPCOMING and hides the challenges from participants again. Scores and solves are kept.',
  },
];

const EXPORTS = [
  { kind: 'scoreboard', label: 'Scoreboard', hint: 'Final ranking with names, emails, scores', icon: Trophy },
  { kind: 'players', label: 'Players', hint: 'Every registered player, incl. disabled', icon: Users },
  { kind: 'solves', label: 'Solves', hint: 'Who solved what, when, and first bloods', icon: Swords },
  { kind: 'submissions', label: 'Submissions', hint: 'Every flag attempt, right or wrong', icon: ListChecks },
] as const;

function EventControl({ event, onChanged }: { event: EventInfo; onChanged: () => void }) {
  const { toast } = useToast();
  const [pending, setPending] = useState<(typeof ACTIONS)[number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(event.name);
  const [startsAt, setStartsAt] = useState(toLocalInput(event.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalInput(event.endsAt));
  const [freezeAt, setFreezeAt] = useState(toLocalInput(event.freezeAt ?? null));
  const [revealing, setRevealing] = useState(false);

  // Follow changes made elsewhere (another admin, the automatic start and end).
  useEffect(() => {
    setName(event.name);
    setStartsAt(toLocalInput(event.startsAt));
    setEndsAt(toLocalInput(event.endsAt));
    setFreezeAt(toLocalInput(event.freezeAt ?? null));
  }, [event.name, event.startsAt, event.endsAt, event.freezeAt]);

  const reveal = async () => {
    setBusy(true);
    try {
      await api.put('/admin/event', { freezeAt: null });
      toast('success', 'Scoreboard revealed', 'Everyone now sees the live standings.');
      onChanged();
    } catch (error) {
      toast('error', 'Could not reveal the scoreboard', errorMessage(error));
    } finally {
      setBusy(false);
      setRevealing(false);
    }
  };

  const run = async (action: Action) => {
    setBusy(true);
    try {
      await api.post('/admin/event/state', { action });
      toast('success', `Event: ${action}`, 'Every connected pirate has been notified.');
      onChanged();
    } catch (error) {
      toast('error', 'Could not change the event state', errorMessage(error));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const saveSchedule = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    setBusy(true);
    try {
      await api.put('/admin/event', { name, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt), freezeAt: fromLocalInput(freezeAt) });
      toast('success', 'Schedule saved');
      onChanged();
    } catch (error) {
      toast('error', 'Could not save the schedule', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel p-6" aria-label="Event control">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="panel-title">Event Control</h2>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <EventBadge state={event.state} />
            <span className="text-sm text-slate-400">
              Time remaining: <MiniClock className="font-semibold text-slate-100" />
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {ACTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.action}
                type="button"
                className={item.className}
                disabled={busy || !item.allowed.includes(event.state)}
                onClick={() => (item.confirm ? setPending(item) : run(item.action))}
              >
                <Icon className="h-4 w-4" aria-hidden="true" /> {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <ul className="mt-4 grid gap-x-6 gap-y-1 text-xs text-slate-400 sm:grid-cols-2">
        <li>
          <strong className="text-slate-300">Upcoming</strong> — challenges are hidden; registration is open.
        </li>
        <li>
          <strong className="text-slate-300">Live</strong> — challenges visible, flags accepted.
        </li>
        <li>
          <strong className="text-slate-300">Paused</strong> — platform visible, flag submission disabled.
        </li>
        <li>
          <strong className="text-slate-300">Ended</strong> — submission closed, leaderboard stays visible.
        </li>
      </ul>

      <form onSubmit={saveSchedule} className="mt-6 grid items-end gap-4 border-t border-navy-700 pt-5 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <div>
          <label htmlFor="event-name" className="field-label">
            Event name
          </label>
          <input id="event-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </div>
        <div>
          <label htmlFor="event-start" className="field-label">
            Scheduled start (countdown)
          </label>
          <input id="event-start" type="datetime-local" className="field" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </div>
        <div>
          <label htmlFor="event-end" className="field-label">
            Scheduled end (auto-ends)
          </label>
          <input id="event-end" type="datetime-local" className="field" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </div>
        <div>
          <label htmlFor="event-freeze" className="field-label">
            Scoreboard freeze (optional)
          </label>
          <input id="event-freeze" type="datetime-local" className="field" value={freezeAt} onChange={(e) => setFreezeAt(e.target.value)} />
        </div>
        <button type="submit" className="btn-ghost" disabled={busy}>
          Save schedule
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        Times are in your local timezone. The CTF goes live by itself at the scheduled start (or press Start CTF) and ends by itself at the scheduled end.
        From the freeze time, everyone sees the scoreboard as it was then (each crew still sees its own points) until you reveal it — usually at the closing.
      </p>

      {event.freezeAt && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-500/30 bg-accent-500/5 px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-slate-200">
            <Snowflake className="h-4 w-4 text-accent-300" aria-hidden="true" />
            <span>
              {event.frozen ? 'The scoreboard is frozen' : 'The scoreboard will freeze'} at <strong>{dateTime(event.freezeAt)}</strong>.
            </span>
          </p>
          <button type="button" className="btn-accent btn-sm" disabled={busy} onClick={() => setRevealing(true)}>
            <Eye className="h-4 w-4" aria-hidden="true" /> {event.frozen ? 'Reveal final scoreboard' : 'Cancel the freeze'}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={revealing}
        title={event.frozen ? 'Reveal the scoreboard' : 'Cancel the freeze'}
        message={event.frozen ? 'Everyone will see the live standings, including every solve since the freeze.' : 'The scoreboard will stay live until the end.'}
        confirmLabel={event.frozen ? 'Reveal' : 'Cancel freeze'}
        onConfirm={reveal}
        onClose={() => setRevealing(false)}
        busy={busy}
      />

      <ConfirmDialog
        open={pending !== null}
        title={pending?.label ?? ''}
        message={pending?.confirm}
        confirmLabel={pending?.label ?? 'Confirm'}
        danger={pending?.action === 'end'}
        busy={busy}
        onConfirm={() => pending && run(pending.action)}
        onClose={() => setPending(null)}
      />
    </section>
  );
}

export default function AdminDashboard() {
  const { event, scoreboard } = useLive();
  // Refreshes when the server pushes a change; no tight polling loop.
  const { data, error, loading, reload } = useApi<DashboardData>('/admin/dashboard', [event?.state, event?.participants, scoreboard?.generatedAt]);

  // "Active pirates" depends on the clock, so refresh gently in the background.
  useEffect(() => {
    const timer = window.setInterval(reload, 30_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  if (loading && !data) return <Spinner label="Reading the fleet reports…" />;
  if (error && !data) return <ErrorNote message={error.message} onRetry={reload} />;
  if (!data) return null;

  const { stats } = data;
  const accuracy = stats.submissions > 0 ? Math.round((stats.correctSubmissions / stats.submissions) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Registered Pirates"
          value={`${stats.registered} / ${stats.maxParticipants}`}
          hint={stats.registered >= stats.maxParticipants ? 'Registration is full' : `${stats.maxParticipants - stats.registered} berths left${stats.disabled ? ` · ${stats.disabled} disabled` : ''}`}
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
        />
        <StatCard label="Active Pirates" value={stats.active} hint={`last 15 min · ${stats.online} connected live`} icon={<Activity className="h-5 w-5" aria-hidden="true" />} />
        <StatCard label="Challenges" value={stats.challenges} hint={`${stats.enabledChallenges} enabled`} icon={<MapIcon className="h-5 w-5" aria-hidden="true" />} />
        <StatCard label="Submissions" value={stats.submissions} hint="all flag attempts" icon={<Flag className="h-5 w-5" aria-hidden="true" />} />
        <StatCard label="Correct Submissions" value={stats.correctSubmissions} hint={`${accuracy}% of attempts`} icon={<Target className="h-5 w-5" aria-hidden="true" />} />
      </div>

      <EventControl event={event ?? data.event} onChanged={reload} />

      <section className="panel p-6" aria-label="Export data">
        <h2 className="panel-title">Export Data (CSV)</h2>
        <p className="mt-2 text-sm text-slate-400">Downloads open in Excel or Google Sheets. Times are in UTC. Correct flags are never included — they are not stored.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {EXPORTS.map(({ kind, label, hint, icon: Icon }) => (
            <a key={kind} href={`/api/admin/export/${kind}`} download className="flex items-start gap-3 rounded-lg border border-navy-600 bg-navy-950/60 p-4 transition hover:border-accent-400 hover:bg-navy-800">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-accent-300" aria-hidden="true" />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
                  {label} <Download className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                </span>
                <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="panel p-6" aria-label="Recent submissions">
        <div className="flex items-center justify-between">
          <h2 className="panel-title">Recent Submissions</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={reload}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh
          </button>
        </div>
        {data.recentSubmissions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">No flags have been submitted yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="table-kop min-w-[32rem]">
              <thead>
                <tr>
                  <th scope="col">Pirate</th>
                  <th scope="col">Challenge</th>
                  <th scope="col">Result</th>
                  <th scope="col" className="text-right">
                    When
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.recentSubmissions.map((row) => (
                  <tr key={row.id}>
                    <td className="font-semibold text-slate-100">
                      {row.username}
                      {row.player && <span className="ml-1.5 text-xs font-normal text-slate-400">· {row.player}</span>}
                    </td>
                    <td className="text-slate-300">{row.challenge}</td>
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
                    <td className="text-right text-slate-400" title={dateTime(row.submittedAt)}>
                      {timeAgo(row.submittedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
