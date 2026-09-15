//! Simulated members (labelled "simulated" everywhere): lenders ladder asks around the last
//! rate, borrowers bid above it, and borrowers complete the lock + deposit for their loans. They
//! use exactly the client paths a judge's wallet uses.

use std::{collections::BTreeMap, path::PathBuf};

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use tracing::{info, warn};
use window_clearing::Side;
use window_client::{
    accounts, ct, ix, pda, AuctionConfig, Bid, Loan, LoanStatus, OracleState, PriceCache,
};
use window_elgamal::encrypt::Opening;
use window_proofs::{
    bid as bid_proofs, ix as zk, scalar,
    solvency::{self, SolvencyInputs},
};

use crate::{chain::read, keys::Keys, Ctx};

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
        Self {
            memory,
            path,
            rng: 0x2545F4914F6CDD1D,
            solver: window_elgamal::bsgs::Solver::build(16),
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

    pub fn tick(&mut self, ctx: &Ctx, keys: &Keys) -> Result<()> {
        let chain = ctx.chain.as_ref();
        let Some(config) = read::<AuctionConfig>(chain, &pda::auction_config())? else {
            return Ok(());
        };
        let last_tick = read::<OracleState>(chain, &pda::oracle_state())?
            .filter(|s| s.has_printed)
            .map(|s| s.last_r_star_tick)
            .unwrap_or(12);
        let cstock: Pubkey = ctx.deployment.cstock_mint.parse()?;
        let mock: Pubkey = ctx.deployment.mock_mint.parse()?;
        let auditor_pk = keys.auditor().pubkey_bytes();
        for rec in ctx.deployment.agents.clone() {
            let i = rec.index;
            let wallet = keys.agent_wallet(i);
            let eg = keys.agent_elgamal(i);
            let tkeys = keys.agent_token_keys(i);
            let cstock_acc: Pubkey = rec.cstock_account.parse()?;
            let mock_acc: Pubkey = rec.mock_account.parse()?;
            // one-time wrap so borrowers have confidential collateral (public leg, documented)
            if rec.role == "borrower" && !self.memory.wrapped_once.get(&i).copied().unwrap_or(false)
            {
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
                    &[ct::apply_pending_balance(
                        &cstock_acc,
                        &wallet.pubkey(),
                        &state,
                        &tkeys,
                        amount,
                    )],
                    &[],
                )?;
                self.memory.available.insert(i, amount);
                self.memory.wrapped_once.insert(i, true);
                self.save();
                info!(agent = i, "borrower wrapped collateral (simulated)");
            }
            // bid once per open epoch (and not in its last slots, to avoid racing the close)
            let epoch_open = config.has_open_epoch
                && chain
                    .account_data(&pda::epoch(config.current_epoch))?
                    .and_then(|d| accounts::decode_epoch(&d))
                    .map(|e| {
                        e.status == window_client::EpochStatus::Open as u8
                            && chain.slot().unwrap_or(0) + 3 < e.start_slot + config.epoch_slots
                    })
                    .unwrap_or(false);
            if epoch_open {
                let epoch = config.current_epoch;
                let (side, tick) = if rec.role == "lender" {
                    (Side::Ask, (last_tick as i64 - 2 + self.rand(4) as i64).clamp(0, 36) as u8)
                } else {
                    (Side::Bid, (last_tick as i64 + 1 + self.rand(4) as i64).clamp(0, 36) as u8)
                };
                let key = format!("{epoch}/{}/{tick}", side as u8);
                if !self.memory.bids.contains_key(&key)
                    && chain
                        .account_data(&pda::bid(epoch, &wallet.pubkey(), side as u8, tick))?
                        .is_none()
                {
                    let size = (100 + self.rand(2_000)) * 1_000_000; // 100–2,100 USDC
                    if let Err(e) =
                        self.submit_bid(ctx, &wallet, &eg, &auditor_pk, epoch, side, tick, size)
                    {
                        warn!(agent = i, "bid failed: {e:#}");
                    } else {
                        self.save();
                        info!(agent = i, epoch, side = ?side, tick, "bid submitted (simulated)");
                    }
                }
            }
            // borrowers: lock + deposit pending loans they can prove
            if rec.role == "borrower" {
                if let Err(e) =
                    self.serve_loans(ctx, keys, i, &wallet, &eg, &tkeys, &cstock_acc, &auditor_pk)
                {
                    warn!(agent = i, "loan service failed: {e:#}");
                }
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn submit_bid(
        &mut self,
        ctx: &Ctx,
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
        let key = format!("{epoch}/{}/{tick}", side as u8);
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
    ) -> Result<()> {
        let chain = ctx.chain.as_ref();
        let disc = accounts::discriminator::<Loan>();
        for (key, data) in chain.program_accounts(&window_client::programs::CREDIT, &disc)? {
            let Some(loan) = accounts::decode::<Loan>(&data) else { continue };
            if loan.borrower != wallet.pubkey() {
                continue;
            }
            if loan.status == LoanStatus::Pending as u8 {
                let mem_key = format!("{}/1/{}", loan.epoch, loan.bid_tick);
                let Some((bid_size, opening_hex)) = self.memory.bids.get(&mem_key).cloned() else {
                    continue;
                };
                if opening_hex.is_empty() {
                    continue;
                }
                let bid_ct =
                    read::<Bid>(chain, &pda::bid(loan.epoch, &wallet.pubkey(), 1, loan.bid_tick))?
                        .ok_or_else(|| anyhow!("bid"))?;
                // Full fill: our own bid's opening. Partial fill: the administrator sealed the
                // part's opening to us (ECDH one-time pad); the loan size is then unknown to us
                // in plaintext, so we recover it by comparing against our tracked bid size is
                // impossible — instead we read it from the ciphertext with our key (bounded BSGS).
                let (loan_size, opening) = if bid_ct.ciphertext == loan.size_ct {
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
                let feed_id = ctx.deployment.feed_id();
                let price = read::<PriceCache>(chain, &pda::price_cache(&feed_id))?
                    .ok_or_else(|| anyhow!("price"))?;
                let mock: Pubkey = ctx.deployment.mock_mint.parse()?;
                let mint_data = chain.account_data(&mock)?.ok_or_else(|| anyhow!("mint"))?;
                let mult = mint_multiplier(&mint_data, chain.unix_timestamp()?)?;
                let p = scalar::price_scaled(price.price, price.expo)
                    .ok_or_else(|| anyhow!("price scale"))?;
                let a = scalar::multiplier_scaled(mult).ok_or_else(|| anyhow!("mult scale"))?;
                let scalars = scalar::solvency_scalars(p, a, ctx.profile.credit.haircut_bps)
                    .ok_or_else(|| anyhow!("scalars"))?;
                // pledge: 160% of the requirement so a small price move does not strand the loan
                let need_milli = ((loan_size as u128 * scalars.k_l as u128 * 16 / 10)
                    / scalars.k_c as u128) as u64
                    + 1;
                let available = self.memory.available.get(&i).copied().unwrap_or(0);
                if need_milli > available {
                    warn!(agent = i, "not enough collateral for this loan; skipping");
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
                    &[ix::lock_collateral(&wallet.pubkey(), &key, &feed_id, &mock, &lc)],
                    &[],
                )?;
                info!(agent = i, loan = %key, "collateral locked (priced proof)");
                // deposit: confidential transfer into escrow + deposit_collateral
                let escrow: Pubkey = ctx.deployment.escrow_account.parse()?;
                let cstock: Pubkey = ctx.deployment.cstock_mint.parse()?;
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
                    &[plan.transfer, ix::deposit_collateral(&wallet.pubkey(), &key, cstock_acc)],
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
