import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectInstallation, runBuiltinBridge } from "../src/claude-mem-bridge.mjs";

const root = mkdtempSync(join(tmpdir(), "yaom-claude-mem-"));
const databasePath = join(root, "claude-mem.db");
const feedbackPath = join(root, "gateway-feedback.jsonl");
execFileSync("sqlite3", [databasePath, `
CREATE TABLE observations (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  sdk_session_id TEXT NOT NULL,
  project TEXT NOT NULL,
  title TEXT,
  subtitle TEXT,
  narrative TEXT,
  text TEXT,
  type TEXT,
  concepts TEXT,
  files_read TEXT,
  files_modified TEXT,
  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL
);
INSERT INTO observations (id, session_id, sdk_session_id, project, title, narrative, type, concepts, files_read, created_at, created_at_epoch)
VALUES
  (1, 's1', 'sdk1', 'northwind', 'Cache tile manifests', 'Keep manifests for one day', 'decision', '["tile cache"]', '["src/atlas/tiles.ts"]', '2026-11-18T15:00:00Z', 1763478000000),
  (2, 's2', 'sdk2', 'northwind', 'Cache tile manifests', 'Same fictional decision', 'decision', '["tile cache"]', '["src/atlas/tiles.ts"]', '2026-11-10T15:00:00Z', 1762786800000),
  (3, 's3', 'sdk3', 'harbor', 'Sign webhook retries', 'Retries stay idempotent', 'bugfix', '["idempotent webhook"]', '["src/webhooks/idempotency.ts"]', '2026-11-16T15:00:00Z', 1763305200000);
`]);
writeFileSync(feedbackPath, '{"observation_id":2,"label":"obsolete"}\n');
const options = { databasePath, feedbackPath, dataDirectory: root, locale: "en" };

const health = runBuiltinBridge(["health"], options);
assert.equal(health.ok, true);
assert.equal(health.read_only, true);
assert.equal(health.schema_baseline, "claude-mem-observations-v1");
assert.equal(health.affiliated, false);
const stats = runBuiltinBridge(["stats"], options);
assert.equal(stats[0].observations, 3);
const projects = runBuiltinBridge(["projects", "10"], options);
assert.equal(projects[0].project, "northwind");
assert.equal(projects[0].claude_observations, 0);
assert.equal(projects[0].other_observations, 2);
const memories = runBuiltinBridge(["project-memories", "--project", "northwind", "--type", "all", "--agent", "all", "--limit", "10", "--offset", "0"], options);
assert.equal(memories.records.length, 1);
assert.equal(memories.records[0].id, 1);
assert.equal(memories.records[0].agent, "legacy");
const detail = runBuiltinBridge(["inspect-memory", "--id", "1", "--project", "northwind"], options);
assert.match(detail.summary, /manifests/);
const timeline = runBuiltinBridge(["timeline", "90", "week"], options);
assert.ok(timeline.points.length > 0);
assert.equal(timeline.events[0].label, "Largest expansion");
const preview = runBuiltinBridge(["cleanup-simulate", "--ids", "2"], options);
assert.equal(preview.read_only, true);
assert.equal(preview.confirmation_phrase, "DELETE 1");
assert.throws(() => runBuiltinBridge(["cleanup-delete", "--ids", "2", "--confirm-token", preview.confirmation_token, "--phrase", "DELETE 1"], options), /read-only/);
assert.equal(Number(execFileSync("sqlite3", [databasePath, "SELECT count(*) FROM observations;"], { encoding: "utf8" }).trim()), 3);

const richRoot = mkdtempSync(join(tmpdir(), "yaom-claude-mem-rich-"));
const richDb = join(richRoot, "claude-mem.db");
execFileSync("sqlite3", [richDb, `
CREATE TABLE observations (
  id INTEGER PRIMARY KEY, project TEXT NOT NULL, title TEXT, created_at TEXT NOT NULL, created_at_epoch INTEGER NOT NULL, agent_type TEXT
);
INSERT INTO observations VALUES (1, 'codex-lab', 'Ship the fixture', '2026-11-18T15:00:00Z', 1763478000000, 'codex');
`]);
const rich = runBuiltinBridge(["projects", "5"], { databasePath: richDb, feedbackPath: join(richRoot, "missing.jsonl"), dataDirectory: richRoot, locale: "en" });
assert.equal(rich[0].codex_observations, 1);

mkdirSync(join(root, "settings"), { recursive: true });
writeFileSync(join(root, "settings.json"), '{"CLAUDE_MEM_WORKER_PORT":37777}\n');
const installation = inspectInstallation({ databasePath, bridgePath: null, dataDirectory: root });
assert.equal(installation.reader, "builtin-claude-mem");
assert.equal(installation.viewer.url, "http://127.0.0.1:37777/viewer");
assert.equal(installation.observations, 3);
const missing = inspectInstallation({ databasePath: join(root, "absent.db"), bridgePath: null, dataDirectory: root });
assert.equal(missing.databaseExists, false);

process.stdout.write("Current claude-mem SQLite reader tests passed.\n");
