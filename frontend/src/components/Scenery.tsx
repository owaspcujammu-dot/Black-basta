/**
 * Original, hand-drawn SVG scenery in the event palette (blood red on black).
 * Purely decorative: every element is aria-hidden, and all movement is
 * CSS-only so it stays off the main thread.
 */
import { useBrandImage } from './Brand';

const WAVE_PATH = 'M0 40 C 150 10, 300 70, 600 40 C 900 10, 1050 70, 1200 40 L1200 120 L0 120 Z';

function WaveLayer({ className, fill, animation }: { className: string; fill: string; animation: string }) {
  return (
    <div className={`absolute inset-x-0 bottom-0 overflow-hidden ${className}`}>
      <div className={`flex w-[200%] ${animation}`} style={{ willChange: 'transform' }}>
        {[0, 1].map((copy) => (
          <svg key={copy} viewBox="0 0 1200 120" preserveAspectRatio="none" className="h-full w-1/2 shrink-0">
            <path d={WAVE_PATH} fill={fill} />
          </svg>
        ))}
      </div>
    </div>
  );
}

const PARTICLES = [
  { left: '6%', delay: '0s', size: 3 },
  { left: '14%', delay: '5s', size: 2 },
  { left: '23%', delay: '9s', size: 4 },
  { left: '31%', delay: '2s', size: 2 },
  { left: '42%', delay: '11s', size: 3 },
  { left: '51%', delay: '6s', size: 2 },
  { left: '60%', delay: '1s', size: 3 },
  { left: '68%', delay: '8s', size: 2 },
  { left: '77%', delay: '4s', size: 4 },
  { left: '85%', delay: '12s', size: 2 },
  { left: '93%', delay: '7s', size: 3 },
];

/** Fixed full-viewport backdrop: black sky, rising embers and a slow blood-dark sea. */
export function OceanBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 38% at 50% 108%, rgba(196,22,13,0.38), transparent 70%), radial-gradient(ellipse 90% 50% at 50% -18%, rgba(142,15,8,0.28) 0%, transparent 70%), linear-gradient(180deg, #030202 0%, #070506 55%, #100606 100%)',
        }}
      />
      {/* Faint chart grid, like a navigator's map */}
      <div
        className="absolute inset-0 opacity-[0.045]"
        style={{
          backgroundImage: 'linear-gradient(#e8281c 1px, transparent 1px), linear-gradient(90deg, #e8281c 1px, transparent 1px)',
          backgroundSize: '72px 72px',
        }}
      />
      {PARTICLES.map((particle, index) => (
        <span
          key={index}
          className="absolute bottom-0 animate-float-up rounded-full bg-blood-400"
          style={{ left: particle.left, width: particle.size, height: particle.size, animationDelay: particle.delay, opacity: 0 }}
        />
      ))}
      <WaveLayer className="h-28 opacity-45" fill="#5a0905" animation="animate-wave-slow" />
      <WaveLayer className="h-20 opacity-85" fill="#240605" animation="animate-wave-mid" />
      <WaveLayer className="h-12" fill="#080303" animation="animate-wave-fast" />
    </div>
  );
}

function Cloud({ className, duration, delay }: { className: string; duration: string; delay: string }) {
  return (
    <svg viewBox="0 0 300 90" className={`absolute left-0 animate-cloud-drift ${className}`} style={{ animationDuration: duration, animationDelay: delay }}>
      <g fill="#120a0a">
        <ellipse cx="90" cy="58" rx="80" ry="24" />
        <ellipse cx="150" cy="42" rx="62" ry="30" />
        <ellipse cx="215" cy="60" rx="72" ry="22" />
      </g>
    </svg>
  );
}

/** Blood moon and drifting clouds for the landing hero. Scrolls away with the hero. */
export function HeroSky() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute right-[10%] top-[8%] h-24 w-24 rounded-full bg-gradient-to-br from-blood-400 to-accent-600 opacity-90 shadow-[0_0_100px_40px_rgba(232,40,28,0.28)] sm:h-32 sm:w-32" />
      <Cloud className="top-[7%] w-72 opacity-90" duration="110s" delay="-20s" />
      <Cloud className="top-[19%] w-96 opacity-80" duration="150s" delay="-90s" />
      <Cloud className="top-[3%] w-56 opacity-80" duration="130s" delay="-60s" />
    </div>
  );
}

