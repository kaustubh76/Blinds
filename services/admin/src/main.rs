use std::{path::PathBuf, sync::Arc, time::Duration};

use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing::{error, info};
use window_admin::{
    administrator::Administrator,
    agents::Agents,
    faucet::{self, JoinLimiter},
    keeper,
    keys::Keys,
    metrics::{self, JoinOutcome, JoinRefusal},
    operator,
    price::PriceSource,
    setup, Chain, Ctx, Deployment, RpcChain,
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
    /// Fetch every listing's price from its configured source and print it — no transaction. Use
    /// it to verify `PYTH_API_KEY` and the sponsor APIs before starting the market.
    PriceCheck,
    /// Bring the deployment up to the profile's collateral schedule: register listing #0 from
    /// Config's own collateral (its price cache keeps its history) and create the others.
    ListingsSync,
    /// Resize every pre-listing Loan (32 bytes shorter) to the current layout, bound to listing #0.
    MigrateLoans,
    /// Change one listing's price source on chain (0 Pyth cache · 1 Tessera · 2 PreStocks · 3 mock ·
    /// 4 Pyth's own receiver account on this cluster). Source 4 is refused until that account holds
    /// a fresh quote.
    ListingSetSource {
        /// The profile key (`mock_tsla`).
        key: String,
        source: u8,
    },
    /// Send two transactions that carry nothing but a pubkey-validity proof — one this binary makes,
    /// one made on macOS — and report which the cluster's ZK ElGamal program accepts. Diagnoses a
    /// machine on which `setup` fails with `SigmaProof(PubkeyValidity, AlgebraicRelation)`.
    ZkProbe,
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

/// The price source one listing asks for. Pyth: Hermes when `PYTH_API_KEY` is set, with Pyth's
/// on-chain price-update accounts as the fallback (and as the only source without a key).
/// Tessera / PreStocks: the sponsor's public mark, attested by the keeper. Mock: the documented
/// walk (localnet/CI). `Profile::validate` guarantees a mock never borrows a real feed id (A11).
fn price_source(l: &window_config::ListingCfg) -> Result<PriceSource> {
    use window_config::PriceSourceKind as K;
    match l.source {
        K::Mock => Ok(PriceSource::mock(40_012)),
        K::Tessera => Ok(PriceSource::tessera(
            l.source_url.clone(),
            l.source_mint.clone(),
            l.price_field.clone(),
        )),
        K::Prestocks => Ok(PriceSource::prestocks(
            l.source_url.clone(),
            l.source_mint.clone(),
            l.price_field.clone(),
        )),
        K::Pyth => {
            let feed = l.feed_id().ok_or_else(|| anyhow::anyhow!("{}: bad pyth_feed_id", l.key))?;
            let rpc =
                std::env::var("WINDOW_PRICE_RPC_URL").unwrap_or_else(|_| l.price_rpc_url.clone());
            let on_chain = PriceSource::on_chain_pyth(rpc, l.price_account.clone(), feed);
            match std::env::var("PYTH_API_KEY").ok().filter(|k| !k.trim().is_empty()) {
                Some(key) => {
                    let base = std::env::var("PYTH_HERMES_URL")
                        .unwrap_or_else(|_| window_admin::price::DEFAULT_HERMES_URL.to_string());
                    Ok(PriceSource::hermes(base, key.trim().to_string(), feed, on_chain))
                }
                None => Ok(on_chain),
            }
        }
    }
}

/// One source per recorded listing, matched to the profile by key.
fn price_sources(profile: &Profile, deployment: &Deployment) -> Result<keeper::PriceSources> {
    deployment
        .listings
        .iter()
        .map(|rec| {
            let l = profile.listing(&rec.key).ok_or_else(|| {
                anyhow::anyhow!("deployment lists {} but the profile does not", rec.key)
            })?;
            let src = price_source(l)?;
            info!(listing = %rec.symbol, source = %src.describe(), "price source");
            Ok(src)
        })
        .collect()
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
                profile.primary().feed_id().map(hex::encode).unwrap_or_default()
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
            let other_mocks: Vec<solana_pubkey::Pubkey> =
                deployment.listings.iter().skip(1).filter_map(|l| l.mock_mint().ok()).collect();
            // Reachable from the public dashboard through a tunnel, so it is limited: a wallet is
            // funded once, at most `WINDOW_JOIN_MAX_PER_HOUR` wallets an hour, never below the floor.
            let limiter = Arc::new(JoinLimiter::per_hour(faucet::max_per_hour()));
            let min_balance = faucet::min_balance_lamports();
            let status_limiter = limiter.clone();
            let faucet_status: metrics::FaucetStatus = Arc::new(move || {
                format!(
                    "{{\"remaining_this_hour\":{},\"max_per_hour\":{},\"min_balance_sol\":{}}}",
                    status_limiter.remaining(),
                    status_limiter.max(),
                    min_balance as f64 / 1e9
                )
            });
            let join: metrics::JoinHandler = Arc::new(move |r: metrics::JoinRequest| {
                use solana_signer::Signer;
                let bad = |e: String| JoinRefusal::Bad(e);
                let wallet: solana_pubkey::Pubkey =
                    r.wallet.parse().map_err(|e| bad(format!("wallet: {e}")))?;
                let mock_account: solana_pubkey::Pubkey =
                    r.mock_account.parse().map_err(|e| bad(format!("mock account: {e}")))?;
                let eg: [u8; 32] = hex::decode(&r.elgamal_pubkey_hex)
                    .ok()
                    .and_then(|v| v.try_into().ok())
                    .ok_or_else(|| bad("elgamal key must be 32 bytes hex".into()))?;
                let admin = &join_keys.admin;
                // Already admitted: nothing to mint or send again, whatever the request says.
                if join_chain
                    .account_data(&window_client::pda::member(&wallet))
                    .map_err(|e| bad(e.to_string()))?
                    .is_some()
                {
                    return Ok(JoinOutcome { signature: None, already_member: true });
                }
                if join_chain.balance(&admin.pubkey()).map_err(|e| bad(e.to_string()))?
                    < min_balance + join_funding_lamports()
                {
                    return Err(JoinRefusal::Broke);
                }
                limiter.try_acquire().map_err(|wait| JoinRefusal::Busy {
                    retry_after_secs: wait.as_secs().max(1),
                })?;
                let mut ixs = vec![window_client::ix::add_member(&admin.pubkey(), &wallet, eg, 0)];
                // Listing #0's shares go to the wallet's own ATA on listing #0's mint. The account the
                // request names is accepted only if it is that ATA; a dashboard working another
                // listing used to name that listing's ATA, which `mint_to` on this mint would refuse.
                let first_ata = window_client::pda::ata(&wallet, &mock_mint);
                if mock_account != first_ata {
                    tracing::info!(%wallet, requested = %mock_account, "join: using the wallet's listing #0 ATA");
                }
                // The wallet has no SOL yet: the admin creates the ATA (idempotent) before minting.
                ixs.push(window_client::ct::create_ata_idempotent(
                    &admin.pubkey(),
                    &wallet,
                    &mock_mint,
                ));
                ixs.push(window_client::ct::mint_to(
                    &mock_mint,
                    &first_ata,
                    &admin.pubkey(),
                    10_000_000,
                )); // 10,000.000 shares
                    // …and 10,000.000 of every other listed collateral, into the wallet's ATAs.
                for m in &other_mocks {
                    ixs.push(window_client::ct::create_ata_idempotent(&admin.pubkey(), &wallet, m));
                    ixs.push(window_client::ct::mint_to(
                        m,
                        &window_client::pda::ata(&wallet, m),
                        &admin.pubkey(),
                        10_000_000,
                    ));
                }
                ixs.push(solana_system_interface::instruction::transfer(
                    &admin.pubkey(),
                    &wallet,
                    join_funding_lamports(),
                )); // fees + rent for the judge's own accounts
                let signature =
                    join_chain.send(admin, &ixs, &[]).map_err(|e| bad(e.to_string()))?;
                Ok(JoinOutcome { signature: Some(signature), already_member: false })
            });
            metrics::serve(
                metrics.clone(),
                metrics_port,
                serde_json::to_string(&deployment)?,
                Some(join),
                Some(faucet_status),
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
            let mut prices = price_sources(&profile, &ctx.deployment)?;
            let admin = Administrator::new(profile.print.bsgs_baby_bits);
            let solver = window_admin::administrator::solver(16);
            info!(cluster = %cli.cluster, profile = %cli.profile, "admin service running (administrator + keeper + operator + price poster; one disclosed key)");
            loop {
                if let Err(e) = keeper::tick(&ctx, &mut prices) {
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
        Cmd::ZkProbe => {
            let v = window_admin::zkprobe::run(&chain, &keys.admin)?;
            if v.own_proof_chain.is_err() || v.fixture_proof_chain.is_err() {
                std::process::exit(3);
            }
        }
        Cmd::PriceCheck => {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs()
                as i64;
            for l in &profile.listings {
                let mut price = price_source(l)?;
                println!("[{}] source: {}", l.symbol, price.describe());
                match price.fetch(now) {
                    Ok(p) => {
                        let cents = window_proofs::scalar::price_scaled(p.price, p.expo);
                        println!(
                            "[{}] price {} expo {} ({}) publish_time {} age {} s (limit {} s)",
                            l.symbol,
                            p.price,
                            p.expo,
                            cents
                                .map(|c| format!("{}.{:02} USD", c / 100, c % 100))
                                .unwrap_or_else(|| "out of range".into()),
                            p.publish_time,
                            p.age_secs(now),
                            l.max_publish_age_secs
                        );
                    }
                    Err(e) => println!("[{}] ERROR {e:#}", l.symbol),
                }
                if let (Some(shard), Some(feed_id)) = (l.pyth_shard, l.feed_id()) {
                    let account = window_admin::price::push_oracle_pda(shard, &feed_id);
                    match chain.account_owner_and_data(&account)? {
                        Some((owner, data)) if owner == window_client::PYTH_RECEIVER => {
                            match window_admin::price::decode_price_update_slot(&data, &feed_id) {
                                Ok((p, posted_slot)) => println!(
                                    "[{}] on-cluster Pyth account {account} (shard {shard}): price {} expo {} publish_time {} age {} s posted_slot {}",
                                    l.symbol, p.price, p.expo, p.publish_time, p.age_secs(now), posted_slot
                                ),
                                Err(e) => println!("[{}] on-cluster Pyth account {account}: ERROR {e:#}", l.symbol),
                            }
                        }
                        Some((owner, _)) => println!("[{}] on-cluster Pyth account {account} is owned by {owner}, not the receiver", l.symbol),
                        None => println!("[{}] on-cluster Pyth account {account} (shard {shard}) does not exist — start services/pyth-poster", l.symbol),
                    }
                }
            }
        }
        Cmd::ListingsSync => {
            let mut deployment = Deployment::load(&root, &cli.cluster)?;
            setup::sync_listings(&chain, &keys, &profile, &mut deployment, &root)?;
            for l in &deployment.listings {
                println!("{} {} listing {} feed {}", l.key, l.symbol, l.listing, l.feed_id_hex);
            }
        }
        Cmd::ListingSetSource { key, source } => {
            let mut deployment = Deployment::load(&root, &cli.cluster)?;
            setup::set_listing_source(
                &chain,
                &keys,
                &profile,
                &mut deployment,
                &root,
                &key,
                source,
            )?;
            let l = deployment.listing_by_key(&key).expect("just updated");
            println!(
                "{} {} price_source {} reads {}",
                l.key,
                l.symbol,
                l.price_source(),
                l.quote_account()?
            );
        }
        Cmd::MigrateLoans => {
            let deployment = Deployment::load(&root, &cli.cluster)?;
            let ctx = Ctx {
                chain: Box::new(chain),
                keys,
                profile,
                deployment,
                metrics,
                backfill_epochs: 0,
                default_every: 0,
            };
            let n = window_admin::migrate::run(&ctx)?;
            println!("migrated {n} loans");
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
