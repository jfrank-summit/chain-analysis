# Offline Operator Detection Analysis

## Overview

This analysis tracks operators who fail to meet bundle production thresholds on the Autonomys Network. The offline operator detection mechanism uses a Chernoff lower-tail bound to identify operators producing significantly fewer bundles than expected based on their stake share.

## Background

### How Detection Works

At each domain epoch transition (~100 domain blocks), the system:

1. Computes expected bundles per operator: `μ = S × p_slot` where:
   - `S` = total slots in the epoch
   - `p_slot` = per-slot win probability (derived from stake share and `bundle_slot_probability`)

2. Calculates Chernoff threshold: `r = floor(μ - sqrt(2 × μ × ln(1/τ)))`
   - `τ = 1%` false-positive rate
   - Only "throughput-relevant" operators (μ ≥ 10) are checked

3. Emits `OperatorOffline` event if `submitted_bundles < r`

### Key Parameters

| Parameter   | Value  | Description                    |
| ----------- | ------ | ------------------------------ |
| τ (tau)     | 1%     | False-positive rate target     |
| E_BASE      | 3      | Minimum expected bundles floor |
| E_relevance | 10     | Throughput relevance threshold |
| ln(1/τ)     | ~4.605 | Precomputed constant           |

### Event Data

The `OperatorOffline` event contains:

- `operator_id` - Unique operator identifier
- `domain_id` - Domain being operated
- `submitted_bundles` - Actual bundles produced
- `expected_bundles` - floor(μ) based on stake
- `min_required_bundles` - Chernoff threshold (r)

## Mainnet Deployment

- **Start block:** `5544361`
- **Implementation:** [PR #3711](https://github.com/autonomys/subspace/pull/3711)
- **Spec:** [offline_operator_detection.md](https://github.com/subspace/protocol-specs/blob/main/docs/decex/offline_operator_detection.md)

## Data Collection

### Running the Backfill

```bash
# From mainnet deployment to present
yarn start:backfill-offline -- --start=5544361

# Specific range
yarn start:backfill-offline -- --start=5544361 --end=6000000

# Development mode (no build, uses tsx)
yarn workspace @chain-analysis/ingest dev:backfill-offline -- --start=5544361
```

### Data Location

Parquet files: `data/offline_operators/date=YYYY-MM-DD/part-*.parquet`

### Schema

| Column                 | Type    | Description                        |
| ---------------------- | ------- | ---------------------------------- |
| `block_number`         | uint64  | Consensus block (epoch transition) |
| `block_hash`           | string  | Block hash                         |
| `timestamp_ms`         | uint64  | Block timestamp (Unix ms)          |
| `timestamp_utc`        | string  | ISO 8601 timestamp                 |
| `domain_id`            | uint32  | Domain identifier                  |
| `epoch_index`          | uint64  | Domain epoch number                |
| `operator_id`          | uint64  | Operator identifier                |
| `submitted_bundles`    | uint64  | Actual bundles produced            |
| `expected_bundles`     | uint64  | Expected bundles (μ)               |
| `min_required_bundles` | uint64  | Chernoff threshold (r)             |
| `shortfall`            | int64   | r - submitted                      |
| `shortfall_pct`        | float64 | shortfall / expected × 100         |
| `ingestion_ts_ms`      | uint64  | Ingestion timestamp                |

## Analysis

See [measurement.md](./measurement.md) for DuckDB queries.

## Questions to Answer

1. **Frequency:** How often are operators flagged?
2. **Distribution:** Are the same operators repeatedly flagged?
3. **Severity:** How far below threshold are flagged operators?
4. **Patterns:** Time-of-day or network condition correlations?
5. **Validation:** Does actual flag rate match expected false-positive rate?

## References

- [Offline Operator Detection Spec](https://github.com/subspace/protocol-specs/blob/main/docs/decex/offline_operator_detection.md)
- [Implementation PR #3711](https://github.com/autonomys/subspace/pull/3711)
- [Chernoff Bound (Wikipedia)](https://en.wikipedia.org/wiki/Chernoff_bound)
