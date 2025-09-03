## Spec: Block Times Analysis (Consensus + Auto-EVM Domain)

### Goal

Compute and analyze inter-block times for the consensus chain and the Auto-EVM domain, supporting both live streaming and historical backfills. Produce metrics (distributions, percentiles, jitter) and persist raw per-block deltas for flexible downstream analysis.

### Definitions

- Block timestamp: value from `pallet-timestamp` at a specific block.
- Inter-block time (delta): `timestamp(block N) - timestamp(block N-1)` along the canonical chain.
- Reorg edge: a boundary where the parent of the observed head is not the previously processed canonical parent.

### Data Sources

- Consensus RPC endpoint (WebSocket).
- Auto-EVM domain RPC endpoint (WebSocket).

### Metrics

- Per-chain distribution of deltas (p50, p90, p99, max) over time windows.
- Rolling averages and jitter (stddev) per hour/day.
- Outliers: deltas above expected slot time × threshold.
- Segment-aware distributions (consensus): compare `delta_ms` where `contained_store_segment_headers` is true vs false.
- Cross-chain latency (domain vs consensus): distribution of `timestamp_ms(domain) - timestamp_ms(consensus_source)` once `consensus_block_hash` is resolved.

### Canonical Chain Handling

- Streaming: compute deltas from best heads; suppress deltas when a reorg is detected (parent mismatch) and resume on the new best chain.
- Backfill: use N-block confirmations. Define a confirmation depth `K`; treat the chain state `K` blocks behind the current tip as confirmed for deterministic delta computation.

### Storage

- Dataset: `block_times` (see ADR 0002 for schema/partitions).
- Partition by `chain` and `date` (YYYY-MM-DD based on timestamp).

### High-Level Flow (TypeScript)

1. Connect to RPCs using `@polkadot/api`.
2. For each chain (consensus, auto-evm):
   - Streaming mode:
     - Subscribe to new heads.
     - For each head `H`, fetch timestamp at `H` via `api.at(H.hash)` → `query.timestamp.now()`.
     - Retrieve parent timestamp (from cache or query).
     - If `parent_of(H) != last_seen_head`, treat as a reorg edge and skip delta emit for this pair.
     - Otherwise compute `delta_ms` and enrich per-chain before enqueue:
       - Consensus: detect `contained_store_segment_headers` and count related bundles as `bundle_count`.
       - Auto-EVM: resolve `consensus_block_hash` for this domain block (via domain header digest or consensus-side events mapping).
   - Backfill mode:
     - Determine confirmed head at depth `K` (K blocks before the tip).
     - Walk from an older starting point up to the confirmed head.
     - For each consecutive pair, compute `delta_ms` and batch writes.

### Domain↔Consensus Mapping

- Read domain header digest logs (or a runtime API) that include the source consensus block hash/number for each domain block.
- Resolve `consensus_block_hash` inline during streaming/backfill when possible. If unresolved, set `null` and log for later reconciliation (no KV in Phase 1).

### Pseudocode (TypeScript)

```ts
import { ApiPromise, WsProvider } from "@polkadot/api";

const connect = async (url: string) => ApiPromise.create({ provider: new WsProvider(url) });

const getBlockTimestampMs = async (api: ApiPromise, hash: string): Promise<number> => {
  const at = await api.at(hash);
  const now = await at.query.timestamp.now();
  return Number(now.toBigInt()); // Moment is typically milliseconds
};

// Helpers (placeholders; implementations are chain-specific)
const detectSegmentHeaderPresence = async (
  api: ApiPromise,
  hash: string,
): Promise<{ contains: boolean; bundleCount: number }> => {
  // Inspect events/extrinsics at block 'hash' to determine presence and count
  return { contains: false, bundleCount: 0 };
};

const resolveConsensusHashForDomain = async (
  api: ApiPromise,
  domainHash: string,
): Promise<string | null> => {
  // Inspect domain header digest or consult consensus-side events mapping
  return null;
};

// Streaming outline (single chain)
const streamDeltas = async (api: ApiPromise, chain: string) => {
  let last: { hash: string; ts: number } | null = null;
  await api.rpc.chain.subscribeNewHeads(async (head) => {
    const hash = head.hash.toHex();
    const ts = await getBlockTimestampMs(api, hash);
    if (last) {
      const parentHash = head.parentHash.toHex();
      if (parentHash === last.hash) {
        const delta = ts - last.ts;
        const base = {
          chain,
          block_number: head.number.toNumber(),
          hash,
          parent_hash: parentHash,
          timestamp_ms: ts,
          delta_since_parent_ms: delta,
          ingestion_ts_ms: Date.now(),
        };
        if (chain === "consensus") {
          const { contains, bundleCount } = await detectSegmentHeaderPresence(api, hash);
          enqueueForPersist({
            ...base,
            contained_store_segment_headers: contains,
            bundle_count: bundleCount,
          });
        } else if (chain === "auto-evm") {
          const consensusHash = await resolveConsensusHashForDomain(api, hash);
          enqueueForPersist({
            ...base,
            consensus_block_hash: consensusHash,
          });
        } else {
          enqueueForPersist(base);
        }
      } else {
        // Reorg edge: parent mismatch; skip delta emit for this head
        // Optionally emit a diagnostic record if needed by the pipeline
      }
    }
    last = { hash, ts };
  });
};
```

### Backfill Outline

- Inputs: start block (or timestamp), end block (or count), chain ID, confirmation depth `K`, concurrency settings.
- Determine the current tip, then set the confirmed head at `tip_height - K`.
- Walk the chain from `start` to the confirmed head using `getHeader`/`getBlock` by hash.
- For each consecutive pair on the same canonical path, compute `delta_ms` and batch into Parquet.

### Persistence (if Parquet)

- Use `duckdb` Node package to create a local database/connection.
- For batches, stage data in an in-memory table and `COPY` into partitioned Parquet paths.
- Rotate files by row-count or time window.

### Validation

- Cross-check sample deltas against expected slot time.
- Spot-check with explorer data if available.
- Ensure no negative or zero deltas unless justified by timestamp semantics.

### CLI Modes (future)

- `backfill`: range inputs, writes Parquet partitions.
- `stream`: tail the chain(s), append to current day partition.
- `report`: compute and print metrics/percentiles over a time window.
