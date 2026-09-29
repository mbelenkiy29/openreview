# Preview deployment setup

The dashboard deploys to Vercel with the project root directory set to `apps/web`, Next.js framework detection and the `pnpm` workspace lockfile. Every push to a branch creates a preview; the stable alias for this branch has the form `openreview-git-<branch>-<team>.vercel.app`.

## Playground (`/playground`)

The playground runs the reviewer inside a Vercel function against any GitHub pull request URL. It needs no Convex, worker or GitHub App, and it never posts to GitHub.

- **Context only** (free): downloads the PR head as a tarball, builds the tree-sitter code graph and shows the cross-file context (callers, callees, tests, importers) that a review would send to the model, plus indexing stats.
- **Full review**: runs the two-pass review and shows the summary comment and inline comments exactly as they would be posted, with the raw markdown.
- **Show sample output**: a fixed example rendered by the real formatter, labelled as a sample.

The playground cannot see git history, so co-changed files are not used there.

### Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Needed for | Notes |
|---|---|---|
| `PLAYGROUND_GITHUB_TOKEN` | Reliable runs, private repos | A fine-grained token with read-only *Contents* and *Pull requests* access. Anonymous GitHub API calls from Vercel are usually rate-limited. |
| `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL` (or `OPENAI_API_KEY` + `OPENAI_MODEL` [+ `OPENAI_BASE_URL`]) | Full review | A small, cheap model is fine for testing. |
| `MODEL_INPUT_USD_PER_MILLION`, `MODEL_OUTPUT_USD_PER_MILLION` | Full review | Your model's prices; used for the spend cap and the cost shown. |
| `PLAYGROUND_MAX_REVIEW_USD` | Optional | Per-run cap, default 0.25 (max 5). A run also makes at most two model calls. |
| `PLAYGROUND_ALLOW_ANONYMOUS_REVIEW=true` | Full review without sign-in | Only when the deployment is protected (Vercel Authentication is on for previews by default). Otherwise set up sign-in below. |

Redeploy after changing variables.

## GitHub sign-in (dashboard, and full review without the anonymous flag)

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. Homepage URL: your stable alias. Authorization callback URL: `https://<stable-alias>/api/auth/callback/github`.
2. In Vercel set `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET` from that app, `AUTH_SECRET` to a random value (`openssl rand -base64 32`) and `AUTH_URL=https://<stable-alias>`. Per-commit preview URLs change, so always sign in through the stable alias.

Without these variables the home page shows that sign-in is not configured and links to the playground.

## Full GitHub App flow

A page preview alone does not review pull requests on GitHub. For that, deploy the Convex functions, set the webhook secret in Convex, run the Docker worker with GitHub App credentials and model pricing, register a GitHub App with the Convex webhook URL, and install the app on a test repository. Keep App keys, webhook secret, model keys and worker secret out of Vercel client bundles and GitHub commits. See README for the full sequence. The GitHub OAuth App for dashboard sign-in and the GitHub App for PR events are separate registrations. Start with a disposable repository because external publication fencing and semantic correctness remain unproven.
