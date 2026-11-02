import { Moon, Sunrise, Sunset } from "lucide-react";
import { moonPhase, sunTimes } from "@shared/domain/sun.ts";
import { fmt } from "@/lib/utils";

/** UTC instant of local midnight for a YYYY-MM-DD date in the browser's zone. */
export function localMidnight(day: string | Date = new Date()): Date {
  const d = typeof day === "string" ? new Date(`${day}T00:00:00`) : new Date(day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function SunMoonCard({ lat, lon, day, compact }: { lat: number; lon: number; day?: string; compact?: boolean }) {
  const base = localMidnight(day);
  const t = sunTimes(base, lat, lon);
  const moon = moonPhase(new Date(base.getTime() + 12 * 3_600_000));
  const dayLength = t.sunrise && t.sunset ? (t.sunset.getTime() - t.sunrise.getTime()) / 3_600_000 : t.alwaysUp ? 24 : 0;
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><Sunrise className="size-3.5" />{t.alwaysUp ? "Midnight sun" : t.alwaysDown ? "Polar night" : fmt.time(t.sunrise)}</span>
        {!t.alwaysUp && !t.alwaysDown && <span className="inline-flex items-center gap-1"><Sunset className="size-3.5" />{fmt.time(t.sunset)}</span>}
        <span className="inline-flex items-center gap-1"><Moon className="size-3.5" />{Math.round(moon.illumination * 100)}%</span>
      </div>
    );
  }
  const rows: [string, Date | null, string][] = [
    ["Civil dawn", t.civilDawn, "Sun 6° below horizon"],
    ["Sunrise", t.sunrise, ""],
    ["Solar noon", t.solarNoon, ""],
    ["Sunset", t.sunset, ""],
    ["Civil dusk", t.civilDusk, "Sun 6° below horizon"],
  ];
  return (
    <div className="space-y-3">
      {(t.alwaysUp || t.alwaysDown) && <p className="text-sm font-medium">{t.alwaysUp ? "Midnight sun: the sun does not set today." : "Polar night: the sun does not rise today."}</p>}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {rows.map(([label, v, hint]) => (
          <div key={label} className="rounded-lg bg-surface-2 px-3 py-2" title={hint}>
            <dt className="text-[11px] text-muted">{label}</dt>
            <dd className="font-display text-lg font-semibold tabular">{v ? fmt.time(v) : "–"}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>Day length {fmt.num(dayLength, 1)} h</span>
        <span className="inline-flex items-center gap-1"><Moon className="size-3.5" />{moon.name} · {Math.round(moon.illumination * 100)}% lit</span>
        <span>Local legal shooting hours vary by country and species. Check current regulations.</span>
      </div>
    </div>
  );
}
