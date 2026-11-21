import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DEFAULT_ALERT_CONFIG = {
  version: 1,
  enabled: true,
  saturation: { enabled: true, threshold: 78, minimum_observations: 5 },
  stale: { enabled: true, days: 90, minimum_observations: 2 },
  inconsistent: { enabled: true, duplicate_threshold: 3, incorrect_feedback_threshold: 2, missing_title_threshold: 3 },
  muted_projects: [],
};

function text(locale, en, pt) {
  return locale === "pt" ? pt : en;
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function fail(message) {
  const error = new Error(message);
  error.stderr = message;
  throw error;
}

function sqlite(databasePath, sql) {
  let output;
  try {
    output = execFileSync("sqlite3", ["-readonly", "-json", "-cmd", ".timeout 8000", databasePath, sql], {
      encoding: "utf8",
      maxBuffer: 16_000_000,
    });
  } catch (error) {
    if (error?.code === "ENOENT") fail("sqlite3 is required to read the local claude-mem database.");
    const detail = String(error?.stderr || error?.message || "Could not read the claude-mem database.").trim().split("\n").filter(Boolean).at(-1);
    fail(detail);
  }
  const trimmed = output.trim();
  return trimmed ? JSON.parse(trimmed) : [];
}

function tableExists(databasePath, name) {
  return sqlite(databasePath, `SELECT 1 AS ok FROM sqlite_master WHERE type IN ('table','view') AND name = ${quote(name)} LIMIT 1;`).length > 0;
}

function columnSet(databasePath, table) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return new Set();
  return new Set(sqlite(databasePath, `PRAGMA table_info(${table});`).map((row) => row.name));
}

function requireDatabase(databasePath) {
  if (!existsSync(databasePath)) {
    fail(`No claude-mem database at ${databasePath}. Install claude-mem, or start the cockpit with --demo for fictional data.`);
  }
  if (!tableExists(databasePath, "observations")) {
    fail("This SQLite file has no observations table. It does not look like a current claude-mem database.");
  }
  const columns = columnSet(databasePath, "observations");
  if (!columns.has("id") || !columns.has("project")) {
    fail("The observations table is missing id or project. Refusing to guess a newer claude-mem schema.");
  }
  return columns;
}

function expr(columns, name, alias = "o") {
  return columns.has(name) ? `${alias}.${name}` : "NULL";
}

function createdExpr(columns, alias = "o") {
  if (columns.has("created_at")) return `coalesce(${alias}.created_at, '')`;
  if (columns.has("created_at_epoch")) return `coalesce(datetime(${alias}.created_at_epoch / 1000, 'unixepoch'), '')`;
  return "''";
}

function epochExpr(columns, alias = "o") {
  if (columns.has("created_at_epoch")) return `coalesce(${alias}.created_at_epoch, 0)`;
  if (columns.has("created_at")) return `coalesce(cast(strftime('%s', ${alias}.created_at) as integer) * 1000, 0)`;
  return "0";
}

function agentExpr(columns, alias = "o") {
  const tests = [];
  if (columns.has("agent_type")) {
    tests.push(`WHEN lower(coalesce(${alias}.agent_type, '')) IN ('codex') THEN 'codex'`);
    tests.push(`WHEN lower(coalesce(${alias}.agent_type, '')) IN ('claude', 'claude-code', 'claude_code') THEN 'claude'`);
  }
  if (columns.has("platform_source")) {
    tests.push(`WHEN lower(coalesce(${alias}.platform_source, '')) LIKE '%codex%' THEN 'codex'`);
    tests.push(`WHEN lower(coalesce(${alias}.platform_source, '')) LIKE '%claude%' THEN 'claude'`);
  }
  if (!tests.length) return "'legacy'";
  return `CASE ${tests.join(" ")} ELSE 'legacy' END`;
}

function option(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function flag(args, name) {
  return args.includes(name);
}

function integerOption(args, name, fallback, minimum, maximum) {
  const value = Number(option(args, name, String(fallback)));
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail(`Invalid ${name} value.`);
  return value;
}

function readViewer(dataDirectory) {
  const settingsPath = join(dataDirectory, "settings.json");
  let port = null;
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const parsed = Number(settings.CLAUDE_MEM_WORKER_PORT);
      if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) port = parsed;
    } catch {
      port = null;
    }
  }
  return {
    product: "claude-mem",
    affiliated: false,
    complementary: true,
    viewer_path: "/viewer",
    port,
    url: port ? `http://127.0.0.1:${port}/viewer` : null,
    note: "claude-mem ships its own viewer for the live memory stream, sessions, and settings. This cockpit is a separate local map of projects, clusters, quality, and cleanup. Independent project, not affiliated with claude-mem.",
  };
}

function secretPatterns() {
  return [
    /\bsk-[A-Za-z0-9_-]{12,}\b/g,
    /\bAKIA[A-Z0-9]{16}\b/g,
    /\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
    /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    /\b(api[_-]?key|secret|token|password|authorization|private[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
  ];
}

function redact(value, locale, maximum = 4000) {
  let output = String(value ?? "").replaceAll("\u0000", "").trim();
  let count = 0;
  const marker = text(locale, "[redacted]", "[redigido]");
  for (const pattern of secretPatterns()) {
    output = output.replace(pattern, () => {
      count += 1;
      return marker;
    });
  }
  if (output.length > maximum) output = `${output.slice(0, maximum).trimEnd()}…`;
  return { text: output, count };
}

function jsonList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => typeof item === "string" ? item : JSON.stringify(item));
    if (parsed && typeof parsed === "object") return Object.entries(parsed).map(([key, item]) => `${key}: ${item}`);
  } catch {
    // Historical rows may store plain text.
  }
  return [String(value)];
}

