//! `window-admin setup`: mints, program configs, the escrow, the simulated agents, and
//! `deployments/<cluster>.json`. Idempotent per cluster file (re-running overwrites nothing
//! on-chain that already exists; it fails loudly instead).

use anyhow::Result;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use tracing::info;
use window_client::{ct, ix, pda};
use window_config::Profile;

use window_config::ListingCfg;

use crate::{
    chain::Chain,
    deployment::{AgentRecord, Deployment, ListingRecord},
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
    let asset = profile.primary();
    let decimals = asset.decimals;

    // --- listing #0's mints (the collateral `Config` is initialised with) ---
    let (mock_pubkey, cstock_pubkey) = create_mints(chain, keys, asset)?;

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
                cstock_pubkey,
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
    chain.send(admin, &[ix::wrap_initialize(&admin_pk, &mock_pubkey, &cstock_pubkey)], &[])?;
    // escrow: the operator's (= admin's) confidential cSTOCK-W account
    let escrow_pubkey = create_escrow(chain, keys, &cstock_pubkey)?;
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
                cstock_mint: cstock_pubkey,
                mock_mint: mock_pubkey,
                escrow_account: escrow_pubkey,
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

    // --- the collateral schedule ---
    let mut listings = Vec::new();
    let mut params = listing_params(profile, asset);
    params.feed_id = feed_id;
    chain.send(
        admin,
        &[ix::add_listing(&admin_pk, &mock_pubkey, &cstock_pubkey, &escrow_pubkey, params)],
        &[],
    )?;
    listings.push(listing_record(
        profile,
        asset,
        &mock_pubkey,
        &cstock_pubkey,
        &escrow_pubkey,
        feed_id,
    ));
    info!(key = %asset.key, listing = %pda::listing(&cstock_pubkey), "listing #0 added");
    for l in profile.listings.iter().skip(1) {
        listings.push(create_listing(chain, keys, profile, l)?);
    }

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
        // Borrowers spread across the schedule (agent 1 → listing 0, agent 3 → listing 1, …);
        // lenders hold accounts on listing 0 only.
        let role = if i % 2 == 0 { "lender" } else { "borrower" };
        let listing_index = if role == "borrower" { (i / 2) % listings.len() } else { 0 };
        let l = &listings[listing_index];
        let (mock_acc, cstock_acc) = create_agent_accounts(chain, keys, i, &wallet, l)?;
        agents.push(AgentRecord {
            index: i,
            wallet: wallet.pubkey().to_string(),
            mock_account: mock_acc.to_string(),
            cstock_account: cstock_acc.to_string(),
            role: role.into(),
            listing: listing_index,
        });
        info!(agent = i, role, listing = %l.symbol, "agent onboarded (simulated)");
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
        mock_mint: mock_pubkey.to_string(),
        cstock_mint: cstock_pubkey.to_string(),
        decimals,
        escrow_account: escrow_pubkey.to_string(),
        feed_id_hex: hex::encode(feed_id),
        auditor_elgamal_pubkey_hex: hex::encode(auditor.pubkey_bytes()),
        listings,
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

/// A listing's mock mint (ScaledUiAmount + PermanentDelegate) and its confidential twin whose
/// mint authority is the wrap program's PDA.
fn create_mints(chain: &dyn Chain, keys: &Keys, l: &ListingCfg) -> Result<(Pubkey, Pubkey)> {
    let admin = &keys.admin;
    let admin_pk = admin.pubkey();
    let auditor = keys.auditor();
    let mock = Keypair::new();
    let (ext, ext_ixs) =
        ct::mock_xstock_extensions(&mock.pubkey(), &admin_pk, l.initial_multiplier);
    let tx = ct::create_mint_plan(
        &admin_pk,
        &mock,
        &ext,
        ext_ixs,
        &admin_pk,
        l.decimals,
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
        l.decimals,
        chain.rent(ct::mint_space(&ext))?,
    );
    chain.send(admin, &tx.instructions, &tx.extra_signers.iter().collect::<Vec<_>>())?;
    info!(key = %l.key, mock = %mock.pubkey(), cstock = %cstock.pubkey(), "mints created");
    Ok((mock.pubkey(), cstock.pubkey()))
}

/// The operator's (= admin's) confidential account for a listing's escrow.
fn create_escrow(chain: &dyn Chain, keys: &Keys, cstock: &Pubkey) -> Result<Pubkey> {
    let admin = &keys.admin;
    let escrow = Keypair::new();
    let tx = ct::create_confidential_account_plan(
        &admin.pubkey(),
        &escrow,
        cstock,
        &keys.escrow(),
        chain.rent(ct::token_account_space(true))?,
    );
    chain.send(admin, &tx.instructions, &tx.extra_signers.iter().collect::<Vec<_>>())?;
    Ok(escrow.pubkey())
}

fn listing_params(profile: &Profile, l: &ListingCfg) -> window_client::ListingParams {
    window_client::ListingParams {
        feed_id: l.feed_id().unwrap_or([0u8; 32]),
        price_source: l.source.tag(),
        haircut_bps: l.haircut_bps,
        max_price_age: l.max_price_age_slots(&profile.market),
        max_publish_age_secs: l.max_publish_age_secs,
        symbol: l.symbol_bytes(),
    }
}

fn listing_record(
    profile: &Profile,
    l: &ListingCfg,
    mock: &Pubkey,
    cstock: &Pubkey,
    escrow: &Pubkey,
    feed_id: [u8; 32],
) -> ListingRecord {
    ListingRecord {
        key: l.key.clone(),
        symbol: l.symbol.clone(),
        source: l.source.label().to_string(),
        listing: pda::listing(cstock).to_string(),
        mock_mint: mock.to_string(),
        cstock_mint: cstock.to_string(),
        escrow_account: escrow.to_string(),
        feed_id_hex: hex::encode(feed_id),
        decimals: l.decimals,
        haircut_bps: l.haircut_bps,
        max_price_age_slots: l.max_price_age_slots(&profile.market),
        max_publish_age_secs: l.max_publish_age_secs,
    }
}

/// Mints, vault, escrow and the `Listing` account for one profile listing.
pub fn create_listing(
    chain: &dyn Chain,
    keys: &Keys,
    profile: &Profile,
    l: &ListingCfg,
) -> Result<ListingRecord> {
    let admin = &keys.admin;
    let admin_pk = admin.pubkey();
    let (mock, cstock) = create_mints(chain, keys, l)?;
    chain.send(admin, &[ix::wrap_initialize(&admin_pk, &mock, &cstock)], &[])?;
    let escrow = create_escrow(chain, keys, &cstock)?;
    let params = listing_params(profile, l);
    let feed_id = params.feed_id;
    chain.send(admin, &[ix::add_listing(&admin_pk, &mock, &cstock, &escrow, params)], &[])?;
    info!(key = %l.key, listing = %pda::listing(&cstock), "listing added");
    Ok(listing_record(profile, l, &mock, &cstock, &escrow, feed_id))
}

/// A simulated agent's token accounts on one listing: a public mock account holding
/// 50,000.000 shares and a configured confidential cSTOCK account.
fn create_agent_accounts(
    chain: &dyn Chain,
    keys: &Keys,
    i: usize,
    wallet: &Keypair,
    l: &ListingRecord,
) -> Result<(Pubkey, Pubkey)> {
    let admin = &keys.admin;
    let admin_pk = admin.pubkey();
    let mock: Pubkey = l.mock_mint()?;
    let cstock: Pubkey = l.cstock_mint()?;
    let mock_acc = Keypair::new();
    let tx = ct::create_token_account_plan(
        &wallet.pubkey(),
        &mock_acc,
        &mock,
        chain.rent(ct::token_account_space(false))?,
    );
    chain.send(wallet, &tx.instructions, &tx.extra_signers.iter().collect::<Vec<_>>())?;
    chain.send(admin, &[ct::mint_to(&mock, &mock_acc.pubkey(), &admin_pk, 50_000_000)], &[])?;
    let cstock_acc = Keypair::new();
    let tx = ct::create_confidential_account_plan(
        &wallet.pubkey(),
        &cstock_acc,
        &cstock,
        &keys.agent_token_keys(i),
        chain.rent(ct::token_account_space(true))?,
    );
    chain.send(wallet, &tx.instructions, &tx.extra_signers.iter().collect::<Vec<_>>())?;
    Ok((mock_acc.pubkey(), cstock_acc.pubkey()))
}

/// Brings an existing deployment up to the profile's schedule without touching what exists:
/// listing #0 is registered from `Config`'s own mints, escrow and feed id (so its price cache
/// keeps its history); every other profile listing that the descriptor does not know yet is
/// created. Idempotent: a listing whose PDA already exists is only recorded.
pub fn sync_listings(
    chain: &dyn Chain,
    keys: &Keys,
    profile: &Profile,
    dep: &mut Deployment,
    root: &std::path::Path,
) -> Result<()> {
    let admin = &keys.admin;
    let admin_pk = admin.pubkey();
    for (i, l) in profile.listings.iter().enumerate() {
        if dep.listing_by_key(&l.key).is_some() {
            info!(key = %l.key, "listing already recorded");
            continue;
        }
        let rec = if i == 0 {
            let mock: Pubkey = dep.mock_mint.parse()?;
            let cstock: Pubkey = dep.cstock_mint.parse()?;
            let escrow: Pubkey = dep.escrow_account.parse()?;
            let feed_id = dep.feed_id();
            if chain.account_data(&pda::listing(&cstock))?.is_none() {
                let mut params = listing_params(profile, l);
                params.feed_id = feed_id;
                chain.send(
                    admin,
                    &[ix::add_listing(&admin_pk, &mock, &cstock, &escrow, params)],
                    &[],
                )?;
                info!(key = %l.key, listing = %pda::listing(&cstock), "listing #0 added from Config's collateral");
            }
            listing_record(profile, l, &mock, &cstock, &escrow, feed_id)
        } else {
            create_listing(chain, keys, profile, l)?
        };
        dep.listings.push(rec);
        dep.mirror_primary();
        dep.save(root)?;
    }
    // Spread the existing borrowers across the schedule the way `setup` does (agent 1 → listing 0,
    // agent 3 → listing 1, …): a borrower moved to a new listing gets fresh token accounts there
    // and its wrap/balance memory is reset so it wraps that collateral on its next tick.
    let n = dep.listings.len();
    let mut moved = Vec::new();
    for a in dep.agents.iter_mut() {
        let target = if a.role == "borrower" { (a.index / 2) % n } else { 0 };
        if target == a.listing {
            continue;
        }
        let l = dep.listings[target].clone();
        let wallet = keys.agent_wallet(a.index);
        // The agent pays for its own accounts (~0.006 SOL); on devnet its runway may be spent.
        if chain.balance(&wallet.pubkey())? < 10_000_000 {
            chain.send(
                &keys.admin,
                &[solana_system_interface::instruction::transfer(
                    &keys.admin.pubkey(),
                    &wallet.pubkey(),
                    20_000_000,
                )],
                &[],
            )?;
        }
        let (mock_acc, cstock_acc) = create_agent_accounts(chain, keys, a.index, &wallet, &l)?;
        a.mock_account = mock_acc.to_string();
        a.cstock_account = cstock_acc.to_string();
        a.listing = target;
        moved.push(a.index);
        info!(agent = a.index, listing = %l.symbol, "borrower moved to a new listing");
    }
    if !moved.is_empty() {
        dep.save(root)?;
        crate::agents::forget_wrap(root, &dep.cluster, &moved);
    }
    Ok(())
}