/** A two-masted ship with red sails. Generic by design — no emblem, no recognisable vessel. */
export function Ship({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 170" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="kop-sail" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e8281c" />
          <stop offset="1" stopColor="#6e0c06" />
        </linearGradient>
        <linearGradient id="kop-hull" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a1c1d" />
          <stop offset="1" stopColor="#0a0606" />
        </linearGradient>
      </defs>
      {/* masts and rigging */}
      <g stroke="#3a2a2b" strokeWidth="3" strokeLinecap="round">
        <path d="M88 14v106M140 30v90" />
        <path d="M88 20 L24 112M140 34 L196 110" strokeWidth="1" opacity="0.7" />
      </g>
      {/* sails */}
      <g stroke="#2a0503" strokeWidth="1">
        <path d="M58 28 Q90 22 116 28 Q124 50 116 70 Q88 76 58 70 Q66 50 58 28Z" fill="url(#kop-sail)" />
        <path d="M62 76 Q90 71 114 76 Q120 92 114 106 Q88 110 62 106 Q68 92 62 76Z" fill="url(#kop-sail)" />
        <path d="M120 44 Q142 39 162 44 Q168 64 162 84 Q140 88 120 84 Q126 64 120 44Z" fill="url(#kop-sail)" />
        <path d="M88 26 L28 108 L84 104Z" fill="#9b1109" opacity="0.9" />
      </g>
      {/* pennants */}
      <path d="M88 14 L112 19 L88 25Z" fill="#f4ecec" />
      <path d="M140 30 L158 34 L140 39Z" fill="#f4ecec" />
      {/* hull */}
      <path d="M14 112 H206 L186 144 Q110 158 34 144Z" fill="url(#kop-hull)" stroke="#5a0905" strokeWidth="1.5" />
      <path d="M18 118 H202" stroke="#e8281c" strokeWidth="2.5" />
      <g fill="#f4ecec" opacity="0.85">
        <circle cx="62" cy="130" r="3" />
        <circle cx="92" cy="132" r="3" />
        <circle cx="122" cy="132" r="3" />
        <circle cx="152" cy="130" r="3" />
      </g>
    </svg>
  );
}

/** Ship crossing the horizon of the landing page. */
export function SailingShip() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-10 h-36 overflow-hidden sm:bottom-14">
      <div className="absolute bottom-0 left-0 animate-ship-sail" style={{ willChange: 'transform' }}>
        <Ship className="h-28 w-36 animate-bob drop-shadow-[0_10px_18px_rgba(0,0,0,0.8)] sm:h-32 sm:w-44" />
      </div>
    </div>
  );
}

/** Open chest of silver and rubies with a red glow. */
function TreasureChest({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 200" className={className} role="img" aria-label="An open treasure chest overflowing with silver and rubies">
      <defs>
        <radialGradient id="kop-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ff5c50" stopOpacity="0.85" />
          <stop offset="0.5" stopColor="#c4160d" stopOpacity="0.32" />
          <stop offset="1" stopColor="#c4160d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="kop-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2e1f20" />
          <stop offset="1" stopColor="#0e0808" />
        </linearGradient>
        <linearGradient id="kop-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4ecec" />
          <stop offset="1" stopColor="#7d7174" />
        </linearGradient>
        <linearGradient id="kop-ruby" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5c50" />
          <stop offset="1" stopColor="#8e0f08" />
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="92" rx="112" ry="78" fill="url(#kop-glow)" className="animate-shimmer" />
      {/* open lid */}
      <path d="M44 86 Q48 26 120 22 Q192 26 196 86 L182 92 Q178 44 120 42 Q62 44 58 92Z" fill="url(#kop-wood)" stroke="#5a0905" strokeWidth="2" />
      <path d="M92 26 Q90 58 90 88 M148 26 Q150 58 150 88" stroke="url(#kop-metal)" strokeWidth="7" fill="none" />
      {/* treasure: pieces of eight and rubies */}
      <g fill="url(#kop-metal)" stroke="#4a4043" strokeWidth="1.2">
        <ellipse cx="82" cy="98" rx="15" ry="6" />
        <ellipse cx="108" cy="90" rx="15" ry="6" />
        <ellipse cx="136" cy="92" rx="15" ry="6" />
        <ellipse cx="160" cy="99" rx="15" ry="6" />
        <ellipse cx="96" cy="103" rx="15" ry="6" />
        <ellipse cx="124" cy="101" rx="15" ry="6" />
        <ellipse cx="148" cy="105" rx="15" ry="6" />
        <ellipse cx="120" cy="82" rx="13" ry="5" />
      </g>
      <g fill="url(#kop-ruby)" stroke="#3a0503" strokeWidth="1.2">
        <path d="M112 72 l8 -13 l8 13 l-8 10z" />
        <path d="M70 90 l6 -9 l6 9 l-6 7z" />
        <path d="M156 88 l6 -9 l6 9 l-6 7z" />
      </g>
      {/* chest body */}
      <path d="M40 104 H200 V170 Q200 178 192 178 H48 Q40 178 40 170Z" fill="url(#kop-wood)" stroke="#5a0905" strokeWidth="2" />
      <path d="M40 126 H200 M40 152 H200" stroke="#000" strokeWidth="1.5" opacity="0.6" />
      <path d="M40 104 H200 V116 H40Z" fill="url(#kop-metal)" stroke="#4a4043" strokeWidth="1.2" />
      <path d="M84 104 V178 M156 104 V178" stroke="url(#kop-metal)" strokeWidth="9" />
      <rect x="107" y="108" width="26" height="30" rx="5" fill="url(#kop-ruby)" stroke="#3a0503" strokeWidth="1.5" />
      <circle cx="120" cy="120" r="4" fill="#070506" />
      <path d="M118.5 121 h3 l1.5 9 h-6z" fill="#070506" />
    </svg>
  );
}

