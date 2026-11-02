// Weather providers with a Postgres-backed cache (weather_cache, service role only).
//  - Forecast: MET Norway Locationforecast 2.0 (free, requires an identifying User-Agent).
//  - Historical: Open-Meteo archive (ERA5 reanalysis) for older dates, Open-Meteo forecast API
//    "past_days" model data for the last few days. Both are labelled kind="historical" (modelled),
//    never "observed". Set OPEN_METEO_API_KEY for commercial use (customer endpoints).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { coarseCoordinate, nearestSample, parseMetNorway, parseOpenMeteo, type WeatherSample } from "./domain/weather.ts";
import { fetchWithRetry } from "./http.ts";

const USER_AGENT = Deno.env.get("WEATHER_USER_AGENT") || "NORDHUNT/0.1 (https://github.com/hannesassarsson/TeamHunt)";
const HOURLY = "temperature_2m,relative_humidity_2m,precipitation,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover";

async function cached<T>(db: SupabaseClient, key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const { data } = await db.from("weather_cache").select("payload, expires_at").eq("cache_key", key).maybeSingle();
  if (data && new Date(data.expires_at).getTime() > Date.now()) return data.payload as T;
  const payload = await load();
  await db.from("weather_cache").upsert({
    cache_key: key,
    payload,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
  return payload;
}

export function getForecast(db: SupabaseClient, lat: number, lon: number): Promise<WeatherSample[]> {
  const la = coarseCoordinate(lat), lo = coarseCoordinate(lon);
  return cached(db, `metno:${la}:${lo}`, 30 * 60, async () => {
    const res = await fetchWithRetry(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${la}&lon=${lo}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`MET Norway responded ${res.status}`);
    return parseMetNorway(await res.json());
  });
}

function openMeteoBase(kind: "archive" | "forecast"): { url: string; key: string } {
  const key = Deno.env.get("OPEN_METEO_API_KEY") ?? "";
  if (kind === "archive") return { url: key ? "https://customer-archive-api.open-meteo.com/v1/archive" : "https://archive-api.open-meteo.com/v1/archive", key };
  return { url: key ? "https://customer-api.open-meteo.com/v1/forecast" : "https://api.open-meteo.com/v1/forecast", key };
}

/** Historical (modelled) weather for one UTC day at a location. */
export function getHistoricalDay(db: SupabaseClient, lat: number, lon: number, dayIso: string): Promise<WeatherSample[]> {
  const la = coarseCoordinate(lat), lo = coarseCoordinate(lon);
  const day = dayIso.slice(0, 10);
  const ageDays = (Date.now() - new Date(`${day}T00:00:00Z`).getTime()) / 86_400_000;
  const useArchive = ageDays > 6;
  const { url, key } = openMeteoBase(useArchive ? "archive" : "forecast");
  const params = new URLSearchParams({ latitude: String(la), longitude: String(lo), hourly: HOURLY, timezone: "UTC", wind_speed_unit: "ms" });
  if (useArchive) {
    params.set("start_date", day);
    params.set("end_date", day);
  } else {
    params.set("past_days", "7");
    params.set("forecast_days", "1");
  }
  if (key) params.set("apikey", key);
  const source = useArchive ? "open-meteo-era5" : "open-meteo-model";
  // Past days are immutable once archived; recent model data is refreshed hourly.
  return cached(db, `om:${source}:${la}:${lo}:${useArchive ? day : new Date().toISOString().slice(0, 13)}`, useArchive ? 30 * 86_400 : 3600, async () => {
    const res = await fetchWithRetry(`${url}?${params}`);
    if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);
    const all = parseOpenMeteo(await res.json(), "historical", source);
    const now = Date.now();
    return all.filter((s) => s.time.startsWith(day) && new Date(s.time).getTime() <= now);
  });
}

/**
 * Weather for a moment in time: historical model data for the past, forecast for now/future.
 * Returns null when nothing usable is available (never fabricates values).
 */
export async function weatherAt(db: SupabaseClient, lat: number, lon: number, at: string | Date): Promise<WeatherSample | null> {
  const t = new Date(at);
  if (t.getTime() > Date.now() - 30 * 60_000) {
    return nearestSample(await getForecast(db, lat, lon), t);
  }
  return nearestSample(await getHistoricalDay(db, lat, lon, t.toISOString()), t);
}
