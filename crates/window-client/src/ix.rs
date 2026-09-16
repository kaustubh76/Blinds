//! Instruction builders. Every function is a pure function of public keys and arguments and
//! returns exactly the instruction the program expects; proof instructions come from
//! `window_proofs::ix` and are sequenced by the caller.

use anchor_lang::{InstructionData, ToAccountMetas};
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use window_clearing::Side;
use window_proofs::ix as zk;

use crate::{pda, programs, MatchKind, TickClaim};

fn system() -> Pubkey {
    solana_system_interface::program::ID
}
fn sysvar_instructions() -> Pubkey {
    solana_instructions_sysvar::ID
}
fn token_2022() -> Pubkey {
    spl_token_2022_interface::id()
}

// ---------------------------------------------------------------- registry

pub fn registry_initialize(admin: &Pubkey) -> Instruction {
    Instruction {
        program_id: programs::REGISTRY,
        accounts: window_registry::accounts::Initialize {
            admin: *admin,
            config: pda::registry_config(),
            system_program: system(),
        }
        .to_account_metas(None),
        data: window_registry::instruction::Initialize {}.data(),
    }
}

pub fn add_member(
    admin: &Pubkey,
    owner: &Pubkey,
    elgamal_pubkey: [u8; 32],
    joined_epoch: u64,
) -> Instruction {
    Instruction {
        program_id: programs::REGISTRY,
        accounts: window_registry::accounts::AddMember {
            admin: *admin,
            config: pda::registry_config(),
            member: pda::member(owner),
            system_program: system(),
        }
        .to_account_metas(None),
        data: window_registry::instruction::AddMember {
            owner: *owner,
            elgamal_pubkey,
            joined_epoch,
        }
        .data(),
    }
}

// ---------------------------------------------------------------- auction

pub fn auction_initialize(
    admin: &Pubkey,
    params: window_auction::state::InitializeParams,
) -> Instruction {
    Instruction {
        program_id: programs::AUCTION,
        accounts: window_auction::accounts::Initialize {
            admin: *admin,
            config: pda::auction_config(),
            system_program: system(),
        }
        .to_account_metas(None),
        data: window_auction::instruction::Initialize { params }.data(),
    }
}

pub fn open_epoch(keeper: &Pubkey, next_index: u64) -> Instruction {
    Instruction {
        program_id: programs::AUCTION,
        accounts: window_auction::accounts::OpenEpoch {
            keeper: *keeper,
            config: pda::auction_config(),
            epoch: pda::epoch(next_index),
            system_program: system(),
        }
        .to_account_metas(None),
        data: window_auction::instruction::OpenEpoch {}.data(),
    }
}

pub fn close_epoch(closer: &Pubkey, index: u64) -> Instruction {
    Instruction {
        program_id: programs::AUCTION,
        accounts: window_auction::accounts::CloseEpoch {
            closer: *closer,
            config: pda::auction_config(),
            epoch: pda::epoch(index),
        }
        .to_account_metas(None),
        data: window_auction::instruction::CloseEpoch { index }.data(),
    }
}

/// `submit_bid`; place `zk::verify_inline(&validity)` immediately before it in the same transaction.
pub fn submit_bid(
    member: &Pubkey,
    epoch: u64,
    side: Side,
    tick: u8,
    range_ctx: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: programs::AUCTION,
        accounts: window_auction::accounts::SubmitBid {
            member: *member,
            member_record: pda::member(member),
            config: pda::auction_config(),
            epoch: pda::epoch(epoch),
            bid: pda::bid(epoch, member, side as u8, tick),
            range_ctx: *range_ctx,
            instructions: sysvar_instructions(),
            zk_program: zk::zk_program_id(),
            system_program: system(),
        }
        .to_account_metas(None),
        data: window_auction::instruction::SubmitBid { side: side as u8, tick }.data(),
    }
}

pub fn close_bid(
    anyone: &Pubkey,
    epoch: u64,
    member: &Pubkey,
    side: Side,
    tick: u8,
) -> Instruction {
    Instruction {
        program_id: programs::AUCTION,
        accounts: window_auction::accounts::CloseBid {
            anyone: *anyone,
            config: pda::auction_config(),
            epoch: pda::epoch(epoch),
            bid: pda::bid(epoch, member, side as u8, tick),
            member: *member,
        }
        .to_account_metas(None),
        data: window_auction::instruction::CloseBid {}.data(),
    }
}

