// Normalised weather model shared by the weather edge function, the job worker and the UI.
// `kind` makes the provenance explicit:
//   - "forecast":   a prediction for a future (or current) hour.
//   - "historical": modelled/reanalysis data for a past hour (e.g. ERA5). Not a station measurement.
//   - "observed":   a measurement from a weather station.
export type WeatherKind = "forecast" | "historical" | "observed";

export interface WeatherSample {
  time: string; // ISO 8601, UTC, start of the hour
  kind: WeatherKind;
  source: string;
  temperature_c: number | null;
  wind_speed_ms: number | null;
  wind_gust_ms: number | null;
  wind_dir_deg: number | null;
  precipitation_mm: number | null;
  humidity_pct: number | null;
  pressure_hpa: number | null;
  cloud_cover_pct: number | null;
  symbol: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Parse a MET Norway Locationforecast 2.0 (compact or complete) response. */
export function parseMetNorway(json: unknown, source = "met.no"): WeatherSample[] {
  // deno-lint-ignore no-explicit-any
  const series = (json as any)?.properties?.timeseries;
  if (!Array.isArray(series)) throw new Error("Unexpected MET Norway response");
  return series.map((t) => {
    const d = t?.data?.instant?.details ?? {};
    const n1 = t?.data?.next_1_hours;
    const n6 = t?.data?.next_6_hours;
    return {
      time: new Date(t.time).toISOString(),
      kind: "forecast" as const,
      source,
      temperature_c: num(d.air_temperature),
      wind_speed_ms: num(d.wind_speed),
      wind_gust_ms: num(d.wind_speed_of_gust),
      wind_dir_deg: num(d.wind_from_direction),
      precipitation_mm: num(n1?.details?.precipitation_amount ?? null),
      humidity_pct: num(d.relative_humidity),
      pressure_hpa: num(d.air_pressure_at_sea_level),
      cloud_cover_pct: num(d.cloud_area_fraction),
      symbol: (n1?.summary?.symbol_code ?? n6?.summary?.symbol_code ?? null) as string | null,
    };
  });
}

/** Parse an Open-Meteo hourly response (forecast or archive API) requested with timezone=UTC and wind_speed_unit=ms. */
export function parseOpenMeteo(json: unknown, kind: WeatherKind, source: string): WeatherSample[] {
  // deno-lint-ignore no-explicit-any
  const h = (json as any)?.hourly;
  if (!h || !Array.isArray(h.time)) throw new Error("Unexpected Open-Meteo response");
  const at = (key: string, i: number) => (Array.isArray(h[key]) ? num(h[key][i]) : null);
  return h.time.map((t: string, i: number) => ({
    time: new Date(t.endsWith("Z") ? t : `${t}Z`).toISOString(),
    kind,
    source,
    temperature_c: at("temperature_2m", i),
    wind_speed_ms: at("wind_speed_10m", i),
    wind_gust_ms: at("wind_gusts_10m", i),
    wind_dir_deg: at("wind_direction_10m", i),
    precipitation_mm: at("precipitation", i),
    humidity_pct: at("relative_humidity_2m", i),
    pressure_hpa: at("pressure_msl", i),
    cloud_cover_pct: at("cloud_cover", i),
    symbol: null,
  }));
}

/** Pick the sample closest to `time`, within maxGapMinutes. */
export function nearestSample(samples: WeatherSample[], time: Date | string, maxGapMinutes = 90): WeatherSample | null {
  const target = new Date(time).getTime();
  let best: WeatherSample | null = null;
  let bestGap = Infinity;
  for (const s of samples) {
    const gap = Math.abs(new Date(s.time).getTime() - target);
    if (gap < bestGap) {
      best = s;
      bestGap = gap;
    }
  }
  return best && bestGap <= maxGapMinutes * 60_000 ? best : null;
}

const COMPASS_EN = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** Compass label for the direction the wind blows FROM. */
export function windDirectionLabel(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return "–";
  return COMPASS_EN[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Direction scent travels (downwind), useful for stand selection. */
export function downwindBearing(windFromDeg: number): number {
  return (windFromDeg + 180) % 360;
}

/** Round coordinates for cache keys and to avoid sending precise positions to third parties (~1 km). */
export function coarseCoordinate(v: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function describeKind(kind: WeatherKind): string {
  return kind === "forecast" ? "Forecast" : kind === "observed" ? "Observed (station)" : "Historical (model reanalysis)";
}