function feedbackMap(feedbackPath) {
  const feedback = new Map();
  if (!existsSync(feedbackPath)) return feedback;
  for (const line of readFileSync(feedbackPath, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (!Number.isInteger(event.observation_id) || !["useful", "incorrect", "obsolete"].includes(event.label)) continue;
      const counts = feedback.get(event.observation_id) ?? { useful: 0, incorrect: 0, obsolete: 0 };
      counts[event.label] += 1;
      feedback.set(event.observation_id, counts);
    } catch {
      // Ignore a partial last line.
    }
  }
  return feedback;
}

function alertConfigPath(databasePath) {
  return join(dirname(databasePath), "yaom-alert-config.json");
}

function loadAlertConfig(databasePath) {
  const path = alertConfigPath(databasePath);
  if (!existsSync(path)) return structuredClone(DEFAULT_ALERT_CONFIG);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      ...structuredClone(DEFAULT_ALERT_CONFIG),
      ...parsed,
      saturation: { ...DEFAULT_ALERT_CONFIG.saturation, ...(parsed.saturation ?? {}) },
      stale: { ...DEFAULT_ALERT_CONFIG.stale, ...(parsed.stale ?? {}) },
      inconsistent: { ...DEFAULT_ALERT_CONFIG.inconsistent, ...(parsed.inconsistent ?? {}) },
      muted_projects: Array.isArray(parsed.muted_projects) ? parsed.muted_projects.map(String).slice(0, 200) : [],
    };
  } catch {
    return structuredClone(DEFAULT_ALERT_CONFIG);
  }
}

function saveAlertConfig(databasePath, config) {
  const path = alertConfigPath(databasePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return config;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Math.round(Number(value) || 0)));
}

function qualityFor(row, feedback, locale) {
  const summaryLength = Number(row.summary_length ?? 0);
  const relevance = clamp((summaryLength > 80 ? 36 : 12) + (Number(row.facts_count) ? 18 : 0) + (Number(row.concepts_count) ? 12 : 0) + Math.min(20, Number(row.files_count) * 4) + Math.min(24, feedback.useful * 8));
  const redundancy = clamp(Number(row.content_duplicate_count) > 1 || Number(row.title_duplicate_count) > 2 ? 42 + Number(row.title_duplicate_count) * 8 : 8);
  const ageDays = Math.max(0, Math.floor((Date.now() - Number(row.created_at_epoch || 0)) / 86_400_000));
  const age = clamp(ageDays / 4);
  const utility = clamp(28 + feedback.useful * 18 - feedback.incorrect * 22 - feedback.obsolete * 30 + (summaryLength > 40 ? 16 : 0));
  const exclusionRisk = clamp((feedback.useful > 0 ? 70 : 35) + (redundancy > 60 ? -25 : 10) - feedback.obsolete * 20);
  const overall = clamp(relevance * 0.34 + (100 - redundancy) * 0.18 + (100 - age) * 0.16 + utility * 0.2 + (100 - exclusionRisk) * 0.12);
  const label = overall >= 75 ? "strong" : overall >= 55 ? "solid" : overall >= 35 ? "review" : "weak";
  return {
    overall,
    label,
    confidence: 62,
    version: "builtin-readonly-v1",
    relevance,
    redundancy,
    age,
    age_days: ageDays,
    utility,
    exclusion_risk: exclusionRisk,
    evidence: [
      text(locale, "Estimated locally from title, summary, files, age, and feedback.", "Estimado localmente a partir de título, resumo, arquivos, idade e feedback."),
      redundancy > 50 ? text(locale, "Repeated title or content.", "Título ou conteúdo repetido.") : text(locale, "No exact duplicate detected in this sample.", "Nenhuma duplicata exata nesta amostra."),
    ],
  };
}

function projects(databasePath, columns, limit) {
  const rows = sqlite(databasePath, `
    SELECT project,
      count(*) AS observations,
      max(created_at) AS last_activity,
      sum(CASE WHEN agent = 'claude' THEN 1 ELSE 0 END) AS claude_observations,
      sum(CASE WHEN agent = 'codex' THEN 1 ELSE 0 END) AS codex_observations,
      sum(CASE WHEN agent = 'legacy' THEN 1 ELSE 0 END) AS other_observations
    FROM (
      SELECT project, ${createdExpr(columns)} AS created_at, ${agentExpr(columns)} AS agent
      FROM observations o
      WHERE project IS NOT NULL AND trim(project) <> ''
    )
    GROUP BY project
    ORDER BY observations DESC, project
    LIMIT ${limit};
  `);
  return rows.map((row) => ({
    project: row.project,
    observations: Number(row.observations),
    last_activity: row.last_activity,
    claude_observations: Number(row.claude_observations ?? 0),
    codex_observations: Number(row.codex_observations ?? 0),
    other_observations: Number(row.other_observations ?? 0),
  }));
}

function health(databasePath, dataDirectory) {
  const viewer = readViewer(dataDirectory);
  if (!existsSync(databasePath)) {
    return { ok: false, integrity: "missing", schema_baseline: "missing", fts_ready: false, reader: "builtin-claude-mem", read_only: true, viewer };
  }
  let integrity = "ok";
  try {
    const check = sqlite(databasePath, "PRAGMA quick_check;");
    integrity = String(check[0]?.quick_check ?? "ok");
  } catch (error) {
    integrity = error.message;
  }
  const columns = tableExists(databasePath, "observations") ? columnSet(databasePath, "observations") : new Set();
  const compatible = columns.has("id") && columns.has("project") && (columns.has("created_at") || columns.has("created_at_epoch"));
  return {
    ok: integrity === "ok" && compatible,
    integrity,
    schema_baseline: compatible ? "claude-mem-observations-v1" : "incompatible",
    fts_ready: tableExists(databasePath, "observations_fts"),
    reader: "builtin-claude-mem",
    read_only: true,
    viewer,
    affiliated: false,
  };
}

