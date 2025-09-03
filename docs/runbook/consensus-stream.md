## Runbook: Consensus Stream

### Prerequisites

- Node 20+
- Yarn (Berry), node_modules linker (set via `.yarnrc.yml`)
- A running consensus RPC endpoint (WebSocket)

### Configure

1. Copy `.env.example` to `.env` and set:
   - `CONSENSUS_RPC_WS=ws://localhost:9944`
   - `DATA_DIR=./data`
   - `LOG_LEVEL=info`

### Install & Build

```bash
yarn
yarn build
```

### Run (dev)

```bash
yarn dev
```

The app will connect, stream new heads, compute `delta_since_parent_ms`, and write Parquet partitions under `data/block_times/chain=consensus/date=YYYY-MM-DD/`.

### Run (compiled)

```bash
yarn start
```

### Outputs

- Parquet files under `DATA_DIR/block_times/chain=consensus/date=YYYY-MM-DD/part-*.parquet`
- Logs with batch flush counts and reorg edge notices

### Troubleshooting

- Connection issues: verify `CONSENSUS_RPC_WS` and node CORS/WS configuration.
- No output files: ensure new blocks are produced and check logs at `LOG_LEVEL=debug`.
- Permissions: ensure the `DATA_DIR` directory is writable.
