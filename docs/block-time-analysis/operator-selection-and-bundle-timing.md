## Domains: Operator Selection, Bundle Timing, and Block Times

### TL;DR

- **Operator selection**: per-slot, stake-weighted VRF lottery scoped to the domain. Probability per slot is proportional to operator stake and the domain’s `bundle_slot_probability`.
- **Timing**: bundles must be recent (within `BundleLongevity`) and not in the future; PoT and slot checks enforce this.
- **Domain blocks**: a domain’s height advances at most once per consensus block (on the first accepted bundle). Additional bundles in the same consensus block confirm the current head.
- **Block times**: if consensus average is `E[C]` and fraction of consensus blocks that carry a bundle is `p`, expected domain average is approximately `E[D] ≈ E[C] / p`.

---

### How an operator is selected (stake-weighted VRF lottery)

1. A domain-specific transcript ties VRF to both the domain and the slot’s global challenge:

```11:20:subspace/crates/sp-domains/src/bundle_producer_election.rs
/// Generates a domain-specific vrf transcript from given global_challenge.
pub fn make_transcript(domain_id: DomainId, global_challenge: &Blake3Hash) -> VrfTranscript {
    VrfTranscript::new(
        VRF_TRANSCRIPT_LABEL,
        &[
            (b"domain", &domain_id.to_le_bytes()),
            (b"global_challenge", global_challenge.as_ref()),
        ],
    )
}
```

2. Eligibility is determined by comparing VRF output to a stake-weighted threshold scaled by the domain’s `bundle_slot_probability`:

```22:46:subspace/crates/sp-domains/src/bundle_producer_election.rs
/// Returns the election threshold based on the operator stake proportion and slot probability.
pub fn calculate_threshold(
    operator_stake: StakeWeight,
    total_domain_stake: StakeWeight,
    bundle_slot_probability: (u64, u64),
) -> Option<u128> {
    if total_domain_stake.is_zero() || bundle_slot_probability.1.is_zero() {
        return None;
    }

    // threshold = (bundle_slot_probability.0 / bundle_slot_probability.1)
    //           * (operator_stake / total_domain_stake) * u128::MAX
    Some(
        u128::MAX / u128::from(bundle_slot_probability.1) * u128::from(bundle_slot_probability.0)
            / total_domain_stake
            * operator_stake,
    )
}
```

3. The node-side election solver (operator) signs and checks VRF each slot using runtime-provided parameters:

```51:109:subspace/domains/client/domain-operator/src/bundle_producer_election_solver.rs
pub(super) fn solve_challenge(
    &self,
    slot: Slot,
    consensus_block_hash: CBlock::Hash,
    domain_id: DomainId,
    operator_id: OperatorId,
    proof_of_time: PotOutput,
) -> sp_blockchain::Result<Option<(ProofOfElection, OperatorPublicKey)>> {
    let BundleProducerElectionParams { total_domain_stake, bundle_slot_probability, .. } =
        match self.consensus_client.runtime_api().bundle_producer_election_params(consensus_block_hash, domain_id)? {
            Some(params) => params,
            None => return Ok(None),
        };
    ...
    if let Some((operator_signing_key, operator_stake)) =
        self.consensus_client.runtime_api().operator(consensus_block_hash, operator_id)?
    {
        ...
        if let Some(vrf_signature) = maybe_vrf_signature {
            let Some(threshold) = calculate_threshold(
                operator_stake,
                total_domain_stake,
                bundle_slot_probability,
            ) else { return Ok(None); };

            if is_below_threshold(&vrf_signature.pre_output, threshold) {
                let proof_of_election = ProofOfElection { ... };
                return Ok(Some((proof_of_election, operator_signing_key)));
            }
        }
    }
    Ok(None)
}
```

The runtime provides these parameters:

