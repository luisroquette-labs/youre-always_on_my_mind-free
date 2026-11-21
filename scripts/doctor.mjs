#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { config } from "../src/config.mjs";
import { inspectInstallation } from "../src/claude-mem-bridge.mjs";

const installation = inspectInstallation(config);
const sqlite = spawnSync("sqlite3", ["--version"], { encoding: "utf8" });
const external = installation.reader === "external-bridge";
const bridgePresent = external && existsSync(installation.bridgePath);
const checks = [
  ["Node.js 22+", Number(process.versions.node.split(".")[0]) >= 22, process.version],
  ["SQLite CLI", sqlite.status === 0, sqlite.status === 0 ? sqlite.stdout.trim() : "required to read claude-mem's local database"],
  [
    external ? "Memory bridge" : "Memory reader",
    external ? bridgePresent : installation.databaseExists && String(installation.schema).startsWith("claude-mem"),
    external ? installation.bridgePath : `${installation.reader} · ${installation.schema}${installation.observations === null ? "" : ` · ${installation.observations} observations`}`,
  ],
];

let failed = false;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? "✓" : "✗"} ${name}: ${detail}`);
  failed ||= !ok;
}
if (installation.error) console.log(`✗ Database: ${installation.error}`);
if (external) {
  console.log("· External claude-mem bridge is active. The built-in reader is used only when this script is absent.");
} else if (installation.viewer?.url) {
  console.log(`✓ claude-mem viewer: ${installation.viewer.url} (separate from this cockpit)`);
} else {
  console.log("· claude-mem viewer: not detected. Its /viewer remains the stream, sessions, and settings. This cockpit maps the same local database.");
}
console.log("· Independent project, not affiliated with claude-mem.");
if (!external) console.log("· The built-in reader is read-only and does not replace the claude-mem viewer.");
if (!installation.databaseExists && !external) {
  console.log("· No local database yet. Run `npm run dashboard -- --demo` to open fictional data.");
}

if (failed || installation.error) {
  console.error("\nSee docs/ADAPTERS.md. Set YOURE_ALWAYS_ON_MY_MIND_BRIDGE_PATH only when you want an external bridge.");
  process.exitCode = 1;
}
