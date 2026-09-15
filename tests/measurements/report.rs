use std::{collections::BTreeMap, path::PathBuf, sync::Mutex};

static ROWS: Mutex<BTreeMap<String, serde_json::Value>> = Mutex::new(BTreeMap::new());

/// Records a measurement row; flushed to `docs/measurements.json` when the env var is set.
pub fn record(key: &str, value: serde_json::Value) {
    ROWS.lock().unwrap().insert(key.to_string(), value);
    if std::env::var("WINDOW_WRITE_MEASUREMENTS").is_ok() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../docs/measurements.json");
        let mut all: BTreeMap<String, serde_json::Value> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        for (k, v) in ROWS.lock().unwrap().iter() {
            all.insert(k.clone(), v.clone());
        }
        std::fs::write(&path, serde_json::to_string_pretty(&all).unwrap()).unwrap();
    }
}
