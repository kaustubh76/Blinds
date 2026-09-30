//! The chain interface the services run against: RPC in production, mockable in tests.

use anyhow::{anyhow, Context, Result};
use solana_account_decoder_client_types::UiAccountEncoding;
use solana_commitment_config::CommitmentConfig;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_message::Message;
use solana_pubkey::Pubkey;
use solana_rpc_client::rpc_client::RpcClient;
use solana_rpc_client_api::{
    config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    filter::{Memcmp, RpcFilterType},
};
use solana_signer::Signer;
use solana_transaction::Transaction;

pub trait Chain: Send + Sync {
    fn slot(&self) -> Result<u64>;
    fn unix_timestamp(&self) -> Result<i64>;
    fn account_data(&self, key: &Pubkey) -> Result<Option<Vec<u8>>>;
    /// The account's owner and data — for accounts another program owns (a Pyth price update).
    fn account_owner_and_data(&self, key: &Pubkey) -> Result<Option<(Pubkey, Vec<u8>)>>;
    /// Accounts of `program` whose data starts with `discriminator`.
    fn program_accounts(
        &self,
        program: &Pubkey,
        discriminator: &[u8; 8],
    ) -> Result<Vec<(Pubkey, Vec<u8>)>>;
    /// Token-2022 accounts of `mint` owned by `owner`.
    fn token_accounts(&self, owner: &Pubkey, mint: &Pubkey) -> Result<Vec<Pubkey>>;
    fn rent(&self, space: usize) -> Result<u64>;
    fn balance(&self, key: &Pubkey) -> Result<u64>;
    fn send(&self, payer: &Keypair, ixs: &[Instruction], extra: &[&Keypair]) -> Result<String>;
    fn airdrop(&self, key: &Pubkey, lamports: u64) -> Result<()>;
}

pub struct RpcChain {
    pub client: RpcClient,
    /// Priority fee in micro-lamports per compute unit, prepended to every transaction.
    /// Devnet drops unprioritised transactions under load; 0 (the default) omits the instruction.
    priority_fee: u64,
}

/// The packet limit a serialized transaction must fit in.
const MAX_TX_BYTES: u64 = 1232;

/// How many times a transient RPC failure is tried again, and the first delay between tries.
///
/// The services run four independent clocks — keeper 6 s, price 20 s, epoch 10 s, administrator
/// 10 s — and without a backoff each of them answers a rate limit by asking again on its next
/// tick, which sustains exactly the pressure that caused it. On 2026-09-24 every thread was
/// logging reqwest's `error sending request` against the shared devnet endpoint and a full
/// bid → match → loan cycle could not be completed. Five attempts from 400 ms is ~6 s of waiting
/// before a call is given up on, which is inside every one of those ticks.
const RPC_ATTEMPTS: u32 = 5;
const RPC_BACKOFF_BASE_MS: u64 = 400;

/// Whether an RPC failure is worth another try.
///
/// Judged on the rendered message: the RPC client's error enum wraps five transport crates, and the
/// text is the one thing all of them agree on — the same reason `sdk/src/send.ts` matches strings.
/// A decision the cluster actually made is never retried, however it is phrased: re-sending a
/// transaction it rejected would change nothing and would read as a fresh attempt in the log.
pub fn is_transient_rpc_error(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    const DECIDED: &[&str] = &[
        "transaction simulation failed",
        "custom program error",
        "insufficient funds",
        "insufficient lamports",
        "blockhash not found",
        "already been processed",
        "invalid transaction",
        "signature verification",
        "attempt to debit an account",
    ];
    if DECIDED.iter().any(|d| m.contains(d)) {
        return false;
    }
    const TRANSIENT: &[&str] = &[
        // reqwest's own wording for a connection it could not make — what the 24 Sep storm logged.
        "error sending request",
        "too many requests",
        "rate limit",
        "429",
        "timed out",
        "timeout",
        "connection",
        "broken pipe",
        "dns error",
        "temporarily unavailable",
        "service unavailable",
        "bad gateway",
        "gateway timeout",
        "502",
        "503",
        "504",
        "node is behind",
        "block not available",
        "os error 54",
        "os error 60",
        "eof while parsing",
    ];
    TRANSIENT.iter().any(|t| m.contains(t))
}

