# Changelog

## 0.3.0

English cockpit, fictional demo data, and a read-only reader for the current claude-mem database. Not a published release.

- The dashboard defaults to English, including labels, alerts, cleanup, and errors. Portuguese stays available with the EN / PT switch or `?lang=pt`.
- `npm run dashboard -- --demo` and `?demo=1` serve fictional projects (Northwind Atlas, Lumen Ledger, and the rest). Demo deletes are not written to disk.
- The built-in reader opens `~/.claude-mem/claude-mem.db` when no external bridge is configured. It follows the current observations schema, including databases without `agent_type`. Deletes are refused so claude-mem keeps ownership of the file. The cockpit is positioned as a complement to claude-mem's own `/viewer`, not a replacement, and states that it is not affiliated with claude-mem.
- `scripts/install.sh` is a one-command install. It opens demo data when no local database exists. `npx` can run the `youre-always-on-my-mind` bin from a GitHub install.
- App icon at `assets/brand/icon.svg` and `assets/brand/icon-240.png`.
- Product Hunt stills and a short walkthrough live in `docs/ph/`.

## 0.2.0

Local graph, semantic search, quality signals, safe cleanup, importers, setup assistant, and encrypted backup export.
