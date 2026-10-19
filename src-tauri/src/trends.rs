use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

pub struct TrendsSidecar {
    child: Child,
}

#[derive(Debug)]
pub struct TrendsError(pub String);

impl std::fmt::Display for TrendsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TrendsPoint {
    pub date: String,
    pub values: std::collections::HashMap<String, Option<i64>>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct TrendsRequest {
    pub method: String,
    pub keywords: Vec<String>,
    #[serde(default = "default_timeframe")]
    pub timeframe: String,
    #[serde(default = "default_geo")]
    pub geo: String,
}

fn default_timeframe() -> String {
    "today 12-m".into()
}

fn default_geo() -> String {
    "NL".into()
}

impl TrendsSidecar {
    pub fn start(python: &str, script_path: &str) -> Result<Self, TrendsError> {
        let child = Command::new(python)
            .arg(script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| TrendsError(format!("Kan trends sidecar niet starten: {e}")))?;
        Ok(Self { child })
    }

    pub fn call(&mut self, req: &TrendsRequest) -> Result<serde_json::Value, TrendsError> {
        let stdin = self
            .child
            .stdin
            .as_mut()
            .ok_or_else(|| TrendsError("stdin niet beschikbaar".into()))?;
        let payload = serde_json::to_string(req)
            .map_err(|e| TrendsError(format!("Serialisatiefout: {e}")))?;
        writeln!(stdin, "{payload}")
            .map_err(|e| TrendsError(format!("Kan verzoek niet versturen: {e}")))?;
        stdin
            .flush()
            .map_err(|e| TrendsError(format!("Flush-fout: {e}")))?;

        let stdout = self
            .child
            .stdout
            .as_mut()
            .ok_or_else(|| TrendsError("stdout niet beschikbaar".into()))?;
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|e| TrendsError(format!("Leesfout: {e}")))?;
        if line.trim().is_empty() {
            return Err(TrendsError("Geen reactie van trends sidecar".into()));
        }
        let value: serde_json::Value = serde_json::from_str(&line)
            .map_err(|e| TrendsError(format!("Ongeldige JSON van sidecar: {e}")))?;
        if let Some(err) = value.get("error").and_then(|e| e.as_str()) {
            return Err(TrendsError(err.to_string()));
        }
        Ok(value)
    }
}

#[derive(Default)]
pub struct TrendsState {
    pub sidecar: Mutex<Option<TrendsSidecar>>,
    pub python: Mutex<String>,
}
