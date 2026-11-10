import { ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import { Page } from '../components/ui';
import { useLive } from '../context/LiveContext';
import { Container } from '../layouts/Shell';

export default function Rules() {
  const { event } = useLive();
  const flagFormat = event?.flagFormat ?? 'NIKA{...}';

  const rules: ReactNode[] = [
    'Each participant must use their registered account.',
    <>
      Flag format is: <code className="rounded border border-accent-500/40 bg-abyss px-2 py-0.5 font-mono text-sm font-bold text-accent-200">{flagFormat}</code>
    </>,
    'Do not attack the CTF infrastructure.',
    'Do not attack other participants.',
    'Do not perform denial-of-service attacks.',
    'Do not attempt to access the admin panel.',
    'Do not share flags during the competition.',
    'Do not destroy or modify challenge infrastructure.',
    'Only attack systems explicitly included within a challenge.',
    'Organizers reserve the right to disqualify participants violating the rules.',
  ];

  return (
    <Page>
      <Container narrow>
        <article className="parchment px-6 py-10 sm:px-12 sm:py-12">
          <header className="border-b-2 border-ink-900/30 pb-6 text-center">
            <ScrollText className="mx-auto h-10 w-10 text-ink-700" aria-hidden="true" />
            <h1 className="mt-3 font-display text-3xl font-black tracking-[0.1em] text-ink-900 sm:text-4xl">BLACK BASTA — RULES</h1>
            <p className="mt-2 font-display text-sm uppercase tracking-[0.3em] text-ink-500">The pirate code of the Grand Line</p>
          </header>

          <ol className="mt-8 space-y-5">
            {rules.map((rule, index) => (
              <li key={index} className="flex gap-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-ink-900/70 font-display text-base font-black text-ink-900" aria-hidden="true">
                  {index + 1}
                </span>
                <p className="pt-1 text-base leading-relaxed text-ink-900">
                  <span className="sr-only">Rule {index + 1}: </span>
                  {rule}
                </p>
              </li>
            ))}
          </ol>

          <footer className="mt-10 border-t-2 border-ink-900/30 pt-6 text-sm leading-relaxed text-ink-700">
            <p>
              <strong>Scoring.</strong> A challenge awards points once per crew. Most have a fixed bounty; challenges marked “drops as crews solve” start high and lose value with every solve — for every crew that solved them, early or late. On a tie, the crew that reached the score first ranks higher.
              {event && event.firstBloodBonus > 0 && <> The first pirate to solve a challenge earns a first-blood bonus of +{event.firstBloodBonus}.</>}
            </p>
            {event?.freezeAt && (
              <p className="mt-3">
                <strong>Scoreboard freeze.</strong> Near the end the scoreboard freezes: everyone sees the standings as they were at that moment. Flags still count, and your own bounty keeps updating on your Captain’s Deck. The final results are revealed by the organizers.
              </p>
            )}
            <p className="mt-3">
              <strong>Hints.</strong> Some hints cost bounty. The cost is shown before you reveal one and is deducted from your score.
            </p>
            <p className="mt-3">
              <strong>Fair play.</strong> Flag submissions are rate-limited. Brute-forcing flags will only lock you out.
            </p>
            <p className="mt-3">
              <strong>Teams.</strong> A team has at most {event?.maxTeamSize ?? 4} players and shares one login, which can be used on at most {event?.maxTeamSize ?? 4} devices at the same time.
            </p>
          </footer>
        </article>
      </Container>
    </Page>
  );
}
