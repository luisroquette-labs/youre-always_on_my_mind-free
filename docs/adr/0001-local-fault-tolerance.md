# Local configuration and fault tolerance

## Context

This application reads personal memory from local files and a local bridge. Feedback files are append-only and can end with a partial record after interruption. The dashboard also reads browser storage and the bridge while another process may hold a short SQLite lock.

## Decision

Runtime paths come from environment variables, with local defaults. Malformed feedback records are skipped so an interrupted append does not hide earlier records. Invalid or unavailable browser storage resets the layout to deterministic coordinates. A failed health refresh keeps the last known dashboard state until the next refresh.

## Consequences

No account or remote configuration is required. A malformed feedback record is not shown, and dashboard health can briefly be stale. A user whose browser storage is unavailable receives the default layout.
