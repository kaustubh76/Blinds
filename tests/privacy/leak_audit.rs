//! After a full epoch with two borrowers and two loans, scan every transaction ever sent, every
//! program log and every account the programs touched for the plaintext of every secret
//! quantity. The only allowed hits are the wrap deposit amounts (the public token leg).
use std::collections::BTreeSet;

use solana_signer::Signer;
use window_clearing::Side;
use window_testkit::Harness;

const USDC: u64 = 1_000_000;

/// Byte patterns an attacker would grep for.
fn patterns(v: u64) -> Vec<(String, Vec<u8>)> {
    let mut out = vec![
        (format!("{v} le-u64"), v.to_le_bytes().to_vec()),
        (format!("{v} le-u128"), (v as u128).to_le_bytes().to_vec()),
        (format!("{v} be-u64"), v.to_be_bytes().to_vec()),
        (format!("{v} ascii"), v.to_string().into_bytes()),
    ];
    if v.is_multiple_of(USDC) {
        let whole = v / USDC;
        out.push((format!("{whole} usdc le-u64"), whole.to_le_bytes().to_vec()));
        out.push((format!("{whole} usdc ascii"), whole.to_string().into_bytes()));
    }
    if v.is_multiple_of(1_000) {
        let shares = v / 1_000;
        out.push((format!("{shares} shares le-u64"), shares.to_le_bytes().to_vec()));
        out.push((format!("{shares} shares ascii"), shares.to_string().into_bytes()));
    }
    out
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && hay.windows(needle.len()).any(|w| w == needle)
}

#[test]
fn no_secret_quantity_appears_in_transactions_logs_or_accounts() {
    let mut h = Harness::new("demo");
    let setup = h.with_credit();
    let b1 = h.add_member();
    let b2 = h.add_member();
    let lender = h.add_member();
    // Secrets: bid sizes / loan sizes and pledged collateral. Chosen so no aggregate equals any
    // individual value and nothing collides with configuration constants.
    let (loan1, loan2) = (212_000 * USDC, 147_000 * USDC);
    let (pledge1, pledge2) = (1_234_000u64, 987_000u64);
    let wrap_amounts = [2_222_000u64, 1_777_000u64]; // the public legs — allowed to appear
    let mut t1 = h.onboard_tokens(&setup, b1, 5_000_000);
    let mut t2 = h.onboard_tokens(&setup, b2, 5_000_000);
    h.wrap(&setup, b1, &mut t1, wrap_amounts[0]).unwrap();
    h.wrap(&setup, b2, &mut t2, wrap_amounts[1]).unwrap();

    let epoch = h.open_epoch();
    let (_, bid1) = h.submit_bid_keep(b1, Side::Bid, 12, loan1).unwrap();
    let (_, bid2) = h.submit_bid_keep(b2, Side::Bid, 12, loan2).unwrap();
    h.submit_bid(lender, Side::Ask, 6, 600_000 * USDC).unwrap();
    h.close_epoch(epoch);
    let out = h.print_epoch(epoch).unwrap();
    assert_eq!(
        (out.r_star_tick, out.matched),
        (Some(6), loan1 + loan2),
        "the aggregate is public; neither loan equals it"
    );
    h.post_price(&setup, 40_012_000_000, -8).unwrap();
    let scalars = h.current_scalars(&setup, 1.0);
    for (b, tokens, bid, loan_size, pledge, k) in
        [(b1, &mut t1, &bid1, loan1, pledge1, 0u8), (b2, &mut t2, &bid2, loan2, pledge2, 1u8)]
    {
        let loan = h.post_match_full(&setup, epoch, b, 12, lender, 6, k).unwrap();
        let (claim, pair) = h
            .build_lock_proofs(b, &h.loan(&loan), pledge, loan_size, &bid.opening, &scalars)
            .unwrap();
        h.lock_collateral(&setup, b, &loan, &claim, &pair).unwrap();
        h.deposit_collateral(&setup, b, tokens, &loan, pledge).unwrap();
        h.confirm_lock(&setup, &loan).unwrap();
        h.confirm_funding(&setup, &loan).unwrap();
    }

    // ---- the audit ----
    let secrets = [loan1, loan2, pledge1, pledge2];
    let mut hits: Vec<String> = Vec::new();
    let mut scanned_bytes = 0usize;
    for (i, entry) in h.tape.iter().enumerate() {
        scanned_bytes += entry.bytes.len();
        for s in secrets {
            for (label, pat) in patterns(s) {
                if contains(&entry.bytes, &pat) {
                    hits.push(format!("tx #{i} data contains {label}"));
                }
                for log in &entry.logs {
                    if contains(log.as_bytes(), &pat) {
                        hits.push(format!("tx #{i} log contains {label}: {log}"));
                    }
                }
            }
        }
    }
    let programs: BTreeSet<_> = [
        window_registry::ID,
        window_auction::ID,
        window_oracle::ID,
        window_wrap::ID,
        window_credit::ID,
    ]
    .into_iter()
    .collect();
    let mut program_accounts = 0;
    for key in h.touched.iter() {
        let Some(acc) = h.svm.get_account(&window_testkit::addr(key)) else { continue };
        if !programs.contains(&acc.owner) {
            continue;
        }
        program_accounts += 1;
        scanned_bytes += acc.data.len();
        for s in secrets {
            for (label, pat) in patterns(s) {
                if contains(&acc.data, &pat) {
                    hits.push(format!("account {key} (owner {}) contains {label}", acc.owner));
                }
            }
        }
    }
    eprintln!("leak audit: {} transactions, {} program accounts, {} bytes scanned, {} secrets × {} patterns each",
        h.tape.len(), program_accounts, scanned_bytes, secrets.len(), patterns(secrets[0]).len());
    assert!(hits.is_empty(), "plaintext secrets found:\n{}", hits.join("\n"));
    // Sanity: the audit would catch a leak — the public wrap amount IS visible in the wrap tx.
    let wrap_visible = h.tape.iter().any(|e| contains(&e.bytes, &wrap_amounts[0].to_le_bytes()));
    assert!(wrap_visible, "the public token leg is expected to be visible (leak budget)");
    let _ = lender;
    let _ = h.members[b1].wallet.pubkey();
}
