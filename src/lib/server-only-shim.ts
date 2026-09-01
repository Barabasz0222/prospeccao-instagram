// Local "server-only" marker. Throws if a module that imports it is ever
// evaluated in a browser bundle. A no-op on the server, in the worker, in
// tsx scripts and in Vitest — unlike the npm `server-only` package, which
// throws in any non-RSC context.
if (typeof window !== "undefined") {
  throw new Error("Este módulo é server-only e não pode rodar no navegador.");
}
export {};
