import { Anchor, Compass as CompassIcon, ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Page } from '../components/ui';

const SCREENS: Record<404 | 403 | 500, { title: string; message: string; icon: ReactNode }> = {
  404: {
    title: 'LOST AT SEA',
    message: "The route you're looking for disappeared somewhere beyond the Grand Line.",
    icon: <CompassIcon className="h-12 w-12" aria-hidden="true" />,
  },
  403: {
    title: 'MARINE TERRITORY',
    message: "You don't have permission to enter this area.",
    icon: <ShieldAlert className="h-12 w-12" aria-hidden="true" />,
  },
  500: {
    title: 'SHIPWRECK',
    message: 'Something went wrong aboard the ship.',
    icon: <Anchor className="h-12 w-12" aria-hidden="true" />,
  },
};

/**
 * `standalone` is used by the error boundary, which renders outside the
 * router — so it uses a plain link instead of <Link>.
 */
export function ErrorScreen({ code, standalone = false }: { code: 404 | 403 | 500; standalone?: boolean }) {
  const screen = SCREENS[code];
  return (
    <Page className={`flex items-center justify-center px-4 py-20 ${standalone ? 'min-h-screen bg-navy-950' : ''}`}>
      <div className="parchment w-full max-w-xl px-6 py-12 text-center sm:px-12">
        <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-full border-2 border-ink-900/60 text-blood-400">{screen.icon}</div>
        <h1 className="font-display text-3xl font-black tracking-[0.1em] text-ink-900 sm:text-4xl">
          {code} — {screen.title}
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-base text-ink-700">{screen.message}</p>
        <a href="/" className="btn-ink mt-8">
          Return to ship
        </a>
      </div>
    </Page>
  );
}

export function NotFoundPage() {
  return <ErrorScreen code={404} />;
}
