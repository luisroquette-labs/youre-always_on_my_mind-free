import { createHash } from "node:crypto";

const DEMO_NOTE = "Fictional sample. Not a real project, person, or database.";

const SPECS = [
  { project: "Northwind Atlas", claude: 128, codex: 46, last: "2026-11-18", type: "decision", concepts: ["tile cache", "map manifest"], files: ["src/atlas/tiles.ts", "src/atlas/manifest.ts"], titles: ["Cache tile manifests for 24 hours", "Redraw only the dirty coast tiles", "Keep the atlas manifest on this machine"] },
  { project: "Lumen Ledger", claude: 74, codex: 68, last: "2026-11-17", type: "decision", concepts: ["tile cache", "ledger close"], files: ["src/atlas/tiles.ts", "src/ledger/close.ts"], titles: ["Close the ledger without posting twice", "Share the tile cache with the atlas", "Reconcile fictional balances nightly"] },
  { project: "Harborline API", claude: 22, codex: 84, last: "2026-11-16", type: "bugfix", concepts: ["idempotent webhook", "retry budget"], files: ["src/webhooks/idempotency.ts", "src/webhooks/retry.ts"], titles: ["Sign webhook retries before replay", "Cap the retry budget at three attempts", "Store idempotency keys beside the route"] },
  { project: "Nimbus Checkout", claude: 9, codex: 14, last: "2026-08-02", type: "bugfix", concepts: ["idempotent webhook", "checkout hold"], files: ["src/webhooks/idempotency.ts"], titles: ["Hold checkout until the webhook ack", "Reuse the Harborline idempotency key"] },
  { project: "Paperkite Docs", claude: 61, codex: 13, last: "2026-11-12", type: "discovery", concepts: ["on-call runbook", "release note"], files: ["docs/runbook.md", "docs/release-notes.md"], titles: ["Write the on-call runbook in the repo", "Keep release notes next to the runbook"] },
  { project: "Cobalt Scheduler", claude: 31, codex: 27, last: "2026-11-09", type: "feature", concepts: ["on-call runbook", "quiet hours"], files: ["docs/runbook.md", "src/scheduler/windows.ts"], titles: ["Quiet the scheduler outside staffed hours", "Point quiet hours at the on-call runbook"] },
  { project: "Finch Forms", claude: 36, codex: 5, last: "2026-11-04", type: "refactor", concepts: ["form schema", "draft restore"], files: ["src/forms/schema.ts"], titles: ["Restore form drafts after refresh", "Version the fictional form schema"] },
  { project: "Quartz Relay", claude: 15, codex: 4, last: "2026-10-28", type: "refactor", concepts: ["form schema", "relay cursor"], files: ["src/forms/schema.ts", "src/relay/cursor.ts"], titles: ["Advance the relay cursor only after commit", "Reuse the Finch form schema"] },
  { project: "Orchard Notes", claude: 4, codex: 24, last: "2026-03-18", type: "change", concepts: ["notebook export"], files: ["src/notes/export.ts"], titles: ["Export notebooks without private paths", "Skip archived notebooks during export"] },
  { project: "Kepler Sandbox", claude: 3, codex: 0, last: "2026-11-19", type: "discovery", concepts: ["sandbox fixture"], files: ["src/sandbox/fixture.ts"], titles: ["Pin sandbox fixtures to fictional data", "Reset the sandbox between demo runs"] },
];

let deletedIds = new Set();
let alertConfig = defaultAlertConfig();

function defaultAlertConfig() {
  return {
    version: 1,
    enabled: true,
    saturation: { enabled: true, threshold: 78, minimum_observations: 5 },
    stale: { enabled: true, days: 90, minimum_observations: 2 },
    inconsistent: { enabled: true, duplicate_threshold: 3, incorrect_feedback_threshold: 1, missing_title_threshold: 8 },
    muted_projects: [],
  };
}

export function resetDemoState() {
  deletedIds = new Set();
  alertConfig = defaultAlertConfig();
}

function text(locale, en, pt) {
  return locale === "pt" ? pt : en;
}

function option(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
}

