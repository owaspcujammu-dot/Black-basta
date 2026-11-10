import { Megaphone, Send, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ConfirmDialog, EmptyState, ErrorNote, Spinner } from '../../components/ui';
import { useLive } from '../../context/LiveContext';
import { useToast } from '../../context/ToastContext';
import { useApi } from '../../hooks/useApi';
import { ApiError, api, errorMessage } from '../../services/api';
import type { Announcement } from '../../services/types';
import { dateTime } from '../../utils/format';

export default function AdminAnnouncements() {
  const { toast } = useToast();
  const { announcementVersion } = useLive();
  const { data, error, loading, reload } = useApi<{ announcements: Announcement[] }>('/announcements', [announcementVersion]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Announcement | null>(null);

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFields({});
    try {
      await api.post('/admin/announcements', { title, message });
      setTitle('');
      setMessage('');
      reload();
    } catch (err) {
      if (err instanceof ApiError) setFields(err.fields);
      toast('error', 'Could not publish', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/admin/announcements/${deleting.id}`);
      toast('success', 'Announcement deleted');
      reload();
    } catch (err) {
      toast('error', 'Could not delete', errorMessage(err));
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[24rem_minmax(0,1fr)]">
      <form onSubmit={publish} className="panel self-start p-6" noValidate>
        <h2 className="panel-title">Publish Announcement</h2>
        <p className="mt-2 text-xs text-slate-400">Pushed instantly to every logged-in pirate and kept on their dashboard.</p>

        <div className="mt-5">
          <label htmlFor="a-title" className="field-label">
            Announcement title
          </label>
          <input id="a-title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="NEW CHALLENGE RELEASED!" required />
          {fields.title && <p className="field-error">{fields.title}</p>}
        </div>
        <div className="mt-4">
          <label htmlFor="a-message" className="field-label">
            Message
          </label>
          <textarea
            id="a-message"
            className="field min-h-[9rem]"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={4000}
            placeholder="A new Reverse Engineering challenge has appeared on the Grand Line."
            required
          />
          {fields.message && <p className="field-error">{fields.message}</p>}
        </div>
        <button type="submit" className="btn-accent mt-5 w-full" disabled={busy || !title.trim() || !message.trim()}>
          <Send className="h-4 w-4" aria-hidden="true" /> {busy ? 'Publishing…' : 'Publish'}
        </button>
      </form>

      <section aria-label="Published announcements">
        {loading && !data ? (
          <Spinner label="Unrolling the scrolls…" />
        ) : error && !data ? (
          <ErrorNote message={error.message} onRetry={reload} />
        ) : data && data.announcements.length === 0 ? (
          <EmptyState icon={<Megaphone className="h-10 w-10" aria-hidden="true" />} title="No messages from the captain." hint="Announcements you publish appear here." />
        ) : (
          <ul className="space-y-3">
            {data?.announcements.map((item) => (
              <li key={item.id} className="panel p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="break-words font-sans text-base font-bold tracking-normal text-accent-200">📢 {item.title}</h3>
                    <time dateTime={item.createdAt} className="text-xs text-slate-500">
                      {dateTime(item.createdAt)}
                    </time>
                  </div>
                  <button type="button" className="rounded p-1.5 text-slate-400 hover:bg-navy-700 hover:text-blood-300" onClick={() => setDeleting(item)} aria-label={`Delete announcement: ${item.title}`}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300">{item.message}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete announcement"
        message={deleting && <>Delete “{deleting.title}”? It disappears from every pirate's dashboard.</>}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
