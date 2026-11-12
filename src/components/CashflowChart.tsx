"use client";

import { useEffect, useRef, useState } from "react";
import type { Scenario } from "@/lib/tco";

const eur = (n: number) =>
  new Intl.NumberFormat("fi-FI", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const kEur = (n: number) => `${n < 0 ? "−" : ""}${Math.round(Math.abs(n) / 1000)} k€`;

type Option = { key: "cash" | "loan"; label: string; color: string; scenario: Scenario };
type Line = {
  key: string;
  option: Option;
  label: string;
  dashed: boolean;
  values: number[];
  /** Value after the sale, drawn as a vertical step at the last month (null = no step). */
  end: number | null;
};

const PAD = { top: 16, right: 140, bottom: 28, left: 52 };
const HEIGHT = 280;
const LABEL_GAP = 15;

/** "Nice" tick step for the y-axis. */
function niceStep(range: number, target = 5) {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
}

/** Spread end-of-line labels so they don't overlap, keeping their order. */
function spreadLabels(ys: number[], min: number, max: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) order[k].y = Math.max(order[k].y, order[k - 1].y + LABEL_GAP);
  const overflow = order.length ? order[order.length - 1].y - max : 0;
  if (overflow > 0) order.forEach((o) => (o.y -= overflow));
  for (let k = order.length - 2; k >= 0; k--) order[k].y = Math.min(order[k].y, order[k + 1].y - LABEL_GAP);
  const out = [...ys];
  order.forEach((o) => (out[o.i] = Math.max(min, o.y)));
  return out;
}

/**
 * Lump sum vs financed over the ownership period.
 *
 * mode "cost":  cumulative cash out (negative). The last vertical step is selling the car.
 * mode "chart": money paid into the car (solid) vs the same money invested instead (dashed).
 *               The gap between them is the lost return, compounding over time.
 */
