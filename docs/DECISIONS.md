# Decisions and checklist

The engine accepts a prepared diff, source snapshots and a model adapter; neither GitHub nor Convex is imported into it. Convex mutations own delivery deduplication, leases, publication fencing and budget reservations. The worker owns checkout, model access and GitHub publishing. The GitHub App installation token scopes repository access. Repository configuration from the trusted base is validated and constrained by server policy.

- [x] Local engine, bounded discovery and verification, AST reference retrieval and fixture tests
- [x] Convex state, claims, leases, deduplication and per-call reservations (deployment unverified)
- [x] GitHub webhook, commands and worker source integration (live installation unverified)
- [ ] Production GitHub App and Convex deployment verification (credentials needed)
- [ ] Human labeled quality evaluation at useful scale
- [x] Authenticated dashboard with repository access checked server-side
- [x] Feedback records for individual findings, without automatic global rules
- [ ] Durable external publication fencing and full human-labeled quality evaluation
