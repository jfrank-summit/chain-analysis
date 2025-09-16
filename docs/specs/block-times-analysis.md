## Spec: Block Times Analysis (Consensus + Auto-EVM Domain)

### Goal

Compute and analyze inter-block times for the consensus chain and the Auto-EVM domain using historical backfills. Produce metrics (distributions, percentiles, jitter) and persist raw per-block deltas for flexible downstream analysis.

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

### Domain↔Consensus Mapping (future)

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

// Detect segment headers and count bundles for a consensus block.
// Prefer pre-fetched events to avoid extra RPCs; otherwise query events.
type Prefetched = { events?: any[] };
const detectSegmentHeadersAndBundles = async (
  api: ApiPromise,
  hash: string,
  prefetched?: Prefetched,
): Promise<{ contains: boolean; bundleCount: number }> => {
  const fromEvents = (events: any[]) => {
    const contains = events.some(
      ({ event }: any) => event.section === "subspace" && event.method === "SegmentHeaderStored",
    );
    const bundleCount = events.filter(
      ({ event }: any) => event.section === "domains" && event.method === "BundleStored",
    ).length;
    return { contains, bundleCount };
  };
  if (prefetched?.events?.length) return fromEvents(prefetched.events);
  const at = await api.at(hash);
  const events = await at.query.system.events();
  return fromEvents(events as any[]);
};

const resolveConsensusHashForDomain = async (
  api: ApiPromise,
  domainHash: string,
): Promise<string | null> => {
  // Inspect domain header digest or consult consensus-side events mapping
  return null;
};

// Streaming is out of scope; ingestion is performed via backfill only in Phase 1.
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
