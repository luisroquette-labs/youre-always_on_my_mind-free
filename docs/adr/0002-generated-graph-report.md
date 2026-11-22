# Generated graph report comment debt

## Context

`graphify-out/graph.html` is a generated report from Graphify. It contains 23 comment lines, including a security explanation for delegated neighbor links and geometric explanations for rendering hyperedges. Editing only the generated copy would be lost on regeneration.

## Decision

Keep the 23 existing comment lines under a per-file lint ceiling until the Graphify producer is changed. The report already escapes node IDs in HTML attributes and uses a delegated event listener to avoid injecting untrusted IDs into inline handlers. Its hull calculation follows perimeter order to avoid crossed fills.

## Consequences

The source files have a zero-comment rule. Regenerating the report cannot increase the comment count; eliminating this remaining debt requires a change in the producer and then lowering the ceiling to zero.

The five commented configuration examples were moved to the README. Only the generated report retains comment debt.