```2202:2215:subspace/crates/pallet-domains/src/lib.rs
pub fn bundle_producer_election_params(
    domain_id: DomainId,
) -> Option<BundleProducerElectionParams<BalanceOf<T>>> {
    match (
        DomainRegistry::<T>::get(domain_id),
        DomainStakingSummary::<T>::get(domain_id),
    ) {
        (Some(domain_object), Some(stake_summary)) => Some(BundleProducerElectionParams {
            total_domain_stake: stake_summary.current_total_stake,
            bundle_slot_probability: domain_object.domain_config.bundle_slot_probability,
        }),
        _ => None,
    }
}
```

`bundle_slot_probability` must satisfy `0 < num ≤ den` at domain instantiation:

```202:207:subspace/crates/pallet-domains/src/domain_registry.rs
// `bundle_slot_probability` must be `> 0` and `≤ 1`
let (numerator, denominator) = domain_config_params.bundle_slot_probability;
ensure!(
    numerator != 0 && denominator != 0 && numerator <= denominator,
    Error::InvalidSlotProbability
);
```

---

### Runtime validation and timing guards

Before a bundle is accepted, the runtime verifies:

- Domain not frozen; operator status valid; operator signature correct
- Anti-equivocation (no reusing slot across/within blocks)
- Slot/PoT recency window (`BundleLongevity`)
- Stake-weighted VRF proof under `bundle_slot_probability`

```2320:2381:subspace/crates/pallet-domains/src/lib.rs
fn validate_eligibility(
    to_sign: &[u8],
    signature: &OperatorSignature,
    proof_of_election: &ProofOfElection,
    domain_config: &DomainConfig<T::AccountId, BalanceOf<T>>,
    pre_dispatch: bool,
) -> Result<(), BundleError> {
    ... // status and signature checks

    // Anti-equivocation across blocks and within block
    ensure!(
        slot_number > Self::operator_highest_slot_from_previous_block(operator_id, pre_dispatch),
        BundleError::SlotSmallerThanPreviousBlockBundle,
    );
    ensure!(
        !OperatorBundleSlot::<T>::get(operator_id).contains(&slot_number),
        BundleError::EquivocatedBundle,
    );

    let (operator_stake, total_domain_stake) =
        Self::fetch_operator_stake_info(domain_id, &operator_id)?;

    Self::check_slot_and_proof_of_time(slot_number, proof_of_election.proof_of_time, pre_dispatch)?;

    sp_domains::bundle_producer_election::check_proof_of_election(
        &operator.signing_key,
        domain_config.bundle_slot_probability,
        proof_of_election,
        operator_stake.saturated_into(),
        total_domain_stake.saturated_into(),
    )?;
    Ok(())
}
```

Recency window and PoT verification:

```2238:2297:subspace/crates/pallet-domains/src/lib.rs
fn check_slot_and_proof_of_time(
    slot_number: u64,
    proof_of_time: PotOutput,
    pre_dispatch: bool,
) -> Result<(), BundleError> {
    let current_block_number = frame_system::Pallet::<T>::current_block_number();

    // Future slot guard (pre-dispatch)
    if pre_dispatch && let Some(future_slot) = T::BlockSlot::future_slot(current_block_number) {
        ensure!(slot_number <= *future_slot, BundleError::SlotInTheFuture)
    }

    // Past window guard based on T::BundleLongevity
    let produced_after_block_number = match T::BlockSlot::slot_produced_after(slot_number.into()) {
        Some(n) => n,
        None => {
            if current_block_number > T::BundleLongevity::get().into() {
                return Err(BundleError::SlotInThePast);
            } else { Zero::zero() }
        }
    };
    ...
    if let Some(last_eligible_block) = current_block_number.checked_sub(&T::BundleLongevity::get().into()) {
        ensure!(produced_after_block_number >= last_eligible_block, BundleError::SlotInThePast);
    }

    if !is_proof_of_time_valid(..., SlotNumber::from(slot_number), ..., !pre_dispatch) {
        return Err(BundleError::InvalidProofOfTime);
    }
    Ok(())
}
```

Highest prior slot tracking across blocks:

