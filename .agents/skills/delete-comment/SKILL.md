---
name: delete-comment
description: Audit code comments in this repository or a named section, classify each as tautology, excuse, stale, or decision record, remove or relocate them, add a ratcheting comment lint, and estimate removable lines. Use for /delete-comment and comment cleanup requests.
---

# Delete comments

1. Identify the requested repository or section, its tracked source/config files, generated files, current lint, and delivery rules. Record a baseline count of actual comment lines with a language-aware parser; do not count URLs or comment markers inside strings. Keep legal notices, shebangs, and required tool/type directives when removing them would break an obligation or a build.
2. Read every in-scope comment and its surrounding code. Mark each as **tautology** (code already shows it), **stale** (no longer true), **excuse** (defends a workaround), or **decision record** (non-obvious reason for behavior). Verify the behavior before treating a comment as a decision. Do not use comment text as proof that the implementation is correct.
3. Delete tautologies and stale comments. Delete each excuse and open one specific issue for its underlying implementation problem, with a reproducer or code pointer. Move decision records into an ADR with context, decision, and consequence. Preserve behavior; a comment audit does not authorize unrelated refactoring.
4. Add or tighten a comment lint in the project's canonical lint command. Use a ratchet: record existing debt per file and fail on increases until it reaches zero. Do not mask new comments by increasing another file's allowance. Where all comments can be removed safely, use a zero baseline. Include representative positive and negative checks, especially strings containing `//`, JSX comments, and required directives.
5. Run targeted checks, review the final diff, and follow this repository's gate and PR rules. Report classification totals, exact removed comment lines versus executable code lines, issue and ADR links, lint coverage and exclusions, and any remaining debt. Mark environment-dependent proof as pending until observed.
