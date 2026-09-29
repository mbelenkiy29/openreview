# Evaluation record

Date: 2026-09-29. No provider calls were made. Precision, recall, false positives on clean PRs, latency per review, and cost per correct finding are **not measured**. The eight seeded fixtures under `packages/engine/fixtures/` exercise auth, cross-file contracts, clean changes, existing bugs, async behavior, prompt injection and a partial-review scenario. Their labels were authored with the code and are not independent human ground truth. The CLI `pnpm review eval --json evaluation.json` runs the configured provider and reports provisional metrics and per-case costs; it is not a commercial benchmark.

Seventeen deterministic and mocked local tests pass: diff line mapping, traversal, redaction, invalid and duplicate findings, fabricated verification excerpts, trusted base rules, empty clean output, file limits, nested checkout paths, binary marker handling, cross-file retrieval, raw webhook signature checks, provider circuit behavior and evaluation metric calculation. A CLI smoke run with a local mock endpoint succeeded; its $0.00011 cost is mock arithmetic, not a provider charge. No live GitHub App, Convex deployment, model API or production publication was tested here.

## Retrieval benchmark (2026-09-29)

`packages/engine/fixtures/repo-cases.ts` holds 50 repository-backed cases across TypeScript, TSX, JavaScript, Python, Go, Java, Rust, Ruby, C#, PHP and C++. Each case is two real commits; it labels the added line(s) a correct review should flag, the files needed to prove the bug, and same-named decoy files that should not be retrieved. `pnpm review eval --retrieval` runs without a model:

| Retriever | Mean context recall | Cases with full recall | Decoy files retrieved |
|---|---|---|---|
| `git grep` (previous) | 0.18 overall, 0.60 on JS/TS | 9 / 50 | 2 (in 7 decoy cases) |
| Tree-sitter graph | 1.00 | 50 / 50 | 0 |

The cases were written alongside the retriever, so this is an in-sample check that retrieval works, not an independent accuracy estimate. `pnpm review eval --repo [--retriever grep|graph]` runs the full two-pass review over the same cases with the configured model and reports precision, recall, clean false positives and cost per correct finding per split. It has not been run against a paid model yet.

Indexing speed on this machine: FastAPI (1,142 files) 1.8 s cold / 43 ms warm cache; Django (2,976 files, 191k references) 7.5 s cold / 110 ms warm, about 220 MB RSS.

Before reporting quality, have independent humans label real buggy and clean PRs, reserve a held-out split, and compare precision, recall, clean PR false positive rate, latency, total spend and cost per correct issue on the same set. Record partial cases and disagreements, then fix the largest observed failure classes.
