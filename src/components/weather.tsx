import { describeKind, windDirectionLabel, type WeatherSample } from "@shared/domain/weather.ts";
import { Cloud, CloudRain, Droplets, Gauge, Navigation, Snowflake, Sun, Thermometer, Wind } from "lucide-react";
import { cn, fmt } from "@/lib/utils";

export function WeatherIcon({ s, className }: { s: Pick<WeatherSample, "symbol" | "precipitation_mm" | "cloud_cover_pct" | "temperature_c">; className?: string }) {
  const sym = s.symbol ?? "";
  if (sym.includes("snow") || ((s.precipitation_mm ?? 0) > 0 && (s.temperature_c ?? 5) <= 0)) return <Snowflake className={className} />;
  if (sym.includes("rain") || sym.includes("sleet") || (s.precipitation_mm ?? 0) > 0.1) return <CloudRain className={className} />;
  if (sym.includes("cloud") || (s.cloud_cover_pct ?? 0) > 60) return <Cloud className={className} />;
  return <Sun className={className} />;
}

/** Arrow pointing where the wind blows TO (scent direction). */
export function WindArrow({ deg, className }: { deg: number | null; className?: string }) {
  if (deg == null) return null;
  return <Navigation className={cn("size-4", className)} style={{ transform: `rotate(${(deg + 180) % 360}deg)` }} aria-label={`Wind from ${windDirectionLabel(deg)}`} />;
}

export function WeatherKindBadge({ kind }: { kind: WeatherSample["kind"] }) {
  const cls = kind === "forecast" ? "bg-info/12 text-info" : kind === "observed" ? "bg-success/12 text-success" : "bg-accent-soft text-accent";
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", cls)}>{describeKind(kind)}</span>;
}

export function WeatherSummary({ w, compact }: { w: WeatherSample | null | undefined; compact?: boolean }) {
  if (!w) return <span className="text-sm text-muted">No weather data</span>;
  const items = [
    { Icon: Thermometer, v: w.temperature_c != null ? `${fmt.num(w.temperature_c, 1)} °C` : null },
    { Icon: Wind, v: w.wind_speed_ms != null ? `${fmt.num(w.wind_speed_ms, 1)} m/s ${windDirectionLabel(w.wind_dir_deg)}` : null },
    { Icon: Droplets, v: w.precipitation_mm != null ? `${fmt.num(w.precipitation_mm, 1)} mm` : null },
    { Icon: Gauge, v: !compact && w.pressure_hpa != null ? `${fmt.num(w.pressure_hpa)} hPa` : null },
  ].filter((i) => i.v);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {items.map(({ Icon, v }, i) => (
          <span key={i} className="inline-flex items-center gap-1 tabular"><Icon className="size-3.5 text-muted" />{v}</span>
        ))}
      </div>
      {!compact && (
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <WeatherKindBadge kind={w.kind} /> {w.source} · {fmt.dateTime(w.time)}
        </div>
      )}
    </div>
  );
}
