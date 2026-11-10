import { Check, Flag, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PasswordField } from '../components/PasswordField';
import { ErrorNote, Page } from '../components/ui';
import { useAuth, type RegisterInput } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';
import { ApiError, errorMessage } from '../services/api';

const EMPTY: RegisterInput = { username: '', fullName: '', email: '', password: '', confirmPassword: '', teamName: '' };

const PASSWORD_RULES: [string, (value: string) => boolean][] = [
  ['At least 8 characters', (value) => value.length >= 8],
  ['An uppercase letter', (value) => /[A-Z]/.test(value)],
  ['A lowercase letter', (value) => /[a-z]/.test(value)],
  ['A number', (value) => /\d/.test(value)],
];

function GrandLineFull({ max }: { max: number }) {
  return (
    <div className="parchment mx-auto w-full max-w-lg px-7 py-10 text-center">
      <Flag className="mx-auto h-12 w-12 text-blood-400" aria-hidden="true" />
      <h1 className="mt-4 font-display text-3xl font-black tracking-[0.06em] text-ink-900">🏴‍☠️ The Grand Line is Full!</h1>
      <p className="mt-4 text-base leading-relaxed text-ink-700">
        Registration for Black Basta has reached its maximum capacity of <strong>{max} pirates</strong>.
      </p>
      <p className="mt-2 text-sm text-ink-500">Already part of the crew? You can still board.</p>
      <Link to="/login" className="btn-ink mt-7">
        Board the Ship
      </Link>
    </div>
  );
}

export default function Register() {
  const { register } = useAuth();
  const { event } = useLive();
  const navigate = useNavigate();
  const [form, setForm] = useState<RegisterInput>(EMPTY);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [full, setFull] = useState(false);

  const max = event?.maxParticipants ?? 110;
  if (event && !event.registrationOpen) {
    return (
      <Page className="flex items-center justify-center px-4 py-16">
        <div className="parchment mx-auto w-full max-w-lg px-7 py-10 text-center">
          <h1 className="font-display text-3xl font-black tracking-[0.06em] text-ink-900">Registration is closed</h1>
          <p className="mt-4 text-base leading-relaxed text-ink-700">Teams are registered by the organizers. Your team name and password are provided to you directly.</p>
          <Link to="/login" className="btn-ink mt-7">
            Board the Ship
          </Link>
        </div>
      </Page>
    );
  }
  if (full || (event && event.participants >= event.maxParticipants)) {
    return (
      <Page className="flex items-center justify-center px-4 py-16">
        <GrandLineFull max={max} />
      </Page>
    );
  }

  const set = (key: keyof RegisterInput) => (event: { target: { value: string } }) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    setFields((current) => ({ ...current, [key]: '' }));
  };

  const onSubmit = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    setError(null);
    if (form.password !== form.confirmPassword) {
      setFields({ confirmPassword: 'Passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      await register({ ...form, teamName: form.teamName?.trim() || undefined });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'REGISTRATION_FULL') {
        setFull(true);
        return;
      }
      if (err instanceof ApiError) {
        const next = { ...err.fields };
        if (err.code === 'USERNAME_TAKEN') next.username = err.message;
        if (err.code === 'EMAIL_TAKEN') next.email = err.message;
        setFields(next);
        if (Object.keys(next).length === 0) setError(err.message);
      } else {
        setError(errorMessage(err));
      }
      setBusy(false);
    }
  };

  const input = (key: keyof RegisterInput, label: string, { type, ...props }: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => {
    const shared = {
      id: key,
      className: `field ${fields[key] ? 'border-blood-400' : ''}`,
      value: form[key] ?? '',
      onChange: set(key),
      'aria-invalid': Boolean(fields[key]),
      'aria-describedby': fields[key] ? `${key}-error` : hint ? `${key}-hint` : undefined,
      ...props,
    };
    return (
    <div>
      <label htmlFor={key} className="field-label">
        {label}
      </label>
      {type === 'password' ? <PasswordField {...shared} /> : <input type={type} {...shared} />}
      {fields[key] ? (
        <p id={`${key}-error`} className="field-error" role="alert">
          {fields[key]}
        </p>
      ) : (
        hint && (
          <p id={`${key}-hint`} className="mt-1.5 text-xs text-slate-500">
            {hint}
          </p>
        )
      )}
    </div>
    );
  };

  return (
    <Page className="flex items-center justify-center px-4 py-12">
      <div className="panel w-full max-w-2xl p-7 sm:p-9">
        <div className="mb-7 text-center">
          <h1 className="text-3xl font-black uppercase tracking-[0.14em] text-accent-gradient">Join the Crew</h1>
          <p className="mt-2 text-sm text-slate-400">Sign your name in the ship's log to enter the Grand Line.</p>
          {event && (
            <p className="tabular mt-3 inline-flex items-center gap-2 rounded-full border border-accent-500/30 bg-navy-950/70 px-3.5 py-1 font-mono text-xs text-accent-200">
              {event.participants} / {event.maxParticipants} berths taken
            </p>
          )}
        </div>

        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {error && <ErrorNote message={error} />}

          <div className="grid gap-5 sm:grid-cols-2">
            {input('username', 'Username', { autoComplete: 'username', required: true, maxLength: 24, autoFocus: true }, '3–24 characters: letters, numbers, . _ -')}
            {input('fullName', 'Full Name', { autoComplete: 'name', required: true, maxLength: 80 })}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {input('email', 'Email', { type: 'email', autoComplete: 'email', required: true, maxLength: 254 })}
            {input('teamName', 'Team Name (optional)', { autoComplete: 'organization', maxLength: 50 })}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {input('password', 'Password', { type: 'password', autoComplete: 'new-password', required: true, maxLength: 72 })}
            {input('confirmPassword', 'Confirm Password', { type: 'password', autoComplete: 'new-password', required: true, maxLength: 72 })}
          </div>

          <ul className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2" aria-label="Password requirements">
            {PASSWORD_RULES.map(([label, test]) => {
              const ok = test(form.password);
              return (
                <li key={label} className={`flex items-center gap-2 ${ok ? 'text-jade-300' : 'text-slate-400'}`}>
                  {ok ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
                  <span>
                    {label}
                    <span className="sr-only">{ok ? ' — met' : ' — not met yet'}</span>
                  </span>
                </li>
              );
            })}
          </ul>

          <button type="submit" className="btn-accent w-full py-3" disabled={busy}>
            {busy ? 'Signing the log…' : 'Enter the Grand Line'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already aboard?{' '}
          <Link to="/login" className="font-semibold text-accent-300 underline-offset-4 hover:underline">
            Board the ship
          </Link>
        </p>
      </div>
    </Page>
  );
}
