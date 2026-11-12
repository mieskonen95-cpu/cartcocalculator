"use client";

import { useEffect, useRef, useState } from "react";
import type { Scenario } from "@/lib/tco";

const eur = (n: number) =>
  new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const kEur = (n: number) => `${n < 0 ? "−" : ""}${Math.round(Math.abs(n) / 1000)} k€`;

type Series = { key: "cash" | "loan"; label: string; color: string; scenario: Scenario };

const PAD = { top: 16, right: 124, bottom: 28, left: 52 };
const HEIGHT = 260;

/** "Nice" tick step for the y-axis. */
function niceStep(range: number, target = 5) {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
}

/**
 * Cumulative net cash position for lump sum vs financed, month by month. The final vertical
 * step is the sale: resale value minus any loan still owed comes back.
 */
export function CashflowChart({ cash, loan }: { cash: Scenario; loan: Scenario }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const series: Series[] = [
    { key: "cash", label: "Lump sum", color: "var(--series-1)", scenario: cash },
    { key: "loan", label: "Financed", color: "var(--series-2)", scenario: loan },
  ];
  const months = cash.cumulativeCash.length - 1;
  const end = (s: Scenario) => s.cumulativeCash[months] + s.saleProceeds;

  const values = series.flatMap((s) => [...s.scenario.cumulativeCash, end(s.scenario)]);
  const step = niceStep(Math.max(1, -Math.min(...values)));
  const yMin = Math.floor(Math.min(...values) / step) * step;
  const yMax = Math.max(0, Math.ceil(Math.max(...values) / step) * step);
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-6; v += step) ticks.push(v);

  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (m: number) => PAD.left + (m / months) * innerW;
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin || 1)) * innerH;

  const path = (s: Scenario) =>
    s.cumulativeCash.map((v, m) => `${m ? "L" : "M"}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join("") +
    `L${x(months).toFixed(1)},${y(end(s)).toFixed(1)}`;

  const xTicks = Array.from({ length: Math.floor(months / 12) + 1 }, (_, i) => i * 12);
  if (xTicks[xTicks.length - 1] !== months) xTicks.push(months);

  // Direct labels at the end of each line, nudged apart if they would collide.
  const labelY = series.map((s) => y(end(s.scenario)));
  if (Math.abs(labelY[0] - labelY[1]) < 16) {
    const mid = (labelY[0] + labelY[1]) / 2;
    const up = labelY[0] <= labelY[1] ? 0 : 1;
    labelY[up] = mid - 8;
    labelY[1 - up] = mid + 8;
  }

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const m = Math.round(((e.clientX - rect.left) / rect.width) * months);
    setHover(Math.min(months, Math.max(0, m)));
  }

  const tipLeft = hover !== null && x(hover) > width / 2;

  return (
    <div ref={wrap} className="relative w-full min-w-0">
      <div className="mb-3 flex gap-4 text-xs text-zinc-600 dark:text-zinc-400" aria-hidden>
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg width="100%" height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label="Cumulative cash out, lump sum vs financed" className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-zinc-500 text-[11px] tabular-nums">
              {t === 0 ? "0" : kEur(t)}
            </text>
          </g>
        ))}
        {xTicks.map((m) => (
          <text key={m} x={x(m)} y={HEIGHT - 8} textAnchor="middle" className="fill-zinc-500 text-[11px]">
            {m === 0 ? "Buy" : m % 12 === 0 ? `Year ${m / 12}` : `${m} mo`}
          </text>
        ))}
        {series.map((s) => (
          <path key={s.key} d={path(s.scenario)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {series.map((s, i) => (
          <text key={s.key} x={x(months) + 8} y={labelY[i]} dy="0.32em" className="fill-zinc-700 text-[11px] tabular-nums dark:fill-zinc-300">
            {s.label} {kEur(end(s.scenario))} net
          </text>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--crosshair)" strokeWidth={1} />
            {series.map((s) => (
              <circle
                key={s.key}
                cx={x(hover)}
                cy={y(s.scenario.cumulativeCash[hover])}
                r={4}
                fill={s.color}
                stroke="var(--background)"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={innerW}
          height={innerH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute top-8 z-10 w-56 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={tipLeft ? { left: x(hover) - 232 } : { left: x(hover) + 12 }}
        >
          <p className="font-medium">{hover === 0 ? "Purchase day" : `After ${hover} months`}</p>
          <p className="mb-1.5 text-zinc-500">Cash out so far</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-2 tabular-nums">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              {eur(s.scenario.cumulativeCash[hover])}
            </p>
          ))}
          <p className="mt-1.5 flex justify-between border-t border-zinc-100 pt-1.5 tabular-nums dark:border-zinc-800">
            <span>Difference</span>
            {eur(Math.abs(cash.cumulativeCash[hover] - loan.cumulativeCash[hover]))}
          </p>
          {hover === months && (
            <p className="mt-1.5 text-zinc-500">
              Then the sale brings back {eur(cash.saleProceeds)} (lump sum) / {eur(loan.saleProceeds)} (financed, after
              paying off the loan).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
