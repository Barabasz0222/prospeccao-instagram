import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { backupDatabase } from "./backup-runner";
import { restoreDatabase } from "./restore";

const DB = "data/_test_backup.db";
const URL = `file:${DB}`;

afterEach(() => {
  rmSync("backups", { recursive: true, force: true });
  rmSync(DB, { force: true });
});

describe("backup + restore", () => {
  it("creates a timestamped copy and restores it", () => {
    mkdirSync("data", { recursive: true });
    writeFileSync(DB, "ORIGINAL");
    const dest = backupDatabase(URL, 5);
    expect(dest).toBeTruthy();
    expect(existsSync(dest!)).toBe(true);

    writeFileSync(DB, "CORRUPTED");
    const from = restoreDatabase(URL);
    expect(from).toBe(dest);
    expect(existsSync(DB)).toBe(true);
  });

  it("prunes to the retention limit", () => {
    mkdirSync("data", { recursive: true });
    writeFileSync(DB, "x");
    for (let i = 0; i < 5; i++) backupDatabase(URL, 2);
    const count = readdirSync("backups").filter((f) => f.endsWith(".bak")).length;
    expect(count).toBeLessThanOrEqual(2);
  });
});
