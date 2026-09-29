# OpenReview → Greptile-parity plan (cheap and accurate)

## Context
OpenReview (`/home/user/openreview`) is an alpha, self-hostable GitHub PR reviewer: TypeScript/pnpm monorepo, Convex (DB + job queue), a polling worker, a Next.js dashboard and raw-fetch LLM adapters (Anthropic + OpenAI-compatible). The goal is to match Greptile's features and accuracy at a fraction of the cost. Greptile's feature list comes from its docs, pulled through Context7 (`/websites/greptile`): code-review config reference, nitpicks/learning, memory, graph-based context, MCP v2, self-host.

## Gap matrix (Greptile feature → OpenReview status)

| Greptile feature | OpenReview today | Gap |
|---|---|---|
| **Graph-based full-codebase context** (parse all files → entities → relationships → stored graph, queried at review time) | Per-job shallow clone; TS-compiler symbols near changed lines (`packages/engine/src/context.ts` `changedSymbols`); `git grep` text search (`gatherContext`); JS/TS only | **Biggest gap** |
| Multi-language support | Only `.ts/.tsx/.js/.jsx/.json/.yml` reviewed (`engine/src/index.ts` ~L51) | Missing |
| Inline comments with severity | Yes; fingerprint markers, added-line check (`apps/worker/src/index.ts` L58-64) | ✅ |
| Suggested-change blocks (```suggestion```) | Prose fix only | Missing |
| PR summary: text summary, **confidence score**, issue table, **sequence diagram (mermaid)**; each section included/collapsible/defaultOpen | Bulleted findings list plus cost | Mostly missing |
| `greptile.json`: `strictness` 1-3, `commentTypes` (logic/syntax/style/info), `triggerOnUpdates`, `ignorePatterns`, `instructions`, `rules[{id,rule,scope,severity}]`, `disabledRules`, `context.repos`, nested/child configs | `.openreview.yml` zod `Config`: mode, ignore, pathStandards, severityThreshold, commentLimit, budget (read from trusted base ✅) | Partial |
| Learning from 👍/👎 reactions and replies; memory that suppresses nitpicks the team ignores | Dashboard feedback stored in `feedback` table, never used | Missing (the core loop) |
| Infer team standards from past PR comments | — | Missing |
| Incremental review on new commits | Yes (`latestSuccess`, ancestor check, supersede) | ✅ |
| `@bot` chat in PR threads | `/openreview explain` single answer | Partial |
| Codebase Q&A API + **MCP server** (`/mcp`, bearer API key) | — | Missing |
| CLI / headless review | `apps/cli` local + dry-run PR | Partial (no API-key headless mode) |
| GitHub + GitLab (cloud and self-managed) | GitHub only | GitLab missing |
| Multi-repo context (`context.repos`) | — | Missing |
| Orgs/teams, seats, billing, analytics | Keyed by installation; no Stripe; basic dashboard | Missing |
| Slack / Jira / Linear context | — | Missing (low priority) |
| Self-host (Docker/K8s) | Compose + Dockerfiles ✅ | ✅ (K8s later) |

**Already ahead of or at parity with Greptile:** budget reservations, circuit breaker, adversarial verification pass with evidence excerpts, secret redaction, trusted-base config, eval harness skeleton. Keep these.

## Cost strategy ("cheap but just as accurate")
1. **Graph + lexical retrieval first, embeddings second.** A tree-sitter symbol/call/import graph plus ripgrep/BM25 finds callers and callees exactly, with no embedding cost. Embed only per-file/per-symbol *summaries*, and only for Q&A/MCP (cheap model, generated once per changed file).
2. **Incremental indexing:** re-parse only the files changed since the last indexed SHA; store the graph keyed by `(repo, blob sha)` so unchanged blobs are never re-parsed.
3. **Tiered models:**
   - A cheap model (e.g. Haiku-class) does triage, file ranking, PR summary and mermaid.
   - A strong model runs only on high-risk hunks.
   - The existing verification pass stays on the cheap model.
4. **Prompt caching:** put the stable content first (repo instructions, rules, memories, graph context) with Anthropic `cache_control`; the diff goes last.
5. **Skip work:** trivial PRs (docs, lockfiles, generated files) get a summary only; `triggerOnUpdates` defaults to incremental.
6. **Measure:** extend `packages/engine/src/evaluation.ts` to report cost per correct finding. Every change must hold or improve precision/recall on a held-out set.

## Phased roadmap

### Phase 1: Accuracy core (codebase graph)
- New package `packages/indexer`:
  - `web-tree-sitter` WASM grammars for TS/JS, Python, Go, Java, Rust, Ruby and C#.
  - Extract definitions, references, imports and call sites.
  - Resolve imports per language (tsconfig paths, Python modules, Go packages).
