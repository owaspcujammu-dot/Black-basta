import { useEffect, useState } from 'react';

/**
 * Brand image slots.
 *
 * Drop your own artwork into frontend/public/brand/ and it is used
 * automatically — no code change:
 *
 *   emblem.png | emblem.svg | emblem.webp | emblem.jpg   → logo (header, hero, login)
 *   ship.png   | ship.webp  | ship.jpg                   → ship picture on the landing page
 *
 * Until a file exists, the original drawings in this project are shown.
 * Only use artwork you have the right to use.
 */
const CANDIDATES: Record<'emblem' | 'ship', string[]> = {
  emblem: ['emblem.png', 'emblem.svg', 'emblem.webp', 'emblem.jpg'],
  ship: ['ship.png', 'ship.webp', 'ship.jpg'],
};

const cache = new Map<string, Promise<string | null>>();

function probe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

function findBrandImage(slot: 'emblem' | 'ship'): Promise<string | null> {
  let pending = cache.get(slot);
  if (!pending) {
    pending = (async () => {
      for (const file of CANDIDATES[slot]) {
        const url = `/brand/${file}`;
        if (await probe(url)) return url;
      }
      return null;
    })();
    cache.set(slot, pending);
  }
  return pending;
}

/** URL of the organizer-supplied image for a slot, or null when there is none. */
export function useBrandImage(slot: 'emblem' | 'ship'): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void findBrandImage(slot).then((found) => active && setUrl(found));
    return () => {
      active = false;
    };
  }, [slot]);
  return url;
}

/** Original skull and crossbones with a red bandana. */
function JollyRoger({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      {/* crossed bones */}
      <g fill="#f4ecec" stroke="#070506" strokeWidth="2.2" strokeLinejoin="round">
        <g transform="rotate(38 50 54)">
          <rect x="6" y="50" width="88" height="8" rx="4" />
          <circle cx="8" cy="49" r="6" />
          <circle cx="8" cy="59" r="6" />
          <circle cx="92" cy="49" r="6" />
          <circle cx="92" cy="59" r="6" />
        </g>
        <g transform="rotate(-38 50 54)">
          <rect x="6" y="50" width="88" height="8" rx="4" />
          <circle cx="8" cy="49" r="6" />
          <circle cx="8" cy="59" r="6" />
          <circle cx="92" cy="49" r="6" />
          <circle cx="92" cy="59" r="6" />
        </g>
      </g>
      {/* skull */}
      <path
        d="M50 16 C31 16 22 29 22 43 C22 53 27 60 34 64 L34 72 Q34 78 40 78 L60 78 Q66 78 66 72 L66 64 C73 60 78 53 78 43 C78 29 69 16 50 16Z"
        fill="#f4ecec"
        stroke="#070506"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <ellipse cx="39" cy="47" rx="8" ry="9" fill="#070506" />
      <ellipse cx="61" cy="47" rx="8" ry="9" fill="#070506" />
      <path d="M50 55 L46 63 L54 63Z" fill="#070506" />
      <path d="M40 70 V78 M46.5 70 V78 M53.5 70 V78 M60 70 V78 M36 70 H64" stroke="#070506" strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* bandana */}
      <path d="M22.5 37 C25 23 36 15 50 15 C64 15 75 23 77.5 37 C60 31 40 31 22.5 37Z" fill="#c4160d" stroke="#070506" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M76 33 L90 28 L84 38 L92 44 L77 40Z" fill="#c4160d" stroke="#070506" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

/** The event emblem: the organizer's image when supplied, otherwise the original drawing. */
export function Emblem({ className = '' }: { className?: string }) {
  const custom = useBrandImage('emblem');
  if (custom) {
    // A light disc keeps artwork with a white or transparent background readable on black.
    return <img src={custom} alt="" aria-hidden="true" className={`${className} rounded-full bg-[#f4ecec] object-contain p-[6%]`} />;
  }
  return <JollyRoger className={className} />;
}
