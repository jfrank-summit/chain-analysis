## Milestone 2: Dual-Chain, Enrichment, Backfill with K-Confirmations

### Objective

- Add Auto-EVM domain pipeline, enrichment fields, and backfill up to `tip - K`.
- Implement partitioned writes with rotation and robust batching.

### Acceptance Criteria

- Streaming runs for both chains concurrently without missing data.
- Domain rows include `consensus_block_hash` (best-effort; unresolved are logged for reconciliation).
- Consensus rows include `contained_store_segment_headers` and `bundle_count`.
- Backfill completes over a target range and produces Parquet for both chains.

### Atomic Commit Plan

1. refactor(pipeline): generalize single-chain stream to multi-chain
   - add `src/ingest/stream.ts` orchestrator that spawns per-chain streamers
   - factor common code into utilities; preserve immutability and functional style

2. feat(domain-stream): implement Auto-EVM streaming
   - add `src/ingest/streamDomain.ts` mirroring consensus logic
   - add config env `AUTO_EVM_RPC_WS`, `K_AUTO_EVM`

3. feat(consensus-enrichment): detect segment header presence and bundle count
   - add `src/chain/consensus/enrichment.ts` to scan events/extrinsics at block hash
   - expose `{ contained_store_segment_headers: boolean, bundle_count: number }`

4. feat(domain-enrichment): resolve consensus hash for each domain block
   - add `src/chain/domain/mapping.ts` to read domain header digests (preferred)
   - include `consensus_block_hash` directly in the row when resolved
   - on miss: set `null` and emit a reconciliation log entry (no KV)

5. feat(backfill): implement K-confirmation backfill for both chains
   - add `src/ingest/backfill.ts` with inputs: chain, start, end|count, K
   - walk linear chain, compute deltas, apply enrichment, and batch write by partition

6. feat(rotation): file rotation and row-group sizing
   - add config `MAX_ROWS_PER_FILE`, `MAX_FILE_MINUTES`
   - implement partition queues and safe rotation on thresholds

7. chore(config): centralize configuration
   - add `src/config/index.ts` aggregating env with defaults and validation (zod)
   - document all envs in `docs/runbook/config.md`

8. docs(runbook): domain and backfill instructions
   - add `docs/runbook/domain-stream.md` and `docs/runbook/backfill.md`
   - include reconciliation steps for unresolved mappings

9. qa(validation): mapping and integrity checks

- add `scripts/duckdb/validate_mapping.sql` to join domain rows on `consensus_block_hash` and count nulls/mismatches
- add `scripts/duckdb/validate_deltas.sql` to assert `delta_ms > 0` distributions
