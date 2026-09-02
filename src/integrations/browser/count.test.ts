import { describe, expect, it } from "vitest";
// expandCount is module-private; re-implement the contract via parseProfile is
// heavy, so we test it through a tiny re-export shim.
import { __expandCountForTest as expandCount } from "./cdp-driver";

describe("expandCount", () => {
  it("treats . and , as thousands separators when there is no suffix", () => {
    expect(expandCount("6.036")).toBe(6036);
    expect(expandCount("6,036")).toBe(6036);
    expect(expandCount("1.234.567")).toBe(1234567);
    expect(expandCount("638")).toBe(638);
  });

  it("treats the last separator as a decimal point with a suffix", () => {
    expect(expandCount("12,3 mil")).toBe(12300);
    expect(expandCount("1.2M")).toBe(1200000);
    expect(expandCount("33 mil")).toBe(33000);
    expect(expandCount("2M")).toBe(2000000);
  });

  it("returns null for junk", () => {
    expect(expandCount("abc")).toBeNull();
  });
});
