use std::{path::PathBuf, sync::Arc, time::Duration};

use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing::{error, info};
use window_admin::{
    administrator::Administrator, agents::Agents, keeper, keys::Keys, metrics, operator,
    price::PriceSource, setup, Chain, Ctx, Deployment, RpcChain,
};
use window_config::Profile;

#[derive(Parser)]
#[command(
    name = "window-admin",
    about = "THE WINDOW for Stocks — administrator, keeper, operator, price poster, agents"
)]
struct Cli {
    /// localnet | devnet
    #[arg(long, env = "WINDOW_CLUSTER", default_value = "localnet")]
    cluster: String,
    #[arg(long, env = "WINDOW_PROFILE", default_value = "demo")]
    profile: String,
    #[arg(long, env = "WINDOW_RPC_URL")]
    rpc_url: Option<String>,
    #[arg(long, env = "WINDOW_ADMIN_KEYPAIR")]
    keypair: Option<PathBuf>,
    #[arg(long, env = "WINDOW_AUDITOR_SEED_HEX")]
    auditor_seed_hex: Option<String>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Create mints, initialise programs, onboard simulated agents, write deployments/<cluster>.json
    Setup {
        #[arg(long, default_value_t = 6)]
        agents: usize,
        #[arg(long, env = "PYTH_FEED_ID", default_value = "")]
        feed_id: String,
        /// Request airdrops from the cluster faucet. `--airdrop=false` funds the simulated agents
        /// out of the admin balance instead, which is what devnet needs (no usable faucet).
        #[arg(long, action = clap::ArgAction::Set, default_value_t = true)]
        airdrop: bool,
    },
    /// Run keeper + administrator + operator + price poster (one key)
    Run {
        /// Loop period. Defaults to 2 s on localnet and 6 s on devnet, where the per-tick
        /// `getProgramAccounts` scans otherwise run into public-RPC rate limits.
        #[arg(long)]
        tick_ms: Option<u64>,
        #[arg(long, default_value_t = 9090)]
        metrics_port: u16,
        /// Stop after this many prints (0 = forever)
        #[arg(long, default_value_t = 0)]
        max_prints: u64,
        /// Every n-th loan is left to default (0 = never)
        #[arg(long, default_value_t = 4)]
        default_every: usize,
    },
    /// Run the simulated members
    Agents {
        /// Loop period. Defaults to 3 s on localnet and 8 s on devnet (public-RPC rate limits).
        #[arg(long)]
        tick_ms: Option<u64>,
    },
}

