//! `window-admin setup`: mints, program configs, the escrow, the simulated agents, and
//! `deployments/<cluster>.json`. Idempotent per cluster file (re-running overwrites nothing
//! on-chain that already exists; it fails loudly instead).

use anyhow::{anyhow, Result};
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use tracing::info;
use window_client::{ct, ix, pda};
use window_config::Profile;

use crate::{
    chain::Chain,
    deployment::{AgentRecord, Deployment},
    keys::Keys,
};

pub struct SetupArgs {
    pub cluster: String,
    pub profile_name: String,
    pub agents: usize,
    pub feed_id_hex: String,
    pub airdrop: bool,
}

pub fn run(
    chain: &dyn Chain,
    keys: &Keys,
    profile: &Profile,
    args: SetupArgs,
    root: &std::path::Path,
) -> Result<Deployment> {
    let admin = &keys.admin;
    let admin_pk = admin.pubkey();
    if args.airdrop {
        for _ in 0..3 {
            let _ = chain.airdrop(&admin_pk, 5_000_000_000);
        }
    }
    let auditor = keys.auditor();
    let asset =
        profile.assets.get("mock_tsla").ok_or_else(|| anyhow!("profile needs assets.mock_tsla"))?;
    let decimals = asset.decimals;

    // --- mints ---
    let mock = Keypair::new();
    let (ext, ext_ixs) =
        ct::mock_xstock_extensions(&mock.pubkey(), &admin_pk, asset.initial_multiplier);
    let tx = ct::create_mint_plan(
        &admin_pk,
        &mock,
        &ext,
        ext_ixs,
        &admin_pk,
        decimals,
        chain.rent(ct::mint_space(&ext))?,
    );
    chain.send(admin, &tx.instructions, &tx.extra_signers.iter().collect::<Vec<_>>())?;
    let cstock = Keypair::new();
    let (ext, ext_ixs) =
        ct::confidential_mint_extensions(&cstock.pubkey(), &admin_pk, auditor.pubkey());
    let tx = ct::create_mint_plan(
        &admin_pk,
        &cstock,
        &ext,
        ext_ixs,
        &pda::wrap_mint_authority(),
        decimals,
        chain.rent(ct::mint_space(&ext))?,
    );
    chain.send(admin, &tx.instructions, &tx.extra_signers.iter().collect::<Vec<_>>())?;
    info!(mock = %mock.pubkey(), cstock = %cstock.pubkey(), "mints created");

    // --- programs ---
    let feed_id: [u8; 32] =
        hex::decode(&args.feed_id_hex).ok().and_then(|v| v.try_into().ok()).unwrap_or([7u8; 32]);
    chain.send(admin, &[ix::registry_initialize(&admin_pk)], &[])?;
    chain.send(
        admin,
        &[ix::auction_initialize(
            &admin_pk,
            window_client::auction_params(
                profile,
                &admin_pk,
                auditor.pubkey_bytes(),
                Pubkey::new_unique(),
                cstock.pubkey(),
            ),
        )],
        &[],
    )?;
    chain.send(
        admin,
        &[ix::oracle_initialize(
            &admin_pk,
            window_client::programs::AUCTION,
            profile.market.band_edge_epochs,
            profile.market.stale_after_slots,
        )],
        &[],
    )?;
    chain.send(admin, &[ix::wrap_initialize(&admin_pk, &mock.pubkey(), &cstock.pubkey())], &[])?;
    // escrow: the operator's (= admin's) confidential cSTOCK-W account
    let escrow = Keypair::new();
    let ekeys = keys.escrow();
    let tx = ct::create_confidential_account_plan(
        &admin_pk,
        &escrow,
        &cstock.pubkey(),
        &ekeys,
        chain.rent(ct::token_account_space(true))?,
    );
    chain.send(admin, &tx.instructions, &tx.extra_signers.iter().collect::<Vec<_>>())?;
    chain.send(
        admin,
        &[ix::credit_initialize(
            &admin_pk,
            window_client::CreditInitializeParams {
                operator: admin_pk,
                keeper: admin_pk,
                oracle_program: window_client::programs::ORACLE,
                auction_program: window_client::programs::AUCTION,
                registry_program: window_client::programs::REGISTRY,
                cstock_mint: cstock.pubkey(),
                mock_mint: mock.pubkey(),
                escrow_account: escrow.pubkey(),
                feed_id,
                haircut_bps: profile.credit.haircut_bps,
                max_price_age: profile.market.max_price_age_slots,
                tenor_slots: profile.market.tenor_slots,
                multiplier_override: 0,
            },
        )],
        &[],
    )?;
    info!("programs initialised");

    // --- agents (simulated members, labelled) ---
    let mut agents = Vec::new();
    for i in 0..args.agents {
        let wallet = keys.agent_wallet(i);
        if args.airdrop {
            let _ = chain.airdrop(&wallet.pubkey(), 2_000_000_000);
        } else {
            // Devnet: the admin funds each agent out of its own balance. An agent pays ~0.0062 SOL
            // of rent for its two token accounts, then fees plus Bid rent that `close_bid` returns,
            // so 0.15 SOL is a long runway. Every lamport here is a lamport not available for the
            // Epoch/Print rent the market itself burns (config/devnet.toml).
            chain.send(
                admin,
                &[solana_system_interface::instruction::transfer(
                    &admin_pk,
                    &wallet.pubkey(),
                    agent_funding_lamports(),
                )],
                &[],
            )?;
        }
        let eg = keys.agent_elgamal(i);
        chain.send(
            admin,
            &[ix::add_member(&admin_pk, &wallet.pubkey(), eg.pubkey_bytes(), 0)],
            &[],
        )?;
        let mock_acc = Keypair::new();
        let tx = ct::create_token_account_plan(
            &wallet.pubkey(),
            &mock_acc,
            &mock.pubkey(),
            chain.rent(ct::token_account_space(false))?,
        );
        chain.send(&wallet, &tx.instructions, &tx.extra_signers.iter().collect::<Vec<_>>())?;
        chain.send(
            admin,
            &[ct::mint_to(&mock.pubkey(), &mock_acc.pubkey(), &admin_pk, 50_000_000)],
            &[],
        )?; // 50,000.000 shares
        let cstock_acc = Keypair::new();
        let tkeys = keys.agent_token_keys(i);
        let tx = ct::create_confidential_account_plan(
            &wallet.pubkey(),
            &cstock_acc,
            &cstock.pubkey(),
            &tkeys,
            chain.rent(ct::token_account_space(true))?,
        );
        chain.send(&wallet, &tx.instructions, &tx.extra_signers.iter().collect::<Vec<_>>())?;
        let role = if i % 2 == 0 { "lender" } else { "borrower" };
        agents.push(AgentRecord {
            index: i,
            wallet: wallet.pubkey().to_string(),
            mock_account: mock_acc.pubkey().to_string(),
            cstock_account: cstock_acc.pubkey().to_string(),
            role: role.into(),
        });
        info!(agent = i, role, "agent onboarded (simulated)");
    }

    let dep = Deployment {
        cluster: args.cluster.clone(),
        profile: args.profile_name.clone(),
        programs: window_client::programs::all()
            .iter()
            .zip([
                "window_registry",
                "window_auction",
                "window_oracle",
                "window_wrap",
                "window_credit",
            ])
            .map(|(k, n)| (n.to_string(), k.to_string()))
            .collect(),
        mock_mint: mock.pubkey().to_string(),
        cstock_mint: cstock.pubkey().to_string(),
        decimals,
        escrow_account: escrow.pubkey().to_string(),
        feed_id_hex: hex::encode(feed_id),
        auditor_elgamal_pubkey_hex: hex::encode(auditor.pubkey_bytes()),
        agents,
    };
    dep.save(root)?;
    info!(path = %Deployment::path(root, &args.cluster).display(), "deployment written");
    Ok(dep)
}

/// SOL given to each simulated agent on a cluster with no faucet (`WINDOW_AGENT_FUNDING_LAMPORTS`).
fn agent_funding_lamports() -> u64 {
    std::env::var("WINDOW_AGENT_FUNDING_LAMPORTS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(150_000_000)
}
