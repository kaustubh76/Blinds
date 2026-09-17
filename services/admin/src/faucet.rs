//! Limits on the demo faucet (`POST /join`). Once the admin service is reachable from the public
//! dashboard, anyone can ask it to fund a wallet; the balance it draws on also runs the market.
//! Three guards: a wallet is funded once (checked on chain by the caller), a global sliding-window
//! cap per hour, and a floor on the admin balance below which nothing is sent.

use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{Duration, Instant},
};

/// `WINDOW_JOIN_MAX_PER_HOUR` (default 30).
pub fn max_per_hour() -> usize {
    std::env::var("WINDOW_JOIN_MAX_PER_HOUR").ok().and_then(|v| v.parse().ok()).unwrap_or(30)
}

/// `WINDOW_JOIN_MIN_BALANCE_SOL` (default 0.5 SOL), in lamports.
pub fn min_balance_lamports() -> u64 {
    let sol: f64 = std::env::var("WINDOW_JOIN_MIN_BALANCE_SOL")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.5);
    (sol * 1_000_000_000.0) as u64
}

/// A sliding-window counter: at most `max` acquisitions in any `window`.
pub struct JoinLimiter {
    max: usize,
    window: Duration,
    stamps: Mutex<VecDeque<Instant>>,
}

impl JoinLimiter {
    pub fn new(max: usize, window: Duration) -> Self {
        Self { max, window, stamps: Mutex::new(VecDeque::with_capacity(max + 1)) }
    }

    pub fn per_hour(max: usize) -> Self {
        Self::new(max, Duration::from_secs(3600))
    }

    /// Records an acquisition at `now`, or says how long until the oldest one ages out.
    pub fn try_acquire_at(&self, now: Instant) -> Result<(), Duration> {
        let mut s = self.stamps.lock().unwrap_or_else(|e| e.into_inner());
        while let Some(&first) = s.front() {
            if now.duration_since(first) >= self.window {
                s.pop_front();
            } else {
                break;
            }
        }
        if s.len() >= self.max {
            let first = *s.front().expect("non-empty when at capacity");
            return Err(self.window.saturating_sub(now.duration_since(first)));
        }
        s.push_back(now);
        Ok(())
    }

    pub fn try_acquire(&self) -> Result<(), Duration> {
        self.try_acquire_at(Instant::now())
    }

    /// How many acquisitions the window still allows at `now`.
    pub fn remaining_at(&self, now: Instant) -> usize {
        let s = self.stamps.lock().unwrap_or_else(|e| e.into_inner());
        let live = s.iter().filter(|&&t| now.duration_since(t) < self.window).count();
        self.max.saturating_sub(live)
    }

    pub fn remaining(&self) -> usize {
        self.remaining_at(Instant::now())
    }

    pub fn max(&self) -> usize {
        self.max
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_max_then_refuses_with_a_retry_after() {
        let l = JoinLimiter::new(3, Duration::from_secs(60));
        let t0 = Instant::now();
        for i in 0..3 {
            assert!(l.try_acquire_at(t0 + Duration::from_secs(i)).is_ok());
        }
        assert_eq!(l.remaining_at(t0 + Duration::from_secs(3)), 0);
        let wait = l.try_acquire_at(t0 + Duration::from_secs(10)).unwrap_err();
        assert_eq!(wait, Duration::from_secs(50));
    }

    #[test]
    fn admits_again_once_the_oldest_ages_out_and_never_grows() {
        let l = JoinLimiter::new(2, Duration::from_secs(60));
        let t0 = Instant::now();
        assert!(l.try_acquire_at(t0).is_ok());
        assert!(l.try_acquire_at(t0 + Duration::from_secs(30)).is_ok());
        assert!(l.try_acquire_at(t0 + Duration::from_secs(59)).is_err());
        assert!(l.try_acquire_at(t0 + Duration::from_secs(60)).is_ok());
        assert!(l.try_acquire_at(t0 + Duration::from_secs(61)).is_err());
        assert_eq!(l.remaining_at(t0 + Duration::from_secs(91)), 1);
        assert!(l.stamps.lock().unwrap().len() <= 2);
    }

    #[test]
    fn env_defaults() {
        assert_eq!(max_per_hour(), 30);
        assert_eq!(min_balance_lamports(), 500_000_000);
    }
}
