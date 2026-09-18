//! Simulated members (labelled "simulated" everywhere): lenders ladder asks around the last
//! rate, borrowers bid above it, and borrowers complete the lock + deposit for their loans. They
//! use exactly the client paths a judge's wallet uses.

use std::{collections::BTreeMap, path::PathBuf};

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use tracing::{debug, info, warn};
use window_clearing::Side;
use window_client::{
    accounts, ct, ix, pda, AuctionConfig, Loan, LoanStatus, OracleState, PriceCache,
};
use window_elgamal::encrypt::Opening;
use window_proofs::{
    bid as bid_proofs, ix as zk, scalar,
    solvency::{self, SolvencyInputs},
};

use crate::{chain::read, deployment::ListingRecord, keys::Keys, Ctx};

/// What a borrower must remember to lock later: its bid's size and opening.
#[derive(Serialize, Deserialize, Default)]
struct AgentMemory {
    /// key: "epoch/tick" → (size, opening hex)
    bids: BTreeMap<String, (u64, String)>,
    /// tracked confidential available balance per agent index
    available: BTreeMap<usize, u64>,
    wrapped_once: BTreeMap<usize, bool>,
}

pub struct Agents {
    memory: AgentMemory,
    path: PathBuf,
    rng: u64,
    /// For reading a partial-fill loan size with the agent's own key (bounded by its bid size).
    solver: window_elgamal::bsgs::Solver,
    /// Why a pending loan was last skipped, so the reason is logged once, not every tick.
    warned: BTreeMap<Pubkey, &'static str>,
}

/// The memory key of one agent's bid. Scoped by agent: the memory is shared by every simulated
/// member, and an unscoped key let the first agent to draw a tick silence the others (and let a
/// borrower pick up another borrower's opening).
fn bid_key(agent: usize, epoch: u64, side: u8, tick: u8) -> String {
    format!("{agent}/{epoch}/{side}/{tick}")
}

/// The key bids were stored under before agents were scoped, so loans matched from those bids
/// still find their opening.
fn legacy_bid_key(epoch: u64, side: u8, tick: u8) -> String {
    format!("{epoch}/{side}/{tick}")
}

/// Drops the wrap/balance memory of `agents` (after `listings-sync` moved them to another listing)
/// so they wrap the new collateral on their next tick. Bid openings are kept.
pub fn forget_wrap(root: &std::path::Path, cluster: &str, agents: &[usize]) {
    let path = root.join("services/admin/data").join(format!("agents-{cluster}.json"));
    let Some(mut memory) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<AgentMemory>(&s).ok())
    else {
        return;
    };
    for i in agents {
        memory.wrapped_once.remove(i);
        memory.available.remove(i);
    }
    if let Ok(s) = serde_json::to_string_pretty(&memory) {
        let _ = std::fs::write(&path, s);
    }
}

