import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatDistanceToNowStrict } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dtf = new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" });
const df = new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium" });
const tf = new Intl.DateTimeFormat("sv-SE", { timeStyle: "short" });

export const fmt = {
  dateTime: (v: string | Date | null | undefined) => (v ? dtf.format(new Date(v)) : "–"),
  date: (v: string | Date | null | undefined) => (v ? df.format(new Date(v)) : "–"),
  time: (v: string | Date | null | undefined) => (v ? tf.format(new Date(v)) : "–"),
  ago: (v: string | Date | null | undefined) => (v ? `${formatDistanceToNowStrict(new Date(v))} ago` : "never"),
  num: (v: number | null | undefined, digits = 0) =>
    v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("sv-SE", { maximumFractionDigits: digits, minimumFractionDigits: digits }),
  pct: (v: number | null | undefined) => (v == null ? "–" : `${Math.round(v * 100)}%`),
  distance: (meters: number) =>
    meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toLocaleString("sv-SE", { minimumFractionDigits: meters < 10_000 ? 2 : 1, maximumFractionDigits: meters < 10_000 ? 2 : 1 })} km`,
  area: (m2: number) => (m2 < 10_000 ? `${Math.round(m2)} m²` : `${(m2 / 10_000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} ha`),
  coord: (lat: number | null | undefined, lon: number | null | undefined) =>
    lat == null || lon == null ? "–" : `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
};

/** Value for <input type="datetime-local"> in the browser's local time. */
export function toLocalInput(d: Date | string = new Date()): string {
  const date = new Date(d);
  const off = date.getTimezoneOffset();
  return new Date(date.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export function fromLocalInput(v: string): string {
  return new Date(v).toISOString();
}

export function startOfDayDaysAgo(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** RFC 4180 CSV with a BOM so spreadsheet apps detect UTF-8 (å, ä, ö). */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
}

export function getStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function setStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}