pub fn rotate_auditor(admin: &Pubkey, new_pubkey: [u8; 32]) -> Instruction {
    Instruction {
        program_id: programs::AUCTION,
        accounts: window_auction::accounts::RotateAuditor {
            admin: *admin,
            config: pda::auction_config(),
        }
        .to_account_metas(None),
        data: window_auction::instruction::RotateAuditor { new_pubkey }.data(),
    }
}

// ---------------------------------------------------------------- oracle

pub fn oracle_initialize(
    admin: &Pubkey,
    auction_program: Pubkey,
    band_edge_epochs: u8,
    stale_after_slots: u64,
) -> Instruction {
    Instruction {
        program_id: programs::ORACLE,
        accounts: window_oracle::accounts::Initialize {
            admin: *admin,
            oracle_state: pda::oracle_state(),
            system_program: system(),
        }
        .to_account_metas(None),
        data: window_oracle::instruction::Initialize {
            auction_program,
            band_edge_epochs,
            stale_after_slots,
        }
        .data(),
    }
}

pub fn begin_print(admin: &Pubkey, epoch: u64) -> Instruction {
    Instruction {
        program_id: programs::ORACLE,
        accounts: window_oracle::accounts::BeginPrint {
            admin: *admin,
            oracle_state: pda::oracle_state(),
            epoch: pda::epoch(epoch),
            print: pda::print(epoch),
            system_program: system(),
        }
        .to_account_metas(None),
        data: window_oracle::instruction::BeginPrint { epoch_index: epoch }.data(),
    }
}

/// `attest_ticks`; place one `zk::verify_inline(&pocd)` per claim immediately before it, in order.
pub fn attest_ticks(admin: &Pubkey, epoch: u64, claims: &[(Side, u8, u64)]) -> Instruction {
    Instruction {
        program_id: programs::ORACLE,
        accounts: window_oracle::accounts::AttestTicks {
            admin: *admin,
            oracle_state: pda::oracle_state(),
            epoch: pda::epoch(epoch),
            print: pda::print(epoch),
            instructions: sysvar_instructions(),
        }
        .to_account_metas(None),
        data: window_oracle::instruction::AttestTicks {
            epoch_index: epoch,
            claims: claims
                .iter()
                .map(|(s, t, v)| TickClaim { side: *s as u8, tick: *t, sum: *v })
                .collect(),
        }
        .data(),
    }
}

pub fn finalize_print(admin: &Pubkey, epoch: u64, claimed_r_star: Option<u8>) -> Instruction {
    Instruction {
        program_id: programs::ORACLE,
        accounts: window_oracle::accounts::FinalizePrint {
            admin: *admin,
            oracle_state: pda::oracle_state(),
            epoch: pda::epoch(epoch),
            print: pda::print(epoch),
            oracle_authority: pda::oracle_authority(),
            auction_config: pda::auction_config(),
            auction_program: programs::AUCTION,
        }
        .to_account_metas(None),
        data: window_oracle::instruction::FinalizePrint { epoch_index: epoch, claimed_r_star }
            .data(),
    }
}

pub fn mark_stale(anyone: &Pubkey, epoch: u64) -> Instruction {
    Instruction {
        program_id: programs::ORACLE,
        accounts: window_oracle::accounts::MarkStale {
            anyone: *anyone,
            oracle_state: pda::oracle_state(),
            epoch: pda::epoch(epoch),
            print: pda::print(epoch),
            system_program: system(),
        }
        .to_account_metas(None),
        data: window_oracle::instruction::MarkStale { epoch_index: epoch }.data(),
    }
}

// ---------------------------------------------------------------- wrap

