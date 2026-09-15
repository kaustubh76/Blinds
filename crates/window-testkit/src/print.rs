//! The administrator's print flow, end to end, with measurements.

use window_clearing::{clear, Side, TICKS};

use crate::{Harness, TxError, TxStats};

/// What a print cost and produced.
#[derive(Debug, Clone)]
pub struct PrintOutcome {
    pub r_star_tick: Option<u8>,
    pub matched: u64,
    pub nonzero_ticks: usize,
    pub transactions: Vec<TxStats>,
}

impl PrintOutcome {
    pub fn tx_count(&self) -> usize {
        self.transactions.len()
    }
    pub fn total_cu(&self) -> u64 {
        self.transactions.iter().map(|t| t.compute_units).sum()
    }
    pub fn max_bytes(&self) -> usize {
        self.transactions.iter().map(|t| t.bytes).max().unwrap_or(0)
    }
}

impl Harness {
    /// Decrypt → clear → begin → attest in batches → finalize. Exactly what `services/admin` does.
    pub fn print_epoch(&mut self, index: u64) -> Result<PrintOutcome, TxError> {
        let batch = self.profile.print.attest_batch as usize;
        let curve = self.decrypt_curve(index);
        let clearing = clear(&curve).expect("no overflow");
        let mut txs = Vec::new();
        if self.print(index).is_none() {
            txs.push(self.begin_print(index)?);
        }
        let e = self.epoch(index);
        let mut claims = Vec::new();
        for side in [Side::Ask, Side::Bid] {
            for t in 0..TICKS {
                if e.bid_count[side.index()][t] > 0 {
                    let v = if side == Side::Ask { curve.ask[t] } else { curve.bid[t] };
                    claims.push((side, t as u8, v));
                }
            }
        }
        for chunk in claims.chunks(batch.max(1)) {
            txs.push(self.attest(index, chunk)?);
        }
        let r_star = clearing.map(|c| c.r_star.get());
        txs.push(self.finalize_print(index, r_star)?);
        Ok(PrintOutcome {
            r_star_tick: r_star,
            matched: clearing.map(|c| c.matched).unwrap_or(0),
            nonzero_ticks: claims.len(),
            transactions: txs,
        })
    }
}
