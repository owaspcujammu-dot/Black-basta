import { Anchor, KeyRound, Swords, User as UserIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Emblem } from '../components/Brand';
import { PasswordField } from '../components/PasswordField';
import { ErrorNote, Page } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';
import { errorMessage } from '../services/api';

const PLAYER_KEY = 'bb.player';

function rememberedPlayer(): string {
  try {
    return localStorage.getItem(PLAYER_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function Login() {
  const { login } = useAuth();
  const { event } = useLive();
  const registrationOpen = event?.registrationOpen ?? false;
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [player, setPlayer] = useState(rememberedPlayer);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user = await login(identifier.trim(), password, registrationOpen ? undefined : player.trim());
      try {
        if (user.player) localStorage.setItem(PLAYER_KEY, user.player);
      } catch {
        // Storage unavailable: nothing to remember.
      }
      const from = (location.state as { from?: string } | null)?.from;
      // Only ever follow an internal path.
      const target = from && from.startsWith('/') && !from.startsWith('//') ? from : user.role === 'admin' ? '/admin' : '/dashboard';
      navigate(target, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Page className="flex items-center justify-center px-4 py-14">
      <div className="panel w-full max-w-md p-7 sm:p-9">
        <div className="mb-7 text-center">
          <Emblem className="mx-auto h-20 w-20" />
          <h1 className="mt-4 text-3xl font-black uppercase tracking-[0.14em] text-accent-gradient">Board the Ship</h1>
          <p className="mt-2 text-sm text-slate-400">Log in to return to the Grand Line.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {error && <ErrorNote message={error} />}

          <div>
            <label htmlFor="identifier" className="field-label">
              Team Name
            </label>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input
                id="identifier"
                className="field pl-10"
                autoComplete="username"
                placeholder="Your team name"
                autoFocus
                required
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="field-label">
              Password
            </label>
            <PasswordField
              id="password"
              icon={<KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />}
              className="field pl-10"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {!registrationOpen && (
            <div>
              <label htmlFor="player" className="field-label">
                Player Name
              </label>
              <div className="relative">
                <Swords className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <input
                  id="player"
                  className="field pl-10"
                  autoComplete="nickname"
                  placeholder="Your own name in the team"
                  maxLength={60}
                  value={player}
                  onChange={(event) => setPlayer(event.target.value)}
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">Flags you capture are credited to this name. Organizers can leave it blank.</p>
            </div>
          )}

          <button type="submit" className="btn-accent w-full py-3" disabled={busy || !identifier || !password}>
            <Anchor className="h-4 w-4" aria-hidden="true" /> {busy ? 'Setting sail…' : 'Set Sail'}
          </button>
        </form>

        {registrationOpen ? (
          <p className="mt-6 text-center text-sm text-slate-400">
            No crew yet?{' '}
            <Link to="/register" className="font-semibold text-accent-300 underline-offset-4 hover:underline">
              Join the voyage
            </Link>
          </p>
        ) : (
          <p className="mt-6 text-center text-sm text-slate-400">Your team name and password are provided by the organizers.</p>
        )}
      </div>
    </Page>
  );
}
