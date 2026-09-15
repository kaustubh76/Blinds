//! LiteSVM harness. LiteSVM runs Agave's program runtime in-process with the real ZK ElGamal
//! Proof builtin and a bundled Token-2022, and gives exact slot control (`warp`). The five
//! programs are loaded from `target/deploy/*.so` (run `anchor build` first).

use std::path::PathBuf;

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;
use window_clearing::{Side, TICKS};
use window_config::Profile;
use window_elgamal::{bsgs::Solver, keys, Ciphertext, Point};
use window_proofs::{bid as bid_proofs, ix, pocd};

pub mod pda;
pub mod print;

pub use print::PrintOutcome;

/// Stats of one confirmed transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TxStats {
    pub compute_units: u64,
    pub bytes: usize,
}

/// A failed transaction: the runtime error plus program logs.
#[derive(Debug)]
pub struct TxError {
    pub error: String,
    pub logs: Vec<String>,
}

impl TxError {
    /// Whether the logs mention an Anchor error by name (e.g. `RateMismatch`).
    pub fn has_code(&self, name: &str) -> bool {
        self.logs.iter().any(|l| l.contains(name))
    }
}

impl std::fmt::Display for TxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}\n{}", self.error, self.logs.join("\n"))
    }
}

/// A registered member: wallet + ElGamal key.
pub struct Member {
    pub wallet: Keypair,
    pub elgamal: keys::Keypair,
}

impl Member {
    pub fn pubkey(&self) -> Pubkey {
        self.wallet.pubkey()
    }
}

/// The market under test.
pub struct Harness {
    pub svm: LiteSVM,
    pub profile: Profile,
    pub admin: Keypair,
    pub auditor: keys::Keypair,
    pub members: Vec<Member>,
    pub solver: Solver,
    pub registry: Pubkey,
    pub auction: Pubkey,
    pub oracle: Pubkey,
}

