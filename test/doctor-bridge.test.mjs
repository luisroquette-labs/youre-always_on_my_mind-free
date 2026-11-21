import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runDoctor(home, extraEnv = {}) {
  const env = { ...process.env, HOME: home, ...extraEnv };
  delete env.YOURE_ALWAYS_ON_MY_MIND_DATABASE_PATH;
  delete env.YOURE_ALWAYS_ON_MY_MIND_DATA_DIR;
  if (!Object.hasOwn(extraEnv, "YOURE_ALWAYS_ON_MY_MIND_BRIDGE_PATH")) delete env.YOURE_ALWAYS_ON_MY_MIND_BRIDGE_PATH;
  return spawnSync(process.execPath, ["scripts/doctor.mjs"], { env, encoding: "utf8" });
}

const home = mkdtempSync(join(tmpdir(), "yaom-doctor-bridge-"));
const bridge = join(home, ".codex", "skills", "claude-mem-bridge", "scripts", "claude-mem");
mkdirSync(join(home, ".codex", "skills", "claude-mem-bridge", "scripts"), { recursive: true });
writeFileSync(bridge, "#!/bin/sh\nprintf '%s\\n' '{\"ok\":true}'\n");
chmodSync(bridge, 0o755);

const detected = runDoctor(home);
assert.equal(detected.status, 0, detected.stderr);
assert.match(detected.stdout, /✓ Memory bridge: .*claude-mem-bridge\/scripts\/claude-mem/);
assert.match(detected.stdout, /External claude-mem bridge is active/);
assert.doesNotMatch(detected.stdout, /No local database yet/);

const explicit = runDoctor(mkdtempSync(join(tmpdir(), "yaom-doctor-explicit-")), {
  YOURE_ALWAYS_ON_MY_MIND_BRIDGE_PATH: bridge,
});
assert.equal(explicit.status, 0, explicit.stderr);
assert.ok(explicit.stdout.includes(`Memory bridge: ${bridge}`), explicit.stdout);

const missing = runDoctor(mkdtempSync(join(tmpdir(), "yaom-doctor-missing-")), {
  YOURE_ALWAYS_ON_MY_MIND_BRIDGE_PATH: join(home, "missing-bridge"),
});
assert.notEqual(missing.status, 0);
assert.match(missing.stdout, /✗ Memory bridge:/);

const builtinOnly = runDoctor(mkdtempSync(join(tmpdir(), "yaom-doctor-builtin-")));
assert.notEqual(builtinOnly.status, 0);
assert.match(builtinOnly.stdout, /Memory reader: builtin-claude-mem · missing/);
assert.match(builtinOnly.stdout, /--demo/);

process.stdout.write("External claude-mem bridge doctor tests passed.\n");
