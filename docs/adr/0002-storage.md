## ADR 0002: Storage – SQLite vs Postgres vs Parquet

Status: Proposed

### Context

We will ingest block-level telemetry (initially block timestamps and inter-block intervals) for the consensus chain and the Auto-EVM domain. Writes are produced in parallel from one process. We need durable, queryable storage with good write characteristics and easy local development.

### Options

1. SQLite
   - Pros: Simple, zero-ops, great for local dev. WAL mode improves concurrency.
   - Cons: Single-writer; high parallel write throughput requires careful batching/queuing. Less ideal for multi-process or high sustained ingest.

2. Postgres (optionally with TimescaleDB)
   - Pros: Robust concurrent writes, transactions, indexes, mature ecosystem, flexible queries. Timeseries extensions add compression/rollups.
   - Cons: Requires running a server; more ops overhead for local and CI.

3. Parquet (partitioned, queried via DuckDB)
   - Pros: Columnar, compressed, excellent for analytics; cheap scans/aggregations. Easy to version and move (data-lake style). Great local experience with DuckDB.
   - Cons: Appending requires partition strategy; multi-writer coordination is non-trivial. Secondary indexes are limited; not ideal for high-QPS OLTP.

### Decision (Phase 1)

Adopt Parquet for analytical datasets, partitioned by `chain`/`domain`/`date`, and query with DuckDB. This fits analytics-first workloads like block time distributions and percentile queries. Manage writes via a single-writer-per-partition queue within the process. If/when we need shared, low-latency serving or complex joins, introduce Postgres.

Rationale: Our initial workloads are analytical and append-heavy. Parquet provides compact storage and fast scans. DuckDB offers strong local ergonomics without heavy infra. Postgres remains a clear upgrade path for concurrent consumers, ad-hoc APIs, or richer indexing.

### Why Parquet fits our workload

- Analytical, scan-heavy queries: Our core queries are distributions, percentiles, and aggregations over time windows. Parquet is columnar, so we only read the needed columns (`timestamp_ms`, `delta_since_parent_ms`, and occasionally `chain`/`block_number`), minimizing I/O compared to row stores.
- High compression and encoding: Parquet’s dictionary, run-length, and bit-packing encodings compress repeated values (e.g., `chain`) and small deltas efficiently. Typical 5–10× reductions vs CSV and significant savings vs SQLite/Postgres on disk.
- Partition pruning by `chain`/`date`: Time-bucketed analytics and chain-scoped queries naturally map to directory partitions, allowing DuckDB to skip entire files for irrelevant dates/chains.
- Single-writer simplicity: We have one process producing writes; coordinating a single writer per partition is straightforward. We avoid the operational overhead of a database server while still achieving high ingest throughput with batch writes.
- Fast local iteration: DuckDB queries Parquet files directly—no ETL/import step—so we can iterate on schemas and analyses quickly, and commit artifacts alongside code for reproducibility.
- Easy reprocessing/backfills: With N-block confirmations, we may rewrite recent partitions. Replacing Parquet files atomically (write temp, then rename) is simple and avoids complex upserts.
- Cross-language ecosystem: Parquet is first-class in Python (Pandas/Polars/Arrow), R, and Rust, enabling future analysis notebooks without data migration.
- Scale-up performance: On a laptop, DuckDB can scan tens to hundreds of millions of rows per second for simple aggregations due to vectorized execution and columnar layout—well beyond our expected Phase 1 volumes.

### Data Model (initial dataset: block_times)

Columns:

- chain: string (e.g., "consensus", "auto-evm")
- block_number: u64
- hash: string
- parent_hash: string
- timestamp_ms: i64 (from pallet-timestamp)
- delta_since_parent_ms: i32
- ingestion_ts_ms: i64
- contained_store_segment_headers: boolean (consensus only)
- bundle_count: u64 (consensus only)
- consensus_block_hash: string (auto-evm only)

Partitioning:

- Directory layout: `data/block_times/chain=<chain>/date=YYYY-MM-DD/part-*.parquet`

Write Strategy:

- Single writer per partition; use in-process queueing/batching (e.g., size/time-based) to create row groups efficiently.
- Rotate to a new file per N rows or M minutes to bound file sizes.

### Revisit Criteria

Switch (or complement) with Postgres if we need:

- Multiple concurrent writers across processes/machines.
- Low-latency queries for serving APIs or dashboards with complex filters.
- Heavy dimensional joins beyond what DuckDB-on-Parquet comfortably handles.

### Implementation Notes (TypeScript)

- Use the `duckdb` Node package to create Parquet files (COPY/INSERT INTO parquet). Alternatively, batch to temporary CSV and `COPY` into Parquet via DuckDB for simplicity.
- Validate partition pruning and file sizes; target 64–512 MB per file for efficient scans and healthy row group sizes.
- Ensure atomicity: write to a temporary path within the partition, then `fs.rename` to the final filename so readers never observe partial files.
- Serialize writes per partition (chain+date) to avoid file contention; allow concurrent writes across different partitions.
- For read performance, keep row groups reasonably large (e.g., 128–512 MB per file) and avoid excessive tiny files; consider a periodic compaction if needed.
