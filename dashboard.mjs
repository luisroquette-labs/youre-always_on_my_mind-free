import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAutomaticClusters, buildSemanticRelations } from "./semantic-relations.mjs";
import { config } from "./src/config.mjs";
import { dispatchMemory } from "./src/gateway.mjs";
import { demoDispatch } from "./dashboard/demo-data.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.MEMORY_GATEWAY_DASHBOARD_PORT ?? process.argv.find((value, index) => process.argv[index - 1] === "--port") ?? 4317);
const forceDemo = process.argv.includes("--demo") || process.env.YOURE_ALWAYS_ON_MY_MIND_DEMO === "1";
const databasePath = config.databasePath;
const feedbackPath = config.feedbackPath;
const remotePassword = process.env.MEMORY_GATEWAY_REMOTE_PASSWORD ?? "";
const remoteUsername = process.env.MEMORY_GATEWAY_REMOTE_USERNAME ?? "admin";
const remoteReadOnly = process.env.MEMORY_GATEWAY_REMOTE_READONLY === "1";
const staticFiles = new Map([
  ["/", join(root, "dashboard", "index.html")],
  ["/assets/app.js", join(root, "dashboard", "app.js")],
  ["/assets/persistent-layout.js", join(root, "dashboard", "persistent-layout.js")],
  ["/assets/styles.css", join(root, "dashboard", "styles.css")],
  ["/assets/i18n.js", join(root, "dashboard", "i18n.js")],
  ["/assets/icon.svg", join(root, "assets", "brand", "icon.svg")],
  ["/assets/icon-240.png", join(root, "assets", "brand", "icon-240.png")],
  ["/vendor/three.module.js", join(root, "node_modules", "three", "build", "three.module.js")],
  ["/vendor/three.core.js", join(root, "node_modules", "three", "build", "three.core.js")],
  ["/vendor/OrbitControls.js", join(root, "node_modules", "three", "examples", "jsm", "controls", "OrbitControls.js")],
]);
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
let overviewCache;
let cacheExpiresAt = 0;
let healthCache = { ok: null, integrity: "checking", schema_baseline: "checking", fts_ready: null };
let semanticCache;
let semanticCacheKey = "";
const timelineCache = new Map();

function requestLocale(request, url) {
  const query = url?.searchParams?.get("lang") ?? "";
  if (query) return query.toLowerCase().startsWith("pt") ? "pt" : "en";
  return String(request?.headers?.["accept-language"] ?? "").toLowerCase().startsWith("pt") ? "pt" : "en";
}

function requestContext(request, url) {
  return {
    demo: forceDemo || url?.searchParams?.get("demo") === "1",
    locale: requestLocale(request, url),
  };
}

async function bridge(args, context = { demo: forceDemo, locale: "en" }) {
  if (context.demo) return demoDispatch(args, context.locale);
  return dispatchMemory(args, { locale: context.locale });
}

function bridgeError(error, locale = "en") {
  const fallback = locale === "pt" ? "Operação recusada." : "Operation refused.";
  const detail = String(error?.stderr ?? error?.message ?? fallback).trim().split("\n").filter(Boolean).at(-1);
  return detail || fallback;
}

function say(locale, en, pt) {
  return locale === "pt" ? pt : en;
}

async function jsonBody(request, maximumBytes = 64_000) {
  if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new Error("Content-Type must be application/json.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function localOriginAllowed(request) {
  const origin = request.headers.origin;
  return !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function cleanupIds(value, locale) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500 || value.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new Error(say(locale, "Select between 1 and 500 candidate memories.", "Selecione entre 1 e 500 memórias candidatas."));
  }
  return [...new Set(value)].sort((left, right) => left - right);
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

function remoteAuthorized(request) {
  if (!remotePassword) return true;
  const header = String(request.headers.authorization ?? "");
  if (!header.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    const username = Buffer.from(decoded.slice(0, separator));
    const password = Buffer.from(decoded.slice(separator + 1));
    const expectedUsername = Buffer.from(remoteUsername);
    const expectedPassword = Buffer.from(remotePassword);
    return separator > 0
      && username.length === expectedUsername.length
      && password.length === expectedPassword.length
      && timingSafeEqual(username, expectedUsername)
      && timingSafeEqual(password, expectedPassword);
  } catch {
    return false;
  }
}

function daysSince(date) {
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000));
}

