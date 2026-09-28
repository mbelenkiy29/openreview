# Evaluation record

Date: 2026-09-28. No external model calls or human labeled evaluation were run. Finding precision, recall, false positive rate, latency and cost per correct issue are **not measured**.

Local deterministic and mocked checks cover added line mapping, traversal rejection, schema and location filtering, duplicate fingerprints, trusted base configuration, a clean diff with empty mock output, and a truncated review. Six tests passed after the dashboard update. The mock cost of $0.0001 is fixture input, **not a measured provider bill**.

Before quality claims, assemble separate development and held out PRs with human labeled defects and clean examples, run the same model configuration over both sets, and compute precision, recall, clean PR false positive rate, latency, total spend and spend per true positive. Preserve labels and rejected candidates without exposing private source.
