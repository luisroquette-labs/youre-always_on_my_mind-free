import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();
const defaultDataDirectory = join(home, ".claude-mem");
const legacyBridge = join(home, ".codex", "skills", "claude-mem-bridge", "scripts", "claude-mem");

function configuredPath(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

const explicitBridge = process.env.YOURE_ALWAYS_ON_MY_MIND_BRIDGE_PATH?.trim() || "";
const bridgePath = explicitBridge || (existsSync(legacyBridge) ? legacyBridge : null);

/**
 * Runtime configuration is intentionally environment-based: personal paths,
 * databases and credentials never need to be committed to a repository.
 * When no external bridge is configured, the built-in reader opens the
 * claude-mem SQLite file directly and stays read-only.
 */
export const config = Object.freeze({
  appName: "You're Always on My Mind",
  bridgePath,
  reader: bridgePath ? "external-bridge" : "builtin-claude-mem",
  dataDirectory: configuredPath("YOURE_ALWAYS_ON_MY_MIND_DATA_DIR", defaultDataDirectory),
  databasePath: configuredPath(
    "YOURE_ALWAYS_ON_MY_MIND_DATABASE_PATH",
    join(configuredPath("YOURE_ALWAYS_ON_MY_MIND_DATA_DIR", defaultDataDirectory), "claude-mem.db"),
  ),
  feedbackPath: configuredPath(
    "YOURE_ALWAYS_ON_MY_MIND_FEEDBACK_PATH",
    join(configuredPath("YOURE_ALWAYS_ON_MY_MIND_DATA_DIR", defaultDataDirectory), "gateway-feedback.jsonl"),
  ),
});
