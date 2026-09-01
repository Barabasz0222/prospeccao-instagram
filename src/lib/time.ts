import { parseOperatingHours } from "./env";

/** Minutes since midnight for a Date, in the given IANA timezone. */
export function minutesInTz(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

export function dayKeyInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isWithinOperatingHours(
  date: Date,
  operatingHours: string,
  timeZone: string,
): boolean {
  const { start, end } = parseOperatingHours(operatingHours);
  const cur = minutesInTz(date, timeZone);
  return cur >= start && cur < end;
}

/** Uniform random integer in [min, max]. */
export function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}
