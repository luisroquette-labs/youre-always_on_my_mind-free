import assert from "node:assert/strict";
import { demoDispatch, resetDemoState } from "../dashboard/demo-data.mjs";
import { buildAutomaticClusters, buildSemanticRelations } from "../semantic-relations.mjs";

resetDemoState();
const stats = demoDispatch(["stats"])[0];
assert.ok(stats.observations > 100);
assert.equal(stats.projects, 10);
const projects = demoDispatch(["projects", "80"]);
assert.ok(projects.some((project) => project.project === "Northwind Atlas"));
assert.equal(projects.some((project) => /@|sk-|real user/i.test(JSON.stringify(project))), false);

const semantic = demoDispatch(["semantic", "20"]);
const names = projects.map((project) => project.project);
const graph = buildSemanticRelations(semantic, names);
assert.ok(graph.relations.length > 2, "fictional projects should form a visible graph");
const clusters = buildAutomaticClusters(graph, projects, "en");
assert.equal(clusters.metadata.method, "weighted-louvain-facets-v1");
assert.equal(clusters.axes.client.some((cluster) => cluster.label === "Não identificado"), false);

const memories = demoDispatch(["project-memories", "--project", "Northwind Atlas", "--type", "all", "--agent", "all", "--limit", "10", "--offset", "0", "--query", "tile"]);
assert.ok(memories.total >= 1);
assert.match(memories.records[0].preview, /Fictional sample/);
const detail = demoDispatch(["inspect-memory", "--id", String(memories.records[0].id), "--project", "Northwind Atlas"]);
assert.equal(detail.fictional, true);
assert.ok(detail.quality.overall > 0);

const candidates = demoDispatch(["cleanup-candidates", "--kind", "all", "--limit", "50"]);
assert.ok(candidates.summary.total >= 1);
const preview = demoDispatch(["cleanup-simulate", "--ids", String(candidates.records[0].id)]);
assert.equal(preview.confirmation_phrase, "DELETE 1");
assert.equal(preview.database_changed, false);
assert.equal(demoDispatch(["cleanup-preview", "--ids", String(candidates.records[0].id)], "pt").confirmation_phrase, "EXCLUIR 1");
const removed = demoDispatch(["cleanup-delete", "--ids", String(candidates.records[0].id), "--confirm-token", preview.confirmation_token, "--phrase", preview.confirmation_phrase]);
assert.equal(removed.deleted, 1);
assert.match(removed.backup_path, /no file written/);
const after = demoDispatch(["stats"])[0];
assert.equal(after.observations, stats.observations - 1);
resetDemoState();
assert.equal(demoDispatch(["stats"])[0].observations, stats.observations);

const health = demoDispatch(["health"]);
assert.equal(health.demo, true);
assert.equal(health.viewer.affiliated, false);
process.stdout.write("Fictional demo mode tests passed.\n");