function specMemories(spec, specIndex = SPECS.indexOf(spec)) {
  const total = spec.claude + spec.codex;
  const records = [];
  for (let index = 0; index < total; index += 1) {
    const id = 1000 + specIndex * 1000 + index;
    if (deletedIds.has(id)) continue;
    const when = new Date(Date.parse(`${spec.last}T15:00:00Z`) - index * 86_400_000 * (index % 4 === 0 ? 2 : 1));
    const agent = index < spec.codex ? "codex" : "claude";
    const title = spec.project === "Northwind Atlas" && (index === 0 || index === 5)
      ? "Cache tile manifests for 24 hours"
      : `${spec.titles[index % spec.titles.length]} #${index + 1}`;
    const summary = `${DEMO_NOTE} ${spec.project}: ${title}. This ${spec.type} belongs to the fictional ${spec.concepts[0]} work.`;
    records.push({
      id,
      project: spec.project,
      type: spec.type,
      title,
      decision: index % 3 === 0 ? `Decide locally: ${title}.` : "",
      summary,
      concepts: spec.concepts,
      files: spec.files,
      created_at: when.toISOString(),
      created_at_epoch: when.getTime(),
      agent,
      preview: summary.slice(0, 220),
      obsolete: spec.project === "Orchard Notes" && index === 0,
      incorrect: spec.project === "Nimbus Checkout" && index === 1,
      useful: index % 5 === 0,
    });
  }
  return records;
}

function allMemories() {
  return SPECS.flatMap(specMemories).sort((left, right) => right.created_at_epoch - left.created_at_epoch);
}

function projectRows() {
  return SPECS.map((spec) => {
    const records = specMemories(spec);
    const last = records.reduce((latest, record) => record.created_at > latest ? record.created_at : latest, spec.last);
    return {
      project: spec.project,
      observations: records.length,
      last_activity: last,
      claude_observations: records.filter((record) => record.agent === "claude").length,
      codex_observations: records.filter((record) => record.agent === "codex").length,
      other_observations: 0,
    };
  }).filter((project) => project.observations > 0).sort((left, right) => right.observations - left.observations);
}

function quality(record) {
  const relevance = record.useful ? 84 : 68;
  const redundancy = record.title === "Cache tile manifests for 24 hours" && record.project === "Northwind Atlas" ? 78 : 12;
  const ageDays = Math.max(0, Math.floor((Date.parse("2026-11-21T00:00:00Z") - record.created_at_epoch) / 86_400_000));
  const age = Math.min(100, Math.round(ageDays / 3));
  const utility = record.obsolete ? 18 : record.decision ? 76 : 58;
  const exclusionRisk = record.obsolete ? 22 : redundancy > 70 ? 35 : 71;
  const overall = Math.round(relevance * 0.34 + (100 - redundancy) * 0.2 + (100 - age) * 0.16 + utility * 0.3);
  return {
    overall: Math.max(0, Math.min(100, overall)),
    label: overall >= 75 ? "strong" : overall >= 55 ? "solid" : overall >= 35 ? "review" : "weak",
    confidence: 80,
    version: "fictional-demo-v1",
    relevance,
    redundancy,
    age,
    age_days: ageDays,
    utility,
    exclusion_risk: exclusionRisk,
    evidence: [DEMO_NOTE, redundancy > 50 ? "Repeated fictional title." : "Distinct fictional note."],
  };
}

function feedback(record) {
  return { useful: record.useful ? 1 : 0, incorrect: record.incorrect ? 1 : 0, obsolete: record.obsolete ? 1 : 0 };
}