```3072:3091:subspace/crates/pallet-domains/src/lib.rs
// Get the highest slot of the bundle submitted by a given operator from the previous block
pub fn operator_highest_slot_from_previous_block(
    operator_id: OperatorId,
    pre_dispatch: bool,
) -> u64 {
    if pre_dispatch {
        OperatorHighestSlot::<T>::get(operator_id)
    } else {
        *OperatorBundleSlot::<T>::get(operator_id)
            .last()
            .unwrap_or(&OperatorHighestSlot::<T>::get(operator_id))
    }
}
```

---

### Expected bundle rate and per-bundle limits

The expected bundles per consensus block equals the ratio of domain bundle-slot probability to consensus slot probability; limits per bundle are scaled accordingly:

```710:744:subspace/crates/sp-domains/src/lib.rs
pub fn calculate_max_bundle_weight_and_size(
    max_domain_block_size: u32,
    max_domain_block_weight: Weight,
    consensus_slot_probability: (u64, u64),
    bundle_slot_probability: (u64, u64),
) -> Option<DomainBundleLimit> {
    // expected_bundles_per_block = (bundle_slot_probability / consensus_slot_probability)
    let expected_bundles_per_block = bundle_slot_probability
        .0
        .checked_mul(consensus_slot_probability.1)?
        .checked_div(
            bundle_slot_probability
                .1
                .checked_mul(consensus_slot_probability.0)?,
        )?;

    let max_proof_size = max_domain_block_weight.proof_size();
    let max_bundle_weight = max_domain_block_weight
        .checked_div(expected_bundles_per_block)?
        .set_proof_size(max_proof_size);

    let max_bundle size =
        (max_domain_block size as u64).checked_div(expected_bundles_per_block)? as u32;

    Some(DomainBundleLimit { max_bundle_size, max_bundle_weight })
}
```

---

### How bundles become domain blocks

- The first accepted bundle for a domain in a given consensus block advances the domain block height (subsequent accepted bundles in the same consensus block confirm the current head):

```1242:1259:subspace/crates/pallet-domains/src/lib.rs
// First accepted bundle for this domain in this consensus block => a domain block will be produced.
if SuccessfulBundles::<T>::get(domain_id).is_empty() {
    // Account for missed domain runtime upgrades (may create implicit domain blocks)
    let missed_upgrade = Self::missed_domain_runtime_upgrade(domain_id).map_err(Error::<T>::from)?;

    let next_number = HeadDomainNumber::<T>::get(domain_id)
        .checked_add(&One::one())?
        .checked_add(&missed_upgrade.into())?;
    ...
}
```

- Receipt acceptance categories:

```68:74:subspace/crates/pallet-domains/src/block_tree.rs
enum AcceptedReceiptType {
    // New head receipt that extend the longest branch
    NewHead,
    // Receipt that confirms the head receipt that added in the current block
    CurrentHead,
}
```

Additionally, the runtime enforces a small receipt gap (≤ 1) to avoid accepting stale branches.

---

### Impact on block times

Let `p` be the fraction of consensus blocks that include at least one accepted bundle for a domain (i.e., blocks that advance the domain). With consensus average inter-block time `E[C]`, the domain’s expected inter-block time is approximately:

- `E[D] ≈ E[C] / p`

Intuition: the domain clock ticks only on the subset of consensus blocks that carry a bundle; sparser bundle inclusion stretches the average. `BundleLongevity` and PoT checks keep bundles near the originating slots, preventing late arrivals from distorting timing.

---

### Key parameters to tune

- **Consensus timing**: average consensus block time sets the upper bound.
- **Bundle probability**: ensure `bundle_slot_probability` is aligned with consensus slot probability for ~1 bundle per consensus block.
- **Operator participation/stake distribution**: broader and more even stake increases steady bundle production.
- **Bundle limits**: verify `DomainBundleLimit { max_bundle_size, max_bundle_weight }` are not the bottleneck under expected load.
- **Longevity window**: `BundleLongevity` trades off acceptance window vs. tight timing.
