# Preview deployment setup

The dashboard can be deployed to Vercel with the project root directory set to `apps/web`. Use Next.js framework detection and the `pnpm` workspace lockfile. Add `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_URL`, `CONVEX_SITE_URL` and `WORKER_SECRET` as server environment variables. `AUTH_URL` must match the preview URL used by the GitHub OAuth callback; for stable sign-in, assign a stable preview alias or domain.

Creating a page preview alone does not run the PR reviewer. For repository tests, deploy the Convex functions, set the webhook secret in Convex, run the Docker worker with GitHub App credentials and model pricing, register a GitHub App with the Convex webhook URL, and install the app on a selected test repository. Keep App keys, webhook secret, model keys and worker secret out of Vercel client bundles and GitHub commits. See README for the full sequence.

The GitHub OAuth App for dashboard sign-in and the GitHub App for PR events are separate registrations. Start with a disposable repository because external publication fencing and semantic correctness remain unproven.
