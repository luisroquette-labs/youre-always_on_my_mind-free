# Graph Report - youre-always_on_my_mind-public  (2026-08-14)

## Corpus Check
- Corpus is ~41,964 words - fits in a single context window. You may not need a graph.

## Summary
- 651 nodes · 1106 edges · 35 communities (33 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.79)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0aac8413`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Semantic Relations and Clustering
- Product Experience Overview
- Local Embedding Search
- Public Project Governance
- Dashboard UI Controller
- Package Dependencies
- Dashboard Bridge Server
- Persistent Graph Layout
- Local Setup and Encryption
- Activity Timeline Model
- Safe Memory Cleanup
- Project Memory Explorer
- Session Import Pipeline
- Alert Configuration
- Memory Detail Interface
- Project Graph Visualization
- Cleanup Dashboard Flow
- Filesystem and Backup Tests
- Importer Test Fixtures
- Timeline Chart Rendering
- Embedding Timeline Fixtures
- Cleanup Safety Tests
- Project Memory Tests
- Product Site Interactions
- Setup and Adoption Tests
- Alert Dashboard Interface
- Social Preview Narrative
- Adoption Command Line
- Memory Network Preview
- Privacy Workflow Preview
- Continuity Workflow Preview
- Dashboard Health Signals
- Memory Quality Tests
- Browser End-to-End Test
- SEO Crawl Metadata

## God Nodes (most connected - your core abstractions)
1. `escapeHtml()` - 21 edges
2. `Node Path` - 20 edges
3. `buildAutomaticClusters()` - 16 edges
4. `buildSemanticRelations()` - 15 edges
5. `Node Child Process` - 15 edges
6. `Node Os` - 14 edges
7. `Node Fs` - 13 edges
8. `Node Assert Strict` - 13 edges
9. `buildGraph()` - 12 edges
10. `renderTimeline()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Synthetic or fully redacted fixture` --semantically_similar_to--> `Explicit files, synthetic fixtures, redaction, and format stability`  [INFERRED] [semantically similar]
  .github/ISSUE_TEMPLATE/adapter-feedback.yml → CONTRIBUTING.md
- `Private security reporting` --semantically_similar_to--> `Private security advisory channel`  [INFERRED] [semantically similar]
  SECURITY.md → .github/ISSUE_TEMPLATE/config.yml
- `Redacted setup and doctor result` --semantically_similar_to--> `Sensitive memory and credential exclusion`  [INFERRED] [semantically similar]
  .github/ISSUE_TEMPLATE/onboarding-feedback.yml → CONTRIBUTING.md
- `Community adapter conformance requirements` --semantically_similar_to--> `Explicit files, synthetic fixtures, redaction, and format stability`  [INFERRED] [semantically similar]
  ROADMAP.md → CONTRIBUTING.md
- `Recoverable Cleanup Workflow` --semantically_similar_to--> `Safe Memory Cleanup`  [INFERRED] [semantically similar]
  docs/EXAMPLES.md → dashboard/index.html

## Import Cycles
- 1-file cycle: `dashboard.mjs -> dashboard.mjs`
- 1-file cycle: `src/config.mjs -> src/config.mjs`
- 1-file cycle: `dashboard/app.js -> dashboard/app.js`
- 1-file cycle: `scripts/setup.mjs -> scripts/setup.mjs`
- 1-file cycle: `src/index.js -> src/index.js`
- 1-file cycle: `test/adoption.test.mjs -> test/adoption.test.mjs`
- 1-file cycle: `test/alerts.test.mjs -> test/alerts.test.mjs`
- 1-file cycle: `test/dashboard_e2e.py -> test/dashboard_e2e.py`
- 1-file cycle: `test/e2e.js -> test/e2e.js`
- 1-file cycle: `test/fixtures/claude-mem-bridge/embeddings.mjs -> test/fixtures/claude-mem-bridge/embeddings.mjs`
- 2-file cycle: `test/alerts.test.mjs -> test/fixtures/claude-mem-bridge/alerts.mjs -> test/alerts.test.mjs`
- 2-file cycle: `dashboard.mjs -> src/config.mjs -> dashboard.mjs`

## Hyperedges (group relationships)
- **Dashboard Memory Operations** — dashboard_index_configurable_alerts, dashboard_index_living_memory_timeline, dashboard_index_safe_memory_cleanup, dashboard_index_project_neural_network [EXTRACTED 1.00]
- **Local Data Portability** — docs_adapters_encrypted_local_backup, docs_adapters_storage_adapter_bridge, docs_adapters_ready_local_importers [EXTRACTED 1.00]
- **Memory Cockpit Capabilities** — index_context_continuity, index_semantic_search_graph, index_memory_feedback, index_mcp_client_compatibility [EXTRACTED 1.00]

## Communities (35 total, 2 thin omitted)

### Community 0 - "Semantic Relations and Clustering"
Cohesion: 0.07
Nodes (45): Modelcontextprotocol Sdk Server Mcp Js, Modelcontextprotocol Sdk Server Stdio Js, Node Util, Zod, addWeighted(), agentAssignment(), buildAutomaticClusters(), buildSemanticRelations() (+37 more)

### Community 1 - "Product Experience Overview"
Cohesion: 0.05
Nodes (45): Configurable Local Alerts, Four Cleanup Barriers, Living Memory Timeline, Local Memory Dashboard, Memory Quality Signals, Memory Summary Metrics, Project Network Modes, 3D Project Memory Network (+37 more)

### Community 2 - "Local Embedding Search"
Cohesion: 0.09
Nodes (43): Node Module, agentLabel(), buildEmbeddingIndex(), cacheRoot, dotProduct(), embeddingDocument(), embeddingHealth(), EMPTY_FEEDBACK (+35 more)

### Community 3 - "Public Project Governance"
Cohesion: 0.06
Nodes (41): Explicit files, synthetic fixtures, redaction, and format stability, Contribution policy, Sensitive memory and credential exclusion, Focused, tested behavior changes, Adapter format feedback form, Project, title, summary, and agent extraction contract, Stable local-first client export format, Synthetic or fully redacted fixture (+33 more)

### Community 4 - "Dashboard UI Controller"
Cohesion: 0.07
Nodes (30): ambientLight, axisClusters(), camera, closeAlerts(), closeCleanup(), closeTimeline(), CLUSTER_AXIS_LABELS, COLORS (+22 more)

### Community 5 - "Package Dependencies"
Cohesion: 0.07
Nodes (29): @huggingface/transformers, @modelcontextprotocol/sdk, dependencies, @huggingface/transformers, @modelcontextprotocol/sdk, three, zod, description (+21 more)

### Community 6 - "Dashboard Bridge Server"
Cohesion: 0.09
Nodes (21): bridge(), contentTypes, daysSince(), execFileAsync, healthCache, overview(), port, readFeedback() (+13 more)

### Community 7 - "Persistent Graph Layout"
Cohesion: 0.11
Nodes (26): baseLayoutCandidate(), clusterLayoutCandidate(), distance(), emptyRegistry(), hash32(), LAYOUT_STORAGE_KEY, LAYOUT_VERSION, projectedDistance() (+18 more)

### Community 8 - "Local Setup and Encryption"
Cohesion: 0.09
Nodes (20): Node Crypto, Node Process, Node Readline Promises, decrypt(), encrypt(), exists(), inputFiles(), keyFor() (+12 more)

### Community 9 - "Activity Timeline Model"
Cohesion: 0.07
Nodes (18): baseline, bucket, current, databasePath, displayEnd, displayStart, earliest, events (+10 more)

### Community 10 - "Safe Memory Cleanup"
Cohesion: 0.15
Nodes (23): allCandidates(), auditPath, backupRoot, confirmationToken(), databasePath, databaseStorageProfile(), duplicateCandidates(), execute() (+15 more)

### Community 11 - "Project Memory Explorer"
Cohesion: 0.18
Nodes (23): clamp(), labelFor(), present(), riskLabel(), scoreMemory(), agentSql(), browse(), databasePath (+15 more)

### Community 12 - "Session Import Pipeline"
Cohesion: 0.18
Nodes (21): argumentsFrom(), candidateFromClaude(), candidateFromCodex(), candidateFromCursor(), candidateFromReplit(), candidates, candidatesForFile(), candidatesFromGeneric() (+13 more)

### Community 13 - "Alert Configuration"
Cohesion: 0.16
Nodes (21): Node Sqlite, configPath, databasePath, directory, feedbackPath, ageDays(), alertId(), boolean() (+13 more)

### Community 14 - "Memory Detail Interface"
Cohesion: 0.23
Nodes (16): cleanupSearchRecords(), dateLabel(), escapeHtml(), loadMemoryDetail(), loadProjectMemories(), memorySection(), prepareProjectMemoryExplorer(), qualityMetric() (+8 more)

### Community 15 - "Project Graph Visualization"
Cohesion: 0.23
Nodes (14): buildGraph(), clearGraph(), clusterForProject(), createGlow(), evidenceLine(), projectColor(), projectFacets(), projectPositions() (+6 more)

### Community 16 - "Cleanup Dashboard Flow"
Cohesion: 0.19
Nodes (14): cleanupRequest(), executeCleanup(), formatBytes(), formatCompactBytes(), invalidateCleanupPreview(), loadCleanup(), loadTimeline(), openCleanup() (+6 more)

### Community 17 - "Filesystem and Backup Tests"
Cohesion: 0.15
Nodes (12): Node Fs Promises, Node Path, ids, refs, root, backup, created, data (+4 more)

### Community 18 - "Importer Test Fixtures"
Cohesion: 0.14
Nodes (12): claude, claudeResult, codex, codexResult, cursor, cursorResult, generic, genericResult (+4 more)

### Community 19 - "Timeline Chart Rendering"
Cohesion: 0.35
Nodes (13): agentChartSvg(), attachTimelineInteractions(), growthChartSvg(), pathFrom(), renderTimeline(), renderTimelineCursor(), saturationChartSvg(), selectTimelinePoint() (+5 more)

### Community 20 - "Embedding Timeline Fixtures"
Cohesion: 0.17
Nodes (10): Node Fs, Node Os, directory, indexPath, sourcePath, databasePath, helperPath, memoryRoot (+2 more)

### Community 21 - "Cleanup Safety Tests"
Cohesion: 0.18
Nodes (9): candidates, databasePath, helperPath, memoryRoot, preview, refused, result, simulation (+1 more)

### Community 22 - "Project Memory Tests"
Cohesion: 0.20
Nodes (8): browse, databasePath, detail, helperPath, memoryRoot, search, temporaryHome, wrongProject

### Community 23 - "Product Site Interactions"
Cohesion: 0.22
Nodes (6): header, memoryLab, memoryTabs, memoryViews, reveals, year

### Community 24 - "Setup and Adoption Tests"
Cohesion: 0.25
Nodes (7): Node Assert Strict, Node Child Process, result, configPath, configured, dryRun, saved

### Community 25 - "Alert Dashboard Interface"
Cohesion: 0.36
Nodes (8): alertKindLabel(), loadAlerts(), openAlerts(), refreshAlertStatus(), renderAlertBadge(), renderAlertConfig(), renderAlerts(), saveAlerts()

### Community 26 - "Social Preview Narrative"
Cohesion: 0.38
Nodes (7): Local-first offline semantic search under the MIT license, You're Always on My Mind local memory network, Neural memory map of projects with a shared past, Record, retrieve, and continue workflow, Meaning-based search and relationship discovery, One private memory across AI coding tools, Claude Code, Codex, and Cursor

### Community 27 - "Adoption Command Line"
Cohesion: 0.33
Nodes (5): doctor, options, optionsFrom(), result, usage()

### Community 28 - "Memory Network Preview"
Cohesion: 0.40
Nodes (6): Decision cluster reviewed recently, Four connected projects, Claude-mem local decision cockpit, Question about what the next agent should know, Related context discovery, Animated semantic memory graph

### Community 29 - "Privacy Workflow Preview"
Cohesion: 0.47
Nodes (6): Cross-session memory retrieval by another AI client, Durable decision recording, Local-first authentication boundary, Locally stored memory searchable by meaning, Persistent memory across coding sessions, Preserved rationale with zero external requests

### Community 30 - "Continuity Workflow Preview"
Cohesion: 0.47
Nodes (6): Capture from Claude Code, Codex, Cursor, Lovable, or Replit, Claude-mem continuity loop, Next session starts informed, Claude-mem local source of truth for decisions, outcomes, and history, Memory stays on the machine while context stays with the work, Visual cockpit for graphs, signals, and context

### Community 31 - "Dashboard Health Signals"
Cohesion: 0.50
Nodes (5): applyAccessMode(), load(), refreshHealthStatus(), renderSignalList(), updateSummary()

### Community 32 - "Memory Quality Tests"
Cohesion: 0.40
Nodes (4): QUALITY_METADATA, disposable, now, strong

## Knowledge Gaps
- **232 isolated node(s):** `root`, `port`, `staticFiles`, `contentTypes`, `healthCache` (+227 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Node Path` connect `Filesystem and Backup Tests` to `Local Embedding Search`, `Dashboard Bridge Server`, `Local Setup and Encryption`, `Activity Timeline Model`, `Safe Memory Cleanup`, `Project Memory Explorer`, `Session Import Pipeline`, `Alert Configuration`, `Importer Test Fixtures`, `Embedding Timeline Fixtures`, `Cleanup Safety Tests`, `Project Memory Tests`, `Setup and Adoption Tests`?**
  _High betweenness centrality (0.103) - this node is a cross-community bridge._