async function readFeedback() {
  const counts = { useful: 0, incorrect: 0, obsolete: 0 };
  if (!existsSync(feedbackPath)) return counts;
  for (const line of (await readFile(feedbackPath, "utf8")).split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event.label in counts) counts[event.label] += 1;
    } catch {
    }
  }
  return counts;
}

async function semanticGraph(projects, database, context) {
  const key = `${context.demo ? "demo" : "live"}:${context.locale}:${database.size}:${database.mtimeMs}`;
  if (!context.demo && semanticCache && semanticCacheKey === key) return semanticCache;
  const payload = await bridge(["semantic", "120"], context);
  const graph = buildSemanticRelations(payload, projects.map(({ project }) => project));
  graph.clusters = buildAutomaticClusters(graph, projects, context.locale);
  graph.metadata.generated_at = new Date().toISOString();
  if (!context.demo) {
    semanticCache = graph;
    semanticCacheKey = key;
  }
  return graph;
}

async function overview(context = { demo: forceDemo, locale: "en" }) {
  if (!context.demo && overviewCache && Date.now() < cacheExpiresAt) return overviewCache;
  const database = context.demo ? { size: 18_743_296, mtimeMs: 0 } : await stat(databasePath);
  const [stats, recent, rawProjects, feedback, embeddings, alerts] = await Promise.all([
    bridge(["stats"], context),
    bridge(["recent", "16"], context),
    bridge(["projects", "80"], context),
    context.demo ? { useful: 42, incorrect: 3, obsolete: 1 } : readFeedback(),
    bridge(["embedding-health"], context),
    bridge(["alerts"], context),
  ]);
  const maximum = Math.max(1, ...rawProjects.map((project) => project.observations));
  const baseProjects = rawProjects.map((project) => {
    const ageDays = daysSince(project.last_activity);
    const claude = (project.claude_observations ?? 0) + (project.other_observations ?? 0);
    const codex = project.codex_observations ?? 0;
    const volumeScore = Math.log1p(project.observations) / Math.log1p(maximum);
    const saturationScore = Math.round(Math.min(100, volumeScore * 88 + Math.min(ageDays / 365, 1) * 12));
    return {
      ...project,
      claude_observations: claude,
      codex_observations: codex,
      age_days: ageDays,
      saturation_score: saturationScore,
      saturation: saturationScore >= 78 ? "high" : saturationScore >= 58 ? "watch" : "healthy",
    };
  });
  const semantic = await semanticGraph(baseProjects, database, context);
  const projects = baseProjects.map((project) => ({
    ...project,
    ...(semantic.project_metrics[project.project] ?? { connections: 0, semantic_strength: 0 }),
    cluster_membership: semantic.clusters.project_memberships[project.project],
  }));
  const active = projects.filter((project) => project.age_days <= 60);
  const reinforce = active.filter((project) => project.observations <= 4).sort((a, b) => a.observations - b.observations).slice(0, 8);
  const saturated = [...projects].sort((a, b) => b.saturation_score - a.saturation_score).slice(0, 8);
  const review = projects.filter((project) => project.age_days >= 180 && project.observations >= 5).sort((a, b) => b.observations - a.observations).slice(0, 8);
  const payload = {
    stats: stats[0],
    health: healthCache,
    feedback,
    projects,
    relations: semantic.relations,
    semantic: semantic.metadata,
    clusters: semantic.clusters.axes,
    cluster_metadata: semantic.clusters.metadata,
    recent,
    reinforce,
    saturated,
    review,
    database_bytes: database.size,
    embeddings,
    alerts,
    access: { remote: Boolean(remotePassword) && !context.demo, read_only: context.demo ? false : remoteReadOnly },
    demo: Boolean(context.demo),
    fictional: Boolean(context.demo),
    companion: {
      affiliated: false,
      statement: "Independent project, not affiliated with claude-mem.",
      viewer_url: context.demo ? null : healthCache.viewer?.url ?? null,
      reader: context.demo ? "fictional-demo" : config.reader,
    },
    refreshed_at: new Date().toISOString(),
  };
  if (context.demo) return payload;
  overviewCache = payload;
  cacheExpiresAt = Date.now() + 15_000;
  return overviewCache;
}

async function refreshHealth() {
  try {
    healthCache = await bridge(["health"], { demo: forceDemo, locale: "en" });
    cacheExpiresAt = 0;
  } catch {
  }
}

void refreshHealth();
setInterval(refreshHealth, 60_000).unref();

