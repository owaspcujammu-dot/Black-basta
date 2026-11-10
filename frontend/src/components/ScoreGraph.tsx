import { LineChart } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useApi } from '../hooks/useApi';
import type { ScoreHistory, ScoreHistorySeries } from '../services/types';
import { ErrorNote, Spinner } from './ui';

const HEIGHT = 280;
const PAD = { top: 14, right: 18, bottom: 30, left: 48 };
const MINUTE = 60_000;
const TIME_STEPS = [5_000, 10_000, 15_000, 30_000, ...[1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map((m) => m * MINUTE)];

const color = (slot: number) => `var(--series-${slot + 1})`;

/**
 * Colour follows the team, not its rank: a team keeps its slot while it stays on
 * the graph, and a newcomer takes the first free slot (so overtakes never repaint lines).
 */
function useStableSlots(series: ScoreHistorySeries[]): Map<number, number> {
  const slots = useRef(new Map<number, number>());
  return useMemo(() => {
    const present = new Set(series.map((s) => s.userId));
    for (const id of [...slots.current.keys()]) if (!present.has(id)) slots.current.delete(id);
    const used = new Set(slots.current.values());
    for (const s of series) {
      if (slots.current.has(s.userId)) continue;
      let slot = 0;
      while (used.has(slot)) slot++;
      slots.current.set(s.userId, slot);
      used.add(slot);
    }
    return new Map(slots.current);
  }, [series]);
}

/** Tracks an element's width; a callback ref, because the chart mounts only after its data loads. */
function useWidth() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width] as const;
}

function niceMax(value: number): { max: number; step: number } {
  if (value <= 0) return { max: 100, step: 25 };
  const rough = value / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  return { max: Math.ceil(value / step) * step, step };
}

