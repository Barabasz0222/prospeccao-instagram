// Sobe o painel Next.js e o worker juntos, com um único comando.
// Porta configurável: PORT=3001 pnpm dev
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
if (port !== wanted) {
  console.log(`[dev] porta ${wanted} ocupada — usando ${port}`);
}
console.log(`[dev] painel: http://localhost:${port}`);

const procs = [
  { name: "web", cmd: "next", args: ["dev", "-p", String(port)] },
  { name: "worker", cmd: "tsx", args: ["watch", "src/worker/main.ts"] },
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