createServer(async (request, response) => {
  try {
    if (!remoteAuthorized(request)) {
      response.writeHead(401, {
        "content-type": "text/plain; charset=utf-8",
        "www-authenticate": `Basic realm="${config.appName}", charset="UTF-8"`,
        "cache-control": "no-store",
      });
      response.end("Authentication required.");
      return;
    }
    const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const context = requestContext(request, requestUrl);
    if (remoteReadOnly && !context.demo && !["GET", "HEAD"].includes(request.method ?? "")) {
      sendJson(response, 403, { error: say(context.locale, "Remote access is read only.", "Acesso remoto somente leitura.") });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/overview") {
      sendJson(response, 200, await overview(context));
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/alerts") {
      const project = requestUrl.searchParams.get("project") ?? "";
      if (project.length > 120) {
        sendJson(response, 400, { error: say(context.locale, "Invalid project.", "Projeto inválido.") });
        return;
      }
      sendJson(response, 200, await bridge(project ? ["alerts", "--project", project] : ["alerts"], context));
      return;
    }
    if (request.method === "PUT" && requestUrl.pathname === "/api/alerts/config") {
      if (!localOriginAllowed(request)) {
        sendJson(response, 403, { error: say(context.locale, "Origin is not allowed.", "Origem não autorizada.") });
        return;
      }
      const input = await jsonBody(request, 32_000);
      let result;
      try {
        result = input.reset
          ? await bridge(["alert-config-reset"], context)
          : await bridge(["alert-config-set", "--json", JSON.stringify(input.config ?? {})], context);
      } catch (error) {
        sendJson(response, 400, { error: bridgeError(error, context.locale) });
        return;
      }
      overviewCache = undefined;
      cacheExpiresAt = 0;
      sendJson(response, 200, result);
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/cleanup/candidates") {
      const project = requestUrl.searchParams.get("project") ?? "";
      const kind = requestUrl.searchParams.get("kind") ?? "all";
      const limit = requestUrl.searchParams.get("limit") ?? "250";
      if (!["all", "duplicate", "obsolete"].includes(kind) || !/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > 500) {
        sendJson(response, 400, { error: say(context.locale, "Invalid cleanup filters.", "Filtros de limpeza inválidos.") });
        return;
      }
      const args = ["cleanup-candidates", "--kind", kind, "--limit", limit];
      if (project) args.push("--project", project);
      sendJson(response, 200, await bridge(args, context));
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/timeline") {
      const range = requestUrl.searchParams.get("range") ?? "90";
      const bucket = requestUrl.searchParams.get("bucket") ?? "auto";
      if (!["30", "90", "180", "365", "all"].includes(range) || !["auto", "day", "week", "month"].includes(bucket)) {
        sendJson(response, 400, { error: say(context.locale, "Invalid timeline filters.", "Filtros temporais inválidos.") });
        return;
      }
      if (context.demo) {
        sendJson(response, 200, await bridge(["timeline", range, bucket], context));
        return;
      }
      const database = await stat(databasePath);
      const key = `${context.locale}:${range}:${bucket}:${database.size}:${database.mtimeMs}`;
      if (!timelineCache.has(key)) {
        timelineCache.clear();
        timelineCache.set(key, await bridge(["timeline", range, bucket], context));
      }
      sendJson(response, 200, timelineCache.get(key));
      return;
    }
    const projectMemoriesMatch = requestUrl.pathname.match(/^\/api\/projects\/([^/]+)\/memories$/);
    if (request.method === "GET" && projectMemoriesMatch) {
      const project = decodeURIComponent(projectMemoriesMatch[1]);
      const query = requestUrl.searchParams.get("q") ?? "";
      const type = requestUrl.searchParams.get("type") ?? "all";
      const agent = requestUrl.searchParams.get("agent") ?? "all";
      const limit = requestUrl.searchParams.get("limit") ?? "25";
      const offset = requestUrl.searchParams.get("offset") ?? "0";
      const searchMode = requestUrl.searchParams.get("search_mode") ?? "keyword";
      if (!project || project.length > 120 || query.length > 200 || !["all", "claude", "codex", "legacy"].includes(agent)
        || !["keyword", "semantic"].includes(searchMode)
        || !/^(all|[\p{L}\p{N}_-]{1,80})$/u.test(type) || !/^[1-9][0-9]?$|^100$/.test(limit)
        || !/^[0-9]{1,6}$/.test(offset) || Number(offset) > 100_000) {
        sendJson(response, 400, { error: say(context.locale, "Invalid memory filters.", "Filtros de memória inválidos.") });
        return;
      }
      const semanticSearch = searchMode === "semantic" && query.trim().length >= 2;
      const args = semanticSearch
        ? ["semantic-search", "--query", query, "--project", project, "--type", type, "--agent", agent, "--limit", limit, "--offset", offset]
        : ["project-memories", "--project", project, "--type", type, "--agent", agent, "--limit", limit, "--offset", offset];
      if (query && !semanticSearch) args.push("--query", query);
      try {
        sendJson(response, 200, await bridge(args, context));
      } catch (error) {
        sendJson(response, 409, { error: bridgeError(error, context.locale) });
      }
      return;
    }
    const memoryDetailMatch = requestUrl.pathname.match(/^\/api\/memories\/([1-9][0-9]*)$/);
    if (request.method === "GET" && memoryDetailMatch) {
      const project = requestUrl.searchParams.get("project") ?? "";
      if (!project || project.length > 120) {
        sendJson(response, 400, { error: say(context.locale, "The memory project is required.", "O projeto da memória é obrigatório.") });
        return;
      }
      try {
        sendJson(response, 200, await bridge(["inspect-memory", "--id", memoryDetailMatch[1], "--project", project], context));
      } catch (error) {
        sendJson(response, 404, { error: bridgeError(error, context.locale) });
      }
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/cleanup/preview") {
      if (!localOriginAllowed(request)) {
        sendJson(response, 403, { error: say(context.locale, "Origin is not allowed.", "Origem não autorizada.") });
        return;
      }
      const input = await jsonBody(request);
      const ids = cleanupIds(input.ids, context.locale);
      try {
        sendJson(response, 200, await bridge(["cleanup-preview", "--ids", ids.join(",")], context));
      } catch (error) {
        sendJson(response, 409, { error: bridgeError(error, context.locale) });
      }
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/cleanup/simulate") {
      if (!localOriginAllowed(request)) {
        sendJson(response, 403, { error: say(context.locale, "Origin is not allowed.", "Origem não autorizada.") });
        return;
      }
      const input = await jsonBody(request);
      const ids = cleanupIds(input.ids, context.locale);
      try {
        sendJson(response, 200, await bridge(["cleanup-simulate", "--ids", ids.join(",")], context));
      } catch (error) {
        sendJson(response, 409, { error: bridgeError(error, context.locale) });
      }
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/cleanup/execute") {
      if (!localOriginAllowed(request)) {
        sendJson(response, 403, { error: say(context.locale, "Origin is not allowed.", "Origem não autorizada.") });
        return;
      }
      const input = await jsonBody(request);
      const ids = cleanupIds(input.ids, context.locale);
      if (!/^[a-f0-9]{64}$/.test(input.confirmation_token ?? "") || ![`DELETE ${ids.length}`, `EXCLUIR ${ids.length}`].includes(input.phrase)) {
        sendJson(response, 400, { error: say(context.locale, "Invalid delete confirmation.", "Confirmação de exclusão inválida.") });
        return;
      }
      let result;
      try {
        result = await bridge([
          "cleanup-delete", "--ids", ids.join(","), "--confirm-token", input.confirmation_token, "--phrase", input.phrase,
        ], context);
      } catch (error) {
        sendJson(response, 409, { error: bridgeError(error, context.locale) });
        return;
      }
      overviewCache = undefined;
      semanticCache = undefined;
      timelineCache.clear();
      cacheExpiresAt = 0;
      sendJson(response, 200, result);
      return;
    }
    const filePath = request.method === "GET" ? staticFiles.get(requestUrl.pathname) : undefined;
    if (!filePath) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end('{"error":"Not found"}');
      return;
    }
    let body = await readFile(filePath);
    if (requestUrl.pathname === "/" && (forceDemo || requestUrl.searchParams.get("demo") === "1")) {
      body = Buffer.from(body.toString("utf8").replace("</head>", "<script>window.__YAOM_DEMO__=true</script></head>"));
    }
    response.writeHead(200, { "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream", "cache-control": "no-cache" });
    response.end(body);
  } catch (error) {
    if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Dashboard error" }));
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`${config.appName}${forceDemo ? " (fictional demo)" : ""}: http://127.0.0.1:${port}${forceDemo ? "/?demo=1" : ""}`);
});
