import { motion } from 'framer-motion';
import { Anchor, Flag, Map as MapIcon, ScrollText, Swords, Trophy, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Emblem } from '../components/Brand';
import { Compass, HeroSky, SailingShip, VoyageArt } from '../components/Scenery';
import { BigCountdown, EventBadge } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';

const CATEGORIES = ['Web', 'Cryptography', 'Reverse Engineering', 'Forensics', 'OSINT', 'Pwn', 'Misc', 'Mobile', 'Cloud', 'Steganography'];

const rise = {
  hidden: { opacity: 0, y: 22 },
  show: (delay: number) => ({ opacity: 1, y: 0, transition: { duration: 0.55, delay, ease: 'easeOut' as const } }),
};

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <motion.div
      className="panel p-6"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.45 }}
    >
      <span className="grid h-11 w-11 place-items-center rounded-lg border border-accent-500/30 bg-navy-950 text-accent-300">{icon}</span>
      <h3 className="mt-4 text-lg font-bold uppercase tracking-[0.12em] text-accent-200">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">{children}</p>
    </motion.div>
  );
}

export default function Landing() {
  const { user } = useAuth();
  const { event } = useLive();
  const full = event ? event.participants >= event.maxParticipants : false;
  const enterTo = user ? (user.role === 'admin' ? '/admin' : '/dashboard') : full || !event?.registrationOpen ? '/login' : '/register';

  return (
    <>
      {/* ---- Hero ------------------------------------------------------- */}
      <section className="relative isolate flex min-h-[calc(100vh-7rem)] items-center overflow-hidden px-4 pb-44 pt-14">
        <HeroSky />
        <Compass className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[min(120vw,46rem)] w-[min(120vw,46rem)] -translate-x-1/2 -translate-y-[55%] opacity-[0.13]" />

        <div className="mx-auto max-w-4xl text-center">
          <motion.div variants={rise} initial="hidden" animate="show" custom={0} className="flex justify-center">
            <Emblem className="h-28 w-28 drop-shadow-[0_0_26px_rgba(232,40,28,0.6)] sm:h-36 sm:w-36" />
          </motion.div>

          <motion.h1 variants={rise} initial="hidden" animate="show" custom={0.08} className="mt-6 text-5xl font-black uppercase leading-[1.05] tracking-[0.08em] text-accent-gradient sm:text-7xl">
            Black Basta
          </motion.h1>
          <motion.p variants={rise} initial="hidden" animate="show" custom={0.16} className="mt-4 font-display text-base font-bold uppercase tracking-[0.5em] text-ocean-200 sm:text-xl">
            Cybersecurity CTF
          </motion.p>

          <motion.p variants={rise} initial="hidden" animate="show" custom={0.24} className="mt-8 font-display text-2xl text-slate-100 sm:text-3xl">
            The Grand Line awaits.
          </motion.p>
          <motion.p variants={rise} initial="hidden" animate="show" custom={0.32} className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-display text-lg font-bold uppercase tracking-[0.3em] sm:text-xl">
            <span className="text-slate-100">Solve.</span>
            <span className="text-blood-400">Hack.</span>
            <span className="text-slate-100">Conquer.</span>
          </motion.p>
          <motion.p variants={rise} initial="hidden" animate="show" custom={0.4} className="mt-4 text-lg text-slate-300">
            Claim the treasure.
          </motion.p>

          <motion.div variants={rise} initial="hidden" animate="show" custom={0.5} className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link to={enterTo} className="btn-accent px-7 py-3.5 text-base">
              <Anchor className="h-5 w-5" aria-hidden="true" /> Enter the Grand Line
            </Link>
            <Link to="/rules" className="btn-ghost px-7 py-3.5 text-base">
              <ScrollText className="h-5 w-5" aria-hidden="true" /> View Rules
            </Link>
          </motion.div>

          {event && (
            <motion.div variants={rise} initial="hidden" animate="show" custom={0.6} className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-300">
              <EventBadge state={event.state} />
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4 text-ocean-300" aria-hidden="true" />
                <span className="tabular font-mono font-semibold text-slate-100">
                  {event.participants} / {event.maxParticipants}
                </span>
                pirates aboard
              </span>
            </motion.div>
          )}
        </div>

        <SailingShip />
      </section>

      {/* ---- Countdown -------------------------------------------------- */}
      <section className="relative z-10 border-y border-accent-500/15 bg-navy-950/70 px-4 py-14 backdrop-blur-sm" aria-label="Event countdown">
        <BigCountdown />
      </section>

      {/* ---- Treasure --------------------------------------------------- */}
      <section className="relative z-10 mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-2">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="flex justify-center">
          <VoyageArt />
        </motion.div>
        <div>
          <p className="panel-title">The voyage</p>
          <h2 className="mt-3 text-3xl font-black uppercase leading-tight tracking-[0.06em] text-slate-50 sm:text-4xl">
            Set sail across the Grand Line. Solve challenges. <span className="text-accent-gradient">Claim the treasure.</span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-slate-300">
            A jeopardy-style Capture The Flag for up to {event?.maxParticipants ?? 110} pirates. Every challenge hides one treasure — a flag — somewhere in a web app, a binary, a packet
            capture or a cipher. Find it, submit it, and climb the leaderboard.
          </p>
          <p className="mt-7 flex flex-wrap items-center gap-3 text-sm text-slate-300">
            <span className="font-display text-xs font-bold uppercase tracking-[0.22em] text-accent-300">Flag format</span>
            <code className="rounded-md border border-accent-500/40 bg-abyss px-3 py-1.5 font-mono text-base font-bold text-accent-200">{event?.flagFormat ?? 'NIKA{...}'}</code>
          </p>
        </div>
      </section>

      {/* ---- Features --------------------------------------------------- */}
      <section className="relative z-10 mx-auto max-w-6xl px-4 pb-8">
        <div className="grid gap-5 md:grid-cols-3">
          <Feature icon={<MapIcon className="h-5 w-5" aria-hidden="true" />} title="Treasure Map">
            Challenges across ten categories, from Easy to Insane. Each one is a bounty waiting to be claimed.
          </Feature>
          <Feature icon={<Trophy className="h-5 w-5" aria-hidden="true" />} title="Live Leaderboard">
            The Grand Line Leaderboard updates the instant a flag lands. Ties go to whoever got there first.
          </Feature>
          <Feature icon={<Swords className="h-5 w-5" aria-hidden="true" />} title="First Blood">
            Be the first pirate to crack a challenge and your name is carved on it for the rest of the voyage.
          </Feature>
        </div>

        <div className="mt-14 text-center">
          <p className="panel-title">Seas to conquer</p>
          <ul className="mt-5 flex flex-wrap justify-center gap-2.5">
            {CATEGORIES.map((category) => (
              <li key={category} className="chip border-ocean-500/50 bg-navy-900/70 px-3.5 py-1.5 text-ocean-200">
                <Flag className="h-3 w-3" aria-hidden="true" /> {category}
              </li>
            ))}
          </ul>
        </div>

        <motion.blockquote
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="mx-auto mt-16 max-w-3xl text-center font-display text-xl italic leading-relaxed text-slate-200 sm:text-2xl"
        >
          “The Grand Line awaits. Only the strongest pirates will claim the One Piece.”
          <footer className="mt-4 text-sm font-bold uppercase not-italic tracking-[0.3em] text-accent-300">Become the Pirate King</footer>
        </motion.blockquote>
      </section>
    </>
  );
}
