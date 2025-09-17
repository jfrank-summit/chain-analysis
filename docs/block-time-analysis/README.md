## Analysis: Domain vs Consensus Block Times

### Dataset (bounds)

- Consensus blocks spanned by domain-connected hashes: 3,851,331 → 4,470,297
- Time range (UTC): 2025-08-04 10:06:44.771Z → 2025-09-17 07:47:29.419Z
- Domain blocks analyzed: 1 → 548,782

### TL;DR

- Domain blocks advance only on consensus blocks that include at least one domain bundle. If some consensus blocks lack bundles, domain blocks "skip" those and the average domain inter-block time increases.
- Empirically in our dataset:
  - avg_consensus_ms ≈ 6128.35
  - p (fraction of consensus blocks with a domain bundle) ≈ 0.83168
  - implied_domain_ms = avg_consensus_ms / p ≈ 7367.6
  - observed avg_domain_ms ≈ 7363.74
  - The observed domain average matches the implied value, so the gap >6s is explained by bundle scarcity.

### Background

- Consensus target is ~6s average (runtime weights are calibrated for 2s compute at 6s average). In code:
  - `crates/subspace-runtime/src/lib.rs`:
    - `SLOT_DURATION = 1000` ms and `BLOCK_AUTHORING_DELAY = 4` slots (6s average)
    - Block weights note: "2 seconds of compute with a 6 second average block time"
- Domain block number increments only when a bundle is successfully included in a consensus block:
  - `crates/pallet-domains/src/lib.rs` around `HeadDomainNumber` docs.

### Model

- Let p be the fraction of consensus blocks that contain at least one domain bundle.
- If consensus average inter-block time is E[C], expected domain inter-block time is approximately:

  E[D] ≈ E[C] / p

- Intuition: domain block height increments only on the subset of consensus blocks that are "bundle-carrying"; if fewer blocks carry bundles, the domain clock ticks less often, stretching the average.

### Why p < 1?

- Bundle election is probabilistic and primarily governed by the domain’s `bundle_slot_probability` and operator stakes.
- Even with `bundle_slot_probability = 1` and 100% operator liveness, independent per-operator VRF draws imply a non‑zero chance that no one wins in a slot. Let stake fractions be `s_i` (sum to 1). Then:
  - no winner probability: `product_i (1 - s_i)`
  - at least one winner: `p = 1 - product_i (1 - s_i)` (so `p < 1` unless one operator has all stake)
  - equal stakes (`N` operators): `p ≈ 1 - (1 - 1/N)^N ≈ 1 - e^-1 ≈ 0.632`

Key parameters (where to look in code):

- Bundle election probability:
  - Chain spec/runtime: `bundle_slot_probability` (keep aligned with consensus `SlotProbability`)

### Sizing `bundle_slot_probability` for a target p

- Exact (with known stake fractions `s_i`, sum to 1):
  - Define a per-operator win factor `b` (the scalar value of `bundle_slot_probability`).
  - Per-operator win probability is approximately `min(1, b * s_i)`.
  - Slot success probability:
    - `p(b) = 1 - product_i (1 - min(1, b * s_i))`.
  - Pick a target `p*` (e.g., 0.95) and solve for the smallest `b` with `p(b) ≥ p*` (binary search works well).

- Equal-stake approximation (quick back-of-the-envelope):
  - For `N` similar operators (`s_i ≈ 1/N`) and `b/N << 1`,
    - `p(b) ≈ 1 - (1 - b/N)^N ≈ 1 - e^-b`.
  - Closed-form sizing: `b ≈ -ln(1 - p*)`.
    - `p* = 0.90 → b ≈ 2.30`
    - `p* = 0.95 → b ≈ 2.99`
    - `p* = 0.98 → b ≈ 3.91`
    - `p* = 0.99 → b ≈ 4.61`

Notes:

- The equal-stake formula is a convenience; use the exact formula with your live stake vector for production sizing.
- Increasing `b` increases expected winners per slot (roughly proportional), so expect more bundles per consensus block.

### Current runtime constraints (and what would need to change)

- Today the runtime enforces `0 < bundle_slot_probability ≤ 1` during domain instantiation:
  - See `crates/pallet-domains/src/domain_registry.rs` where it checks `numerator != 0`, `denominator != 0`, and `numerator <= denominator`.
- The VRF threshold math (`calculate_threshold`) is written for probabilities ≤ 1 and uses plain `u128` arithmetic:
  - If you allow `b > 1`, the computed threshold can overflow `u128` unless you clamp to `u128::MAX` or explicitly compute per-operator `min(1, b * s_i)`.
- Bundle limits scale with the expected bundles per consensus block:
  - `calculate_max_bundle_weight_and_size()` divides domain block budgets by the expected bundles; increasing `b` reduces per-bundle size/weight accordingly.

Implications:

- To set `bundle_slot_probability > 1`, you’d need to:
  1. Relax the slot probability validation (`numerator <= denominator`).
  2. Make threshold computation saturating/clamped to ensure per-operator win probability never exceeds 1 and avoids arithmetic overflow.
  3. Reassess per-bundle limits (weight/size) since more winners per slot implies smaller bundles.

### References

- Block time measurements: [domain-vs-consensus-block-times-measurement.md](domain-vs-consensus-block-times-measurement.md)
- Operator selection and bundle timing: [operator-selection-and-bundle-timing.md](operator-selection-and-bundle-timing.md)
