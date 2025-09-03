## Milestone 1: Environment, RPC, Timestamp, Minimal Writer (Consensus)

### Objective

- Stand up a TypeScript workspace with Yarn and strict TS.
- Connect to the consensus RPC, extract timestamps, compute deltas, and write a first Parquet file.

### Acceptance Criteria

- CLI can stream consensus heads and log deltas.
- A Parquet file exists under `data/block_times/chain=consensus/date=YYYY-MM-DD/` with valid schema and > 1K rows.
- Docs include a runbook and configuration reference.

### Atomic Commit Plan

1. chore(repo): initialize TS workspace with Yarn + ESM + strict TS

   - add `package.json` (type: module), `.yarnrc.yml`, `.nvmrc`, `.editorconfig`
   - add `tsconfig.json` (strict, ES2022, moduleResolution: node16)
   - add `eslint` + `prettier` config; ensure arrow functions, no classes rule preferences
   - add basic `src/` layout with placeholder `index.ts`

2. chore(deps): add core dependencies and scripts

   - add `@polkadot/api`, `zod`, `dotenv`, `pino`
   - add dev deps: `typescript`, `ts-node`, `eslint`, `prettier`
   - scripts: `yarn dev`, `yarn build`, `yarn start`

3. feat(config): introduce configuration loader

   - add `src/config/env.ts` reading `CONSENSUS_RPC_WS`, `DATA_DIR`, `LOG_LEVEL`
   - add `.env.example` with default placeholders
   - update docs with env var descriptions

4. feat(rpc): connect to consensus RPC and log chain info

   - add `src/chain/connect.ts` with `connect(url)` and graceful shutdown
   - add `src/bin/consensus-info.ts` CLI to print chain name and current head number
   - verify connection and metadata fetch

5. feat(timestamp): implement timestamp extraction utility

   - add `src/chain/timestamp.ts` with `getBlockTimestampMs(api, hash)`
   - add unit test (if testing infra present) or a small script to fetch a known block hash timestamp

6. feat(stream): minimal streaming of consensus heads and delta computation

   - add `src/ingest/streamConsensus.ts` to `subscribeNewHeads`, compute `delta_ms` vs parent, and log to console
   - handle parent mismatch by skipping delta and resetting state (reorg edge)

7. feat(storage): integrate DuckDB and first Parquet write

   - add dependency `duckdb`
   - add `src/storage/duckdb.ts` to open a DuckDB connection and execute SQL
   - add `src/storage/parquetWriter.ts` with a function `writeBlockTimesBatch(rows)` that writes to `data/block_times/chain=consensus/date=YYYY-MM-DD/part-*.parquet` via `COPY`
   - ensure atomic write: temp path then rename

8. feat(batch): add in-memory queue and flush policy

   - add `src/ingest/batchQueue.ts` with size/time-based flush thresholds
   - integrate with `streamConsensus` to enqueue rows and flush to Parquet

9. chore(logging): add structured logging

   - configure `pino` logger with fields (chain, block_number, queue_size, flush_ms)
   - add `LOG_LEVEL` env handling

10. docs(runbook): add run instructions and troubleshooting

- create `docs/runbook/consensus-stream.md` with setup, `.env`, and `yarn` commands
- update `docs/README.md` to link the runbook

11. qa(sanity): validate Parquet schema and sample query

- add `scripts/duckdb/inspect_block_times.sql` to query count and sample percentiles
- document expected output ranges in the runbook