function alerts(databasePath, columns, feedbackPath, projectFilter, locale) {
  const settings = loadAlertConfig(databasePath);
  const rows = sqlite(databasePath, `
    SELECT project, count(*) AS observations, max(${createdExpr(columns)}) AS last_activity,
      sum(CASE WHEN trim(coalesce(${expr(columns, "title")}, '')) = '' THEN 1 ELSE 0 END) AS missing_titles
    FROM observations o
    WHERE project IS NOT NULL AND trim(project) <> ''
    GROUP BY project;
  `);
  const duplicateRows = columns.has("title") ? sqlite(databasePath, `
    SELECT project, sum(extra) AS excess FROM (
      SELECT project, count(*) - 1 AS extra
      FROM observations
      WHERE trim(coalesce(title, '')) <> ''
      GROUP BY project, lower(trim(title))
      HAVING count(*) > 1
    ) GROUP BY project;
  `) : [];
  const duplicateMap = new Map(duplicateRows.map((row) => [row.project, Number(row.excess)]));
  const feedback = feedbackMap(feedbackPath);
  const feedbackByProject = new Map();
  if (feedback.size) {
    const ids = [...feedback.keys()];
    for (let index = 0; index < ids.length; index += 400) {
      const batch = ids.slice(index, index + 400);
      const found = sqlite(databasePath, `SELECT id, project FROM observations WHERE id IN (${batch.join(",")});`);
      for (const row of found) {
        const signals = feedback.get(row.id);
        const summary = feedbackByProject.get(row.project) ?? { incorrect: 0, conflicting: 0 };
        summary.incorrect += signals.incorrect;
        if (signals.useful > 0 && (signals.incorrect > 0 || signals.obsolete > 0)) summary.conflicting += 1;
        feedbackByProject.set(row.project, summary);
      }
    }
  }
  const maximum = Math.max(1, ...rows.map((row) => Number(row.observations)));
  const muted = new Set(settings.muted_projects);
  const records = [];
  for (const row of rows) {
    if (projectFilter && row.project !== projectFilter) continue;
    const observations = Number(row.observations);
    const days = Math.max(0, Math.floor((Date.now() - new Date(row.last_activity).getTime()) / 86_400_000));
    const saturationScore = Math.round(Math.min(100, (Math.log1p(observations) / Math.log1p(maximum)) * 88 + Math.min(days / 365, 1) * 12));
    const duplicateExcess = duplicateMap.get(row.project) ?? 0;
    const feedbackSignals = feedbackByProject.get(row.project) ?? { incorrect: 0, conflicting: 0 };
    const missingTitles = Number(row.missing_titles ?? 0);
    if (!settings.enabled || muted.has(row.project)) continue;
    if (settings.saturation.enabled && observations >= settings.saturation.minimum_observations && saturationScore >= settings.saturation.threshold) {
      records.push({
        id: `saturation:${row.project}`,
        kind: "saturation",
        severity: saturationScore >= Math.min(100, settings.saturation.threshold + 12) ? "critical" : "warning",
        project: row.project,
        title: text(locale, "Saturated memory", "Memória saturada"),
        message: text(locale, `${observations.toLocaleString("en")} memories at ${saturationScore}% pressure.`, `${observations.toLocaleString("pt-BR")} memórias e pressão de ${saturationScore}%.`),
        value: saturationScore,
        threshold: settings.saturation.threshold,
        evidence: { observations, age_days: days, saturation_score: saturationScore },
      });
    }
    if (settings.stale.enabled && observations >= settings.stale.minimum_observations && days >= settings.stale.days) {
      records.push({
        id: `stale:${row.project}`,
        kind: "stale",
        severity: days >= settings.stale.days * 2 ? "critical" : "warning",
        project: row.project,
        title: text(locale, "Stale memory", "Memória desatualizada"),
        message: text(locale, `No activity for ${days} days.`, `Sem atividade há ${days} dias.`),
        value: days,
        threshold: settings.stale.days,
        evidence: { observations, age_days: days, last_activity: row.last_activity },
      });
    }
    const inconsistent = duplicateExcess >= settings.inconsistent.duplicate_threshold
      || feedbackSignals.incorrect >= settings.inconsistent.incorrect_feedback_threshold
      || missingTitles >= settings.inconsistent.missing_title_threshold
      || feedbackSignals.conflicting > 0;
    if (settings.inconsistent.enabled && inconsistent) {
      const reasons = [];
      if (duplicateExcess >= settings.inconsistent.duplicate_threshold) reasons.push(text(locale, `${duplicateExcess} repeated titles`, `${duplicateExcess} títulos repetidos`));
      if (feedbackSignals.incorrect >= settings.inconsistent.incorrect_feedback_threshold) reasons.push(text(locale, `${feedbackSignals.incorrect} incorrect feedback marks`, `${feedbackSignals.incorrect} feedbacks incorretos`));
      if (missingTitles >= settings.inconsistent.missing_title_threshold) reasons.push(text(locale, `${missingTitles} missing titles`, `${missingTitles} títulos ausentes`));
      records.push({
        id: `inconsistent:${row.project}`,
        kind: "inconsistent",
        severity: feedbackSignals.incorrect > 0 || duplicateExcess >= settings.inconsistent.duplicate_threshold * 4 ? "critical" : "warning",
        project: row.project,
        title: text(locale, "Inconsistent memory", "Memória inconsistente"),
        message: `${reasons.join(" · ")}.`,
        value: duplicateExcess + feedbackSignals.incorrect + missingTitles,
        threshold: 1,
        evidence: { repeated_title_excess: duplicateExcess, incorrect_feedback: feedbackSignals.incorrect, missing_titles: missingTitles },
      });
    }
  }
  const order = { critical: 0, warning: 1 };
  records.sort((left, right) => order[left.severity] - order[right.severity] || right.value - left.value || left.project.localeCompare(right.project));
  const byKind = { saturation: 0, stale: 0, inconsistent: 0 };
  for (const alert of records) byKind[alert.kind] += 1;
  return {
    enabled: settings.enabled,
    summary: {
      total: records.length,
      critical: records.filter(({ severity }) => severity === "critical").length,
      warning: records.filter(({ severity }) => severity === "warning").length,
      by_kind: byKind,
      evaluated_projects: rows.length,
      muted_projects: settings.muted_projects.length,
    },
    alerts: records,
    config: settings,
    metadata: { version: "alerts-builtin-v1", generated_at: new Date().toISOString(), local_only: true, read_only_reader: true },
  };
}