export function CashflowChart({ cash, loan, mode }: { cash: Scenario; loan: Scenario; mode: "cost" | "chart" }) {
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

  const options: Option[] = [
    { key: "cash", label: "Lump sum", color: "var(--series-1)", scenario: cash },
    { key: "loan", label: "Financed", color: "var(--series-2)", scenario: loan },
  ];
  const months = cash.cumulativeCash.length - 1;

  const lines: Line[] =
    mode === "cost"
      ? options.map((o) => ({
          key: o.key,
          option: o,
          label: o.label,
          dashed: false,
          values: o.scenario.cumulativeCash,
          end: o.scenario.cumulativeCash[months] + o.scenario.saleProceeds,
        }))
      : options.flatMap((o) => [
          {
            key: `${o.key}-paid`,
            option: o,
            label: `${o.label}, paid`,
            dashed: false,
            values: o.scenario.cumulativeCash.map((v) => -v),
            end: -o.scenario.cumulativeCash[months] - o.scenario.saleProceeds,
          },
          {
            key: `${o.key}-invested`,
            option: o,
            label: `${o.label}, invested`,
            dashed: true,
            values: o.scenario.investedValue,
            end: null,
          },
        ]);

  const all = lines.flatMap((l) => [...l.values, ...(l.end !== null ? [l.end] : []), 0]);
  const step = niceStep(Math.max(1, Math.max(...all) - Math.min(...all)));
  const yMin = Math.floor(Math.min(...all) / step) * step;
  const yMax = Math.ceil(Math.max(...all) / step) * step;
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax + 1e-6; v += step) ticks.push(v);

  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (m: number) => PAD.left + (m / months) * innerW;
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin || 1)) * innerH;

  const path = (l: Line) =>
    l.values.map((v, m) => `${m ? "L" : "M"}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join("") +
    (l.end !== null ? `L${x(months).toFixed(1)},${y(l.end).toFixed(1)}` : "");
  const finalValue = (l: Line) => l.end ?? l.values[months];

  const xTicks = Array.from({ length: Math.floor(months / 12) + 1 }, (_, i) => i * 12);
  if (xTicks[xTicks.length - 1] !== months) xTicks.push(months);

  const labelY = spreadLabels(lines.map((l) => y(finalValue(l))), PAD.top, PAD.top + innerH);

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const m = Math.round(((e.clientX - rect.left) / rect.width) * months);
    setHover(Math.min(months, Math.max(0, m)));
  }

  const tipLeft = hover !== null && x(hover) > width / 2;

  return (
    <div ref={wrap} className="relative w-full min-w-0">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400" aria-hidden>
        {options.map((o) => (
          <span key={o.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: o.color }} />
            {o.label}
          </span>
        ))}
        {mode === "chart" && (
          <>
            <span className="flex items-center gap-1.5">
              <svg width="16" height="2" aria-hidden>
                <line x1="0" x2="16" y1="1" y2="1" stroke="currentColor" strokeWidth="2" />
              </svg>
              Paid into the car
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="16" height="2" aria-hidden>
                <line x1="0" x2="16" y1="1" y2="1" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
              </svg>
              Same money invested instead
            </span>
          </>
        )}
      </div>
      <svg
        width="100%"
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="img"
        aria-label={mode === "cost" ? "Cumulative cash out, lump sum vs financed" : "Money paid into the car vs the same money invested"}
        className="block"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={t === 0 ? 1.5 : 1} />
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
        {lines.map((l) => (
          <path
            key={l.key}
            d={path(l)}
            fill="none"
            stroke={l.option.color}
            strokeWidth={2}
            strokeDasharray={l.dashed ? "6 4" : undefined}
            strokeLinejoin="round"
          />
        ))}
        {lines.map((l, i) => (
          <g key={l.key}>
            {/* Colored key mark beside the label, so identity isn't carried by text color. */}
            <line
              x1={x(months) + 6}
              x2={x(months) + 16}
              y1={labelY[i]}
              y2={labelY[i]}
              stroke={l.option.color}
              strokeWidth={2}
              strokeDasharray={l.dashed ? "3 2" : undefined}
            />
            <text x={x(months) + 20} y={labelY[i]} dy="0.32em" className="fill-zinc-700 text-[11px] tabular-nums dark:fill-zinc-300">
              {mode === "cost" ? `${l.label} ${kEur(finalValue(l))} net` : `${l.dashed ? "Invested" : "Paid, net"} ${kEur(finalValue(l))}`}
            </text>
          </g>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--crosshair)" strokeWidth={1} />
            {lines.map((l) => (
              <circle key={l.key} cx={x(hover)} cy={y(l.values[hover])} r={4} fill={l.option.color} stroke="var(--background)" strokeWidth={2} />
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
          className="pointer-events-none absolute top-10 z-10 w-60 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          style={tipLeft ? { left: x(hover) - 252 } : { left: x(hover) + 12 }}
        >
          <p className="font-medium">{hover === 0 ? "Purchase day" : `After ${hover} months`}</p>
          {mode === "cost" ? (
            <>
              <p className="mb-1.5 text-zinc-500">Cash out so far</p>
              {options.map((o) => (
                <p key={o.key} className="flex items-center justify-between gap-2 tabular-nums">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
                    {o.label}
                  </span>
                  {eur(o.scenario.cumulativeCash[hover])}
                </p>
              ))}
              <p className="mt-1.5 flex justify-between border-t border-zinc-100 pt-1.5 tabular-nums dark:border-zinc-800">
                <span>Difference</span>
                {eur(Math.abs(cash.cumulativeCash[hover] - loan.cumulativeCash[hover]))}
              </p>
            </>
          ) : (
            options.map((o) => {
              const paid = -o.scenario.cumulativeCash[hover];
              const invested = o.scenario.investedValue[hover];
              return (
                <div key={o.key} className="mt-1.5 tabular-nums">
                  <p className="flex items-center gap-1.5 font-medium">
                    <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
                    {o.label}
                  </p>
                  <p className="flex justify-between pl-3.5">
                    <span className="text-zinc-500">Paid so far</span>
                    {eur(paid)}
                  </p>
                  <p className="flex justify-between pl-3.5">
                    <span className="text-zinc-500">If invested</span>
                    {eur(invested)}
                  </p>
                  <p className="flex justify-between pl-3.5">
                    <span className="text-zinc-500">Lost returns</span>
                    {eur(invested - paid)}
                  </p>
                </div>
              );
            })
          )}
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
