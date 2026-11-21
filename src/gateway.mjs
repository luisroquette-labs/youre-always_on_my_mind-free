import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { config } from "./config.mjs";
import { runBuiltinBridge } from "./claude-mem-bridge.mjs";

const execFileAsync = promisify(execFile);

async function externalBridge(args) {
  let lastError;
  const maximumAttempts = args[0] === "cleanup-delete" ? 1 : 3;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      const isSemantic = args[0] === "semantic" || args[0] === "cleanup-candidates";
      const isHealth = args[0] === "health";
      const isLocalEmbedding = args[0] === "semantic-search";
      const { stdout } = await execFileAsync(config.bridgePath, args, {
        maxBuffer: isSemantic ? 16_000_000 : 1_000_000,
        timeout: isHealth ? 45_000 : isSemantic ? 25_000 : isLocalEmbedding ? 60_000 : 12_000,
      });
      return JSON.parse(stdout.trim());
    } catch (error) {
      lastError = error;
      if (attempt + 1 < maximumAttempts) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  const detail = String(lastError?.stderr ?? lastError?.message ?? "Unknown bridge failure").trim().split("\n").filter(Boolean).at(-1);
  const wrapped = new Error(`Memory gateway could not complete the request: ${detail}`);
  wrapped.cause = lastError;
  throw wrapped;
}

export async function dispatchMemory(args, { locale = "en" } = {}) {
  if (config.bridgePath) return externalBridge(args);
  try {
    return runBuiltinBridge(args, {
      databasePath: config.databasePath,
      feedbackPath: config.feedbackPath,
      dataDirectory: config.dataDirectory,
      locale,
    });
  } catch (error) {
    const wrapped = new Error(error instanceof Error ? error.message : "Memory gateway could not complete the request.");
    wrapped.stderr = wrapped.message;
    throw wrapped;
  }
}