function bare(columns, name) {
  return columns.has(name) ? name : "NULL";
}

function semantic(databasePath, columns, limit) {
  const rows = sqlite(databasePath, `
    SELECT project, ${bare(columns, "title")} AS title, ${bare(columns, "subtitle")} AS subtitle,
      ${bare(columns, "narrative")} AS narrative, ${bare(columns, "text")} AS text, ${bare(columns, "type")} AS type,
      ${bare(columns, "concepts")} AS concepts, ${bare(columns, "files_read")} AS files_read, ${bare(columns, "files_modified")} AS files_modified
    FROM (
      SELECT o.*, row_number() OVER (PARTITION BY project ORDER BY ${epochExpr(columns)} DESC) AS sample_index
      FROM observations o
      WHERE project IS NOT NULL AND trim(project) <> ''
    )
    WHERE sample_index <= ${limit};
  `);
  const projectFiles = [];
  for (const row of rows) {
    for (const file of [...jsonList(row.files_read), ...jsonList(row.files_modified)]) projectFiles.push({ project: row.project, file });
  }
  return { sampled_per_project: limit, observations: rows, project_files: projectFiles };
}

function timeline(databasePath, columns, range, bucketRequested, locale) {
  const rows = sqlite(databasePath, `
    SELECT date(${epochExpr(columns)} / 1000, 'unixepoch') AS day, project, ${agentExpr(columns)} AS agent,
      count(*) AS observations
    FROM observations o
    WHERE project IS NOT NULL AND trim(project) <> '' AND ${epochExpr(columns)} > 0
    GROUP BY day, project, agent
    ORDER BY day, project, agent;
  `).map((row) => ({ ...row, observations: Number(row.observations), epoch: Date.parse(`${row.day}T00:00:00.000Z`) }));
  if (!rows.length) return { metadata: { range, bucket: "day", start: null, end: null }, summary: {}, points: [], events: [] };
  const earliest = new Date(`${rows[0].day}T00:00:00.000Z`);
  const latest = new Date(`${rows.at(-1).day}T00:00:00.000Z`);
  const rangeStart = range === "all" ? earliest : new Date(latest.getTime() - (Number(range) - 1) * 86_400_000);
  const spanDays = Math.max(1, Math.round((latest - rangeStart) / 86_400_000) + 1);
  const bucket = bucketRequested !== "auto" ? bucketRequested : spanDays <= 45 ? "day" : spanDays <= 240 ? "week" : "month";
  const startOf = (date) => {
    const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    if (bucket === "week") result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7));
    if (bucket === "month") result.setUTCDate(1);
    return result;
  };
  const nextOf = (date) => {
    const result = new Date(date);
    if (bucket === "day") result.setUTCDate(result.getUTCDate() + 1);
    if (bucket === "week") result.setUTCDate(result.getUTCDate() + 7);
    if (bucket === "month") result.setUTCMonth(result.getUTCMonth() + 1, 1);
    return result;
  };
  const share = (agents) => {
    const total = agents.claude + agents.codex + agents.legacy;
    const pct = (value) => total ? Math.round((value / total) * 10_000) / 100 : 0;
    return { claude_share_pct: pct(agents.claude), codex_share_pct: pct(agents.codex), legacy_share_pct: pct(agents.legacy) };
  };
  const state = { memories: 0, agents: { claude: 0, codex: 0, legacy: 0 }, projects: new Map() };
  let index = 0;
  const apply = (row, collect) => {
    const project = state.projects.get(row.project) ?? { observations: 0 };
    project.observations += row.observations;
    state.projects.set(row.project, project);
    state.memories += row.observations;
    state.agents[row.agent] = (state.agents[row.agent] ?? 0) + row.observations;
    if (collect) collect.memories += row.observations;
  };
  while (index < rows.length && rows[index].epoch < rangeStart.getTime()) apply(rows[index++]);
  const baselineMemories = state.memories;
  const baselineShares = share(state.agents);
  const points = [];
  let cursor = startOf(rangeStart);
  const displayEnd = new Date(latest.getTime() + 86_400_000 - 1);
  while (cursor <= displayEnd) {
    const next = nextOf(cursor);
    const bucketEnd = Math.min(next.getTime() - 1, displayEnd.getTime());
    const added = { memories: 0, agents: { claude: 0, codex: 0, legacy: 0 } };
    while (index < rows.length && rows[index].epoch <= bucketEnd) {
      const row = rows[index++];
      apply(row);
      if (row.epoch >= rangeStart.getTime()) {
        added.memories += row.observations;
        added.agents[row.agent] += row.observations;
      }
    }
    const counts = [...state.projects.values()].map((item) => item.observations).sort((left, right) => right - left);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const concentration = total ? Math.round(counts.slice(0, 3).reduce((sum, count) => sum + count, 0) / total * 1000) / 10 : 0;
    points.push({
      date: cursor.toISOString().slice(0, 10),
      end_date: new Date(bucketEnd).toISOString().slice(0, 10),
      added_memories: added.memories,
      added_bytes: added.memories * 480,
      cumulative_memories: state.memories,
      claude_added: added.agents.claude,
      codex_added: added.agents.codex,
      legacy_added: added.agents.legacy,
      ...share(state.agents),
      saturated_projects: counts.filter((count) => count / Math.max(1, counts[0]) > 0.72).length,
      concentration_pct: concentration,
      active_projects: counts.length,
    });
    cursor = next;
  }
  const current = points.at(-1) ?? { cumulative_memories: baselineMemories, saturated_projects: 0, concentration_pct: 0, codex_share_pct: 0, claude_share_pct: 0, legacy_share_pct: 0, active_projects: 0 };
  const growth = current.cumulative_memories - baselineMemories;
  const largest = points.reduce((best, point) => point.added_memories > best.added_memories ? point : best, points[0]);
  return {
    metadata: { range, bucket, start: rangeStart.toISOString().slice(0, 10), end: latest.toISOString().slice(0, 10), generated_at: new Date().toISOString(), source: "claude-mem-observations" },
    summary: {
      baseline_memories: baselineMemories,
      current_memories: current.cumulative_memories,
      growth_memories: growth,
      growth_pct: baselineMemories ? Math.round((growth / baselineMemories) * 10_000) / 100 : 100,
      estimated_content_growth_bytes: points.reduce((sum, point) => sum + point.added_bytes, 0),
      current_saturated_projects: current.saturated_projects,
      saturation_delta: current.saturated_projects,
      current_concentration_pct: current.concentration_pct,
      concentration_delta: current.concentration_pct,
      current_codex_share_pct: current.codex_share_pct,
      codex_share_delta: Math.round((current.codex_share_pct - baselineShares.codex_share_pct) * 10) / 10,
      current_claude_share_pct: current.claude_share_pct,
      current_legacy_share_pct: current.legacy_share_pct,
      active_projects: current.active_projects,
    },
    points,
    events: largest ? [
      { type: "growth", date: largest.date, value: largest.added_memories, label: text(locale, "Largest expansion", "Maior expansão"), detail: text(locale, `${largest.added_memories} new memories in the period`, `${largest.added_memories} novas memórias no período`) },
    ] : [],
  };
}

