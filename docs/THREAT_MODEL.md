# Threat model

Untrusted sources include webhook payloads before HMAC verification, PR code and comments, model output and repository settings. Webhook HMAC uses the raw body and checks signatures before durable intake. Worker API uses a shared secret; rotate it if exposed. The GitHub App token is scoped to one installation repository. Keep the worker off public networks and prevent untrusted PR code from executing.

Open issues: reviewer prompt injection can still distort model output; semantic evidence is not verified; symlink escapes and large diffs need more exhaustive testing; external comment publication can race expired leases. Budget reservations occur before the model call but are based on configured prices, which may differ from provider bills. Do not use this alpha with private or regulated source until these are addressed.