- Storage in Convex:
  - `symbols`, `edges` (calls/imports/extends) and `indexState` (repo, sha).
  - Convex's built-in vector index for optional summary embeddings, so no new infrastructure is needed.
  - Large repos: the worker keeps a persistent bare mirror on a volume (replacing the current tmpfs-only clone).
- Replace `gatherContext` in `context.ts`. For each changed symbol, collect:
  - callers (1-2 hops) and callees;
  - the implemented interfaces/types;
  - tests that reference it;
  - the files that co-change with it (from git log).
- Keep the character budget and rank by graph distance plus risk score.
- Remove the language whitelist; review every language that has a grammar.

### Phase 2: Review output parity
- **Config:** extend the zod `Config` in `engine/src/index.ts`:
  - `strictness`, `commentTypes`, `rules[]` with id/scope/severity, `disabledRules`, `instructions`, `summarySection`/`issuesTable`/`confidenceScore`/`sequenceDiagram` toggles, `context.repos`;
  - nested per-directory configs (child configs override the parent);
  - accept `greptile.json` as an alias to ease migration.
- **Summary comment:**
  - a written summary of the PR;
  - a 0-5 confidence score (computed from the verified findings' severities plus coverage);
  - a table of changed files and their issues;
  - a mermaid sequence diagram built from the call-graph edges touched by the diff (cheap model);
  - collapsible `<details>` sections.
- **Comments:** emit GitHub ```suggestion``` blocks when a fix is a single-hunk replacement; add a per-comment confidence value; add a `commentType` label.
- **PR description:** optionally generate or fill in an empty PR body.

### Phase 3: Learning loop (Greptile's differentiator)
- **Capture:**
  - GitHub sends no reaction webhooks, so the worker polls reactions on its own comments at each re-review plus on a daily cron.
  - Capture `pull_request_review_comment` replies and "resolved" thread state.
  - Detect "addressed": the commented line changed in a later commit.
- **Memory:**
  - A `memories` table: rule text, scope glob, polarity (suppress/enforce), evidence count, repo/org.
  - A cheap model clusters 👎/ignored findings into suppress-memories and 👍/addressed ones into enforce-memories.
  - Memories go into the cached prompt prefix, and verification filters on them.
- **Infer standards:** a one-time job reads the last N merged PRs' human review comments and proposes rules for an admin to approve in the dashboard.

### Phase 4: Interaction surfaces
- `@openreview` conversational replies in review threads, using graph retrieval.
- Q&A API `POST /v1/query` (graph + summary-embedding retrieval), keyed by per-org API keys.
- MCP server (streamable HTTP, `/mcp`) with tools `search_code`, `get_symbol`, `review_diff`, `list_findings`, `get_memories`.
- Headless CLI review using an API key (mirrors Greptile's `/v1/headless-review`).

### Phase 5: SaaS layer
- **Orgs and access:** orgs/members/roles in Convex, mapped to GitHub orgs, with seat counting.
- **Billing:** Stripe per seat or per reviewed PR, metered through the existing `budgets`/`reservations` tables.
- **Dashboard:** rules and memories editor, repo onboarding with indexing progress, analytics (comments addressed %, 👍/👎 ratio, cost per PR).
- **Hardening:** fix `recent` (it currently takes the global top 100 and filters per user; it should be scoped per org), rate limiting on API routes, and the publication outbox noted in `docs/DECISIONS.md`.

### Phase 6: Reach
- GitLab provider behind a `CodeHost` interface. Extract the GitHub calls from `apps/worker/src/index.ts` and the webhook handler in `convex/http.ts`.
- Slack notifications; Jira/Linear ticket context in the summary.
- Helm chart.

## Critical files
- `packages/engine/src/index.ts`: Config, pipeline, prompts, model adapters, language filter.
- `packages/engine/src/context.ts`: to be replaced by graph retrieval.
- `packages/engine/src/evaluation.ts` and `fixtures/cases.json`: grow into a real benchmark.
- `apps/worker/src/index.ts`: indexing job, reactions polling, publishing summaries and suggestions.
- `convex/schema.ts`, `convex/jobs.ts`, `convex/http.ts`: new tables and routes.
- `apps/web/app/dashboard.tsx`: rules, memories, analytics.

## Verification
- **Per phase:** `pnpm -r test` (vitest). New fixture tests build temporary git repos in several languages and assert that graph edges and retrieved callers are correct.
- **Accuracy:**
  - Grow `fixtures/cases.json` to 50+ real-bug cases, for example from public benchmarks of PR bugs.
  - Run `pnpm review eval` before and after each phase.
  - Track precision, recall, clean-PR false positives and cost per correct finding against a Greptile baseline on the same PRs.
- **End to end:** install the GitHub App on a test repo, open PRs with seeded bugs, and confirm:
  - inline comments, suggestion blocks and the summary (confidence, table, mermaid) render;
  - 👎 reactions suppress similar comments on the next PR;
  - the MCP endpoint answers `ping` and `search_code`.