/**
 * Landing-page picture. Shows the organizer's ship image when one is supplied
 * (frontend/public/brand/ship.*), otherwise the treasure chest.
 */
export function VoyageArt() {
  const ship = useBrandImage('ship');
  if (!ship) return <TreasureChest className="w-full max-w-sm drop-shadow-[0_30px_40px_rgba(0,0,0,0.7)]" />;
  return (
    <figure className="relative w-full max-w-lg overflow-hidden rounded-xl border-2 border-accent-500/60 shadow-glow">
      <img src={ship} alt="The ship of the voyage" className="block aspect-[4/3] w-full object-cover" loading="lazy" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-abyss via-transparent to-transparent" />
    </figure>
  );
}

/** Compass rose with a slowly turning bezel. */
export function Compass({ className = '' }: { className?: string }) {
  const ticks = Array.from({ length: 48 }, (_, index) => index);
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <circle cx="100" cy="100" r="96" fill="none" stroke="#e8281c" strokeOpacity="0.5" strokeWidth="1.5" />
      <g className="origin-center animate-spin-slow" style={{ transformBox: 'fill-box' }}>
        <circle cx="100" cy="100" r="86" fill="none" stroke="#e8281c" strokeOpacity="0.25" strokeWidth="1" />
        {ticks.map((tick) => (
          <line
            key={tick}
            x1="100"
            y1="14"
            x2="100"
            y2={tick % 4 === 0 ? 26 : 20}
            stroke="#e8281c"
            strokeOpacity={tick % 4 === 0 ? 0.8 : 0.4}
            strokeWidth={tick % 4 === 0 ? 1.6 : 1}
            transform={`rotate(${tick * 7.5} 100 100)`}
          />
        ))}
      </g>
      <g fill="#e8281c" fillOpacity="0.35">
        <path d="M100 100 L112 112 L100 176 L88 112Z" transform="rotate(45 100 100)" />
        <path d="M100 100 L112 112 L100 176 L88 112Z" transform="rotate(135 100 100)" />
        <path d="M100 100 L112 112 L100 176 L88 112Z" transform="rotate(225 100 100)" />
        <path d="M100 100 L112 112 L100 176 L88 112Z" transform="rotate(315 100 100)" />
      </g>
      <path d="M100 30 L112 100 L100 170 L88 100Z" fill="#e8281c" fillOpacity="0.75" />
      <path d="M30 100 L100 88 L170 100 L100 112Z" fill="#e8281c" fillOpacity="0.55" />
      <path d="M100 30 L112 100 L88 100Z" fill="#ff5c50" />
      <circle cx="100" cy="100" r="7" fill="#070506" stroke="#e8281c" strokeWidth="2" />
    </svg>
  );
}

/** Ship's wheel used as the loading indicator and section ornament. */
export function ShipWheelMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <circle cx="32" cy="32" r="18" />
      <circle cx="32" cy="32" r="5" fill="currentColor" />
      <path d="M32 4v20M32 40v20M4 32h20M40 32h20M12.2 12.2l14.1 14.1M37.7 37.7l14.1 14.1M51.8 12.2L37.7 26.3M26.3 37.7L12.2 51.8" />
    </svg>
  );
}
