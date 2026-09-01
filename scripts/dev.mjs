// Sobe o painel Next.js e o worker juntos, com um único comando.
import { spawn } from "node:child_process";

const procs = [
  { name: "web", cmd: "next", args: ["dev", "-p", "3000"] },
  { name: "worker", cmd: "tsx", args: ["watch", "src/worker/main.ts"] },
];

const children = procs.map(({ name, cmd, args }) => {
  const child = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
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
