# Architecture

GitHub webhook → Convex HTTP action (HMAC verification) → atomic intake mutation → leased job → Docker worker → isolated Git fetch → engine/model → GitHub comments → Convex completion. The CLI invokes the same engine without Convex. The job key includes installation, repository, PR, head and a static configuration version. Leases use a fencing number for completion, but the external GitHub publication is not fenced atomically. A worker that loses its lease may still publish; fix this before production use.

The engine accepts a file diff and model adapter. It limits file count, bytes and prompt length. The current implementation does not yet retrieve callers, symbols or test relationships. It filters candidates by schema, severity and actual added lines. That establishes location, not correctness.

The worker stores temporary checkouts under system temp and deletes them after each job. No repository code is executed. Git hooks are disabled, submodules are not fetched, and model prices are operator supplied. Git fetch currently receives scoped installation credentials through environment Git config. Model keys remain in worker environment. The dashboard uses Auth.js GitHub OAuth; its server checks GitHub repository visibility before returning Convex job data. The dashboard never receives a Convex administrator credential.