/// One RPC call, retried through a transient failure with an exponential backoff.
///
/// `what` names the call in the log, so a bad endpoint is visible as itself rather than as a
/// keeper that mysteriously stopped. The jitter matters: four threads that failed together must
/// not come back together.
fn with_retry<T, E: std::fmt::Display>(
    what: &str,
    mut f: impl FnMut() -> std::result::Result<T, E>,
) -> Result<T> {
    let mut delay = std::time::Duration::from_millis(RPC_BACKOFF_BASE_MS);
    let mut last = String::new();
    for attempt in 1..=RPC_ATTEMPTS {
        match f() {
            Ok(v) => {
                if attempt > 1 {
                    tracing::info!(what, attempt, "rpc call recovered");
                }
                return Ok(v);
            }
            Err(e) => {
                last = e.to_string();
                if attempt == RPC_ATTEMPTS || !is_transient_rpc_error(&last) {
                    break;
                }
                let jitter = std::time::Duration::from_millis(jitter_ms());
                tracing::warn!(
                    what,
                    attempt,
                    wait_ms = (delay + jitter).as_millis(),
                    error = %last,
                    "transient rpc failure; backing off"
                );
                std::thread::sleep(delay + jitter);
                delay = delay.saturating_mul(2);
            }
        }
    }
    Err(anyhow!("{what}: {last}"))
}

/// Up to half the base delay, from the clock's sub-second digits — enough to separate four threads
/// without pulling in a random-number generator.
fn jitter_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| u64::from(d.subsec_nanos()) % (RPC_BACKOFF_BASE_MS / 2))
        .unwrap_or(0)
}

/// `ComputeBudget111111111111111111111111111111`.
const COMPUTE_BUDGET: Pubkey =
    solana_pubkey::pubkey!("ComputeBudget111111111111111111111111111111");