impl Agents {
    pub fn load(root: &std::path::Path, cluster: &str) -> Self {
        let dir = root.join("services/admin/data");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(format!("agents-{cluster}.json"));
        let memory = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        // Seeded from the clock so a restart does not replay the same ticks and sizes.
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
            | 1;
        Self {
            memory,
            path,
            rng: seed ^ 0x2545F4914F6CDD1D,
            solver: window_elgamal::bsgs::Solver::build(16),
            warned: BTreeMap::new(),
        }
    }
    fn save(&self) {
        if let Ok(s) = serde_json::to_string_pretty(&self.memory) {
            let _ = std::fs::write(&self.path, s);
        }
    }
    fn rand(&mut self, n: u64) -> u64 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        self.rng % n
    }

    /// One tick, in two passes: every agent quotes first (a window is short and a bid is three
    /// transactions), then the borrowers service their loans (a scan of every loan plus proofs
    /// and up to nine transactions each — long enough to outlast a window, which is why it must
    /// never sit between two agents' bids). One agent's failure is logged and never stops the rest.
    pub fn tick(&mut self, ctx: &Ctx, keys: &Keys) -> Result<()> {
        let chain = ctx.chain.as_ref();
        let Some(config) = read::<AuctionConfig>(chain, &pda::auction_config())? else {
            return Ok(());
        };
        let last_tick = read::<OracleState>(chain, &pda::oracle_state())?
            .filter(|s| s.has_printed)
            .map(|s| s.last_r_star_tick)
            .unwrap_or(12);
        let auditor_pk = keys.auditor().pubkey_bytes();
        let agents = ctx.deployment.agents.clone();
        for rec in &agents {
            if let Err(e) = self.quote(ctx, keys, rec, &config, last_tick, &auditor_pk) {
                warn!(agent = rec.index, "quoting failed: {e:#}");
            }
        }
        for rec in agents.iter().filter(|r| r.role == "borrower") {
            let i = rec.index;
            let listing = match ctx.deployment.listing_of(rec) {
                Ok(l) => l.clone(),
                Err(e) => {
                    warn!(agent = i, "loan service skipped: {e:#}");
                    continue;
                }
            };
            let cstock_acc: Pubkey = match rec.cstock_account.parse() {
                Ok(k) => k,
                Err(e) => {
                    warn!(agent = i, "loan service skipped: bad cstock account: {e}");
                    continue;
                }
            };
            let wallet = keys.agent_wallet(i);
            let eg = keys.agent_elgamal(i);
            let tkeys = keys.agent_token_keys(i);
            if let Err(e) = self.serve_loans(
                ctx,
                keys,
                i,
                &wallet,
                &eg,
                &tkeys,
                &cstock_acc,
                &auditor_pk,
                &listing,
            ) {
                warn!(agent = i, "loan service failed: {e:#}");
            }
        }
        Ok(())
    }

    /// Pass 1 for one agent: the one-time wrap (borrowers) and at most one new bid per tick.
    fn quote(
        &mut self,
        ctx: &Ctx,
        keys: &Keys,
        rec: &crate::deployment::AgentRecord,
        config: &AuctionConfig,
        last_tick: u8,
        auditor_pk: &[u8; 32],
    ) -> Result<()> {
        let chain = ctx.chain.as_ref();
        let i = rec.index;
        let listing = ctx.deployment.listing_of(rec)?.clone();
        let cstock: Pubkey = listing.cstock_mint()?;
        let mock: Pubkey = listing.mock_mint()?;
        let wallet = keys.agent_wallet(i);
        let eg = keys.agent_elgamal(i);
        let tkeys = keys.agent_token_keys(i);
        let cstock_acc: Pubkey = rec.cstock_account.parse()?;
        let mock_acc: Pubkey = rec.mock_account.parse()?;
        // one-time wrap so borrowers have confidential collateral (public leg, documented)
        if rec.role == "borrower" && !self.memory.wrapped_once.get(&i).copied().unwrap_or(false) {
            let amount = 20_000_000u64; // 20,000.000 shares
            chain.send(
                &wallet,
                &[ix::wrap(&wallet.pubkey(), &mock, &cstock, &mock_acc, &cstock_acc, amount)],
                &[],
            )?;
            let state = ct::confidential_state(
                &chain.account_data(&cstock_acc)?.ok_or_else(|| anyhow!("acc"))?,
            )
            .ok_or_else(|| anyhow!("ext"))?;
            chain.send(
                &wallet,
                &[ct::apply_pending_balance(&cstock_acc, &wallet.pubkey(), &state, &tkeys, amount)],
                &[],
            )?;
            self.memory.available.insert(i, amount);
            self.memory.wrapped_once.insert(i, true);
            self.save();
            info!(agent = i, "borrower wrapped collateral (simulated)");
        }
        // One bid per (epoch, side, tick) — an agent's tick is drawn from a narrow band around
        // the last print, so over an epoch it ends up quoting a handful of adjacent ticks and
        // then stops. Never in the epoch's last slots, to avoid racing the close.
        let epoch_open = config.has_open_epoch
            && chain
                .account_data(&pda::epoch(config.current_epoch))?
                .and_then(|d| accounts::decode_epoch(&d))
                .map(|e| {
                    e.status == window_client::EpochStatus::Open as u8
                        && chain.slot().unwrap_or(0) + 3 < e.start_slot + config.epoch_slots
                })
                .unwrap_or(false);
        if !epoch_open {
            return Ok(());
        }
        let epoch = config.current_epoch;
        let (side, tick) = if rec.role == "lender" {
            (Side::Ask, (last_tick as i64 - 2 + self.rand(4) as i64).clamp(0, 36) as u8)
        } else {
            (Side::Bid, (last_tick as i64 + 1 + self.rand(4) as i64).clamp(0, 36) as u8)
        };
        let key = bid_key(i, epoch, side as u8, tick);
        if !self.memory.bids.contains_key(&key)
            && chain.account_data(&pda::bid(epoch, &wallet.pubkey(), side as u8, tick))?.is_none()
        {
            let size = (100 + self.rand(2_000)) * 1_000_000; // 100–2,100 USDC
            if let Err(e) =
                self.submit_bid(ctx, i, &wallet, &eg, auditor_pk, epoch, side, tick, size)
            {
                warn!(agent = i, "bid failed: {e:#}");
            } else {
                self.save();
                info!(agent = i, epoch, side = ?side, tick, "bid submitted (simulated)");
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn submit_bid(
        &mut self,
        ctx: &Ctx,
        agent: usize,
        wallet: &Keypair,
        eg: &window_elgamal::keys::Keypair,
        auditor_pk: &[u8; 32],
        epoch: u64,
        side: Side,
        tick: u8,
        size: u64,
    ) -> Result<()> {
        let chain = ctx.chain.as_ref();
        let proofs =
            bid_proofs::build(eg, auditor_pk, size, ctx.profile.market.bid_min_micro_usdc)?;
        let range_ctx = Keypair::new();
        let rent = chain.rent(zk::context_size::<
            solana_zk_elgamal_proof_interface::proof_data::BatchedRangeProofContext,
        >())?;
        let [create, verify] = zk::create_and_verify(
            &wallet.pubkey(),
            &range_ctx.pubkey(),
            &wallet.pubkey(),
            rent,
            &proofs.range,
        );
        chain.send(wallet, &[create], &[&range_ctx])?;
        chain.send(wallet, &[verify], &[])?;
        chain.send(
            wallet,
            &[
                zk::verify_inline(&proofs.validity),
                ix::submit_bid(&wallet.pubkey(), epoch, side, tick, &range_ctx.pubkey()),
            ],
            &[],
        )?;
        // remember the opening for the solvency proof
        let key = bid_key(agent, epoch, side as u8, tick);
        self.memory.bids.insert(key, (size, hex::encode(proofs.opening.0.to_bytes())));
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn serve_loans(
        &mut self,
        ctx: &Ctx,
        keys: &Keys,
        i: usize,
        wallet: &Keypair,
        eg: &window_elgamal::keys::Keypair,
        tkeys: &ct::ConfidentialKeys,
        cstock_acc: &Pubkey,
        auditor_pk: &[u8; 32],
        listing: &ListingRecord,
    ) -> Result<()> {
        let chain = ctx.chain.as_ref();
        let disc = accounts::discriminator::<Loan>();
        for (key, data) in chain.program_accounts(&window_client::programs::CREDIT, &disc)? {
            let Some(loan) = accounts::decode::<Loan>(&data) else { continue };
            if loan.borrower != wallet.pubkey() {
                continue;
            }
            if loan.status == LoanStatus::Pending as u8 {
                let scoped = bid_key(i, loan.epoch, 1, loan.bid_tick);
                let legacy = legacy_bid_key(loan.epoch, 1, loan.bid_tick);
                let Some((bid_size, opening_hex)) = self
                    .memory
                    .bids
                    .get(&scoped)
                    .or_else(|| self.memory.bids.get(&legacy))
                    .cloned()
                else {
                    continue;
                };
                if opening_hex.is_empty() {
                    continue;
                }
                // Full fill: the loan carries our own bid ciphertext, so our stored opening
                // applies and we already know the size. Partial fill: the administrator sealed the
                // part's opening to us (ECDH one-time pad) and we recover the size from the
                // ciphertext with our own key (bounded BSGS). A zero note means a full fill —
                // read from the loan itself, because by now the keeper may have reclaimed the
                // bid's rent with the permissionless `close_bid`.
                let full_fill = loan.opening_note == [0u8; 32];
                let (loan_size, opening) = if full_fill {
                    (
                        bid_size,
                        Opening(
                            solana_zk_sdk::encryption::pedersen::PedersenOpening::from_bytes(
                                &hex::decode(&opening_hex)?,
                            )
                            .ok_or_else(|| anyhow!("opening"))?,
                        ),
                    )
                } else {
                    let auditor_pk = read::<AuctionConfig>(chain, &pda::auction_config())?
                        .ok_or_else(|| anyhow!("config"))?
                        .auditor_elgamal_pubkey;
                    let shared = window_elgamal::note::shared_secret(eg, &auditor_pk)?;
                    let bytes =
                        window_elgamal::note::open(&loan.opening_note, &shared, key.as_ref())
                            .ok_or_else(|| anyhow!("opening note"))?;
                    let opening = Opening(
                        solana_zk_sdk::encryption::pedersen::PedersenOpening::from_bytes(&bytes)
                            .ok_or_else(|| anyhow!("opening"))?,
                    );
                    let part_ct = window_elgamal::GroupedCiphertext2::from_bytes(&loan.size_ct)
                        .to_ciphertext(0)
                        .ok_or_else(|| anyhow!("ct"))?;
                    let part = self
                        .solver
                        .decrypt(eg, &part_ct, bid_size)
                        .ok_or_else(|| anyhow!("part size"))?;
                    (part, opening)
                };
                let feed_id = listing.feed_id();
                let listing_pda = listing.listing_pda()?;
                let price = read::<PriceCache>(chain, &pda::price_cache(&feed_id))?
                    .ok_or_else(|| anyhow!("price"))?;
                // The program would refuse this lock; do not spend rent on proof contexts for it.
                let now = chain.unix_timestamp()?;
                let quote_age = now.saturating_sub(price.publish_time);
                let post_age = chain.slot()?.saturating_sub(price.posted_slot);
                if quote_age > listing.max_publish_age_secs
                    || post_age > listing.max_price_age_slots
                {
                    if self.warned.insert(key, "price not usable") != Some("price not usable") {
                        warn!(agent = i, loan = %key, listing = %listing.symbol, quote_age, post_age, "price not usable on chain; not locking (retrying quietly)");
                    } else {
                        debug!(agent = i, loan = %key, quote_age, post_age, "price still not usable");
                    }
                    continue;
                }
                let mock: Pubkey = listing.mock_mint()?;
                let mint_data = chain.account_data(&mock)?.ok_or_else(|| anyhow!("mint"))?;
                let mult = mint_multiplier(&mint_data, chain.unix_timestamp()?)?;
                let p = scalar::price_scaled(price.price, price.expo)
                    .ok_or_else(|| anyhow!("price scale"))?;
                let a = scalar::multiplier_scaled(mult).ok_or_else(|| anyhow!("mult scale"))?;
                let scalars = scalar::solvency_scalars(p, a, listing.haircut_bps)
                    .ok_or_else(|| anyhow!("scalars"))?;
                // pledge: 160% of the requirement so a small price move does not strand the loan
                let need_milli = ((loan_size as u128 * scalars.k_l as u128 * 16 / 10)
                    / scalars.k_c as u128) as u64
                    + 1;
                let available = self.memory.available.get(&i).copied().unwrap_or(0);
                if need_milli > available {
                    if self.warned.insert(key, "not enough collateral")
                        != Some("not enough collateral")
                    {
                        warn!(agent = i, loan = %key, need_milli, available, "not enough collateral for this loan; skipping (retrying quietly)");
                    }
                    continue;
                }
                let claim = solvency::build_collateral(eg, auditor_pk, need_milli)?;
                let ec = claim.ciphertext.to_ciphertext(0).ok_or_else(|| anyhow!("ct"))?;
                let el = window_elgamal::GroupedCiphertext2::from_bytes(&loan.size_ct)
                    .to_ciphertext(0)
                    .ok_or_else(|| anyhow!("ct"))?;
                let pair = solvency::build(
                    eg,
                    &SolvencyInputs {
                        collateral: &ec,
                        c: need_milli,
                        c_opening: &claim.opening,
                        loan: &el,
                        l: loan_size,
                        l_opening: &opening,
                    },
                    &scalars,
                )?;
                // four contexts
                let ctxs: Vec<Keypair> = (0..4).map(|_| Keypair::new()).collect();
                use solana_zk_elgamal_proof_interface::proof_data::{
                    BatchedRangeProofContext, CiphertextCommitmentEqualityProofContext,
                    GroupedCiphertext2HandlesValidityProofContext,
                };
                let [c0, v0] = zk::create_and_verify(
                    &wallet.pubkey(),
                    &ctxs[0].pubkey(),
                    &wallet.pubkey(),
                    chain
                        .rent(zk::context_size::<GroupedCiphertext2HandlesValidityProofContext>())?,
                    &claim.validity,
                );
                let [c1, v1] = zk::create_and_verify(
                    &wallet.pubkey(),
                    &ctxs[1].pubkey(),
                    &wallet.pubkey(),
                    chain.rent(zk::context_size::<BatchedRangeProofContext>())?,
                    &claim.range,
                );
                let [c2, v2] = zk::create_and_verify(
                    &wallet.pubkey(),
                    &ctxs[2].pubkey(),
                    &wallet.pubkey(),
                    chain.rent(zk::context_size::<CiphertextCommitmentEqualityProofContext>())?,
                    &pair.equality,
                );
                let [c3, v3] = zk::create_and_verify(
                    &wallet.pubkey(),
                    &ctxs[3].pubkey(),
                    &wallet.pubkey(),
                    chain.rent(zk::context_size::<BatchedRangeProofContext>())?,
                    &pair.range,
                );
                // The proofs were built against one quote; if the keeper posted a new one meanwhile
                // (the mock walks on every post), the program would compute a different E_delta and
                // refuse them — skip this tick rather than spend rent on contexts that cannot verify.
                let fresh = read::<PriceCache>(chain, &pda::price_cache(&feed_id))?
                    .ok_or_else(|| anyhow!("price"))?;
                if fresh.price != price.price || fresh.expo != price.expo {
                    debug!(agent = i, loan = %key, "quote moved while proving; retrying next tick");
                    continue;
                }
                chain.send(wallet, &[c0, v0, c2, v2], &[&ctxs[0], &ctxs[2]])?;
                chain.send(wallet, &[c1], &[&ctxs[1]])?;
                chain.send(wallet, &[v1], &[])?;
                chain.send(wallet, &[c3], &[&ctxs[3]])?;
                chain.send(wallet, &[v3], &[])?;
                let lc = ix::LockContexts {
                    validity: ctxs[0].pubkey(),
                    range32: ctxs[1].pubkey(),
                    equality: ctxs[2].pubkey(),
                    range64: ctxs[3].pubkey(),
                };
                chain.send(
                    wallet,
                    &[ix::lock_collateral(
                        &wallet.pubkey(),
                        &key,
                        &listing_pda,
                        &feed_id,
                        &mock,
                        &lc,
                    )],
                    &[],
                )?;
                self.warned.remove(&key);
                info!(agent = i, loan = %key, "collateral locked (priced proof)");
                // deposit: confidential transfer into escrow + deposit_collateral
                let escrow: Pubkey = listing.escrow()?;
                let cstock: Pubkey = listing.cstock_mint()?;
                let state = ct::confidential_state(
                    &chain.account_data(cstock_acc)?.ok_or_else(|| anyhow!("acc"))?,
                )
                .ok_or_else(|| anyhow!("ext"))?;
                let escrow_state = ct::confidential_state(
                    &chain.account_data(&escrow)?.ok_or_else(|| anyhow!("escrow"))?,
                )
                .ok_or_else(|| anyhow!("ext"))?;
                let dest_pk = escrow_state.elgamal_pubkey.try_into().map_err(|_| anyhow!("key"))?;
                let auditor = keys.auditor();
                let rent = |space: usize| chain.rent(space).unwrap_or(0);
                let plan = ct::transfer_plan(
                    &wallet.pubkey(),
                    cstock_acc,
                    &state,
                    tkeys,
                    available,
                    &cstock,
                    &escrow,
                    &dest_pk,
                    Some(auditor.pubkey()),
                    need_milli,
                    &rent,
                )
                .map_err(|e| anyhow!(e))?;
                for tx in &plan.setup {
                    chain.send(
                        wallet,
                        &tx.instructions,
                        &tx.extra_signers.iter().collect::<Vec<_>>(),
                    )?;
                }
                chain.send(
                    wallet,
                    &[
                        plan.transfer,
                        ix::deposit_collateral(&wallet.pubkey(), &key, &listing_pda, cstock_acc),
                    ],
                    &[],
                )?;
                chain.send(wallet, &plan.close, &[])?;
                self.memory.available.insert(i, available - need_milli);
                self.save();
                info!(agent = i, loan = %key, "collateral deposited into escrow");
            }
        }
        Ok(())
    }
}

fn mint_multiplier(data: &[u8], now: i64) -> Result<f64> {
    use spl_token_2022_interface::extension::{
        scaled_ui_amount::ScaledUiAmountConfig, BaseStateWithExtensions, StateWithExtensions,
    };
    let state = StateWithExtensions::<spl_token_2022_interface::state::Mint>::unpack(data)?;
    let cfg = state.get_extension::<ScaledUiAmountConfig>()?;
    let eff: i64 = cfg.new_multiplier_effective_timestamp.into();
    Ok(if now >= eff { cfg.new_multiplier.into() } else { cfg.multiplier.into() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bid_keys_are_scoped_by_agent_and_legacy_keys_still_resolve() {
        assert_eq!(bid_key(2, 263, 0, 29), "2/263/0/29");
        assert_ne!(bid_key(0, 263, 0, 29), bid_key(2, 263, 0, 29));
        assert_eq!(legacy_bid_key(263, 1, 33), "263/1/33");
        let mut m = AgentMemory::default();
        m.bids.insert(legacy_bid_key(263, 1, 33), (1, "aa".into()));
        m.bids.insert(bid_key(3, 264, 1, 18), (2, "bb".into()));
        let lookup = |agent: usize, epoch: u64, tick: u8| {
            m.bids
                .get(&bid_key(agent, epoch, 1, tick))
                .or_else(|| m.bids.get(&legacy_bid_key(epoch, 1, tick)))
                .map(|(s, _)| *s)
        };
        assert_eq!(lookup(3, 264, 18), Some(2));
        assert_eq!(lookup(1, 263, 33), Some(1), "an outstanding loan finds its legacy opening");
        assert_eq!(lookup(1, 264, 18), None, "another agent's bid is not ours");
    }
}
