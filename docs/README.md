## Chain Analysis Documentation

Purpose: Explore and implement analysis for a Substrate-based blockchain with a Layer 1 consensus chain and Layer 2 domains (including the Auto-EVM domain). Initial focus is on block time analysis for the consensus chain and the Auto-EVM domain.

### Document Map

- ADRs (Architecture Decision Records)
  - [0001: Language/Platform – Rust (subxt) vs TypeScript (polkadot-js)](adr/0001-language-platform.md)
  - [0002: Storage – SQLite vs Postgres vs Parquet](adr/0002-storage.md)
- Specs
  - [Block Times Analysis (Consensus + Auto-EVM)](specs/block-times-analysis.md)
- Plans
  - [Phase 1: Block Times](plan/phase-1-block-times.md)
  - Milestones
    - [Milestone 1](plan/milestones/milestone-1.md)
    - [Milestone 2](plan/milestones/milestone-2.md)
    - [Milestone 3](plan/milestones/milestone-3.md)
- Runbooks
  - [Consensus Stream](runbook/consensus-stream.md)

### Current Status

- Decisions are captured as ADRs and may begin as "Proposed" with revisit criteria.
- The spec documents concrete data, metrics, and implementation approach.

### Conventions (if TypeScript is selected)

- Use Yarn, prefer arrow functions, prefer immutability, avoid classes.
- Prefer ESM, Node 20 LTS, and strict TypeScript.

### Next Steps

- Validate ADRs via a small POC: connect to RPC, stream headers, compute block intervals, and persist to the chosen storage.
- Measure throughput, CPU, and write performance to confirm decisions (see ADRs for revisit criteria).
