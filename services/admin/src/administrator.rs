//! The Benchmark Administrator: decrypt aggregates, prove, print; decrypt bids, match; attest
//! funding and repayment (demo policy). Nothing decrypted here is ever logged.

use std::time::Instant;

use anyhow::{anyhow, Result};
use solana_signer::Signer;
use tracing::{info, warn};
use window_clearing::{ask_allocation, clear, DepthCurve, Side, Tick, TICKS};
use window_client::{
    accounts, ix, pda, Bid, Epoch, EpochStatus, Loan, LoanStatus, MatchKind, Print, PrintStatus,
};
use window_elgamal::{bsgs::Solver, encrypt, Ciphertext, GroupedCiphertext2, Point};
use window_proofs::{ix as zk, pocd};

use crate::{
    chain::read,
    matching::{self, DecryptedBid},
    Ctx, Secret,
};

pub struct Administrator {
    solver: Solver,
}

impl Administrator {
    pub fn new(baby_bits: u8) -> Self {
        let t = Instant::now();
        let solver = Solver::build(baby_bits);
        info!(baby_bits, ms = t.elapsed().as_millis() as u64, "BSGS table built");
        Self { solver }
    }

    pub fn tick(&self, ctx: &Ctx) -> Result<()> {
        let chain = ctx.chain.as_ref();
        let disc = accounts::discriminator::<Epoch>();
        let mut epochs: Vec<Epoch> = chain
            .program_accounts(&window_client::programs::AUCTION, &disc)?
            .into_iter()
            .filter_map(|(_, d)| accounts::decode_epoch(&d))
            .collect();
        epochs.sort_by_key(|e| std::cmp::Reverse(e.index)); // newest first
        for e in epochs.iter().take(ctx.backfill_epochs) {
            match e.status {
                s if s == EpochStatus::Closed as u8 => {
                    if let Err(err) = self.print(ctx, e) {
                        ctx.metrics
                            .print_failures
                            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        warn!(epoch = e.index, "print failed: {err:#}");
                    }
                }
                s if s == EpochStatus::Printed as u8 => {
                    if let Err(err) = self.post_matches(ctx, e) {
                        warn!(epoch = e.index, "matching failed: {err:#}");
                    }
                }
                _ => {}
            }
        }
        self.attest_lifecycle(ctx)?;
        Ok(())
    }

    /// Decrypt → clear → begin/attest/finalize.
    fn print(&self, ctx: &Ctx, e: &Epoch) -> Result<()> {
        let chain = ctx.chain.as_ref();
        let admin = &ctx.keys.admin;
        let auditor = ctx.keys.auditor();
        let t0 = Instant::now();
        let mut curve = DepthCurve::default();
        let mut claims: Vec<(Side, u8, u64)> = Vec::new();
        for side in [Side::Ask, Side::Bid] {
            for t in 0..TICKS {
                let n = e.bid_count[side.index()][t];
                if n == 0 {
                    continue;
                }
                let acc = Ciphertext {
                    commitment: Point(e.acc_commitment[side.index()][t]),
                    handle: Point(e.acc_handle[side.index()][t]),
                };
                let v = self.solver.decrypt(&auditor, &acc, (n as u64) << 40).ok_or_else(|| {
                    anyhow!("aggregate at side {:?} tick {t} did not decrypt", side)
                })?;
                if side == Side::Ask {
                    curve.ask[t] = v;
                } else {
                    curve.bid[t] = v;
                }
                claims.push((side, t as u8, v));
            }
        }
        let clearing = clear(&curve).map_err(|_| anyhow!("clearing overflow"))?;
        let mut txs = 0u64;
        let print_exists =
            chain.account_data(&pda::print(e.index))?.map(|d| accounts::decode_print(&d)).is_some();
        let existing = if print_exists {
            chain.account_data(&pda::print(e.index))?.and_then(|d| accounts::decode_print(&d))
        } else {
            None
        };
        if existing.is_none() {
            chain.send(admin, &[ix::begin_print(&admin.pubkey(), e.index)], &[])?;
            txs += 1;
        }
        let proven = existing.map(|p| p.proven_bitmap).unwrap_or([0u8; 10]);
        let batch = ctx.profile.print.attest_batch as usize;
        let pending: Vec<_> = claims
            .iter()
            .filter(|(s, t, _)| {
                !window_client::print_bits::get_bit(
                    &proven,
                    window_client::print_bits::bit_index(s.index(), *t as usize),
                )
            })
            .cloned()
            .collect();
        for chunk in pending.chunks(batch.max(1)) {
            let mut ixs = Vec::with_capacity(chunk.len() + 1);
            for (side, t, sum) in chunk {
                let acc = Ciphertext {
                    commitment: Point(e.acc_commitment[side.index()][*t as usize]),
                    handle: Point(e.acc_handle[side.index()][*t as usize]),
                };
                ixs.push(zk::verify_inline(&pocd::build(&auditor, &acc, *sum)?));
            }
            ixs.push(ix::attest_ticks(&admin.pubkey(), e.index, chunk));
            chain.send(admin, &ixs, &[])?;
            txs += 1;
        }
        let r_star = clearing.map(|c| c.r_star.get());
        chain.send(admin, &[ix::finalize_print(&admin.pubkey(), e.index, r_star)], &[])?;
        txs += 1;
        let ms = t0.elapsed().as_millis() as u64;
        ctx.metrics.prints.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        ctx.metrics.print_txs.fetch_add(txs, std::sync::atomic::Ordering::Relaxed);
        ctx.metrics.last_print_ms.store(ms, std::sync::atomic::Ordering::Relaxed);
        if let Some(r) = r_star {
            ctx.metrics.last_r_star_bps.store(
                Tick::new(r).map(|t| t.bps() as u64).unwrap_or(0),
                std::sync::atomic::Ordering::Relaxed,
            );
        }
        // Aggregates are public; individual sizes never appear here.
        info!(epoch = e.index, nonzero_ticks = claims.len(), txs, ms, r_star_tick = ?r_star, matched = clearing.map(|c| c.matched), "printed");
        Ok(())
    }