pub fn wrap_initialize(admin: &Pubkey, mock_mint: &Pubkey, cstock_mint: &Pubkey) -> Instruction {
    let vault = pda::wrap_vault(mock_mint);
    Instruction {
        program_id: programs::WRAP,
        accounts: window_wrap::accounts::Initialize {
            admin: *admin,
            registry_program: programs::REGISTRY,
            mock_mint: *mock_mint,
            cstock_mint: *cstock_mint,
            vault,
            mint_authority: pda::wrap_mint_authority(),
            custody: pda::ata(&vault, mock_mint),
            token_program: token_2022(),
            associated_token_program: pda::ASSOCIATED_TOKEN_PROGRAM,
            system_program: system(),
        }
        .to_account_metas(None),
        data: window_wrap::instruction::Initialize {}.data(),
    }
}

pub fn wrap(
    member: &Pubkey,
    mock_mint: &Pubkey,
    cstock_mint: &Pubkey,
    member_mock: &Pubkey,
    member_cstock: &Pubkey,
    amount: u64,
) -> Instruction {
    let vault = pda::wrap_vault(mock_mint);
    Instruction {
        program_id: programs::WRAP,
        accounts: window_wrap::accounts::Wrap {
            member: *member,
            member_record: pda::member(member),
            vault,
            mock_mint: *mock_mint,
            cstock_mint: *cstock_mint,
            member_mock: *member_mock,
            custody: pda::ata(&vault, mock_mint),
            member_cstock: *member_cstock,
            mint_authority: pda::wrap_mint_authority(),
            token_program: token_2022(),
        }
        .to_account_metas(None),
        data: window_wrap::instruction::Wrap { amount }.data(),
    }
}

pub fn unwrap(
    member: &Pubkey,
    mock_mint: &Pubkey,
    cstock_mint: &Pubkey,
    member_mock: &Pubkey,
    member_cstock: &Pubkey,
    amount: u64,
) -> Instruction {
    let vault = pda::wrap_vault(mock_mint);
    Instruction {
        program_id: programs::WRAP,
        accounts: window_wrap::accounts::Unwrap {
            member: *member,
            vault,
            mock_mint: *mock_mint,
            cstock_mint: *cstock_mint,
            member_mock: *member_mock,
            custody: pda::ata(&vault, mock_mint),
            member_cstock: *member_cstock,
            token_program: token_2022(),
        }
        .to_account_metas(None),
        data: window_wrap::instruction::Unwrap { amount }.data(),
    }
}

// ---------------------------------------------------------------- credit

pub fn credit_initialize(
    admin: &Pubkey,
    params: window_credit::state::InitializeParams,
) -> Instruction {
    Instruction {
        program_id: programs::CREDIT,
        accounts: window_credit::accounts::Initialize {
            admin: *admin,
            config: pda::credit_config(),
            system_program: system(),
        }
        .to_account_metas(None),
        data: window_credit::instruction::Initialize { params }.data(),
    }
}

pub fn post_price(
    keeper: &Pubkey,
    feed_id: &[u8; 32],
    price: u64,
    expo: i32,
    publish_time: i64,
) -> Instruction {
    Instruction {
        program_id: programs::CREDIT,
        accounts: window_credit::accounts::PostPrice {
            keeper: *keeper,
            config: pda::credit_config(),
            price_cache: pda::price_cache(feed_id),
            system_program: system(),
        }
        .to_account_metas(None),
        data: window_credit::instruction::PostPrice { price, expo, publish_time }.data(),
    }
}

/// One match. For `MatchKind::Partial` pass the validity context account.
pub fn post_match(
    admin: &Pubkey,
    epoch: u64,
    borrower: &Pubkey,
    bid_tick: u8,
    lender: &Pubkey,
    ask_tick: u8,
    k: u8,
    kind: MatchKind,
    partial_validity_ctx: Option<Pubkey>,
) -> Instruction {
    Instruction {
        program_id: programs::CREDIT,
        accounts: window_credit::accounts::PostMatch {
            admin: *admin,
            config: pda::credit_config(),
            print: pda::print(epoch),
            auction_config: pda::auction_config(),
            borrower_bid: pda::bid(epoch, borrower, Side::Bid as u8, bid_tick),
            lender_bid: pda::bid(epoch, lender, Side::Ask as u8, ask_tick),
            borrower_record: pda::member(borrower),
            loan: pda::loan(epoch, borrower, bid_tick, k),
            partial_validity_ctx,
            zk_program: zk::zk_program_id(),
            system_program: system(),
        }
        .to_account_metas(None),
        data: window_credit::instruction::PostMatch { epoch, k, kind }.data(),
    }
}

