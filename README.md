# OpenReview (experimental)

Open source pull request review application in alpha. The CLI analyzes a local diff with Anthropic or an OpenAI compatible model. The GitHub App webhook creates Convex jobs, a Docker worker checks out commits and posts advisory comments, and a Next.js dashboard shows review history to GitHub users with repository access. **Do not deploy this on sensitive repositories yet:** model outputs receive location and schema checks, but semantic verification and reliable external publication fencing remain unfinished.

## Local quick start

Node 24, pnpm 11, Git and a model API key are required. Copy `.env.example` to `.env`, set `OPENAI_API_KEY` and `OPENAI_MODEL` (or Anthropic equivalents), and load it into your shell without committing it. Set explicit model token prices before running the worker; the CLI can report unknown prices.

```sh
pnpm install
pnpm test
pnpm build
pnpm review local origin/main HEAD --json review.json --markdown review.md
```

For a GitHub PR dry run, fetch both revisions into the current repository, set `GITHUB_TOKEN` with read access, then run `pnpm review pr OWNER/REPO 123`. The CLI never publishes comments. `pnpm review eval` currently reports that human labeled evaluation is pending.

## GitHub App experimental setup

1. Create a Convex deployment and run `pnpm exec convex dev` to generate `convex/_generated` and deploy the schema and HTTP actions. Configure `GITHUB_WEBHOOK_SECRET` and `WORKER_SECRET` as Convex environment variables.
2. Create a GitHub App using the permissions and events in `deploy/github-app-manifest.json`. Set its webhook URL to `https://YOUR-CONVEX-SITE.convex.site/github/webhook` and the same webhook secret. Install on selected repositories.
3. Separately create a GitHub OAuth App for dashboard sign in. Its callback is `https://YOUR-DASHBOARD-DOMAIN/api/auth/callback/github` (local: `http://localhost:3000/api/auth/callback/github`). Set `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_SECRET` and `AUTH_URL` on the web service.
4. Generate a GitHub App private key and configure `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY_BASE64`, `CONVEX_SITE_URL`, `WORKER_SECRET`, model endpoint/key/model and both model prices on the worker. Set `SERVER_MAX_REVIEW_USD` and `SERVER_MONTHLY_USD`.
5. Run `docker compose up --build`. Open `http://localhost:3000`, sign in, then open a non-draft PR in an installed repository. Inspect the Convex `jobs` table, dashboard and PR summary. Use a disposable repository until the outstanding protections are completed.

For self hosted Convex, first deploy the official [Convex backend and dashboard](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md), create its admin key, set `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` locally for Convex code deployment, and point the OpenReview worker and dashboard to its HTTP action site URL. Keep the backend admin key only in the deployment environment, never the browser. The official backend runs separately from this Compose file. This route has not been end-to-end verified here.

## Configuration and precedence

`.openreview.yml` is parsed from the trusted base by the CLI and worker. The worker caps per-review budget with `SERVER_MAX_REVIEW_USD` and enforces a monthly installation limit with `SERVER_MONTHLY_USD`. Other repository settings are not yet constrained by server policy. Never put secrets in repository configuration. Only JavaScript/TypeScript and JSON/YAML files are selected; other languages are currently excluded and coverage is marked partial. Source snippets, diffs and selected before/after text are sent to your configured model provider. A local compatible endpoint keeps inference local only if that endpoint runs locally.

## Limitations

The alpha lacks commands, incremental context, force push fallback, rigorous semantic verification, full duplicate comment reconciliation across pagination, retained snapshot policy, comprehensive operational tests, and human labeled quality evidence. Model budget reservations use configured maximum tokens, but pricing can change and failed calls conservatively consume their full reservation. Cost is unknown in CLI output unless input/output prices are configured; no measured model costs or accuracy claims are available. Do not infer that an empty result means a comprehensive clean review.

See [architecture](docs/ARCHITECTURE.md), [threat model](docs/THREAT_MODEL.md), [decisions](docs/DECISIONS.md), and [evaluation record](docs/EVALUATION.md).
