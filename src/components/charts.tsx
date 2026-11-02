import type { ReactNode } from "react";

/** Read chart colours from CSS tokens so charts follow light/dark mode. */
export function chartColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    grid: v("--border") || "#ddd",
    muted: v("--muted") || "#777",
    text: v("--text") || "#111",
    surface: v("--surface") || "#fff",
    series: [v("--series-1"), v("--series-2"), v("--series-3"), v("--series-4")],
    tiers: { confirmed: v("--tier-chart-confirmed"), probable: v("--tier-chart-probable"), uncertain: v("--tier-chart-uncertain") },
  };
}

interface TooltipProps {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string; payload?: Record<string, unknown> }[];
  label?: string | number;
  labelFormatter?: (l: string | number) => ReactNode;
  valueFormatter?: (v: number | string, name?: string) => ReactNode;
}

export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold">{labelFormatter ? labelFormatter(label ?? "") : label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto font-semibold tabular">{valueFormatter ? valueFormatter(p.value ?? 0, p.name) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Accessible table view for a chart (required where series colors fall below 3:1 contrast). */
export function ChartTable({ columns, rows }: { columns: { key: string; label: string }[]; rows: Record<string, ReactNode>[] }) {
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-2"><tr>{columns.map((c) => <th key={c.key} className="px-2 py-1.5 text-left font-semibold text-muted">{c.label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-border">{columns.map((c) => <td key={c.key} className="px-2 py-1 tabular">{r[c.key]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function LegendItems({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => <span key={i.label} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: i.color }} />{i.label}</span>)}
    </div>
  );
}

import { useEffect, useState } from "react";

/** Chart colours that update when the theme class on <html> changes. */
export function useChartColors() {
  const [colors, setColors] = useState(chartColors);
  useEffect(() => {
    const obs = new MutationObserver(() => setColors(chartColors()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return colors;
}