pub struct LockContexts {
    pub validity: Pubkey,
    pub range32: Pubkey,
    pub equality: Pubkey,
    pub range64: Pubkey,
}

pub fn lock_collateral(
    borrower: &Pubkey,
    loan: &Pubkey,
    feed_id: &[u8; 32],
    mock_mint: &Pubkey,
    ctxs: &LockContexts,
) -> Instruction {
    Instruction {
        program_id: programs::CREDIT,
        accounts: window_credit::accounts::LockCollateral {
            borrower: *borrower,
            config: pda::credit_config(),
            auction_config: pda::auction_config(),
            borrower_record: pda::member(borrower),
            loan: *loan,
            price_cache: pda::price_cache(feed_id),
            mock_mint: *mock_mint,
            validity_ctx: ctxs.validity,
            range32_ctx: ctxs.range32,
            equality_ctx: ctxs.equality,
            range64_ctx: ctxs.range64,
            zk_program: zk::zk_program_id(),
        }
        .to_account_metas(None),
        data: window_credit::instruction::LockCollateral {}.data(),
    }
}

/// Place the borrower's confidential `Transfer` to the escrow immediately before this.
pub fn deposit_collateral(
    borrower: &Pubkey,
    loan: &Pubkey,
    borrower_cstock: &Pubkey,
) -> Instruction {
    Instruction {
        program_id: programs::CREDIT,
        accounts: window_credit::accounts::DepositCollateral {
            borrower: *borrower,
            config: pda::credit_config(),
            loan: *loan,
            borrower_cstock: *borrower_cstock,
            instructions: sysvar_instructions(),
        }
        .to_account_metas(None),
        data: window_credit::instruction::DepositCollateral {}.data(),
    }
}

pub fn confirm_lock(operator: &Pubkey, loan: &Pubkey) -> Instruction {
    Instruction {
        program_id: programs::CREDIT,
        accounts: window_credit::accounts::ConfirmLock {
            operator: *operator,
            config: pda::credit_config(),
            loan: *loan,
        }
        .to_account_metas(None),
        data: window_credit::instruction::ConfirmLock {}.data(),
    }
}

pub fn confirm_funding(admin: &Pubkey, loan: &Pubkey) -> Instruction {
    Instruction {
        program_id: programs::CREDIT,
        accounts: window_credit::accounts::ConfirmFunding {
            admin: *admin,
            config: pda::credit_config(),
            loan: *loan,
        }
        .to_account_metas(None),
        data: window_credit::instruction::ConfirmFunding {}.data(),
    }
}

pub fn repay(admin: &Pubkey, loan: &Pubkey) -> Instruction {
    Instruction {
        program_id: programs::CREDIT,
        accounts: window_credit::accounts::Repay {
            admin: *admin,
            config: pda::credit_config(),
            loan: *loan,
        }
        .to_account_metas(None),
        data: window_credit::instruction::Repay {}.data(),
    }
}

pub fn seize(anyone: &Pubkey, loan: &Pubkey, feed_id: &[u8; 32]) -> Instruction {
    Instruction {
        program_id: programs::CREDIT,
        accounts: window_credit::accounts::Seize {
            anyone: *anyone,
            config: pda::credit_config(),
            price_cache: pda::price_cache(feed_id),
            loan: *loan,
        }
        .to_account_metas(None),
        data: window_credit::instruction::Seize {}.data(),
    }
}

/// Place the operator's confidential `Transfer` escrow → destination immediately before this.
pub fn release_collateral(operator: &Pubkey, loan: &Pubkey, destination: &Pubkey) -> Instruction {
    Instruction {
        program_id: programs::CREDIT,
        accounts: window_credit::accounts::ReleaseCollateral {
            operator: *operator,
            config: pda::credit_config(),
            loan: *loan,
            destination: *destination,
            instructions: sysvar_instructions(),
        }
        .to_account_metas(None),
        data: window_credit::instruction::ReleaseCollateral {}.data(),
    }
}
