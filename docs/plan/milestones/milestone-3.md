## Milestone 3: Reporting, Validation, Perf Tuning, Docs

### Objective

- Deliver reporting queries, validation suite, and performance tuning for ingestion and reads.

### Acceptance Criteria

- CLI or scripts generate percentile tables and segment-aware distributions for a time window.
- Domain↔consensus latency distributions are computed by joining on `consensus_block_hash`.
- Parquet partitions meet size targets and queries run within expected time bounds.
- Documentation enables a new developer to run end-to-end locally.

### Atomic Commit Plan

1. feat(reporting): add DuckDB SQL for core reports

   - add `scripts/duckdb/report_block_time_distributions.sql`
   - add `scripts/duckdb/report_segment_impact.sql` (segment header true vs false)
   - add `scripts/duckdb/report_domain_consensus_latency.sql`

2. feat(cli-report): optional Node CLI wrapper for reports

   - add `src/bin/report.ts` to run parameterized DuckDB queries and print tables/CSV

3. qa(consistency): re-run short backfill and compare with stream output

   - add `scripts/duckdb/compare_stream_backfill.sql`
   - document acceptable variance (none for confirmed range)

4. perf(write): tune batch sizes and rotation thresholds

   - add metrics logging around flush latencies and rows/sec
   - document recommended defaults and how to adjust

5. perf(read): verify partition pruning and row-group sizes

   - add `scripts/duckdb/profile_query.sql` to show I/O and time
   - document expected ranges and troubleshooting tips

6. docs(runbook): finalize runbooks and troubleshooting

   - consolidate `docs/runbook/*.md` and add FAQ
   - update `docs/README.md` and `docs/plan/phase-1-block-times.md` with links

7. chore(tag): prepare v0.1.0 notes
   - add `CHANGELOG.md` with highlights and known limitations
