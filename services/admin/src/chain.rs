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
}

impl RpcChain {
    pub fn new(url: &str) -> Self {
        Self {
            client: RpcClient::new_with_commitment(url.to_string(), CommitmentConfig::confirmed()),
        }
    }
}

impl Chain for RpcChain {
    fn slot(&self) -> Result<u64> {
        Ok(self.client.get_slot()?)
    }
    fn unix_timestamp(&self) -> Result<i64> {
        let slot = self.client.get_slot()?;
        Ok(self.client.get_block_time(slot).unwrap_or_else(|_| {
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
                as i64
        }))
    }
    fn account_data(&self, key: &Pubkey) -> Result<Option<Vec<u8>>> {
        Ok(self
            .client
            .get_account_with_commitment(key, CommitmentConfig::confirmed())?
            .value
            .map(|a| a.data))
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
        #[allow(deprecated)] // the ui-accounts variant returns base64 we would only decode again
        let accounts = self.client.get_program_accounts_with_config(program, config)?;
        Ok(accounts.into_iter().map(|(k, a)| (k, a.data)).collect())
    }
    fn token_accounts(&self, owner: &Pubkey, mint: &Pubkey) -> Result<Vec<Pubkey>> {
        use solana_rpc_client_api::request::TokenAccountsFilter;
        let accounts =
            self.client.get_token_accounts_by_owner(owner, TokenAccountsFilter::Mint(*mint))?;
        accounts
            .into_iter()
            .map(|a| a.pubkey.parse::<Pubkey>().map_err(|e| anyhow!("{e}")))
            .collect()
    }
    fn rent(&self, space: usize) -> Result<u64> {
        Ok(self.client.get_minimum_balance_for_rent_exemption(space)?)
    }
    fn balance(&self, key: &Pubkey) -> Result<u64> {
        Ok(self.client.get_balance(key)?)
    }
    fn send(&self, payer: &Keypair, ixs: &[Instruction], extra: &[&Keypair]) -> Result<String> {
        let blockhash = self.client.get_latest_blockhash()?;
        let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &blockhash);
        let mut signers: Vec<&Keypair> = vec![payer];
        signers.extend_from_slice(extra);
        let tx = Transaction::new(&signers, msg, blockhash);
        let sig = self.client.send_and_confirm_transaction(&tx).context("send_and_confirm")?;
        Ok(sig.to_string())
    }
    fn airdrop(&self, key: &Pubkey, lamports: u64) -> Result<()> {
        let sig = self.client.request_airdrop(key, lamports)?;
        for _ in 0..60 {
            if self.client.confirm_transaction(&sig)? {
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
