//! A decrypted quantity. Prints as `[redacted]` so no log line can carry a size by accident.

use std::fmt;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
pub struct Secret<T>(T);

impl<T> Secret<T> {
    pub const fn new(v: T) -> Self {
        Self(v)
    }
    /// The only way out. Call sites are the proof builders and clearing math, never logging.
    pub fn expose(&self) -> &T {
        &self.0
    }
}

impl<T> fmt::Debug for Secret<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}
impl<T> fmt::Display for Secret<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}