impl RpcChain {
    pub fn new(url: &str) -> Self {
        Self {
            client: RpcClient::new_with_commitment(url.to_string(), CommitmentConfig::confirmed()),
            priority_fee: std::env::var("WINDOW_PRIORITY_FEE_MICROLAMPORTS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
        }
    }

    /// `SetComputeUnitPrice` (ComputeBudget instruction 3).
    fn priority_fee_ix(&self) -> Option<Instruction> {
        (self.priority_fee > 0).then(|| {
            let mut data = Vec::with_capacity(9);
            data.push(3u8);
            data.extend_from_slice(&self.priority_fee.to_le_bytes());
            Instruction { program_id: COMPUTE_BUDGET, accounts: vec![], data }
        })
    }
}

impl Chain for RpcChain {
    fn slot(&self) -> Result<u64> {
        with_retry("get_slot", || self.client.get_slot())
    }
    fn unix_timestamp(&self) -> Result<i64> {
        let slot = self.slot()?;
        Ok(self.client.get_block_time(slot).unwrap_or_else(|_| {
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
                as i64
        }))
    }
    fn account_data(&self, key: &Pubkey) -> Result<Option<Vec<u8>>> {
        Ok(self.account_owner_and_data(key)?.map(|(_, d)| d))
    }
    fn account_owner_and_data(&self, key: &Pubkey) -> Result<Option<(Pubkey, Vec<u8>)>> {
        let acc = with_retry("get_account", || {
            self.client.get_account_with_commitment(key, CommitmentConfig::confirmed())
        })?;
        Ok(acc.value.map(|a| (a.owner, a.data)))
    }
    fn program_accounts(
        &self,
        program: &Pubkey,
        discriminator: &[u8; 8],
    ) -> Result<Vec<(Pubkey, Vec<u8>)>> {
        let config = RpcProgramAccountsConfig {
            filters: Some(vec![RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
                0,
                discriminator.to_vec(),
            ))]),
            account_config: RpcAccountInfoConfig {
                encoding: Some(UiAccountEncoding::Base64),
                commitment: Some(CommitmentConfig::confirmed()),
                ..Default::default()
            },
            ..Default::default()
        };
        let accounts = with_retry("get_program_accounts", || {
            #[allow(deprecated)]
            // the ui-accounts variant returns base64 we would only decode again
            self.client.get_program_accounts_with_config(program, config.clone())
        })?;
        Ok(accounts.into_iter().map(|(k, a)| (k, a.data)).collect())
    }
    fn token_accounts(&self, owner: &Pubkey, mint: &Pubkey) -> Result<Vec<Pubkey>> {
        use solana_rpc_client_api::request::TokenAccountsFilter;
        let accounts = with_retry("get_token_accounts_by_owner", || {
            self.client.get_token_accounts_by_owner(owner, TokenAccountsFilter::Mint(*mint))
        })?;
        accounts
            .into_iter()
            .map(|a| a.pubkey.parse::<Pubkey>().map_err(|e| anyhow!("{e}")))
            .collect()
    }
    fn rent(&self, space: usize) -> Result<u64> {
        with_retry("get_minimum_balance_for_rent_exemption", || {
            self.client.get_minimum_balance_for_rent_exemption(space)
        })
    }
    fn balance(&self, key: &Pubkey) -> Result<u64> {
        with_retry("get_balance", || self.client.get_balance(key))
    }
    fn send(&self, payer: &Keypair, ixs: &[Instruction], extra: &[&Keypair]) -> Result<String> {
        let blockhash = with_retry("get_latest_blockhash", || self.client.get_latest_blockhash())?;
        let mut signers: Vec<&Keypair> = vec![payer];
        signers.extend_from_slice(extra);
        let build = |ixs: &[Instruction]| {
            let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
            Transaction::new(&signers, msg, blockhash)
        };
        let tx = match self.priority_fee_ix() {
            Some(fee) => {
                let with_fee: Vec<Instruction> =
                    std::iter::once(fee).chain(ixs.iter().cloned()).collect();
                let tx = build(&with_fee);
                // A priority fee is a nicety; a transaction that only fits without it (the
                // confidential transfer + deposit_collateral pair is within ~40 B of the packet
                // limit) goes without.
                if bincode::serialized_size(&tx).unwrap_or(u64::MAX) > MAX_TX_BYTES {
                    build(ixs)
                } else {
                    tx
                }
            }
            None => build(ixs),
        };
        // The *same* signed transaction on every attempt, so a re-send carries the same signature
        // and the cluster de-duplicates it. Rebuilding it here — a fresh blockhash, a new
        // signature — could execute twice if the first attempt landed and only the reply was lost.
        let sig = with_retry("send_and_confirm", || self.client.send_and_confirm_transaction(&tx))
            .context("send_and_confirm")?;
        Ok(sig.to_string())
    }
    fn airdrop(&self, key: &Pubkey, lamports: u64) -> Result<()> {
        let sig = with_retry("request_airdrop", || self.client.request_airdrop(key, lamports))?;
        for _ in 0..60 {
            if with_retry("confirm_transaction", || self.client.confirm_transaction(&sig))? {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        Err(anyhow!("airdrop not confirmed"))
    }
}

/// Reads an Anchor account through the chain.
pub fn read<T: anchor_lang::AccountDeserialize>(
    chain: &dyn Chain,
    key: &Pubkey,
) -> Result<Option<T>> {
    Ok(chain.account_data(key)?.and_then(|d| window_client::accounts::decode::<T>(&d)))
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    #[test]
    fn a_lost_connection_is_worth_another_try() {
        // reqwest's own wording, and what every thread logged against the shared devnet endpoint
        // on 2026-09-24 while a bid → match → loan cycle could not be completed.
        assert!(is_transient_rpc_error(
            "error sending request for url (https://api.devnet.solana.com/)"
        ));
        assert!(is_transient_rpc_error("HTTP status client error (429 Too Many Requests)"));
        assert!(is_transient_rpc_error("Operation timed out (os error 60)"));
        assert!(is_transient_rpc_error("503 Service Unavailable"));
        assert!(is_transient_rpc_error("RPC response error -32004: Node is behind by 42 slots"));
        assert!(is_transient_rpc_error("connection closed before message completed"));
    }

    #[test]
    fn a_decision_the_cluster_made_is_never_retried() {
        // Asking again gets the same answer, and re-sending would read as a fresh attempt.
        assert!(!is_transient_rpc_error(
            "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1791"
        ));
        assert!(!is_transient_rpc_error(
            "Attempt to debit an account but found no record of a prior credit"
        ));
        assert!(!is_transient_rpc_error("Blockhash not found"));
        assert!(!is_transient_rpc_error("This transaction has already been processed"));
        // A rejection that happens to mention a timeout is still a rejection.
        assert!(!is_transient_rpc_error(
            "Transaction simulation failed: connection timeout inside the program log"
        ));
        assert!(!is_transient_rpc_error("some error nobody has classified"));
    }

    #[test]
    fn a_transient_failure_is_retried_until_it_succeeds() {
        let tries = Cell::new(0);
        let got = with_retry("probe", || {
            tries.set(tries.get() + 1);
            if tries.get() < 3 {
                Err("error sending request")
            } else {
                Ok(tries.get())
            }
        })
        .unwrap();
        assert_eq!((got, tries.get()), (3, 3));
    }

    #[test]
    fn a_decided_failure_is_tried_exactly_once() {
        let tries = Cell::new(0);
        let err = with_retry::<(), _>("probe", || {
            tries.set(tries.get() + 1);
            Err("custom program error: 0x1791")
        })
        .unwrap_err();
        assert_eq!(tries.get(), 1, "a rejected transaction must not be sent again");
        assert!(err.to_string().contains("probe"), "the log names the call: {err}");
    }

    #[test]
    fn a_transient_failure_gives_up_after_the_last_attempt() {
        let tries = Cell::new(0);
        let err = with_retry::<(), _>("probe", || {
            tries.set(tries.get() + 1);
            Err("429 too many requests")
        })
        .unwrap_err();
        assert_eq!(tries.get(), RPC_ATTEMPTS as i32);
        assert!(err.to_string().contains("429"));
    }

    #[test]
    fn the_jitter_stays_inside_half_the_base_delay() {
        // Four threads that failed together must not come back together, but the spread must not
        // outgrow the delay it is spreading.
        for _ in 0..50 {
            assert!(jitter_ms() < RPC_BACKOFF_BASE_MS / 2);
        }
    }
}
