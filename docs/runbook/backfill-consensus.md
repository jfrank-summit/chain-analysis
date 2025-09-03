## Runbook: Backfill Consensus

### Configure

- In `.env` set:

```
K_CONSENSUS=64
# Optional height range (inclusive). If unset, defaults to last ~5000 blocks up to tip-K
BACKFILL_START=
BACKFILL_END=
WRITE_BATCH_ROWS=5000
WRITE_BATCH_MS=60000
```

### Run

```
yarn workspace @chain-analysis/consensus-backfill dev
```

- Writes Parquet under `DATA_DIR/block_times/chain=consensus/date=YYYY-MM-DD/`.
- Batches by WRITE_BATCH_ROWS (and flushes at completion).

### Notes

- The backfill walks linearly from start to end on the confirmed chain (tip − K).
- If a non-linear parent is detected, the delta is skipped and a warning is logged.