function alerts(locale, projectFilter = "") {
  const settings = alertConfig;
  const rows = projectRows();
  const maximum = Math.max(1, ...rows.map((row) => row.observations));
  const muted = new Set(settings.muted_projects);
  const records = [];
  for (const row of rows) {
    if (projectFilter && row.project !== projectFilter) continue;
    if (!settings.enabled || muted.has(row.project)) continue;
    const days = Math.max(0, Math.floor((Date.parse("2026-11-21T00:00:00Z") - new Date(row.last_activity).getTime()) / 86_400_000));
    const saturationScore = Math.round(Math.min(100, (Math.log1p(row.observations) / Math.log1p(maximum)) * 88 + Math.min(days / 365, 1) * 12));
    const repeated = row.project === "Northwind Atlas" ? 4 : 0;
    if (settings.saturation.enabled && row.observations >= settings.saturation.minimum_observations && saturationScore >= settings.saturation.threshold) {
      records.push({
        id: `saturation:${row.project}`, kind: "saturation", severity: saturationScore >= 90 ? "critical" : "warning", project: row.project,
        title: text(locale, "Saturated memory", "Memória saturada"),
        message: text(locale, `${row.observations} fictional memories at ${saturationScore}% pressure.`, `${row.observations} memórias fictícias e pressão de ${saturationScore}%.`),
        value: saturationScore, threshold: settings.saturation.threshold, evidence: { observations: row.observations, age_days: days },
      });
    }
    if (settings.stale.enabled && row.observations >= settings.stale.minimum_observations && days >= settings.stale.days) {
      records.push({
        id: `stale:${row.project}`, kind: "stale", severity: days > 180 ? "critical" : "warning", project: row.project,
        title: text(locale, "Stale memory", "Memória desatualizada"),
        message: text(locale, `No fictional activity for ${days} days.`, `Sem atividade fictícia há ${days} dias.`),
        value: days, threshold: settings.stale.days, evidence: { observations: row.observations, age_days: days },
      });
    }
    if (settings.inconsistent.enabled && (repeated >= settings.inconsistent.duplicate_threshold || row.project === "Nimbus Checkout")) {
      records.push({
        id: `inconsistent:${row.project}`, kind: "inconsistent", severity: repeated ? "warning" : "critical", project: row.project,
        title: text(locale, "Inconsistent memory", "Memória inconsistente"),
        message: repeated
          ? text(locale, `${repeated} repeated fictional titles.`, `${repeated} títulos fictícios repetidos.`)
          : text(locale, "1 incorrect fictional feedback mark.", "1 feedback fictício incorreto."),
        value: repeated || 1, threshold: 1, evidence: { repeated_title_excess: repeated },
      });
    }
  }
  const order = { critical: 0, warning: 1 };
  records.sort((left, right) => order[left.severity] - order[right.severity] || right.value - left.value);
  const byKind = { saturation: 0, stale: 0, inconsistent: 0 };
  for (const alert of records) byKind[alert.kind] += 1;
  return {
    enabled: settings.enabled,
    summary: {
      total: records.length,
      critical: records.filter((alert) => alert.severity === "critical").length,
      warning: records.filter((alert) => alert.severity === "warning").length,
      by_kind: byKind,
      evaluated_projects: rows.length,
      muted_projects: settings.muted_projects.length,
    },
    alerts: records,
    config: settings,
    metadata: { version: "alerts-demo-v1", generated_at: "2026-11-21T00:00:00.000Z", local_only: true, fictional: true },
  };
}

function semantic(limit) {
  const observations = [];
  const projectFiles = [];
  for (const spec of SPECS) {
    for (const record of specMemories(spec).slice(0, limit)) {
      observations.push({
        project: record.project,
        title: record.title,
        subtitle: record.decision,
        narrative: record.summary,
        text: record.summary,
        type: record.type,
        concepts: JSON.stringify(record.concepts),
        files_read: JSON.stringify(record.files),
        files_modified: JSON.stringify(record.files.slice(0, 1)),
      });
      for (const file of record.files) projectFiles.push({ project: record.project, file });
    }
  }
  return { sampled_per_project: limit, observations, project_files: projectFiles };
}

