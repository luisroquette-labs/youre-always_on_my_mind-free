import * as THREE from "three";
import { OrbitControls } from "/vendor/OrbitControls.js";
import { clusterLayoutCandidate, resolvePersistentLayout } from "/assets/persistent-layout.js";
import { t, formatNumber, formatDate, formatShortDate, localeTag, applyDocument, rememberLocale, locale } from "/assets/i18n.js";

const demoMode = new URLSearchParams(location.search).get("demo") === "1" || window.__YAOM_DEMO__ === true;

function apiUrl(path) {
  const url = new URL(path, location.origin);
  if (demoMode) url.searchParams.set("demo", "1");
  url.searchParams.set("lang", locale === "pt" ? "pt" : "en");
  return `${url.pathname}${url.search}`;
}

const MODES = {
  volume: { label: () => t("By volume"), description: () => t("Largest projects appear first.") },
  activity: { label: () => t("By activity"), description: () => t("Recent projects stand out.") },
  agent: { label: () => t("Source mix"), description: () => t("Color shows which clients fed each memory.") },
  relations: { label: () => t("Real semantic links"), description: () => t("Explainable lines connect shared files, topics, and decisions.") },
  clusters: { label: () => t("Automatic communities"), description: () => t("Position and color group projects on the selected axis.") },
  saturation: { label: () => t("Saturation signals"), description: () => t("Pink marks heavier accumulation and age.") },
  reinforce: { label: () => t("Needs reinforcement"), description: () => t("Active projects with thin context stand out.") },
};
const COLORS = { codex: 0x4fdbff, claude: 0x9b8cff, mixed: 0xff5fca, saturation: 0xff4d9a, reinforce: 0xffbd5c, muted: 0x546394 };
const EDGE_COLORS = { files: 0x4fdbff, topics: 0xa78bfa, decisions: 0xffbd5c };
const CLUSTER_AXIS_LABELS = { product: "Product", client: "Client", technology: "Technology", agent: "Agent" };
const MEMORY_AGENT_LABELS = { codex: "Codex", claude: "Claude", legacy: "Legacy" };
let memorySearchTimer;
const state = {
  data: null, mode: "volume", clusterAxis: "product", selectedCluster: null, search: "", selected: null, hovered: null,
  nodes: [], edges: [], animation: 0, healthChecks: 0,
  layout: null,
  projectMemory: { project: null, query: "", searchMode: "keyword", type: "all", agent: "all", limit: 25, offset: 0, total: 0, records: [], facets: null, selectedId: null, detail: null, detailError: null, loading: false, detailLoading: false, requestId: 0 },
  alerts: { open: false, data: null, loading: false, kind: "all" },
  timeline: { open: false, data: null, range: "90", bucket: "auto", selectedIndex: -1, loading: false },
  cleanup: { open: false, records: [], summary: null, selected: new Set(), simulation: null, preview: null, result: null, loading: false },
};
const sceneHost = document.querySelector("#scene");
const tooltip = document.querySelector("#tooltip");
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x030619, 0.012);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 0, 34);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
sceneHost.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 10;
controls.maxDistance = 42;
controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
controls.autoRotateSpeed = 0.28;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const nodeGroup = new THREE.Group();
const lineGroup = new THREE.Group();
const ambientLight = new THREE.AmbientLight(0x7182ff, 1.45);
const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
keyLight.position.set(-8, 12, 16);
const rimLight = new THREE.DirectionalLight(0x4fcfff, 1.35);
rimLight.position.set(12, -7, 8);
scene.add(ambientLight, keyLight, rimLight, nodeGroup, lineGroup);

