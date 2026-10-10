import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;

function run(args: string[]) {
  return spawn(node, args, { cwd: root, stdio: "inherit" });
}

const server = run(["node_modules/tsx/dist/cli.mjs", "server/index.ts"]);
const vite = run(["node_modules/vite/bin/vite.js"]);

function stop() {
  server.kill();
  vite.kill();
}

process.on("SIGINT", () => { stop(); process.exit(0); });
process.on("SIGTERM", () => { stop(); process.exit(0); });
server.on("exit", code => { vite.kill(); if (code) process.exit(code); });
vite.on("exit", code => { server.kill(); if (code) process.exit(code); });