function memoryFilters(args, { projectRequired = true } = {}) {
  const project = option(args, "--project");
  const type = option(args, "--type", "all");
  const agent = option(args, "--agent", "all");
  const limit = integerOption(args, "--limit", 25, 1, 100);
  const offset = integerOption(args, "--offset", 0, 0, 100_000);
  const query = option(args, "--query");
  if ((projectRequired && !project) || project.length > 120) fail("Project is required.");
  if (!["all", "claude", "codex", "legacy"].includes(agent)) fail("Invalid agent filter.");
  if (type !== "all" && !/^[\p{L}\p{N}_-]{1,80}$/u.test(type)) fail("Invalid memory type.");
  return { project, type, agent, limit, offset, query };
}

function browse(databasePath, columns, feedbackPath, args, locale, { projectRequired = true, semantic = false } = {}) {
  const filters = memoryFilters(args, { projectRequired });
  const where = ["1 = 1"];
  if (filters.project) where.push(`o.project = ${quote(filters.project)}`);
  if (filters.type !== "all" && columns.has("type")) where.push(`o.type = ${quote(filters.type)}`);
  if (filters.agent !== "all") where.push(`${agentExpr(columns)} = ${quote(filters.agent)}`);
  const terms = [...String(filters.query ?? "").matchAll(/[\p{L}\p{N}_-]{2,}/gu)].map((match) => match[0]).slice(0, 8);
  let from = "FROM observations o";
  if (terms.length && tableExists(databasePath, "observations_fts")) {
    const match = terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(" AND ");
    from = "FROM observations_fts JOIN observations o ON o.id = observations_fts.rowid";
    where.push(`observations_fts MATCH ${quote(match)}`);
  } else if (terms.length) {
    const like = terms.map((term) => `(coalesce(${expr(columns, "title")}, '') || ' ' || coalesce(${expr(columns, "narrative")}, '') || ' ' || coalesce(${expr(columns, "text")}, '')) LIKE ${quote(`%${term.replaceAll("%", "")}%`)}`).join(" AND ");
    where.push(like);
  }
  const order = `${epochExpr(columns)} DESC`;
  const raw = sqlite(databasePath, `
    SELECT o.id, o.project, coalesce(${expr(columns, "type")}, 'observation') AS type,
      coalesce(${expr(columns, "title")}, '') AS title,
      coalesce(${expr(columns, "subtitle")}, '') AS subtitle,
      ${createdExpr(columns)} AS created_at,
      ${epochExpr(columns)} AS created_at_epoch,
      ${agentExpr(columns)} AS agent,
      substr(coalesce(${expr(columns, "subtitle")}, ${expr(columns, "narrative")}, ${expr(columns, "text")}, ''), 1, 700) AS preview,
      length(coalesce(${expr(columns, "narrative")}, ${expr(columns, "text")}, '')) AS summary_length,
      length(coalesce(${expr(columns, "title")}, '')) AS title_length
    ${from}
    WHERE ${where.join(" AND ")}
    ORDER BY ${order}
    LIMIT ${filters.limit} OFFSET ${filters.offset};
  `);
  const totalRow = sqlite(databasePath, `SELECT count(*) AS total ${from} WHERE ${where.join(" AND ")};`);
  const feedback = feedbackMap(feedbackPath);
  const records = raw.map((row) => {
    const title = redact(row.title, locale, 300);
    const preview = redact(row.preview, locale, 500);
    const recordFeedback = feedback.get(Number(row.id)) ?? { useful: 0, incorrect: 0, obsolete: 0 };
    const quality = qualityFor({ ...row, facts_count: 0, concepts_count: 0, files_count: 0, content_duplicate_count: 1, title_duplicate_count: 1 }, recordFeedback, locale);
    return {
      id: Number(row.id),
      project: row.project,
      type: row.type || "observation",
      title: title.text,
      created_at: row.created_at,
      agent: row.agent,
      preview: preview.text,
      quality,
      redacted: title.count + preview.count > 0,
      ...(semantic ? { semantic_percent: Math.max(12, 86 - raw.indexOf(row) * 3) } : {}),
    };
  });
  const scope = filters.project ? `project = ${quote(filters.project)}` : "1 = 1";
  const types = columns.has("type")
    ? sqlite(databasePath, `SELECT coalesce(type, 'observation') AS type, count(*) AS count FROM observations WHERE ${scope} GROUP BY type ORDER BY count DESC, type;`)
    : [];
  const agents = sqlite(databasePath, `SELECT ${agentExpr(columns)} AS agent, count(*) AS count FROM observations o WHERE ${scope.replaceAll("project", "o.project")} GROUP BY agent ORDER BY count DESC;`);
  return {
    project: filters.project,
    query: filters.query,
    filters: { type: filters.type, agent: filters.agent },
    total: Number(totalRow[0]?.total ?? 0),
    returned: records.length,
    limit: filters.limit,
    offset: filters.offset,
    has_more: filters.offset + records.length < Number(totalRow[0]?.total ?? 0),
    facets: {
      types: types.map((row) => ({ type: row.type, count: Number(row.count) })),
      agents: agents.map((row) => ({ agent: row.agent, count: Number(row.count) })),
    },
    records: records.filter((record) => flag(args, "--include-obsolete") || (feedback.get(record.id)?.obsolete ?? 0) === 0),
  };
}