function formatBytes(bytes) {
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
function formatCompactBytes(bytes) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}
function dateLabel(value) {
  return formatDate(value);
}
function projectColor(project) {
  if (state.mode === "clusters") return clusterForProject(project.project)?.color ?? COLORS.muted;
  if (state.mode === "saturation") return project.saturation === "high" ? COLORS.saturation : project.saturation === "watch" ? COLORS.reinforce : COLORS.muted;
  if (state.mode === "reinforce") return project.age_days <= 60 && project.observations <= 4 ? COLORS.reinforce : COLORS.muted;
  const total = project.codex_observations + project.claude_observations;
  if (!total) return COLORS.claude;
  const ratio = project.codex_observations / total;
  if (ratio > .8) return COLORS.codex;
  if (ratio < .2) return COLORS.claude;
  return COLORS.mixed;
}
function axisClusters(axis = state.clusterAxis) {
  return state.data?.clusters?.[axis] ?? [];
}
function clusterForProject(projectName, axis = state.clusterAxis) {
  return axisClusters(axis).find((cluster) => cluster.projects.includes(projectName));
}
function confidenceLabel(confidence) {
  return ({ extracted: t("extracted"), inferred: t("inferred"), ambiguous: t("ambiguous") })[confidence] ?? confidence;
}
function sortedProjects() {
  const projects = state.data.projects.filter((project) => !state.selectedCluster || project.cluster_membership[state.clusterAxis] === state.selectedCluster);
  if (state.mode === "activity") projects.sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));
  else if (state.mode === "agent") projects.sort((a, b) => (b.codex_observations + b.claude_observations) - (a.codex_observations + a.claude_observations));
  else if (state.mode === "relations") projects.sort((a, b) => b.semantic_strength - a.semantic_strength || b.connections - a.connections);
  else if (state.mode === "clusters") projects.sort((a, b) => {
    const left = clusterForProject(a.project);
    const right = clusterForProject(b.project);
    return (right?.size ?? 0) - (left?.size ?? 0) || (left?.label ?? "").localeCompare(right?.label ?? "") || b.observations - a.observations;
  });
  else if (state.mode === "saturation") projects.sort((a, b) => b.saturation_score - a.saturation_score);
  else if (state.mode === "reinforce") projects.sort((a, b) => a.observations - b.observations || a.age_days - b.age_days);
  else projects.sort((a, b) => b.observations - a.observations);
  return projects;
}
function projectPositions(projects, radii) {
  const clusterMode = state.mode === "clusters";
  const scope = clusterMode ? `clusters:${state.clusterAxis}` : "base";
  let storage;
  try { storage = window.localStorage; } catch { storage = null; }
  const items = projects.map((project, index) => {
    const clusterId = clusterMode ? clusterForProject(project.project)?.id ?? "unassigned" : "base";
    return { id: project.project, radius: radii[index], signature: clusterId };
  });
  const layout = resolvePersistentLayout(items, {
    scope,
    storage,
    candidate: clusterMode
      ? (item, attempt) => clusterLayoutCandidate(item.id, item.signature, state.clusterAxis, attempt)
      : undefined,
  });
  state.layout = layout.metadata;
  return projects.map(({ project }) => {
    const point = layout.positions.get(project);
    return new THREE.Vector3(point.x, point.y, point.z);
  });
}
function clearGraph() {
  for (const group of [nodeGroup, lineGroup]) {
    while (group.children.length) {
      const child = group.children.pop();
      child.geometry?.dispose();
      child.material?.map?.dispose();
      child.material?.dispose();
    }
  }
  state.nodes = [];
  state.edges = [];
}
function createGlow(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(48, 48, 0, 48, 48, 48);
  gradient.addColorStop(0, `#${color.getHexString()}ff`);
  gradient.addColorStop(.24, `#${color.getHexString()}88`);
  gradient.addColorStop(1, "transparent");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 96, 96);
  return new THREE.CanvasTexture(canvas);
}
function buildGraph() {
  clearGraph();
  const projects = sortedProjects().slice(0, 48);
  const allRoots = state.data.projects.map((project) => Math.cbrt(Math.max(1, project.observations)));
  const minRoot = Math.min(...allRoots);
  const maxRoot = Math.max(...allRoots);
  const radii = projects.map((project) => {
    const root = Math.cbrt(Math.max(1, project.observations));
    return maxRoot === minRoot ? .65 : .28 + ((root - minRoot) / (maxRoot - minRoot)) * 1.22;
  });
  const positions = projectPositions(projects, radii);
  const geometry = new THREE.SphereGeometry(1, 28, 20);
  projects.forEach((project, index) => {
    const color = new THREE.Color(projectColor(project));
    const material = new THREE.MeshPhongMaterial({
      color,
      emissive: color.clone().multiplyScalar(.22),
      shininess: 110,
      transparent: true,
      opacity: .98,
    });
    const mesh = new THREE.Mesh(geometry.clone(), material);
    mesh.position.copy(positions[index]);
    mesh.scale.setScalar(radii[index]);
    mesh.userData = { project, radius: radii[index] };
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: createGlow(color), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.copy(positions[index]);
    glow.scale.setScalar(radii[index] * 6.6);
    nodeGroup.add(mesh);
    nodeGroup.add(glow);
    state.nodes.push(mesh);
  });
  const nodeByProject = new Map(state.nodes.map((node) => [node.userData.project.project, node]));
  for (const relation of state.data.relations) {
    const source = nodeByProject.get(relation.source);
    const target = nodeByProject.get(relation.target);
    if (!source || !target) continue;
    const direction = target.position.clone().sub(source.position);
    const length = direction.length();
    const radius = .012 + relation.score * .045;
    const material = new THREE.MeshBasicMaterial({
      color: EDGE_COLORS[relation.dominant] ?? EDGE_COLORS.topics,
      transparent: true,
      opacity: (state.mode === "relations" ? .34 : .14) + relation.score * .42,
      depthWrite: false,
    });
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 6, 1, true), material);
    edge.position.copy(source.position).add(target.position).multiplyScalar(.5);
    edge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    edge.userData = { relation, baseOpacity: material.opacity };
    lineGroup.add(edge);
    state.edges.push(edge);
  }
  nodeGroup.rotation.set(.08, -.24, 0);
  lineGroup.rotation.copy(nodeGroup.rotation);
  controls.target.set(0, 0, 0);
  document.querySelector("#mode-kicker").textContent = MODES[state.mode].label();
  window.__memoryMyceliumDebug = state.nodes.map((node) => ({
    project: node.userData.project.project,
    observations: node.userData.project.observations,
    radius: node.userData.radius,
    position: { x: node.position.x, y: node.position.y, z: node.position.z },
  }));
  window.__memoryMyceliumDebugRelations = state.edges.map((edge) => edge.userData.relation);
  window.__memoryMyceliumEdgeCount = state.edges.length;
  window.__memoryMyceliumDebugClusters = state.data.clusters;
  window.__memoryMyceliumLayout = state.layout;
  renderProjectList();
  renderClusterToolbar();
  if (state.selected) selectProject(projects.find((project) => project.project === state.selected.project));
  else updateEdgeEmphasis();
}
function renderProjectList() {
  const term = state.search.trim().toLocaleLowerCase(localeTag());
  const projects = sortedProjects().filter((project) => project.project.toLocaleLowerCase(localeTag()).includes(term));
  document.querySelector("#project-list").innerHTML = projects.map((project) => {
    const alertCount = state.data.alerts?.alerts?.filter((alert) => alert.project === project.project).length ?? 0;
    return `
    <button class="project-button ${state.selected?.project === project.project ? "selected" : ""}" data-project="${encodeURIComponent(project.project)}" role="listitem">
      <i style="background:#${new THREE.Color(projectColor(project)).getHexString()}"></i>
      <span><strong>${escapeHtml(project.project)}</strong><small>${state.mode === "clusters" ? `${escapeHtml(clusterForProject(project.project)?.label ?? t("No cluster"))} · ` : `${dateLabel(project.last_activity)} · `}${t(project.connections === 1 ? "{n} connection" : "{n} connections", { n: project.connections })}${alertCount ? ` · <em class="project-alert-note">${t(alertCount === 1 ? "{n} alert mark" : "{n} alert marks", { n: alertCount })}</em>` : ""}</small></span>
      <b>${project.observations}</b>
    </button>`;
  }).join("");
}
function renderClusterToolbar() {
  const toolbar = document.querySelector("#cluster-toolbar");
  const clusterMode = state.mode === "clusters" && !state.cleanup.open && !state.timeline.open && !state.alerts.open;
  toolbar.hidden = !clusterMode;
  document.querySelectorAll(".agent-color-key").forEach((item) => { item.hidden = clusterMode; });
  const clusterColorKey = document.querySelector("#cluster-color-key");
  clusterColorKey.hidden = !clusterMode;
  clusterColorKey.querySelector("span").textContent = t("Color = {axis}", { axis: t(CLUSTER_AXIS_LABELS[state.clusterAxis]) });
  document.querySelectorAll("[data-cluster-axis]").forEach((button) => button.classList.toggle("active", button.dataset.clusterAxis === state.clusterAxis));
  document.querySelector("#cluster-list").innerHTML = [
    `<button class="cluster-chip ${state.selectedCluster ? "" : "active"}" data-cluster-id=""><b>${t("All clusters")}</b></button>`,
    ...axisClusters().map((cluster) => `
      <button class="cluster-chip ${state.selectedCluster === cluster.id ? "active" : ""}" data-cluster-id="${encodeURIComponent(cluster.id)}" title="${t("{confidence} · cohesion {score}%", { confidence: confidenceLabel(cluster.confidence), score: Math.round(cluster.cohesion * 100) })}">
        <i style="color:${cluster.color};background:${cluster.color}"></i>
        <span>${escapeHtml(cluster.label)}</span><b>${cluster.size}</b>
      </button>`),
  ].join("");
}
function projectFacets(projectName) {
  return Object.entries(CLUSTER_AXIS_LABELS).map(([axis, label]) => ({
    axis,
    label,
    cluster: clusterForProject(projectName, axis),
  }));
}
function projectRelations(projectName) {
  return state.data.relations
    .filter((relation) => relation.source === projectName || relation.target === projectName)
    .sort((a, b) => b.score - a.score);
}
function relatedProject(relation, projectName) {
  return relation.source === projectName ? relation.target : relation.source;
}
function evidenceLine(relation) {
  const groups = [
    relation.evidence.files.length ? `<span class="evidence-label">${t("Files:")}</span> ${relation.evidence.files.slice(0, 2).map(escapeHtml).join(", ")}` : "",
    relation.evidence.topics.length ? `<span class="evidence-label">${t("Topics:")}</span> ${relation.evidence.topics.slice(0, 3).map(escapeHtml).join(", ")}` : "",
    relation.evidence.decisions.length ? `<span class="evidence-label">${t("Decisions:")}</span> ${relation.evidence.decisions.slice(0, 3).map(escapeHtml).join(", ")}` : "",
  ].filter(Boolean);
  return groups.join(" · ");
}
function updateEdgeEmphasis(projectName = state.selected?.project) {
  for (const edge of state.edges) {
    const { relation, baseOpacity } = edge.userData;
    const connected = projectName && (relation.source === projectName || relation.target === projectName);
    edge.material.opacity = projectName ? (connected ? Math.min(.96, baseOpacity + .28) : .025) : baseOpacity;
  }
}
function selectProject(project) {
  if (!project) return;
  state.selected = project;
  const node = state.nodes.find((item) => item.userData.project.project === project.project);
  if (node) {
    const direction = camera.position.clone().sub(node.position).normalize();
    camera.position.copy(node.position.clone().add(direction.multiplyScalar(12 + node.userData.radius * 3)));
    controls.target.copy(node.position);
  }
  const total = project.codex_observations + project.claude_observations;
  const codexRatio = total ? Math.round(project.codex_observations / total * 100) : 0;
  const relations = projectRelations(project.project);
  const alerts = state.data.alerts?.alerts?.filter((alert) => alert.project === project.project) ?? [];
  const currentMemoryState = state.projectMemory.project === project.project ? state.projectMemory : { query: "", searchMode: "keyword", type: "all", agent: "all" };
  document.querySelector("#detail-panel").innerHTML = `
    <div class="detail-grid">
      <div><span>${t("Selected project")}</span><h2>${escapeHtml(project.project)}</h2><p>${MODES[state.mode].description()}</p></div>
      <div><span>${t("Memories")}</span><strong>${formatNumber(project.observations)}</strong></div>
      <div><span>Claude / Codex</span><strong>${100 - codexRatio}% / ${codexRatio}%</strong></div>
      <div><span>${t("Last activity")}</span><strong>${project.age_days}d</strong></div>
      <div><span>${t("Saturation")}</span><strong class="risk-${project.saturation}">${project.saturation_score}%</strong></div>
    </div>
    <div class="facet-row">${alerts.map((alert) => `<span class="project-alert-note">${escapeHtml(alert.title)}: <b>${escapeHtml(alert.kind === "stale" ? `${alert.value}d` : `${alert.value}`)}</b></span>`).join("")}${projectFacets(project.project).map(({ label, cluster }) =>
      `<span>${t(label)}: <b>${escapeHtml(cluster?.label ?? t("Unidentified"))}</b></span>`
    ).join("")}</div>
    <section class="memory-explorer" data-memory-project="${encodeURIComponent(project.project)}">
      <div class="memory-explorer-head">
        <div><span class="eyebrow">${t("Sphere microscope")}</span><h2>${t("Individual memories")}</h2></div>
        <p>${t("Search inside {project} and open each record without leaving the network.", { project: escapeHtml(project.project) })}</p>
      </div>
      <div class="memory-controls">
        <label><span>${t("Search this project")}</span><input type="search" data-memory-search placeholder="${t("Decision, topic, or file")}" value="${escapeHtml(currentMemoryState.query)}"></label>
        <label><span>Busca</span><select data-memory-search-mode>
          <option value="keyword">${t("Keywords")}</option><option value="semantic">${t("Local semantic")}</option>
        </select></label>
        <label><span>${t("Type")}</span><select data-memory-type><option value="all">${t("All")}</option></select></label>
        <label><span>${t("Agent")}</span><select data-memory-agent>
          <option value="all">${t("All")}</option><option value="codex">Codex</option><option value="claude">Claude</option><option value="legacy">${t("Legacy")}</option>
        </select></label>
      </div>
      <div class="memory-lab">
        <div class="memory-catalog">
          <div class="memory-catalog-head"><span id="memory-result-count">${t("Loading")}</span><span id="memory-sort-label">${t("Newest first")}</span></div>
          <div class="memory-records" id="memory-records"><div class="memory-status">${t("Preparing samples…")}</div></div>
        </div>
        <article class="memory-inspector" id="memory-inspector">
          <div class="memory-inspector-empty"><div><span class="eyebrow">${t("Individual sample")}</span><h2>${t("Choose a memory")}</h2><p>${t("Summary, decisions, facts, and safe files will appear here.")}</p></div></div>
        </article>
      </div>
    </section>
    <div class="semantic-section">
      <div class="semantic-head">
        <div><span class="eyebrow">${t("Local evidence")}</span><h2>${t("Semantic connections")}</h2></div>
        <p>${t("{n} connections · extracted files; topics and decisions are inferred", { n: relations.length })}</p>
      </div>
      <div class="connection-list">${relations.slice(0, 6).map((relation) => `
        <button class="connection-card" data-project="${encodeURIComponent(relatedProject(relation, project.project))}">
          <strong>${escapeHtml(relatedProject(relation, project.project))}</strong>
          <b>${Math.round(relation.score * 100)}%</b>
          <small>${evidenceLine(relation)}</small>
        </button>`).join("") || '<p class="eyebrow">' + t('No relation reached the minimum threshold') + '</p>'}</div>
    </div>`;
  updateEdgeEmphasis(project.project);
  renderProjectList();
  prepareProjectMemoryExplorer(project.project);
}
function renderSignalList(selector, projects, value) {
  document.querySelector(selector).innerHTML = projects.map((project) =>
    `<button class="signal-row" data-project="${encodeURIComponent(project.project)}"><span>${escapeHtml(project.project)}</span><b>${value(project)}</b></button>`
  ).join("") || '<p class="eyebrow">' + t('No signal right now') + '</p>';
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
function resetProjectMemory(project) {
  const nextRequest = state.projectMemory.requestId + 1;
  state.projectMemory = {
    project, query: "", searchMode: "keyword", type: "all", agent: "all", limit: 25, offset: 0, total: 0, records: [], facets: null,
    selectedId: null, detail: null, detailError: null, loading: false, detailLoading: false, requestId: nextRequest,
  };
}
function renderProjectMemoryFilters() {
  const explorer = document.querySelector(".memory-explorer");
  if (!explorer || state.projectMemory.project !== decodeURIComponent(explorer.dataset.memoryProject)) return;
  const typeSelect = explorer.querySelector("[data-memory-type]");
  const agentSelect = explorer.querySelector("[data-memory-agent]");
  const types = state.projectMemory.facets?.types ?? [];
  typeSelect.innerHTML = [
    `<option value="all">${t("All")}</option>`,
    ...types.map(({ type, count }) => `<option value="${escapeHtml(type)}">${escapeHtml(type)} (${count})</option>`),
  ].join("");
  typeSelect.value = state.projectMemory.type;
  const agentCounts = new Map((state.projectMemory.facets?.agents ?? []).map(({ agent, count }) => [agent, count]));
  agentSelect.innerHTML = [
    `<option value="all">${t("All")}</option>`,
    ...["codex", "claude", "legacy"].map((agent) => `<option value="${agent}">${t(MEMORY_AGENT_LABELS[agent])} (${agentCounts.get(agent) ?? 0})</option>`),
  ].join("");
  agentSelect.value = state.projectMemory.agent;
  const searchMode = explorer.querySelector("[data-memory-search-mode]");
  searchMode.value = state.projectMemory.searchMode;
}
function renderProjectMemoryList() {
  const host = document.querySelector("#memory-records");
  const count = document.querySelector("#memory-result-count");
  if (!host || !count) return;
  const memory = state.projectMemory;
  const sortLabel = document.querySelector("#memory-sort-label");
  if (sortLabel) sortLabel.textContent = memory.searchMode === "semantic" && memory.query.trim().length >= 2 ? t("Highest affinity first") : t("Newest first");
  window.__memoryMyceliumProjectMemory = {
    project: memory.project, total: memory.total, returned: memory.records.length, query: memory.query,
    searchMode: memory.searchMode, selectedId: memory.selectedId, loading: memory.loading,
  };
  count.textContent = memory.loading && !memory.records.length ? t("Loading") : t(memory.total === 1 ? "{n} memory" : "{n} memories", { n: formatNumber(memory.total) });
  const cards = memory.records.map((record) => `
    <button class="memory-card ${memory.selectedId === record.id ? "selected" : ""}" data-memory-id="${record.id}">
      <i class="memory-agent ${record.agent}" aria-hidden="true"></i>
      <span class="memory-card-main">
        <strong title="${escapeHtml(record.title)}">${escapeHtml(record.title || t("Untitled memory"))}</strong>
        <small>#${record.id} · ${dateLabel(record.created_at)} · ${t(MEMORY_AGENT_LABELS[record.agent] ?? "Legacy")}</small>
        ${record.preview ? `<em>${escapeHtml(record.preview)}</em>` : ""}
      </span>
      <span class="memory-card-signals">
        <b class="memory-type">${escapeHtml(record.type)}</b>
        ${Number.isFinite(record.semantic_percent)
          ? `<b class="memory-semantic-pill" title="${t("Local semantic affinity: {score}%", { score: record.semantic_percent })}">S ${record.semantic_percent}%</b>`
          : `<b class="memory-quality-pill quality-${qualityTone(record.quality?.overall)}" title="${t("Estimated quality: {score} of 100", { score: record.quality?.overall ?? 0 })}">Q ${record.quality?.overall ?? 0}</b>`}
      </span>
    </button>`).join("");
  if (!cards && memory.loading) {
    host.innerHTML = '<div class="memory-status">' + t('Searching this project…') + '</div>';
    return;
  }
  if (!cards) {
    host.innerHTML = '<div class="memory-status">' + t('No memory matches these filters.') + '</div>';
    return;
  }
  host.innerHTML = `${cards}${memory.records.length < memory.total
    ? `<button class="memory-load-more" data-memory-more>${t("Load {n} more", { n: Math.min(memory.limit, memory.total - memory.records.length) })}</button>`
    : ""}`;
}
function memorySection(title, content) {
  if (!content) return "";
  return `<section class="memory-section"><h4>${title}</h4>${content}</section>`;
}
function qualityTone(score) {
  if (score >= 75) return "strong";
  if (score >= 55) return "solid";
  if (score >= 35) return "review";
  return "weak";
}
function qualityMetric(label, value, kind, note) {
  const safeValue = Math.max(0, Math.min(100, Number(value ?? 0)));
  return `
    <div class="quality-metric quality-metric-${kind}">
      <div><span>${label}</span><b>${safeValue}</b></div>
      <i><span style="width:${safeValue}%"></span></i>
      <small>${note}</small>
    </div>`;
}
function qualityPanel(record) {
  const quality = record.quality;
  if (!quality) return "";
  const evidence = quality.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `
    <section class="quality-panel" aria-label="${t("Memory quality score")}">
      <div class="quality-score quality-${qualityTone(quality.overall)}" style="--quality-score:${quality.overall}">
        <div><strong>${quality.overall}</strong><span>/ 100</span></div>
        <small>${t("Quality {label}", { label: escapeHtml(t(quality.label)) })}</small>
      </div>
      <div class="quality-analysis">
        <header><div><span class="eyebrow">${t("Explainable diagnosis · {version}", { version: escapeHtml(quality.version) })}</span><h4>${t("Memory quality")}</h4></div><b>${t("Confidence {score}%", { score: quality.confidence })}</b></header>
        <div class="quality-metrics">
          ${qualityMetric(t("Relevance"), quality.relevance, "positive", t("Higher is better"))}
          ${qualityMetric(t("Redundancy"), quality.redundancy, "warning", t("Higher means more repeated"))}
          ${qualityMetric(t("Age"), quality.age, "warning", t("{n} days", { n: quality.age_days }))}
          ${qualityMetric(t("Usefulness"), quality.utility, "positive", t("Higher is more actionable"))}
          ${qualityMetric(t("Risk if deleted"), quality.exclusion_risk, "danger", t("100 = dangerous to delete"))}
        </div>
        <ul class="quality-evidence">${evidence}</ul>
      </div>
    </section>`;
}
function renderMemoryInspector() {
  const host = document.querySelector("#memory-inspector");
  if (!host) return;
  if (state.projectMemory.detailLoading) {
    host.innerHTML = '<div class="memory-inspector-empty"><div><span class="eyebrow">' + t('Reading sample') + '</span><h2>' + t('Opening memory…') + '</h2></div></div>';
    return;
  }
  if (state.projectMemory.detailError) {
    host.innerHTML = `<div class="memory-inspector-empty"><div><span class="eyebrow">${t("Read interrupted")}</span><h2>${t("Memory unavailable")}</h2><p>${escapeHtml(state.projectMemory.detailError)}</p></div></div>`;
    return;
  }
  const record = state.projectMemory.detail;
  if (!record) {
    host.innerHTML = '<div class="memory-inspector-empty"><div><span class="eyebrow">' + t("Individual sample") + '</span><h2>' + t("Choose a memory") + '</h2><p>' + t("Summary, decisions, facts, and safe files will appear here.") + '</p></div></div>';
    return;
  }
  const factItems = record.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("");
  const conceptItems = record.concepts.map((concept) => `<span>${escapeHtml(concept)}</span>`).join("");
  const modifiedItems = record.files_modified.map((file) => `<span title="${escapeHtml(file)}">${escapeHtml(file)}</span>`).join("");
  const readItems = record.files_read.map((file) => `<span title="${escapeHtml(file)}">${escapeHtml(file)}</span>`).join("");
  host.innerHTML = `
    <header class="memory-inspector-head">
      <div><span class="eyebrow">${t("Memory #{id}", { id: record.id })}</span><h3>${escapeHtml(record.title || "Memória sem título")}</h3></div>
      <div class="memory-inspector-meta">
        <span>${escapeHtml(record.type)}</span><span>${t(MEMORY_AGENT_LABELS[record.agent] ?? "Legacy")}</span><span>${dateLabel(record.created_at)}</span>
        ${record.redacted ? `<span class="redaction-pill">${t(record.redaction_count === 1 ? "{n} hidden field" : "{n} hidden fields", { n: record.redaction_count })}</span>` : ""}
      </div>
    </header>
    ${qualityPanel(record)}
    ${memorySection(t("Decision"), record.decision ? `<p class="memory-prose">${escapeHtml(record.decision)}</p>` : "")}
    ${memorySection(t("Summary"), record.summary ? `<p class="memory-prose">${escapeHtml(record.summary)}</p>` : "")}
    ${memorySection(t("Preserved facts"), factItems ? `<ul class="memory-facts">${factItems}</ul>` : "")}
    ${memorySection(t("Concepts"), conceptItems ? `<div class="memory-chips">${conceptItems}</div>` : "")}
    ${memorySection(t("Files modified"), modifiedItems ? `<div class="memory-chips">${modifiedItems}</div>` : "")}
    ${memorySection(t("Files read"), readItems ? `<div class="memory-chips">${readItems}</div>` : "")}
    ${!record.content_available ? '<div class="memory-status">' + t('This memory only has safe metadata.') + '</div>' : ""}
    <footer class="memory-feedback">
      <span>${t("Useful")} <b>${record.feedback.useful}</b></span><span>${t("Incorrect")} <b>${record.feedback.incorrect}</b></span><span>${t("Obsolete")} <b>${record.feedback.obsolete}</b></span>
      ${record.generated_by_model ? `<span>${t("Model")} <b>${escapeHtml(record.generated_by_model)}</b></span>` : ""}
    </footer>`;
}
async function loadMemoryDetail(id) {
  const project = state.projectMemory.project;
  state.projectMemory.selectedId = id;
  state.projectMemory.detail = null;
  state.projectMemory.detailError = null;
  state.projectMemory.detailLoading = true;
  renderProjectMemoryList();
  renderMemoryInspector();
  try {
    const detail = await cleanupRequest(`/api/memories/${id}?project=${encodeURIComponent(project)}`);
    if (state.projectMemory.project !== project || state.projectMemory.selectedId !== id) return;
    state.projectMemory.detail = detail;
  } catch (error) {
    if (state.projectMemory.project === project && state.projectMemory.selectedId === id) state.projectMemory.detailError = error.message;
  } finally {
    if (state.projectMemory.project === project && state.projectMemory.selectedId === id) {
      state.projectMemory.detailLoading = false;
      renderMemoryInspector();
    }
  }
}
async function loadProjectMemories({ append = false } = {}) {
  const memory = state.projectMemory;
  const project = memory.project;
  const requestId = ++memory.requestId;
  if (!append) {
    memory.offset = 0;
    memory.records = [];
    memory.total = 0;
    memory.selectedId = null;
    memory.detail = null;
    memory.detailError = null;
  }
  memory.loading = true;
  renderProjectMemoryList();
  renderMemoryInspector();
  const params = new URLSearchParams({
    q: memory.query, search_mode: memory.searchMode, type: memory.type, agent: memory.agent, limit: String(memory.limit),
    offset: String(append ? memory.records.length : 0),
  });
  try {
    const payload = await cleanupRequest(`/api/projects/${encodeURIComponent(project)}/memories?${params}`);
    if (state.projectMemory.project !== project || state.projectMemory.requestId !== requestId) return;
    memory.records = append ? [...memory.records, ...payload.records] : payload.records;
    memory.total = payload.total;
    memory.offset = memory.records.length;
    memory.facets = payload.facets;
    renderProjectMemoryFilters();
    renderProjectMemoryList();
    if (!append && memory.records.length) await loadMemoryDetail(memory.records[0].id);
  } finally {
    if (state.projectMemory.project === project && state.projectMemory.requestId === requestId) {
      memory.loading = false;
      renderProjectMemoryList();
    }
  }
}
function prepareProjectMemoryExplorer(project) {
  if (state.projectMemory.project !== project) {
    resetProjectMemory(project);
    loadProjectMemories().catch((error) => {
      state.projectMemory.loading = false;
      const host = document.querySelector("#memory-records");
      if (host) host.innerHTML = `<div class="memory-status">${escapeHtml(error.message)}</div>`;
    });
    return;
  }
  const explorer = document.querySelector(".memory-explorer");
  explorer.querySelector("[data-memory-search]").value = state.projectMemory.query;
  renderProjectMemoryFilters();
  renderProjectMemoryList();
  renderMemoryInspector();
  if (!state.projectMemory.records.length && !state.projectMemory.loading) loadProjectMemories().catch(() => {});
}
function alertKindLabel(kind) {
  return ({ saturation: t("Saturation"), stale: t("Staleness"), inconsistent: t("Inconsistency") })[kind] ?? kind;
}
function renderAlertBadge() {
  const data = state.data?.alerts;
  if (!data) return;
  const total = data.summary.total;
  const critical = data.summary.critical;
  const pill = document.querySelector("#alert-pill");
  pill.classList.toggle("critical", critical > 0);
  pill.classList.toggle("clear", total === 0);
  document.querySelector("#alert-pill-label").textContent = total === 0 ? t("No alerts") : critical ? t(critical === 1 ? "{n} critical" : "{n} criticals", { n: formatNumber(critical) }) : t(total === 1 ? "{n} alert" : "{n} alerts", { n: formatNumber(total) });
  document.querySelector("#alert-nav-count").textContent = total;
  document.title = total ? `(${total}) You're Always on My Mind` : "You're Always on My Mind";
}
function renderAlertConfig() {
  const config = state.alerts.data?.config;
  if (!config) return;
  document.querySelector("#alerts-enabled").checked = config.enabled;
  document.querySelector("#alert-saturation-enabled").checked = config.saturation.enabled;
  document.querySelector("#alert-saturation-threshold").value = config.saturation.threshold;
  document.querySelector("#alert-saturation-minimum").value = config.saturation.minimum_observations;
  document.querySelector("#alert-stale-enabled").checked = config.stale.enabled;
  document.querySelector("#alert-stale-days").value = config.stale.days;
  document.querySelector("#alert-stale-minimum").value = config.stale.minimum_observations;
  document.querySelector("#alert-inconsistent-enabled").checked = config.inconsistent.enabled;
  document.querySelector("#alert-duplicate-threshold").value = config.inconsistent.duplicate_threshold;
  document.querySelector("#alert-incorrect-threshold").value = config.inconsistent.incorrect_feedback_threshold;
  document.querySelector("#alert-missing-threshold").value = config.inconsistent.missing_title_threshold;
  document.querySelector("#alert-muted-list").innerHTML = config.muted_projects.length
    ? config.muted_projects.map((project) => state.data.access?.read_only
      ? `<span class="eyebrow">${t("Muted · {project}", { project: escapeHtml(project) })}</span>`
      : `<button data-alert-unmute="${encodeURIComponent(project)}" title="${t("Unmute alerts")}">${t("Unmute · {project}", { project: escapeHtml(project) })}</button>`).join("")
    : '<span class="eyebrow">' + t('No muted projects') + '</span>';
}
function renderAlerts() {
  const data = state.alerts.data;
  if (!data) return;
  document.querySelector("#alert-total").textContent = data.summary.total;
  document.querySelector("#alert-critical").textContent = data.summary.critical;
  document.querySelector("#alert-warning").textContent = data.summary.warning;
  document.querySelector("#alert-muted").textContent = data.summary.muted_projects;
  const records = data.alerts.filter((alert) => state.alerts.kind === "all" || alert.kind === state.alerts.kind);
  const host = document.querySelector("#alert-list");
  if (state.alerts.loading) {
    host.innerHTML = '<div class="alert-empty"><div><span class="eyebrow">' + t('Re-evaluating rules') + '</span><h2>' + t('Watching memory…') + '</h2></div></div>';
    return;
  }
  host.innerHTML = records.map((alert) => `
    <div class="alert-row ${alert.severity}" role="listitem">
      <i aria-hidden="true"></i>
      <div class="alert-row-main">
        <strong>${escapeHtml(alert.project)}</strong>
        <small>${escapeHtml(alertKindLabel(alert.kind))} · ${alert.severity === "critical" ? t("Critical") : t("Warning")} · ${t("threshold {n}", { n: alert.threshold })}</small>
        <p>${escapeHtml(alert.message)}</p>
      </div>
      <div class="alert-row-actions">
        <button data-alert-project="${encodeURIComponent(alert.project)}">${t("Open project")}</button>
        ${state.data.access?.read_only ? "" : `<button data-alert-mute="${encodeURIComponent(alert.project)}">${t("Mute")}</button>`}
      </div>
    </div>`).join("") || '<div class="alert-empty"><div><span class="eyebrow">' + t('All steady') + '</span><h2>' + t('No signal in this filter') + '</h2><p>' + t('Watching continues locally.') + '</p></div></div>';
  window.__memoryMyceliumAlerts = {
    total: data.summary.total,
    critical: data.summary.critical,
    muted: data.config.muted_projects.length,
    kind: state.alerts.kind,
  };
}
function alertConfigFromForm() {
  return {
    version: 1,
    enabled: document.querySelector("#alerts-enabled").checked,
    saturation: {
      enabled: document.querySelector("#alert-saturation-enabled").checked,
      threshold: Number(document.querySelector("#alert-saturation-threshold").value),
      minimum_observations: Number(document.querySelector("#alert-saturation-minimum").value),
    },
    stale: {
      enabled: document.querySelector("#alert-stale-enabled").checked,
      days: Number(document.querySelector("#alert-stale-days").value),
      minimum_observations: Number(document.querySelector("#alert-stale-minimum").value),
    },
    inconsistent: {
      enabled: document.querySelector("#alert-inconsistent-enabled").checked,
      duplicate_threshold: Number(document.querySelector("#alert-duplicate-threshold").value),
      incorrect_feedback_threshold: Number(document.querySelector("#alert-incorrect-threshold").value),
      missing_title_threshold: Number(document.querySelector("#alert-missing-threshold").value),
    },
    muted_projects: state.alerts.data?.config.muted_projects ?? [],
  };
}
async function loadAlerts({ renderConfig = true } = {}) {
  state.alerts.loading = true;
  renderAlerts();
  try {
    const data = await cleanupRequest("/api/alerts");
    state.alerts.data = data;
    state.data.alerts = data;
    if (renderConfig) renderAlertConfig();
    renderAlertBadge();
    renderProjectList();
  } finally {
    state.alerts.loading = false;
    renderAlerts();
  }
}
async function saveAlerts(config, { reset = false, status = t("Rules saved locally.") } = {}) {
  document.querySelector("#alert-save-status").textContent = t("Saving…");
  await cleanupRequest("/api/alerts/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(reset ? { reset: true } : { config }),
  });
  await loadAlerts();
  document.querySelector("#alert-save-status").textContent = status;
}
function openAlerts() {
  state.cleanup.open = false;
  state.timeline.open = false;
  state.alerts.open = true;
  controls.autoRotate = false;
  document.querySelector("#cleanup-panel").hidden = true;
  document.querySelector("#timeline-panel").hidden = true;
  document.querySelector("#alerts-panel").hidden = false;
  document.querySelector("#graph-workspace").hidden = true;
  document.querySelector("#detail-panel").hidden = true;
  document.querySelector("#signals-panel").hidden = true;
  document.querySelector("#cluster-toolbar").hidden = true;
  document.querySelectorAll(".mode-switcher button").forEach((button) => button.classList.toggle("active", button.dataset.action === "alerts"));
  state.alerts.data = state.data.alerts;
  renderAlertConfig();
  renderAlerts();
  loadAlerts().catch((error) => {
    state.alerts.loading = false;
    document.querySelector("#alert-list").innerHTML = `<div class="alert-empty">${escapeHtml(error.message)}</div>`;
  });
}
function closeAlerts() {
  state.alerts.open = false;
  controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelector("#alerts-panel").hidden = true;
  document.querySelector("#graph-workspace").hidden = false;
  document.querySelector("#detail-panel").hidden = false;
  document.querySelector("#signals-panel").hidden = false;
  document.querySelectorAll(".mode-switcher button").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  renderClusterToolbar();
}
function timelineDateLabel(value) {
  return formatShortDate(value);
}
function signed(value, suffix = "") {
  const number = Number(value ?? 0);
  return `${number > 0 ? "+" : ""}${number}${suffix}`;
}
function timelineX(index, count, width, left, right) {
  return count <= 1 ? (left + width - right) / 2 : left + index * ((width - left - right) / (count - 1));
}
function pathFrom(points, x, y) {
  return points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point).toFixed(1)}`).join(" ");
}
function timelineHits(points, width, height, left, right, top, bottom) {
  const step = (width - left - right) / Math.max(1, points.length - 1);
  return points.map((point, index) => {
    const center = timelineX(index, points.length, width, left, right);
    const start = index === 0 ? left : center - step / 2;
    const end = index === points.length - 1 ? width - right : center + step / 2;
    return `<rect class="timeline-hit" data-timeline-index="${index}" x="${start.toFixed(1)}" y="${top}" width="${Math.max(1, end - start).toFixed(1)}" height="${height - top - bottom}" tabindex="0" role="button" aria-label="${timelineDateLabel(point.date)}"></rect>`;
  }).join("");
}
function xAxisLabels(points, width, height, left, right, bottom) {
  const compact = width <= 600;
  const every = Math.max(1, Math.ceil(points.length / (compact ? 4 : 5)));
  return points.map((point, index) => index % every === 0 || index === points.length - 1
    ? `<text class="timeline-axis-label" x="${timelineX(index, points.length, width, left, right).toFixed(1)}" y="${height - bottom + 22}" text-anchor="${index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}">${compact ? point.date.slice(5).split("-").reverse().join("/") : timelineDateLabel(point.date)}</text>`
    : "").join("");
}
function growthChartSvg(points) {
  const width = 1000, height = 300, left = 58, right = 20, top = 18, bottom = 40;
  const values = points.map(({ cumulative_memories }) => cumulative_memories);
  const rawMin = Math.min(...values), rawMax = Math.max(...values);
  const range = Math.max(1, rawMax - rawMin);
  const minimum = Math.max(0, rawMin - range * .12);
  const maximum = rawMax + range * .08;
  const plotBottom = height - bottom;
  const x = (index) => timelineX(index, points.length, width, left, right);
  const y = (point) => top + (maximum - point.cumulative_memories) / (maximum - minimum) * (plotBottom - top);
  const line = pathFrom(points, x, y);
  const area = `${line} L${x(points.length - 1).toFixed(1)},${plotBottom} L${x(0).toFixed(1)},${plotBottom} Z`;
  const maximumAdded = Math.max(1, ...points.map(({ added_memories }) => added_memories));
  const step = (width - left - right) / Math.max(1, points.length - 1);
  const barWidth = Math.min(28, Math.max(5, step * .52));
  const bars = points.map((point, index) => {
    const barHeight = point.added_memories / maximumAdded * 82;
    return `<rect class="timeline-growth-bar" x="${(x(index) - barWidth / 2).toFixed(1)}" y="${(plotBottom - barHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3"></rect>`;
  }).join("");
  const grid = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    const gridY = top + ratio * (plotBottom - top);
    const value = Math.round(maximum - ratio * (maximum - minimum));
    return `<line class="timeline-grid" x1="${left}" x2="${width - right}" y1="${gridY}" y2="${gridY}"></line><text class="timeline-axis-label" x="${left - 9}" y="${gridY + 3}" text-anchor="end">${value}</text>`;
  }).join("");
  const cursorX = x(Math.max(0, state.timeline.selectedIndex));
  return `<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${t("Cumulative growth and new memories per period")}">
    <defs><linearGradient id="growthArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#42c8ff" stop-opacity=".38"/><stop offset="1" stop-color="#42c8ff" stop-opacity=".02"/></linearGradient></defs>
    ${grid}${bars}<path class="timeline-area" d="${area}"></path><path class="timeline-growth-path" d="${line}"></path>
    <line class="timeline-cursor-line" x1="${cursorX}" x2="${cursorX}" y1="${top}" y2="${plotBottom}"></line>
    ${xAxisLabels(points, width, height, left, right, bottom)}${timelineHits(points, width, height, left, right, top, bottom)}
  </svg>`;
}
function saturationChartSvg(points) {
  const width = 600, height = 220, left = 42, right = 18, top = 16, bottom = 34, plotBottom = height - bottom;
  const x = (index) => timelineX(index, points.length, width, left, right);
  const y = (point) => top + (100 - point.concentration_pct) / 100 * (plotBottom - top);
  const line = pathFrom(points, x, y);
  const area = `${line} L${x(points.length - 1)},${plotBottom} L${x(0)},${plotBottom} Z`;
  const maximumSaturated = Math.max(1, ...points.map(({ saturated_projects }) => saturated_projects));
  const cursorX = x(Math.max(0, state.timeline.selectedIndex));
  return `<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${t("Concentration and saturated projects per period")}">
    ${[0, 50, 100].map((value) => {
      const gridY = top + (100 - value) / 100 * (plotBottom - top);
      return `<line class="timeline-grid" x1="${left}" x2="${width - right}" y1="${gridY}" y2="${gridY}"></line><text class="timeline-axis-label" x="${left - 7}" y="${gridY + 3}" text-anchor="end">${value}%</text>`;
    }).join("")}
    <path class="timeline-saturation-area" d="${area}"></path><path class="timeline-saturation-path" d="${line}"></path>
    ${points.map((point, index) => `<circle class="timeline-saturation-point" cx="${x(index)}" cy="${plotBottom - (point.saturated_projects / maximumSaturated) * 48}" r="${3 + point.saturated_projects * .6}"><title>${t("{n} saturated projects", { n: point.saturated_projects })}</title></circle>`).join("")}
    <line class="timeline-cursor-line" x1="${cursorX}" x2="${cursorX}" y1="${top}" y2="${plotBottom}"></line>
    ${xAxisLabels(points, width, height, left, right, bottom)}${timelineHits(points, width, height, left, right, top, bottom)}
  </svg>`;
}
function agentChartSvg(points) {
  const width = 600, height = 220, left = 42, right = 18, top = 16, bottom = 34, plotBottom = height - bottom;
  const x = (index) => timelineX(index, points.length, width, left, right);
  const codexY = (point) => top + (100 - point.codex_share_pct) / 100 * (plotBottom - top);
  const attributedY = (point) => top + (100 - point.codex_share_pct - point.claude_share_pct) / 100 * (plotBottom - top);
  const codexLine = pathFrom(points, x, codexY);
  const attributedLine = pathFrom(points, x, attributedY);
  const codexArea = `${codexLine} L${x(points.length - 1)},${plotBottom} L${x(0)},${plotBottom} Z`;
  const reverseCodex = points.map((_, reverseIndex) => {
    const index = points.length - reverseIndex - 1;
    return `L${x(index).toFixed(1)},${codexY(points[index]).toFixed(1)}`;
  }).join(" ");
  const claudeArea = `${attributedLine} ${reverseCodex} Z`;
  const cursorX = x(Math.max(0, state.timeline.selectedIndex));
  const currentLegacy = points.at(-1).legacy_share_pct;
  return `<svg viewBox="0 0 ${width} ${height}" role="group" aria-label="${t("Claude, Codex, and legacy share per period")}">
    <rect class="timeline-legacy-area" x="${left}" y="${top}" width="${width - left - right}" height="${plotBottom - top}" rx="5"></rect>
    ${[0, 50, 100].map((value) => {
      const gridY = top + (100 - value) / 100 * (plotBottom - top);
      return `<line class="timeline-grid" x1="${left}" x2="${width - right}" y1="${gridY}" y2="${gridY}"></line><text class="timeline-axis-label" x="${left - 7}" y="${gridY + 3}" text-anchor="end">${value}%</text>`;
    }).join("")}
    <path class="timeline-claude-area" d="${claudeArea}"></path><path class="timeline-codex-area" d="${codexArea}"></path><path class="timeline-codex-path" d="${codexLine}"></path>
    ${currentLegacy >= 50 ? `<text class="timeline-agent-note" x="${(left + width - right) / 2}" y="${(top + plotBottom) / 2}" text-anchor="middle">${t("{n}% legacy without an identified agent", { n: formatNumber(currentLegacy) })}</text>` : ""}
    <line class="timeline-cursor-line" x1="${cursorX}" x2="${cursorX}" y1="${top}" y2="${plotBottom}"></line>
    ${xAxisLabels(points, width, height, left, right, bottom)}${timelineHits(points, width, height, left, right, top, bottom)}
  </svg>`;
}
function renderTimelineCursor() {
  const point = state.timeline.data?.points[state.timeline.selectedIndex];
  if (!point) return;
  document.querySelector("#timeline-cursor-card").innerHTML = `
    <div><span>Período</span><strong>${timelineDateLabel(point.date)} → ${timelineDateLabel(point.end_date)}</strong></div>
    <div><span>${t("New")}</span><strong>+${point.added_memories}</strong></div>
    <div><span>${t("Total")}</span><strong>${point.cumulative_memories}</strong></div>
    <div><span>${t("Saturated")}</span><strong>${point.saturated_projects}</strong></div>
    <div><span>${t("Claude / Codex / Legacy")}</span><strong>${point.claude_share_pct}% / ${point.codex_share_pct}% / ${point.legacy_share_pct}%</strong></div>`;
}
function selectTimelinePoint(index) {
  state.timeline.selectedIndex = Math.max(0, Math.min(index, state.timeline.data.points.length - 1));
  const pointCount = state.timeline.data.points.length;
  document.querySelectorAll(".timeline-chart svg").forEach((svg) => {
    const width = Number(svg.viewBox.baseVal.width);
    const left = width === 1000 ? 58 : 42;
    const right = width === 1000 ? 20 : 18;
    const cursorX = timelineX(state.timeline.selectedIndex, pointCount, width, left, right);
    const line = svg.querySelector(".timeline-cursor-line");
    line?.setAttribute("x1", cursorX);
    line?.setAttribute("x2", cursorX);
  });
  renderTimelineCursor();
}
function attachTimelineInteractions() {
  document.querySelectorAll(".timeline-chart").forEach((host) => {
    const choose = (event) => {
      const target = event.target.closest("[data-timeline-index]");
      if (target) selectTimelinePoint(Number(target.dataset.timelineIndex));
    };
    host.onpointermove = choose;
    host.onclick = choose;
    host.onfocusin = choose;
  });
}
function renderTimeline() {
  const data = state.timeline.data;
  if (!data?.points?.length) {
    document.querySelector("#growth-chart").innerHTML = '<div class="timeline-loading">' + t('No history available.') + '</div>';
    return;
  }
  const summary = data.summary;
  document.querySelector("#timeline-growth").textContent = `+${summary.growth_memories}`;
  document.querySelector("#timeline-growth-note").textContent = `${signed(summary.growth_pct, "%")} · ${formatCompactBytes(summary.estimated_content_growth_bytes)}`;
  document.querySelector("#timeline-saturated").textContent = summary.current_saturated_projects;
  document.querySelector("#timeline-saturated-note").textContent = `${signed(summary.saturation_delta)} ${t("in the period")}`;
  document.querySelector("#timeline-concentration").textContent = `${summary.current_concentration_pct}%`;
  document.querySelector("#timeline-concentration-note").textContent = `${signed(summary.concentration_delta, " p.p.")}`;
  document.querySelector("#timeline-codex").textContent = `${summary.current_codex_share_pct}%`;
  document.querySelector("#timeline-codex-note").textContent = `${signed(summary.codex_share_delta, " p.p.")} · Claude ${summary.current_claude_share_pct}% · ${t("legacy")} ${summary.current_legacy_share_pct}%`;
  state.timeline.selectedIndex = data.points.length - 1;
  document.querySelector("#growth-chart").innerHTML = growthChartSvg(data.points);
  document.querySelector("#saturation-chart").innerHTML = saturationChartSvg(data.points);
  document.querySelector("#agent-chart").innerHTML = agentChartSvg(data.points);
  document.querySelector("#timeline-event-list").innerHTML = data.events.map((event) => `
    <article class="timeline-event ${event.type}">
      <span>${timelineDateLabel(event.date)}</span><strong>${escapeHtml(event.label)}</strong><small>${escapeHtml(event.detail)}</small>
    </article>`).join("");
  renderTimelineCursor();
  attachTimelineInteractions();
}
async function loadTimeline() {
  state.timeline.loading = true;
  for (const selector of ["#growth-chart", "#saturation-chart", "#agent-chart"]) {
    document.querySelector(selector).innerHTML = '<div class="timeline-loading">' + t('Rebuilding historical rings…') + '</div>';
  }
  try {
    const params = new URLSearchParams({ range: state.timeline.range, bucket: state.timeline.bucket });
    state.timeline.data = await cleanupRequest(`/api/timeline?${params}`);
    renderTimeline();
  } finally {
    state.timeline.loading = false;
  }
}
function openTimeline() {
  state.cleanup.open = false;
  state.alerts.open = false;
  document.querySelector("#cleanup-panel").hidden = true;
  document.querySelector("#alerts-panel").hidden = true;
  state.timeline.open = true;
  controls.autoRotate = false;
  document.querySelector("#timeline-panel").hidden = false;
  document.querySelector("#graph-workspace").hidden = true;
  document.querySelector("#detail-panel").hidden = true;
  document.querySelector("#signals-panel").hidden = true;
  document.querySelector("#cluster-toolbar").hidden = true;
  document.querySelectorAll(".mode-switcher button").forEach((button) => button.classList.toggle("active", button.dataset.action === "timeline"));
  loadTimeline().catch((error) => {
    document.querySelector("#growth-chart").innerHTML = `<div class="timeline-loading">${escapeHtml(error.message)}</div>`;
  });
}
function closeTimeline() {
  state.timeline.open = false;
  controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelector("#timeline-panel").hidden = true;
  document.querySelector("#graph-workspace").hidden = false;
  document.querySelector("#detail-panel").hidden = false;
  document.querySelector("#signals-panel").hidden = false;
  document.querySelectorAll(".mode-switcher button").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  renderClusterToolbar();
}
function cleanupSearchRecords() {
  const term = document.querySelector("#cleanup-search").value.trim().toLocaleLowerCase(localeTag());
  if (!term) return state.cleanup.records;
  return state.cleanup.records.filter((record) =>
    `${record.title} ${record.project}`.toLocaleLowerCase(localeTag()).includes(term)
  );
}
function renderCleanupSummary() {
  const summary = state.cleanup.summary ?? { total: 0, recommended: 0, projects: 0, estimated_bytes: 0 };
  document.querySelector("#cleanup-total").textContent = summary.total;
  document.querySelector("#cleanup-recommended").textContent = summary.recommended;
  document.querySelector("#cleanup-projects").textContent = summary.projects;
  document.querySelector("#cleanup-bytes").textContent = formatCompactBytes(summary.estimated_bytes);
}
function renderCleanupCandidates() {
  const records = cleanupSearchRecords();
  const list = document.querySelector("#cleanup-candidate-list");
  if (state.cleanup.loading) {
    list.innerHTML = '<div class="candidate-empty"><strong>' + t('Analyzing local memory…') + '</strong></div>';
    return;
  }
  list.innerHTML = records.map((record) => {
    const selected = state.cleanup.selected.has(record.id);
    const safeLabel = record.kind.includes("obsolete") ? t("Confirmed obsolete") : record.confidence === "exact" ? t("Exact duplicate") : t("Human review");
    return `
      <label class="candidate-row ${selected ? "selected" : ""}" role="listitem">
        <input type="checkbox" data-cleanup-id="${record.id}" ${selected ? "checked" : ""} aria-label="${t("Select {title}", { title: escapeHtml(record.title || t("memory {id}", { id: record.id })) })}">
        <span class="candidate-main">
          <strong title="${escapeHtml(record.title)}">${escapeHtml(record.title || "Memória sem título")}</strong>
          <small>#${record.id} · ${escapeHtml(record.reason)}${record.keep_id ? ` · ${t("keeps #{id}", { id: record.keep_id })}` : ""} · ${dateLabel(record.created_at)}</small>
        </span>
        <span class="candidate-project"><strong>${escapeHtml(record.project)}</strong><small>${formatCompactBytes(record.estimated_bytes)}</small></span>
        <span class="candidate-badges"><i class="candidate-badge ${record.recommended ? "safe" : ""}">${safeLabel}</i></span>
      </label>`;
  }).join("") || '<div class="candidate-empty"><strong>' + t('No candidates in this filter.') + '</strong><p>' + t('Memory stays untouched.') + '</p></div>';
}
function renderCleanupImpact() {
  const host = document.querySelector("#cleanup-impact");
  const button = document.querySelector("#preview-cleanup");
  const selected = [...state.cleanup.selected];
  button.disabled = selected.length === 0 || state.cleanup.loading;
  if (state.cleanup.result) {
    host.className = "cleanup-success";
    host.innerHTML = `<strong>${t("{n} memories deleted safely.", { n: state.cleanup.result.deleted })}</strong>
      <p>${t("{size} of content released for SQLite to reuse internally.", { size: formatCompactBytes(state.cleanup.result.estimated_bytes) })}</p>
      <code>${t("Quarantine: {path}", { path: escapeHtml(state.cleanup.result.backup_path) })}</code>`;
    button.textContent = t("New analysis");
    button.disabled = false;
    return;
  }
  if (!selected.length) {
    host.className = "impact-empty";
    host.innerHTML = '<strong>' + t('No memory selected') + '</strong><p>' + t('Mark the records you want to evaluate. Analysis does not change the database yet.') + '</p>';
    button.textContent = t("Simulate prune");
    return;
  }
  if (!state.cleanup.simulation) {
    const bytes = state.cleanup.records.filter(({ id }) => state.cleanup.selected.has(id)).reduce((sum, record) => sum + record.estimated_bytes, 0);
    host.className = "impact-empty";
    host.innerHTML = `<strong>${t(selected.length === 1 ? "{n} selected" : "{n} selected plural", { n: selected.length })}</strong>
      <p>${t("Initial content: {size}. Run the read-only simulation to estimate the SQLite and quarantine impact.", { size: formatCompactBytes(bytes) })}</p>`;
    button.textContent = state.cleanup.loading ? t("Simulating…") : t("Simulate prune");
    return;
  }
  const preview = state.cleanup.preview ?? state.cleanup.simulation;
  const storage = preview.storage;
  const netAfter = -storage.net_disk_change_after_compaction_bytes;
  const netAfterLabel = netAfter >= 0 ? t("{size} recoverable", { size: formatCompactBytes(netAfter) }) : t("{size} added", { size: formatCompactBytes(Math.abs(netAfter)) });
  host.className = "";
  host.innerHTML = `
    <div class="prune-simulator">
      <div class="simulator-status"><i></i><span>${t("Read-only simulation")}</span><b>${escapeHtml(storage.method)}</b></div>
      <div class="prune-total">
        <span>${t("Potential after compaction")}</span>
        <strong>${formatCompactBytes(storage.compacted_file_reduction_estimated_bytes)}</strong>
        <small>${t("range {low}–{high}", { low: formatCompactBytes(storage.internally_reusable_range_bytes.low), high: formatCompactBytes(storage.internally_reusable_range_bytes.high) })}</small>
      </div>
      <div class="storage-flow" aria-label="Fluxo estimado de armazenamento">
        <div><span>${t("Current database")}</span><b>${formatBytes(storage.database_bytes_before)}</b></div>
        <i>→</i>
        <div><span>${t("After delete")}</span><b>${formatBytes(storage.database_bytes_after_delete_estimated)}</b><small>${t("file does not shrink")}</small></div>
        <i>→</i>
        <div class="compacted"><span>${t("After compaction")}</span><b>${formatBytes(storage.database_bytes_after_compaction_estimated)}</b><small>${t("estimate")}</small></div>
      </div>
      <div class="prune-breakdown">
        <div><span>${t("Selected content")}</span><strong>${formatCompactBytes(storage.selected_content_bytes)}</strong></div>
        <div><span>${t("Estimated internal reuse")}</span><strong>${formatCompactBytes(storage.internally_reusable_estimated_bytes)}</strong></div>
        <div><span>${t("Immediate file reduction")}</span><strong>${formatCompactBytes(storage.immediate_file_reduction_bytes)}</strong></div>
        <div><span>${t("Estimated quarantine")}</span><strong>+${formatCompactBytes(storage.quarantine_estimated_bytes)}</strong></div>
      </div>
      <div class="net-storage ${netAfter < 0 ? "negative" : ""}">
        <span>${t("Disk balance after compaction + quarantine")}</span><strong>${netAfterLabel}</strong>
      </div>
    </div>
    <div class="impact-metrics">
      <div><span>${t("Delete")}</span><strong>${preview.selected_count}</strong></div>
      <div><span>${t("Projects")}</span><strong>${preview.affected_projects}</strong></div>
      <div><span>${t("Sessions")}</span><strong>${preview.affected_sessions}</strong></div>
      <div><span>${t("Of the whole database")}</span><strong>${storage.database_share_percent}%</strong></div>
    </div>
    <div class="impact-projects">${preview.project_impact.map((project) =>
      `<div><span>${escapeHtml(project.project)} <small>${formatCompactBytes(project.selected_content_bytes)}</small></span><b>${project.observations_before} → ${project.observations_after} · −${project.removed_percent}%</b></div>`
    ).join("")}</div>
    <p class="impact-warning">${storage.explanation.map(escapeHtml).join(" ")}</p>`;
  button.textContent = state.cleanup.preview ? t("Continue to confirmation") : state.cleanup.loading ? t("Validating…") : t("Validate selection");
}
function invalidateCleanupPreview() {
  state.cleanup.simulation = null;
  state.cleanup.preview = null;
  state.cleanup.result = null;
  renderCleanupImpact();
}
function showCleanupError(error) {
  const host = document.querySelector("#cleanup-impact");
  host.className = "impact-empty";
  host.innerHTML = `<strong>${t("Operation stopped")}</strong><p>${escapeHtml(error.message)}</p>`;
}
async function cleanupRequest(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has("accept-language")) headers.set("accept-language", localeTag());
  const response = await fetch(apiUrl(path), { cache: "no-store", ...options, headers });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? t("Cleanup operation failed."));
  return payload;
}
async function loadCleanup({ preserveResult = false } = {}) {
  state.cleanup.loading = true;
  if (!preserveResult) state.cleanup.result = null;
  renderCleanupCandidates();
  const project = document.querySelector("#cleanup-project-filter").value;
  const kind = document.querySelector("#cleanup-kind-filter").value;
  try {
    const params = new URLSearchParams({ kind, limit: "500" });
    if (project) params.set("project", project);
    const payload = await cleanupRequest(`/api/cleanup/candidates?${params}`);
    state.cleanup.records = payload.records;
    state.cleanup.summary = payload.summary;
    const eligibleIds = new Set(payload.records.map(({ id }) => id));
    state.cleanup.selected = new Set([...state.cleanup.selected].filter((id) => eligibleIds.has(id)));
    state.cleanup.simulation = null;
    state.cleanup.preview = null;
  } finally {
    state.cleanup.loading = false;
    renderCleanupSummary();
    renderCleanupCandidates();
    renderCleanupImpact();
  }
}
function openCleanup() {
  state.timeline.open = false;
  state.alerts.open = false;
  document.querySelector("#timeline-panel").hidden = true;
  document.querySelector("#alerts-panel").hidden = true;
  state.cleanup.open = true;
  controls.autoRotate = false;
  document.querySelector("#cleanup-panel").hidden = false;
  document.querySelector("#graph-workspace").hidden = true;
  document.querySelector("#detail-panel").hidden = true;
  document.querySelector("#signals-panel").hidden = true;
  document.querySelector("#cluster-toolbar").hidden = true;
  document.querySelectorAll(".mode-switcher button").forEach((button) => button.classList.toggle("active", button.dataset.action === "cleanup"));
  loadCleanup().catch((error) => {
    state.cleanup.loading = false;
    document.querySelector("#cleanup-candidate-list").innerHTML = `<div class="candidate-empty">${escapeHtml(error.message)}</div>`;
  });
}
function closeCleanup() {
  state.cleanup.open = false;
  controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelector("#cleanup-panel").hidden = true;
  document.querySelector("#graph-workspace").hidden = false;
  document.querySelector("#detail-panel").hidden = false;
  document.querySelector("#signals-panel").hidden = false;
  document.querySelectorAll(".mode-switcher button").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  renderClusterToolbar();
}
async function simulateCleanup() {
  const ids = [...state.cleanup.selected].sort((left, right) => left - right);
  state.cleanup.loading = true;
  renderCleanupImpact();
  try {
    state.cleanup.simulation = await cleanupRequest("/api/cleanup/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  } finally {
    state.cleanup.loading = false;
    renderCleanupImpact();
  }
}
async function previewCleanup() {
  const ids = [...state.cleanup.selected].sort((left, right) => left - right);
  state.cleanup.loading = true;
  renderCleanupImpact();
  try {
    state.cleanup.preview = await cleanupRequest("/api/cleanup/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    state.cleanup.simulation = state.cleanup.preview;
  } finally {
    state.cleanup.loading = false;
    renderCleanupImpact();
  }
}
function showCleanupDialog() {
  const preview = state.cleanup.preview;
  document.querySelector("#cleanup-dialog-summary").textContent =
    t("{count} memories in {projects} projects will be removed. Potential after compaction: {compacted}; immediate file reduction: {immediate}.", { count: preview.selected_count, projects: preview.affected_projects, compacted: formatCompactBytes(preview.storage.compacted_file_reduction_estimated_bytes), immediate: formatCompactBytes(preview.storage.immediate_file_reduction_bytes) });
  document.querySelector("#cleanup-confirm-phrase").textContent = preview.confirmation_phrase;
  const input = document.querySelector("#cleanup-confirm-input");
  input.value = "";
  document.querySelector("#execute-cleanup").disabled = true;
  document.querySelector("#cleanup-dialog").showModal();
  input.focus();
}
async function executeCleanup() {
  const preview = state.cleanup.preview;
  const ids = [...state.cleanup.selected].sort((left, right) => left - right);
  const phrase = document.querySelector("#cleanup-confirm-input").value;
  const button = document.querySelector("#execute-cleanup");
  button.disabled = true;
  button.textContent = t("Creating backup…");
  try {
    state.cleanup.result = await cleanupRequest("/api/cleanup/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, confirmation_token: preview.confirmation_token, phrase }),
    });
    document.querySelector("#cleanup-dialog").close();
    state.cleanup.selected.clear();
    state.cleanup.simulation = null;
    state.cleanup.preview = null;
    state.timeline.data = null;
    const response = await fetch(apiUrl("/api/overview"), { cache: "no-store", headers: { "accept-language": localeTag() } });
    if (response.ok) {
      state.data = await response.json();
      updateSummary();
      buildGraph();
    }
    await loadCleanup({ preserveResult: true });
  } finally {
    button.textContent = t("Delete permanently");
  }
}

function updateCompanion() {
  const link = document.querySelector("#viewer-link");
  const url = state.data?.companion?.viewer_url;
  if (!link) return;
  link.hidden = !url;
  if (url) link.href = url;
}
function updateSummary() {
  const { data } = state;
  document.querySelector("#total-observations").textContent = formatNumber(data.stats.observations);
  document.querySelector("#total-projects").textContent = formatNumber(data.projects.length);
  document.querySelector("#database-size").textContent = formatBytes(data.database_bytes);
  document.querySelector("#semantic-count").textContent = formatNumber(data.semantic.relation_count);
  updateCompanion();
  document.querySelector("#saturated-count").textContent = data.projects.filter((project) => project.saturation === "high").length;
  document.querySelector("#embedding-coverage").textContent = data.embeddings.index_ready ? `${formatNumber(data.embeddings.coverage_percent)}%` : t("Pending");
  const pill = document.querySelector("#health-pill");
  pill.classList.toggle("healthy", data.health.ok === true);
  pill.querySelector("strong").textContent = data.health.ok === true ? t("System healthy") : data.health.ok === null ? t("Checking") : t("Review system");
  renderAlertBadge();
  renderSignalList("#saturation-list", data.saturated, (project) => `${formatNumber(project.observations)} mem · ${project.saturation_score}%`);
  renderSignalList("#reinforce-list", data.reinforce, (project) => t("{n} mem", { n: formatNumber(project.observations) }));
  renderSignalList("#review-list", data.review, (project) => t("{days}d · {count} mem", { days: project.age_days, count: formatNumber(project.observations) }));
}
function applyAccessMode() {
  const access = state.data.access ?? { remote: false, read_only: false };
  document.querySelector("#remote-pill").hidden = !access.remote;
  document.querySelector("[data-action='cleanup']").hidden = access.read_only;
  for (const control of document.querySelectorAll(".alert-rules input, #alert-save, #alert-reset")) control.disabled = access.read_only;
  if (access.read_only) document.querySelector("#alert-save-status").textContent = t("Settings are available only on local access.");
}
function resize() {
  const width = sceneHost.clientWidth;
  const height = sceneHost.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  const graphScale = width / height < .85 ? .76 : 1;
  nodeGroup.scale.setScalar(graphScale);
  lineGroup.scale.setScalar(graphScale);
}
function setPointer(event) {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
}
function hitTest(event) {
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects(state.nodes, false)[0]?.object ?? null;
}
renderer.domElement.addEventListener("pointermove", (event) => {
  const node = hitTest(event);
  state.hovered = node;
  renderer.domElement.style.cursor = node ? "pointer" : "grab";
  if (!node) {
    tooltip.hidden = true;
    updateEdgeEmphasis();
    return;
  }
  const project = node.userData.project;
  const connectionCount = projectRelations(project.project).length;
  tooltip.hidden = false;
  tooltip.style.left = `${event.clientX + 14}px`;
  tooltip.style.top = `${event.clientY + 14}px`;
  const clusterNote = state.mode === "clusters" ? ` · ${escapeHtml(clusterForProject(project.project)?.label ?? t("No cluster"))}` : "";
  tooltip.innerHTML = `<strong>${escapeHtml(project.project)}</strong><br>${t("{count} memories · {connections} connections", { count: formatNumber(project.observations), connections: connectionCount })}${clusterNote}`;
  updateEdgeEmphasis(project.project);
});
renderer.domElement.addEventListener("pointerleave", () => { tooltip.hidden = true; state.hovered = null; updateEdgeEmphasis(); });
renderer.domElement.addEventListener("click", (event) => {
  const node = hitTest(event);
  if (node) selectProject(node.userData.project);
});
document.querySelector(".mode-switcher").addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (!button) return;
  if (state.timeline.open) closeTimeline();
  if (state.cleanup.open) closeCleanup();
  if (state.alerts.open) closeAlerts();
  state.mode = button.dataset.mode;
  if (state.mode !== "clusters") state.selectedCluster = null;
  document.querySelectorAll(".mode-switcher button").forEach((item) => item.classList.toggle("active", item === button));
  buildGraph();
});
document.querySelectorAll("[data-action='alerts']").forEach((button) => button.addEventListener("click", openAlerts));
document.querySelector("[data-close-alerts]").addEventListener("click", closeAlerts);
document.querySelector("#alert-kind-filter").addEventListener("change", (event) => {
  state.alerts.kind = event.target.value;
  renderAlerts();
});
document.querySelector("#alert-save").addEventListener("click", () => {
  const invalid = [...document.querySelectorAll(".alert-rules input[type='number']")].find((input) => !input.checkValidity());
  if (invalid) {
    invalid.focus();
    document.querySelector("#alert-save-status").textContent = t("Review the limits you entered.");
    return;
  }
  saveAlerts(alertConfigFromForm()).catch((error) => {
    document.querySelector("#alert-save-status").textContent = error.message;
  });
});
document.querySelector("#alert-reset").addEventListener("click", () => {
  saveAlerts(null, { reset: true, status: t("Defaults restored.") }).catch((error) => {
    document.querySelector("#alert-save-status").textContent = error.message;
  });
});
document.querySelector("#alerts-panel").addEventListener("click", (event) => {
  const projectButton = event.target.closest("[data-alert-project]");
  if (projectButton) {
    const project = decodeURIComponent(projectButton.dataset.alertProject);
    closeAlerts();
    selectProject(state.data.projects.find((item) => item.project === project));
    return;
  }
  const muteButton = event.target.closest("[data-alert-mute]");
  const unmuteButton = event.target.closest("[data-alert-unmute]");
  if (!muteButton && !unmuteButton) return;
  const project = decodeURIComponent(muteButton?.dataset.alertMute ?? unmuteButton.dataset.alertUnmute);
  const muted = new Set(state.alerts.data.config.muted_projects);
  if (muteButton) muted.add(project);
  else muted.delete(project);
  const config = { ...state.alerts.data.config, muted_projects: [...muted] };
  saveAlerts(config, { status: muteButton ? t("{project} muted.", { project }) : t("{project} unmuted.", { project }) }).catch((error) => {
    document.querySelector("#alert-save-status").textContent = error.message;
  });
});
document.querySelector("[data-action='timeline']").addEventListener("click", openTimeline);
document.querySelector("[data-close-timeline]").addEventListener("click", closeTimeline);
document.querySelector(".range-switcher").addEventListener("click", (event) => {
  const button = event.target.closest("[data-timeline-range]");
  if (!button || state.timeline.loading) return;
  state.timeline.range = button.dataset.timelineRange;
  document.querySelectorAll("[data-timeline-range]").forEach((item) => item.classList.toggle("active", item === button));
  loadTimeline().catch((error) => {
    document.querySelector("#growth-chart").innerHTML = `<div class="timeline-loading">${escapeHtml(error.message)}</div>`;
  });
});
document.querySelector("#timeline-bucket").addEventListener("change", (event) => {
  state.timeline.bucket = event.target.value;
  loadTimeline().catch((error) => {
    document.querySelector("#growth-chart").innerHTML = `<div class="timeline-loading">${escapeHtml(error.message)}</div>`;
  });
});
document.querySelector("[data-action='cleanup']").addEventListener("click", openCleanup);
document.querySelector("[data-close-cleanup]").addEventListener("click", closeCleanup);
document.querySelector("#cleanup-project-filter").addEventListener("change", () => loadCleanup().catch(showCleanupError));
document.querySelector("#cleanup-kind-filter").addEventListener("change", () => loadCleanup().catch(showCleanupError));
document.querySelector("#cleanup-search").addEventListener("input", renderCleanupCandidates);
document.querySelector("#cleanup-refresh").addEventListener("click", () => loadCleanup().catch(showCleanupError));
document.querySelector("#cleanup-candidate-list").addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-cleanup-id]");
  if (!checkbox) return;
  const id = Number(checkbox.dataset.cleanupId);
  if (checkbox.checked) state.cleanup.selected.add(id);
  else state.cleanup.selected.delete(id);
  invalidateCleanupPreview();
  renderCleanupCandidates();
});
document.querySelector("#select-recommended").addEventListener("click", () => {
  for (const record of state.cleanup.records) if (record.recommended) state.cleanup.selected.add(record.id);
  invalidateCleanupPreview();
  renderCleanupCandidates();
});
document.querySelector("#clear-cleanup-selection").addEventListener("click", () => {
  state.cleanup.selected.clear();
  invalidateCleanupPreview();
  renderCleanupCandidates();
});
document.querySelector("#preview-cleanup").addEventListener("click", async () => {
  if (state.cleanup.result) {
    state.cleanup.result = null;
    renderCleanupImpact();
    return;
  }
  if (state.cleanup.preview) {
    showCleanupDialog();
    return;
  }
  try {
    if (state.cleanup.simulation) await previewCleanup();
    else await simulateCleanup();
  }
  catch (error) {
    state.cleanup.loading = false;
    showCleanupError(error);
  }
});
document.querySelector("#cleanup-confirm-input").addEventListener("input", (event) => {
  document.querySelector("#execute-cleanup").disabled = event.target.value !== state.cleanup.preview?.confirmation_phrase;
});
document.querySelector("#execute-cleanup").addEventListener("click", () => executeCleanup().catch((error) => {
  document.querySelector("#execute-cleanup").disabled = false;
  document.querySelector("#cleanup-dialog-summary").textContent = error.message;
}));
document.querySelector("#cluster-toolbar").addEventListener("click", (event) => {
  const axisButton = event.target.closest("[data-cluster-axis]");
  if (axisButton) {
    state.clusterAxis = axisButton.dataset.clusterAxis;
    state.selectedCluster = null;
    buildGraph();
    return;
  }
  const clusterButton = event.target.closest("[data-cluster-id]");
  if (!clusterButton) return;
  state.selectedCluster = clusterButton.dataset.clusterId ? decodeURIComponent(clusterButton.dataset.clusterId) : null;
  if (state.selectedCluster && state.selected?.cluster_membership[state.clusterAxis] !== state.selectedCluster) {
    state.selected = null;
    document.querySelector("#detail-panel").innerHTML = '<div class="detail-empty"><span class="eyebrow">' + t('Selected cluster') + '</span><h2>' + t('Choose a project in this group') + '</h2><p>' + t('The network and the navigator show only members of this cluster.') + '</p></div>';
  }
  buildGraph();
});
document.querySelector("#project-search").addEventListener("input", (event) => { state.search = event.target.value; renderProjectList(); });
document.querySelector("#detail-panel").addEventListener("input", (event) => {
  if (!event.target.matches("[data-memory-search]")) return;
  state.projectMemory.query = event.target.value;
  window.clearTimeout(memorySearchTimer);
  memorySearchTimer = window.setTimeout(() => loadProjectMemories().catch((error) => {
    const host = document.querySelector("#memory-records");
    if (host) host.innerHTML = `<div class="memory-status">${escapeHtml(error.message)}</div>`;
  }), 280);
});
document.querySelector("#detail-panel").addEventListener("change", (event) => {
  if (event.target.matches("[data-memory-search-mode]")) state.projectMemory.searchMode = event.target.value;
  else if (event.target.matches("[data-memory-type]")) state.projectMemory.type = event.target.value;
  else if (event.target.matches("[data-memory-agent]")) state.projectMemory.agent = event.target.value;
  else return;
  loadProjectMemories().catch((error) => {
    const host = document.querySelector("#memory-records");
    if (host) host.innerHTML = `<div class="memory-status">${escapeHtml(error.message)}</div>`;
  });
});
document.querySelector("#detail-panel").addEventListener("click", (event) => {
  const memoryButton = event.target.closest("[data-memory-id]");
  if (memoryButton) {
    loadMemoryDetail(Number(memoryButton.dataset.memoryId)).catch((error) => {
      const host = document.querySelector("#memory-inspector");
      if (host) host.innerHTML = `<div class="memory-inspector-empty">${escapeHtml(error.message)}</div>`;
    });
    return;
  }
  if (event.target.closest("[data-memory-more]")) loadProjectMemories({ append: true }).catch((error) => {
    const host = document.querySelector("#memory-records");
    if (host) host.insertAdjacentHTML("beforeend", `<div class="memory-status">${escapeHtml(error.message)}</div>`);
  });
});
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-project]");
  if (!target || target.dataset.mode) return;
  const projectName = decodeURIComponent(target.dataset.project);
  selectProject(state.data.projects.find((project) => project.project === projectName));
});
new ResizeObserver(resize).observe(sceneHost);
function animate() {
  controls.update();
  nodeGroup.rotation.y += controls.autoRotate ? 0 : 0.00015;
  lineGroup.rotation.copy(nodeGroup.rotation);
  for (const node of state.nodes) {
    const selected = state.selected?.project === node.userData.project.project;
    const hovered = state.hovered === node;
    const targetScale = (selected ? 1.18 : hovered ? 1.1 : 1) * node.userData.radius;
    node.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), .12);
  }
  renderer.render(scene, camera);
  state.animation = requestAnimationFrame(animate);
}
async function load() {
  const response = await fetch(apiUrl("/api/overview"), { cache: "no-store", headers: { "accept-language": localeTag() } });
  if (!response.ok) throw new Error(t("Could not load memory"));
  state.data = await response.json();
  document.querySelector("#cleanup-project-filter").innerHTML = [
    '<option value="">' + t('All') + '</option>',
    ...state.data.projects.map(({ project }) => `<option value="${escapeHtml(project)}">${escapeHtml(project)}</option>`),
  ].join("");
  updateSummary();
  applyAccessMode();
  buildGraph();
  if (state.data.health.ok === null && state.healthChecks < 5) window.setTimeout(refreshHealthStatus, 4_000);
}
async function refreshHealthStatus() {
  state.healthChecks += 1;
  const response = await fetch(apiUrl("/api/overview"), { cache: "no-store", headers: { "accept-language": localeTag() } });
  if (!response.ok) return;
  const fresh = await response.json();
  state.data.health = fresh.health;
  updateSummary();
  if (state.data.health.ok === null && state.healthChecks < 5) window.setTimeout(refreshHealthStatus, 4_000);
}
async function refreshAlertStatus() {
  const response = await fetch(apiUrl("/api/alerts"), { cache: "no-store", headers: { "accept-language": localeTag() } });
  if (!response.ok) return;
  const alerts = await response.json();
  state.data.alerts = alerts;
  if (state.alerts.open) {
    state.alerts.data = alerts;
    renderAlerts();
  }
  renderAlertBadge();
  renderProjectList();
}

applyDocument();
document.querySelector("#demo-banner").hidden = !demoMode;
document.querySelectorAll("[data-set-locale]").forEach((button) => {
  button.addEventListener("click", () => {
    rememberLocale(button.dataset.setLocale);
    const url = new URL(location.href);
    url.searchParams.set("lang", button.dataset.setLocale);
    if (demoMode) url.searchParams.set("demo", "1");
    location.assign(url);
  });
});
resize();
animate();
load().catch((error) => {
  document.querySelector("#scene").innerHTML = `<p class="detail-empty">${escapeHtml(error.message)}</p>`;
});
window.setInterval(() => refreshAlertStatus().catch(() => {}), 60_000);
