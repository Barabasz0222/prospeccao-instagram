// Production launcher: panel (next start) + worker, one command, no watch/reload
// so child processes spawned from the "Sistema" page (Chrome, tunnel) stay
// alive for the whole session instead of dying on every file-change restart.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const wanted = Number(process.env.PORT ?? 3000);

function findFreePort(start) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(findFreePort(start + 1)));
    srv.once("listening", () => srv.close(() => resolve(start)));
    srv.listen(start, "127.0.0.1");
  });
}

const port = await findFreePort(wanted);
console.log(`[start] painel: http://localhost:${port}`);

const procs = [
  { name: "web", cmd: "next", args: ["start", "-p", String(port)] },
  { name: "worker", cmd: "tsx", args: ["src/worker/main.ts"] },
];

const children = procs.map(({ name, cmd, args }) => {
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, PORT: String(port) },
  });
  child.on("exit", (code) => {
    console.log(`[${name}] saiu com código ${code}`);
    shutdown();
  });
  return child;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
