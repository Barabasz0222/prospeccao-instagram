import { describe, expect, it } from "vitest";
import { dayKeyInTz, isWithinOperatingHours, minutesInTz } from "./time";

const TZ = "America/Sao_Paulo";

describe("operating hours", () => {
  it("is inside the window at local midday", () => {
    // 15:00 UTC == 12:00 in America/Sao_Paulo (UTC-3)
    const d = new Date("2026-03-10T15:00:00Z");
    expect(minutesInTz(d, TZ)).toBe(12 * 60);
    expect(isWithinOperatingHours(d, "09:00-20:00", TZ)).toBe(true);
  });

  it("is outside the window late at night", () => {
    const d = new Date("2026-03-11T04:00:00Z"); // 01:00 local
    expect(isWithinOperatingHours(d, "09:00-20:00", TZ)).toBe(false);
  });

  it("derives a stable day key", () => {
    const d = new Date("2026-03-11T02:00:00Z"); // still 2026-03-10 local
    expect(dayKeyInTz(d, TZ)).toBe("2026-03-10");
  });
});
