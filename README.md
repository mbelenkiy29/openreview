# OpenReview

An experimental, Apache-2.0, self-hostable GitHub pull request reviewer. It has a local TypeScript engine, a Convex job backend, a Docker worker, and a Next.js dashboard. It posts advisory findings only. **Accuracy and production reliability are not yet established; do not assume parity with commercial reviewers.**

## Local review

Install Node 24, pnpm 11, Git and ripgrep. Copy `.env.example` to `.env`, configure either an OpenAI-compatible endpoint or Anthropic, and load the variables in your shell. No Convex deployment is needed for the CLI.

```sh
pnpm install
pnpm build
pnpm test
pnpm review local origin/main HEAD --json review.json --markdown review.md
pnpm review eval --json evaluation.json
```

`pnpm review pr OWNER/REPO 123 --json review.json` is a dry run in the current checkout. Set `GITHUB_TOKEN` with repository read access and fetch the PR base and head commits first; it never posts to GitHub. The evaluation runner calls the configured model on eight seeded development/held-out examples. These labels require human review before any quality claim.

## GitHub App installation

1. Create a Convex Cloud project or deploy the [official self-hosted Convex backend](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md). Run `pnpm exec convex dev` for Cloud, or configure `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` before deploying functions for self-hosting. Run `pnpm exec convex codegen` after connecting. Configure `GITHUB_WEBHOOK_SECRET` and `WORKER_SECRET` on Convex. The Convex admin key belongs only in your deployment shell, never in a browser or worker.
2. Register a GitHub App using `deploy/github-app-manifest.json`. Replace the dashboard and Convex site URLs. Grant **Contents: read**, **Pull requests: write**, and subscribe to `pull_request`, `issue_comment`, `installation` and `installation_repositories`. Use a random webhook secret matching Convex. Generate a private key, base64-encode it, and set `GITHUB_APP_ID` and `GITHUB_PRIVATE_KEY_BASE64` on the worker. Install the App on selected repositories only.
3. Set the worker's `CONVEX_SITE_URL`, `WORKER_SECRET`, model endpoint/key/model, input and output token prices, `SERVER_MAX_REVIEW_USD`, and `SERVER_MONTHLY_USD`. Run `docker compose up --build -d`. The worker must reach GitHub, Convex and the chosen model endpoint.
4. Register a separate GitHub OAuth App for dashboard sign-in. Set its callback to `https://YOUR-DASHBOARD/api/auth/callback/github` (local: `http://localhost:3000/api/auth/callback/github`). Set `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_SECRET`, `AUTH_URL`, `CONVEX_SITE_URL` and `WORKER_SECRET` on the dashboard. Open the dashboard and sign in. The server checks GitHub repository visibility before showing review data.
5. Open a non-draft PR against a selected repository. Watch `docker compose logs -f worker`, the Convex `jobs` table, the PR summary and the dashboard. Push another commit to exercise incremental review. A repository writer can comment `/openreview review`, `/openreview deep`, or `/openreview explain Why is this risky?`. Repository admins can pause reviews and lower per-review and monthly budgets on the dashboard.

The connected [Vercel preview](https://openreview-emzwpp08x-michael-belenkiys-projects.vercel.app/) serves the dashboard UI. It does **not** activate reviewing until the Convex, GitHub App, worker, OAuth and model settings above are configured. GitHub OAuth sign-in and GitHub App installation are separate.

## Configuration

Copy `.openreview.example.yml` to `.openreview.yml` in the base branch. The engine reads this file from the trusted base revision, so a PR cannot weaken the rules for its own review. Schema validation rejects invalid values. Dashboard budgets and operator server caps override `budgetUsd` by taking the lower limit; server file/input caps also apply. Operator environment variables choose credentials, endpoints, token prices and model IDs; the repository file cannot set secrets. `mode` selects optional `*_MODEL_ECONOMY`, `*_MODEL_BALANCED` or `*_MODEL_DEEP` variables, falling back to the default model. `pathStandards` is untrusted review guidance, never authority to run code or access tools. The worker currently uses at most two model calls per review. Large, deleted, generated and binary content is reported as omitted or excluded.

The model receives selected diff hunks, bounded before/after source, path standards, nearby references and the follow-up question if asked. It does not receive repository secrets intentionally. If you configure a hosted provider, that provider receives this code even though the app is self-hosted. Use a local compatible endpoint when inference must stay local. No repository code, package hooks or tests execute during review.

## Operations

- **Back up:** use Convex's deployment backup/export procedure for jobs, feedback, and budgets. Back up your own worker and dashboard configuration secrets separately; repository snapshots are temporary and are removed after a job.
- **Restore:** restore Convex data and redeploy the same `convex/` functions, then restart the worker. Verify the webhook secret and App installation before accepting new deliveries.
- **Update:** pull a tagged source revision, run `pnpm install --frozen-lockfile && pnpm test && pnpm build`, deploy Convex functions, and rebuild the Compose services. Take a backup before schema changes.
- **Retention:** POST `{"days":90}` to `/worker/prune` with `Authorization: Bearer $WORKER_SECRET`; repeat until old rows are removed. Jobs in progress remain. Delivery IDs are pruned after the same interval.
- **Delete an installation's stored reviews:** uninstall the GitHub App first, then POST `{"installation":12345}` to `/worker/delete-installation` using the worker secret, repeating while the response says `more:true`. This deletes jobs, feedback, reservations and installation budgets. Delivery IDs age out through retention.

The application has no telemetry requirement or paid authentication dependency. The separately deployed Convex backend has an optional beacon; use its documented `--disable-beacon` flag if you want to turn that off. See [architecture](docs/ARCHITECTURE.md), [threat model](docs/THREAT_MODEL.md), [evaluation](docs/EVALUATION.md), [preview setup](docs/PREVIEW_SETUP.md), [notices](NOTICE.md), and [security policy](SECURITY.md).

## Current limits

The verifier checks source excerpts, changed lines and a model challenge, but it cannot prove semantic correctness. JavaScript/TypeScript get AST symbol retrieval; JSON/YAML receive basic text review, and other languages currently receive incomplete coverage. Command and publication flows have not been exercised against a real installation. No live model cost, precision or recall has been measured. External GitHub publication cannot be atomically fenced with a Convex lease; a head push between the final check and API call can still race. Use a disposable repository first.