function timeline(range, bucketRequested, locale) {
  const rows = allMemories();
  const latest = new Date(`${rows[0]?.created_at.slice(0, 10) ?? "2026-11-18"}T00:00:00Z`);
  const earliest = new Date(`${rows.at(-1)?.created_at.slice(0, 10) ?? "2026-03-18"}T00:00:00Z`);
  const rangeStart = range === "all" ? earliest : new Date(latest.getTime() - (Number(range) - 1) * 86_400_000);
  const spanDays = Math.max(1, Math.round((latest - Math.max(earliest, rangeStart)) / 86_400_000) + 1);
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
  const points = [];
  let cursor = startOf(rangeStart < earliest ? earliest : rangeStart);
  let cumulative = rows.filter((record) => record.created_at_epoch < rangeStart.getTime()).length;
  const agents = { claude: 0, codex: 0, legacy: 0 };
  for (const record of rows) {
    if (record.created_at_epoch < rangeStart.getTime()) agents[record.agent] += 1;
  }
  while (cursor <= latest) {
    const next = nextOf(cursor);
    const added = rows.filter((record) => record.created_at_epoch >= Math.max(cursor.getTime(), rangeStart.getTime()) && record.created_at_epoch < next.getTime());
    cumulative += added.length;
    for (const record of added) agents[record.agent] += 1;
    const totalAgents = agents.claude + agents.codex + agents.legacy || 1;
    points.push({
      date: cursor.toISOString().slice(0, 10),
      end_date: new Date(next.getTime() - 1).toISOString().slice(0, 10),
      added_memories: added.length,
      added_bytes: added.length * 640,
      cumulative_memories: cumulative,
      claude_added: added.filter((record) => record.agent === "claude").length,
      codex_added: added.filter((record) => record.agent === "codex").length,
      legacy_added: 0,
      claude_share_pct: Math.round(agents.claude / totalAgents * 1000) / 10,
      codex_share_pct: Math.round(agents.codex / totalAgents * 1000) / 10,
      legacy_share_pct: 0,
      saturated_projects: projectRows().filter((project) => project.observations > 80).length,
      concentration_pct: 46.2,
      active_projects: projectRows().length,
    });
    cursor = next;
    if (points.length > 400) break;
  }
  const current = points.at(-1);
  const first = points[0] ?? current;
  const growth = current ? current.cumulative_memories - (first.cumulative_memories - first.added_memories) : 0;
  const largest = points.reduce((best, point) => point.added_memories > (best?.added_memories ?? -1) ? point : best, null);
  return {
    metadata: { range, bucket, start: rangeStart.toISOString().slice(0, 10), end: latest.toISOString().slice(0, 10), generated_at: "2026-11-21T00:00:00.000Z", source: "fictional-demo", fictional: true },
    summary: {
      baseline_memories: Math.max(0, (current?.cumulative_memories ?? 0) - growth),
      current_memories: current?.cumulative_memories ?? 0,
      growth_memories: growth,
      growth_pct: 18.4,
      estimated_content_growth_bytes: points.reduce((sum, point) => sum + point.added_bytes, 0),
      current_saturated_projects: current?.saturated_projects ?? 0,
      saturation_delta: 1,
      current_concentration_pct: 46.2,
      concentration_delta: 2.4,
      current_codex_share_pct: current?.codex_share_pct ?? 0,
      codex_share_delta: 3.1,
      current_claude_share_pct: current?.claude_share_pct ?? 0,
      current_legacy_share_pct: 0,
      active_projects: projectRows().length,
    },
    points,
    events: largest ? [
      { type: "growth", date: largest.date, value: largest.added_memories, label: text(locale, "Largest expansion", "Maior expansão"), detail: text(locale, `${largest.added_memories} new fictional memories`, `${largest.added_memories} novas memórias fictícias`) },
      { type: "saturation", date: "2026-11-18", value: 2, label: text(locale, "Saturation peak", "Pico de saturação"), detail: text(locale, "Northwind Atlas and Lumen Ledger carry the fictional load.", "Northwind Atlas e Lumen Ledger concentram a carga fictícia.") },
    ] : [],
  };
}

function card(record, semanticPercent) {
  return {
    id: record.id,
    project: record.project,
    type: record.type,
    title: record.title,
    created_at: record.created_at,
    agent: record.agent,
    preview: record.preview,
    quality: quality(record),
    redacted: false,
    ...(semanticPercent === undefined ? {} : { semantic_percent: semanticPercent }),
  };
}

function browse(args, locale, semanticSearch = false) {
  const project = option(args, "--project");
  const type = option(args, "--type", "all");
  const agent = option(args, "--agent", "all");
  const limit = Math.min(100, Math.max(1, Number(option(args, "--limit", "25")) || 25));
  const offset = Math.max(0, Number(option(args, "--offset", "0")) || 0);
  const query = option(args, "--query").toLowerCase();
  let records = allMemories().filter((record) => !record.obsolete || args.includes("--include-obsolete"));
  if (project) records = records.filter((record) => record.project === project);
  if (type !== "all") records = records.filter((record) => record.type === type);
  if (agent !== "all") records = records.filter((record) => record.agent === agent);
  if (query) records = records.filter((record) => `${record.title} ${record.summary} ${record.concepts.join(" ")} ${record.files.join(" ")}`.toLowerCase().includes(query));
  const page = records.slice(offset, offset + limit);
  const projectRecords = allMemories().filter((record) => !project || record.project === project);
  const types = [...projectRecords.reduce((map, record) => map.set(record.type, (map.get(record.type) ?? 0) + 1), new Map())].map(([memoryType, count]) => ({ type: memoryType, count }));
  const agents = [...projectRecords.reduce((map, record) => map.set(record.agent, (map.get(record.agent) ?? 0) + 1), new Map())].map(([memoryAgent, count]) => ({ agent: memoryAgent, count }));
  return {
    project,
    query,
    filters: { type, agent },
    total: records.length,
    returned: page.length,
    limit,
    offset,
    has_more: offset + page.length < records.length,
    facets: { types, agents },
    fictional: true,
    records: page.map((record, index) => card(record, semanticSearch ? Math.max(18, 91 - index * 4) : undefined)),
  };
}

