## Phase 1 Plan: Block Times (Consensus + Auto-EVM)

### Scope

- Build an ingestion and analysis pipeline to compute inter-block time deltas for the Layer 1 consensus chain and the Auto-EVM domain.
- Support both streaming (near-real-time) and backfill (historical) modes.
- Persist results to Parquet with DuckDB for analytics.

### Non-Goals

- No dashboards or hosted APIs in Phase 1 (CSV/SQL queries are sufficient).
- No cross-chain correlation metrics beyond per-chain block time deltas.
- No on-chain writes or protocol changes.

### Assumptions

- No finalization available; we use N-block confirmations with configurable depth K.
- `pallet-timestamp` provides milliseconds; if a chain deviates, we will normalize.
- Single-process writer with per-partition exclusive writes.

### Deliverables

- Streaming ingestor that tails heads for both chains and writes deltas to Parquet partitions.
- Backfill tool that processes a height range up to `tip - K` and writes Parquet.
- Report tool that computes distribution stats (p50/p90/p99/max), rolling averages, outlier counts, and correlation analyses (segment header presence, domain vs consensus latency) over time windows.
- Documentation: runbook, configuration reference, and validation checklist.

### Architecture Overview

- Sources: `@polkadot/api` connections to consensus and Auto-EVM RPCs.
- Pipelines:
  - Streaming: new heads → timestamp lookup → parent linkage check → delta compute → per-chain enrichment (segment header presence, bundle count, domain→consensus hash) → enqueue → batched write.
  - Backfill: confirmed tip height (`tip - K`) → linear walk over height range → timestamp lookup per block → delta compute → enrichment → batched write.
- Storage: Parquet, partitioned by `chain` and `date` (YYYY-MM-DD from block timestamp), queried via DuckDB.

### Data Model (block_times)

- chain: string ("consensus" | "auto-evm")
- block_number: u64
- hash: string
- parent_hash: string
- timestamp_ms: i64
- delta_since_parent_ms: i32
- ingestion_ts_ms: i64
- contained_store_segment_headers: boolean (consensus only)
- bundle_count: u64 (consensus only)
- consensus_block_hash: string (auto-evm only)

Partitioning:

- `data/block_times/chain=<chain>/date=YYYY-MM-DD/part-*.parquet`

### Configuration

- RPC URLs: `CONSENSUS_RPC_WS`, `AUTO_EVM_RPC_WS`
- Confirmation depth: `K_CONSENSUS`, `K_AUTO_EVM` (initial suggestion: 64; adjust per observed reorg depth)
- Batch sizes: `WRITE_BATCH_ROWS` (e.g., 5_000), `WRITE_BATCH_MS` (e.g., 2_000)
- Concurrency: `MAX_INFLIGHT_HEADERS` (cap active timestamp lookups)
- File rotation: `MAX_ROWS_PER_FILE`, `MAX_FILE_MINUTES`
- Logging: `LOG_LEVEL` (debug|info|warn|error)
- Output root: `DATA_DIR` (default `data/`)

### Streaming Pipeline Details

- Subscribe to new heads for each chain independently.
- For each head H:
  - Fetch `timestamp_ms` via `api.at(H.hash).query.timestamp.now()`.
  - If parent hash matches the last seen head, compute `delta_ms` and perform enrichment:
    - Consensus: detect `contained_store_segment_headers` and `bundle_count` by scanning events/extrinsics.
    - Auto-EVM: resolve `consensus_block_hash` from domain header digest or a consensus-side mapping; if unresolved, set `null` and log for reconciliation.
  - Enqueue a row with enrichment fields (chain-specific).
  - If parent mismatch (reorg edge), skip emitting a delta for this head and reset linkage to H.
- Batching strategy:
  - Maintain an in-memory queue per partition (chain + current date).
  - Flush when row count or timer threshold is hit.

### Backfill Pipeline Details

- Determine tip height and set confirmed head at `tip - K`.
- Walk from a configured start height up to confirmed head.
- For each height:
  - Retrieve block hash and parent; fetch `timestamp_ms`.
  - Compute `delta_ms` with the immediate parent.
  - Append to the appropriate date partition queue.
- Flush on batch thresholds and on date boundary changes.

### Storage Writer

- Use DuckDB via Node bindings to write Parquet:
  - Approach A: Create a DuckDB connection, create temp tables, and `COPY TO 'partition-path.parquet' (FORMAT 'parquet', PARTITION_BY (chain, date))`.
  - Approach B: Direct Parquet writes via DuckDB SQL with staged CSV/JSON; prefer Approach A for simplicity and performance.
- Ensure single-writer per partition (serialize writes per chain+date).

### Reporting Tool

- Inputs: chain, time window (start/end date-time), optional percentiles to compute.
- Queries executed via DuckDB over Parquet:
  - Distribution stats: p50/p90/p99/max of `delta_since_parent_ms` grouped by hour/day.
  - Rolling averages (e.g., 1h, 24h) using window functions.
  - Outlier counts: `delta_ms > slot_time_ms * threshold`.
  - Segment-aware distributions: compare deltas where `contained_store_segment_headers` is true vs false.
  - Domain vs consensus latency: join domain rows with their `consensus_block_hash` to compute `timestamp_ms(domain) - timestamp_ms(consensus)` distributions.

### Observability

- Structured logs with contextual fields: chain, height, hash, queue sizes, batch flush events, write latencies.
- Metrics (optional in Phase 1): process CPU/RSS, rows ingested/sec, write throughput MB/s, DuckDB write latency.

### Validation & QA

- Sanity checks: `delta_ms > 0`, `parent_hash` linkage continuity within a day.
- Cross-check against explorer data (if available) for sample ranges.
- Re-run backfill over a short recent window and compare results between two runs (idempotency).
- Parquet schema validation on read with DuckDB.
- Mapping validation: For a sample set, verify `consensus_block_hash` resolved from domain headers matches consensus-side inclusion events; investigate mismatches.

### Performance Targets (initial)

- Sustained ingest: 100+ blocks/sec per chain on a dev laptop.
- Write amplification: Parquet files 64–512 MB per partition per day.
- Memory: < 1.5 GB RSS steady-state.

### Risks & Mitigations

- Deep reorgs beyond K: select K conservatively; allow re-backfill of recent days.
- RPC instability: support multiple endpoints with failover and backoff.
- Large partitions: rotate files by row/time; consider daily compaction job later.

### Milestones

- Setup environment, DuckDB prototype for Parquet write, metadata/timestamp extraction, basic stream for one chain.
- Dual-chain support, backfill mode with K confirmations, partitioned writes with rotation.
- Reporting queries, validation suite, perf tuning, docs/runbook.

### Open Questions

- Initial K per chain? (Proposed default: 64 for both; tune with observed reorgs.)
- Expected slot time per chain for outlier detection? (Provide constants.)
- Primary RPC endpoints and backups?

### Acceptance Criteria

- End-to-end stream writes Parquet for both chains with correct `delta_ms` and partitioning.
- Backfill over a configurable range completes and matches stream-produced data where ranges overlap.
- Report tool outputs percentile table for a requested window without errors.
- Documentation enables a new developer to run all tools locally.

### Implementation Conventions (TypeScript)

- Package manager: Yarn; ESM modules; Node 20 LTS; strict TS.
- Style: prefer arrow functions, immutability, and avoid classes.