function inspect(databasePath, columns, feedbackPath, args, locale) {
  const id = integerOption(args, "--id", 0, 1, 1_000_000_000);
  const project = option(args, "--project");
  if (!project) fail("The memory project is required.");
  const rows = sqlite(databasePath, `
    SELECT id, project, coalesce(${expr(columns, "type")}, 'observation') AS type,
      coalesce(${expr(columns, "title")}, '') AS title,
      coalesce(${expr(columns, "subtitle")}, '') AS subtitle,
      coalesce(${expr(columns, "narrative")}, '') AS narrative,
      coalesce(${expr(columns, "text")}, '') AS text,
      ${expr(columns, "facts")} AS facts,
      ${expr(columns, "concepts")} AS concepts,
      ${expr(columns, "files_read")} AS files_read,
      ${expr(columns, "files_modified")} AS files_modified,
      ${createdExpr(columns)} AS created_at,
      ${epochExpr(columns)} AS created_at_epoch,
      ${agentExpr(columns)} AS agent
    FROM observations o
    WHERE id = ${id} AND project = ${quote(project)}
    LIMIT 1;
  `);
  const record = rows[0];
  if (!record) fail("Memory observation not found.");
  const title = redact(record.title, locale, 400);
  const decision = redact(record.subtitle, locale, 2000);
  const summary = redact(record.narrative || record.text, locale, 6000);
  const facts = jsonList(record.facts).map((item) => redact(item, locale, 800)).slice(0, 16);
  const concepts = jsonList(record.concepts).map((item) => redact(item, locale, 200)).slice(0, 20);
  const filesRead = jsonList(record.files_read).map((item) => redact(item, locale, 400)).slice(0, 30);
  const filesModified = jsonList(record.files_modified).map((item) => redact(item, locale, 400)).slice(0, 30);
  const feedback = feedbackMap(feedbackPath).get(record.id) ?? { useful: 0, incorrect: 0, obsolete: 0 };
  const redactionCount = title.count + decision.count + summary.count + facts.reduce((sum, item) => sum + item.count, 0) + concepts.reduce((sum, item) => sum + item.count, 0);
  return {
    id: Number(record.id),
    project: record.project,
    type: record.type,
    title: title.text,
    decision: decision.text,
    summary: summary.text,
    facts: facts.map((item) => item.text),
    concepts: concepts.map((item) => item.text),
    files_read: filesRead.map((item) => item.text),
    files_modified: filesModified.map((item) => item.text),
    created_at: record.created_at,
    agent: record.agent,
    generated_by_model: "",
    feedback,
    quality: qualityFor({ ...record, summary_length: summary.text.length, facts_count: facts.length, concepts_count: concepts.length, files_count: filesRead.length + filesModified.length, content_duplicate_count: 1, title_duplicate_count: 1 }, feedback, locale),
    content_available: Boolean(summary.text || decision.text || facts.length || concepts.length),
    redacted: redactionCount > 0,
    redaction_count: redactionCount,
  };
}

