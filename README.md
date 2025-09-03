## Chain Analysis

Monorepo for Substrate chain analysis (consensus + Auto-EVM). Phase 1 focuses on block time deltas, stored in Parquet and queried via DuckDB.

### Quick Start

1. Copy `.env.example` to `.env` and set:

```
CONSENSUS_RPC_WS=wss://rpc.mainnet.autonomys.xyz/ws
DATA_DIR=./data
LOG_LEVEL=info
WRITE_BATCH_ROWS=5000
WRITE_BATCH_MS=60000
```

2. Install and run dev ingestor:

```
yarn
yarn dev
```

The app subscribes to new heads on the consensus chain and writes Parquet files under `DATA_DIR/block_times/chain=consensus/date=YYYY-MM-DD/`.

### Inspect Data with DuckDB

- One-off query (adjust path as needed):

```
duckdb -c "INSTALL parquet; LOAD parquet; SELECT * FROM read_parquet('data/block_times/chain=consensus/date=*/part-*.parquet') LIMIT 20;"
```

- Summary stats:

```
duckdb < scripts/duckdb/inspect_block_times.sql
```

### Project Structure

- `apps/consensus-stream`: Streaming ingestor CLI
- `packages/config`: Env loading and validation
- `packages/chain`: Polkadot.js utilities (connect, timestamp)
- `packages/storage`: DuckDB/Parquet writer
- `docs/`: ADRs, specs, plans, runbooks

### Notes

- Initial ingestion is head-forward (no backfill yet). Batch flush thresholds control Parquet file sizes.
- Prefer Node 20 LTS for the DuckDB node binding.