function cleanupRecords(locale) {
  const records = [];
  const northwind = specMemories(SPECS[0]).filter((record) => record.title === "Cache tile manifests for 24 hours");
  if (northwind.length > 1) {
    const [keep, ...rest] = northwind;
    for (const record of rest) {
      records.push({
        id: record.id, project: record.project, title: record.title, created_at: record.created_at, kind: "duplicate",
        confidence: "similar", recommended: false, reason: text(locale, "Repeated title", "Título repetido"), keep_id: keep.id, estimated_bytes: 1280,
      });
    }
  }
  for (const record of allMemories().filter((item) => item.obsolete)) {
    records.push({
      id: record.id, project: record.project, title: record.title, created_at: record.created_at, kind: "obsolete",
      confidence: "exact", recommended: true, reason: text(locale, "Marked obsolete", "Marcada como obsoleta"), keep_id: null, estimated_bytes: 960,
    });
  }
  return records;
}

function cleanupPreview(ids, locale) {
  const records = allMemories().filter((record) => ids.includes(record.id));
  const byProject = new Map();
  for (const record of records) byProject.set(record.project, (byProject.get(record.project) ?? 0) + 1);
  const selectedBytes = records.length * 1100;
  const before = 18_743_296;
  const storage = {
    method: "fictional-demo-v1",
    database_bytes_before: before,
    selected_content_bytes: selectedBytes,
    immediate_file_reduction_bytes: 0,
    internally_reusable_estimated_bytes: selectedBytes,
    internally_reusable_range_bytes: { low: 700, high: 1800 },
    compacted_file_reduction_estimated_bytes: selectedBytes,
    database_bytes_after_delete_estimated: before,
    database_bytes_after_compaction_estimated: before - selectedBytes,
    quarantine_estimated_bytes: selectedBytes + 2048,
    net_disk_change_after_compaction_bytes: 2048 - selectedBytes,
    database_share_percent: 0.4,
    explanation: [text(locale, "Demo only. No database file is created or changed.", "Somente demonstração. Nenhum arquivo de banco é criado ou alterado."), DEMO_NOTE],
  };
  const totals = new Map(projectRows().map((project) => [project.project, project.observations]));
  return {
    simulation: true,
    read_only: true,
    database_changed: false,
    fictional: true,
    selected_count: records.length,
    affected_projects: byProject.size,
    affected_sessions: byProject.size,
    recoverable: true,
    confirmation_phrase: text(locale, `DELETE ${records.length}`, `EXCLUIR ${records.length}`),
    confirmation_token: createHash("sha256").update(`demo:${ids.slice().sort((a, b) => a - b).join(",")}`).digest("hex"),
    storage,
    project_impact: [...byProject.entries()].map(([project, removed]) => ({
      project,
      selected_content_bytes: removed * 1100,
      observations_before: totals.get(project) ?? removed,
      observations_after: Math.max(0, (totals.get(project) ?? removed) - removed),
      removed_percent: totals.get(project) ? Math.round(removed / totals.get(project) * 100) : 0,
    })),
  };
}

