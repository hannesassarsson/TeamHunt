// Solar position calculations (NOAA algorithm). Pure and dependency-free.
// Accuracy is about a minute at Nordic latitudes. Handles midnight sun and polar night,
// which are normal in northern Scandinavia.

const RAD = Math.PI / 180;

export interface SunTimes {
  /** Civil dawn: sun 6° below the horizon. Legal shooting light in much of the Nordics is tied to this. */
  civilDawn: Date | null;
  sunrise: Date | null;
  solarNoon: Date;
  sunset: Date | null;
  civilDusk: Date | null;
  /** Sun stays above the horizon all day (midnight sun). */
  alwaysUp: boolean;
  /** Sun stays below the horizon all day (polar night). */
  alwaysDown: boolean;
}

function julianDay(date: Date): number {
  return date.getTime() / 86_400_000 + 2440587.5;
}

function solarParams(jd: number) {
  const t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * m * RAD) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = 4 / RAD * (y * Math.sin(2 * l0 * RAD) - 2 * e * Math.sin(m * RAD) + 4 * e * y * Math.sin(m * RAD) * Math.cos(2 * l0 * RAD) - 0.5 * y * y * Math.sin(4 * l0 * RAD) - 1.25 * e * e * Math.sin(2 * m * RAD));
  return { decl, eqTime };
}

/** Minutes after UTC midnight when the sun crosses `altitude` (rising or setting), or null. */
function crossing(dayStartUtc: Date, lat: number, lon: number, altitude: number, rising: boolean): number | null | "up" | "down" {
  // Iterate twice for accuracy: evaluate parameters at the estimated time.
  let minutes = 720 - 4 * lon;
  for (let i = 0; i < 3; i++) {
    const { decl, eqTime } = solarParams(julianDay(new Date(dayStartUtc.getTime() + minutes * 60_000)));
    const cosH = (Math.sin(altitude * RAD) - Math.sin(lat * RAD) * Math.sin(decl * RAD)) / (Math.cos(lat * RAD) * Math.cos(decl * RAD));
    if (cosH < -1) return "up";
    if (cosH > 1) return "down";
    const ha = Math.acos(cosH) / RAD;
    const noon = 720 - 4 * lon - eqTime;
    minutes = noon + (rising ? -4 * ha : 4 * ha);
  }
  return minutes;
}

/**
 * Sun times for the calendar day that starts at `dayStartUtc` (pass the UTC instant of local midnight).
 */
export function sunTimes(dayStartUtc: Date, lat: number, lon: number): SunTimes {
  // NOAA works in minutes from UTC midnight of the calendar date; use the date at local noon.
  const noonish = new Date(dayStartUtc.getTime() + 12 * 3_600_000);
  const base = new Date(Date.UTC(noonish.getUTCFullYear(), noonish.getUTCMonth(), noonish.getUTCDate()));
  dayStartUtc = base;
  const at = (m: number | null | "up" | "down") => (typeof m === "number" ? new Date(base.getTime() + m * 60_000) : null);
  const rise = crossing(dayStartUtc, lat, lon, -0.833, true);
  const set = crossing(dayStartUtc, lat, lon, -0.833, false);
  const { eqTime } = solarParams(julianDay(new Date(dayStartUtc.getTime() + 12 * 3_600_000)));
  return {
    civilDawn: at(crossing(dayStartUtc, lat, lon, -6, true)),
    sunrise: at(rise),
    solarNoon: new Date(dayStartUtc.getTime() + (720 - 4 * lon - eqTime) * 60_000),
    sunset: at(set),
    civilDusk: at(crossing(dayStartUtc, lat, lon, -6, false)),
    alwaysUp: rise === "up",
    alwaysDown: rise === "down",
  };
}

/** Sun altitude in degrees at a moment. */
export function sunAltitude(date: Date, lat: number, lon: number): number {
  const { decl, eqTime } = solarParams(julianDay(date));
  const minutesUtc = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarTime = (minutesUtc + eqTime + 4 * lon + 1440) % 1440;
  const ha = trueSolarTime / 4 - 180;
  const cosZenith = Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(ha * RAD);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / RAD;
}

export type LightPhase = "night" | "dawn" | "day" | "dusk";

/** Light phase at a moment: dawn/dusk = civil twilight (sun between -6° and the horizon). */
export function lightPhase(date: Date, lat: number, lon: number): LightPhase {
  const alt = sunAltitude(date, lat, lon);
  if (alt >= -0.833) return "day";
  if (alt < -6) return "night";
  // Morning if the sun is rising: compare with a minute later.
  return sunAltitude(new Date(date.getTime() + 60_000), lat, lon) > alt ? "dawn" : "dusk";
}

/** Moon phase 0..1 (0 = new, 0.5 = full) and illuminated fraction. */
export function moonPhase(date: Date): { phase: number; illumination: number; name: string } {
  const synodic = 29.530588853;
  const knownNew = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((date.getTime() - knownNew) / 86_400_000) % synodic + synodic) % synodic;
  const phase = age / synodic;
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const names = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
  return { phase, illumination, name: names[Math.round(phase * 8) % 8] };
}

/** Sun times for the solar-local day containing `at` (no time-zone database needed). */
export function sunTimesAt(at: Date, lat: number, lon: number): SunTimes {
  const solarLocal = new Date(at.getTime() + lon * 4 * 60_000);
  return sunTimes(new Date(Date.UTC(solarLocal.getUTCFullYear(), solarLocal.getUTCMonth(), solarLocal.getUTCDate())), lat, lon);
}

export interface SunRelativeBucket {
  /** Minutes relative to the event (e.g. -60 = 60–31 minutes before), bucket start. */
  offset: number;
  sunrise: number;
  sunset: number;
}

/**
 * Histogram of events relative to the nearest sunrise or sunset, in `step`-minute buckets
 * within ±`windowMin`. Events on days without sunrise/sunset (midnight sun, polar night) or
 * further than the window from both are counted in `outside`.
 */
export function sunRelativeHistogram(events: { at: string | Date; lat: number; lon: number }[], step = 30, windowMin = 180): { buckets: SunRelativeBucket[]; outside: number } {
  const buckets: SunRelativeBucket[] = [];
  for (let o = -windowMin; o < windowMin; o += step) buckets.push({ offset: o, sunrise: 0, sunset: 0 });
  let outside = 0;
  for (const e of events) {
    const at = new Date(e.at);
    const t = sunTimesAt(at, e.lat, e.lon);
    if (!t.sunrise || !t.sunset) { outside++; continue; }
    const dRise = (at.getTime() - t.sunrise.getTime()) / 60_000;
    const dSet = (at.getTime() - t.sunset.getTime()) / 60_000;
    const [key, d] = Math.abs(dRise) <= Math.abs(dSet) ? (["sunrise", dRise] as const) : (["sunset", dSet] as const);
    if (Math.abs(d) >= windowMin) { outside++; continue; }
    buckets[Math.floor((d + windowMin) / step)][key]++;
  }
  return { buckets, outside };
}