    /// Decrypt every bid of the epoch (auditor handle), compute matches, post them.
    fn post_matches(&self, ctx: &Ctx, e: &Epoch) -> Result<()> {
        let chain = ctx.chain.as_ref();
        let admin = &ctx.keys.admin;
        let Some(print) =
            chain.account_data(&pda::print(e.index))?.and_then(|d| accounts::decode_print(&d))
        else {
            return Ok(());
        };
        if print.status != PrintStatus::Printed as u8 || print.matches_posted > 0 {
            return Ok(());
        }
        // Idempotence without an on-chain counter: if any loan for this epoch exists, skip.
        let loan_disc = accounts::discriminator::<Loan>();
        if chain
            .program_accounts(&window_client::programs::CREDIT, &loan_disc)?
            .into_iter()
            .filter_map(|(_, d)| accounts::decode::<Loan>(&d))
            .any(|l| l.epoch == e.index)
        {
            return Ok(());
        }
        let auditor = ctx.keys.auditor();
        let bid_disc = accounts::discriminator::<Bid>();
        let mut bids = Vec::new();
        for (_, d) in chain.program_accounts(&window_client::programs::AUCTION, &bid_disc)? {
            let Some(b) = accounts::decode::<Bid>(&d) else { continue };
            if b.epoch != e.index {
                continue;
            }
            let ct = GroupedCiphertext2::from_bytes(&b.ciphertext)
                .to_ciphertext(1)
                .ok_or_else(|| anyhow!("bid handles"))?;
            let size = self
                .solver
                .decrypt(&auditor, &ct, 1u64 << 40)
                .ok_or_else(|| anyhow!("bid did not decrypt"))?;
            let side = if b.side == 0 { Side::Ask } else { Side::Bid };
            bids.push(DecryptedBid {
                member: b.member,
                side,
                tick: b.tick,
                size: Secret::new(size),
            });
        }
        let mut curve = DepthCurve::default();
        for s in 0..2 {
            for t in 0..TICKS {
                if s == 0 {
                    curve.ask[t] = print.claimed_sum[0][t]
                } else {
                    curve.bid[t] = print.claimed_sum[1][t]
                }
            }
        }
        let Some(cl) = clear(&curve).map_err(|_| anyhow!("overflow"))? else { return Ok(()) };
        let alloc = ask_allocation(&curve, &cl).map_err(|_| anyhow!("overflow"))?;
        let matches = matching::compute(&bids, &cl, &alloc);
        let auditor_pk = auditor.pubkey_bytes();
        let mut posted = 0u64;
        for m in &matches {
            let (kind, ctx_acc, setup) = if m.full {
                (MatchKind::Full, None, None)
            } else {
                // A partial fill: a fresh (borrower, auditor) ciphertext of the part, proven valid.
                let member = read::<window_client::Member>(chain, &pda::member(&m.borrower))?
                    .ok_or_else(|| anyhow!("member"))?;
                let opening = encrypt::Opening::random();
                let ct = encrypt::grouped2_with(
                    &member.elgamal_pubkey,
                    &auditor_pk,
                    *m.size.expose(),
                    &opening,
                )?;
                let sdk_ct = solana_zk_sdk::encryption::grouped_elgamal::GroupedElGamalCiphertext::<2>::from_bytes(&ct.to_bytes()).ok_or_else(|| anyhow!("ct"))?;
                let bpk = window_elgamal::keys::pubkey_from_bytes(&member.elgamal_pubkey)?;
                let apk = window_elgamal::keys::pubkey_from_bytes(&auditor_pk)?;
                let validity = solana_zk_sdk::zk_elgamal_proof_program::build_grouped_ciphertext_2_handles_validity_proof_data(&bpk, &apk, &sdk_ct, *m.size.expose(), &opening.0)?;
                let ctx_kp = solana_keypair::Keypair::new();
                let rent = chain.rent(zk::context_size::<solana_zk_elgamal_proof_interface::proof_data::GroupedCiphertext2HandlesValidityProofContext>())?;
                let [c, v] = zk::create_and_verify(
                    &admin.pubkey(),
                    &ctx_kp.pubkey(),
                    &admin.pubkey(),
                    rent,
                    &validity,
                );
                chain.send(admin, &[c, v], &[&ctx_kp])?;
                // Seal the opening to the borrower so it can prove solvency for this part.
                let loan_key = pda::loan(e.index, &m.borrower, m.bid_tick, m.k);
                let shared = window_elgamal::note::shared_secret(&auditor, &member.elgamal_pubkey)?;
                let opening_note =
                    window_elgamal::note::seal(&opening.0.to_bytes(), &shared, loan_key.as_ref());
                (
                    MatchKind::Partial { size_ct: ct.to_bytes(), opening_note },
                    Some(ctx_kp.pubkey()),
                    Some(()),
                )
            };
            let _ = setup;
            chain.send(
                admin,
                &[ix::post_match(
                    &admin.pubkey(),
                    e.index,
                    &m.borrower,
                    m.bid_tick,
                    &m.lender,
                    m.ask_tick,
                    m.k,
                    kind,
                    ctx_acc,
                )],
                &[],
            )?;
            posted += 1;
        }
        ctx.metrics.matches_posted.fetch_add(posted, std::sync::atomic::Ordering::Relaxed);
        info!(epoch = e.index, matches = posted, "matches posted");
        Ok(())
    }