/** Score just after time t (the step line's value there). */
function scoreAt(series: ScoreHistorySeries, t: number): number {
  let score = 0;
  for (const point of series.points) {
    if (Date.parse(point.at) > t) break;
    score = point.score;
  }
  return score;
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayClock = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const secondClock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Score progression of the leading crews: one stepped line per crew. */
export function ScoreGraph({ refreshKey }: { refreshKey: unknown }) {
  const { data, error, loading, reload } = useApi<ScoreHistory>('/scoreboard/history', [refreshKey]);
  const series = useMemo(() => data?.series ?? [], [data]);
  const slots = useStableSlots(series);
  const [wrapper, width] = useWidth();
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (!data || series.length === 0 || width === 0) return null;
    const firstPoint = Math.min(...series.map((s) => Date.parse(s.points[0]?.at ?? data.to)));
    const from = data.from ? Math.min(Date.parse(data.from), firstPoint) : firstPoint - MINUTE;
    const to = Math.max(Date.parse(data.to), from + MINUTE);
    const top = Math.max(...series.flatMap((s) => s.points.map((p) => p.score)), 0);
    const y = niceMax(top);
    const plotW = Math.max(10, width - PAD.left - PAD.right);
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const sx = (t: number) => PAD.left + ((t - from) / (to - from)) * plotW;
    const sy = (v: number) => PAD.top + plotH - (Math.max(0, v) / y.max) * plotH;

    const timeStep = TIME_STEPS.find((step) => (to - from) / step <= Math.max(2, Math.floor(plotW / 110))) ?? TIME_STEPS.at(-1)!;
    const timeTicks: number[] = [];
    for (let t = Math.ceil(from / timeStep) * timeStep; t <= to; t += timeStep) timeTicks.push(t);
    const valueTicks: number[] = [];
    for (let v = 0; v <= y.max; v += y.step) valueTicks.push(v);

    // Crosshair positions: the start, every score change, and now/the end.
    const times = [...new Set([from, ...series.flatMap((s) => s.points.map((p) => Date.parse(p.at))), to])].sort((a, b) => a - b);
    const paths = series.map((s) => {
      let d = `M${sx(from)},${sy(0)}`;
      for (const point of s.points) d += `H${sx(Date.parse(point.at))}V${sy(point.score)}`;
      return { userId: s.userId, d: `${d}H${sx(to)}`, end: { x: sx(to), y: sy(s.points.at(-1)?.score ?? 0) } };
    });
    const span = to - from;
    const format = span > 20 * 3_600_000 ? dayClock : span < 15 * MINUTE ? secondClock : clock;
    return { from, to, sx, sy, plotW, plotH, timeTicks, valueTicks, times, paths, format };
  }, [data, series, width]);

  if (loading && !data) return <Spinner label="Charting the course…" />;
  if (error && !data) return <ErrorNote message={error.message} onRetry={reload} />;
  if (series.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-400">The graph appears once the first treasure is claimed.</p>;
  }

  const hovered = geometry && focusIndex !== null ? geometry.times[Math.min(focusIndex, geometry.times.length - 1)] : null;
  const readout =
    hovered === null
      ? []
      : series
          .map((s) => ({ s, score: scoreAt(s, hovered) }))
          .sort((a, b) => b.score - a.score || a.s.rank - b.s.rank);

  const nearestIndex = (clientX: number, element: Element) => {
    if (!geometry) return null;
    const box = element.getBoundingClientRect();
    const t = geometry.from + ((clientX - box.left - PAD.left) / geometry.plotW) * (geometry.to - geometry.from);
    let best = 0;
    for (let i = 1; i < geometry.times.length; i++) if (Math.abs(geometry.times[i] - t) < Math.abs(geometry.times[best] - t)) best = i;
    return best;
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => setFocusIndex(nearestIndex(event.clientX, event.currentTarget));
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const last = geometry.times.length - 1;
    if (event.key === 'ArrowRight') setFocusIndex((i) => Math.min(last, (i ?? -1) + 1));
    else if (event.key === 'ArrowLeft') setFocusIndex((i) => Math.max(0, (i ?? last + 1) - 1));
    else if (event.key === 'Escape') setFocusIndex(null);
    else return;
    event.preventDefault();
  };

  const tipX = hovered !== null && geometry ? geometry.sx(hovered) : 0;
  const tipOnLeft = geometry ? tipX > PAD.left + geometry.plotW * 0.6 : false;
  const allPoints = series
    .flatMap((s) => s.points.map((p) => ({ team: s.username, at: p.at, score: p.score })))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <div>
      {/* Legend: rank order, line keys; hovering a crew brings its line forward. */}
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-label="Crews on the graph">
        {series.map((s) => (
          <li key={s.userId}>
            <button
              type="button"
              className={`flex items-center gap-2 rounded px-1 py-0.5 text-slate-300 transition-opacity hover:text-slate-50 ${highlight !== null && highlight !== s.userId ? 'opacity-40' : ''}`}
              onPointerEnter={() => setHighlight(s.userId)}
              onPointerLeave={() => setHighlight(null)}
              onFocus={() => setHighlight(s.userId)}
              onBlur={() => setHighlight(null)}
            >
              <svg width="16" height="4" aria-hidden="true">
                <line x1="1" y1="2" x2="15" y2="2" stroke={color(slots.get(s.userId) ?? 0)} strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="tabular font-mono text-slate-500">#{s.rank}</span>
              <span className="max-w-[10rem] truncate font-semibold">{s.username}</span>
              <span className="tabular font-mono text-slate-400">{s.points.at(-1)?.score ?? 0}</span>
            </button>
          </li>
        ))}
      </ul>

      <div ref={wrapper} className="relative">
        {geometry && (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Score over time for the top ${series.length} crews. Use the arrow keys to step through score changes.`}
            tabIndex={0}
            className="block touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
            onPointerMove={onPointerMove}
            onPointerLeave={() => setFocusIndex(null)}
            onKeyDown={onKeyDown}
            onBlur={() => setFocusIndex(null)}
          >
            {/* Recessive hairline grid and axes. */}
            {geometry.valueTicks.map((v) => (
              <g key={v}>
                <line x1={PAD.left} x2={PAD.left + geometry.plotW} y1={geometry.sy(v)} y2={geometry.sy(v)} stroke="var(--chart-grid)" strokeWidth="1" />
                <text x={PAD.left - 8} y={geometry.sy(v)} dy="0.32em" textAnchor="end" className="fill-slate-500 font-mono text-[10px]">
                  {v}
                </text>
              </g>
            ))}
            {geometry.timeTicks.map((t) => (
              <text key={t} x={geometry.sx(t)} y={HEIGHT - 8} textAnchor="middle" className="fill-slate-500 font-mono text-[10px]">
                {geometry.format.format(t)}
              </text>
            ))}

            {/* Lines: 2px, round joins; the highlighted crew is drawn last (on top). */}
            {[...geometry.paths]
              .sort((a, b) => Number(a.userId === highlight) - Number(b.userId === highlight))
              .map((path) => (
                <g key={path.userId} opacity={highlight !== null && highlight !== path.userId ? 0.2 : 1}>
                  <path d={path.d} fill="none" stroke={color(slots.get(path.userId) ?? 0)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                  <circle cx={path.end.x} cy={path.end.y} r="4" fill={color(slots.get(path.userId) ?? 0)} stroke="var(--chart-surface)" strokeWidth="2" />
                </g>
              ))}

            {hovered !== null && (
              <g pointerEvents="none">
                <line x1={tipX} x2={tipX} y1={PAD.top} y2={PAD.top + geometry.plotH} stroke="#8f8286" strokeWidth="1" />
                {series.map((s) => (
                  <circle
                    key={s.userId}
                    cx={tipX}
                    cy={geometry.sy(scoreAt(s, hovered))}
                    r="4"
                    fill={color(slots.get(s.userId) ?? 0)}
                    stroke="var(--chart-surface)"
                    strokeWidth="2"
                  />
                ))}
              </g>
            )}
          </svg>
        )}

        {/* One tooltip, every crew: values lead, names follow, line keys for identity. */}
        {hovered !== null && geometry && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[11rem] rounded-md border border-navy-600 bg-navy-950/95 px-3 py-2 text-xs shadow-deck"
            style={tipOnLeft ? { right: width - tipX + 12 } : { left: tipX + 12 }}
            role="status"
          >
            <p className="mb-1.5 font-mono text-[11px] text-slate-400">{geometry.format.format(hovered)}</p>
            <ul className="space-y-1">
              {readout.map(({ s, score }) => (
                <li key={s.userId} className="flex items-center gap-2">
                  <svg width="12" height="4" aria-hidden="true">
                    <line x1="1" y1="2" x2="11" y2="2" stroke={color(slots.get(s.userId) ?? 0)} strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span className="tabular w-12 text-right font-mono font-bold text-slate-50">{score}</span>
                  <span className="max-w-[9rem] truncate text-slate-400">{s.username}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer select-none text-xs font-semibold text-slate-400 hover:text-slate-200">
          <LineChart className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
          Show the graph as a table
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-navy-700">
          <table className="table-kop">
            <caption className="sr-only">Every score change of the crews on the graph, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Crew</th>
                <th scope="col" className="text-right">
                  Score after
                </th>
              </tr>
            </thead>
            <tbody>
              {allPoints.map((point, index) => (
                <tr key={`${point.team}-${point.at}-${index}`}>
                  <td className="whitespace-nowrap font-mono text-xs text-slate-400">{dayClock.format(Date.parse(point.at))}</td>
                  <td className="text-slate-200">{point.team}</td>
                  <td className="tabular text-right font-mono text-slate-100">{point.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
