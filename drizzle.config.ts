import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "file:./data/app.db";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "sqlite",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
