import { describe, expect, it } from "vitest";
import { sunTimes, sunAltitude, lightPhase, moonPhase } from "./sun.ts";

const minutesOff = (a: Date | null, iso: string) => Math.abs((a!.getTime() - new Date(iso).getTime()) / 60_000);

describe("sun", () => {
  // Reference values cross-checked against the independent suncalc library (agreement < 0.1 min).
  it("computes Stockholm sun times on the equinox", () => {
    const t = sunTimes(new Date("2026-03-20T00:00:00+01:00"), 59.3293, 18.0686);
    expect(minutesOff(t.sunrise, "2026-03-20T04:49:00Z")).toBeLessThan(1.5);
    expect(minutesOff(t.sunset, "2026-03-20T17:01:00Z")).toBeLessThan(1.5);
    expect(t.civilDawn!.getTime()).toBeLessThan(t.sunrise!.getTime());
    expect(t.civilDusk!.getTime()).toBeGreaterThan(t.sunset!.getTime());
  });
  it("handles midnight sun and polar night in Kiruna", () => {
    const summer = sunTimes(new Date("2026-06-21T00:00:00+02:00"), 67.8558, 20.2253);
    expect(summer.alwaysUp).toBe(true);
    expect(summer.sunrise).toBeNull();
    const winter = sunTimes(new Date("2026-12-21T00:00:00+01:00"), 67.8558, 20.2253);
    expect(winter.alwaysDown).toBe(true);
    expect(winter.civilDawn).not.toBeNull(); // civil twilight still occurs
  });
  it("computes altitude and light phase", () => {
    expect(sunAltitude(new Date("2026-06-21T11:00:00Z"), 59.33, 18.07)).toBeGreaterThan(50);
    expect(sunAltitude(new Date("2026-12-21T23:00:00Z"), 59.33, 18.07)).toBeLessThan(-40);
    expect(lightPhase(new Date("2026-03-20T12:00:00Z"), 59.33, 18.07)).toBe("day");
    expect(lightPhase(new Date("2026-03-20T23:30:00Z"), 59.33, 18.07)).toBe("night");
    expect(lightPhase(new Date("2026-03-20T04:40:00Z"), 59.33, 18.07)).toBe("dawn");
    expect(lightPhase(new Date("2026-03-20T17:30:00Z"), 59.33, 18.07)).toBe("dusk");
  });
  it("computes moon phase", () => {
    expect(moonPhase(new Date("2026-03-03T11:38:00Z")).name).toBe("Full moon");
    expect(moonPhase(new Date("2026-03-19T01:24:00Z")).illumination).toBeLessThan(0.02);
  });
});

import { sunTimesAt, sunRelativeHistogram } from "./sun.ts";

describe("sun-relative activity", () => {
  it("picks the solar-local day for late-evening UTC times", () => {
    const t = sunTimesAt(new Date("2026-10-01T21:30:00Z"), 59.33, 18.07); // 23:30 CEST same day
    expect(t.sunset!.toISOString().slice(0, 10)).toBe("2026-10-01");
  });
  it("buckets events around sunrise and sunset", () => {
    const loc = { lat: 59.33, lon: 18.07 };
    const t = sunTimesAt(new Date("2026-10-01T12:00:00Z"), loc.lat, loc.lon);
    const ev = (base: Date, minutes: number) => ({ at: new Date(base.getTime() + minutes * 60_000), ...loc });
    const h = sunRelativeHistogram([ev(t.sunrise!, -45), ev(t.sunrise!, 10), ev(t.sunset!, -5), ev(t.sunset!, 100), ev(t.sunrise!, 300)]);
    const at = (o: number) => h.buckets.find((b) => b.offset === o)!;
    expect(at(-60).sunrise).toBe(1);
    expect(at(0).sunrise).toBe(1);
    expect(at(-30).sunset).toBe(1);
    expect(at(90).sunset).toBe(1);
    expect(h.outside).toBe(1);
    expect(h.buckets).toHaveLength(12);
  });
  it("counts polar-night events as outside", () => {
    expect(sunRelativeHistogram([{ at: "2026-12-21T10:00:00Z", lat: 69.65, lon: 18.96 }]).outside).toBe(1);
  });
});