fn deploy_dir() -> PathBuf {
    std::env::var("WINDOW_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .join("target/deploy")
}

impl Harness {
    /// Loads the programs, funds the admin, initialises registry, auction and oracle from
    /// `config/<profile>.toml`.
    pub fn new(profile: &str) -> Self {
        let profile = Profile::load(profile).expect("profile");
        let mut svm = LiteSVM::new();
        let (registry, auction, oracle) =
            (window_registry::ID, window_auction::ID, window_oracle::ID);
        for (id, name) in
            [(registry, "window_registry"), (auction, "window_auction"), (oracle, "window_oracle")]
        {
            let path = deploy_dir().join(format!("{name}.so"));
            let bytes = std::fs::read(&path)
                .unwrap_or_else(|e| panic!("{}: {e} — run `anchor build`", path.display()));
            svm.add_program(id, &bytes).expect("add_program");
        }
        let admin = Keypair::new();
        svm.airdrop(&admin.pubkey(), 1_000_000_000_000).unwrap();
        let auditor = keys::Keypair::random();
        let mut h = Harness {
            svm,
            profile,
            admin,
            auditor,
            members: Vec::new(),
            solver: Solver::build(16),
            registry,
            auction,
            oracle,
        };
        h.initialize();
        h
    }

    fn initialize(&mut self) {
        let admin = self.admin.pubkey();
        let ixs = vec![
            Instruction {
                program_id: self.registry,
                accounts: window_registry::accounts::Initialize {
                    admin,
                    config: pda::registry_config(),
                    system_program: solana_system_interface::program::ID,
                }
                .to_account_metas(None),
                data: window_registry::instruction::Initialize {}.data(),
            },
            Instruction {
                program_id: self.auction,
                accounts: window_auction::accounts::Initialize {
                    admin,
                    config: pda::auction_config(),
                    system_program: solana_system_interface::program::ID,
                }
                .to_account_metas(None),
                data: window_auction::instruction::Initialize {
                    params: window_auction::state::InitializeParams {
                        keeper: admin,
                        oracle_program: self.oracle,
                        registry_program: self.registry,
                        auditor_elgamal_pubkey: self.auditor.pubkey_bytes(),
                        cusdc_mint: Pubkey::new_unique(),
                        cstock_mint: Pubkey::new_unique(),
                        epoch_slots: self.profile.market.epoch_slots,
                        keeper_grace_slots: self.profile.market.keeper_grace_slots,
                        stale_after_slots: self.profile.market.stale_after_slots,
                        s_min: self.profile.market.bid_min_micro_usdc,
                        max_bids_per_epoch: self.profile.market.max_bids_per_epoch,
                    },
                }
                .data(),
            },
            Instruction {
                program_id: self.oracle,
                accounts: window_oracle::accounts::Initialize {
                    admin,
                    oracle_state: pda::oracle_state(),
                    system_program: solana_system_interface::program::ID,
                }
                .to_account_metas(None),
                data: window_oracle::instruction::Initialize {
                    auction_program: self.auction,
                    band_edge_epochs: self.profile.market.band_edge_epochs,
                    stale_after_slots: self.profile.market.stale_after_slots,
                }
                .data(),
            },
        ];
        let admin = self.admin.insecure_clone();
        self.send(&admin, &ixs, &[]).expect("initialize programs");
    }

    /// Sends a transaction signed by `payer` (+ `extra`); returns stats or the error with logs.
    pub fn send(
        &mut self,
        payer: &Keypair,
        ixs: &[Instruction],
        extra: &[&Keypair],
    ) -> Result<TxStats, TxError> {
        // A fresh blockhash per transaction: LiteSVM (like a validator) rejects a byte-identical
        // resend as "AlreadyProcessed", and attack tests legitimately retry identical calls.
        self.svm.expire_blockhash();
        let msg = Message::new(ixs, Some(&payer.pubkey()));
        let mut signers: Vec<&Keypair> = vec![payer];
        signers.extend_from_slice(extra);
        let tx = Transaction::new(&signers, msg, self.svm.latest_blockhash());
        let bytes = bincode::serialize(&tx).map(|b| b.len()).unwrap_or(0);
        match self.svm.send_transaction(tx) {
            Ok(meta) => Ok(TxStats { compute_units: meta.compute_units_consumed, bytes }),
            Err(e) => Err(TxError { error: format!("{:?}", e.err), logs: e.meta.logs }),
        }
    }

    /// Advances the clock by `slots`.
    pub fn warp(&mut self, slots: u64) {
        let now = self.slot();
        self.svm.warp_to_slot(now + slots);
    }

    pub fn slot(&self) -> u64 {
        self.svm.get_sysvar::<solana_clock::Clock>().slot
    }

    /// Registers a new funded member with a fresh ElGamal key; returns its index.
    pub fn add_member(&mut self) -> usize {
        let wallet = Keypair::new();
        self.svm.airdrop(&wallet.pubkey(), 100_000_000_000).unwrap();
        let elgamal = keys::Keypair::random();
        let ix = Instruction {
            program_id: self.registry,
            accounts: window_registry::accounts::AddMember {
                admin: self.admin.pubkey(),
                config: pda::registry_config(),
                member: pda::member(&wallet.pubkey()),
                system_program: solana_system_interface::program::ID,
            }
            .to_account_metas(None),
            data: window_registry::instruction::AddMember {
                owner: wallet.pubkey(),
                elgamal_pubkey: elgamal.pubkey_bytes(),
                joined_epoch: 0,
            }
            .data(),
        };
        let admin = self.admin.insecure_clone();
        self.send(&admin, &[ix], &[]).expect("add_member");
        self.members.push(Member { wallet, elgamal });
        self.members.len() - 1
    }

    pub fn auction_config(&self) -> window_auction::state::Config {
        self.account::<window_auction::state::Config>(&pda::auction_config())
    }

    pub fn oracle_state(&self) -> window_oracle::state::OracleState {
        self.account::<window_oracle::state::OracleState>(&pda::oracle_state())
    }

    /// Borsh-decodes an Anchor account (skipping the discriminator).
    pub fn account<T: anchor_lang::AccountDeserialize>(&self, key: &Pubkey) -> T {
        let data = self.svm.get_account(key).expect("account exists").data;
        T::try_deserialize(&mut data.as_slice()).expect("deserialize")
    }

    /// Zero-copy read of an `Epoch`.
    pub fn epoch(&self, index: u64) -> window_auction::state::Epoch {
        let data = self.svm.get_account(&pda::epoch(index)).expect("epoch exists").data;
        *bytemuck::from_bytes::<window_auction::state::Epoch>(&data[8..])
    }

    /// Zero-copy read of a `Print`.
    pub fn print(&self, index: u64) -> Option<window_oracle::state::Print> {
        let data = self.svm.get_account(&pda::print(index))?.data;
        if data.len() < window_oracle::state::Print::SPACE {
            return None;
        }
        Some(*bytemuck::from_bytes::<window_oracle::state::Print>(&data[8..]))
    }

    pub fn bid(
        &self,
        epoch: u64,
        member: &Pubkey,
        side: Side,
        tick: u8,
    ) -> Option<window_auction::state::Bid> {
        let key = pda::bid(epoch, member, side as u8, tick);
        self.svm.get_account(&key).map(|a| {
            window_auction::state::Bid::try_deserialize(&mut a.data.as_slice()).expect("bid")
        })
    }

    /// Keeper opens the next epoch; returns its index.
    pub fn open_epoch(&mut self) -> u64 {
        let index = self.auction_config().epochs_opened;
        let ix = Instruction {
            program_id: self.auction,
            accounts: window_auction::accounts::OpenEpoch {
                keeper: self.admin.pubkey(),
                config: pda::auction_config(),
                epoch: pda::epoch(index),
                system_program: solana_system_interface::program::ID,
            }
            .to_account_metas(None),
            data: window_auction::instruction::OpenEpoch {}.data(),
        };
        let admin = self.admin.insecure_clone();
        self.send(&admin, &[ix], &[]).expect("open_epoch");
        index
    }

    /// Closes `index` with `closer` (does not warp; use `close_epoch_after_window`).
    pub fn close_epoch_as(&mut self, index: u64, closer: &Keypair) -> Result<TxStats, TxError> {
        let ix = Instruction {
            program_id: self.auction,
            accounts: window_auction::accounts::CloseEpoch {
                closer: closer.pubkey(),
                config: pda::auction_config(),
                epoch: pda::epoch(index),
            }
            .to_account_metas(None),
            data: window_auction::instruction::CloseEpoch { index }.data(),
        };
        self.send(closer, &[ix], &[])
    }

    /// Warps past the epoch window and closes as keeper.
    pub fn close_epoch(&mut self, index: u64) {
        let e = self.epoch(index);
        let target = e.start_slot + self.profile.market.epoch_slots;
        if self.slot() < target {
            self.svm.warp_to_slot(target);
        }
        let admin = self.admin.insecure_clone();
        self.close_epoch_as(index, &admin).expect("close_epoch");
    }

    /// The full three-transaction bid flow for member `m`. Returns the stats of each transaction.
    pub fn submit_bid(
        &mut self,
        m: usize,
        side: Side,
        tick: u8,
        size: u64,
    ) -> Result<[TxStats; 3], TxError> {
        let s_min = self.profile.market.bid_min_micro_usdc;
        let proofs =
            bid_proofs::build(&self.members[m].elgamal, &self.auditor.pubkey_bytes(), size, s_min)
                .map_err(|e| TxError { error: e.to_string(), logs: vec![] })?;
        self.submit_bid_with(m, side, tick, &proofs.validity, &proofs.range)
    }

    /// Bid flow with caller-supplied proofs (attack tests use this to submit malformed ones).
    pub fn submit_bid_with(
        &mut self,
        m: usize,
        side: Side,
        tick: u8,
        validity: &solana_zk_sdk::zk_elgamal_proof_program::proof_data::GroupedCiphertext2HandlesValidityProofData,
        range: &solana_zk_sdk::zk_elgamal_proof_program::proof_data::BatchedRangeProofU64Data,
    ) -> Result<[TxStats; 3], TxError> {
        use solana_zk_sdk::zk_elgamal_proof_program::proof_data::BatchedRangeProofContext;
        let wallet = self.members[m].wallet.insecure_clone();
        let member = wallet.pubkey();
        let ctx = Keypair::new();
        let rent = self
            .svm
            .minimum_balance_for_rent_exemption(ix::context_size::<BatchedRangeProofContext>());
        let [create, verify] = ix::create_and_verify(&member, &ctx.pubkey(), &member, rent, range);
        let t1 = self.send(&wallet, &[create], &[&ctx])?;
        let t2 = self.send(&wallet, &[verify], &[])?;
        let epoch = self.auction_config().current_epoch;
        let submit = Instruction {
            program_id: self.auction,
            accounts: window_auction::accounts::SubmitBid {
                member,
                member_record: pda::member(&member),
                config: pda::auction_config(),
                epoch: pda::epoch(epoch),
                bid: pda::bid(epoch, &member, side as u8, tick),
                range_ctx: ctx.pubkey(),
                instructions: solana_instructions_sysvar_id(),
                zk_program: ix::zk_program_id(),
                system_program: solana_system_interface::program::ID,
            }
            .to_account_metas(None),
            data: window_auction::instruction::SubmitBid { side: side as u8, tick }.data(),
        };
        let t3 = self.send(&wallet, &[ix::verify_inline(validity), submit], &[])?;
        Ok([t1, t2, t3])
    }

    /// Decrypts every nonzero accumulator with the auditor key (what the administrator does).
    pub fn decrypt_curve(&self, index: u64) -> window_clearing::DepthCurve {
        let e = self.epoch(index);
        let mut curve = window_clearing::DepthCurve::default();
        for side in 0..2 {
            for t in 0..TICKS {
                if e.bid_count[side][t] == 0 {
                    continue;
                }
                let acc = Ciphertext {
                    commitment: Point(e.acc_commitment[side][t]),
                    handle: Point(e.acc_handle[side][t]),
                };
                let max = (e.bid_count[side][t] as u64) << 40;
                let v = self.solver.decrypt(&self.auditor, &acc, max).expect("aggregate decrypts");
                if side == 0 {
                    curve.ask[t] = v;
                } else {
                    curve.bid[t] = v;
                }
            }
        }
        curve
    }

    pub fn begin_print(&mut self, index: u64) -> Result<TxStats, TxError> {
        let ix = Instruction {
            program_id: self.oracle,
            accounts: window_oracle::accounts::BeginPrint {
                admin: self.admin.pubkey(),
                oracle_state: pda::oracle_state(),
                epoch: pda::epoch(index),
                print: pda::print(index),
                system_program: solana_system_interface::program::ID,
            }
            .to_account_metas(None),
            data: window_oracle::instruction::BeginPrint { epoch_index: index }.data(),
        };
        let admin = self.admin.insecure_clone();
        self.send(&admin, &[ix], &[])
    }

    /// One `attest_ticks` transaction with real PoCD proofs for `claims` (side, tick, sum).
    pub fn attest(&mut self, index: u64, claims: &[(Side, u8, u64)]) -> Result<TxStats, TxError> {
        let e = self.epoch(index);
        let mut ixs = Vec::with_capacity(claims.len() + 1);
        for (side, tick, sum) in claims {
            let (s, t) = (side.index(), *tick as usize);
            let acc = Ciphertext {
                commitment: Point(e.acc_commitment[s][t]),
                handle: Point(e.acc_handle[s][t]),
            };
            let proof = pocd::build(&self.auditor, &acc, *sum)
                .map_err(|e| TxError { error: e.to_string(), logs: vec![] })?;
            ixs.push(ix::verify_inline(&proof));
        }
        ixs.push(self.attest_ix(index, claims));
        let admin = self.admin.insecure_clone();
        self.send(&admin, &ixs, &[])
    }

    /// The bare `attest_ticks` instruction (attack tests pair it with the wrong proofs).
    pub fn attest_ix(&self, index: u64, claims: &[(Side, u8, u64)]) -> Instruction {
        Instruction {
            program_id: self.oracle,
            accounts: window_oracle::accounts::AttestTicks {
                admin: self.admin.pubkey(),
                oracle_state: pda::oracle_state(),
                epoch: pda::epoch(index),
                print: pda::print(index),
                instructions: solana_instructions_sysvar_id(),
            }
            .to_account_metas(None),
            data: window_oracle::instruction::AttestTicks {
                epoch_index: index,
                claims: claims
                    .iter()
                    .map(|(s, t, v)| window_oracle::state::TickClaim {
                        side: *s as u8,
                        tick: *t,
                        sum: *v,
                    })
                    .collect(),
            }
            .data(),
        }
    }

    pub fn finalize_print(
        &mut self,
        index: u64,
        claimed_r_star: Option<u8>,
    ) -> Result<TxStats, TxError> {
        let ix = Instruction {
            program_id: self.oracle,
            accounts: window_oracle::accounts::FinalizePrint {
                admin: self.admin.pubkey(),
                oracle_state: pda::oracle_state(),
                epoch: pda::epoch(index),
                print: pda::print(index),
                oracle_authority: pda::oracle_authority(),
                auction_config: pda::auction_config(),
                auction_program: self.auction,
            }
            .to_account_metas(None),
            data: window_oracle::instruction::FinalizePrint { epoch_index: index, claimed_r_star }
                .data(),
        };
        let admin = self.admin.insecure_clone();
        self.send(&admin, &[ix], &[])
    }

    pub fn mark_stale(&mut self, index: u64, caller: &Keypair) -> Result<TxStats, TxError> {
        let ix = Instruction {
            program_id: self.oracle,
            accounts: window_oracle::accounts::MarkStale {
                anyone: caller.pubkey(),
                oracle_state: pda::oracle_state(),
                epoch: pda::epoch(index),
                print: pda::print(index),
                system_program: solana_system_interface::program::ID,
            }
            .to_account_metas(None),
            data: window_oracle::instruction::MarkStale { epoch_index: index }.data(),
        };
        self.send(caller, &[ix], &[])
    }

    pub fn close_bid(
        &mut self,
        epoch: u64,
        member: &Pubkey,
        side: Side,
        tick: u8,
        caller: &Keypair,
    ) -> Result<TxStats, TxError> {
        let ix = Instruction {
            program_id: self.auction,
            accounts: window_auction::accounts::CloseBid {
                anyone: caller.pubkey(),
                config: pda::auction_config(),
                epoch: pda::epoch(epoch),
                bid: pda::bid(epoch, member, side as u8, tick),
                member: *member,
            }
            .to_account_metas(None),
            data: window_auction::instruction::CloseBid {}.data(),
        };
        self.send(caller, &[ix], &[])
    }
}

/// `Sysvar1nstructions1111111111111111111111111`.
pub fn solana_instructions_sysvar_id() -> Pubkey {
    solana_instructions_sysvar::ID
}