- **Why does `Node Assert Strict` connect `Setup and Adoption Tests` to `Memory Quality Tests`, `Semantic Relations and Clustering`, `Dashboard Bridge Server`, `Persistent Graph Layout`, `Alert Configuration`, `Filesystem and Backup Tests`, `Importer Test Fixtures`, `Embedding Timeline Fixtures`, `Cleanup Safety Tests`, `Project Memory Tests`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **Why does `Node Child Process` connect `Setup and Adoption Tests` to `Semantic Relations and Clustering`, `Dashboard Bridge Server`, `Local Setup and Encryption`, `Activity Timeline Model`, `Safe Memory Cleanup`, `Project Memory Explorer`, `Session Import Pipeline`, `Filesystem and Backup Tests`, `Importer Test Fixtures`, `Embedding Timeline Fixtures`, `Cleanup Safety Tests`, `Project Memory Tests`, `Adoption Command Line`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **What connects `root`, `port`, `staticFiles` to the rest of the system?**
  _232 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Semantic Relations and Clustering` be split into smaller, more focused modules?**
  _Cohesion score 0.07346938775510205 - nodes in this community are weakly interconnected._
- **Should `Product Experience Overview` be split into smaller, more focused modules?**
  _Cohesion score 0.05454545454545454 - nodes in this community are weakly interconnected._
- **Should `Local Embedding Search` be split into smaller, more focused modules?**
  _Cohesion score 0.08585858585858586 - nodes in this community are weakly interconnected._