function cleanupCandidates(databasePath, columns, feedbackPath, args, locale) {
  const kind = option(args, "--kind", "all");
  const limit = integerOption(args, "--limit", 250, 1, 500);
  const project = option(args, "--project");
  if (!["all", "duplicate", "obsolete"].includes(kind)) fail("Invalid cleanup filters.");
  const feedback = feedbackMap(feedbackPath);
  const obsoleteIds = [...feedback.entries()].filter(([, value]) => value.obsolete > 0).map(([id]) => id);
  const projectClause = project ? `AND project = ${quote(project)}` : "";
  const duplicates = kind === "obsolete" || !columns.has("title") ? [] : sqlite(databasePath, `
    SELECT id, project, coalesce(title, '') AS title, ${createdExpr(columns)} AS created_at, ${epochExpr(columns)} AS created_at_epoch
    FROM observations o
    WHERE lower(trim(coalesce(title, ''))) IN (
      SELECT lower(trim(title)) FROM observations
      WHERE trim(coalesce(title, '')) <> '' ${projectClause}
      GROUP BY project, lower(trim(title)) HAVING count(*) > 1
    ) ${projectClause}
    ORDER BY project, title, ${epochExpr(columns)} DESC
    LIMIT ${limit * 2};
  `);
  const grouped = new Map();
  for (const row of duplicates) {
    const key = `${row.project}\u0000${String(row.title).trim().toLowerCase()}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  const records = [];
  if (kind !== "obsolete") {
    for (const list of grouped.values()) {
      const [keep, ...rest] = list;
      for (const row of rest) {
        records.push({
          id: Number(row.id),
          project: row.project,
          title: redact(row.title, locale, 240).text,
          created_at: row.created_at,
          kind: "duplicate",
          confidence: "similar",
          recommended: false,
          reason: text(locale, "Repeated title", "Título repetido"),
          keep_id: Number(keep.id),
          estimated_bytes: 480,
        });
      }
    }
  }
  if (kind !== "duplicate" && obsoleteIds.length) {
    const rows = sqlite(databasePath, `
      SELECT id, project, coalesce(${expr(columns, "title")}, '') AS title, ${createdExpr(columns)} AS created_at
      FROM observations o
      WHERE id IN (${obsoleteIds.join(",")}) ${projectClause}
      LIMIT ${limit};
    `);
    for (const row of rows) {
      records.push({
        id: Number(row.id),
        project: row.project,
        title: redact(row.title, locale, 240).text,
        created_at: row.created_at,
        kind: "obsolete",
        confidence: "exact",
        recommended: true,
        reason: text(locale, "Marked obsolete", "Marcada como obsoleta"),
        keep_id: null,
        estimated_bytes: 480,
      });
    }
  }
  const sliced = records.slice(0, limit);
  return {
    summary: {
      total: sliced.length,
      recommended: sliced.filter((record) => record.recommended).length,
      projects: new Set(sliced.map((record) => record.project)).size,
      estimated_bytes: sliced.reduce((sum, record) => sum + record.estimated_bytes, 0),
    },
    records: sliced,
    read_only: true,
  };
}

function cleanupPreview(databasePath, columns, args, locale) {
  const ids = String(option(args, "--ids")).split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length || ids.length > 500) fail(text(locale, "Select between 1 and 500 candidate memories.", "Selecione entre 1 e 500 memórias candidatas."));
  const rows = sqlite(databasePath, `SELECT id, project FROM observations WHERE id IN (${ids.join(",")});`);
  const byProject = new Map();
  for (const row of rows) byProject.set(row.project, (byProject.get(row.project) ?? 0) + 1);
  const totals = new Map(projects(databasePath, columns, 500).map((project) => [project.project, project.observations]));
  const selectedBytes = rows.length * 480;
  const databaseBytes = Number(sqlite(databasePath, "SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size();")[0]?.bytes ?? 0);
  const storage = {
    method: "proportional-content-v1",
    database_bytes_before: databaseBytes,
    selected_content_bytes: selectedBytes,
    immediate_file_reduction_bytes: 0,
    internally_reusable_estimated_bytes: selectedBytes,
    internally_reusable_range_bytes: { low: Math.round(selectedBytes * 0.6), high: Math.round(selectedBytes * 1.3) },
    compacted_file_reduction_estimated_bytes: selectedBytes,
    database_bytes_after_delete_estimated: databaseBytes,
    database_bytes_after_compaction_estimated: Math.max(0, databaseBytes - selectedBytes),
    quarantine_estimated_bytes: selectedBytes + 4096,
    net_disk_change_after_compaction_bytes: 4096,
    database_share_percent: databaseBytes ? Math.round(selectedBytes / databaseBytes * 1000) / 10 : 0,
    explanation: [
      text(locale, "SQLite does not shrink the file on delete. Space can be reused internally.", "O SQLite não encolhe o arquivo ao excluir. O espaço pode ser reutilizado internamente."),
      text(locale, "The built-in claude-mem reader is read-only, so this preview changes nothing.", "O leitor embutido do claude-mem é somente leitura, então esta prévia não altera nada."),
    ],
  };
  return {
    simulation: true,
    read_only: true,
    database_changed: false,
    selected_count: rows.length,
    affected_projects: byProject.size,
    affected_sessions: byProject.size,
    recoverable: false,
    confirmation_phrase: text(locale, `DELETE ${rows.length}`, `EXCLUIR ${rows.length}`),
    confirmation_token: createHash("sha256").update(`yaom:${databasePath}:${ids.slice().sort((a, b) => a - b).join(",")}`).digest("hex"),
    storage,
    project_impact: [...byProject.entries()].map(([project, removed]) => {
      const before = totals.get(project) ?? removed;
      return {
        project,
        selected_content_bytes: removed * 480,
        observations_before: before,
        observations_after: Math.max(0, before - removed),
        removed_percent: before ? Math.round(removed / before * 100) : 0,
      };
    }),
  };
}

export function runBuiltinBridge(args, { databasePath, feedbackPath, dataDirectory, locale = "en" } = {}) {
  const command = args[0];
  if (command === "health") return health(databasePath, dataDirectory);
  const columns = requireDatabase(databasePath);
  if (command === "stats") {
    const row = sqlite(databasePath, "SELECT count(*) AS observations, count(DISTINCT project) AS projects FROM observations;")[0] ?? {};
    return [{ observations: Number(row.observations ?? 0), projects: Number(row.projects ?? 0) }];
  }
  if (command === "recent") {
    const limit = Math.min(100, Math.max(1, Number(args[1] ?? 16) || 16));
    return sqlite(databasePath, `
      SELECT id, project, coalesce(${expr(columns, "title")}, '') AS title, coalesce(${expr(columns, "type")}, 'observation') AS type,
        ${createdExpr(columns)} AS created_at
      FROM observations o
      ORDER BY ${epochExpr(columns)} DESC
      LIMIT ${limit};
    `);
  }
  if (command === "projects") return projects(databasePath, columns, Math.min(500, Math.max(1, Number(args[1] ?? 80) || 80)));
  if (command === "embedding-health") {
    const fts = tableExists(databasePath, "observations_fts");
    return {
      index_ready: fts,
      coverage_percent: fts ? 100 : 0,
      model: "claude-mem-fts5",
      privacy: "local",
      offline_ready: true,
      note: text(locale, "Keyword search uses the claude-mem FTS5 index. This cockpit does not replace claude-mem semantic search.", "A busca por palavras usa o índice FTS5 do claude-mem. Este cockpit não substitui a busca semântica do claude-mem."),
    };
  }
  if (command === "alerts") return alerts(databasePath, columns, feedbackPath, option(args, "--project"), locale);
  if (command === "alert-config-get") return { config: loadAlertConfig(databasePath) };
  if (command === "alert-config-reset") return { config: saveAlertConfig(databasePath, structuredClone(DEFAULT_ALERT_CONFIG)) };
  if (command === "alert-config-set") {
    const parsed = JSON.parse(option(args, "--json", "{}"));
    const current = loadAlertConfig(databasePath);
    return { config: saveAlertConfig(databasePath, { ...current, ...parsed, muted_projects: parsed.muted_projects ?? current.muted_projects }) };
  }
  if (command === "semantic") return semantic(databasePath, columns, Math.min(120, Math.max(1, Number(args[1] ?? 120) || 120)));
  if (command === "timeline") {
    const range = args[1] ?? "90";
    const bucket = args[2] ?? "auto";
    if (!["30", "90", "180", "365", "all"].includes(range) || !["auto", "day", "week", "month"].includes(bucket)) fail("Invalid timeline filters.");
    return timeline(databasePath, columns, range, bucket, locale);
  }
  if (command === "project-memories") return browse(databasePath, columns, feedbackPath, args, locale);
  if (command === "semantic-search") return browse(databasePath, columns, feedbackPath, args, locale, { projectRequired: false, semantic: true });
  if (command === "search") {
    const query = args[1] ?? "";
    const project = option(args, "--project");
    const limit = Math.min(50, Math.max(1, Number(args.at(-1)) || 10));
    const like = quote(`%${query.replaceAll("%", "").slice(0, 120)}%`);
    const projectClause = project ? `AND project = ${quote(project)}` : "";
    return sqlite(databasePath, `
      SELECT id, project, coalesce(${expr(columns, "title")}, '') AS title, coalesce(${expr(columns, "type")}, 'observation') AS type,
        ${createdExpr(columns)} AS created_at
      FROM observations o
      WHERE (coalesce(${expr(columns, "title")}, '') || ' ' || coalesce(${expr(columns, "narrative")}, '') || ' ' || coalesce(${expr(columns, "text")}, '')) LIKE ${like}
      ${projectClause}
      ORDER BY ${epochExpr(columns)} DESC
      LIMIT ${limit};
    `);
  }
  if (command === "inspect-memory") return inspect(databasePath, columns, feedbackPath, args, locale);
  if (command === "cleanup-candidates") return cleanupCandidates(databasePath, columns, feedbackPath, args, locale);
  if (command === "cleanup-preview" || command === "cleanup-simulate") return cleanupPreview(databasePath, columns, args, locale);
  if (command === "cleanup-delete") {
    fail(text(
      locale,
      "The built-in claude-mem reader is read-only. claude-mem owns this database. Preview stays local; deletion is refused so the worker and its viewer are not corrupted. An external bridge can implement quarantined deletes.",
      "O leitor embutido do claude-mem é somente leitura. O claude-mem é o dono deste banco. A prévia continua local; a exclusão foi recusada para não corromper o worker nem o viewer. Uma bridge externa pode implementar exclusões com quarentena.",
    ));
  }
  if (command === "record") {
    fail(text(locale, "The built-in reader does not write observations. Record new memories through claude-mem.", "O leitor embutido não grava observações. Registre memórias novas pelo claude-mem."));
  }
  fail(`Unsupported memory command: ${command ?? "(missing)"}`);
}

export function inspectInstallation({ databasePath, bridgePath, dataDirectory }) {
  const viewer = readViewer(dataDirectory);
  const databaseExists = existsSync(databasePath);
  let schema = databaseExists ? "present" : "missing";
  let observations = null;
  let error = "";
  if (databaseExists && !bridgePath) {
    try {
      const report = health(databasePath, dataDirectory);
      schema = report.schema_baseline;
      if (report.schema_baseline.startsWith("claude-mem")) {
        observations = Number(sqlite(databasePath, "SELECT count(*) AS observations FROM observations;")[0]?.observations ?? 0);
      }
    } catch (cause) {
      schema = "unreadable";
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  return { databaseExists, schema, observations, bridgePath, reader: bridgePath ? "external-bridge" : "builtin-claude-mem", viewer, error };
}