function idsFrom(args) {
  return String(option(args, "--ids")).split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

export function demoDispatch(args, locale = "en") {
  const command = args[0];
  if (command === "health") {
    return {
      ok: true, integrity: "ok", schema_baseline: "fictional-demo", fts_ready: true, reader: "fictional-demo", read_only: true, demo: true,
      viewer: { product: "claude-mem", affiliated: false, complementary: true, url: null, note: "Demo mode does not read a claude-mem database or its viewer." },
    };
  }
  if (command === "stats") {
    const rows = projectRows();
    return [{ observations: rows.reduce((sum, row) => sum + row.observations, 0), projects: rows.length }];
  }
  if (command === "recent") return allMemories().slice(0, Math.min(100, Number(args[1] ?? 16) || 16)).map((record) => ({ id: record.id, project: record.project, title: record.title, type: record.type, created_at: record.created_at }));
  if (command === "projects") return projectRows().slice(0, Math.min(500, Number(args[1] ?? 80) || 80));
  if (command === "embedding-health") return { index_ready: true, coverage_percent: 92, model: "fictional-local-demo", privacy: "local", offline_ready: true, fictional: true };
  if (command === "alerts") return alerts(locale, option(args, "--project"));
  if (command === "alert-config-get") return { config: alertConfig };
  if (command === "alert-config-reset") {
    alertConfig = defaultAlertConfig();
    return { config: alertConfig };
  }
  if (command === "alert-config-set") {
    const parsed = JSON.parse(option(args, "--json", "{}"));
    alertConfig = { ...alertConfig, ...parsed, saturation: { ...alertConfig.saturation, ...(parsed.saturation ?? {}) }, stale: { ...alertConfig.stale, ...(parsed.stale ?? {}) }, inconsistent: { ...alertConfig.inconsistent, ...(parsed.inconsistent ?? {}) }, muted_projects: parsed.muted_projects ?? alertConfig.muted_projects };
    return { config: alertConfig };
  }
  if (command === "semantic") return semantic(Math.min(120, Number(args[1] ?? 40) || 40));
  if (command === "timeline") return timeline(args[1] ?? "90", args[2] ?? "auto", locale);
  if (command === "project-memories") return browse(args, locale);
  if (command === "semantic-search") return browse(args, locale, true);
  if (command === "inspect-memory") {
    const id = Number(option(args, "--id"));
    const record = allMemories().find((item) => item.id === id && item.project === option(args, "--project"));
    if (!record) {
      const error = new Error(text(locale, "Memory observation not found.", "Observação de memória não encontrada."));
      error.stderr = error.message;
      throw error;
    }
    return {
      id: record.id, project: record.project, type: record.type, title: record.title, decision: record.decision, summary: record.summary,
      facts: [DEMO_NOTE, `Fictional concept: ${record.concepts[0]}.`], concepts: record.concepts, files_read: record.files, files_modified: record.files.slice(0, 1),
      created_at: record.created_at, agent: record.agent, generated_by_model: "fictional-demo", feedback: feedback(record), quality: quality(record),
      content_available: true, redacted: false, redaction_count: 0, fictional: true,
    };
  }
  if (command === "cleanup-candidates") {
    const kind = option(args, "--kind", "all");
    const project = option(args, "--project");
    let records = cleanupRecords(locale);
    if (kind !== "all") records = records.filter((record) => record.kind === kind || (kind === "duplicate" && record.kind === "duplicate"));
    if (project) records = records.filter((record) => record.project === project);
    return {
      summary: { total: records.length, recommended: records.filter((record) => record.recommended).length, projects: new Set(records.map((record) => record.project)).size, estimated_bytes: records.reduce((sum, record) => sum + record.estimated_bytes, 0) },
      records, read_only: true, fictional: true,
    };
  }
  if (command === "cleanup-preview" || command === "cleanup-simulate") return cleanupPreview(idsFrom(args), locale);
  if (command === "cleanup-delete") {
    const ids = idsFrom(args);
    const preview = cleanupPreview(ids, locale);
    const phrase = option(args, "--phrase");
    const token = option(args, "--confirm-token");
    if (phrase !== preview.confirmation_phrase || token !== preview.confirmation_token) {
      const error = new Error(text(locale, "Invalid delete confirmation.", "Confirmação de exclusão inválida."));
      error.stderr = error.message;
      throw error;
    }
    for (const id of ids) deletedIds.add(id);
    return { deleted: ids.length, recoverable: true, fictional: true, estimated_bytes: preview.storage.selected_content_bytes, backup_path: text(locale, "(demo) no file written", "(demo) nenhum arquivo gravado"), audit_path: text(locale, "(demo) no audit file written", "(demo) nenhuma auditoria gravada") };
  }
  const error = new Error(`Unsupported demo command: ${command ?? "(missing)"}`);
  error.stderr = error.message;
  throw error;
}