/// SOL the demo faucet sends a joining wallet. It pays for that wallet's two token accounts
/// (~0.0062 SOL), its proof-context rent (refunded on close) and its fees
/// (`WINDOW_JOIN_FUNDING_LAMPORTS`).
fn join_funding_lamports() -> u64 {
    std::env::var("WINDOW_JOIN_FUNDING_LAMPORTS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(100_000_000)
}

/// The price source this profile asks for: Pyth's on-chain price-update account when the asset
/// names one, otherwise the documented mock walk (localnet/CI). `Profile::validate` guarantees the
/// two never mix, so a mock price can never be published under a real Pyth feed id (A11).
fn price_source(profile: &Profile) -> Result<PriceSource> {
    let asset = profile
        .assets
        .get("mock_tsla")
        .ok_or_else(|| anyhow::anyhow!("profile has no mock_tsla asset"))?;
    if asset.is_mock_price() {
        return Ok(PriceSource::mock(40_012));
    }
    let feed = asset.feed_id_bytes().ok_or_else(|| anyhow::anyhow!("bad pyth_feed_id"))?;
    let rpc = std::env::var("WINDOW_PRICE_RPC_URL").unwrap_or_else(|_| asset.price_rpc_url.clone());
    Ok(PriceSource::on_chain_pyth(rpc, asset.price_account.clone(), feed))
}

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env().add_directive("info".parse()?),
        )
        .init();
    let cli = Cli::parse();
    let root = window_admin::deployment::workspace_root();
    let profile = Profile::load(&cli.profile)?;
    let rpc = cli.rpc_url.clone().unwrap_or_else(|| match cli.cluster.as_str() {
        "devnet" => "https://api.devnet.solana.com".into(),
        _ => "http://127.0.0.1:8899".into(),
    });
    let chain = RpcChain::new(&rpc);
    let keys = Keys::load(cli.keypair.clone(), cli.auditor_seed_hex.clone())?;
    let metrics = Arc::new(metrics::Metrics::default());
    match cli.cmd {
        Cmd::Setup { agents, feed_id, airdrop } => {
            let feed = if feed_id.is_empty() {
                profile
                    .assets
                    .get("mock_tsla")
                    .map(|a| a.pyth_feed_id.trim_start_matches("0x").to_string())
                    .unwrap_or_default()
            } else {
                feed_id
            };
            setup::run(
                &chain,
                &keys,
                &profile,
                setup::SetupArgs {
                    cluster: cli.cluster.clone(),
                    profile_name: cli.profile.clone(),
                    agents,
                    feed_id_hex: feed,
                    airdrop,
                },
                &root,
            )?;
        }
        Cmd::Run { tick_ms, metrics_port, max_prints, default_every } => {
            let tick_ms = tick_ms.unwrap_or(if cli.cluster == "devnet" { 6_000 } else { 2_000 });
            let deployment = Deployment::load(&root, &cli.cluster)?;
            // The dashboard's demo faucet: register a wallet as a member and mint it mock stock.
            let join_chain = RpcChain::new(&rpc);
            let join_keys = Keys::load(cli.keypair.clone(), cli.auditor_seed_hex.clone())?;
            let mock_mint: solana_pubkey::Pubkey = deployment.mock_mint.parse()?;
            let join: metrics::JoinHandler = Arc::new(move |r: metrics::JoinRequest| {
                use solana_signer::Signer;
                let wallet: solana_pubkey::Pubkey =
                    r.wallet.parse().map_err(|e| format!("wallet: {e}"))?;
                let mock_account: solana_pubkey::Pubkey =
                    r.mock_account.parse().map_err(|e| format!("mock account: {e}"))?;
                let eg: [u8; 32] = hex::decode(&r.elgamal_pubkey_hex)
                    .ok()
                    .and_then(|v| v.try_into().ok())
                    .ok_or("elgamal key must be 32 bytes hex")?;
                let admin = &join_keys.admin;
                let mut ixs = Vec::new();
                if join_chain
                    .account_data(&window_client::pda::member(&wallet))
                    .map_err(|e| e.to_string())?
                    .is_none()
                {
                    ixs.push(window_client::ix::add_member(&admin.pubkey(), &wallet, eg, 0));
                }
                // The wallet has no SOL yet: the admin creates its mock ATA (idempotent) before minting.
                if mock_account == window_client::pda::ata(&wallet, &mock_mint) {
                    ixs.push(window_client::ct::create_ata_idempotent(
                        &admin.pubkey(),
                        &wallet,
                        &mock_mint,
                    ));
                }
                ixs.push(window_client::ct::mint_to(
                    &mock_mint,
                    &mock_account,
                    &admin.pubkey(),
                    10_000_000,
                )); // 10,000.000 shares
                ixs.push(solana_system_interface::instruction::transfer(
                    &admin.pubkey(),
                    &wallet,
                    join_funding_lamports(),
                )); // fees + rent for the judge's own accounts
                join_chain.send(admin, &ixs, &[]).map_err(|e| e.to_string())
            });
            metrics::serve(
                metrics.clone(),
                metrics_port,
                serde_json::to_string(&deployment)?,
                Some(join),
            );
            let ctx = Ctx {
                chain: Box::new(chain),
                keys,
                profile: profile.clone(),
                deployment: deployment.clone(),
                metrics: metrics.clone(),
                backfill_epochs: 25,
                default_every,
            };
            let mut price = price_source(&profile)?;
            info!(source = %price.describe(), "price source");
            let admin = Administrator::new(profile.print.bsgs_baby_bits);
            let solver = window_admin::administrator::solver(16);
            info!(cluster = %cli.cluster, profile = %cli.profile, "admin service running (administrator + keeper + operator + price poster; one disclosed key)");
            loop {
                if let Err(e) = keeper::tick(&ctx, &mut price) {
                    error!("keeper: {e:#}");
                }
                if let Err(e) = admin.tick(&ctx) {
                    error!("administrator: {e:#}");
                }
                if let Err(e) = operator::tick(&ctx, &solver) {
                    error!("operator: {e:#}");
                }
                if max_prints > 0
                    && metrics.prints.load(std::sync::atomic::Ordering::Relaxed) >= max_prints
                {
                    info!("max prints reached; exiting");
                    break;
                }
                std::thread::sleep(Duration::from_millis(tick_ms));
            }
        }
        Cmd::Agents { tick_ms } => {
            let tick_ms = tick_ms.unwrap_or(if cli.cluster == "devnet" { 8_000 } else { 3_000 });
            let deployment = Deployment::load(&root, &cli.cluster)?;
            let ctx = Ctx {
                chain: Box::new(chain),
                keys: Keys::load(cli.keypair, cli.auditor_seed_hex)?,
                profile,
                deployment,
                metrics,
                backfill_epochs: 5,
                default_every: 0,
            };
            let mut agents = Agents::load(&root, &cli.cluster);
            info!(cluster = %cli.cluster, agents = ctx.deployment.agents.len(), "simulated agents running");
            loop {
                if let Err(e) = agents.tick(&ctx, &keys) {
                    error!("agents: {e:#}");
                }
                std::thread::sleep(Duration::from_millis(tick_ms));
            }
        }
    }
    Ok(())
}
