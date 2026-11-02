// Authenticated weather proxy. Keeps third-party calls server-side, coarsens coordinates
// (~1 km) before they leave our infrastructure, and caches responses.
//   GET /functions/v1/weather?lat=60.1&lon=15.2            -> forecast (MET Norway)
//   GET /functions/v1/weather?lat=60.1&lon=15.2&at=ISO     -> sample for that time (historical model or forecast)
import { serviceClient, userClient } from "../_shared/clients.ts";
import { HttpError, json, serve } from "../_shared/http.ts";
import { getForecast, weatherAt } from "../_shared/weather.ts";

const buckets = new Map<string, { tokens: number; at: number }>();
function rateLimit(key: string, perMinute = 60) {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) throw new HttpError(429, "Too many weather requests", "rate_limited");
  b.tokens -= 1;
  buckets.set(key, b);
}

serve("weather", async (req) => {
  const { userId } = await userClient(req);
  rateLimit(userId);
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new HttpError(400, "lat and lon are required");
  }
  const db = serviceClient();
  const at = url.searchParams.get("at");
  if (at) {
    if (Number.isNaN(Date.parse(at))) throw new HttpError(400, "Invalid 'at' timestamp");
    return json(req, { sample: await weatherAt(db, lat, lon, at) });
  }
  const now = Date.now() - 3600_000;
  const samples = (await getForecast(db, lat, lon)).filter((s) => new Date(s.time).getTime() >= now).slice(0, 72);
  return json(req, { samples, attribution: "Weather data: MET Norway (CC BY 4.0)" }, 200, { "Cache-Control": "private, max-age=600" });
});
