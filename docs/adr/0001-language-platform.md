## ADR 0001: Language/Platform – Rust (subxt) vs TypeScript (polkadot-js)

Status: Proposed

### Context

We need to analyze various aspects of a Substrate-based chain with a Layer 1 (consensus) and Layer 2 domains (notably an Auto-EVM domain). The initial workload is block time analysis for the consensus chain and Auto-EVM domain. Two primary implementation options:

- Rust + subxt
- TypeScript + polkadot-js

### Requirements and Constraints

- Stream new heads and backfill historical ranges reliably.
- Extract per-block timestamps and compute inter-block intervals with reorg awareness.
- Handle long-running ingestion and periodic batch backfills.
- Favor quick iteration now; keep a path to higher throughput later.
- If TypeScript is chosen: use Yarn, arrow functions, immutability, avoid classes.

### Option A: TypeScript + polkadot-js

Pros:

- Fast iteration, rich ecosystem, easy integration with tooling/visualization.
- polkadot-js is mature for RPC, subscriptions, metadata handling.
- Easier onboarding and scripting; good developer velocity for analytics.

Cons:

- Node.js event loop can be a bottleneck for heavy CPU tasks.
- Memory footprint and garbage collection overhead for large in-memory pipelines.
- Runtime type safety; must be disciplined with strict TS.

### Option B: Rust + subxt

Pros:

- High performance and predictable memory, excellent for heavy or long-running services.
- Strong type safety and compile-time guarantees across metadata changes.
- Great for CPU-bound transformations and high-throughput ingestion.

Cons:

- Slower initial iteration; more boilerplate for quick analytics.
- Smaller ecosystem for ad-hoc scripting and rapid data exploration.

### Decision (Phase 1)

Adopt TypeScript with polkadot-js for the initial implementation of block time analysis and related POCs. This maximizes iteration speed and leverages subscriptions and familiar tooling. Keep the door open to Rust for future high-throughput or compute-heavy pipelines.

### Consequences

- Tooling: Node 20 LTS, ESM, Yarn, strict TS config.
- Libraries: `@polkadot/api`, RxJS for stream composition (optional), `duckdb` (Node) if Parquet is selected in storage ADR.
- Coding style: arrow functions, immutability, avoid classes.

### Revisit Criteria

Reconsider Rust + subxt if any of these are observed in practice:

- Throughput shortfall: sustained ingest < required rate or > 70% CPU in Node.
- Memory pressure: frequent GC pauses or > 2–4 GB RSS during normal operation.
- Complex concurrent pipelines that are hard to reason about in Node.
- Need for shared native libraries or SIMD-heavy transforms.

### Implementation Sketch (TypeScript)

High-level outline for streaming and backfill:

1. Connect to RPCs for consensus and Auto-EVM via `@polkadot/api`.
2. For streaming: `api.rpc.chain.subscribeNewHeads` → fetch `timestamp` storage at each head → compute `delta_ms` vs parent → persist.
3. For backfill: use N-block confirmations. Define depth `K`, process up to `tip_height - K`, compute timestamps and deltas, persist in batches.

### Alternatives Considered

- Mixed approach: TS for orchestration + Rust microservices for hotspots (FFI or IPC). Viable if needed.
- Python for analytics; rejected for now due to extra runtime and duplication.