    /// Demo attestation policy (spec v2 §14 "funding magnitude attested"): a Locked loan is
    /// attested funded; an Active loan is attested repaid after half its tenor, except every
    /// `default_every`-th, which is left to mature and be seized.
    fn attest_lifecycle(&self, ctx: &Ctx) -> Result<()> {
        let chain = ctx.chain.as_ref();
        let admin = &ctx.keys.admin;
        let slot = chain.slot()?;
        let disc = accounts::discriminator::<Loan>();
        for (key, data) in chain.program_accounts(&window_client::programs::CREDIT, &disc)? {
            let Some(loan) = accounts::decode::<Loan>(&data) else { continue };
            if loan.status == LoanStatus::Locked as u8 {
                chain.send(admin, &[ix::confirm_funding(&admin.pubkey(), &key)], &[])?;
                info!(loan = %key, "funding attested");
            } else if loan.status == LoanStatus::Active as u8 {
                let leave_to_default = ctx.default_every > 0
                    && (loan.epoch as usize + loan.k as usize) % ctx.default_every
                        == ctx.default_every - 1;
                if !leave_to_default
                    && slot >= loan.funded_slot + ctx.profile.market.tenor_slots / 2
                {
                    chain.send(admin, &[ix::repay(&admin.pubkey(), &key)], &[])?;
                    info!(loan = %key, "repayment attested");
                }
            }
        }
        Ok(())
    }
}

/// Re-exported for the agents (same table shape).
pub fn solver(baby_bits: u8) -> Solver {
    Solver::build(baby_bits)
}

#[allow(dead_code)]
fn _print_type_check(_: &Print) {}
